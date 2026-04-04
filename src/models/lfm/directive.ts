import type { ModelDirective } from '../types';

export const lfmDirective: ModelDirective = {
  id: 'lfm',
  label: 'LiquidAI LFM',
  toolCallStrategy: 'inline-parser',
  notes: 'Uses inline tool-call tokens that require client-side parsing for reliable tool execution.',
  matches: ({ provider, model }) => {
    if (provider !== 'openai-compatible') {
      return false;
    }

    return model.toLowerCase().includes('lfm');
  },
};
