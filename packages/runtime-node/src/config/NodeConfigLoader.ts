/**
 * Node/Bun Configuration Loader
 *
 * Loads the runtime-agnostic configuration shape used by the shared
 * realtime session handlers.
 *
 * Uses ProviderRegistry for dynamic provider validation.
 *
 * @module config
 */

import type { RuntimeConfig } from '../../../../src/config/RuntimeConfig';
import { ProviderRegistry } from '../../../../src/services/providers/ProviderRegistry';

export interface NodeRuntimeConfig extends RuntimeConfig {}

/**
 * Build STT provider `config` from `process.env` for the given registered provider name.
 * Used by {@link NodeConfigLoader} and JWT session merge when the token overrides `stt.provider`.
 */
export function buildSTTConfigFromEnv(provider: string): unknown {
  const env = process.env;
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
        sampleRate: env.MISTRAL_VOXTRAL_SAMPLE_RATE
          ? parseInt(env.MISTRAL_VOXTRAL_SAMPLE_RATE, 10)
          : 16000,
        language: env.MISTRAL_VOXTRAL_LANGUAGE,
      };
    case 'deepgram':
      return {
        apiKey: env.DEEPGRAM_API_KEY || '',
        model: env.DEEPGRAM_STT_MODEL || 'nova-3',
        language: env.DEEPGRAM_STT_LANGUAGE || 'en-US',
        sampleRate: env.DEEPGRAM_STT_SAMPLE_RATE
          ? parseInt(env.DEEPGRAM_STT_SAMPLE_RATE, 10)
          : 16000,
      };
    case 'grok':
      return {
        apiKey: env.GROK_API_KEY || '',
        model: env.GROK_STT_MODEL || 'whisper-large-v3-turbo',
        language: env.GROK_STT_LANGUAGE || 'en-US',
        sampleRate: env.GROK_STT_SAMPLE_RATE ? parseInt(env.GROK_STT_SAMPLE_RATE, 10) : 24000,
      };
    case 'openai-compatible':
      return {
        apiKey: env.ECHOLINE_API_KEY || '',
        baseUrl: env.ECHOLINE_BASE_URL || 'http://localhost:8000/v1',
        model: env.ECHOLINE_STT_MODEL || 'Systran/faster-whisper-tiny',
        language: env.ECHOLINE_STT_LANGUAGE,
        sampleRate: env.ECHOLINE_STT_SAMPLE_RATE
          ? parseInt(env.ECHOLINE_STT_SAMPLE_RATE, 10)
          : 24000,
      };
    default:
      return {};
  }
}

/**
 * Build TTS provider `config` from `process.env` for the given registered provider name.
 * Used by {@link NodeConfigLoader} and JWT session merge when the token overrides `tts.provider`.
 */
export function buildTTSConfigFromEnv(provider: string): unknown {
  const env = process.env;
  switch (provider) {
    case 'deepgram':
      return {
        apiKey: env.DEEPGRAM_API_KEY || '',
        model: env.DEEPGRAM_TTS_MODEL || 'aura-2-thalia-en',
        sampleRate: env.DEEPGRAM_TTS_SAMPLE_RATE
          ? parseInt(env.DEEPGRAM_TTS_SAMPLE_RATE, 10)
          : 24000,
        encoding: env.DEEPGRAM_TTS_ENCODING || 'linear16',
      };
    case 'openai-compatible':
      return {
        apiKey: env.ECHOLINE_API_KEY || '',
        baseUrl: env.ECHOLINE_BASE_URL || 'http://localhost:8000/v1',
        model: env.ECHOLINE_TTS_MODEL || 'onnx-community/Kokoro-82M-v1.0-ONNX',
        voice: env.ECHOLINE_TTS_VOICE || 'af_heart',
        sampleRate: env.ECHOLINE_TTS_SAMPLE_RATE
          ? parseInt(env.ECHOLINE_TTS_SAMPLE_RATE, 10)
          : 24000,
        responseFormat: (env.ECHOLINE_TTS_RESPONSE_FORMAT || 'wav') as 'wav' | 'mp3',
      };
    case 'grok':
      return {
        apiKey: env.GROK_API_KEY || '',
        voice: env.GROK_TTS_VOICE || env.DEFAULT_VOICE || 'rex',
        sampleRate: env.GROK_TTS_SAMPLE_RATE
          ? parseInt(env.GROK_TTS_SAMPLE_RATE, 10)
          : 24000,
        format: 'pcm16' as const,
      };
    default:
      return {};
  }
}

function buildVADConfigFromEnv(provider: string): unknown {
  const env = process.env;
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
 * Configuration loader for Node/Bun runtime
 */
export class NodeConfigLoader {
  load(): NodeRuntimeConfig {
    const env = process.env;
    const llmProvider = (env.LLM_PROVIDER || 'groq') as 'groq' | 'openrouter' | 'openai-compatible';
    const llmApiKey =
      llmProvider === 'openrouter'
        ? env.OPENROUTER_API_KEY || ''
        : llmProvider === 'openai-compatible'
            ? env.OPENAI_COMPATIBLE_API_KEY || 'EMPTY'
          : env.GROQ_API_KEY || '';
    const llmModel =
      llmProvider === 'openrouter'
        ? env.OPENROUTER_MODEL || env.GROQ_MODEL || 'openai/gpt-oss-20b'
        : llmProvider === 'openai-compatible'
            ? env.OPENAI_COMPATIBLE_MODEL || 'lfm2.5-1.2b-instruct'
          : env.GROQ_MODEL || 'openai/gpt-oss-20b';

    const sttProvider = env.STT_PROVIDER || 'groq-whisper';
    const ttsProvider = env.TTS_PROVIDER || 'deepgram';
    const vadProvider = env.VAD_PROVIDER || 'silero';

    return {
      apiKey: env.API_KEY || '',
      jwtSecret: env.JWT_SECRET || '',

      llm: {
        provider: llmProvider,
        model: llmModel,
        apiKey: llmApiKey,
        baseUrl: env.OPENAI_COMPATIBLE_BASE_URL,
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
          config: buildSTTConfigFromEnv(sttProvider),
        },
        tts: {
          provider: ttsProvider,
          config: buildTTSConfigFromEnv(ttsProvider),
        },
        vad: {
          provider: vadProvider,
          enabled: env.VAD_ENABLED !== 'false' && vadProvider !== 'none',
          config: buildVADConfigFromEnv(vadProvider),
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
        llmProvider: (env.TURN_DETECTION_LLM_PROVIDER || llmProvider) as 'groq' | 'openrouter',
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
        provider: env.SUBAGENT_PROVIDER as 'groq' | 'openrouter' | 'openai-compatible' | undefined,
        temperature: env.SUBAGENT_TEMPERATURE ? parseFloat(env.SUBAGENT_TEMPERATURE) : undefined,
        maxTokens: env.SUBAGENT_MAX_TOKENS ? parseInt(env.SUBAGENT_MAX_TOKENS, 10) : undefined,
      },
    };
  }
}
