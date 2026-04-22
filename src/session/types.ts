/**
 * Session Types
 * 
 * Type definitions for WebSocket session handling.
 */

import type { SessionConfig, ConversationItem } from '../lib/protocol';
import type { SessionProviders } from './SessionManager';
import type { STTStreamingSession } from '../types/providers';
import type { RuntimeConfig } from '../config/RuntimeConfig';
import type { SoundbirdAgent } from '../services/agent-provider';
import type { ILLMAgent } from '../services/agents';
import type { SessionTurnTracker } from './turn-tracker';

/**
 * Latency metrics for a single response
 */
export interface ResponseLatencyMetrics {
  responseId: string;
  timestamp: number;
  asrDuration?: number;
  ttfs?: number; // Time to first sound (user speech end → first AI audio sent)
  llmFirstToken?: number; // Time to first LLM token
  llmDuration?: number; // Total LLM stream duration
  llmTokenCount?: number; // Actual token count from provider
  tokensPerSecond?: number; // Tokens per second
  ttsChunks?: Array<{ duration: number; text: string }>; // TTS synthesis times
  totalDuration?: number; // Total response time
}

/**
 * Session data stored in WebSocket connection
 */
export interface SessionData {
  sessionId: string;
  model: string;
  config: SessionConfig;
  audioBuffer: Uint8Array | null;
  conversationHistory: ConversationItem[];
  currentResponseId: string | null;
  vadEnabled: boolean;
  audioBufferStartMs: number;
  totalAudioMs: number;
  lastVadLogTime?: number;
  lastAsrDuration?: number;
  speechEndTime?: number; // Track when VAD detected speech end
  providers?: SessionProviders; // Provider instances
  sttStream?: STTStreamingSession; // Active STT streaming session
  sttStreamInitializing?: boolean; // Lock flag to prevent duplicate STT connections (race condition protection)
  sttConnectionWarningLogged?: boolean; // Track if we've logged the connection warning
  smallChunkWarningLogged?: boolean; // Track if we've logged small chunk warning
  runtimeConfig?: RuntimeConfig; // Runtime configuration (required for Workers)
  // Call duration tracking
  connectionStartTime?: number; // Timestamp when connection was established
  lastSpeechTime?: number; // Timestamp of last detected speech
  maxCallDurationMs?: number; // Maximum call duration in milliseconds (from token)
  maxIdleDurationMs?: number; // Maximum idle duration in milliseconds (from token)
  durationCheckInterval?: Timer; // Interval timer for checking durations
  // Latency tracking (stored in-memory, fetched on-demand)
  latencyMetrics?: {
    currentResponse?: ResponseLatencyMetrics;
    historical?: ResponseLatencyMetrics[]; // Keep last N responses
  };
  // Agent Mode (NEW)
  useAgentMode?: boolean; // Feature flag to enable Agent mode
  agent?: SoundbirdAgent; // Legacy agent instance (deprecated)
  newAgent?: ILLMAgent; // New modular agent instance (via AgentFactory)
  agentType?: 'vercel-sdk' | 'custom'; // Agent type to use (default: 'vercel-sdk')
  agentConfig?: { // Agent configuration from token (test mode only)
    maxSteps: number;
    maxContextMessages: number;
    temperature?: number; // undefined = use provider defaults
    maxTokens?: number; // undefined = use provider defaults
    frequencyPenalty?: number; // 0.0-2.0, reduces repetition by frequency
    presencePenalty?: number; // 0.0-2.0, reduces repetition by presence
    repetitionPenalty?: number; // 0.0-2.0, OpenRouter-specific repetition penalty
  };
  // Repetition detection
  detectedRepetition?: boolean; // Flag to warn LLM about repetition in next turn
  // Turn Detection Configuration (from token)
  tokenTurnDetection?: 'aggressive' | 'balanced' | 'conservative' | {
    endOfTurnConfidenceThreshold?: number;
    minEndOfTurnSilenceWhenConfident?: number;
    maxTurnSilence?: number;
  };
  // Session Key (for sidecar/developer-managed connections)
  sessionKey?: string; // Session key for correlating multiple connections (sidecar pattern)
  // Agent Analytics (PostHog tracking)
  currentTraceId?: string; // Unified trace ID for agent analytics (uses session ID)
  posthogConfig?: { // PostHog configuration for agent analytics
    apiKey: string;
    host?: string;
    enabled?: boolean;
  };
  // Acknowledgement and Typing Sound Services
  acknowledgementService?: any; // AcknowledgementResponseService instance
  typingSoundService?: any; // TypingSoundService instance
  // Language Detection and State
  language?: {
    current: string | null; // Current effective language (detected or configured)
    detected: string | null; // Detected language from STT
    configured: string | null; // Configured language from token
    detectionEnabled: boolean; // Whether language detection is enabled
  };
  languageDetectionService?: any; // LanguageDetectionService instance
  // Language voice preferences
  initialVoice?: string; // Voice selected when the session started or was explicitly configured
  languageVoiceMap?: Record<string, string>; // Preferred voices per language from token config
  lastVoicePerLanguage?: Record<string, string>; // Last used voice per language (runtime tracking)
  // Groq reasoning effort (from env or token)
  groqReasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'default';
  // Optional runtime-owned turn lifecycle tracker
  turnTracker?: SessionTurnTracker;
  // Subagent configuration
  subagentToolInstructions?: string; // Parsed tool instructions for subagent (from instruction parser)
  // Subagent tool tracking (blackbox - not in conversation history)
  subagentToolResults?: Map<string, any>; // Map of toolCallId -> result for subagent tool calls (deprecated - use event bus)
  subagentId?: string; // Current subagent ID (for event bus routing)
  subagentEventSubscriber?: any; // AgentEventSubscriber instance (reused across tool calls)
  // Tool call agent mapping (for event bus routing)
  toolCallAgentMap?: Map<string, string>; // Map of toolCallId -> agentId for routing tool results
  // Subagent execution state (prevents response.create during subagent execution)
  subagentExecuting?: boolean; // True when subagent is actively executing
  // Set of subagent tool call IDs that have received outputs but haven't had their response.create ignored yet
  // When response.create arrives, if this set is non-empty, we ignore it and clear the set
  // This prevents the automatic response.create from OpenAI Agents SDK after function_call_output
  pendingSubagentToolOutputs?: Set<string>; // Set of toolCallIds waiting for response.create ignore
  // Tool call retry tracking
  toolRetryCount?: number; // Current retry count for tool validation errors (resets after successful response)
  lastToolError?: {
    errorMessage: string;
    errorType: string;
    timestamp: number;
  }; // Last tool validation error for retry context
  // Empty response retry tracking (when server tool called but no text generated)
  emptyResponseRetryCount?: number; // Current retry count for empty responses after server tool calls
  // Initial greeting tracking (prevents duplicate greetings after DO hibernation)
  initialGreetingTriggered?: boolean; // True if initial greeting has been triggered (prevents duplicates)
  greetingInProgress?: boolean; // True if greeting generation is currently in progress (guards hibernation race condition)
  // Source of truth for session configuration (stores last session.update event)
  lastSessionUpdate?: any; // Last session.update event received - used to rebuild config on restore
  // Hibernation state tracking
  hibernated?: boolean; // True when session is hibernated (STT paused, waiting for wake signal)
  hibernationStartTime?: number; // Timestamp when hibernation started
  silenceStartTime?: number; // Timestamp when silence was first detected (for hibernation trigger)
  hibernationConfig?: {
    enabled: boolean;
    silenceThresholdMs: number; // Time of silence before hibernating (default: 30000ms = 30s)
  };
}
