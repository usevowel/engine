/**
 * Unified PostHog Tracking Types
 * 
 * Type definitions for the unified PostHog tracking system that replaces @posthog/ai.
 * All events share a single trace ID for complete correlation.
 */

import type { CoreMessage, LanguageModel } from 'ai';
import type {
  LanguageModelV2CallOptions,
  LanguageModelV3CallOptions,
  LanguageModelV2Content,
  LanguageModelV3Content,
  LanguageModelV2StreamPart,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';

// Union types for dual version support
type LanguageModelCallOptions = LanguageModelV2CallOptions | LanguageModelV3CallOptions;
type LanguageModelContent = LanguageModelV2Content | LanguageModelV3Content;
type LanguageModelStreamPart = LanguageModelV2StreamPart | LanguageModelV3StreamPart;

/**
 * PostHog input message format (replicates @posthog/ai format)
 */
export interface PostHogInput {
  role: string;
  type?: string;
  content?:
    | string
    | {
        [key: string]: any;
      };
}

/**
 * Token usage information
 */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: unknown;
  cacheReadInputTokens?: unknown;
  cacheCreationInputTokens?: unknown;
  webSearchCount?: number;
}

/**
 * Tool call information
 */
export interface ToolCall {
  toolCallId: string;
  toolName: string;
  input: string | Record<string, unknown>;
}

/**
 * Tool definition
 */
export interface Tool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/**
 * Agent Analytics Service Configuration
 * (Exported from AgentAnalyticsService.ts for convenience)
 */
export interface AgentAnalyticsConfig {
  traceId: string; // REQUIRED - unified trace ID shared across all operations
  sessionId: string;
  posthogApiKey: string;
  posthogHost?: string;
}

/**
 * STT tracking parameters
 */
export interface STTStartParams {
  sttProvider: string;
  audioDurationMs: number;
  audioBufferSize: number;
}

export interface STTCompleteParams {
  sttProvider: string;
  audioDurationMs: number;
  transcriptionDurationMs: number;
  transcriptLength: number;
  transcriptPreview: string;
}

/**
 * LLM tracking parameters
 */
export interface LLMStartParams {
  provider: string;
  model: string;
  messageCount: number;
  toolCount: number;
  systemPromptLength: number;
}

export interface LLMStreamPartParams {
  type: string;
  delta?: string;
  toolCallId?: string;
  toolName?: string;
  input?: string;
}

export interface LLMCompleteParams {
  provider: string;
  model: string;
  input: CoreMessage[];
  output: any;
  usage: TokenUsage;
  latency: number;
  toolCalls: ToolCall[];
  availableTools: Tool[];
}

export interface LLMErrorParams {
  provider: string;
  model: string;
  input: CoreMessage[];
  error: Error;
  httpStatus?: number;
}

/**
 * TTS tracking parameters
 */
export interface TTSStartParams {
  ttsProvider: string;
  ttsVoice: string;
  textLength: number;
}

export interface TTSCompleteParams {
  ttsProvider: string;
  ttsVoice: string;
  textLength: number;
  synthesisDurationMs: number;
  audioDurationSec: number;
  chunkCount: number;
}

/**
 * Context truncation parameters
 */
export interface ContextTruncationParams {
  beforeMessages: number;
  afterMessages: number;
  strategy: string;
  messagesRemoved: number;
}

/**
 * Tool call tracking parameters
 */
export interface ToolCallParams {
  toolName: string;
  args: any;
  success: boolean;
  durationMs: number;
  result?: any;
  error?: Error;
}

/**
 * Retry tracking parameters
 */
export interface RetryParams {
  attemptNumber: number;
  reason: string;
  errorMessage: string;
}

/**
 * Pipeline complete parameters
 */
export interface PipelineCompleteParams {
  sttDurationMs: number;
  llmDurationMs: number;
  ttsDurationMs: number;
  totalDurationMs: number;
  ttfsMs: number; // Time to first sound
  costs?: {
    stt: number;
    llm: number;
    tts: number;
    total: number;
  };
}

/**
 * Model wrapper options
 */
export interface ModelWrapperOptions {
  provider: string;
  model: string;
  privacyMode?: boolean;
}
