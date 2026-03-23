/**
 * Event System Types
 * 
 * Type definitions for the event handling system used throughout the VoiceAgent engine.
 * This system tracks events, metadata, and debug information using RxJS.
 */

/**
 * Event severity levels
 */
export enum EventLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * Event categories for organizing events
 */
export enum EventCategory {
  SESSION = 'session',
  AUDIO = 'audio',
  LLM = 'llm',
  STT = 'stt',
  TTS = 'tts',
  VAD = 'vad',
  PROVIDER = 'provider',
  AUTH = 'auth',
  WEBSOCKET = 'websocket',
  PERFORMANCE = 'performance',
  DEBUG = 'debug',
  SYSTEM = 'system',
  POSTHOG = 'posthog', // PostHog adapter events (custom events)
  POSTHOG_LLM = 'posthog-llm-trace', // PostHog LLM tracing events
  RESPONSE_FILTER = 'response-filter', // Response filter service events (AI-driven deduplication)
}

/**
 * Event metadata interface
 * 
 * Contains contextual information about the event
 */
export interface EventMetadata {
  /** Session ID if applicable */
  sessionId?: string;
  /** User ID if applicable */
  userId?: string;
  /** Durable Object ID if applicable */
  durableObjectId?: string;
  /** Operation name */
  operation?: string;
  /** Duration in milliseconds */
  duration?: number;
  /** Additional custom metadata */
  [key: string]: any;
}

/**
 * Event interface
 * 
 * Represents a single event in the system
 */
export interface Event {
  /** Unique event ID */
  id: string;
  /** Event timestamp */
  timestamp: number;
  /** Event level */
  level: EventLevel;
  /** Event category */
  category: EventCategory;
  /** Event message */
  message: string;
  /** Event metadata */
  metadata?: EventMetadata;
  /** Error object if this is an error event */
  error?: Error;
  /** Tags for filtering/categorization */
  tags?: string[];
}

/**
 * Event context for creating events
 */
export interface EventContext {
  /** Event level (defaults to INFO) */
  level?: EventLevel;
  /** Event category */
  category: EventCategory;
  /** Event message */
  message: string;
  /** Event metadata */
  metadata?: EventMetadata;
  /** Error object if this is an error event */
  error?: Error;
  /** Tags for filtering/categorization */
  tags?: string[];
}
