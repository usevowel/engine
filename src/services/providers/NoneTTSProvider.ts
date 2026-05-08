import { BaseTTSProvider } from './base/BaseTTSProvider';
import type { ProviderCapabilities, TTSSynthesizeOptions } from '../../types/providers';

export class NoneTTSProvider extends BaseTTSProvider {
  readonly name = 'none';
  readonly type = 'batch' as const;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async synthesize(_text: string, _options?: TTSSynthesizeOptions): Promise<Uint8Array> {
    return new Uint8Array(0);
  }

  async *synthesizeStream(_text: string, _options?: TTSSynthesizeOptions): AsyncIterableIterator<Uint8Array> {
  }

  getSampleRate(): number {
    return 24000;
  }

  async getAvailableVoices(): Promise<string[]> {
    return [];
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
