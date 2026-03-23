/**
 * Shared analytics typing used by package adapters.
 */

export type AnalyticsLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AnalyticsEvent {
  category: string;
  message: string;
  level: AnalyticsLevel;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface LLMAnalyticsParams {
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  error?: Error;
}

export interface STTAnalyticsParams {
  provider: string;
  audioDurationMs: number;
  transcriptionDurationMs?: number;
  transcriptLength?: number;
}

export interface TTSAnalyticsParams {
  provider: string;
  voice: string;
  textLength: number;
  synthesisDurationMs?: number;
  audioDurationSec?: number;
}

export interface PipelineAnalyticsParams {
  sttDurationMs: number;
  llmDurationMs: number;
  ttsDurationMs: number;
  totalDurationMs: number;
  ttfsMs: number;
}

export interface IAnalytics {
  track(event: AnalyticsEvent): void;
  trackLLM(params: LLMAnalyticsParams): void;
  trackSTT(params: STTAnalyticsParams): void;
  trackTTS(params: TTSAnalyticsParams): void;
  trackPipeline(params: PipelineAnalyticsParams): void;
  startTrace(traceId: string, metadata?: Record<string, unknown>): void;
  endTrace(traceId: string, metadata?: Record<string, unknown>): void;
  debug(category: string, message: string, metadata?: Record<string, unknown>): void;
  info(category: string, message: string, metadata?: Record<string, unknown>): void;
  warn(category: string, message: string, metadata?: Record<string, unknown>): void;
  error(category: string, message: string, error?: Error, metadata?: Record<string, unknown>): void;
}
