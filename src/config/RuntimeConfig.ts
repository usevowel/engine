/**
 * Runtime-Agnostic Configuration Interface
 * 
 * This module defines the configuration structure needed by the application,
 * independent of any specific runtime (Cloudflare Workers, etc.)
 * 
 * Runtime-specific loaders (WorkersConfigLoader) will
 * implement loading logic for their respective environments.
 */

/**
 * Provider configuration structure
 */
export interface RuntimeProviderConfig {
  // STT Configuration
  stt: {
    provider: 'groq-whisper' | 'fennec' | 'assemblyai' | 'mistral-voxtral-realtime';
    groqWhisper?: {
      apiKey: string;
      model: string;
      whisperModel: string;
    };
    fennec?: {
      apiKey: string;
      sampleRate?: number;
      channels?: number;
      detectThoughts?: boolean;
      endThoughtEagerness?: 'high' | 'medium' | 'low';
      forceCompleteTime?: number;
      vad?: {
        threshold?: number;
        min_silence_ms?: number;
        speech_pad_ms?: number;
      };
    };
    assemblyai?: {
      apiKey: string;
      sampleRate?: number;
      encoding?: string;
      wordBoost?: string[];
      /** When true, ignores token/client VAD config and uses env-configured preset */
      vadConfigLocked?: boolean;
    };
    mistralVoxtralRealtime?: {
      apiKey: string;
      model?: string;
      sampleRate?: number;
      language?: string;
    };
  };
  
  // TTS Configuration
  tts: {
    provider: 'inworld';
    inworld?: {
      apiKey: string;
      modelId?: string;
      voice?: string;
      sampleRate?: number;
      speakingRate?: number;
    };
  };
  
  // VAD Configuration
  vad: {
    provider: 'silero' | 'fennec-integrated' | 'assemblyai-integrated' | 'none';
    enabled: boolean;
    silero?: {
      threshold: number;
      minSilenceDurationMs: number;
      speechPadMs: number;
    };
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
    openrouterSiteUrl?: string; // Optional site URL for OpenRouter
    openrouterAppName?: string; // Optional app name for OpenRouter
    openrouterProvider?: string; // Optional OpenRouter provider selection (e.g., "anthropic", "openai", "google")
  };
  
  // Test Mode (disables external metering integrations)
  testMode?: boolean;
  
  // Agent Configuration
  agent: {
    useModularAgents: boolean;
    defaultType: 'vercel-sdk' | 'custom';
    maxSteps?: number;
    disableStreaming?: boolean; // Disable streaming and wait for complete response
    maxStreamRetries?: number; // Maximum number of stream restarts after hard errors (default: 3)
    maxToolRetries?: number; // Maximum number of retries for tool call validation errors (default: 3)
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
    llmApiKey?: string; // Optional, falls back to GROQ_API_KEY, OPENROUTER_API_KEY, or CEREBRAS_API_KEY
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
    targetLanguage?: string; // ISO 639-1 code (e.g., 'en', 'es', 'fr')
    filterModel?: string; // Filter LLM model (default: 'openai/gpt-oss-20b')
    bufferSize?: number; // Buffer size in characters (default: 200)
    maxRecentChunks?: number; // Maximum recent chunks for comparison (default: 10)
    mode?: 'deduplication' | 'translation' | 'both'; // Filtering mode (default: 'deduplication')
  };
  
  // Subagent Configuration
  subagent?: {
    enabled: boolean;
    model?: string; // Optional: different model for subagent
    provider?: 'groq' | 'openrouter' | 'cerebras' | 'workers-ai'; // Optional: different provider
    temperature?: number; // Optional: lower temp for tool calling (default: 0.3)
    maxTokens?: number; // Optional: limit subagent response length (default: 2000)
  };
}

/**
 * Configuration loader interface
 * Runtime-specific implementations will load config from their respective sources
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
 * Helper to validate required config fields
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
  
  // Validate provider-specific keys
  // Note: AssemblyAI validation is deferred if API key is missing, as it may not be needed
  // for client-side VAD mode (which uses Groq Whisper batch mode instead)
  const sttProvider = config.providers.stt.provider;
  if (sttProvider === 'groq-whisper' && !config.providers.stt.groqWhisper?.apiKey) {
    throw new Error('Groq API key is required for groq-whisper provider');
  }
  if (sttProvider === 'fennec' && !config.providers.stt.fennec?.apiKey) {
    throw new Error('Fennec API key is required for fennec provider');
  }
  // AssemblyAI validation is conditional - only validate if API key is present
  // If missing, it may be because client-side VAD will use Groq Whisper instead
  // Validation will be checked later when provider is actually used
  if (sttProvider === 'assemblyai' && !config.providers.stt.assemblyai?.apiKey) {
    // Don't throw error here - allow client-side VAD mode to work without AssemblyAI API key
    // The provider will be switched to groq-whisper in fetch() if client-side VAD is detected
  }
  if (sttProvider === 'mistral-voxtral-realtime' && !config.providers.stt.mistralVoxtralRealtime?.apiKey) {
    throw new Error('Mistral API key is required for mistral-voxtral-realtime provider');
  }
  
  const ttsProvider = config.providers.tts.provider;
  if (ttsProvider === 'inworld' && !config.providers.tts.inworld?.apiKey) {
    throw new Error('Inworld API key is required for inworld provider');
  }
}
