/**
 * Provider Configuration
 * 
 * Centralized configuration for all provider types.
 * Loads and validates provider settings from environment variables.
 */

import { z } from 'zod';

import { getEventSystem, EventCategory } from '../events';
/**
 * Provider type enums
 */
export const STTProviderType = z.enum(['groq-whisper', 'fennec', 'assemblyai', 'mistral-voxtral-realtime', 'deepgram', 'modulate']);
export const TTSProviderType = z.enum(['inworld', 'deepgram']);
export const VADProviderType = z.enum(['silero', 'fennec-integrated', 'assemblyai-integrated', 'none']);

export type STTProviderType = z.infer<typeof STTProviderType>;
export type TTSProviderType = z.infer<typeof TTSProviderType>;
export type VADProviderType = z.infer<typeof VADProviderType>;

/**
 * Provider configuration schemas
 */
const GroqWhisperConfig = z.object({
  apiKey: z.string().min(1, 'Groq API key is required'),
  model: z.string().default('moonshotai/kimi-k2-instruct-0905'),
  whisperModel: z.string().default('whisper-large-v3'),
});

const FennecSTTConfig = z.object({
  apiKey: z.string().min(1, 'Fennec API key is required'),
  sampleRate: z.number().default(16000),
  channels: z.number().default(1),
  detectThoughts: z.boolean().default(false),
  endThoughtEagerness: z.enum(['low', 'medium', 'high']).default('high'),
  forceCompleteTime: z.number().default(20),
  vad: z.object({
    threshold: z.number().min(0).max(1).default(0.35),
    min_silence_ms: z.number().default(50),
    speech_pad_ms: z.number().default(350),
    events: z.boolean().default(true),
    event_hz: z.number().default(8),
  }).optional(),
});

const AssemblyAIConfig = z.object({
  apiKey: z.string().min(1, 'AssemblyAI API key is required'),
  sampleRate: z.number().default(16000),
  encoding: z.enum(['pcm_s16le', 'pcm_mulaw']).default('pcm_s16le'),
  enableSpeakerLabels: z.boolean().default(false),
  enableContentModeration: z.boolean().default(false),
  enableSentimentAnalysis: z.boolean().default(false),
  wordBoost: z.array(z.string()).default([]),
});

const MistralVoxtralRealtimeConfig = z.object({
  apiKey: z.string().min(1, 'Mistral API key is required'),
  model: z.string().default('voxtral-mini-transcribe-realtime-2602'),
  sampleRate: z.number().default(16000),
  language: z.string().optional(),
});

const DeepgramSTTConfig = z.object({
  apiKey: z.string().min(1, 'Deepgram API key is required'),
  model: z.string().default('nova-3'),
  language: z.string().default('en-US'),
  sampleRate: z.number().default(16000),
});

const ModulateSTTConfig = z.object({
  apiKey: z.string().min(1, 'Modulate API key is required'),
  sampleRate: z.number().default(24000),
  numChannels: z.number().default(1),
  audioFormat: z.string().default('s16le'),
  speakerDiarization: z.boolean().default(false),
  emotionSignal: z.boolean().default(false),
  accentSignal: z.boolean().default(false),
  piiPhiTagging: z.boolean().default(false),
  partialResults: z.boolean().default(true),
  batchUrl: z.string().url().default('https://modulate-developer-apis.com/api/velma-2-stt-batch'),
  streamingUrl: z.string().url().default('wss://modulate-developer-apis.com/api/velma-2-stt-streaming'),
});

const InworldTTSConfig = z.object({
  apiKey: z.string().min(1, 'Inworld API key is required'),
  modelId: z.string().default('inworld-tts-1.5-mini'),
  voiceId: z.string().default('Ashley'),
  sampleRate: z.number().default(48000),
});

const DeepgramTTSConfig = z.object({
  apiKey: z.string().min(1, 'Deepgram API key is required'),
  model: z.string().default('aura-2-thalia-en'),
  sampleRate: z.number().default(24000),
  encoding: z.string().default('linear16'),
});

const SileroVADConfig = z.object({
  threshold: z.number().min(0).max(1).default(0.5),
  minSilenceDurationMs: z.number().default(550),
  speechPadMs: z.number().default(0),
  sampleRate: z.number().default(16000),
  modelPath: z.string().optional(),
});

/**
 * Complete provider configuration schema
 */
