/**
 * Shared Token Generation Module
 * 
 * This module provides token generation functionality that works in both:
 * - Bun runtime (main server)
 * - Cloudflare Workers (Durable Objects)
 * 
 * Uses jose library for JWT operations, which works in both environments.
 */

import { SignJWT, jwtVerify } from 'jose';

import { getEventSystem, EventCategory } from '../events';
/**
 * LLM Provider Configuration
 */
export interface LLMProviderConfig {
  llmProvider?: 'groq' | 'openrouter' | 'openai-compatible';
  openrouterProvider?: string;
  openrouterSiteUrl?: string;
  openrouterAppName?: string;
}

/**
 * Agent Configuration (test mode only)
 */
export interface AgentConfig {
  testMode?: boolean;
  provider?: string;
  maxSteps?: number;
  maxContextMessages?: number;
  temperature?: number;
  maxTokens?: number;
  /** Frequency penalty (0.0-2.0) - reduces repetition by penalizing tokens based on frequency */
  frequencyPenalty?: number;
  /** Presence penalty (0.0-2.0) - reduces repetition by penalizing tokens that have appeared */
  presencePenalty?: number;
  /** Repetition penalty (0.0-2.0) - OpenRouter-specific, reduces repetition of tokens from input */
  repetitionPenalty?: number;
}

/**
 * Turn Detection Configuration
 */
export type TurnDetectionConfig = 
  // Turn detection presets
  | 'aggressive' | 'balanced' | 'conservative' 
  // Custom turn detection config
  | {
      endOfTurnConfidenceThreshold?: number;
      minEndOfTurnSilenceWhenConfident?: number;
      maxTurnSilence?: number;
    }
  // Client-side VAD mode (disables streaming STT, uses batch transcription)
  | {
      mode: 'client_vad' | 'disabled';
      type?: 'disabled'; // Alternative format from client SDK
    }
  // Null explicitly disables server-side VAD
  | null;

/**
 * Language Detection Configuration
 */
export interface LanguageDetectionConfig {
  /** Enable automatic language detection (default: true) */
  enabled?: boolean;
  /** Minimum confidence threshold for language switch (0.0-1.0, default: 0.8) */
  confidenceThreshold?: number;
  /** Minimum consecutive detections before switching (default: 2) */
  minConsecutiveDetections?: number;
}

/**
 * Provider Configuration
 * Allows runtime selection of STT, TTS, and VAD providers
 */
export interface ProviderConfig {
  /** STT provider selection */
  stt?: {
    provider?: string;
    /** Provider-specific configuration (validated by ProviderRegistry at runtime) */
    config?: Record<string, unknown>;
  };
  /** VAD provider selection (auto-set based on STT provider if not specified) */
  vad?: {
    provider?: string;
    /** Provider-specific configuration */
    config?: Record<string, unknown>;
  };
  /** TTS provider selection */
  tts?: {
    provider?: string;
    /** Provider-specific configuration */
    config?: Record<string, unknown>;
  };
}

/**
 * Token Generation Options
 * 
 * Flexible configuration object for token generation.
 * This approach is maintainable and eliminates positional parameter bugs.
 */
export interface TokenGenerationOptions {
  /** Token expiration time in milliseconds (default: 5 minutes) */
  expiresInMs?: number;
  
  /** Model preference to embed in token */
  model?: string;
  
  /** Voice preference to embed in token */
  voice?: string;

  preset?: string;
  
  /** Speaking rate for TTS (1.0 = normal, 1.2 = 20% faster, default: 1.2) */
  speakingRate?: number;
  
  /** Initial greeting prompt for the AI */
  initialGreetingPrompt?: string;
  
  /** System prompt/instructions for the AI (used for initial greeting before session.update) */
  instructions?: string;
  
  /** Maximum call duration in milliseconds */
  maxCallDurationMs?: number;
  
  /** Maximum idle duration in milliseconds */
  maxIdleDurationMs?: number;
  
  /** LLM provider configuration */
  llmProvider?: 'groq' | 'openrouter' | 'openai-compatible';
  openrouterProvider?: string;
  openrouterSiteUrl?: string;
  openrouterAppName?: string;
  
  /** Agent Mode configuration (test mode only) */
  agentConfig?: AgentConfig;
  
  /** Turn Detection configuration (AssemblyAI) */
  turnDetection?: TurnDetectionConfig;
  
  /** Language preference (ISO 639-1 code, e.g., "en", "es", "fr") */
  language?: string;
  
  /** Language detection configuration */
  languageDetection?: LanguageDetectionConfig;
  
  /** Preferred voices per language (e.g., { "es": "Lupita", "fr": "Hélène" }) */
  languageVoiceMap?: Record<string, string>;
  
  /** Session key for correlating multiple connections (sidecar pattern) - format: sesskey_{32_hex} */
  sessionKey?: string;
  
  /** Session ID - if not provided, will be auto-generated as UUID */
  sessionId?: string;
  
  /** Provider configuration for STT, TTS, and VAD */
  providerConfig?: ProviderConfig;

