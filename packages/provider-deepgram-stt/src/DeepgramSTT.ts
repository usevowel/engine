/**
 * Deepgram STT Provider
 *
 * Streaming and batch transcription using Deepgram's Nova-3 model.
 * Supports real-time WebSocket streaming and REST batch transcription.
 *
 * STT Streaming: wss://api.deepgram.com/v1/listen
 * STT Batch: POST https://api.deepgram.com/v1/listen
 *
 * @see https://developers.deepgram.com/reference/listen-streaming
 */

import { BaseSTTProvider } from '../../../src/services/providers/base/BaseSTTProvider';
import {
  STTResult,
  STTTranscribeOptions,
  STTStreamCallbacks,
  STTStreamingSession,
  ProviderCapabilities,
} from '../../../src/types/providers';
import { getEventSystem, EventCategory } from '../../../src/events';

interface DeepgramSTTConfig {
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

/**
 * Deepgram STT streaming session.
 * Manages a WebSocket connection to Deepgram's live transcription API.
 */
class DeepgramStreamingSession implements STTStreamingSession {
  private ws: WebSocket | null = null;
  private active = false;
  private callbacks: STTStreamCallbacks;
  private apiKey: string;
  private config: Required<DeepgramSTTConfig>;
  private connectionReadyPromise: Promise<void>;
  private resolveConnectionReady!: () => void;
  private accumulatedText = '';

  constructor(apiKey: string, config: Required<DeepgramSTTConfig>, callbacks: STTStreamCallbacks) {
    this.apiKey = apiKey;
    this.config = config;
    this.callbacks = callbacks;

    this.connectionReadyPromise = new Promise((resolve) => {
      this.resolveConnectionReady = resolve;
    });

    this.connect();
  }

  async waitForConnection(): Promise<void> {
    await this.connectionReadyPromise;
  }

  /**
   * Connect to Deepgram via WebSocket.
   * Uses fetch() with Upgrade header for compatibility with Cloudflare Workers
   * and Bun/Node runtimes that support the WebSocket Hibernation API.
   */
  private async connect(): Promise<void> {
    try {
      const params = new URLSearchParams();
      params.set('model', this.config.model);
      params.set('language', this.config.language);
      params.set('encoding', 'linear16');
      params.set('sample_rate', String(this.config.sampleRate));
      params.set('channels', '1');
      params.set('smart_format', 'true');
      params.set('punctuate', 'true');
      params.set('interim_results', 'true');
      params.set('endpointing', '300');

      const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

      getEventSystem().info(EventCategory.SESSION, '🔌 [Deepgram STT] Connecting...', {
        model: this.config.model,
        language: this.config.language,
      });

      // Try fetch-based WebSocket upgrade first (Workers compatible), fall back to native WebSocket
      let ws: WebSocket;
      try {
        const response = await fetch(wsUrl, {
          headers: {
            Upgrade: 'websocket',
            Connection: 'Upgrade',
            Authorization: `Token ${this.apiKey}`,
          },
        }) as UpgradeResponse;

        if (response.status === 101 && response.webSocket) {
          ws = response.webSocket;
          ws.accept?.();
          getEventSystem().info(EventCategory.SESSION, '🔌 [Deepgram STT] WebSocket connected (fetch upgrade)');
        } else {
          throw new Error(`Fetch upgrade failed: ${response.status}`);
        }
      } catch {
        // Fallback to native WebSocket with token in subprotocol
        ws = new WebSocket(wsUrl, ['token', this.apiKey]);
        getEventSystem().info(EventCategory.SESSION, '🔌 [Deepgram STT] Connecting via native WebSocket...');
      }

      this.ws = ws;

      ws.addEventListener('open', () => {
        getEventSystem().info(EventCategory.SESSION, '✅ [Deepgram STT] WebSocket open');
        this.active = true;
        this.resolveConnectionReady();
      });

      ws.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });

