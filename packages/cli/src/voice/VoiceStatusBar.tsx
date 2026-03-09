/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import type { VoiceState } from '@google/gemini-cli-core';

interface VoiceStatusBarProps {
  state: VoiceState;
  activationMode: 'ptt' | 'vad';
}

const STATE_COLORS: Record<VoiceState, string> = {
  IDLE: 'gray',
  LISTENING: 'green',
  RECORDING: 'red',
  PROCESSING: 'yellow',
  SPEAKING: 'blue',
};

const STATE_LABELS: Record<VoiceState, string> = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  RECORDING: 'RECORDING',
  PROCESSING: 'PROCESSING...',
  SPEAKING: 'SPEAKING',
};

const STATE_HINTS: Record<VoiceState, string> = {
  IDLE: 'Connecting...',
  LISTENING: 'Hold SPACE to talk',
  RECORDING: 'Recording... release SPACE to send',
  PROCESSING: 'Gemini is thinking',
  SPEAKING: 'Gemini is speaking (SPACE to interrupt)',
};

/**
 * Bottom status bar showing current voice state and keybinding hints.
 */
export const VoiceStatusBar: React.FC<VoiceStatusBarProps> = ({
  state,
  activationMode,
}) => {
  const color = STATE_COLORS[state];
  const label = STATE_LABELS[state];
  const hint = STATE_HINTS[state];

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold color={color}>
        {state === 'RECORDING' ? '● ' : state === 'SPEAKING' ? '▶ ' : '◉ '}
        {label}
      </Text>
      <Text dimColor>
        {'  ·  '}
        {hint}
        {'  ·  '}
      </Text>
      <Text dimColor>
        Ctrl+M: {activationMode === 'ptt' ? 'switch to VAD' : 'switch to PTT'}
        {'  ·  '}
        /voice off to exit
      </Text>
    </Box>
  );
};
