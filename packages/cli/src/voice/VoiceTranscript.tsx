/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import type { TranscriptEntry } from '@google/gemini-cli-core';

interface VoiceTranscriptProps {
  entries: TranscriptEntry[];
  maxEntries?: number;
}

/**
 * Scrollable conversation transcript showing "You:" and "Gemini:" turns.
 */
export const VoiceTranscript: React.FC<VoiceTranscriptProps> = ({
  entries,
  maxEntries = 10,
}) => {
  const visible = entries.slice(-maxEntries);

  if (visible.length === 0) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text dimColor>Waiting for voice input...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {visible.map((entry, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Text bold color={entry.speaker === 'user' ? 'green' : 'blue'}>
            {entry.speaker === 'user' ? 'You:' : 'Gemini:'}
          </Text>
          <Box paddingLeft={2}>
            <Text
              color={entry.interrupted ? 'yellow' : undefined}
              dimColor={entry.interrupted}
            >
              &quot;{entry.text}&quot;
              {entry.interrupted ? ' [interrupted]' : ''}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
};
