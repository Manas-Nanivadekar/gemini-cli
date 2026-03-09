/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';

const WAVEFORM_CHARS = ['░', '▒', '▓', '█'];

interface WaveformProps {
  /** Current amplitude 0..1 */
  amplitude: number;
  /** Whether the waveform should be animated (active input/output) */
  active: boolean;
}

function amplitudeToChar(value: number): string {
  if (value < 0.1) return WAVEFORM_CHARS[0];
  if (value < 0.35) return WAVEFORM_CHARS[1];
  if (value < 0.65) return WAVEFORM_CHARS[2];
  return WAVEFORM_CHARS[3];
}

/**
 * Renders a real-time ASCII waveform using Unicode block characters.
 * Updates at ~15fps when active (60ms interval).
 */
export const Waveform: React.FC<WaveformProps> = ({ amplitude, active }) => {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;
  const barWidth = Math.max(20, terminalWidth - 4);

  const [displayAmplitudes, setDisplayAmplitudes] = useState<number[]>(
    Array.from({ length: barWidth }, () => 0),
  );

  useEffect(() => {
    if (!active) {
      // Show a flat line when inactive
      setDisplayAmplitudes(Array.from({ length: barWidth }, () => 0));
      return;
    }

    const interval = setInterval(() => {
      setDisplayAmplitudes((prev) => {
        // Shift left and add new amplitude value with slight noise
        const noise = (Math.random() - 0.5) * 0.05;
        const newAmp = Math.max(0, Math.min(1, amplitude + noise));
        return [...prev.slice(1), newAmp];
      });
    }, 60);

    return () => clearInterval(interval);
  }, [active, amplitude, barWidth]);

  const waveformStr = displayAmplitudes.map(amplitudeToChar).join('');

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color={active ? 'cyan' : 'gray'}>{waveformStr}</Text>
    </Box>
  );
};
