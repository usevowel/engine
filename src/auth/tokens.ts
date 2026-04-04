/**
 * Ephemeral Token Authentication
 * 
 * JWT-based ephemeral tokens for secure WebSocket authentication.
 * Tokens are prefixed with 'ek_' to match OpenAI's format.
 */

import { jwtVerify } from 'jose';
import { config } from '../config/env';
import { type SupportedProvider } from '../services/providers/llm';
import { 
  generateAndVerifyToken as sharedGenerateAndVerifyToken,
  type TokenGenerationOptions,
  type AgentConfig as SharedAgentConfig,
  type TokenPayload as SharedTokenPayload
} from './token-generator';

export interface TokenPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
  preset?: string;
  model?: string; // Model requested during token creation
  voice?: string; // Voice requested during token creation
  speakingRate?: number; // Speaking rate for TTS (1.0 = normal, 1.2 = 20% faster, default: 1.2)
  initialGreetingPrompt?: string; // Initial greeting prompt for the AI
  instructions?: string; // System prompt/instructions for the AI (used for initial greeting before session.update)
  maxCallDurationMs?: number; // Maximum call duration in milliseconds (default: 30 minutes)
  maxIdleDurationMs?: number; // Maximum idle duration in milliseconds (default: 3 minutes)
  // LLM Provider Configuration (Client-specified)
  llmProvider?: 'groq' | 'openrouter' | 'openai-compatible'; // LLM provider override (e.g., "groq", "openrouter", "openai-compatible")
  openrouterProvider?: string; // OpenRouter provider selection (e.g., "anthropic", "openai", "google")
  openrouterSiteUrl?: string; // OpenRouter site URL for analytics
  openrouterAppName?: string; // OpenRouter app name for analytics
  // Agent Mode Configuration (Test Mode Only)
  // TODO: In production, use presets instead of allowing arbitrary configuration
  agentProvider?: SupportedProvider; // LLM provider (test mode only, from registry)
  agentMaxSteps?: number; // Maximum reasoning steps for Agent (default: 3)
  agentMaxContextMessages?: number; // Maximum context messages (sliding window, default: 15)
  agentTemperature?: number; // LLM temperature (default: undefined = provider optimized)
  agentMaxTokens?: number; // Maximum tokens per response (default: undefined = provider optimized)
  agentFrequencyPenalty?: number; // Frequency penalty 0.0-2.0 (reduces repetition)
  agentPresencePenalty?: number; // Presence penalty 0.0-2.0 (reduces repetition)
  agentRepetitionPenalty?: number; // Repetition penalty 0.0-2.0 (OpenRouter-specific, reduces repetition)
  testMode?: boolean; // Allow custom agent config (default: false, only for testing)
  // Turn Detection Configuration (AssemblyAI)
  // Presets: 'aggressive', 'balanced' (default), 'conservative'
  // Or custom configuration for advanced use cases
  turnDetection?: 'aggressive' | 'balanced' | 'conservative' | {
    endOfTurnConfidenceThreshold?: number; // 0-1, default varies by preset
    minEndOfTurnSilenceWhenConfident?: number; // milliseconds, default varies by preset
    maxTurnSilence?: number; // milliseconds, default varies by preset
  };
  // Language Configuration
  language?: string; // ISO 639-1 language code (e.g., "en", "es", "fr")
  languageDetection?: {
    enabled?: boolean; // Enable automatic language detection (default: true)
    confidenceThreshold?: number; // Minimum confidence threshold for language switch (0.0-1.0, default: 0.8)
    minConsecutiveDetections?: number; // Minimum consecutive detections before switching (default: 2)
  };
  languageVoiceMap?: Record<string, string>; // Preferred voices per language (e.g., { "es": "Lupita", "fr": "Hélène" })
  // LLM-Based Turn Detection (Experimental - Currently Disabled)
  llmTurnDetection?: {
    enabled?: boolean; // Enable/disable LLM turn detection (default: false)
    llmProvider?: 'groq' | 'openrouter'; // LLM provider for turn detection
    llmModel?: string; // LLM model for turn detection (default: llama-3.1-8b-instant)
    debounceMs?: number; // Debounce time in ms (default: 150)
    timeoutMs?: number; // Timeout in ms (default: 3000)
  };
  // Session Key (for sidecar/developer-managed connections)
  sessionKey?: string; // Session key for correlating multiple connections (sidecar pattern)
  // Acknowledgement Response Configuration
  acknowledgementEnabled?: boolean; // Enable/disable acknowledgement responses (default: true, follows env)
  acknowledgementDelayMs?: number; // Delay in ms before sending acknowledgement (default: 300)
  acknowledgementPhrases?: string[]; // List of acknowledgement phrases to rotate through
  // Typing Sound Configuration
  typingSoundEnabled?: boolean; // Enable/disable typing sounds (default: false, follows env)
  typingSoundVolume?: number; // Volume multiplier 0.0-1.0 (default: 0.3)
  typingSoundLoopDurationMs?: number; // Duration of one loop in ms (default: 2000)
}

