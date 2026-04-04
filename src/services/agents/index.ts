/**
 * Agent Abstraction Layer
 * 
 * This module provides a unified interface for different LLM agent implementations,
 * allowing the system to swap between approaches without changing session handler code.
 * 
 * Key Components:
 * - ILLMAgent: Common interface for all agent implementations
 * - AgentFactory: Factory for creating agent instances
 * - VercelSDKAgent: Wrapper around Vercel AI SDK Agent
 * - CustomAgent: Manual control with reusable components
 * 
 * @module agents
 */

// Core interface and types
export type {
  ILLMAgent,
  AgentConfig,
  AgentStreamOptions,
  AgentStreamPart,
  AgentMetadata,
  TextDeltaPart,
  ToolCallPart,
  ToolResultPart,
  UsagePart,
  ErrorPart,
} from './ILLMAgent';

// Factory
export { AgentFactory } from './AgentFactory';

// Agent implementations
export { VercelSDKAgent } from './VercelSDKAgent';
export { CustomAgent } from './CustomAgent';
export { InlineToolParsingAgent } from './InlineToolParsingAgent';
