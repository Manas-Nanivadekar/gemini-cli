/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import { OUTPUT_SAMPLE_RATE } from '@google/gemini-cli-core';

/**
 * Audio playback using the `speaker` npm package.
 *
 * `speaker` writes PCM data directly to the OS audio subsystem via bindings.
 *
 * Install: npm install speaker
 * This module fails gracefully when `speaker` is unavailable.
 */
export class AudioPlayback extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private speakerInstance: any = null;
  private queue: Buffer[] = [];
  private playing = false;
  private flushing = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private SpeakerClass: (new (opts: Record<string, unknown>) => any) | null =
    null;

  async initialize(): Promise<void> {
    try {
      const speakerPkg = 'speaker';
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod = await import(speakerPkg);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.SpeakerClass = mod.default ?? mod;
    } catch (_err) {
      // Not a fatal error — we'll silently skip audio output when unavailable
    }
  }

  /** Queue a raw 16-bit PCM buffer at OUTPUT_SAMPLE_RATE for playback. */
  enqueue(buffer: Buffer): void {
    if (this.flushing) return;
    this.queue.push(buffer);
    if (!this.playing) {
      void this.drainQueue();
    }
  }

  /**
   * Immediately stop playback and discard all queued audio.
   * Called when Gemini is interrupted.
   */
  flush(): void {
    this.flushing = true;
    this.queue = [];
    if (this.speakerInstance) {
      try {
        this.speakerInstance.end();
      } catch {
        // Ignore errors during flush
      }
      this.speakerInstance = null;
    }
    this.playing = false;
    this.flushing = false;
  }

  private async drainQueue(): Promise<void> {
    if (!this.SpeakerClass || this.queue.length === 0) return;
    this.playing = true;
    this.emit('playing');

    while (this.queue.length > 0 && !this.flushing) {
      const chunk = this.queue.shift();
      if (!chunk) break;
      try {
        await this.playChunk(chunk);
      } catch (_err) {
        // Skip failed chunks
      }
    }

    this.playing = false;
    if (!this.flushing) {
      this.emit('finished');
    }
  }

  private playChunk(buffer: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.flushing || !this.SpeakerClass) {
        resolve();
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.speakerInstance = new this.SpeakerClass({
        channels: 1,
        bitDepth: 16,
        sampleRate: OUTPUT_SAMPLE_RATE,
      });

      this.speakerInstance.on('close', () => {
        this.speakerInstance = null;
        resolve();
      });

      this.speakerInstance.on('error', (err: Error) => {
        this.speakerInstance = null;
        reject(err);
      });

      this.speakerInstance.write(buffer);

      this.speakerInstance.end();
    });
  }

  isPlaying(): boolean {
    return this.playing;
  }
}
