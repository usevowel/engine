/**
 * OpenAI Realtime API Protocol Types
 * 
 * TypeScript types for OpenAI's Realtime API events and data structures.
 */

/**
 * Turn Detection Configuration
 */
export interface TurnDetection {
  type: 'server_vad';
  threshold?: number;              // Speech threshold (0-1), default: 0.5
  prefix_padding_ms?: number;      // Padding before speech (ms)
  silence_duration_ms?: number;    // Min silence to detect end (ms)
  create_response?: boolean;       // Auto-generate response after speech
  interrupt_response?: boolean;    // Allow responses to be interrupted
}

/**
 * Session Configuration
 */
export interface SessionConfig {
  modalities?: string[];
  instructions?: string;
  voice?: string;
  input_audio_format?: string;
  output_audio_format?: string;
  input_audio_transcription?: {
    model?: string;
  };
  turn_detection?: TurnDetection | null;
  tools?: any[];
  tool_choice?: string;
  temperature?: number;
  max_response_output_tokens?: string | number;
  /**
   * Initial greeting prompt
   * When provided, the AI will generate an initial response based on this prompt
   */
  initial_greeting_prompt?: string;
  /**
   * Speaking rate for TTS (Inworld)
   * 1.0 = normal speed, 1.2 = 20% faster (default), 0.8 = 20% slower
   */
  speaking_rate?: number;
  /**
   * Speech mode: how AI generates spoken responses
   * 'implicit' (default): LLM text is automatically sent to TTS
   * 'explicit': Only calls to 'speak' tool are sent to TTS
   */
  speech_mode?: 'implicit' | 'explicit';
}

/**
 * Content Part Types
 */
export interface ContentPart {
  type: 'text' | 'audio' | 'input_text' | 'input_audio';
  text?: string;
  transcript?: string;
  audio?: string;
}

/**
 * Conversation Item
 */
export interface ConversationItem {
  id: string;
  type: 'message' | 'function_call' | 'function_call_output';
  status?: 'in_progress' | 'completed' | 'incomplete';
  role?: 'user' | 'assistant' | 'system';
  content?: ContentPart[];
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
  /**
   * Token counts from LLM provider (when available)
   * These are actual token counts from the provider's usage response,
   * not estimates. Used for accurate context truncation.
   */
  tokens?: {
    /** Prompt tokens (input) */
    prompt?: number;
    /** Completion tokens (output) */
    completion?: number;
    /** Total tokens */
    total?: number;
  };
}

/**
 * Client Event Types
 */
export type ClientEvent =
  | { type: 'session.update'; session: Partial<SessionConfig> }
  | { type: 'input_audio_buffer.append'; audio: string }
  | { type: 'input_audio_buffer.commit' }
  | { type: 'input_audio_buffer.clear' }
  | { type: 'conversation.item.create'; item: ConversationItem }
  | { type: 'conversation.item.retrieve'; item_id: string }
  | { type: 'conversation.item.truncate'; item_id: string; content_index?: number; audio_end_ms?: number }
  | { type: 'response.create'; response?: any }
  | { type: 'response.cancel' };

/**
 * Generate unique IDs
 */
export function generateEventId(): string {
  return `event_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function generateSessionId(): string {
  return `sess_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function generateItemId(): string {
  return `item_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function generateResponseId(): string {
  return `resp_${crypto.randomUUID().replace(/-/g, '')}`;
}
