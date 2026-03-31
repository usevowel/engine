/**
 * OSS Provider Registration
 * 
 * Registers all OSS-capable providers.
 * This is called by the OSS engine on initialization.
 */

import { z } from 'zod';
import { ProviderRegistry } from './ProviderRegistry';
import { GroqWhisperSTT } from '../../../packages/provider-groq-whisper-stt/src';
import { MistralVoxtralRealtimeSTT } from '../../../packages/provider-mistral-voxtral-realtime-stt/src';
import { DeepgramSTT } from '../../../packages/provider-deepgram-stt/src';
import { DeepgramTTS } from '../../../packages/provider-deepgram-tts/src';
import {
  GroqWhisperConfig,
  MistralVoxtralRealtimeConfig,
  DeepgramSTTConfig,
  DeepgramTTSConfig,
} from '../../config/providers';

// ── Registration ────────────────────────────────────────────────────────────

let ossProvidersRegistered = false;

export function registerOSSProviders(): void {
  if (ossProvidersRegistered) return;

  // STT Providers
  ProviderRegistry.registerSTT({
    name: 'groq-whisper',
    category: 'stt',
    capabilities: {
      supportsStreaming: false,
      supportsVAD: false,
      supportsLanguageDetection: true,
      supportsMultipleVoices: false,
      requiresNetwork: true,
      supportsGPU: false,
    },
    configSchema: GroqWhisperConfig,
    costConfig: {
      costPerMinute: 0.18,
      unit: 'minute',
      notes: 'Whisper Large V3 on Groq',
    },
    factory: (config) => {
      return new GroqWhisperSTT(config.apiKey, {
        model: config.model,
        whisperModel: config.whisperModel,
      });
    },
  });

  ProviderRegistry.registerSTT({
    name: 'mistral-voxtral-realtime',
    category: 'stt',
    capabilities: {
      supportsStreaming: true,
      supportsVAD: true,
      supportsLanguageDetection: false,
      supportsMultipleVoices: false,
      requiresNetwork: true,
      supportsGPU: false,
    },
    configSchema: MistralVoxtralRealtimeConfig,
    factory: (config) => {
      return new MistralVoxtralRealtimeSTT(config.apiKey, config);
    },
  });

  ProviderRegistry.registerSTT({
    name: 'deepgram',
    category: 'stt',
    capabilities: {
      supportsStreaming: true,
      supportsVAD: false,
      supportsLanguageDetection: true,
      supportsMultipleVoices: false,
      requiresNetwork: true,
      supportsGPU: false,
    },
    configSchema: DeepgramSTTConfig,
    factory: (config) => {
      return new DeepgramSTT(config.apiKey, {
        model: config.model,
        language: config.language,
        sampleRate: config.sampleRate,
      });
    },
  });

  // TTS Providers
  ProviderRegistry.registerTTS({
    name: 'deepgram',
    category: 'tts',
    capabilities: {
      supportsStreaming: true,
      supportsVAD: false,
      supportsLanguageDetection: false,
      supportsMultipleVoices: true,
      requiresNetwork: true,
      supportsGPU: false,
    },
    configSchema: DeepgramTTSConfig,
    costConfig: {
      costPerCharacter: 0.00005,
      costPerMinute: 0.05,
      unit: 'character',
      notes: 'Aura-2 models, low latency',
    },
    factory: (config) => {
      return new DeepgramTTS(config.apiKey, {
        model: config.model,
        sampleRate: config.sampleRate,
        encoding: config.encoding,
      });
    },
  });

  // VAD — 'none' only (Silero registered by Node runtime)
  ProviderRegistry.registerVAD({
    name: 'none',
    category: 'vad',
    capabilities: {
      supportsStreaming: false,
      supportsVAD: false,
      supportsLanguageDetection: false,
      supportsMultipleVoices: false,
      requiresNetwork: false,
      supportsGPU: false,
    },
    configSchema: z.object({ enabled: z.literal(false) }),
    factory: () => null as any,
  });

  ossProvidersRegistered = true;
}