      ws.addEventListener('error', (event) => {
        try {
          const errMsg =
            event instanceof ErrorEvent
              ? event.message
              : 'WebSocket connection error';
          getEventSystem().error(
            EventCategory.SESSION,
            `❌ [Deepgram STT] WebSocket error: ${errMsg}`,
            new Error(errMsg)
          );
          this.callbacks.onError?.(new Error(`Deepgram STT WebSocket error: ${errMsg}`));
        } catch {
          // Swallow all errors in event listener to prevent unhandled exceptions
        }
        this.active = false;
        this.resolveConnectionReady();
      });

      ws.addEventListener('close', (event) => {
        try {
          const reason = event.reason || (event.code === 1006 ? 'Connection closed abnormally (check API key and network)' : '');
          getEventSystem().info(
            EventCategory.SESSION,
            `🔌 [Deepgram STT] WebSocket closed (code: ${event.code}${reason ? `, reason: ${reason}` : ''})`
          );
          if (event.code !== 1000 && event.code !== 1001) {
            this.callbacks.onError?.(new Error(`Deepgram STT WebSocket closed: ${event.code} ${reason}`.trim()));
          }
        } catch {
          // Swallow all errors in event listener to prevent unhandled exceptions
        }
        this.active = false;
        this.resolveConnectionReady();
      });
    } catch (error) {
      getEventSystem().error(EventCategory.STT, '❌ [Deepgram STT] Failed to connect:', error);
      this.callbacks.onError?.(error as Error);
      this.active = false;
      this.resolveConnectionReady();
    }
  }

  private handleMessage(data: string | ArrayBuffer | Blob): void {
    if (typeof data !== 'string') {
      void this.callbacks.onStreamingSttProviderEvent?.({
        _nonJsonFrame: true,
        kind: 'non_string',
      });
      return;
    }

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch (err) {
      const raw =
        data.length > 50_000 ? `${data.slice(0, 50_000)}…(truncated)` : data;
      void this.callbacks.onStreamingSttProviderEvent?.({
        _parseError: true,
        raw,
      });
      getEventSystem().error(
        EventCategory.STT,
        '❌ [Deepgram STT] Failed to parse message:',
        err instanceof Error ? err : new Error(String(err)),
      );
      return;
    }

    void this.callbacks.onStreamingSttProviderEvent?.(msg);

    try {
      if (msg.type === 'Results') {
        const transcript = msg.channel?.alternatives?.[0]?.transcript || '';
        const isFinal = msg.is_final === true;
        const speechFinal = msg.speech_final === true;
        const confidence = msg.channel?.alternatives?.[0]?.confidence;

        if (transcript) {
          if (isFinal) {
            this.accumulatedText += transcript;
          }

          if (speechFinal && this.accumulatedText) {
            // Complete utterance detected - emit final result
            getEventSystem().info(
              EventCategory.STT,
              `📝 [Deepgram STT] Final: "${this.accumulatedText.trim()}"`
            );
            this.callbacks.onFinal({
              text: this.accumulatedText.trim(),
              confidence,
              language: this.config.language,
            });
            this.accumulatedText = '';
          } else if (isFinal && !speechFinal) {
            // Sentence boundary but speech continues - emit partial as final segment
            getEventSystem().debug(
              EventCategory.STT,
              `📝 [Deepgram STT] Segment: "${transcript}"`
            );
            this.callbacks.onPartial?.(this.accumulatedText.trim());
          } else if (!isFinal && this.callbacks.onPartial) {
            // Interim result
            const partialText = (this.accumulatedText + transcript).trim();
            this.callbacks.onPartial(partialText);
          }
        }
      } else if (msg.type === 'SpeechStarted') {
        getEventSystem().debug(EventCategory.STT, '🗣️ [Deepgram STT] Speech started');
        if (this.callbacks.onVADEvent) {
          this.callbacks.onVADEvent('speech_start');
        }
      } else if (msg.type === 'UtteranceEnd') {
        getEventSystem().debug(EventCategory.STT, '🔇 [Deepgram STT] Utterance end');
        if (this.accumulatedText) {
          this.callbacks.onFinal({
            text: this.accumulatedText.trim(),
            language: this.config.language,
          });
          this.accumulatedText = '';
        }
        if (this.callbacks.onVADEvent) {
          this.callbacks.onVADEvent('speech_end');
        }
      } else if (msg.type === 'error' || msg.error) {
        const errMsg = msg.error || msg.message || 'Unknown Deepgram error';
        getEventSystem().error(EventCategory.STT, '❌ [Deepgram STT] API error:', errMsg);
        this.callbacks.onError?.(new Error(String(errMsg)));
      }
    } catch (error) {
      getEventSystem().error(
        EventCategory.STT,
        '❌ [Deepgram STT] Failed to parse message:',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async sendAudio(chunk: Uint8Array): Promise<void> {
    if (!this.ws) {
      getEventSystem().warn(EventCategory.STT, '⏳ [Deepgram STT] WebSocket not ready, waiting...');
      await this.waitForConnection();
    }

    if (!this.active || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Deepgram STT session not active');
    }

    // Deepgram accepts raw PCM16 binary frames
    this.ws.send(chunk);
  }

  async end(): Promise<void> {
    if (this.ws && this.active && this.ws.readyState === WebSocket.OPEN) {
      // Flush any remaining accumulated text
      if (this.accumulatedText) {
        this.callbacks.onFinal({
          text: this.accumulatedText.trim(),
          language: this.config.language,
        });
        this.accumulatedText = '';
      }

      getEventSystem().info(EventCategory.SESSION, '🔌 [Deepgram STT] Ending stream (closing WebSocket)');
      this.ws.close(1000, 'Stream ended');
      this.active = false;
    }
  }

  async stop(): Promise<void> {
    if (this.ws) {
      getEventSystem().info(EventCategory.SESSION, '🔌 [Deepgram STT] Stopping (closing WebSocket)');
      try {
        this.ws.close(1000, 'Stopped');
      } catch (error) {
        getEventSystem().error(EventCategory.SESSION, '❌ [Deepgram STT] Error closing:', error);
      }
      this.ws = null;
      this.active = false;
      this.accumulatedText = '';
    }
  }

  isActive(): boolean {
    return this.active;
  }
}

export class DeepgramSTT extends BaseSTTProvider {
  readonly name = 'deepgram';
  readonly type = 'streaming' as const;

  private apiKey: string;
  private model: string;
  private language: string;
  private sampleRate: number;

  constructor(apiKey: string, config?: Partial<DeepgramSTTConfig>) {
    super();
    this.apiKey = apiKey;
    this.model = config?.model || 'nova-3';
    this.language = config?.language || 'en-US';
    this.sampleRate = config?.sampleRate || 16000;
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Deepgram API key not configured');
    }

    getEventSystem().info(EventCategory.STT, '✅ Deepgram STT initialized');
    this.initialized = true;
  }

  async transcribe(
    audioBuffer: Uint8Array,
    options?: STTTranscribeOptions
  ): Promise<STTResult> {
    this.ensureInitialized();

    const params = new URLSearchParams();
    params.set('model', this.model);
    params.set('language', options?.language || this.language);
    params.set('smart_format', 'true');
    params.set('punctuate', 'true');

    const url = `https://api.deepgram.com/v1/listen?${params.toString()}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'audio/raw',
      },
      body: new Blob([audioBuffer], { type: 'audio/raw' }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Deepgram transcription failed: ${response.status} ${error}`);
    }

    const data = await response.json();
    const result = data.results?.channels?.[0]?.alternatives?.[0];

    return {
      text: result?.transcript || '',
      confidence: result?.confidence,
      language: result?.language || this.language,
      duration: data.metadata?.duration,
    };
  }

  async startStream(
    callbacks: STTStreamCallbacks,
    _tokenTurnDetection?: any,
    _languageDetectionEnabled?: boolean
  ): Promise<STTStreamingSession> {
    this.ensureInitialized();

    return new DeepgramStreamingSession(this.apiKey, {
      apiKey: this.apiKey,
      model: this.model,
      language: this.language,
      sampleRate: this.sampleRate,
    }, callbacks);
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