const ProviderConfigSchema = z.object({
  stt: z.object({
    provider: STTProviderType,
    groqWhisper: GroqWhisperConfig.optional(),
    fennec: FennecSTTConfig.optional(),
    assemblyai: AssemblyAIConfig.optional(),
    mistralVoxtralRealtime: MistralVoxtralRealtimeConfig.optional(),
    deepgram: DeepgramSTTConfig.optional(),
    modulate: ModulateSTTConfig.optional(),
  }),
  tts: z.object({
    provider: TTSProviderType,
    inworld: InworldTTSConfig.optional(),
    deepgram: DeepgramTTSConfig.optional(),
  }),
  vad: z.object({
    enabled: z.boolean(),
    provider: VADProviderType,
    silero: SileroVADConfig.optional(),
  }),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/**
 * Get environment safely (works in both Bun and Workers)
 */
function getEnv(): Record<string, string | undefined> {
  if (typeof Bun !== 'undefined') {
    return Bun.env;
  }
  // In Workers, return empty object (Workers use their own Env binding)
  return {};
}

/**
 * Load and validate provider configuration from environment
 */
export function loadProviderConfig(): ProviderConfig {
  const env = getEnv();

  // Determine STT provider
  const sttProvider = (env.STT_PROVIDER || 'groq-whisper') as STTProviderType;
  
  // Determine TTS provider
  const ttsProvider = (env.TTS_PROVIDER || 'inworld') as TTSProviderType;
  
  // Determine VAD provider
  let vadProvider: VADProviderType;
  if (env.VAD_PROVIDER) {
    vadProvider = env.VAD_PROVIDER as VADProviderType;
  } else if (env.VAD_ENABLED === 'false') {
    vadProvider = 'none';
  } else if (sttProvider === 'fennec') {
    vadProvider = 'fennec-integrated';
  } else if (sttProvider === 'assemblyai') {
    vadProvider = 'assemblyai-integrated';
  } else if (sttProvider === 'modulate') {
    vadProvider = 'silero';
  } else {
    vadProvider = 'silero';
  }

  const config: ProviderConfig = {
    stt: {
      provider: sttProvider,
      groqWhisper: sttProvider === 'groq-whisper' ? {
        apiKey: env.GROQ_API_KEY || '',
        model: env.GROQ_MODEL || 'moonshotai/kimi-k2-instruct-0905',
        whisperModel: env.GROQ_WHISPER_MODEL || 'whisper-large-v3',
      } : undefined,
      fennec: sttProvider === 'fennec' ? {
        apiKey: env.FENNEC_API_KEY || '',
        sampleRate: parseInt(env.FENNEC_SAMPLE_RATE || '16000', 10),
        channels: parseInt(env.FENNEC_CHANNELS || '1', 10),
        detectThoughts: env.FENNEC_DETECT_THOUGHTS === 'true',
        endThoughtEagerness: (env.FENNEC_END_THOUGHT_EAGERNESS || 'high') as any,
        forceCompleteTime: parseFloat(env.FENNEC_FORCE_COMPLETE_TIME || '20'),
        vad: {
          threshold: parseFloat(env.FENNEC_VAD_THRESHOLD || '0.35'),
          min_silence_ms: parseInt(env.FENNEC_VAD_MIN_SILENCE_MS || '50', 10),
          speech_pad_ms: parseInt(env.FENNEC_VAD_SPEECH_PAD_MS || '350', 10),
          events: env.FENNEC_VAD_EVENTS !== 'false',
          event_hz: parseInt(env.FENNEC_VAD_EVENT_HZ || '8', 10),
        },
      } : undefined,
      assemblyai: sttProvider === 'assemblyai' ? {
        apiKey: env.ASSEMBLYAI_API_KEY || '',
        sampleRate: parseInt(env.ASSEMBLYAI_SAMPLE_RATE || '16000', 10),
        encoding: (env.ASSEMBLYAI_ENCODING || 'pcm_s16le') as any,
        enableSpeakerLabels: env.ASSEMBLYAI_ENABLE_SPEAKER_LABELS === 'true',
        enableContentModeration: env.ASSEMBLYAI_ENABLE_CONTENT_MODERATION === 'true',
        enableSentimentAnalysis: env.ASSEMBLYAI_ENABLE_SENTIMENT_ANALYSIS === 'true',
        wordBoost: env.ASSEMBLYAI_WORD_BOOST ? env.ASSEMBLYAI_WORD_BOOST.split(',').map(w => w.trim()) : [],
      } : undefined,
      mistralVoxtralRealtime: sttProvider === 'mistral-voxtral-realtime' ? {
        apiKey: env.MISTRAL_API_KEY || '',
        model: env.MISTRAL_VOXTRAL_MODEL || 'voxtral-mini-transcribe-realtime-2602',
        sampleRate: parseInt(env.MISTRAL_VOXTRAL_SAMPLE_RATE || '16000', 10),
        language: env.MISTRAL_VOXTRAL_LANGUAGE,
      } : undefined,
      deepgram: sttProvider === 'deepgram' ? {
        apiKey: env.DEEPGRAM_API_KEY || '',
        model: env.DEEPGRAM_STT_MODEL || 'nova-3',
        language: env.DEEPGRAM_STT_LANGUAGE || 'en-US',
        sampleRate: parseInt(env.DEEPGRAM_STT_SAMPLE_RATE || '16000', 10),
      } : undefined,
      modulate: sttProvider === 'modulate' ? {
        apiKey: env.MODULATE_API_KEY || '',
        sampleRate: parseInt(env.MODULATE_SAMPLE_RATE || '24000', 10),
        numChannels: parseInt(env.MODULATE_NUM_CHANNELS || '1', 10),
        audioFormat: env.MODULATE_AUDIO_FORMAT || 's16le',
        speakerDiarization: env.MODULATE_SPEAKER_DIARIZATION === 'true',
        emotionSignal: env.MODULATE_EMOTION_SIGNAL === 'true',
        accentSignal: env.MODULATE_ACCENT_SIGNAL === 'true',
        piiPhiTagging: env.MODULATE_PII_PHI_TAGGING === 'true',
        partialResults: env.MODULATE_PARTIAL_RESULTS !== 'false',
        batchUrl: env.MODULATE_BATCH_URL || 'https://modulate-developer-apis.com/api/velma-2-stt-batch',
        streamingUrl: env.MODULATE_STREAMING_URL || 'wss://modulate-developer-apis.com/api/velma-2-stt-streaming',
      } : undefined,
    },
    tts: {
      provider: ttsProvider,
      inworld: ttsProvider === 'inworld' ? {
        apiKey: env.INWORLD_API_KEY || '',
        modelId: env.INWORLD_MODEL_ID || 'inworld-tts-1.5-mini',
        voiceId: env.INWORLD_VOICE_ID || 'Ashley',
        sampleRate: parseInt(env.INWORLD_SAMPLE_RATE || '48000', 10),
      } : undefined,
      deepgram: ttsProvider === 'deepgram' ? {
        apiKey: env.DEEPGRAM_API_KEY || '',
        model: env.DEEPGRAM_TTS_MODEL || 'aura-2-thalia-en',
        sampleRate: parseInt(env.DEEPGRAM_TTS_SAMPLE_RATE || '24000', 10),
        encoding: env.DEEPGRAM_TTS_ENCODING || 'linear16',
      } : undefined,
    },
    vad: {
      enabled: vadProvider !== 'none',
      provider: vadProvider,
      silero: vadProvider === 'silero' ? {
        threshold: parseFloat(env.VAD_THRESHOLD || '0.5'),
        minSilenceDurationMs: parseInt(env.VAD_MIN_SILENCE_MS || '550', 10),
        speechPadMs: parseInt(env.VAD_SPEECH_PAD_MS || '0', 10),
        sampleRate: 16000,
        modelPath: env.SILERO_VAD_MODEL_PATH,
      } : undefined,
    },
  };

  // Validate configuration
  try {
    return ProviderConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      getEventSystem().error(EventCategory.PROVIDER, 'Provider configuration validation failed:');
      for (const issue of error.issues) {
        getEventSystem().error(EventCategory.PROVIDER, `   - ${issue.path.join('.')}: ${issue.message}`);
      }
      throw new Error('Invalid provider configuration');
    }
    throw error;
  }
}

/**
 * Singleton provider configuration
 * Only load in Bun environment; in Workers, this returns a default config
 */
export const providerConfig = (() => {
  // In Workers, return a minimal default config that satisfies the schema
  // Workers will use their own Env binding via loadWorkersConfig()
  if (typeof Bun === 'undefined') {
    return {
      stt: {
        provider: 'groq-whisper' as const,
        groqWhisper: {
          apiKey: '',
          model: 'moonshotai/kimi-k2-instruct-0905',
          whisperModel: 'whisper-large-v3',
        },
      },
      tts: {
        provider: 'deepgram' as const,
        deepgram: {
          apiKey: '',
          model: 'aura-2-thalia-en',
          sampleRate: 24000,
          encoding: 'linear16',
        },
      },
      vad: {
        provider: 'silero' as const,
        enabled: true,
        silero: {
          threshold: 0.5,
          minSilenceDurationMs: 550,
          speechPadMs: 0,
          sampleRate: 16000,
        },
      },
    } as ProviderConfig;
  }
  
  // In Bun, load from environment
  return loadProviderConfig();
})();

/**
 * Display provider configuration on startup
 */
export function displayProviderConfig(): void {
  getEventSystem().info(EventCategory.PROVIDER, 'Provider Configuration:');
  getEventSystem().info(EventCategory.STT, `   STT: ${providerConfig.stt.provider}`);
  getEventSystem().info(EventCategory.TTS, `   TTS: ${providerConfig.tts.provider}`);
  getEventSystem().info(EventCategory.VAD, `   VAD: ${providerConfig.vad.provider} (${providerConfig.vad.enabled ? 'enabled' : 'disabled'})`);
  getEventSystem().info(EventCategory.PROVIDER, '');
}
