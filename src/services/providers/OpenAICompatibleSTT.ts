/**
 * OpenAI-compatible STT Provider
 *
 * Batch transcription against an OpenAI-compatible audio endpoint,
 * such as Echoline.
 */

import { BaseSTTProvider } from './base/BaseSTTProvider';
import {
  ProviderCapabilities,
  STTResult,
  STTStreamCallbacks,
  STTStreamingSession,
  STTTranscribeOptions,
} from '../../types/providers';
import { getEventSystem, EventCategory } from '../../events';

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:8000/v1';
const DEFAULT_OPENAI_COMPATIBLE_STT_MODEL = 'Systran/faster-whisper-tiny';

interface OpenAICompatibleSTTConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  language?: string;
  sampleRate?: number;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function createWavFile(pcmData: Uint8Array, sampleRate: number, numChannels: number = 1): Uint8Array {
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const fileSize = 44 + dataSize;

  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const wavFile = new Uint8Array(fileSize);
  wavFile.set(new Uint8Array(wavHeader), 0);
  wavFile.set(pcmData, 44);
  return wavFile;
}

export class OpenAICompatibleSTT extends BaseSTTProvider {
  readonly name = 'openai-compatible';
  readonly type = 'batch' as const;

  private apiKey?: string;
  private baseUrl: string;
  private model: string;
  private language?: string;
  private sampleRate: number;

  constructor(config?: OpenAICompatibleSTTConfig) {
    super();
    this.apiKey = config?.apiKey?.trim() || undefined;
    this.baseUrl = normalizeBaseUrl(config?.baseUrl || DEFAULT_OPENAI_COMPATIBLE_BASE_URL);
    this.model = config?.model || DEFAULT_OPENAI_COMPATIBLE_STT_MODEL;
    this.language = config?.language;
    this.sampleRate = config?.sampleRate || 24000;
  }

  async initialize(): Promise<void> {
    getEventSystem().info(EventCategory.STT, '✅ OpenAI-compatible STT initialized', {
      baseUrl: this.baseUrl,
      model: this.model,
    });
    this.initialized = true;
  }

  async transcribe(audioBuffer: Uint8Array, options?: STTTranscribeOptions): Promise<STTResult> {
    this.ensureInitialized();

    const formData = new FormData();
    const sampleRate = options?.sampleRate || this.sampleRate;
    const wavFile = createWavFile(audioBuffer, sampleRate, options?.channels || 1);

    formData.append('file', new Blob([wavFile], { type: 'audio/wav' }), 'audio.wav');
    formData.append('model', this.model);

    const language = options?.language || this.language;
    if (language) {
      formData.append('language', language);
    }

    const headers = new Headers();
    if (this.apiKey) {
      headers.set('Authorization', `Bearer ${this.apiKey}`);
    }

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI-compatible transcription failed: ${response.status} ${error}`);
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

  async startStream(_callbacks: STTStreamCallbacks): Promise<STTStreamingSession> {
    this.ensureInitialized();
    throw new Error('OpenAI-compatible STT streaming is not implemented in the engine yet; use batch STT with VAD');
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsVAD: false,
      supportsLanguageDetection: true,
      supportsMultipleVoices: false,
      requiresNetwork: true,
      supportsGPU: false,
    };
  }
}
