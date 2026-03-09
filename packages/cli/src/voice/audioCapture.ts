/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import { INPUT_SAMPLE_RATE } from '@google/gemini-cli-core';

/**
 * Microphone capture using the `mic` npm package.
 *
 * `mic` wraps SoX, so the system must have SoX installed:
 *   Linux:  sudo apt install sox
 *   macOS:  brew install sox
 *
 * Install: npm install mic
 * This module fails gracefully when `mic` or SoX is unavailable.
 */
export class AudioCapture extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private micInstance: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private micInputStream: any = null;
  private capturing = false;

  async start(): Promise<void> {
    if (this.capturing) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mic: any;
    try {
      // Dynamic import via variable to prevent compile-time module resolution.
      const micPkg = 'mic';
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const micModule = await import(micPkg);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mic = micModule.default ?? micModule;
    } catch (_err) {
      this.emit(
        'error',
        new Error(
          'Audio capture unavailable: install the `mic` npm package and SoX (apt install sox / brew install sox).',
        ),
      );
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.micInstance = mic({
      rate: String(INPUT_SAMPLE_RATE),
      channels: '1',
      bitwidth: '16',
      encoding: 'signed-integer',
      endian: 'little',
      fileType: 'raw',
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.micInputStream = this.micInstance.getAudioStream();

    this.micInputStream.on('data', (chunk: Buffer) => {
      this.emit('data', chunk);
    });

    this.micInputStream.on('error', (err: Error) => {
      this.emit('error', err);
    });

    this.micInputStream.on('startComplete', () => {
      this.capturing = true;
      this.emit('started');
    });

    this.micInputStream.on('stopComplete', () => {
      this.capturing = false;
      this.emit('stopped');
    });

    this.micInstance.start();
  }

  stop(): void {
    if (!this.capturing) return;

    this.micInstance?.stop();
  }

  isCapturing(): boolean {
    return this.capturing;
  }
}
