import type { AgentConfig } from '../services/agents/ILLMAgent';
import type { ModelDirective } from './types';
import { lfmDirective } from './lfm/directive';
import { qwenDirective } from './qwen/directive';

const DIRECTIVES: ModelDirective[] = [
  lfmDirective,
  qwenDirective,
];

const fallbackDirective: ModelDirective = {
  id: 'generic',
  label: 'Generic Structured Model',
  toolCallStrategy: 'structured',
  notes: 'Default directive for models that work with standard structured tool calling.',
  matches: () => true,
};

export function resolveModelDirective(
  config: Pick<AgentConfig, 'provider' | 'model'>,
): ModelDirective {
  return DIRECTIVES.find((directive) => directive.matches(config)) ?? fallbackDirective;
}

export function getModelDirectives(): ModelDirective[] {
  return [...DIRECTIVES, fallbackDirective];
}
