/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandKind, type SlashCommand } from './types.js';
import { VoiceMode } from '../../voice/VoiceMode.js';

export const voiceCommand: SlashCommand = {
  name: 'voice',
  description:
    'Activate bidirectional voice conversation mode (Gemini Live API)',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  subCommands: [
    {
      name: 'off',
      description: 'Exit voice mode',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: (context) => {
        context.ui.removeComponent();
      },
    },
  ],
  action: (context) => {
    const apiKey = process.env['GEMINI_API_KEY'] ?? '';

    if (!apiKey) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Voice mode requires a GEMINI_API_KEY environment variable. ' +
          'Set it with: export GEMINI_API_KEY=<your-key>',
      };
    }

    return {
      type: 'custom_dialog',
      component: (
        <VoiceMode
          apiKey={apiKey}
          onExit={() => {
            context.ui.removeComponent();
          }}
        />
      ),
    };
  },
};
