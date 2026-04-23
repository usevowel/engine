/**
 * xAI Grok TTS — REST and streaming WebSocket implementations.
 */

import { BaseTTSProvider } from '../../../src/services/providers/base/BaseTTSProvider';
import { ProviderCapabilities, TTSSynthesizeOptions } from '../../../src/types/providers';
import { getEventSystem, EventCategory } from '../../../src/events';

interface GrokTTSConfig {
  apiKey: string;
  voice?: string;
  sampleRate?: number;
  format?: string;
}

const DEFAULT_GROK_VOICE = 'rex';
const SUPPORTED_GROK_VOICES = ['ara', 'eve', 'leo', 'rex', 'sal'] as const;

type GrokVoice = (typeof SUPPORTED_GROK_VOICES)[number];

/**
 * Decode a base64 audio delta without relying on Node's `Buffer` (Workers-safe).
 */
function base64ToUint8Array(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class GrokTTS extends BaseTTSProvider {
  readonly name = 'grok';
  readonly type = 'streaming' as const;

  private apiKey: string;
  private voice: GrokVoice;
  private sampleRate: number;
  private format: 'pcm16';

  constructor(apiKey: string, config?: Partial<GrokTTSConfig>) {
    super();
    this.apiKey = apiKey;
    this.voice = this.resolveVoice(config?.voice);
    this.sampleRate = config?.sampleRate || 24000;
    this.format = 'pcm16';
  }

  private resolveVoice(voice?: string): GrokVoice {
    const normalized = voice?.toLowerCase();
    if (normalized && SUPPORTED_GROK_VOICES.includes(normalized as GrokVoice)) {
      return normalized as GrokVoice;
    }
    return DEFAULT_GROK_VOICE;
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Grok API key not configured');
    }

    getEventSystem().info(EventCategory.TTS, 'Grok TTS initialized', {
      voice: this.voice,
      sampleRate: this.sampleRate,
    });
    this.initialized = true;
  }

  async synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Uint8Array> {
    this.ensureInitialized();

    const voice = this.resolveVoice(options?.voice || this.voice);
    const sampleRate = options?.sampleRate || this.sampleRate;
    const language = ((options as TTSSynthesizeOptions & { language?: string }).language || 'en') as string;

    const response = await fetch('https://api.x.ai/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voice_id: voice,
        language,
        output_format: {
          codec: 'pcm',
          sample_rate: sampleRate,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Grok synthesis failed: ${response.status} ${await response.text()}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  async *synthesizeStream(text: string, options?: TTSSynthesizeOptions): AsyncIterableIterator<Uint8Array> {
    this.ensureInitialized();

    const voice = this.resolveVoice(options?.voice || this.voice);
    const sampleRate = options?.sampleRate || this.sampleRate;
    const language = ((options as TTSSynthesizeOptions & { language?: string }).language || 'en') as string;
    const url = new URL('wss://api.x.ai/v1/tts');
    url.searchParams.set('language', language);
    url.searchParams.set('voice', voice);
    url.searchParams.set('codec', 'pcm');
    url.searchParams.set('sample_rate', String(sampleRate));

    let ws: WebSocket | null = null;
    let opened = false;
    let finished = false;
    let failure: Error | null = null;
    const chunks: Uint8Array[] = [];
    const waiters: Array<() => void> = [];

    const notify = () => {
      while (waiters.length > 0) {
        waiters.shift()?.();
      }
    };

    const waitForUpdate = async (): Promise<void> => {
      if (chunks.length > 0 || finished || failure) {
        return;
      }
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    };

    const handleMessage = (raw: string | ArrayBuffer | Blob) => {
      if (typeof raw !== 'string') {
        return;
      }

      try {
        const event = JSON.parse(raw) as { type?: string; delta?: string; message?: string };
        if (event.type === 'audio.delta' && event.delta) {
          chunks.push(base64ToUint8Array(event.delta));
          notify();
          return;
        }

        if (event.type === 'audio.done') {
          finished = true;
          notify();
          return;
        }

        if (event.type === 'error') {
          failure = new Error(event.message || 'Grok TTS error');
          finished = true;
          notify();
        }
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        finished = true;
        notify();
      }
    };

    try {
      ws = new WebSocket(url.toString(), [`xai-client-secret.${this.apiKey}`]);

      ws.addEventListener('open', () => {
        opened = true;
        ws?.send(JSON.stringify({ type: 'text.delta', delta: text }));
        ws?.send(JSON.stringify({ type: 'text.done' }));
        notify();
      });

      ws.addEventListener('message', (event) => {
        handleMessage(event.data);
      });

      ws.addEventListener('error', (event) => {
        const message = event instanceof ErrorEvent ? event.message : 'Grok TTS socket error';
        failure = new Error(message);
        finished = true;
        notify();
      });

      ws.addEventListener('close', () => {
        if (!finished) {
          finished = true;
          notify();
        }
      });

      while (!opened && !failure) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      while (!finished || chunks.length > 0) {
        if (failure) {
          throw failure;
        }

        if (chunks.length === 0) {
          await waitForUpdate();
          continue;
        }

        const chunk = chunks.shift();
        if (chunk && chunk.length > 0) {
          yield chunk;
        }
      }

      if (failure) {
        throw failure;
      }
    } finally {
      if (ws) {
        try {
          ws.close(1000, 'Done');
        } catch {
          /* ignore */
        }
      }
    }
  }

  getSampleRate(): number {
    return this.sampleRate;
  }

  async getAvailableVoices(): Promise<string[]> {
    const response = await fetch('https://api.x.ai/v1/tts/voices', {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      return [...SUPPORTED_GROK_VOICES];
    }

    const result = (await response.json()) as { voices?: Array<{ voice_id?: string }> };
    const voices = result.voices
      ?.map((v) => v.voice_id?.toLowerCase())
      .filter((v): v is string => Boolean(v));

    return voices && voices.length > 0 ? voices : [...SUPPORTED_GROK_VOICES];
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
