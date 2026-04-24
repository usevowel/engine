/**
 * Provider Configuration
 * 
 * Centralized configuration for OSS provider types.
 * Hosted-only providers are registered separately by engine-hosted.
 */

import { z } from 'zod';
import { getEventSystem, EventCategory } from '../events';

/**
 * OSS-only provider configuration schemas.
 * These are used by OSSProviderRegistration to validate config at runtime.
 */
export const GroqWhisperConfig = z.object({
  apiKey: z.string().min(1, 'Groq API key is required'),
  model: z.string().default('moonshotai/kimi-k2-instruct-0905'),
  whisperModel: z.string().default('whisper-large-v3'),
});

export const MistralVoxtralRealtimeConfig = z.object({
  apiKey: z.string().min(1, 'Mistral API key is required'),
  model: z.string().default('voxtral-mini-transcribe-realtime-2602'),
  sampleRate: z.number().default(16000),
  language: z.string().optional(),
});

export const DeepgramSTTConfig = z.object({
  apiKey: z.string().min(1, 'Deepgram API key is required'),
  model: z.string().default('nova-3'),
  language: z.string().default('en-US'),
  sampleRate: z.number().default(16000),
});

export const DeepgramTTSConfig = z.object({
  apiKey: z.string().min(1, 'Deepgram API key is required'),
  model: z.string().default('aura-2-thalia-en'),
  sampleRate: z.number().default(24000),
  encoding: z.string().default('linear16'),
});

/**
 * xAI Grok speech-to-text (Whisper-class streaming + REST batch).
 *
 * @see https://docs.x.ai/docs/guides/speech-to-text
 */
export const GrokSTTConfig = z.object({
  apiKey: z
    .string()
    .min(
      1,
      'GROK_API_KEY is required when STT_PROVIDER=grok (xAI Grok speech — not the same as GROQ_API_KEY)'
    ),
  model: z.string().default('whisper-large-v3-turbo'),
  language: z.string().default('en-US'),
  /** Align with engine session PCM default (24 kHz) unless the deployment overrides. */
  sampleRate: z.number().default(24000),
});

/**
 * xAI Grok text-to-speech (REST + streaming WebSocket).
 *
 * Voice IDs are normalized in the GrokTTS provider to xAI presets (`rex`, `leo`, …).
 * Arbitrary strings fall back to the default voice so hosted env overrides stay valid at runtime.
 *
 * @see https://docs.x.ai/docs/guides/text-to-speech
 */
export const GrokTTSConfig = z.object({
  apiKey: z
    .string()
    .min(
      1,
      'GROK_API_KEY is required when TTS_PROVIDER=grok (xAI Grok speech — not the same as GROQ_API_KEY)'
    ),
  voice: z.string().default('rex'),
  sampleRate: z.number().default(24000),
  format: z.enum(['pcm16']).default('pcm16'),
});

export const OpenAICompatibleSTTConfig = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().url().default('http://localhost:8000/v1'),
  model: z.string().default('Systran/faster-whisper-tiny'),
  language: z.string().optional(),
  sampleRate: z.number().default(24000),
});

export const OpenAICompatibleTTSConfig = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().url().default('http://localhost:8000/v1'),
  model: z.string().default('onnx-community/Kokoro-82M-v1.0-ONNX'),
  voice: z.string().default('af_heart'),
  sampleRate: z.number().default(24000),
  responseFormat: z.enum(['wav', 'mp3']).default('wav'),
});

export const SileroVADConfig = z.object({
  threshold: z.number().min(0).max(1).default(0.5),
  minSilenceDurationMs: z.number().default(550),
  speechPadMs: z.number().default(0),
  sampleRate: z.number().default(16000),
  modelPath: z.string().optional(),
});

/**
 * Get environment safely (works in both Bun and Workers)
 */
function getEnv(): Record<string, string | undefined> {
  if (typeof Bun !== 'undefined') {
    return Bun.env;
  }
  return {};
}

/**
 * Display provider configuration on startup
 */
export function displayProviderConfig(): void {
  const env = getEnv();
  getEventSystem().info(EventCategory.PROVIDER, '── Provider Configuration ──');
  getEventSystem().info(EventCategory.PROVIDER, `  STT: ${env.STT_PROVIDER || 'groq-whisper'}`);
  getEventSystem().info(EventCategory.PROVIDER, `  TTS: ${env.TTS_PROVIDER || 'deepgram'}`);
  getEventSystem().info(EventCategory.PROVIDER, `  VAD: ${env.VAD_PROVIDER || 'silero'}`);
  getEventSystem().info(EventCategory.PROVIDER, '────────────────────────────');
}
