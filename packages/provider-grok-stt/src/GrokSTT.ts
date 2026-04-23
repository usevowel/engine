import { BaseSTTProvider } from '../../../src/services/providers/base/BaseSTTProvider';
import {
  ProviderCapabilities,
  STTResult,
  STTStreamCallbacks,
  STTStreamingSession,
  STTTranscribeOptions,
} from '../../../src/types/providers';
import { getEventSystem, EventCategory } from '../../../src/events';

interface GrokSTTConfig {
  apiKey: string;
  model?: string;
  language?: string;
  sampleRate?: number;
}

interface UpgradeWebSocket extends WebSocket {
  accept?: () => void;
}

interface UpgradeResponse extends Response {
  webSocket?: UpgradeWebSocket;
}

class GrokStreamingSession implements STTStreamingSession {
  private ws: WebSocket | null = null;
  private active = false;
  private ready: Promise<void>;
  private resolveReady!: () => void;
  private callbacks: STTStreamCallbacks;
  private sampleRate: number;
  private language?: string;
  private inSpeech = false;
  private finalText = '';
  private openResolved = false;
  /** When true, `onFinal` was already invoked for this utterance via `speech_final`; skip duplicate `transcript.done`. */
  private utteranceFinalizedViaSpeechFinal = false;

  constructor(apiKey: string, config: Required<GrokSTTConfig>, callbacks: STTStreamCallbacks) {
    this.callbacks = callbacks;
    this.sampleRate = config.sampleRate;
    this.language = config.language;
    this.ready = new Promise((resolve) => {
      this.resolveReady = () => {
        if (!this.openResolved) {
          this.openResolved = true;
          resolve();
        }
      };
    });
    void this.connect(apiKey, config);
  }

  private async connect(apiKey: string, config: Required<GrokSTTConfig>): Promise<void> {
    const url = new URL('wss://api.x.ai/v1/stt');
    url.searchParams.set('sample_rate', String(config.sampleRate));
    url.searchParams.set('encoding', 'pcm');
    url.searchParams.set('interim_results', 'true');
    url.searchParams.set('endpointing', '0');
    if (config.language) {
      url.searchParams.set('language', config.language);
    }

    try {
      const ws = new WebSocket(url.toString(), [`xai-client-secret.${apiKey}`]);
      this.ws = ws;

      ws.addEventListener('open', () => {
        this.active = true;
        this.resolveReady();
      });

      ws.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });

      ws.addEventListener('error', (event) => {
        const message = event instanceof ErrorEvent ? event.message : 'Grok STT socket error';
        this.active = false;
        this.resolveReady();
        void this.callbacks.onError?.(new Error(message));
      });

