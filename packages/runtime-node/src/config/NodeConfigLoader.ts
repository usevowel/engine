/**
 * Node/Bun Configuration Loader
 *
 * Loads the runtime-agnostic configuration shape used by the shared
 * realtime session handlers so the Bun server follows the same protocol path
 * as the Workers runtime.
 *
 * @module config
 */

import type { RuntimeConfig } from '../../../../src/config/RuntimeConfig';

export interface NodeRuntimeConfig extends RuntimeConfig {}

/**
 * Configuration loader for Node/Bun runtime
 */
export class NodeConfigLoader {
  load(): NodeRuntimeConfig {
    const env = process.env;
    const llmProvider = (env.LLM_PROVIDER || 'groq') as 'groq' | 'openrouter' | 'cerebras' | 'workers-ai';
    const llmApiKey =
      llmProvider === 'openrouter'
        ? env.OPENROUTER_API_KEY || ''
        : llmProvider === 'cerebras'
          ? env.CEREBRAS_API_KEY || ''
          : llmProvider === 'workers-ai'
            ? ''
          : env.GROQ_API_KEY || '';
    const llmModel =
      llmProvider === 'openrouter'
        ? env.OPENROUTER_MODEL || env.GROQ_MODEL || 'openai/gpt-oss-20b'
        : llmProvider === 'cerebras'
          ? env.CEREBRAS_MODEL || env.GROQ_MODEL || 'openai/gpt-oss-20b'
          : llmProvider === 'workers-ai'
            ? env.WORKERS_AI_MODEL || '@cf/zai-org/glm-4.7-flash'
          : env.GROQ_MODEL || 'openai/gpt-oss-20b';
    const sttProvider = (env.STT_PROVIDER || 'assemblyai') as
      | 'groq-whisper'
      | 'fennec'
      | 'assemblyai'
      | 'mistral-voxtral-realtime'
      | 'deepgram';
    const ttsProvider = (env.TTS_PROVIDER || 'inworld') as 'inworld' | 'deepgram';
    const vadProvider = (env.VAD_PROVIDER ||
      (sttProvider === 'assemblyai' ? 'assemblyai-integrated' : 'none')) as
      | 'silero'
      | 'fennec-integrated'
      | 'assemblyai-integrated'
      | 'none';
    const inworldVoice = env.INWORLD_VOICE || 'Ashley';

    return {
      apiKey: env.API_KEY || '',
      jwtSecret: env.JWT_SECRET || '',

      llm: {
        provider: llmProvider,
        model: llmModel,
        apiKey: llmApiKey,
        openrouterSiteUrl: env.OPENROUTER_SITE_URL,
        openrouterAppName: env.OPENROUTER_APP_NAME,
        openrouterProvider: env.OPENROUTER_PROVIDER,
      },

      testMode: env.TEST_MODE === 'true',

      agent: {
        useModularAgents: env.USE_MODULAR_AGENTS !== 'false',
        defaultType: (env.DEFAULT_AGENT_TYPE || 'custom') as 'vercel-sdk' | 'custom',
        maxSteps: env.AGENT_MAX_STEPS ? parseInt(env.AGENT_MAX_STEPS, 10) : undefined,
        disableStreaming: env.DISABLE_STREAMING === 'true',
        maxStreamRetries: parseInt(env.MAX_STREAM_RETRIES || '3', 10),
        maxToolRetries: parseInt(env.MAX_TOOL_RETRIES || '3', 10),
      },

      providers: {
        stt: {
          provider: sttProvider,
          groqWhisper: {
            apiKey: env.GROQ_API_KEY || '',
            model: env.GROQ_MODEL || 'openai/gpt-oss-20b',
            whisperModel: env.GROQ_WHISPER_MODEL || 'whisper-large-v3',
          },
          fennec: {
            apiKey: env.FENNEC_API_KEY || '',
            sampleRate: 24000,
            channels: 1,
          },
          assemblyai: {
            apiKey: env.ASSEMBLYAI_API_KEY || '',
            sampleRate: 24000,
            encoding: 'pcm_s16le',
          },
          mistralVoxtralRealtime: {
            apiKey: env.MISTRAL_API_KEY || '',
            model: env.MISTRAL_VOXTRAL_MODEL || 'voxtral-mini-transcribe-realtime-2602',
            sampleRate: env.MISTRAL_VOXTRAL_SAMPLE_RATE
              ? parseInt(env.MISTRAL_VOXTRAL_SAMPLE_RATE, 10)
              : 16000,
            language: env.MISTRAL_VOXTRAL_LANGUAGE,
          },
          deepgram: {
            apiKey: env.DEEPGRAM_API_KEY || '',
            model: env.DEEPGRAM_STT_MODEL || 'nova-3',
            language: env.DEEPGRAM_STT_LANGUAGE || 'en-US',
            sampleRate: env.DEEPGRAM_STT_SAMPLE_RATE
              ? parseInt(env.DEEPGRAM_STT_SAMPLE_RATE, 10)
              : 16000,
          },
        },
        tts: {
          provider: ttsProvider,
          inworld: {
            apiKey: env.INWORLD_API_KEY || '',
            voice: inworldVoice,
            sampleRate: 24000,
            speakingRate: env.INWORLD_SPEAKING_RATE
              ? parseFloat(env.INWORLD_SPEAKING_RATE)
              : 1.2,
          },
          deepgram: {
            apiKey: env.DEEPGRAM_API_KEY || '',
            model: env.DEEPGRAM_TTS_MODEL || 'aura-2-thalia-en',
            sampleRate: env.DEEPGRAM_TTS_SAMPLE_RATE
              ? parseInt(env.DEEPGRAM_TTS_SAMPLE_RATE, 10)
              : 24000,
            encoding: env.DEEPGRAM_TTS_ENCODING || 'linear16',
          },
        },
        vad: {
          provider: vadProvider,
          enabled: env.VAD_ENABLED !== 'false',
          silero: {
            threshold: parseFloat(env.VAD_THRESHOLD || '0.5'),
            minSilenceDurationMs: parseInt(env.VAD_MIN_SILENCE_MS || '550', 10),
            speechPadMs: parseInt(env.VAD_SPEECH_PAD_MS || '0', 10),
            sampleRate: 16000,
            modelPath: env.SILERO_VAD_MODEL_PATH,
          },
        },
      },

      server: {
        port: parseInt(env.PORT || '3001', 10),
        env: env.NODE_ENV || 'development',
      },

      callDuration: {
        maxCallDurationMs: parseInt(env.MAX_CALL_DURATION_MS || String(30 * 60 * 1000), 10),
        maxIdleDurationMs: parseInt(env.MAX_IDLE_DURATION_MS || String(10 * 60 * 1000), 10),
      },

      audio: {
        sampleRate: 24000,
        format: 'pcm16',
        channels: 1,
      },

      turnDetection: {
        enabled: env.TURN_DETECTION_ENABLED !== 'false',
        llmProvider: (
          env.TURN_DETECTION_LLM_PROVIDER ||
          (llmProvider === 'workers-ai' ? 'groq' : llmProvider)
        ) as 'groq' | 'openrouter' | 'cerebras',
        llmModel: env.TURN_DETECTION_LLM_MODEL || env.GROQ_MODEL || 'llama-3.1-8b-instant',
        llmApiKey: env.TURN_DETECTION_LLM_API_KEY,
        debounceMs: parseInt(env.TURN_DETECTION_DEBOUNCE_MS || '150', 10),
        timeoutMs: parseInt(env.TURN_DETECTION_TIMEOUT_MS || '3000', 10),
      },

      speech: {
        defaultMode: env.DEFAULT_SPEECH_MODE === 'explicit' ? 'explicit' : 'implicit',
      },

      responseFilter: {
        enabled: env.RESPONSE_FILTER_ENABLED !== 'false',
        targetLanguage: env.RESPONSE_FILTER_TARGET_LANGUAGE,
        filterModel: env.RESPONSE_FILTER_MODEL || 'openai/gpt-oss-20b',
        maxRecentChunks: parseInt(env.RESPONSE_FILTER_MAX_RECENT_CHUNKS || '10', 10),
        mode: (env.RESPONSE_FILTER_MODE || 'both') as 'deduplication' | 'translation' | 'both',
      },

      subagent: {
        enabled: env.SUBAGENT_ENABLED === 'true',
        model: env.SUBAGENT_MODEL,
        provider: env.SUBAGENT_PROVIDER as 'groq' | 'openrouter' | 'cerebras' | 'workers-ai' | undefined,
        temperature: env.SUBAGENT_TEMPERATURE ? parseFloat(env.SUBAGENT_TEMPERATURE) : undefined,
        maxTokens: env.SUBAGENT_MAX_TOKENS ? parseInt(env.SUBAGENT_MAX_TOKENS, 10) : undefined,
      },
    };
  }
}
