/**
 * Cloudflare Workers Runtime Configuration Loader
 * 
 * Loads configuration from Workers Env binding.
 * Uses ProviderRegistry for dynamic provider validation.
 */

import { RuntimeConfig, ConfigLoader, DEFAULT_AUDIO_CONFIG, validateConfig } from '../RuntimeConfig';
import { getEventSystem, EventCategory } from '../../events';
import { ProviderRegistry } from '../../services/providers/ProviderRegistry';

/**
 * Cloudflare Workers Env interface (simplified - actual Env defined in workers/)
 */
export interface WorkersEnv {
  // Required
  API_KEY: string;
  JWT_SECRET: string;
  GROQ_API_KEY: string;
  
  // Provider selection
  STT_PROVIDER?: string;
  TTS_PROVIDER?: string;
  VAD_PROVIDER?: string;
  VAD_ENABLED?: string;
  
  // LLM
  LLM_PROVIDER?: string;
  GROQ_MODEL?: string;
  GROQ_WHISPER_MODEL?: string;
  GROQ_REASONING_EFFORT?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_SITE_URL?: string;
  OPENROUTER_APP_NAME?: string;
  OPENROUTER_PROVIDER?: string;
  CEREBRAS_API_KEY?: string;
  CEREBRAS_MODEL?: string;
  WORKERS_AI_MODEL?: string;
  
  // Test Mode
  TEST_MODE?: string;
  
  // Agent Configuration
  USE_MODULAR_AGENTS?: string;
  DEFAULT_AGENT_TYPE?: string;
  MAX_STEPS?: string;
  DISABLE_STREAMING?: string;
  MAX_STREAM_RETRIES?: string;
  MAX_TOOL_RETRIES?: string;
  USE_DUAL_SCHEMA?: string;
  
  // Deepgram
  DEEPGRAM_API_KEY?: string;
  DEEPGRAM_STT_MODEL?: string;
  DEEPGRAM_STT_LANGUAGE?: string;
  DEEPGRAM_STT_SAMPLE_RATE?: string;
  DEEPGRAM_TTS_MODEL?: string;
  DEEPGRAM_TTS_SAMPLE_RATE?: string;
  DEEPGRAM_TTS_ENCODING?: string;
  
  // Mistral Voxtral Realtime
  MISTRAL_API_KEY?: string;
  MISTRAL_VOXTRAL_MODEL?: string;
  MISTRAL_VOXTRAL_SAMPLE_RATE?: string;
  MISTRAL_VOXTRAL_LANGUAGE?: string;
  
  // VAD
  VAD_THRESHOLD?: string;
  VAD_MIN_SILENCE_MS?: string;
  VAD_SPEECH_PAD_MS?: string;
  SILERO_VAD_MODEL_PATH?: string;
  
  // Turn Detection
  TURN_DETECTION_ENABLED?: string;
  TURN_DETECTION_LLM_PROVIDER?: string;
  TURN_DETECTION_LLM_MODEL?: string;
  TURN_DETECTION_LLM_API_KEY?: string;
  TURN_DETECTION_DEBOUNCE_MS?: string;
  TURN_DETECTION_TIMEOUT_MS?: string;
  
  // Call Duration Limits
  MAX_CALL_DURATION_MS?: string;
  MAX_IDLE_DURATION_MS?: string;
  
  // Response Filter Configuration
  RESPONSE_FILTER_ENABLED?: string;
  RESPONSE_FILTER_TARGET_LANGUAGE?: string;
  RESPONSE_FILTER_MODEL?: string;
  RESPONSE_FILTER_BUFFER_SIZE?: string;
  RESPONSE_FILTER_MAX_RECENT_CHUNKS?: string;
  RESPONSE_FILTER_MODE?: string;
  
  // Subagent Configuration
  SUBAGENT_ENABLED?: string;
  SUBAGENT_MODEL?: string;
  SUBAGENT_PROVIDER?: string;
  SUBAGENT_TEMPERATURE?: string;
  SUBAGENT_MAX_TOKENS?: string;
  
  // Speech Mode Configuration
  DEFAULT_SPEECH_MODE?: string;
}

/**
 * Build STT config object from env for a given provider name.
 * Only handles OSS providers — hosted providers are handled by
 * engine-hosted's own config loader.
 */
