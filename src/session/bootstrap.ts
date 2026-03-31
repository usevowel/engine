/**
 * Shared session bootstrap utilities used by runtime adapters.
 */

import type { SessionData } from './types';
import type { RuntimeConfig } from '../config/RuntimeConfig';
import { getEventSystem, EventCategory } from '../events';

const DEFAULT_VALUES = {
  speakingRate: 1.2,
  vadThreshold: '0.5',
  vadMinSilenceMs: '550',
  vadSpeechPadMs: '0',
  defaultVoice: 'Ashley',
} as const;

export interface SessionBootstrapEnv {
  DEFAULT_VOICE?: string;
  STT_PROVIDER?: string;
  VAD_PROVIDER?: string;
  VAD_ENABLED?: string;
  VAD_THRESHOLD?: string;
  VAD_MIN_SILENCE_MS?: string;
  VAD_SPEECH_PAD_MS?: string;
  POSTHOG_API_KEY?: string;
  POSTHOG_ENABLED?: string;
  POSTHOG_HOST?: string;
  POSTHOG_API_HOST?: string;
  LANGUAGE_DETECTION_ENABLED?: string;
  DEFAULT_TEMPERATURE?: string;
  DEFAULT_FREQUENCY_PENALTY?: string;
  DEFAULT_PRESENCE_PENALTY?: string;
  DEFAULT_REPETITION_PENALTY?: string;
  GROQ_REASONING_EFFORT?: string;
}

export interface TokenAgentConfig {
  testMode?: boolean;
  agentMaxSteps?: number;
  agentMaxContextMessages?: number;
  agentTemperature?: number;
  agentMaxTokens?: number;
  agentFrequencyPenalty?: number;
  agentPresencePenalty?: number;
  agentRepetitionPenalty?: number;
}

function buildTurnDetectionConfig(env: SessionBootstrapEnv): any | null {
  const vadProvider = env.VAD_PROVIDER || 'silero';
  const vadEnabled = vadProvider !== 'none' && env.VAD_ENABLED !== 'false';

  if (!vadEnabled) {
    return null;
  }

  return {
    type: 'server_vad',
    threshold: parseFloat(env.VAD_THRESHOLD || DEFAULT_VALUES.vadThreshold),
    silence_duration_ms: parseInt(env.VAD_MIN_SILENCE_MS || DEFAULT_VALUES.vadMinSilenceMs),
    prefix_padding_ms: parseInt(env.VAD_SPEECH_PAD_MS || DEFAULT_VALUES.vadSpeechPadMs),
    create_response: true,
  };
}

