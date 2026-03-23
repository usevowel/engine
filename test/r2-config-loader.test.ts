/**
 * R2ConfigLoader Tests
 *
 * Tests for loading YAML engine config from R2 (via mocked bucket).
 * Verifies parsing, structure validation, and that config can drive engine components.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  R2ConfigLoader,
  type R2BucketLike,
  type R2ObjectBody,
  type EngineConfig,
  type PresetConfig,
} from '../src/config/loaders/R2ConfigLoader';
import { getProvider, isValidProvider, type SupportedProvider } from '../src/services/providers/llm';

/** Create a mock R2 bucket that returns the given YAML content for config keys */
function createMockR2Bucket(yamlByKey: Record<string, string>): R2BucketLike {
  return {
    async get(key: string): Promise<R2ObjectBody | null> {
      const content = yamlByKey[key];
      if (!content) return null;
      return {
        text: () => Promise.resolve(content),
      };
    },
  };
}

/** Load dev.yaml from engine-config for use in tests */
function loadDevYaml(): string {
  const path = join(import.meta.dir, '../engine-config/dev.yaml');
  return readFileSync(path, 'utf-8');
}

describe('R2ConfigLoader', () => {
  describe('loadConfig', () => {
    test('loads dev config from mocked R2 bucket', async () => {
      const devYaml = loadDevYaml();
      const bucket = createMockR2Bucket({
        'config/dev.yaml': devYaml,
      });
      const loader = new R2ConfigLoader(bucket);

      const config = await loader.loadConfig('dev');

      expect(config).toBeDefined();
      expect(config.version).toBe('1.0.0');
      expect(config.environment).toBe('dev');
      expect(config.presets).toBeDefined();
      expect(config.settings).toBeDefined();
      expect(config.defaultPreset).toBe('prime');
    });

    test('throws when config key not found in R2', async () => {
      const bucket = createMockR2Bucket({});
      const loader = new R2ConfigLoader(bucket);

      await expect(loader.loadConfig('dev')).rejects.toThrow(
        /Engine config not found in R2: config\/dev\.yaml/
      );
    });

    test('validates required sections (presets, settings)', async () => {
      const bucket = createMockR2Bucket({
        'config/dev.yaml': 'version: "1.0"\nenvironment: "dev"',
      });
      const loader = new R2ConfigLoader(bucket);

      await expect(loader.loadConfig('dev')).rejects.toThrow(
        /missing or invalid presets/
      );
    });

    test('caches config within TTL', async () => {
      const devYaml = loadDevYaml();
      let getCount = 0;
      const bucket: R2BucketLike = {
        async get(key: string): Promise<R2ObjectBody | null> {
          getCount++;
          if (key === 'config/dev.yaml') {
            return { text: () => Promise.resolve(devYaml) };
          }
          return null;
        },
      };
      const loader = new R2ConfigLoader(bucket);

      await loader.loadConfig('dev');
      await loader.loadConfig('dev');
      await loader.loadConfig('dev');

      expect(getCount).toBe(1);
    });
  });

  describe('getPresets', () => {
    test('returns presets from dev config', async () => {
      const devYaml = loadDevYaml();
      const bucket = createMockR2Bucket({ 'config/dev.yaml': devYaml });
      const loader = new R2ConfigLoader(bucket);

      const presets = await loader.getPresets('dev');

      expect(presets.prime).toBeDefined();
      expect(presets.prime.llm.provider).toBe('groq');
      expect(presets.prime.llm.model).toBe('openai/gpt-oss-120b');
      expect(presets.prime.stt.provider).toBe('assemblyai');
      expect(presets.prime.tts.provider).toBe('inworld');
      expect(presets.prime.tts.voice).toBe('Alex');
      expect(presets.prime.vad.provider).toBe('assemblyai-integrated');
      expect(presets.prime.vad.enabled).toBe(true);
    });
  });

  describe('getSettings', () => {
    test('returns settings from dev config', async () => {
      const devYaml = loadDevYaml();
      const bucket = createMockR2Bucket({ 'config/dev.yaml': devYaml });
      const loader = new R2ConfigLoader(bucket);

      const settings = await loader.getSettings('dev');

      expect(settings.vad?.enabled).toBe(true);
      expect(settings.turnDetection?.enabled).toBe(true);
      expect(settings.agent?.useModularAgents).toBe(true);
      expect(settings.agent?.defaultType).toBe('custom');
      expect(settings.callDuration?.maxCallDurationMs).toBe(1800000);
      expect(settings.audio?.sampleRate).toBe(24000);
    });
  });


  describe('resolveEnvironment', () => {
    test('uses dev when passing "dev"', async () => {
      const devYaml = loadDevYaml();
      const bucket = createMockR2Bucket({
        'config/dev.yaml': devYaml,
        'config/production.yaml': devYaml.replace('environment: "dev"', 'environment: "production"'),
      });
      const loader = new R2ConfigLoader(bucket);

      const config = await loader.loadConfig('dev');
      expect(config.environment).toBe('dev');
    });
  });
});

describe('Engine instantiation from config', () => {
  test('prime preset LLM provider can be instantiated via getProvider', async () => {
    const devYaml = loadDevYaml();
    const bucket = createMockR2Bucket({ 'config/dev.yaml': devYaml });
    const loader = new R2ConfigLoader(bucket);

    const config = await loader.loadConfig('dev');
    const preset: PresetConfig = config.presets[config.defaultPreset];

    expect(isValidProvider(preset.llm.provider)).toBe(true);
    const provider = getProvider(preset.llm.provider as SupportedProvider, {
      apiKey: 'test-key-for-instantiation',
    });
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
  });

  test('prime preset LLM provider can be instantiated', async () => {
    const devYaml = loadDevYaml();
    const bucket = createMockR2Bucket({ 'config/dev.yaml': devYaml });
    const loader = new R2ConfigLoader(bucket);

    const presets = await loader.getPresets('dev');
    const primePreset = presets.prime;

    expect(primePreset.llm.provider).toBe('groq');
    expect(isValidProvider(primePreset.llm.provider)).toBe(true);
    const provider = getProvider('groq', { apiKey: 'test-key' });
    expect(provider).toBeDefined();
  });

  test('config presets match supported LLM providers', async () => {
    const devYaml = loadDevYaml();
    const bucket = createMockR2Bucket({ 'config/dev.yaml': devYaml });
    const loader = new R2ConfigLoader(bucket);

    const config = await loader.loadConfig('dev');

    for (const [presetName, preset] of Object.entries(config.presets)) {
      const llmProvider = preset.llm.provider;
      expect(
        isValidProvider(llmProvider),
        `Preset "${presetName}" has unsupported LLM provider: ${llmProvider}`
      ).toBe(true);
    }
  });
});
