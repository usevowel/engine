/**
 * Mistral Voxtral Realtime STT Provider
 *
 * Real-time streaming transcription using Mistral's Voxtral Mini Transcribe Realtime
 * model (voxtral-mini-transcribe-realtime-2602). Connects via WebSocket to Mistral's
 * official realtime API for live speech-to-text with sub-200ms latency.
 *
 * API: https://api.mistral.ai/v1/audio/transcriptions/realtime
 * Model: voxtral-mini-transcribe-realtime-2602
 * Docs: https://docs.mistral.ai/capabilities/audio_transcription#realtime
 *
 * @see https://docs.mistral.ai/models/voxtral-mini-transcribe-realtime-26-02
 */

import { BaseSTTProvider } from '../../../src/services/providers/base/BaseSTTProvider';
import {
  STTResult,
  STTTranscribeOptions,
  STTStreamCallbacks,
  STTStreamingSession,
  VADEvent,
  ProviderCapabilities,
} from '../../../src/types/providers';
import { getEventSystem, EventCategory } from '../../../src/events';

/** Default model for Mistral Voxtral Realtime */
const DEFAULT_MODEL = 'voxtral-mini-transcribe-realtime-2602';

/** Mistral API base URL */
const MISTRAL_API_BASE = 'https://api.mistral.ai';

/**
 * Pipeline sends 24kHz PCM16. Mistral expects 16kHz.
 * Resample PCM16 from sourceRate to targetRate using linear interpolation.
 */
function resamplePcm16(
  pcm16Bytes: Uint8Array,
  sourceRate: number,
  targetRate: number
): Uint8Array {
  if (sourceRate === targetRate) return pcm16Bytes;

  const numSamples = pcm16Bytes.length / 2;
  const view = new DataView(pcm16Bytes.buffer, pcm16Bytes.byteOffset, pcm16Bytes.byteLength);
  const targetLength = Math.floor(numSamples * targetRate / sourceRate);
  const out = new ArrayBuffer(targetLength * 2);
  const outView = new DataView(out);

  for (let i = 0; i < targetLength; i++) {
    const srcIdx = (i * sourceRate) / targetRate;
    const idx = Math.floor(srcIdx);
    const frac = srcIdx - idx;
    const s0 = idx < numSamples ? view.getInt16(idx * 2, true) : 0;
    const s1 = idx + 1 < numSamples ? view.getInt16((idx + 1) * 2, true) : s0;
    const sample = Math.round(s0 * (1 - frac) + s1 * frac);
    outView.setInt16(i * 2, Math.max(-32768, Math.min(32767, sample)), true);
  }
  return new Uint8Array(out);
}

/** WebSocket URL for realtime transcription */
const REALTIME_WS_PATH = '/v1/audio/transcriptions/realtime';

/** Pipeline sends 24kHz PCM16; Mistral expects 16kHz */
const PIPELINE_SAMPLE_RATE = 24000;

/**
 * Mistral/vLLM backend recommends ~480ms chunks to avoid QueueOverflowError.
 * At 16kHz PCM16: 480ms = 15360 bytes. We buffer until this size before sending.
 */
const TARGET_CHUNK_MS = 480;

export class MistralVoxtralRealtimeSTT extends BaseSTTProvider {
  readonly name = 'mistral-voxtral';
  readonly type = 'streaming' as const;

  private apiKey: string;
  private config: MistralVoxtralConfig;

