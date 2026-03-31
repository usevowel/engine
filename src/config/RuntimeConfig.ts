/**
 * Runtime-Agnostic Configuration Interface
 * 
 * This module defines the configuration structure needed by the application,
 * independent of any specific runtime (Cloudflare Workers, etc.)
 * 
 * Provider configuration uses a generic shape — specific provider types
 * are validated at runtime by the ProviderRegistry.
 */

/**
 * Generic provider configuration.
 * 
 * The `provider` field is a string name validated against ProviderRegistry.
 * The `config` field holds provider-specific options validated against the
 * registered Zod schema for that provider.
 */
export interface RuntimeProviderConfig {
  stt: {
    provider: string;
    config: unknown;
  };
  tts: {
    provider: string;
    config: unknown;
  };
  vad: {
    provider: string;
    enabled: boolean;
    config?: unknown;
  };
}

/**
 * Complete runtime configuration
 */
export interface RuntimeConfig {
  // API Keys
  apiKey: string;
  jwtSecret: string;
  
  // LLM Configuration
  llm: {
    provider: 'groq' | 'openrouter' | 'cerebras' | 'workers-ai';
    apiKey: string;
    model: string;
    openrouterSiteUrl?: string;
    openrouterAppName?: string;
    openrouterProvider?: string;
  };
  
  // Test Mode (disables external metering integrations)
  testMode?: boolean;
  
  // Agent Configuration
  agent: {
    useModularAgents: boolean;
    defaultType: 'vercel-sdk' | 'custom';
    maxSteps?: number;
    disableStreaming?: boolean;
    maxStreamRetries?: number;
    maxToolRetries?: number;
  };
  
  // Provider Configuration
  providers: RuntimeProviderConfig;
  
  // Server Configuration (optional - not used in Workers)
  server?: {
    port: number;
    env: string;
  };
  
  // Call Duration Limits
  callDuration?: {
    maxCallDurationMs: number;
    maxIdleDurationMs: number;
  };
  
  // Audio Configuration
  audio: {
    sampleRate: number;
    format: 'pcm16';
    channels: number;
  };
  
  // Turn Detection Configuration (LLM-based)
  turnDetection?: {
    enabled: boolean;
    llmProvider: 'groq' | 'openrouter' | 'cerebras';
    llmModel: string;
    llmApiKey?: string;
    debounceMs: number;
    timeoutMs: number;
  };
  
  // Speech Mode Configuration
  speech: {
    defaultMode: 'implicit' | 'explicit';
  };
  
  // Response Filter Configuration (AI-driven deduplication and translation)
  responseFilter?: {
    enabled: boolean;
    targetLanguage?: string;
    filterModel?: string;
    bufferSize?: number;
    maxRecentChunks?: number;
    mode?: 'deduplication' | 'translation' | 'both';
  };
  
  // Subagent Configuration
  subagent?: {
    enabled: boolean;
    model?: string;
    provider?: 'groq' | 'openrouter' | 'cerebras' | 'workers-ai';
    temperature?: number;
    maxTokens?: number;
  };
}

/**
 * Configuration loader interface
 */
export interface ConfigLoader {
  load(): RuntimeConfig | Promise<RuntimeConfig>;
}

/**
 * Default audio configuration (constant across all runtimes)
 */
export const DEFAULT_AUDIO_CONFIG = {
  sampleRate: 24000,
  format: 'pcm16' as const,
  channels: 1,
};

/**
 * Helper to validate required config fields.
 * 
 * Provider existence is validated by config loaders against ProviderRegistry.
 * This function only checks structural requirements.
 */
export function validateConfig(config: RuntimeConfig): void {
  if (!config.apiKey) {
    throw new Error('API_KEY is required');
  }
  
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET is required and must be at least 32 characters');
  }
  
  // Skip API key validation in test mode
  if (!config.testMode && config.llm.provider !== 'workers-ai' && !config.llm.apiKey) {
    throw new Error('LLM API key is required (or enable test mode)');
  }
  
  // Provider-specific validation (API keys, etc.) is handled by
  // ProviderFactory at creation time using registered Zod schemas.
}
