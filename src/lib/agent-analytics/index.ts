/**
 * Agent Analytics Service
 * 
 * Standalone service for tracking agent operations (STT → LLM → TTS) in a single unified trace.
 * Completely independent from event emitter system. All events share the same trace ID.
 * 
 * Complete replacement for @posthog/ai for agent traces.
 * 
 * @module agent-analytics
 */

export { AgentAnalyticsService } from './AgentAnalyticsService';
export type { AgentAnalyticsConfig } from './AgentAnalyticsService';
export { wrapModelWithAnalytics, isV2Model, isV3Model } from './model-wrapper';
export {
  getOrCreateService,
  getServiceForTrace,
  removeService,
  clearAllServices,
} from './service-registry';
export {
  setAgentAnalyticsImplementation,
  clearAgentAnalyticsImplementation,
  getAgentAnalyticsImplementation,
} from './implementation';
export type {
  AgentAnalyticsImplementation,
  AgentAnalyticsServiceLike,
  AgentAnalyticsCreateOptions,
  AgentAnalyticsPostHogConfig,
} from './implementation';
export * from './types';
export * from './utils';
