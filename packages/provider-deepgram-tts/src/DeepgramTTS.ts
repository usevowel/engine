/**
 * Deepgram TTS Provider
 * 
 * Streaming and batch text-to-speech using Deepgram's Aura-2 voices.
 * Supports real-time WebSocket streaming and REST batch synthesis.
 */

import { BaseTTSProvider } from '../../../src/services/providers/base/BaseTTSProvider';
import {
  ProviderCapabilities,
  TTSSynthesizeOptions,
} from '../../../src/types/providers';

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
    this.model = config?.model || 'aura-2-thalia-en';
    this.voice = config?.voice || 'Aura-2-Thalia-en';
    this.sampleRate = config?.sampleRate || 24000;
    this.encoding = config?.encoding || 'linear16';
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Deepgram API key not configured');
    }
    
    console.log('Deepgram TTS initialized');
    this.initialized = true;
  }

  async synthesize(
    text: string,
    options?: TTSSynthesizeOptions
  ): Promise<Uint8Array> {
    this.ensureInitialized();
    
    const url = 'https://api.deepgram.com/v1/speak';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Token ' + this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text,
        model: this.model,
        encoding: this.encoding,
        sample_rate: this.sampleRate,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error('Deepgram synthesis failed: ' + response.status + ' ' + error);
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  async synthesizeStream(
    text: string,
    options?: TTSSynthesizeOptions
  ): Promise<AsyncIterableIterator<Uint8Array>> {
    if (!this.initialized) {
      return {
        next: async () => {
          throw new Error('deepgram provider not initialized');
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    }

    const url = 'https://api.deepgram.com/v1/speak';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Token ' + this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text,
        model: this.model,
        encoding: this.encoding,
        sample_rate: this.sampleRate,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error('Deepgram stream synthesis failed: ' + response.status + ' ' + error);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get stream reader');
    }

    const iterator: AsyncIterableIterator<Uint8Array> = {
      async next() {
        const result = await reader.read();
        if (result.done) {
          return { done: true, value: undefined };
        }
        return { done: false, value: result.value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };

    return iterator;
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