  constructor(apiKey: string, config?: Partial<MistralVoxtralConfig>) {
    super();
    this.apiKey = apiKey;
    this.config = {
      model: config?.model ?? DEFAULT_MODEL,
      sampleRate: config?.sampleRate ?? 16000,
      language: config?.language,
    };
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Mistral API key not configured');
    }
    getEventSystem().info(EventCategory.STT, '✅ Mistral Voxtral Realtime STT initialized');
    this.initialized = true;
  }

  async transcribe(
    _audioBuffer: Uint8Array,
    _options?: STTTranscribeOptions
  ): Promise<STTResult> {
    throw new Error('Mistral Voxtral Realtime requires streaming mode - use startStream() instead');
  }

  async startStream(
    callbacks: STTStreamCallbacks,
    _tokenTurnDetection?: unknown,
    _languageDetectionEnabled?: boolean
  ): Promise<STTStreamingSession> {
    this.ensureInitialized();

    return new MistralVoxtralStreamingSession(this.apiKey, this.config, callbacks);
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsVAD: true,
      supportsLanguageDetection: false, // Can add if Mistral provides language events
      supportsMultipleVoices: false,
      requiresNetwork: true,
      supportsGPU: true,
    };
  }
}

/**
 * Mistral Voxtral Realtime streaming session
 * Manages WebSocket connection to Mistral's realtime transcription API
 */
class MistralVoxtralStreamingSession implements STTStreamingSession {
  private ws: WebSocket | null = null;
  private active = false;
  private callbacks: STTStreamCallbacks;
  private apiKey: string;
  private config: MistralVoxtralConfig;
  private connectionReadyPromise: Promise<void>;
  private resolveConnectionReady!: () => void;
  private speechStarted = false;
  private accumulatedText = '';
  private lastAudioLogTime?: number;
  /** Buffer to avoid QueueOverflowError - send in ~480ms chunks per Mistral/vLLM recommendation */
  private audioChunks: Uint8Array[] = [];
  private audioBufferLength = 0;
  private targetBufferBytes: number;

  constructor(apiKey: string, config: MistralVoxtralConfig, callbacks: STTStreamCallbacks) {
    this.apiKey = apiKey;
    this.config = config;
    this.callbacks = callbacks;
    this.targetBufferBytes = Math.floor((this.config.sampleRate * 2 * TARGET_CHUNK_MS) / 1000); // PCM16 = 2 bytes/sample

    this.connectionReadyPromise = new Promise((resolve) => {
      this.resolveConnectionReady = resolve;
    });

    this.connect();
  }

  async waitForConnection(): Promise<void> {
    await this.connectionReadyPromise;
  }

  /**
   * Build fetch URL for WebSocket handshake.
   * Cloudflare fetch() requires https: (not wss:) for WebSocket upgrade requests.
   * @see https://developers.cloudflare.com/workers/configuration/compatibility-flags
   */
  private buildFetchUrl(): string {
    const params = new URLSearchParams();
    params.set('model', this.config.model);
    return `${MISTRAL_API_BASE}${REALTIME_WS_PATH}?${params.toString()}`;
  }