export function buildSessionConfig(
  sessionId: string,
  model: string,
  env: SessionBootstrapEnv,
  runtimeConfig: RuntimeConfig,
  tokenVoice?: string,
  tokenSpeakingRate?: number,
  initialGreetingPrompt?: string,
  tokenInstructions?: string,
  tokenTurnDetection?: any,
  sessionKey?: string,
  tokenLanguage?: string,
  tokenLanguageDetection?: any,
  tokenAgentConfig?: TokenAgentConfig,
  tokenLanguageVoiceMap?: Record<string, string>
): SessionData {
  const defaultVoice = tokenVoice || DEFAULT_VALUES.defaultVoice;
  const speakingRate =
    tokenSpeakingRate ?? DEFAULT_VALUES.speakingRate;
  const vadProvider = env.VAD_PROVIDER || 'silero';
  const vadEnabled = vadProvider !== 'none' && env.VAD_ENABLED !== 'false';
  const turnDetection = buildTurnDetectionConfig(env);

  const posthogConfig =
    env.POSTHOG_API_KEY && env.POSTHOG_ENABLED !== 'false'
      ? {
          apiKey: env.POSTHOG_API_KEY,
          host: env.POSTHOG_HOST || env.POSTHOG_API_HOST || 'https://app.posthog.com',
          enabled: true,
        }
      : undefined;

  let agentConfig: SessionData['agentConfig'] = undefined;

  if (tokenAgentConfig?.testMode) {
    const envDefaults = {
      temperature: env.DEFAULT_TEMPERATURE ? parseFloat(env.DEFAULT_TEMPERATURE) : undefined,
      frequencyPenalty: env.DEFAULT_FREQUENCY_PENALTY ? parseFloat(env.DEFAULT_FREQUENCY_PENALTY) : undefined,
      presencePenalty: env.DEFAULT_PRESENCE_PENALTY ? parseFloat(env.DEFAULT_PRESENCE_PENALTY) : undefined,
      repetitionPenalty: env.DEFAULT_REPETITION_PENALTY ? parseFloat(env.DEFAULT_REPETITION_PENALTY) : undefined,
    };

    agentConfig = {
      maxSteps: tokenAgentConfig.agentMaxSteps ?? 3,
      maxContextMessages: tokenAgentConfig.agentMaxContextMessages ?? 15,
      temperature: tokenAgentConfig.agentTemperature ?? envDefaults.temperature,
      maxTokens: tokenAgentConfig.agentMaxTokens,
      frequencyPenalty: tokenAgentConfig.agentFrequencyPenalty ?? envDefaults.frequencyPenalty,
      presencePenalty: tokenAgentConfig.agentPresencePenalty ?? envDefaults.presencePenalty,
      repetitionPenalty: tokenAgentConfig.agentRepetitionPenalty ?? envDefaults.repetitionPenalty,
    };

    getEventSystem().info(EventCategory.SESSION, '🎛️ Agent config from token (test mode)', agentConfig);
  } else {
    const envDefaults = {
      temperature: env.DEFAULT_TEMPERATURE ? parseFloat(env.DEFAULT_TEMPERATURE) : undefined,
      frequencyPenalty: env.DEFAULT_FREQUENCY_PENALTY ? parseFloat(env.DEFAULT_FREQUENCY_PENALTY) : undefined,
      presencePenalty: env.DEFAULT_PRESENCE_PENALTY ? parseFloat(env.DEFAULT_PRESENCE_PENALTY) : undefined,
      repetitionPenalty: env.DEFAULT_REPETITION_PENALTY ? parseFloat(env.DEFAULT_REPETITION_PENALTY) : undefined,
    };

    if (
      envDefaults.temperature !== undefined ||
      envDefaults.frequencyPenalty !== undefined ||
      envDefaults.presencePenalty !== undefined ||
      envDefaults.repetitionPenalty !== undefined
    ) {
      agentConfig = {
        maxSteps: 3,
        maxContextMessages: 15,
        temperature: envDefaults.temperature,
        frequencyPenalty: envDefaults.frequencyPenalty,
        presencePenalty: envDefaults.presencePenalty,
        repetitionPenalty: envDefaults.repetitionPenalty,
      };
      getEventSystem().info(EventCategory.SESSION, '🎛️ Agent config from env defaults', agentConfig);
    }
  }

  return {
    sessionId,
    model,
    config: {
      modalities: ['text', 'audio'],
      instructions: tokenInstructions || 'You are a helpful assistant.',
      voice: defaultVoice,
      speaking_rate: speakingRate,
      initial_greeting_prompt: initialGreetingPrompt,
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: {
        model: `${env.STT_PROVIDER || 'groq-whisper'}-realtime`,
      },
      turn_detection: turnDetection,
      tools: [],
      tool_choice: 'auto',
      max_response_output_tokens: 'inf',
    },
    audioBuffer: null,
    conversationHistory: [],
    currentTraceId: sessionId,
    currentResponseId: null,
    vadEnabled,
    audioBufferStartMs: 0,
    totalAudioMs: 0,
    runtimeConfig,
    tokenTurnDetection,
    sessionKey,
    posthogConfig,
    language: {
      current: tokenLanguage || null,
      detected: null,
      configured: tokenLanguage || null,
      detectionEnabled:
        tokenLanguageDetection?.enabled ??
        (env.LANGUAGE_DETECTION_ENABLED !== undefined ? env.LANGUAGE_DETECTION_ENABLED === 'true' : true),
    },
    languageVoiceMap: tokenLanguageVoiceMap,
    lastVoicePerLanguage: {},
    agentConfig,
    groqReasoningEffort: env.GROQ_REASONING_EFFORT
      ? (() => {
          const value = env.GROQ_REASONING_EFFORT.toLowerCase();
          getEventSystem().info(
            EventCategory.SESSION,
            `🎯 [buildSessionConfig] GROQ_REASONING_EFFORT from env: ${env.GROQ_REASONING_EFFORT} -> ${value}`
          );
          if (['none', 'low', 'medium', 'high', 'default'].includes(value)) {
            return value as 'none' | 'low' | 'medium' | 'high' | 'default';
          }
          getEventSystem().warn(
            EventCategory.SESSION,
            `⚠️ [buildSessionConfig] Invalid GROQ_REASONING_EFFORT value: ${env.GROQ_REASONING_EFFORT}, ignoring`
          );
          return undefined;
        })()
      : undefined,
  };
}
