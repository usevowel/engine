/**
 * Agent Analytics Service
 *
 * OSS keeps a neutral no-op implementation so shared agent code can call
 * analytics hooks without depending on PostHog. Hosted can register a real
 * implementation at runtime.
 *
 * @module AgentAnalyticsService
 */

import type {
  AgentAnalyticsConfig,
  ContextTruncationParams,
  LLMCompleteParams,
  LLMErrorParams,
  LLMStartParams,
  LLMStreamPartParams,
  PipelineCompleteParams,
  RetryParams,
  STTCompleteParams,
  STTStartParams,
  TTSCompleteParams,
  TTSStartParams,
  ToolCallParams,
} from './types';
import type { AgentAnalyticsServiceLike } from './implementation';

export type { AgentAnalyticsConfig } from './types';

export class AgentAnalyticsService implements AgentAnalyticsServiceLike {
  private readonly traceId: string;

  constructor(config: AgentAnalyticsConfig) {
    this.traceId = config.traceId;
  }

  startTrace(_params: { spanName?: string; inputState?: unknown } = {}): void {}

  endTrace(
    _params: { outputState?: unknown; isError?: boolean; error?: unknown } = {}
  ): void {}

  getTraceId(): string {
    return this.traceId;
  }

  trackSTTStart(_params: STTStartParams): void {}

  trackSTTComplete(_params: STTCompleteParams): void {}

  trackLLMStart(_params: LLMStartParams): void {}

  trackLLMStreamPart(_part: LLMStreamPartParams): void {}

  trackLLMComplete(_params: LLMCompleteParams): void {}

  trackLLMError(_params: LLMErrorParams): void {}

  trackTTSStart(_params: TTSStartParams): void {}

  trackTTSComplete(_params: TTSCompleteParams): void {}

  trackContextTruncation(_params: ContextTruncationParams): void {}

  trackToolCall(_params: ToolCallParams): void {}

  trackRetry(_params: RetryParams): void {}

  trackPipelineComplete(_params: PipelineCompleteParams): void {}
}
