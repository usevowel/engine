/**
 * Engine config tests
 *
 * Verifies the shared engine config schema and config application helpers without
 * depending on hosted-only storage concerns such as Cloudflare R2.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import { join } from 'path';
import type { EngineConfig, PresetConfig } from '../src/config/EngineConfig';
import { mergeR2ConfigIntoEnv } from '../src/config/env-merger';
import { getProvider, isValidProvider, type SupportedProvider } from '../src/services/providers/llm';

function loadDevConfig(): EngineConfig {
  const path = join(import.meta.dir, '../engine-config/dev.yaml');
  const yamlText = readFileSync(path, 'utf-8');
  return yaml.load(yamlText) as EngineConfig;
}

describe('EngineConfig', () => {
  test('loads dev config from YAML fixture', () => {
    const config = loadDevConfig();

    expect(config).toBeDefined();
    expect(config.version).toBe('1.0.0');
    expect(config.environment).toBe('dev');
    expect(config.presets).toBeDefined();
    expect(config.settings).toBeDefined();
    expect(config.defaultPreset).toBe('prime');
  });

  test('applies shared config into env-like runtime values', () => {
    const config = loadDevConfig();
    const merged = mergeR2ConfigIntoEnv({}, config);

    expect(merged.USE_MODULAR_AGENTS).toBe('true');
    expect(merged.TURN_DETECTION_ENABLED).toBe('true');
    expect(merged.MAX_CALL_DURATION_MS).toBe('1800000');
    expect(merged.LLM_PROVIDER).toBe('groq');
    expect(merged.STT_PROVIDER).toBe('deepgram');
    expect(merged.TTS_PROVIDER).toBe('deepgram');
    expect(merged.VAD_PROVIDER).toBe('silero');
  });

  test('returns expected preset fields from shared schema', () => {
    const config = loadDevConfig();
    const preset = config.presets.prime;

    expect(preset).toBeDefined();
    expect(preset.llm.provider).toBe('groq');
    expect(preset.llm.model).toBe('openai/gpt-oss-120b');
    expect(preset.stt.provider).toBe('deepgram');
    expect(preset.tts.provider).toBe('deepgram');
    expect(preset.vad?.provider).toBe('silero');
    expect(preset.vad?.enabled).toBe(true);
  });
});

describe('Engine instantiation from config', () => {
  test('default preset LLM provider can be instantiated via getProvider', () => {
    const config = loadDevConfig();
    const preset: PresetConfig = config.presets[config.defaultPreset];

    expect(isValidProvider(preset.llm.provider)).toBe(true);
    const provider = getProvider(preset.llm.provider as SupportedProvider, {
      apiKey: 'test-key-for-instantiation',
    });
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
  });

  test('all presets match supported LLM providers', () => {
    const config = loadDevConfig();

    for (const [presetName, preset] of Object.entries(config.presets)) {
      const llmProvider = preset.llm.provider;
      expect(
        isValidProvider(llmProvider),
        `Preset "${presetName}" has unsupported LLM provider: ${llmProvider}`
      ).toBe(true);
    }
  });
});
