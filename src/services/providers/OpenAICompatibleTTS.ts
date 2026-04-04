/**
 * OpenAI-compatible TTS Provider
 *
 * Batch synthesis against an OpenAI-compatible audio endpoint,
 * such as Echoline.
 */

import { BaseTTSProvider } from './base/BaseTTSProvider';
import { ProviderCapabilities, TTSSynthesizeOptions } from '../../types/providers';
import { getEventSystem, EventCategory } from '../../events';

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:8000/v1';
const DEFAULT_OPENAI_COMPATIBLE_TTS_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_OPENAI_COMPATIBLE_VOICE = 'af_heart';
const WAV_HEADER_BYTES = 44;
const STREAM_CHUNK_BYTES = 8192;

interface OpenAICompatibleTTSConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  voice?: string;
  sampleRate?: number;
  responseFormat?: 'wav' | 'mp3';
}

interface OpenAICompatibleModelMetadata {
  voices?: Array<{
    name?: string;
    id?: string;
  }>;
  sample_rate?: number;
}

interface OpenAICompatibleTTSErrorDetails {
  message: string;
  code: string;
  param?: string;
  provider: 'openai-compatible';
  requestedVoice?: string;
  fallbackVoice?: string;
  validVoices?: string[];
}

class OpenAICompatibleTTSError extends Error {
  details: OpenAICompatibleTTSErrorDetails;

