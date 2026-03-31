/**
 * Environment Merger - R2 YAML config overrides for Workers Env
 *
 * Merges engine config from R2 (YAML) into Workers Env. YAML values override env vars.
 * Exception: For API keys (secrets), env vars take precedence over YAML for security.
 *
 * @see engine-config/ - YAML configs
 * @see R2ConfigLoader - Loads config from R2
 */

import type { EngineConfig } from './loaders/R2ConfigLoader';
import { getEventSystem, EventCategory } from '../events';

/** Env-like record (string values for Workers compatibility) */
export type EnvLike = Record<string, string | undefined>;

/**
 * Merge R2 config into env. YAML runtime + secrets overlay env.
 * For secrets: env overrides YAML (security - never commit secrets to YAML in prod).
 *
 * @param env - Workers env (base)
 * @param config - R2 engine config (overrides)
 * @returns Merged env-like object
 */
export function mergeR2ConfigIntoEnv(env: EnvLike, config: EngineConfig): EnvLike {
  const merged: EnvLike = { ...env };

  // 1. Apply runtime overrides from YAML (maps to env var names)
  const runtime = (config as any).runtime;
  if (runtime && typeof runtime === 'object') {
    for (const [key, value] of Object.entries(runtime)) {
      if (value !== undefined && value !== null && typeof value === 'string') {
        merged[key] = value;
      } else if (typeof value === 'boolean') {
        merged[key] = value ? 'true' : 'false';
      } else if (typeof value === 'number') {
        merged[key] = String(value);
      }
    }
  }

  // 2. Apply secrets from YAML - only if env does NOT have the value (env overrides for security)
  const secrets = (config as any).secrets;
  if (secrets && typeof secrets === 'object') {
    const secretKeys = [
      'GROQ_API_KEY',
      'OPENROUTER_API_KEY',
      'CEREBRAS_API_KEY',
      'ASSEMBLYAI_API_KEY',
      'MODULATE_API_KEY',
      'INWORLD_API_KEY',
      'FENNEC_API_KEY',
      'POLAR_API_KEY',
      'POSTHOG_API_KEY',
    ];
    for (const key of secretKeys) {
      const yamlValue = (secrets as Record<string, string>)[key];
      if (yamlValue && typeof yamlValue === 'string' && !env[key]) {
        merged[key] = yamlValue;
      }
    }
  }

  // 3. Apply settings.agent to env vars
  const agent = config.settings?.agent;
  if (agent) {
    if (agent.useModularAgents !== undefined) {
      merged.USE_MODULAR_AGENTS = agent.useModularAgents ? 'true' : 'false';
    }
    if (agent.defaultType) {
      merged.DEFAULT_AGENT_TYPE = agent.defaultType;
    }
    if (agent.maxSteps !== undefined) {
      merged.MAX_STEPS = String(agent.maxSteps);
    }
    if (agent.defaultTemperature !== undefined) {
      merged.DEFAULT_TEMPERATURE = agent.defaultTemperature === null ? '' : String(agent.defaultTemperature);
    }
    if (agent.defaultFrequencyPenalty !== undefined) {
      merged.DEFAULT_FREQUENCY_PENALTY = String(agent.defaultFrequencyPenalty);
    }
    if (agent.defaultPresencePenalty !== undefined) {
      merged.DEFAULT_PRESENCE_PENALTY = String(agent.defaultPresencePenalty);
    }
    if (agent.defaultRepetitionPenalty !== undefined) {
      merged.DEFAULT_REPETITION_PENALTY = String(agent.defaultRepetitionPenalty);
    }
  }

  // 4. Apply settings.vad
  const vad = config.settings?.vad;
  if (vad) {
    if (vad.enabled !== undefined) {
      merged.VAD_ENABLED = vad.enabled ? 'true' : 'false';
    }
    if (vad.threshold !== undefined) merged.VAD_THRESHOLD = String(vad.threshold);
    if (vad.minSilenceMs !== undefined) merged.VAD_MIN_SILENCE_MS = String(vad.minSilenceMs);
    if (vad.speechPadMs !== undefined) merged.VAD_SPEECH_PAD_MS = String(vad.speechPadMs);
  }

  // 5. Apply settings.turnDetection
  const turnDetection = config.settings?.turnDetection;
  if (turnDetection) {
    if (turnDetection.enabled !== undefined) {
      merged.TURN_DETECTION_ENABLED = turnDetection.enabled ? 'true' : 'false';
    }
    if (turnDetection.provider) merged.TURN_DETECTION_LLM_PROVIDER = turnDetection.provider;
    if (turnDetection.model) merged.TURN_DETECTION_LLM_MODEL = turnDetection.model;
    if (turnDetection.debounceMs !== undefined) merged.TURN_DETECTION_DEBOUNCE_MS = String(turnDetection.debounceMs);
    if (turnDetection.timeoutMs !== undefined) merged.TURN_DETECTION_TIMEOUT_MS = String(turnDetection.timeoutMs);
  }

  // 6. Apply settings.callDuration
  const callDuration = config.settings?.callDuration;
  if (callDuration) {
    if (callDuration.maxCallDurationMs !== undefined) {
      merged.MAX_CALL_DURATION_MS = String(callDuration.maxCallDurationMs);
    }
    if (callDuration.maxIdleDurationMs !== undefined) {
      merged.MAX_IDLE_DURATION_MS = String(callDuration.maxIdleDurationMs);
    }
  }

  // 7. Apply settings.languageDetection
  const langDet = config.settings?.languageDetection;
  if (langDet?.enabled !== undefined) {
    merged.LANGUAGE_DETECTION_ENABLED = langDet.enabled ? 'true' : 'false';
  }

  // 8. Apply settings.speech
  const speech = config.settings?.speech;
  if (speech?.defaultMode) {
    merged.DEFAULT_SPEECH_MODE = speech.defaultMode;
  }

  // 9. Apply settings.subagent
  const subagent = config.settings?.subagent;
  if (subagent) {
    if (subagent.enabled !== undefined) {
      merged.SUBAGENT_ENABLED = subagent.enabled ? 'true' : 'false';
    }
    if (subagent.model) merged.SUBAGENT_MODEL = subagent.model;
    if (subagent.provider) merged.SUBAGENT_PROVIDER = subagent.provider;
    if (subagent.temperature !== undefined) merged.SUBAGENT_TEMPERATURE = String(subagent.temperature);
    if (subagent.maxTokens !== undefined) merged.SUBAGENT_MAX_TOKENS = String(subagent.maxTokens);
  }

  // 10. Apply presets default for provider selection (if in runtime)
  const defaultPreset = config.presets?.[config.defaultPreset];
  if (defaultPreset) {
    if (!merged.STT_PROVIDER && defaultPreset.stt?.provider) {
      merged.STT_PROVIDER = defaultPreset.stt.provider;
    }
    if (!merged.TTS_PROVIDER && defaultPreset.tts?.provider) {
      merged.TTS_PROVIDER = defaultPreset.tts.provider;
    }
    if (!merged.LLM_PROVIDER && defaultPreset.llm?.provider) {
      merged.LLM_PROVIDER = defaultPreset.llm.provider;
    }
    if (!merged.OPENROUTER_MODEL && defaultPreset.llm?.model) {
      merged.OPENROUTER_MODEL = defaultPreset.llm.model;
    }
    if (!merged.GROQ_MODEL && defaultPreset.llm?.model) {
      merged.GROQ_MODEL = defaultPreset.llm.model;
    }
    if (!merged.WORKERS_AI_MODEL && defaultPreset.llm?.model) {
      merged.WORKERS_AI_MODEL = defaultPreset.llm.model;
    }
    if (!merged.INWORLD_VOICE && defaultPreset.tts?.voice) {
      merged.INWORLD_VOICE = defaultPreset.tts.voice;
    }
    if (!merged.ASSEMBLYAI_SAMPLE_RATE && defaultPreset.stt?.sampleRate) {
      merged.ASSEMBLYAI_SAMPLE_RATE = String(defaultPreset.stt.sampleRate);
    }
    if (!merged.ASSEMBLYAI_ENCODING && defaultPreset.stt?.encoding) {
      merged.ASSEMBLYAI_ENCODING = defaultPreset.stt.encoding;
    }
    if (!merged.MODULATE_SAMPLE_RATE && defaultPreset.stt?.provider === 'modulate' && defaultPreset.stt?.sampleRate) {
      merged.MODULATE_SAMPLE_RATE = String(defaultPreset.stt.sampleRate);
    }
    if (!merged.MODULATE_NUM_CHANNELS && defaultPreset.stt?.provider === 'modulate' && defaultPreset.stt?.numChannels) {
      merged.MODULATE_NUM_CHANNELS = String(defaultPreset.stt.numChannels);
    }
    if (!merged.MODULATE_AUDIO_FORMAT && defaultPreset.stt?.provider === 'modulate' && defaultPreset.stt?.audioFormat) {
      merged.MODULATE_AUDIO_FORMAT = defaultPreset.stt.audioFormat;
    }
    if (!merged.INWORLD_SAMPLE_RATE && defaultPreset.tts?.sampleRate) {
      merged.INWORLD_SAMPLE_RATE = String(defaultPreset.tts.sampleRate);
    }
    if (defaultPreset.vad) {
      if (!merged.VAD_PROVIDER) merged.VAD_PROVIDER = defaultPreset.vad.provider;
      if (defaultPreset.vad.enabled !== undefined && !merged.VAD_ENABLED) {
        merged.VAD_ENABLED = defaultPreset.vad.enabled ? 'true' : 'false';
      }
    }
  }

  return merged;
}
