import type { AgentConfig } from '../services/agents/ILLMAgent';

export type ToolCallStrategy = 'structured' | 'inline-parser';

export interface ModelDirective {
  id: string;
  label: string;
  toolCallStrategy: ToolCallStrategy;
  notes?: string;
  matches(config: Pick<AgentConfig, 'provider' | 'model'>): boolean;
}