/**
 * Generate an ephemeral token
 * 
 * Creates a JWT with:
 * - Prefix: 'ek_' (ephemeral key) for OpenAI SDK compatibility
 * - Subject: 'session'
 * - Expiration: 5 minutes (configurable)
 * - JTI: unique session ID
 * - Algorithm: HS256
 * - Optional model and voice preferences
 * - Optional call duration limits
 * - Optional Agent Mode configuration (test mode only)
 * - Optional turn detection configuration (AssemblyAI)
 * 
 * @param expiresInMs Token expiration time in milliseconds (default: 5 minutes)
 * @param model Optional model preference to embed in token
 * @param voice Optional voice preference to embed in token
 * @param speakingRate Optional speaking rate for TTS (1.0 = normal, 1.2 = 20% faster, default: 1.2)
 * @param maxCallDurationMs Optional maximum call duration in milliseconds (default from env: 30 minutes)
 * @param maxIdleDurationMs Optional maximum idle duration in milliseconds (default from env: 10 minutes)
 * @param agentConfig Optional Agent Mode configuration (only allowed in test mode)
 * @param turnDetectionConfig Optional turn detection configuration (AssemblyAI presets or custom)
 * @returns Token string with 'ek_' prefix
 */
export async function generateEphemeralToken(
  expiresInMs: number = config.jwt.expirationMs,
  model?: string,
  voice?: string,
  speakingRate?: number,
  initialGreetingPrompt?: string,
  maxCallDurationMs: number = config.callDuration.maxCallDurationMs, // Default from env: 30 minutes
  maxIdleDurationMs: number = config.callDuration.maxIdleDurationMs,  // Default from env: 10 minutes
  llmProviderConfig?: {
    llmProvider?: 'groq' | 'openrouter' | 'openai-compatible';
    openrouterProvider?: string;
    openrouterSiteUrl?: string;
    openrouterAppName?: string;
  },
  agentConfig?: {
    testMode?: boolean;
    provider?: SupportedProvider;  // From registry
    maxSteps?: number;
    maxContextMessages?: number;
    temperature?: number;
    maxTokens?: number;
  },
  turnDetectionConfig?: TokenPayload['turnDetection']
): Promise<string> {
  // Convert to object-based configuration for the new maintainable API
  const options: TokenGenerationOptions = {
    expiresInMs,
    model,
    voice,
    speakingRate,
    initialGreetingPrompt,
    maxCallDurationMs,
    maxIdleDurationMs,
    llmProvider: llmProviderConfig?.llmProvider,
    openrouterProvider: llmProviderConfig?.openrouterProvider,
    openrouterSiteUrl: llmProviderConfig?.openrouterSiteUrl,
    openrouterAppName: llmProviderConfig?.openrouterAppName,
    agentConfig,
    turnDetection: turnDetectionConfig,
  };
  
  // Use the shared token generator with verification and logging
  return sharedGenerateAndVerifyToken(config.jwt.secret, options);
}

/**
 * Verify an ephemeral token
 * 
 * Validates:
 * - Token format (must start with 'ek_')
 * - JWT signature
 * - Token expiration
 * 
 * @param token Token string with 'ek_' prefix
 * @returns Decoded token payload (including optional model and voice)
 * @throws Error if token is invalid or expired
 */
export async function verifyToken(token: string): Promise<TokenPayload> {
  // Check for 'ek_' prefix
  if (!token.startsWith('ek_')) {
    throw new Error('Invalid token format: must start with "ek_"');
  }
  
  // Remove 'ek_' prefix
  const jwt = token.slice(3);
  
  try {
    // Verify JWT
    const { payload } = await jwtVerify(jwt, config.jwt.secret, {
      algorithms: ['HS256'],
    });
    
    return {
      sub: payload.sub as string,
      jti: payload.jti as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
      preset: payload.preset as string | undefined,
      model: payload.model as string | undefined,
      voice: payload.voice as string | undefined,
      initialGreetingPrompt: payload.initialGreetingPrompt as string | undefined,
      instructions: payload.instructions as string | undefined,
      maxCallDurationMs: payload.maxCallDurationMs as number | undefined,
      maxIdleDurationMs: payload.maxIdleDurationMs as number | undefined,
      // Agent Mode configuration (test mode only)
      testMode: payload.testMode as boolean | undefined,
      agentMaxSteps: payload.agentMaxSteps as number | undefined,
      agentMaxContextMessages: payload.agentMaxContextMessages as number | undefined,
      agentTemperature: payload.agentTemperature as number | undefined,
      agentMaxTokens: payload.agentMaxTokens as number | undefined,
      agentFrequencyPenalty: payload.agentFrequencyPenalty as number | undefined,
      agentPresencePenalty: payload.agentPresencePenalty as number | undefined,
      agentRepetitionPenalty: payload.agentRepetitionPenalty as number | undefined,
      // Turn Detection configuration (AssemblyAI)
      turnDetection: payload.turnDetection as TokenPayload['turnDetection'],
      // LLM Turn Detection configuration (experimental)
      llmTurnDetection: payload.llmTurnDetection as TokenPayload['llmTurnDetection'],
      // Language configuration
      language: payload.language as string | undefined,
      languageDetection: payload.languageDetection as TokenPayload['languageDetection'],
      languageVoiceMap: payload.languageVoiceMap as Record<string, string> | undefined,
      // Session Key (for sidecar/developer-managed connections)
      sessionKey: payload.sessionKey as string | undefined,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('expired')) {
        throw new Error('Token expired');
      }
      throw new Error(`Invalid token: ${error.message}`);
    }
    throw new Error('Invalid token');
  }
}

/**
 * Get token expiration time
 * 
 * @param expiresInMs Token expiration time in milliseconds
 * @returns Unix timestamp (seconds)
 */
export function getExpirationTimestamp(
  expiresInMs: number = config.jwt.expirationMs
): number {
  return Math.floor((Date.now() + expiresInMs) / 1000);
}
