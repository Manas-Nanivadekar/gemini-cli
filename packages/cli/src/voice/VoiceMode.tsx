/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { LiveSession, VadService } from '@google/gemini-cli-core';
import type { TranscriptEntry, VoiceState } from '@google/gemini-cli-core';
import { Waveform } from './Waveform.js';
import { VoiceTranscript } from './VoiceTranscript.js';
import { VoiceStatusBar } from './VoiceStatusBar.js';
import { AudioCapture } from './audioCapture.js';
import { AudioPlayback } from './audioPlayback.js';

interface VoiceModeProps {
  apiKey: string;
  onExit: () => void;
}

type ActivationMode = 'ptt' | 'vad';

/**
 * Main voice mode component. Renders the full voice UI and wires together
 * the Live API session, audio capture/playback, and VAD.
 *
 * Layout:
 *   ┌─ Header ──────────────────────┐
 *   │  Transcript                    │
 *   │  Waveform                      │
 *   │  StatusBar                     │
 *   └────────────────────────────────┘
 */
export const VoiceMode: React.FC<VoiceModeProps> = ({ apiKey, onExit }) => {
  const [voiceState, setVoiceState] = useState<VoiceState>('IDLE');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [amplitude, setAmplitude] = useState(0);
  const [activationMode, setActivationMode] = useState<ActivationMode>('ptt');
  const [statusMessage, setStatusMessage] = useState('Connecting...');
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<LiveSession | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const playbackRef = useRef<AudioPlayback | null>(null);
  const vadRef = useRef<VadService | null>(null);
  const spaceHeldRef = useRef(false);

  // Wire up Live session
  useEffect(() => {
    const session = new LiveSession(apiKey);
    sessionRef.current = session;

    const capture = new AudioCapture();
    captureRef.current = capture;

    const playback = new AudioPlayback();
    playbackRef.current = playback;

    // Session events
    session.on('connected', () => {
      setStatusMessage('');
      setVoiceState('LISTENING');
    });

    session.on('disconnected', (reason: string) => {
      setStatusMessage(`Disconnected: ${reason}`);
      setVoiceState('IDLE');
    });

    session.on('stateChange', (state: VoiceState) => {
      setVoiceState(state);
    });

    session.on(
      'audioChunk',
      ({ data, amplitude: amp }: { data: Buffer; amplitude: number }) => {
        setAmplitude(amp);
        playback.enqueue(data);
      },
    );

    session.on('transcriptUpdate', (entry: TranscriptEntry) => {
      setTranscript((prev) => [...prev, entry]);
    });

    session.on('interrupted', () => {
      playback.flush();
    });

    session.on('turnComplete', () => {
      setAmplitude(0);
    });

    session.on('error', (err: Error) => {
      setError(err.message);
    });

    // Audio capture events — forward PCM to Live API
    capture.on('data', (chunk: Buffer) => {
      session.sendAudioChunk(chunk);
      // Compute amplitude for waveform during recording
      const rms = computeRms(chunk);
      setAmplitude(rms);
    });

    capture.on('error', (err: Error) => {
      setError(`Microphone: ${err.message}`);
    });

    void playback.initialize();
    void session.connect();

    return () => {
      session.disconnect();
      capture.stop();
      vadRef.current?.destroy();
    };
  }, [apiKey]);

  // Toggle VAD / PTT mode
  const toggleActivationMode = useCallback(async () => {
    const next: ActivationMode = activationMode === 'ptt' ? 'vad' : 'ptt';
    setActivationMode(next);

    if (next === 'vad') {
      const vad = new VadService();
      vadRef.current = vad;

      vad.on('speechStart', () => {
        void captureRef.current?.start();
      });

      vad.on('speechEnd', () => {
        captureRef.current?.stop();
        sessionRef.current?.endUserTurn();
      });

      vad.on('error', (err: Error) => {
        setError(`VAD: ${err.message}. Falling back to Push-to-Talk.`);
        setActivationMode('ptt');
      });

      await vad.initialize();
      vad.start();
    } else {
      vadRef.current?.destroy();
      vadRef.current = null;
      captureRef.current?.stop();
    }
  }, [activationMode]);

  // Keyboard handling
  useInput(
    (input, key) => {
      // Exit
      if (input === 'q' && key.ctrl) {
        onExit();
        return;
      }

      // Toggle VAD/PTT with Ctrl+M
      if (input === 'm' && key.ctrl) {
        void toggleActivationMode();
        return;
      }

      // Push-to-Talk: SPACE
      if (activationMode === 'ptt') {
        if (input === ' ') {
          if (!spaceHeldRef.current) {
            spaceHeldRef.current = true;

            // Interrupt Gemini if it's speaking
            if (voiceState === 'SPEAKING') {
              playbackRef.current?.flush();
            }

            void captureRef.current?.start();
          }
        }
      }
    },
    { isActive: true },
  );

  // Space key release isn't directly available in Ink's useInput — we use a
  // keypress approach. Ink fires a callback per-keypress, not keydown/keyup.
  // For PTT we therefore use a 300ms debounce: if SPACE is not seen for 300ms
  // we treat it as released. This is a terminal limitation.
  useEffect(() => {
    if (activationMode !== 'ptt') return;
    if (!spaceHeldRef.current) return;

    const timeout = setTimeout(() => {
      if (spaceHeldRef.current) {
        spaceHeldRef.current = false;
        captureRef.current?.stop();
        sessionRef.current?.endUserTurn();
      }
    }, 300);

    return () => clearTimeout(timeout);
  });

  const isWaveformActive =
    voiceState === 'RECORDING' || voiceState === 'SPEAKING';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      {/* Header */}
      <Box
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        justifyContent="space-between"
      >
        <Text bold color="cyan">
          🎙 Voice Mode
        </Text>
        <Text dimColor>
          Model: gemini-2.5-flash | Voice: Kore | Mode:{' '}
          {activationMode === 'ptt' ? 'Push-to-Talk' : 'Hands-free VAD'}
        </Text>
      </Box>

      {/* Error banner */}
      {error && (
        <Box paddingX={2} paddingY={1}>
          <Text color="red">⚠ {error}</Text>
        </Box>
      )}

      {/* Status message (connecting, etc.) */}
      {statusMessage && !error && (
        <Box paddingX={2} paddingY={1}>
          <Text dimColor>{statusMessage}</Text>
        </Box>
      )}

      {/* Transcript */}
      <VoiceTranscript entries={transcript} maxEntries={8} />

      {/* Waveform visualizer */}
      <Waveform amplitude={amplitude} active={isWaveformActive} />

      {/* Status bar */}
      <VoiceStatusBar state={voiceState} activationMode={activationMode} />
    </Box>
  );
};

/** Compute RMS amplitude of 16-bit PCM buffer, normalised 0..1. */
function computeRms(buffer: Buffer): number {
  if (buffer.length < 2) return 0;
  let sumSq = 0;
  const samples = buffer.length >> 1;
  for (let i = 0; i < buffer.length - 1; i += 2) {
    const s = buffer.readInt16LE(i) / 32768;
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / samples);
}