      ws.addEventListener('close', () => {
        this.active = false;
        this.resolveReady();
      });
    } catch (error) {
      this.active = false;
      this.resolveReady();
      void this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleMessage(data: string | ArrayBuffer | Blob): void {
    if (typeof data !== 'string') {
      return;
    }

    try {
      const event = JSON.parse(data) as {
        type?: string;
        text?: string;
        is_final?: boolean;
        speech_final?: boolean;
        duration?: number;
        language?: string;
        message?: string;
      };

      if (event.type === 'transcript.created') {
        this.active = true;
        this.resolveReady();
        return;
      }

      if (event.type === 'transcript.partial') {
        if (!this.inSpeech) {
          this.inSpeech = true;
          this.utteranceFinalizedViaSpeechFinal = false;
          getEventSystem().info(EventCategory.STT, '🎤 [Grok STT] Speech detected (speech_start)');
          void this.callbacks.onVADEvent?.('speech_start');
        }

        const text = event.text ?? '';
        const languageName = event.language;
        if (languageName) {
          void this.callbacks.onLanguageDetected?.({
            languageCode: languageName,
            confidence: 1,
            timestamp: Date.now(),
          });
        }

        if (event.is_final) {
          this.finalText = text;
          if (event.speech_final) {
            getEventSystem().info(EventCategory.STT, `🎤 [Grok STT] Speech ended (speech_end) - final transcript: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
            this.utteranceFinalizedViaSpeechFinal = true;
            void this.callbacks.onFinal({
              text,
              language: languageName ?? this.language,
              duration: event.duration,
            });
            this.finalText = '';
            this.inSpeech = false;
            void this.callbacks.onVADEvent?.('speech_end');
          } else if (text) {
            getEventSystem().debug(EventCategory.STT, `📝 [Grok STT] Partial (is_final): "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
            void this.callbacks.onPartial?.(text);
          }
        } else if (text) {
          getEventSystem().debug(EventCategory.STT, `📝 [Grok STT] Partial: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
          void this.callbacks.onPartial?.(text);
        }

        return;
      }

      if (event.type === 'transcript.done') {
        const text = event.text ?? this.finalText;
        const alreadyFinalized = this.utteranceFinalizedViaSpeechFinal;
        this.utteranceFinalizedViaSpeechFinal = false;
        if (text && !alreadyFinalized) {
          getEventSystem().info(EventCategory.STT, `📝 [Grok STT] Transcript done: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
          void this.callbacks.onFinal({
            text,
            language: event.language ?? this.language,
            duration: event.duration,
          });
        }
        this.finalText = '';
        if (this.inSpeech) {
          this.inSpeech = false;
          getEventSystem().info(EventCategory.STT, '🎤 [Grok STT] Speech ended (transcript.done)');
          void this.callbacks.onVADEvent?.('speech_end');
        }
        return;
      }

      if (event.type === 'error') {
        getEventSystem().error(EventCategory.STT, `❌ [Grok STT] Error: ${event.message || 'Unknown error'}`);
        void this.callbacks.onError?.(new Error(event.message || 'Grok STT error'));
      }
    } catch (error) {
      void this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async waitForConnection(): Promise<void> {
    await this.ready;
  }

  async sendAudio(chunk: Uint8Array): Promise<void> {
    await this.waitForConnection();
    if (!this.ws || !this.active || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Grok STT session not active');
    }
    this.ws.send(chunk);
  }

  async end(): Promise<void> {
    await this.waitForConnection();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({ type: 'audio.done' }));
  }

  async stop(): Promise<void> {
    if (this.ws) {
      try {
        this.ws.close(1000, 'Stopped');
      } catch {}
      this.ws = null;
    }
    this.active = false;
    this.inSpeech = false;
    this.finalText = '';
  }

  isActive(): boolean {
    return this.active;
  }
}

export class GrokSTT extends BaseSTTProvider {
  readonly name = 'grok';
  readonly type = 'streaming' as const;

  private apiKey: string;
  private model: string;
  private language?: string;
  private sampleRate: number;

  constructor(apiKey: string, config?: Partial<GrokSTTConfig>) {
    super();
    this.apiKey = apiKey;
    this.model = config?.model || 'whisper-large-v3-turbo';
    this.language = config?.language;
    /** Match engine DEFAULT_AUDIO_CONFIG (24 kHz) so hosted PCM16 matches the declared rate unless overridden. */
    this.sampleRate = config?.sampleRate ?? 24000;
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Grok API key not configured');
    }
    getEventSystem().info(EventCategory.STT, 'Grok STT initialized', {
      sampleRate: this.sampleRate,
      model: this.model,
      language: this.language,
    });
    this.initialized = true;
  }

  async transcribe(audioBuffer: Uint8Array, options?: STTTranscribeOptions): Promise<STTResult> {
    this.ensureInitialized();

    const formData = new FormData();
    const language = options?.language || this.language;
    const sampleRate = options?.sampleRate || this.sampleRate;

    formData.append('format', 'true');
    if (language) {
      formData.append('language', language);
    }
    formData.append('audio_format', 'pcm');
    formData.append('sample_rate', String(sampleRate));
    formData.append('file', new Blob([audioBuffer], { type: 'audio/pcm' }), 'audio.pcm');

    const response = await fetch('https://api.x.ai/v1/stt', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Grok transcription failed: ${response.status} ${await response.text()}`);
    }

    const result = await response.json() as {
      text?: string;
      language?: string;
      duration?: number;
    };

    return {
      text: result.text || '',
      language: result.language || language,
      duration: result.duration,
    };
  }

  async startStream(
    callbacks: STTStreamCallbacks,
    _tokenTurnDetection?: unknown,
    _languageDetectionEnabled?: boolean,
  ): Promise<STTStreamingSession> {
    this.ensureInitialized();
    return new GrokStreamingSession(
      this.apiKey,
      {
        apiKey: this.apiKey,
        model: this.model,
        language: this.language || 'en',
        sampleRate: this.sampleRate,
      },
      callbacks,
    );
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsVAD: false,
      supportsLanguageDetection: true,
      supportsMultipleVoices: false,
      requiresNetwork: true,
      supportsGPU: false,
    };
  }
}
