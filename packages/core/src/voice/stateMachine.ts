/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';

export type VoiceState =
  | 'IDLE'
  | 'LISTENING'
  | 'RECORDING'
  | 'PROCESSING'
  | 'SPEAKING';

export interface VoiceStateChangeEvent {
  from: VoiceState;
  to: VoiceState;
}

// Valid state transitions for the voice FSM
const VALID_TRANSITIONS: Record<VoiceState, VoiceState[]> = {
  IDLE: ['LISTENING'],
  LISTENING: ['RECORDING', 'IDLE'],
  RECORDING: ['PROCESSING', 'IDLE'],
  PROCESSING: ['SPEAKING', 'LISTENING', 'IDLE'],
  SPEAKING: ['LISTENING', 'RECORDING', 'IDLE'],
};

export interface VoiceStateMachineEvents {
  stateChange: (event: VoiceStateChangeEvent) => void;
}

export class VoiceStateMachine extends EventEmitter {
  private state: VoiceState = 'IDLE';

  getState(): VoiceState {
    return this.state;
  }

  /** Attempt a valid transition. Returns true if successful. */
  transition(to: VoiceState): boolean {
    const from = this.state;
    if (!VALID_TRANSITIONS[from]?.includes(to)) {
      return false;
    }
    this.state = to;
    this.emit('stateChange', { from, to } satisfies VoiceStateChangeEvent);
    return true;
  }

  /** Force a transition regardless of validity (for error recovery). */
  forceTransition(to: VoiceState): void {
    const from = this.state;
    this.state = to;
    this.emit('stateChange', { from, to } satisfies VoiceStateChangeEvent);
  }
}