  /**
   * Connect to Mistral using fetch() with Authorization header.
   * Workers' WebSocket constructor doesn't support custom headers, but fetch() does.
   * This allows us to pass Authorization: Bearer when initiating the WebSocket handshake.
   * Note: fetch() must use https: URL, not wss: - Cloudflare treats the upgrade as HTTP.
   */
  private async connect(): Promise<void> {
    try {
      const fetchUrl = this.buildFetchUrl();
      getEventSystem().info(EventCategory.SESSION, '🔌 [Mistral Voxtral] Connecting via fetch (Authorization header)...', {
        url: fetchUrl,
        model: this.config.model,
      });

      const response = await fetch(fetchUrl, {
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (response.status !== 101 || !response.webSocket) {
        const body = await response.text();
        getEventSystem().error(
          EventCategory.SESSION,
          `❌ [Mistral Voxtral] WebSocket handshake failed: ${response.status}`,
          new Error(`status=${response.status} body=${body.slice(0, 200)}`),
          { status: response.status }
        );
        this.callbacks.onError?.(new Error(`Mistral Voxtral connection failed: ${response.status}`));
        return;
      }

      this.ws = response.webSocket;
      this.ws.accept();

      getEventSystem().info(EventCategory.SESSION, '🔌 [Mistral Voxtral] WebSocket connected');
      this.sendSessionUpdate();

      this.ws.addEventListener('message', (event) => {
        this.handleMessage(event.data as string);
      });

      this.ws.addEventListener('error', (event) => {
        const errMsg =
          event instanceof Error
            ? event.message
            : (event as Event)?.type
              ? `WebSocket error event: ${(event as Event).type}`
              : 'WebSocket connection error';
        getEventSystem().error(
          EventCategory.SESSION,
          `❌ [Mistral Voxtral] WebSocket error: ${errMsg}`,
          new Error(errMsg),
          { eventType: (event as Event)?.type }
        );
        this.callbacks.onError?.(new Error(`Mistral Voxtral WebSocket error: ${errMsg}`));
      });

      this.ws.addEventListener('close', (event) => {
        const reason = event.reason || (event.code === 1006 ? 'Connection closed abnormally (check API key and network)' : '');
        getEventSystem().info(
          EventCategory.SESSION,
          `🔌 [Mistral Voxtral] WebSocket closed (code: ${event.code}${reason ? `, reason: ${reason}` : ''})`
        );
        if (event.code !== 1000 && event.code !== 1001 && this.callbacks.onError) {
          this.callbacks.onError(
            new Error(`Mistral Voxtral WebSocket closed: ${event.code} ${reason}`.trim())
          );
        }
        this.active = false;
        this.speechStarted = false;
      });
    } catch (error) {
      getEventSystem().error(EventCategory.STT, '❌ Failed to connect to Mistral Voxtral:', error);
      this.callbacks.onError?.(error as Error);
    }
  }

  private sendSessionUpdate(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        audio_format: {
          encoding: 'pcm_s16le',
          sample_rate: this.config.sampleRate,
        },
      },
    };
    this.ws.send(JSON.stringify(sessionUpdate));
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);
      const msgType = msg?.type;

      if (!msgType) {
        getEventSystem().debug(EventCategory.STT, '🔍 [Mistral Voxtral] Message without type:', msg);
        return;
      }

