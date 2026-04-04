import type { ModelDirective } from '../types';

export const qwenDirective: ModelDirective = {
  id: 'qwen',
  label: 'Qwen',
  toolCallStrategy: 'structured',
  notes: 'Reserved for Qwen-specific structured tool handling and prompt tweaks.',
  matches: ({ model }) => model.toLowerCase().includes('qwen'),
};
