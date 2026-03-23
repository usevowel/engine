import type { LanguageModel } from 'ai';
import type {
  ContextTruncationParams,
  LLMCompleteParams,
  LLMErrorParams,
  LLMStartParams,
  LLMStreamPartParams,
  ModelWrapperOptions,
  PipelineCompleteParams,
  RetryParams,
  STTCompleteParams,
  STTStartParams,
  TTSCompleteParams,
  TTSStartParams,
  ToolCallParams,
} from './types';

export interface AgentAnalyticsServiceLike {
  startTrace(params?: { spanName?: string; inputState?: unknown }): void;
  endTrace(params?: { outputState?: unknown; isError?: boolean; error?: unknown }): void;
  getTraceId(): string;
  trackSTTStart(params: STTStartParams): void;
  trackSTTComplete(params: STTCompleteParams): void;
  trackLLMStart(params: LLMStartParams): void;
  trackLLMStreamPart(part: LLMStreamPartParams): void;
  trackLLMComplete(params: LLMCompleteParams): void;
  trackLLMError(params: LLMErrorParams): void;
  trackTTSStart(params: TTSStartParams): void;
  trackTTSComplete(params: TTSCompleteParams): void;
  trackContextTruncation(params: ContextTruncationParams): void;
  trackToolCall(params: ToolCallParams): void;
  trackRetry(params: RetryParams): void;
  trackPipelineComplete(params: PipelineCompleteParams): void;
}

export interface AgentAnalyticsPostHogConfig {
  apiKey: string;
  host?: string;
}

export interface AgentAnalyticsCreateOptions {
  startTrace?: boolean;
  spanName?: string;
  inputState?: unknown;
}

export interface AgentAnalyticsImplementation {
  getOrCreateService(
    traceId: string,
    sessionId: string,
    posthogConfig: AgentAnalyticsPostHogConfig,
    options?: AgentAnalyticsCreateOptions
  ): AgentAnalyticsServiceLike;
  getServiceForTrace(traceId: string): AgentAnalyticsServiceLike | undefined;
  removeService(traceId: string): void;
  clearAllServices(): void;
  wrapModelWithAnalytics<T extends LanguageModel>(
    model: T,
    service: AgentAnalyticsServiceLike,
    options: ModelWrapperOptions
  ): T;
}

let agentAnalyticsImplementation: AgentAnalyticsImplementation | null = null;

export function setAgentAnalyticsImplementation(
  implementation: AgentAnalyticsImplementation
): void {
  agentAnalyticsImplementation = implementation;
}

export function clearAgentAnalyticsImplementation(): void {
  agentAnalyticsImplementation = null;
}

export function getAgentAnalyticsImplementation(): AgentAnalyticsImplementation | null {
  return agentAnalyticsImplementation;
}
