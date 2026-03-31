/**
 * Cloudflare Workers Runtime Configuration Loader
 * 
 * Loads configuration from Workers Env binding
 */

import { RuntimeConfig, ConfigLoader, DEFAULT_AUDIO_CONFIG, validateConfig } from '../RuntimeConfig';

import { getEventSystem, EventCategory } from '../../events';
/**
 * Cloudflare Workers Env interface (simplified - actual Env defined in workers/)
 * This allows us to load config without depending on Workers types
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
  GROQ_REASONING_EFFORT?: string; // Reasoning effort for Groq models: 'none', 'low', 'medium', 'high'
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
  
  // Fennec
  FENNEC_API_KEY?: string;
  FENNEC_SAMPLE_RATE?: string;
  FENNEC_CHANNELS?: string;
  FENNEC_LANGUAGE?: string;
  FENNEC_DETECT_THOUGHTS?: string;
  FENNEC_END_THOUGHT_EAGERNESS?: string;
  FENNEC_FORCE_COMPLETE_TIME?: string;
  FENNEC_VAD_THRESHOLD?: string;
  FENNEC_VAD_MIN_SILENCE_MS?: string;
  FENNEC_VAD_SPEECH_PAD_MS?: string;
  
  // AssemblyAI
  ASSEMBLYAI_API_KEY?: string;
  ASSEMBLYAI_SAMPLE_RATE?: string;
  ASSEMBLYAI_ENCODING?: string;
  ASSEMBLYAI_WORD_BOOST?: string;
  /** When "true", ignores any token/client VAD config (preset, silence duration, etc.) and uses env-configured preset */
  ASSEMBLYAI_VAD_CONFIG_LOCKED?: string;

  // Modulate
  MODULATE_API_KEY?: string;
  MODULATE_SAMPLE_RATE?: string;
  MODULATE_NUM_CHANNELS?: string;
  MODULATE_AUDIO_FORMAT?: string;
  MODULATE_SPEAKER_DIARIZATION?: string;
  MODULATE_EMOTION_SIGNAL?: string;
  MODULATE_ACCENT_SIGNAL?: string;
  MODULATE_PII_PHI_TAGGING?: string;
  MODULATE_PARTIAL_RESULTS?: string;
  MODULATE_BATCH_URL?: string;
  MODULATE_STREAMING_URL?: string;

  // Mistral Voxtral Realtime
  MISTRAL_API_KEY?: string;
  MISTRAL_VOXTRAL_MODEL?: string;
  MISTRAL_VOXTRAL_SAMPLE_RATE?: string;
  MISTRAL_VOXTRAL_LANGUAGE?: string;
  
  // Inworld
  INWORLD_API_KEY?: string;
  INWORLD_VOICE?: string;
  INWORLD_SAMPLE_RATE?: string;
  INWORLD_SPEAKING_RATE?: string;
  
  // VAD
  VAD_THRESHOLD?: string;
  VAD_MIN_SILENCE_MS?: string;
  VAD_SPEECH_PAD_MS?: string;
  
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
 * Configuration loader for Cloudflare Workers runtime
 */
export class WorkersConfigLoader implements ConfigLoader {
  constructor(private env: WorkersEnv) {}
  