function buildSTTConfigFromEnv(provider: string, env: WorkersEnv): unknown {
  switch (provider) {
    case 'groq-whisper':
      return {
        apiKey: env.GROQ_API_KEY || '',
        model: env.GROQ_MODEL || 'moonshotai/kimi-k2-instruct-0905',
        whisperModel: env.GROQ_WHISPER_MODEL || 'whisper-large-v3',
      };
    case 'mistral-voxtral-realtime':
      return {
        apiKey: env.MISTRAL_API_KEY || '',
        model: env.MISTRAL_VOXTRAL_MODEL || 'voxtral-mini-transcribe-realtime-2602',
        sampleRate: parseInt(env.MISTRAL_VOXTRAL_SAMPLE_RATE || '16000', 10),
        language: env.MISTRAL_VOXTRAL_LANGUAGE,
      };
    case 'deepgram':
      return {
        apiKey: env.DEEPGRAM_API_KEY || '',
        model: env.DEEPGRAM_STT_MODEL || 'nova-3',
        language: env.DEEPGRAM_STT_LANGUAGE || 'en-US',
        sampleRate: parseInt(env.DEEPGRAM_STT_SAMPLE_RATE || '16000', 10),
      };
    default:
      // Unknown or hosted provider — return empty config;
      // the hosted runtime will fill this in via its own loader.
      return {};
  }
}

/**
 * Build TTS config object from env for a given provider name.
 */
function buildTTSConfigFromEnv(provider: string, env: WorkersEnv): unknown {
  switch (provider) {
    case 'deepgram':
      return {
        apiKey: env.DEEPGRAM_API_KEY || '',
        model: env.DEEPGRAM_TTS_MODEL || 'aura-2-thalia-en',
        sampleRate: parseInt(env.DEEPGRAM_TTS_SAMPLE_RATE || '24000', 10),
        encoding: env.DEEPGRAM_TTS_ENCODING || 'linear16',
      };
    default:
      return {};
  }
}

/**
 * Build VAD config object from env for a given provider name.
 */
function buildVADConfigFromEnv(provider: string, env: WorkersEnv): unknown {
  switch (provider) {
    case 'silero':
      return {
        threshold: parseFloat(env.VAD_THRESHOLD || '0.5'),
        minSilenceDurationMs: parseInt(env.VAD_MIN_SILENCE_MS || '550', 10),
        speechPadMs: parseInt(env.VAD_SPEECH_PAD_MS || '0', 10),
        sampleRate: 16000,
        modelPath: env.SILERO_VAD_MODEL_PATH,
      };
    case 'none':
      return { enabled: false };
    default:
      return {};
  }
}

/**
 * Configuration loader for Cloudflare Workers runtime
 */
export class WorkersConfigLoader implements ConfigLoader {
  constructor(private env: WorkersEnv) {}
  
