/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import { GoogleGenAI, Modality } from '@google/genai';
import type { Session, LiveServerMessage } from '@google/genai';
import { VoiceStateMachine } from './stateMachine.js';
import type { VoiceState } from './stateMachine.js';

export const VOICE_MODEL = 'gemini-2.0-flash-live-preview-04-09';
export const INPUT_SAMPLE_RATE = 16000;
export const OUTPUT_SAMPLE_RATE = 24000;

export interface TranscriptEntry {
  speaker: 'user' | 'gemini';
  text: string;
  timestamp: Date;
  interrupted?: boolean;
}

export interface AudioChunkEvent {
  data: Buffer; // raw 16-bit PCM at OUTPUT_SAMPLE_RATE
  amplitude: number; // 0..1 RMS amplitude for waveform visualizer
}

export interface LiveSessionEvents {
  connected: () => void;
  disconnected: (reason: string) => void;
  stateChange: (state: VoiceState) => void;
  audioChunk: (event: AudioChunkEvent) => void;
  transcriptUpdate: (entry: TranscriptEntry) => void;
  error: (err: Error) => void;
  interrupted: () => void;
  turnComplete: () => void;
}

export class LiveSession extends EventEmitter {
  private session: Session | null = null;
  private stateMachine = new VoiceStateMachine();
  private currentOutputTranscript = '';
  private currentInputTranscript = '';
  private apiKey: string;
  private aborted = false;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;

    this.stateMachine.on(
      'stateChange',
      ({ to }: { from: VoiceState; to: VoiceState }) => {
        this.emit('stateChange', to);
      },
    );
  }

  getState(): VoiceState {
    return this.stateMachine.getState();
  }

  async connect(): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    this.session = await ai.live.connect({
      model: VOICE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
        systemInstruction: {
          parts: [
            {
              text: 'You are a voice-first AI coding assistant in a developer terminal. Keep responses concise and spoken-friendly. Describe code verbally rather than reading syntax.',
            },
          ],
        },
      },
      callbacks: {
        onopen: () => {
          if (this.aborted) return;
          this.stateMachine.transition('LISTENING');
          this.emit('connected');
        },
        onmessage: (message: LiveServerMessage) => {
          if (this.aborted) return;
          this.handleServerMessage(message);
        },
        onerror: (e: ErrorEvent) => {
          if (this.aborted) return;
          this.emit(
            'error',
            new Error(`Live API error: ${e.message ?? String(e)}`),
          );
        },
        onclose: (e: CloseEvent) => {
          if (this.aborted) return;
          this.stateMachine.forceTransition('IDLE');
          this.emit('disconnected', e.reason ?? 'Connection closed');
        },
      },
    });
  }

  private handleServerMessage(message: LiveServerMessage): void {
    const content = message.serverContent;
    if (!content) return;

    // Handle interruption
    if (content.interrupted) {
      this.stateMachine.transition('RECORDING');
      this.emit('interrupted');

      if (this.currentOutputTranscript) {
        this.emit('transcriptUpdate', {
          speaker: 'gemini',
          text: this.currentOutputTranscript + ' [interrupted]',
          timestamp: new Date(),
          interrupted: true,
        } satisfies TranscriptEntry);
        this.currentOutputTranscript = '';
      }
    }

    // Handle audio parts from model turn
    if (content.modelTurn?.parts) {
      for (const part of content.modelTurn.parts) {
        if (part.inlineData?.data) {
          const raw = Buffer.from(part.inlineData.data, 'base64');
          const amplitude = computeRmsAmplitude(raw);

          // Transition to SPEAKING on first audio chunk
          if (this.stateMachine.getState() === 'PROCESSING') {
            this.stateMachine.transition('SPEAKING');
          }

          this.emit('audioChunk', {
            data: raw,
            amplitude,
          } satisfies AudioChunkEvent);
        }
      }
    }

    // Handle output transcription (Gemini's speech as text)
    if (content.outputTranscription?.text) {
      this.currentOutputTranscript += content.outputTranscription.text;
    }

    // Handle input transcription (user's speech as text)
    if (content.inputTranscription?.text) {
      this.currentInputTranscript += content.inputTranscription.text;
    }

    // Handle turn complete
    if (content.turnComplete) {
      if (this.currentOutputTranscript) {
        this.emit('transcriptUpdate', {
          speaker: 'gemini',
          text: this.currentOutputTranscript,
          timestamp: new Date(),
        } satisfies TranscriptEntry);
        this.currentOutputTranscript = '';
      }
      if (this.currentInputTranscript) {
        this.emit('transcriptUpdate', {
          speaker: 'user',
          text: this.currentInputTranscript,
          timestamp: new Date(),
        } satisfies TranscriptEntry);
        this.currentInputTranscript = '';
      }
      this.stateMachine.transition('LISTENING');
      this.emit('turnComplete');
    }
  }

  /** Send a raw PCM audio chunk (16-bit, 16kHz, mono) to the Live API. */
  sendAudioChunk(pcmBuffer: Buffer): void {
    if (!this.session) return;
    const base64 = pcmBuffer.toString('base64');
    this.session.sendRealtimeInput({
      audio: {
        data: base64,
        mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
      },
    });

    // Transition to RECORDING when we first start sending audio
    if (this.stateMachine.getState() === 'LISTENING') {
      this.stateMachine.transition('RECORDING');
    }
  }

  /** Signal that the user has finished speaking. */
  endUserTurn(): void {
    if (!this.session) return;
    this.session.sendRealtimeInput({ audioStreamEnd: true });
    this.stateMachine.transition('PROCESSING');
  }

  /** Send a text message (useful for testing without audio). */
  sendTextMessage(text: string): void {
    if (!this.session) return;
    this.session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true,
    });
    this.stateMachine.transition('PROCESSING');
    this.emit('transcriptUpdate', {
      speaker: 'user',
      text,
      timestamp: new Date(),
    } satisfies TranscriptEntry);
  }

  disconnect(): void {
    this.aborted = true;
    this.session?.close();
    this.session = null;
    this.stateMachine.forceTransition('IDLE');
  }
}

/** Compute RMS amplitude of a 16-bit PCM buffer, normalised to 0..1. */
function computeRmsAmplitude(buffer: Buffer): number {
  if (buffer.length < 2) return 0;
  let sumSq = 0;
  const samples = buffer.length >> 1; // 2 bytes per sample
  for (let i = 0; i < buffer.length - 1; i += 2) {
    const sample = buffer.readInt16LE(i) / 32768;
    sumSq += sample * sample;
  }
  return Math.sqrt(sumSq / samples);
}