      switch (msgType) {
        case 'session.created':
          getEventSystem().info(EventCategory.STT, '✅ [Mistral Voxtral] Session created');
          this.active = true;
          this.speechStarted = false;
          this.accumulatedText = '';
          if (this.resolveConnectionReady) {
            this.resolveConnectionReady();
            getEventSystem().info(EventCategory.SESSION, '✅ [Mistral Voxtral] Connection ready');
          }
          break;

        case 'session.updated':
          getEventSystem().debug(EventCategory.STT, '🔧 [Mistral Voxtral] Session updated', msg);
          break;

        case 'transcription.text.delta':
          if (msg.text) {
            this.accumulatedText += msg.text;
            if (!this.speechStarted && this.callbacks.onVADEvent) {
              this.speechStarted = true;
              getEventSystem().info(EventCategory.VAD, '🗣️  [Mistral Voxtral] Speech detected');
              this.callbacks.onVADEvent('speech_start');
            }
            if (this.callbacks.onPartial) {
              this.callbacks.onPartial(this.accumulatedText);
            }
          }
          break;

        case 'transcription.segment':
          if (msg.text) {
            getEventSystem().info(EventCategory.STT, `📝 [Mistral Voxtral] Segment: "${msg.text}"`);
          }
          break;

        case 'transcription.language':
          if (msg.audio_language && this.callbacks.onLanguageDetected) {
            this.callbacks.onLanguageDetected({
              languageCode: msg.audio_language,
              confidence: 1.0,
              timestamp: Date.now(),
            });
          }
          break;

        case 'transcription.done':
          if (this.accumulatedText) {
            getEventSystem().info(
              EventCategory.STT,
              `📝 [Mistral Voxtral] Final: "${this.accumulatedText}"`
            );
            this.callbacks.onFinal({
              text: this.accumulatedText.trim(),
              confidence: 1.0,
              language: msg.language,
            });
          }
          this.accumulatedText = '';
          this.speechStarted = false;
          if (this.callbacks.onVADEvent) {
            this.callbacks.onVADEvent('speech_end');
          }
          break;

        case 'error':
          const errMsg = msg?.error?.message ?? msg?.error ?? 'Unknown error';
          getEventSystem().error(EventCategory.STT, '❌ [Mistral Voxtral] Error:', errMsg);
          this.callbacks.onError?.(new Error(String(errMsg)));
          break;

        default:
          getEventSystem().info(EventCategory.STT, `🔍 [Mistral Voxtral] Unhandled event: ${msgType}`, msg);
          break;
      }
    } catch (error) {
      getEventSystem().error(
        EventCategory.STT,
        '❌ Failed to parse Mistral message:',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async sendAudio(chunk: Uint8Array): Promise<void> {
    if (!this.ws) {
      getEventSystem().warn(EventCategory.STT, '⏳ [Mistral Voxtral] WebSocket not ready, waiting...');
      await this.waitForConnection();
    }

    if (!this.active || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      getEventSystem().error(EventCategory.SESSION, '❌ [Mistral Voxtral] Cannot send - session not active');
      throw new Error('Mistral Voxtral session not active');
    }

    const audioToSend =
      this.config.sampleRate !== PIPELINE_SAMPLE_RATE
        ? resamplePcm16(chunk, PIPELINE_SAMPLE_RATE, this.config.sampleRate)
        : chunk;

    this.audioChunks.push(audioToSend);
    this.audioBufferLength += audioToSend.length;

    while (this.audioBufferLength >= this.targetBufferBytes && this.audioChunks.length > 0) {
      const merged = new Uint8Array(this.targetBufferBytes);
      let offset = 0;
      while (offset < this.targetBufferBytes && this.audioChunks.length > 0) {
        const c = this.audioChunks[0];
        const take = Math.min(c.length, this.targetBufferBytes - offset);
        merged.set(c.subarray(0, take), offset);
        offset += take;
        this.audioBufferLength -= take;
        if (take < c.length) {
          this.audioChunks[0] = c.subarray(take);
        } else {
          this.audioChunks.shift();
        }
      }
      const base64Audio = this.uint8ArrayToBase64(merged);
      this.ws.send(
        JSON.stringify({
          type: 'input_audio.append',
          audio: base64Audio,
        })
      );
      if (!this.lastAudioLogTime || Date.now() - this.lastAudioLogTime > 2000) {
        getEventSystem().info(EventCategory.AUDIO, `🎤 [Mistral Voxtral] Sending ${merged.length} bytes (buffered)`);
        this.lastAudioLogTime = Date.now();
      }
    }
  }

  async end(): Promise<void> {
    if (this.ws && this.active && this.ws.readyState === WebSocket.OPEN) {
      if (this.audioChunks.length > 0 && this.audioBufferLength > 0) {
        const bytes = new Uint8Array(this.audioBufferLength);
        let offset = 0;
        for (const c of this.audioChunks) {
          bytes.set(c, offset);
          offset += c.length;
        }
        this.audioChunks = [];
        this.audioBufferLength = 0;
        const base64Audio = this.uint8ArrayToBase64(bytes);
        this.ws.send(
          JSON.stringify({
            type: 'input_audio.append',
            audio: base64Audio,
          })
        );
      }
      getEventSystem().info(EventCategory.SESSION, '🔌 [Mistral Voxtral] Ending (sending input_audio.end)');
      this.ws.send(JSON.stringify({ type: 'input_audio.end' }));
      this.active = false;
      this.speechStarted = false;
    }
  }

  async stop(): Promise<void> {
    if (this.ws) {
      this.audioChunks = [];
      this.audioBufferLength = 0;
      getEventSystem().info(EventCategory.SESSION, '🔌 [Mistral Voxtral] Stopping (closing WebSocket)');
      try {
        this.ws.close();
      } catch (error) {
        getEventSystem().error(EventCategory.SESSION, '❌ [Mistral Voxtral] Error closing:', error);
      }
      this.ws = null;
      this.active = false;
      this.speechStarted = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  /** Base64 encode Uint8Array without stack overflow on large chunks */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
}

interface MistralVoxtralConfig {
  model: string;
  sampleRate: number;
  language?: string;
}