  /**
   * STT override embedded in the JWT. Supports a flat shape from dev clients, or
   * `{ provider, config }` as produced by self-hosted Core (`buildSpeechProviderConfig`).
   */
  stt?: { provider: string; config?: Record<string, unknown> } & Record<string, unknown>;
  /**
   * TTS override embedded in the JWT. Same shape options as `stt`.
   */
  tts?: { provider: string; config?: Record<string, unknown> } & Record<string, unknown>;
}

/**
 * Token Payload Interface
 */
export interface TokenPayload {
  sub: string; // Session ID (auto-generated UUID if not provided)
  preset?: string;
  model?: string;
  voice?: string;
  speakingRate?: number; // Speaking rate for TTS (1.0 = normal, 1.2 = 20% faster, default: 1.2)
  initialGreetingPrompt?: string; // Initial greeting prompt for the AI
  instructions?: string; // System prompt/instructions for the AI (used for initial greeting before session.update)
  maxCallDurationMs?: number;
  maxIdleDurationMs?: number;
  
  // LLM Provider Configuration
  llmProvider?: 'groq' | 'openrouter' | 'openai-compatible';
  openrouterProvider?: string;
  openrouterSiteUrl?: string;
  openrouterAppName?: string;
  
  // Agent Mode Configuration (test mode only)
  testMode?: boolean;
  agentMaxSteps?: number;
  agentMaxContextMessages?: number;
  agentTemperature?: number;
  agentMaxTokens?: number;
  agentFrequencyPenalty?: number;
  agentPresencePenalty?: number;
  agentRepetitionPenalty?: number; // OpenRouter-specific repetition penalty
  
  // Turn Detection Configuration (AssemblyAI)
  turnDetection?: TurnDetectionConfig;
  
  // Language Configuration
  language?: string; // ISO 639-1 language code (e.g., "en", "es", "fr")
  languageDetection?: LanguageDetectionConfig;
  languageVoiceMap?: Record<string, string>; // Preferred voices per language
  
  // Session Key for correlating multiple connections (sidecar pattern)
  // Format: sesskey_{32_hex_characters}
  sessionKey?: string;
  
  // Provider Configuration
  providerConfig?: ProviderConfig;

  stt?: { provider: string; config?: Record<string, unknown> } & Record<string, unknown>;
  tts?: { provider: string; config?: Record<string, unknown> } & Record<string, unknown>;
  
  // JWT standard fields
  iat: number;
  exp: number;
  jti: string;
}

/**
 * Generate an ephemeral JWT token with optional configuration
 * 
 * NEW: Uses object-based configuration for maintainability and type safety.
 * This eliminates positional parameter bugs and makes future schema changes easy.
 * 
 * @param secret JWT secret key (string or Uint8Array)
 * @param options Token generation options (all optional except what you need)
 * @returns Token string with 'ek_' prefix
 * 
 * @example
 * ```typescript
 * const token = await generateEphemeralToken(secret, {
 *   model: 'moonshotai/kimi-k2-instruct-0905',
 *   voice: 'Ashley',
 *   speakingRate: 1.2,
 *   maxCallDurationMs: 1800000,
 *   llmProvider: 'openrouter',
 *   openrouterProvider: 'anthropic'
 * });
 * ```
 */
