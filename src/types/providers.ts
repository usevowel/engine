/**
 * Provider Type Definitions
 * 
 * This file contains all interface definitions for STT, TTS, and VAD providers.
 * These interfaces define the contracts that all provider implementations must follow.
 */

/**
 * Provider capabilities interface
 */
export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsVAD: boolean;
  supportsLanguageDetection: boolean;
  supportsMultipleVoices: boolean;
  requiresNetwork: boolean;
  supportsGPU: boolean;
}

/**
 * Base provider interface
 */
export interface IProvider {
  getCapabilities(): ProviderCapabilities;
}

// ============================================================================
// Speech-to-Text (STT) Interfaces
// ============================================================================

/**
 * Options for batch transcription
 */
export interface STTTranscribeOptions {
  language?: string;
  sampleRate?: number;
  channels?: number;
}

/**
 * Transcription result
 */
export interface STTResult {
  text: string;
  confidence?: number;
  language?: string;
  duration?: number;
}

/**
 * VAD event types
 */
export type VADEvent = 'speech_start' | 'speech_end';

/**
 * Language detection result from STT provider
 */
export interface LanguageDetectionResult {
  languageCode: string; // ISO 639-1 code
  confidence: number; // 0.0-1.0
  timestamp: number;
}

/**
 * Callbacks for streaming transcription
 */
export interface STTStreamCallbacks {
  onPartial?: (text: string) => void | Promise<void>;
  onFinal: (result: STTResult) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
  onVADEvent?: (event: VADEvent) => void | Promise<void>;
  onLanguageDetected?: (result: LanguageDetectionResult) => void | Promise<void>;
}

/**
 * Streaming session handle
 */
export interface STTStreamingSession {
  /**
   * Wait for the connection to be fully established (optional, for streaming providers)
   */
  waitForConnection?(): Promise<void>;
  
  /**
   * Send audio chunk to the stream
   */
  sendAudio(chunk: Uint8Array): Promise<void>;
  
  /**
   * End the stream and get final results
   */
  end(): Promise<void>;
  
  /**
   * Stop the stream immediately
   */
  stop(): Promise<void>;
  
  /**
   * Check if stream is active
   */
  isActive(): boolean;
}

/**
 * Abstract interface for Speech-to-Text providers
 */
export interface ISTTProvider extends IProvider {
  /**
   * Provider identification
   */
  readonly name: string;
  readonly type: 'streaming' | 'batch';
  
  /**
   * Initialize the STT provider
   * Called once during server startup or session creation
   */
  initialize(): Promise<void>;
  
  /**
   * Transcribe audio buffer (batch mode)
   * Used for non-streaming providers like Groq Whisper
   * 
   * @param audioBuffer - PCM16 audio data
   * @param options - Transcription options
   * @returns Transcription result
   */
  transcribe(
    audioBuffer: Uint8Array,
    options?: STTTranscribeOptions
  ): Promise<STTResult>;
  
  /**
   * Start streaming transcription (streaming mode)
   * Used for streaming providers like Fennec ASR
   * 
   * @param callbacks - Event callbacks for streaming results
   * @param tokenTurnDetection - Optional turn detection config from token (AssemblyAI only)
   * @param languageDetectionEnabled - Whether language detection is enabled (AssemblyAI only)
   * @returns StreamingSession handle
   */
  startStream(
    callbacks: STTStreamCallbacks,
    tokenTurnDetection?: any,
    languageDetectionEnabled?: boolean
  ): Promise<STTStreamingSession>;
  
  /**
   * Check if provider is ready
   */
  isReady(): boolean;
  
  /**
   * Clean up resources
   */
  dispose(): Promise<void>;
}

// ============================================================================
// Text-to-Speech (TTS) Interfaces
// ============================================================================

/**
 * Options for speech synthesis
 */
export interface TTSSynthesizeOptions {
  voice?: string;
  speed?: number;
  pitch?: number;
  volume?: number;
  sampleRate?: number;
  speakingRate?: number; // Inworld TTS speaking rate (1.0 = normal, 1.2 = 20% faster)
  format?: 'pcm16' | 'pcm24' | 'float32';
  // Analytics tracking
  sessionId?: string;
  sessionKey?: string;
  connectionParadigm?: string;
  traceId?: string; // Unified trace ID for agent analytics
}