  constructor(details: OpenAICompatibleTTSErrorDetails) {
    super(details.message);
    this.name = 'OpenAICompatibleTTSError';
    this.details = details;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export class OpenAICompatibleTTS extends BaseTTSProvider {
  readonly name = 'openai-compatible';
  readonly type = 'batch' as const;

  private apiKey?: string;
  private baseUrl: string;
  private model: string;
  private voice: string;
  private sampleRate: number;
  private responseFormat: 'wav' | 'mp3';
  private availableVoices: string[] | null = null;

  constructor(config?: OpenAICompatibleTTSConfig) {
    super();
    this.apiKey = config?.apiKey?.trim() || undefined;
    this.baseUrl = normalizeBaseUrl(config?.baseUrl || DEFAULT_OPENAI_COMPATIBLE_BASE_URL);
    this.model = config?.model || DEFAULT_OPENAI_COMPATIBLE_TTS_MODEL;
    this.voice = config?.voice || DEFAULT_OPENAI_COMPATIBLE_VOICE;
    this.sampleRate = config?.sampleRate || 24000;
    this.responseFormat = config?.responseFormat || 'wav';
  }

  async initialize(): Promise<void> {
    await this.loadModelMetadata();

    getEventSystem().info(EventCategory.TTS, '✅ OpenAI-compatible TTS initialized', {
      baseUrl: this.baseUrl,
      model: this.model,
      voice: this.voice,
      availableVoices: this.availableVoices,
    });
    this.initialized = true;
  }

  async synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Uint8Array> {
    this.ensureInitialized();

    return await this.requestSpeech(text, options, 0);
  }

  private async requestSpeech(
    text: string,
    options: TTSSynthesizeOptions | undefined,
    attempt: number
  ): Promise<Uint8Array> {
    const voice = await this.resolveVoice(options?.voice || this.voice);
    const speed = options?.speakingRate ?? options?.speed;

    const headers = new Headers({
      'Content-Type': 'application/json',
      'Connection': 'close',
    });
    if (this.apiKey) {
      headers.set('Authorization', `Bearer ${this.apiKey}`);
    }

    try {
      const response = await fetch(`${this.baseUrl}/audio/speech`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          voice,
          input: text,
          response_format: this.responseFormat,
          speed,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new OpenAICompatibleTTSError({
          message: `OpenAI-compatible synthesis failed: ${response.status} ${error}`,
          code: 'openai_compatible_tts_request_failed',
          provider: 'openai-compatible',
          param: 'voice',
          requestedVoice: voice,
          validVoices: this.availableVoices || undefined,
        });
      }

      const audio = new Uint8Array(await response.arrayBuffer());
      return this.normalizeAudio(audio);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldRetry = attempt === 0 && message.includes('ECONNRESET');

      if (shouldRetry) {
        getEventSystem().warn(EventCategory.TTS, '⚠️ OpenAI-compatible TTS connection reset, retrying once', {
          baseUrl: this.baseUrl,
          model: this.model,
          voice,
        });
        return await this.requestSpeech(text, options, attempt + 1);
      }

      throw error;
    }
  }

  private async loadModelMetadata(): Promise<void> {
    try {
      const headers = new Headers();
      if (this.apiKey) {
        headers.set('Authorization', `Bearer ${this.apiKey}`);
      }

      const response = await fetch(`${this.baseUrl}/models/${encodeURIComponent(this.model)}`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        getEventSystem().warn(EventCategory.TTS, '⚠️ OpenAI-compatible TTS could not fetch model metadata', {
          baseUrl: this.baseUrl,
          model: this.model,
          status: response.status,
        });
        return;
      }

      const metadata = await response.json() as OpenAICompatibleModelMetadata;
      this.availableVoices = metadata.voices
        ?.map(voice => voice.name || voice.id)
        .filter((voice): voice is string => Boolean(voice)) || [];

      if (metadata.sample_rate) {
        this.sampleRate = metadata.sample_rate;
      }
    } catch (error) {
      getEventSystem().warn(
        EventCategory.TTS,
        '⚠️ OpenAI-compatible TTS failed to load model metadata',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private async resolveVoice(requestedVoice: string): Promise<string> {
    if (!this.availableVoices) {
      await this.loadModelMetadata();
    }

    if (!this.availableVoices || this.availableVoices.length === 0) {
      return requestedVoice;
    }

    if (this.availableVoices.includes(requestedVoice)) {
      return requestedVoice;
    }

    if (this.availableVoices.includes(this.voice)) {
      getEventSystem().warn(EventCategory.TTS, '⚠️ OpenAI-compatible provider received unsupported voice, falling back to provider default', {
        requestedVoice,
        fallbackVoice: this.voice,
        model: this.model,
      });
      return this.voice;
    }

    throw new OpenAICompatibleTTSError({
      message: `Voice '${requestedVoice}' is not supported by model '${this.model}'.`,
      code: 'invalid_voice',
      param: 'voice',
      provider: 'openai-compatible',
      requestedVoice,
      fallbackVoice: this.voice,
      validVoices: this.availableVoices,
    });
  }

  async *synthesizeStream(text: string, options?: TTSSynthesizeOptions): AsyncIterableIterator<Uint8Array> {
    const audio = await this.synthesize(text, options);

    for (let offset = 0; offset < audio.length; offset += STREAM_CHUNK_BYTES) {
      const chunk = audio.slice(offset, offset + STREAM_CHUNK_BYTES);
      if (chunk.length > 0) {
        yield chunk;
      }
    }
  }

  private normalizeAudio(audio: Uint8Array): Uint8Array {
    const payload = this.responseFormat === 'wav' && this.isWavHeader(audio)
      ? audio.slice(WAV_HEADER_BYTES)
      : audio;
    const evenLength = payload.length - (payload.length % 2);

    if (evenLength === payload.length) {
      return payload;
    }

    getEventSystem().warn(EventCategory.TTS, '⚠️ OpenAI-compatible TTS dropped trailing partial PCM sample', {
      bytesDropped: payload.length - evenLength,
    });
    return payload.slice(0, evenLength);
  }

  private isWavHeader(audio: Uint8Array): boolean {
    if (audio.length < 12) {
      return false;
    }

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

  getSampleRate(): number {
    return this.sampleRate;
  }

  async getAvailableVoices(): Promise<string[]> {
    if (!this.availableVoices) {
      await this.loadModelMetadata();
    }

    return this.availableVoices && this.availableVoices.length > 0
      ? this.availableVoices
      : [this.voice];
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsVAD: false,
      supportsLanguageDetection: false,
      supportsMultipleVoices: true,
      requiresNetwork: true,
      supportsGPU: false,
    };
  }
}
