/**
 * Shared engine configuration schema.
 *
 * This module is storage-agnostic. Hosted runtimes may load this schema from R2,
 * while self-hosted runtimes can source equivalent config through other means.
 */

export type ConfigEnvironment = 'testing' | 'dev' | 'staging' | 'production';

/** Provider preset configuration (LLM + TTS + STT stack) */
export interface PresetConfig {
  name: string;
  description?: string;
  llm: {
    provider: string;
    model: string;
    tokensPerHourRate?: number;
    costMultiplier?: number;
  };
  stt: {
    provider: string;
    sampleRate?: number;
    numChannels?: number;
    audioFormat?: string;
    encoding?: string;
    whisperModel?: string;
    costPerHour?: number;
  };
  tts: {
    provider: string;
    voice?: string;
    sampleRate?: number;
    costPerHour?: number;
  };
  vad?: {
    provider: string;
    enabled?: boolean;
  };
}

/** Engine settings section (VAD, turn detection, agent, etc.) */
export interface SettingsConfig {
  vad?: {
    enabled?: boolean;
    threshold?: number;
    minSilenceMs?: number;
    speechPadMs?: number;
  };
  turnDetection?: {
    enabled?: boolean;
    provider?: string;
    model?: string;
    debounceMs?: number;
    timeoutMs?: number;
  };
  languageDetection?: { enabled?: boolean };
  callDuration?: {
    maxCallDurationMs?: number;
    maxIdleDurationMs?: number;
  };
  agent?: {
    useModularAgents?: boolean;
    defaultType?: string;
    disableStreaming?: boolean;
    maxStreamRetries?: number;
    maxToolRetries?: number;
    maxSteps?: number;
    defaultTemperature?: number | null;
    defaultFrequencyPenalty?: number;
    defaultPresencePenalty?: number;
    defaultRepetitionPenalty?: number;
  };
  speech?: { defaultMode?: string };
  subagent?: {
    enabled?: boolean;
    model?: string | null;
    provider?: string | null;
    temperature?: number;
    maxTokens?: number;
  };
  posthog?: { enabled?: boolean; host?: string };
  acknowledgement?: {
    enabled?: boolean;
    delayMs?: number;
    phrases?: string[];
  };
  typingSound?: {
    enabled?: boolean;
    r2Key?: string;
    volume?: number;
    loopDurationMs?: number;
  };
  clickSound?: {
    r2Key?: string;
    probability?: number;
  };
  audio?: {
    sampleRate?: number;
    format?: string;
    channels?: number;
  };
}

/** Complete engine configuration (YAML schema) */
export interface EngineConfig {
  version: string;
  lastUpdated: string;
  environment: ConfigEnvironment;
  presets: Record<string, PresetConfig>;
  defaultPreset: string;
  settings: SettingsConfig;
}
