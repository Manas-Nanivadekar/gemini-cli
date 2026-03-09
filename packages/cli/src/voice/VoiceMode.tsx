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
 * PTT uses a toggle model (press SPACE to start recording, press again to stop)
 * since terminals do not expose keydown/keyup events.
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

  // Refs that mirror state/props so the useInput callback never needs to be
  // recreated. Recreating useInput's callback causes Ink to briefly
  // unregister and re-register the stdin listener, which can crash Ink's
  // internal input handler when a keypress arrives during the transition.
  const onExitRef = useRef(onExit);
  const activationModeRef = useRef<ActivationMode>('ptt');
  const voiceStateRef = useRef<VoiceState>('IDLE');
  const isRecordingRef = useRef(false); // tracks PTT toggle state

  // Keep refs in sync with latest values
  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);
  useEffect(() => {
    activationModeRef.current = activationMode;
  }, [activationMode]);
  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  // Wire up Live session
  useEffect(() => {
    const session = new LiveSession(apiKey);
    sessionRef.current = session;

    const capture = new AudioCapture();
    captureRef.current = capture;

    const playback = new AudioPlayback();
    playbackRef.current = playback;

    session.on('connected', () => {
      setStatusMessage('');
    });

    session.on('disconnected', (reason: string) => {
      setStatusMessage(`Disconnected: ${reason}`);
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

    capture.on('data', (chunk: Buffer) => {
      session.sendAudioChunk(chunk);
      setAmplitude(computeRms(chunk));
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

  // Toggle VAD / PTT mode — called from useInput via ref, so it can be
  // stable itself by reading activationModeRef instead of closing over state.
  const toggleActivationMode = useCallback(async () => {
    const next: ActivationMode =
      activationModeRef.current === 'ptt' ? 'vad' : 'ptt';
    setActivationMode(next);
    activationModeRef.current = next;

    if (next === 'vad') {
      const vad = new VadService();
      vadRef.current = vad;

      vad.on('speechStart', () => {
        void captureRef.current?.start();
      });

      vad.on('speechEnd', () => {
        captureRef.current?.stop();
        sessionRef.current?.endUserTurn();
        isRecordingRef.current = false;
      });

      vad.on('error', (err: Error) => {
        setError(`VAD: ${err.message}. Falling back to Push-to-Talk.`);
        setActivationMode('ptt');
        activationModeRef.current = 'ptt';
      });

      await vad.initialize();
      vad.start();
    } else {
      vadRef.current?.destroy();
      vadRef.current = null;
      captureRef.current?.stop();
      isRecordingRef.current = false;
    }
  }, []); // no deps — reads everything through refs

  // Stable keyboard handler — reads all mutable values via refs so this
  // callback is created exactly once and never triggers Ink listener churn.
  useInput(
    useCallback(
      (input, key) => {
        // Ctrl+Q or Ctrl+C — exit
        if ((input === 'q' || input === 'c') && key.ctrl) {
          onExitRef.current();
          return;
        }

        // Ctrl+M — toggle PTT / VAD
        if (input === 'm' && key.ctrl) {
          void toggleActivationMode();
          return;
        }

        // SPACE — PTT toggle (press to start recording, press again to stop)
        if (input === ' ' && activationModeRef.current === 'ptt') {
          if (!isRecordingRef.current) {
            // Start recording
            isRecordingRef.current = true;
            // Interrupt Gemini if it's currently speaking
            if (voiceStateRef.current === 'SPEAKING') {
              playbackRef.current?.flush();
            }
            void captureRef.current?.start();
          } else {
            // Stop recording and send
            isRecordingRef.current = false;
            captureRef.current?.stop();
            sessionRef.current?.endUserTurn();
          }
        }
      },
      [toggleActivationMode],
    ),
  );

  const isWaveformActive =
    voiceState === 'RECORDING' || voiceState === 'SPEAKING';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      {/* Header */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text bold color="cyan">
          Voice Mode
        </Text>
        <Text dimColor>
          {'  |  '}Model: gemini-2.0-flash-live | Voice: Kore | Mode:{' '}
          {activationMode === 'ptt' ? 'Push-to-Talk' : 'Hands-free VAD'}
        </Text>
      </Box>

      {/* Error banner */}
      {error && (
        <Box paddingX={2} paddingY={1}>
          <Text color="red">! {error}</Text>
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