export async function generateEphemeralToken(
  secret: string | Uint8Array,
  options: TokenGenerationOptions = {}
): Promise<string> {
  const jti = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresInMs = options.expiresInMs ?? 300000; // 5 minutes default
  
  // Auto-generate session ID if not provided
  // Session ID is used for PostHog correlation and session tracking
  const sessionId = options.sessionId || crypto.randomUUID();
  
  // Build payload - use generated sessionId as subject
  const payload: Record<string, any> = { sub: sessionId };
  
  // Include sessionKey if provided (for sidecar/developer-managed paradigms)
  // SessionKey format: sesskey_{32_hex_characters}
  if (options.sessionKey) {
    payload.sessionKey = options.sessionKey;
  }
  
  // Basic session configuration
  if (options.model) payload.model = options.model;
  if (options.voice) payload.voice = options.voice;
  if (options.preset) payload.preset = options.preset;
  if (options.speakingRate !== undefined) payload.speakingRate = options.speakingRate;
  if (options.initialGreetingPrompt) payload.initialGreetingPrompt = options.initialGreetingPrompt;
  if (options.instructions) payload.instructions = options.instructions;
  if (options.maxCallDurationMs) payload.maxCallDurationMs = options.maxCallDurationMs;
  if (options.maxIdleDurationMs) payload.maxIdleDurationMs = options.maxIdleDurationMs;
  
  // LLM provider configuration
  if (options.llmProvider) payload.llmProvider = options.llmProvider;
  if (options.openrouterProvider) payload.openrouterProvider = options.openrouterProvider;
  if (options.openrouterSiteUrl) payload.openrouterSiteUrl = options.openrouterSiteUrl;
  if (options.openrouterAppName) payload.openrouterAppName = options.openrouterAppName;
  
  // Agent Mode configuration (only if testMode is explicitly enabled)
  if (options.agentConfig?.testMode) {
    payload.testMode = true;
    if (options.agentConfig.maxSteps !== undefined) payload.agentMaxSteps = options.agentConfig.maxSteps;
    if (options.agentConfig.maxContextMessages !== undefined) payload.agentMaxContextMessages = options.agentConfig.maxContextMessages;
    if (options.agentConfig.temperature !== undefined) payload.agentTemperature = options.agentConfig.temperature;
    if (options.agentConfig.maxTokens !== undefined) payload.agentMaxTokens = options.agentConfig.maxTokens;
    if (options.agentConfig.frequencyPenalty !== undefined) payload.agentFrequencyPenalty = options.agentConfig.frequencyPenalty;
    if (options.agentConfig.presencePenalty !== undefined) payload.agentPresencePenalty = options.agentConfig.presencePenalty;
    if (options.agentConfig.repetitionPenalty !== undefined) payload.agentRepetitionPenalty = options.agentConfig.repetitionPenalty;
  }
  
  // Turn Detection configuration (AssemblyAI)
  if (options.turnDetection) {
    payload.turnDetection = options.turnDetection;
  }
  
  // Language configuration
  if (options.language) payload.language = options.language;
  if (options.languageDetection) payload.languageDetection = options.languageDetection;
  if (options.languageVoiceMap) payload.languageVoiceMap = options.languageVoiceMap;
  
  // Provider configuration
  if (options.providerConfig) payload.providerConfig = options.providerConfig;

  if (options.stt) payload.stt = options.stt;
  if (options.tts) payload.tts = options.tts;
  
  // Pass through ALL additional options as custom claims (even unsupported ones)
  // This ensures forward compatibility - any custom params make it through to the token
  const knownKeys = ['expiresInMs', 'preset', 'model', 'voice', 'speakingRate', 'initialGreetingPrompt', 'instructions', 'maxCallDurationMs', 'maxIdleDurationMs', 'llmProvider', 'openrouterProvider', 'openrouterSiteUrl', 'openrouterAppName', 'agentConfig', 'turnDetection', 'language', 'languageDetection', 'languageVoiceMap', 'sessionKey', 'sessionId', 'providerConfig', 'stt', 'tts'];
  for (const [key, value] of Object.entries(options)) {
    if (!knownKeys.includes(key) && value !== undefined) {
      payload[key] = value;
    }
  }
  
  // Convert secret to Uint8Array if it's a string
  const secretKey = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
  
  // Create JWT using jose
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + Math.floor(expiresInMs / 1000))
    .setJti(jti)
    .sign(secretKey);
  
  // Add 'ek_' prefix for OpenAI SDK compatibility
  return `ek_${jwt}`;
}

/**
 * Generate and verify an ephemeral token (with logging)
 * 
 * NEW: Uses object-based configuration for maintainability.
 * 
 * This is a convenience wrapper that generates a token and immediately verifies it,
 * logging the payload for debugging purposes.
 * 
 * @param secret JWT secret key (string or Uint8Array)
 * @param options Token generation options (all optional)
 * @returns Token string with 'ek_' prefix
 * 
 * @example
 * ```typescript
 * const token = await generateAndVerifyToken(secret, {
 *   model: 'moonshotai/kimi-k2-instruct-0905',
 *   voice: 'Ashley',
 *   speakingRate: 1.2,
 *   initialGreetingPrompt: 'Hello! How can I help you today?',
 *   maxCallDurationMs: 1800000
 * });
 * ```
 */
export async function generateAndVerifyToken(
  secret: string | Uint8Array,
  options: TokenGenerationOptions = {}
): Promise<string> {
  const fullToken = await generateEphemeralToken(secret, options);
  
  // Extract JWT part for verification
  const jwt = fullToken.startsWith('ek_') ? fullToken.slice(3) : fullToken;
  
  // Verify the token immediately
  try {
    const secretKey = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
    const { payload: verified } = await jwtVerify(jwt, secretKey, {
      algorithms: ['HS256'],
    });
    
    getEventSystem().info(EventCategory.AUTH, '🔐 [Token] Generated new token:');
    getEventSystem().info(EventCategory.AUTH, '   Full token (with prefix):', fullToken.substring(0, 20) + '...');
    getEventSystem().info(EventCategory.AUTH, '   JWT part (for decoders):', jwt.substring(0, 50) + '...');
    getEventSystem().info(EventCategory.AUTH, '   ✅ Token verified successfully');
    getEventSystem().info(EventCategory.AUTH, '   Payload:', JSON.stringify(verified, null, 2));
    getEventSystem().info(EventCategory.AUTH, '   Expires:', new Date((verified.exp as number) * 1000).toISOString());
    getEventSystem().info(EventCategory.AUTH, '   Note: To decode in online JWT decoders, remove the "ek_" prefix first');
  } catch (error) {
    getEventSystem().error(EventCategory.AUTH, '   ❌ Token verification FAILED:', error);
    throw new Error('Generated token is invalid - this should never happen!');
  }
  
  return fullToken;
}
