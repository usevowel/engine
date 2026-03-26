/**
 * Deepgram TTS Provider
 *
 * Streaming and batch text-to-speech using Deepgram's Aura-2 voices.
 * Supports REST batch synthesis and HTTP streaming for low-latency output.
 *
 * TTS Batch: POST https://api.deepgram.com/v1/speak
 * TTS Stream: POST https://api.deepgram.com/v1/speak (streaming response)
 *
 * @see https://developers.deepgram.com/reference/speak
 */

import { BaseTTSProvider } from '../../../src/services/providers/base/BaseTTSProvider';
import {
  ProviderCapabilities,
  TTSSynthesizeOptions,
} from '../../../src/types/providers';
import { getEventSystem, EventCategory } from '../../../src/events';

const DEFAULT_DEEPGRAM_MODEL = 'aura-2-thalia-en';
const WAV_HEADER_BYTES = 44;
const SUPPORTED_DEEPGRAM_MODELS = new Set([
  'aura-2-thalia-en',
  'aura-2-asteria-en',
  'aura-2-angus-en',
  'aura-2-orion-en',
]);

interface DeepgramTTSConfig {
  apiKey: string;
  model?: string;
  voice?: string;
  sampleRate?: number;
  encoding?: string;
}

export class DeepgramTTS extends BaseTTSProvider {
  readonly name = 'deepgram';
  readonly type = 'streaming' as const;

  private apiKey: string;
  private model: string;
  private voice: string;
  private sampleRate: number;
  private encoding: string;

  constructor(apiKey: string, config?: Partial<DeepgramTTSConfig>) {
    super();
    this.apiKey = apiKey;
    this.model = this.resolveDeepgramModel(config?.model ?? config?.voice, 'config');
    this.voice = config?.voice || 'Aura-2-Thalia-en';
    this.sampleRate = config?.sampleRate || 24000;
    this.encoding = config?.encoding || 'linear16';
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Deepgram API key not configured');
    }

    getEventSystem().info(EventCategory.TTS, '✅ Deepgram TTS initialized');
    this.initialized = true;
  }

  async synthesize(
    text: string,
    options?: TTSSynthesizeOptions
  ): Promise<Uint8Array> {
    this.ensureInitialized();

    const model = this.resolveDeepgramModel(options?.voice ?? this.model, options?.voice ? 'options.voice' : 'config.model');
    const sampleRate = options?.sampleRate || this.sampleRate;

    const response = await fetch(this.buildSpeakUrl(model, sampleRate), {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Deepgram synthesis failed: ${response.status} ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return this.normalizeBatchAudio(new Uint8Array(arrayBuffer));
  }

  async *synthesizeStream(
    text: string,
    options?: TTSSynthesizeOptions
  ): AsyncIterableIterator<Uint8Array> {
    this.ensureInitialized();

    const model = this.resolveDeepgramModel(options?.voice ?? this.model, options?.voice ? 'options.voice' : 'config.model');
    const sampleRate = options?.sampleRate || this.sampleRate;

    const response = await fetch(this.buildSpeakUrl(model, sampleRate), {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Deepgram stream synthesis failed: ${response.status} ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get stream reader');
    }

    let buffered = new Uint8Array(0);
    let wavHeaderHandled = false;

    while (true) {
      const result = await reader.read();
      if (result.done) {
        if (buffered.length > 0) {
          getEventSystem().warn(EventCategory.TTS, '⚠️ Deepgram TTS dropped trailing partial PCM sample', {
            bytesDropped: buffered.length,
          });
        }
        return;
      }

      let chunk = this.concatUint8Arrays(buffered, result.value);
      buffered = new Uint8Array(0);

      if (!wavHeaderHandled) {
        const normalized = this.stripLeadingWavHeader(chunk);

        if (normalized.waitForMore) {
          buffered = chunk;
          continue;
        }

        chunk = normalized.audio;
        wavHeaderHandled = true;
      }

      if (chunk.length === 0) {
        continue;
      }

      const evenLength = chunk.length - (chunk.length % 2);
      if (evenLength > 0) {
        yield chunk.slice(0, evenLength);
      }

      if (evenLength < chunk.length) {
        buffered = chunk.slice(evenLength);
      }
    }
  }

  private buildSpeakUrl(model: string, sampleRate: number): string {
    const url = new URL('https://api.deepgram.com/v1/speak');
    url.searchParams.set('model', model);
    url.searchParams.set('encoding', this.encoding);
    url.searchParams.set('sample_rate', sampleRate.toString());
    url.searchParams.set('container', 'none');
    return url.toString();
  }

  private normalizeBatchAudio(audio: Uint8Array): Uint8Array {
    const normalized = this.stripLeadingWavHeader(audio);
    const payload = normalized.audio;
    const evenLength = payload.length - (payload.length % 2);

    if (evenLength === payload.length) {
      return payload;
    }

    getEventSystem().warn(EventCategory.TTS, '⚠️ Deepgram TTS dropped trailing partial PCM sample from batch response', {
      bytesDropped: payload.length - evenLength,
    });
    return payload.slice(0, evenLength);
  }

  private stripLeadingWavHeader(audio: Uint8Array): { audio: Uint8Array; waitForMore: boolean } {
    if (audio.length < 12) {
      return { audio, waitForMore: true };
    }

    if (!this.isWavHeader(audio)) {
      return { audio, waitForMore: false };
    }

    if (audio.length < WAV_HEADER_BYTES) {
      return { audio, waitForMore: true };
    }

    return {
      audio: audio.slice(WAV_HEADER_BYTES),
      waitForMore: false,
    };
  }

  private isWavHeader(audio: Uint8Array): boolean {
    return (
      audio[0] === 0x52 &&
      audio[1] === 0x49 &&
      audio[2] === 0x46 &&
      audio[3] === 0x46 &&
      audio[8] === 0x57 &&
      audio[9] === 0x41 &&
      audio[10] === 0x56 &&
      audio[11] === 0x45
    );
  }

  private concatUint8Arrays(left: Uint8Array, right: Uint8Array): Uint8Array {
    if (left.length === 0) {
      return right;
    }

    const combined = new Uint8Array(left.length + right.length);
    combined.set(left, 0);
    combined.set(right, left.length);
    return combined;
  }

  private resolveDeepgramModel(candidate: string | undefined, source: string): string {
    const normalized = candidate?.trim().toLowerCase();

    if (normalized && SUPPORTED_DEEPGRAM_MODELS.has(normalized)) {
      return normalized;
    }

    if (candidate) {
      getEventSystem().warn(EventCategory.TTS, '⚠️ Deepgram TTS received unsupported model/voice; falling back to default', {
        source,
        received: candidate,
        fallback: DEFAULT_DEEPGRAM_MODEL,
        supportedModels: [...SUPPORTED_DEEPGRAM_MODELS],
      });
    }

    return DEFAULT_DEEPGRAM_MODEL;
  }

  getSampleRate(): number {
    return this.sampleRate;
  }

  async getAvailableVoices(): Promise<string[]> {
    return [
      'Aura-2-Thalia-en',
      'Aura-2-Asteria-en',
      'Aura-2-Angus-en',
      'Aura-2-Orion-en',
    ];
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsVAD: false,
      supportsLanguageDetection: false,
      supportsMultipleVoices: true,
      requiresNetwork: true,
      supportsGPU: false,
    };
  }
}