/**
 * Abstract interface for Text-to-Speech providers
 */
export interface ITTSProvider extends IProvider {
  /**
   * Provider identification
   */
  readonly name: string;
  readonly type: 'streaming' | 'batch';
  
  /**
   * Initialize the TTS provider
   */
  initialize(): Promise<void>;
  
  /**
   * Synthesize speech from text (batch mode)
   * Returns complete audio buffer
   * 
   * @param text - Text to synthesize
   * @param options - Synthesis options
   * @returns PCM16 audio data
   */
  synthesize(
    text: string,
    options?: TTSSynthesizeOptions
  ): Promise<Uint8Array>;
  
  /**
   * Synthesize speech with streaming output
   * Yields audio chunks as they're generated
   * 
   * @param text - Text to synthesize
   * @param options - Synthesis options
   * @returns AsyncIterator of audio chunks
   */
  synthesizeStream(
    text: string,
    options?: TTSSynthesizeOptions
  ): AsyncIterableIterator<Uint8Array>;
  
  /**
   * Get the sample rate of generated audio
   */
  getSampleRate(): number;
  
  /**
   * Get list of available voices
   */
  getAvailableVoices(): Promise<string[]>;
  
  /**
   * Check if provider is ready
   */
  isReady(): boolean;
  
  /**
   * Clean up resources
   */
  dispose(): Promise<void>;
}

// ============================================================================
// Voice Activity Detection (VAD) Interfaces
// ============================================================================

/**
 * VAD configuration
 */
export interface VADConfig {
  threshold: number;              // Speech probability threshold (0-1)
  minSilenceDurationMs: number;   // Minimum silence to detect speech end
  speechPadMs: number;            // Padding around speech segments
  sampleRate: number;             // Expected audio sample rate
}

/**
 * VAD state
 */
export interface VADState {
  isSpeaking: boolean;
  speechStartMs: number | null;
  speechEndMs: number | null;
  lastSpeechProbability: number;
}

/**
 * Abstract interface for Voice Activity Detection providers
 */
export interface IVADProvider extends IProvider {
  /**
   * Provider identification
   */
  readonly name: string;
  readonly mode: 'local' | 'remote' | 'integrated';
  
  /**
   * Initialize the VAD provider
   */
  initialize(): Promise<void>;
  
  /**
   * Process audio chunk and detect speech
   * 
   * @param audioChunk - Float32Array audio samples (16kHz recommended)
   * @param timestampMs - Current timestamp in milliseconds
   * @returns VAD event or null
   */
  detectSpeech(
    audioChunk: Float32Array,
    timestampMs: number
  ): Promise<VADEvent | null>;
  
  /**
   * Get current VAD state
   */
  getState(): VADState;
  
  /**
   * Reset VAD state
   */
  resetState(): Promise<void>;
  
  /**
   * Update VAD configuration
   */
  updateConfig(config: Partial<VADConfig>): void;
  
  /**
   * Check if provider is ready
   */
  isReady(): boolean;
  
  /**
   * Clean up resources
   */
  dispose(): Promise<void>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base provider error
 */
export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: string,
    message: string,
    public readonly cause?: Error
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
  }
}

/**
 * Provider initialization error
 */
export class ProviderInitError extends ProviderError {
  constructor(provider: string, message: string, cause?: Error) {
    super(provider, 'INIT_ERROR', message, cause);
    this.name = 'ProviderInitError';
  }
}

/**
 * Provider network error
 */
export class ProviderNetworkError extends ProviderError {
  constructor(provider: string, message: string, cause?: Error) {
    super(provider, 'NETWORK_ERROR', message, cause);
    this.name = 'ProviderNetworkError';
  }
}

/**
 * Provider quota/rate limit error
 */
export class ProviderQuotaError extends ProviderError {
  constructor(provider: string, message: string, cause?: Error) {
    super(provider, 'QUOTA_ERROR', message, cause);
    this.name = 'ProviderQuotaError';
  }
}