  load(): RuntimeConfig {
    // Determine providers
    const sttProvider = this.env.STT_PROVIDER || 'groq-whisper';
    const ttsProvider = this.env.TTS_PROVIDER || 'deepgram';
    const vadProvider = this.determineVADProvider(sttProvider);
    
    // Validate providers exist in registry
    if (!ProviderRegistry.getSTTProvider(sttProvider)) {
      getEventSystem().warn(EventCategory.PROVIDER, `STT provider '${sttProvider}' not registered — it may be a hosted-only provider`);
    }
    if (!ProviderRegistry.getTTSProvider(ttsProvider)) {
      getEventSystem().warn(EventCategory.PROVIDER, `TTS provider '${ttsProvider}' not registered — it may be a hosted-only provider`);
    }
    if (!ProviderRegistry.getVADProvider(vadProvider)) {
      getEventSystem().warn(EventCategory.PROVIDER, `VAD provider '${vadProvider}' not registered — it may be a hosted-only provider`);
    }
    
    // Determine LLM provider and API key
    const llmProvider = (this.env.LLM_PROVIDER || 'groq') as 'groq' | 'openrouter' | 'cerebras' | 'workers-ai';
    let llmApiKey = '';
    
    if (llmProvider === 'cerebras') {
      llmApiKey = this.env.CEREBRAS_API_KEY || '';
      const keyPreview = llmApiKey 
        ? `${llmApiKey.substring(0, 8)}...${llmApiKey.substring(llmApiKey.length - 4)}`
        : 'MISSING';
      getEventSystem().info(EventCategory.LLM, `WorkersConfigLoader: LLM_PROVIDER=cerebras, CEREBRAS_API_KEY=${keyPreview}`);
    } else if (llmProvider === 'openrouter') {
      llmApiKey = this.env.OPENROUTER_API_KEY || '';
    } else if (llmProvider === 'workers-ai') {
      llmApiKey = '';
    } else {
      llmApiKey = this.env.GROQ_API_KEY || '';
    }
    
    const config: RuntimeConfig = {
      // API Keys
      apiKey: this.env.API_KEY,
      jwtSecret: this.env.JWT_SECRET,
      
      // LLM Configuration
      llm: {
        provider: llmProvider,
        apiKey: llmApiKey,
        model: llmProvider === 'cerebras'
          ? (this.env.CEREBRAS_MODEL || 'llama-3.3-70b')
          : llmProvider === 'workers-ai'
          ? (this.env.WORKERS_AI_MODEL || '@cf/zai-org/glm-4.7-flash')
          : llmProvider === 'openrouter'
          ? (this.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet')
          : (this.env.GROQ_MODEL || 'moonshotai/kimi-k2-instruct-0905'),
        openrouterSiteUrl: this.env.OPENROUTER_SITE_URL,
        openrouterAppName: this.env.OPENROUTER_APP_NAME,
      },
      
      // Test Mode (disables external metering integrations)
      testMode: this.env.TEST_MODE === 'true',
      
      // Agent Configuration
      agent: {
        useModularAgents: this.env.USE_MODULAR_AGENTS === 'true',
        defaultType: (this.env.DEFAULT_AGENT_TYPE || 'vercel-sdk') as 'vercel-sdk' | 'custom',
        maxSteps: this.env.MAX_STEPS ? parseInt(this.env.MAX_STEPS, 10) : undefined,
        disableStreaming: this.env.DISABLE_STREAMING === 'true',
        maxStreamRetries: this.env.MAX_STREAM_RETRIES ? parseInt(this.env.MAX_STREAM_RETRIES, 10) : 3,
        maxToolRetries: this.env.MAX_TOOL_RETRIES ? parseInt(this.env.MAX_TOOL_RETRIES, 10) : 3,
      },
      
      // Provider Configuration (generic shape)
      providers: {
        stt: {
          provider: sttProvider,
          config: buildSTTConfigFromEnv(sttProvider, this.env),
        },
        tts: {
          provider: ttsProvider,
          config: buildTTSConfigFromEnv(ttsProvider, this.env),
        },
        vad: {
          provider: vadProvider,
          enabled: vadProvider !== 'none' && this.env.VAD_ENABLED !== 'false',
          config: buildVADConfigFromEnv(vadProvider, this.env),
        },
      },
      
      // Server Configuration (not used in Workers)
      server: undefined,
      
      // Call Duration Limits
      callDuration: {
        maxCallDurationMs: parseInt(this.env.MAX_CALL_DURATION_MS || '1800000', 10),
        maxIdleDurationMs: parseInt(this.env.MAX_IDLE_DURATION_MS || '600000', 10),
      },
      
      // Audio Configuration
      audio: DEFAULT_AUDIO_CONFIG,
      
      // Turn Detection Configuration
      turnDetection: {
        enabled: this.env.TURN_DETECTION_ENABLED !== 'false',
        llmProvider: (this.env.TURN_DETECTION_LLM_PROVIDER || 'groq') as 'groq' | 'openrouter' | 'cerebras',
        llmModel: this.env.TURN_DETECTION_LLM_MODEL || 'llama-3.1-8b-instant',
        llmApiKey: this.env.TURN_DETECTION_LLM_API_KEY,
        debounceMs: parseInt(this.env.TURN_DETECTION_DEBOUNCE_MS || '150', 10),
        timeoutMs: parseInt(this.env.TURN_DETECTION_TIMEOUT_MS || '3000', 10),
      },
      
      // Speech Mode Configuration
      speech: {
        defaultMode: (this.env.DEFAULT_SPEECH_MODE === 'explicit') ? 'explicit' : 'implicit' as 'implicit' | 'explicit',
      },
      
      // Response Filter Configuration
      responseFilter: this.env.RESPONSE_FILTER_ENABLED !== 'false' ? {
        enabled: true,
        targetLanguage: this.env.RESPONSE_FILTER_TARGET_LANGUAGE,
        filterModel: this.env.RESPONSE_FILTER_MODEL || 'openai/gpt-oss-20b',
        bufferSize: this.env.RESPONSE_FILTER_BUFFER_SIZE ? parseInt(this.env.RESPONSE_FILTER_BUFFER_SIZE, 10) : 200,
        maxRecentChunks: this.env.RESPONSE_FILTER_MAX_RECENT_CHUNKS ? parseInt(this.env.RESPONSE_FILTER_MAX_RECENT_CHUNKS, 10) : 10,
        mode: (this.env.RESPONSE_FILTER_MODE || 'deduplication') as 'deduplication' | 'translation' | 'both',
      } : undefined,
      
      // Subagent Configuration
      subagent: this.env.SUBAGENT_ENABLED === 'true' ? {
        enabled: true,
        model: this.env.SUBAGENT_MODEL,
        provider: this.env.SUBAGENT_PROVIDER as 'groq' | 'openrouter' | 'cerebras' | 'workers-ai' | undefined,
        temperature: this.env.SUBAGENT_TEMPERATURE ? parseFloat(this.env.SUBAGENT_TEMPERATURE) : 0.3,
        maxTokens: this.env.SUBAGENT_MAX_TOKENS ? parseInt(this.env.SUBAGENT_MAX_TOKENS, 10) : 2000,
      } : undefined,
    };
    
    // Validate configuration
    validateConfig(config);
    
    return config;
  }
  
  private determineVADProvider(sttProvider: string): string {
    if (this.env.VAD_PROVIDER) {
      return this.env.VAD_PROVIDER;
    }
    if (this.env.VAD_ENABLED === 'false') {
      return 'none';
    }
    return 'silero';
  }
}
