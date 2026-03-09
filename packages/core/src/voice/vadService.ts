/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';

export interface VadOptions {
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  redemptionFrames?: number;
  frameSamples?: number;
}

/**
 * Voice Activity Detection service wrapping Silero VAD via @ricky0123/vad-node.
 *
 * This is an optional dependency — if not installed the service will emit an
 * error and fall back to Push-to-Talk mode.
 *
 * Install: npm install @ricky0123/vad-node onnxruntime-node
 */
export class VadService extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private vad: any = null;
  private running = false;

  async initialize(opts: VadOptions = {}): Promise<void> {
    try {
      // Dynamic import via variable — prevents TypeScript from trying to resolve
      // this at compile time. Same pattern used by getPty.ts for node-pty.
      const vadPkg = '@ricky0123/vad-node';
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const vadModule = await import(vadPkg);

      const options = {
        positiveSpeechThreshold: opts.positiveSpeechThreshold ?? 0.5,
        negativeSpeechThreshold: opts.negativeSpeechThreshold ?? 0.35,
        redemptionFrames: opts.redemptionFrames ?? 8,
        frameSamples: opts.frameSamples ?? 1536,
        onSpeechStart: () => {
          this.emit('speechStart');
        },
        onSpeechEnd: (audio: Float32Array) => {
          this.emit('speechEnd', audio);
        },
        onVADMisfire: () => {
          this.emit('misfire');
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.vad = await vadModule.MicVAD.new(options);
    } catch (_err) {
      this.emit(
        'error',
        new Error(
          'VAD not available: install @ricky0123/vad-node and onnxruntime-node for hands-free mode.',
        ),
      );
    }
  }

  start(): void {
    if (!this.vad || this.running) return;
    this.running = true;

    this.vad.start();
  }

  stop(): void {
    if (!this.vad || !this.running) return;
    this.running = false;

    this.vad.pause();
  }

  destroy(): void {
    this.running = false;

    this.vad?.destroy?.();
    this.vad = null;
  }
}
