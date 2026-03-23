/**
 * R2 Configuration Loader
 *
 * Loads YAML engine configuration from Cloudflare R2 bucket (sndbrd-store/config/{environment}.yaml).
 * Config files are pushed via `bun run engine-config:push`.
 *
 * @see engine-config/README.md
 * @see .ai/plans/sndbrd-v2.0/config-refactor/README.md
 */

import yaml from 'js-yaml';

/** R2 bucket interface (Cloudflare Workers binding) */
export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBody | null>;
}

/** R2 object body (subset of Cloudflare types) */
export interface R2ObjectBody {
  text(): Promise<string>;
}

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

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Loads engine configuration from R2 bucket.
 * Uses in-memory cache with 5-minute TTL to avoid repeated R2 reads.
 */
export class R2ConfigLoader {
  private readonly r2Bucket: R2BucketLike;
  private readonly cache = new Map<
    ConfigEnvironment,
    { config: EngineConfig; timestamp: number }
  >();

  constructor(r2Bucket: R2BucketLike) {
    this.r2Bucket = r2Bucket;
  }

  /**
   * Load complete engine config from R2.
   *
   * @param environmentOverride - Explicit env (testing|dev|staging|production). If not provided,
   *   derives from NODE_ENV: production→production, staging→staging, else→dev.
   *   Prefer passing CONFIG_ENV from wrangler vars to distinguish testing vs dev.
   */
  async loadConfig(
    environmentOverride?: string | null
  ): Promise<EngineConfig> {
    const environment = this.resolveEnvironment(environmentOverride);

    const cached = this.cache.get(environment);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.config;
    }

    const configKey = `config/${environment}.yaml`;
    const object = await this.r2Bucket.get(configKey);
    if (!object) {
      throw new Error(`Engine config not found in R2: ${configKey}`);
    }

    const yamlText = await object.text();
    const parsed = yaml.load(yamlText) as unknown;
    const config = this.validateAndCast(parsed);

    this.cache.set(environment, {
      config,
      timestamp: Date.now(),
    });

    return config;
  }

  /** Get presets section only */
  async getPresets(
    environmentOverride?: string | null
  ): Promise<Record<string, PresetConfig>> {
    const config = await this.loadConfig(environmentOverride);
    return config.presets;
  }

  /** Get settings section only */
  async getSettings(
    environmentOverride?: string | null
  ): Promise<SettingsConfig> {
    const config = await this.loadConfig(environmentOverride);
    return config.settings;
  }

  /**
   * Resolve config environment. Caller should pass env.CONFIG_ENV ?? env.NODE_ENV
   * (CONFIG_ENV in wrangler.toml distinguishes testing vs dev when both use NODE_ENV=development).
   */
  private resolveEnvironment(
    override?: string | null
  ): ConfigEnvironment {
    if (override && this.isValidEnvironment(override)) {
      return override as ConfigEnvironment;
    }
    if (override === 'staging') return 'staging';
    if (override === 'production') return 'production';
    if (override === 'development') return 'dev';
    return 'production';
  }

  private isValidEnvironment(s: string): s is ConfigEnvironment {
    return ['testing', 'dev', 'staging', 'production'].includes(s);
  }

  private validateAndCast(parsed: unknown): EngineConfig {
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid engine config: not an object');
    }
    const obj = parsed as Record<string, unknown>;
    if (!obj.presets || typeof obj.presets !== 'object') {
      throw new Error('Invalid engine config: missing or invalid presets');
    }
    if (!obj.settings || typeof obj.settings !== 'object') {
      throw new Error('Invalid engine config: missing or invalid settings');
    }
    return obj as unknown as EngineConfig;
  }
}
