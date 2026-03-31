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

// ── Config schemas ──────────────────────────────────────────────────────────

const GroqWhisperConfig = z.object({
  apiKey: z.string().min(1, 'Groq API key is required'),
  model: z.string().default('moonshotai/kimi-k2-instruct-0905'),
  whisperModel: z.string().default('whisper-large-v3'),
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

const DeepgramTTSConfig = z.object({
  apiKey: z.string().min(1, 'Deepgram API key is required'),
  model: z.string().default('aura-2-thalia-en'),
  sampleRate: z.number().default(24000),
  encoding: z.string().default('linear16'),
});

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
