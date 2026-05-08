import { BaseSTTProvider } from './base/BaseSTTProvider';
import type { ProviderCapabilities, STTResult, STTTranscribeOptions, STTStreamCallbacks, STTStreamingSession } from '../../types/providers';

class NoneSTTStreamingSession implements STTStreamingSession {
  async waitForConnection(): Promise<void> {}
  async sendAudio(_chunk: Uint8Array): Promise<void> {}
  async end(): Promise<void> {}
  async stop(): Promise<void> {}
  isActive(): boolean { return false; }
}

export class NoneSTTProvider extends BaseSTTProvider {
  readonly name = 'none';
  readonly type = 'batch' as const;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async transcribe(_audioBuffer: Uint8Array, _options?: STTTranscribeOptions): Promise<STTResult> {
    return { text: '' };
  }

  async startStream(_callbacks: STTStreamCallbacks, _tokenTurnDetection?: any, _languageDetectionEnabled?: boolean): Promise<STTStreamingSession> {
    return new NoneSTTStreamingSession();
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsVAD: false,
      supportsLanguageDetection: false,
      supportsMultipleVoices: false,
      requiresNetwork: false,
      supportsGPU: false,
    };
  }
}