  load(): RuntimeConfig {
    // Determine providers
    const sttProvider = (this.env.STT_PROVIDER || 'assemblyai') as 'groq-whisper' | 'fennec' | 'assemblyai' | 'mistral-voxtral-realtime' | 'modulate';
    const ttsProvider = (this.env.TTS_PROVIDER || 'inworld') as 'inworld';
    const vadProvider = this.determineVADProvider(sttProvider);
    
    // Determine LLM provider and API key
    const llmProvider = (this.env.LLM_PROVIDER || 'groq') as 'groq' | 'openrouter' | 'cerebras' | 'workers-ai';
    let llmApiKey = '';
    
    if (llmProvider === 'cerebras') {
      llmApiKey = this.env.CEREBRAS_API_KEY || '';
      const keyPreview = llmApiKey 
        ? `${llmApiKey.substring(0, 8)}...${llmApiKey.substring(llmApiKey.length - 4)}`
        : 'MISSING';
      getEventSystem().info(EventCategory.LLM, `🔧 WorkersConfigLoader: LLM_PROVIDER=cerebras, CEREBRAS_API_KEY=${keyPreview}`);
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
      
      // Provider Configuration
      providers: {
        stt: {
          provider: sttProvider,
          groqWhisper: sttProvider === 'groq-whisper' ? {
            apiKey: this.env.GROQ_API_KEY,
            model: this.env.GROQ_MODEL || 'moonshotai/kimi-k2-instruct-0905',
            whisperModel: this.env.GROQ_WHISPER_MODEL || 'whisper-large-v3',
          } : undefined,
          fennec: sttProvider === 'fennec' ? {
            apiKey: this.env.FENNEC_API_KEY || '',
            sampleRate: parseInt(this.env.FENNEC_SAMPLE_RATE || '16000', 10),
            channels: parseInt(this.env.FENNEC_CHANNELS || '1', 10),
            detectThoughts: this.env.FENNEC_DETECT_THOUGHTS === 'true',
            endThoughtEagerness: (this.env.FENNEC_END_THOUGHT_EAGERNESS || 'high') as any,
            forceCompleteTime: parseFloat(this.env.FENNEC_FORCE_COMPLETE_TIME || '20'),
            vad: {
              threshold: parseFloat(this.env.FENNEC_VAD_THRESHOLD || '0.35'),
              min_silence_ms: parseInt(this.env.FENNEC_VAD_MIN_SILENCE_MS || '50', 10),
              speech_pad_ms: parseInt(this.env.FENNEC_VAD_SPEECH_PAD_MS || '350', 10),
            },
          } : undefined,
          assemblyai: sttProvider === 'assemblyai' ? {
            apiKey: this.env.ASSEMBLYAI_API_KEY || '',
            sampleRate: parseInt(this.env.ASSEMBLYAI_SAMPLE_RATE || '24000', 10),
            encoding: this.env.ASSEMBLYAI_ENCODING || 'pcm_s16le',
            wordBoost: this.env.ASSEMBLYAI_WORD_BOOST ? this.env.ASSEMBLYAI_WORD_BOOST.split(',') : [],
            vadConfigLocked: this.env.ASSEMBLYAI_VAD_CONFIG_LOCKED === 'true',
          } : undefined,
          modulate: sttProvider === 'modulate' ? {
            apiKey: this.env.MODULATE_API_KEY || '',
            sampleRate: parseInt(this.env.MODULATE_SAMPLE_RATE || '24000', 10),
            numChannels: parseInt(this.env.MODULATE_NUM_CHANNELS || '1', 10),
            audioFormat: this.env.MODULATE_AUDIO_FORMAT || 's16le',
            speakerDiarization: this.env.MODULATE_SPEAKER_DIARIZATION === 'true',
            emotionSignal: this.env.MODULATE_EMOTION_SIGNAL === 'true',
            accentSignal: this.env.MODULATE_ACCENT_SIGNAL === 'true',
            piiPhiTagging: this.env.MODULATE_PII_PHI_TAGGING === 'true',
            partialResults: this.env.MODULATE_PARTIAL_RESULTS !== 'false',
            batchUrl: this.env.MODULATE_BATCH_URL,
            streamingUrl: this.env.MODULATE_STREAMING_URL,
          } : undefined,
          mistralVoxtralRealtime: sttProvider === 'mistral-voxtral-realtime' ? {
            apiKey: this.env.MISTRAL_API_KEY || '',
            model: this.env.MISTRAL_VOXTRAL_MODEL || 'voxtral-mini-transcribe-realtime-2602',
            sampleRate: parseInt(this.env.MISTRAL_VOXTRAL_SAMPLE_RATE || '16000', 10),
            language: this.env.MISTRAL_VOXTRAL_LANGUAGE,
          } : undefined,
        },
        
        tts: {
          provider: ttsProvider,
          inworld: ttsProvider === 'inworld' ? {
            apiKey: this.env.INWORLD_API_KEY || '',
            voice: this.env.INWORLD_VOICE || 'Ashley',
            sampleRate: parseInt(this.env.INWORLD_SAMPLE_RATE || '24000', 10),
            speakingRate: parseFloat(this.env.INWORLD_SPEAKING_RATE || '1.2'),
          } : undefined,
        },
        
        vad: {
          provider: vadProvider,
          enabled: this.env.VAD_ENABLED !== 'false',
          silero: vadProvider === 'silero' ? {
            threshold: parseFloat(this.env.VAD_THRESHOLD || '0.5'),
            minSilenceDurationMs: parseInt(this.env.VAD_MIN_SILENCE_MS || '550', 10),
            speechPadMs: parseInt(this.env.VAD_SPEECH_PAD_MS || '0', 10),
          } : undefined,
        },
      },
      
      // Server Configuration (not used in Workers)
      server: undefined,
      
      // Call Duration Limits
      callDuration: {
        maxCallDurationMs: parseInt(this.env.MAX_CALL_DURATION_MS || '1800000', 10), // Default: 30 minutes
        maxIdleDurationMs: parseInt(this.env.MAX_IDLE_DURATION_MS || '600000', 10),  // Default: 10 minutes
      },
      
      // Audio Configuration
      audio: DEFAULT_AUDIO_CONFIG,
      
      // Turn Detection Configuration
      turnDetection: {
        enabled: this.env.TURN_DETECTION_ENABLED !== 'false', // Default enabled
        llmProvider: (this.env.TURN_DETECTION_LLM_PROVIDER || 'groq') as 'groq' | 'openrouter' | 'cerebras',
        llmModel: this.env.TURN_DETECTION_LLM_MODEL || 'llama-3.1-8b-instant',
        llmApiKey: this.env.TURN_DETECTION_LLM_API_KEY, // Optional, falls back to GROQ_API_KEY, OPENROUTER_API_KEY, or CEREBRAS_API_KEY
        debounceMs: parseInt(this.env.TURN_DETECTION_DEBOUNCE_MS || '150', 10),
        timeoutMs: parseInt(this.env.TURN_DETECTION_TIMEOUT_MS || '3000', 10),
      },
      
      // Speech Mode Configuration
      speech: {
        defaultMode: (this.env.DEFAULT_SPEECH_MODE === 'explicit') ? 'explicit' : 'implicit' as 'implicit' | 'explicit',
      },
      
      // Response Filter Configuration (AI-driven deduplication and translation)
      // Enabled by default unless explicitly disabled
      // Default model: GPT-OSS 20B (more reliable than smaller models)
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
  
  private determineVADProvider(
    sttProvider: string
  ): 'silero' | 'fennec-integrated' | 'assemblyai-integrated' | 'none' {
    if (this.env.VAD_PROVIDER) {
      return this.env.VAD_PROVIDER as any;
    }
    if (this.env.VAD_ENABLED === 'false') {
      return 'none';
    }
    if (sttProvider === 'fennec') {
      return 'fennec-integrated';
    }
    if (sttProvider === 'assemblyai') {
      return 'assemblyai-integrated';
    }
    return 'silero';
  }
}
