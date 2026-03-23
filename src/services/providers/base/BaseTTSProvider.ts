/**
 * Base TTS Provider
 * 
 * Abstract base class for TTS providers.
 * Provides common functionality and enforces interface.
 */

import { ITTSProvider, ProviderCapabilities, TTSSynthesizeOptions } from '../../../types/providers';

export abstract class BaseTTSProvider implements ITTSProvider {
  abstract readonly name: string;
  abstract readonly type: 'streaming' | 'batch';
  
  protected initialized = false;

  abstract initialize(): Promise<void>;
  abstract synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Uint8Array>;
  abstract synthesizeStream(text: string, options?: TTSSynthesizeOptions): AsyncIterableIterator<Uint8Array>;
  abstract getSampleRate(): number;
  abstract getAvailableVoices(): Promise<string[]>;
  abstract getCapabilities(): ProviderCapabilities;
  
  isReady(): boolean {
    return this.initialized;
  }
  
  async dispose(): Promise<void> {
    this.initialized = false;
  }
  
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`${this.name} provider not initialized`);
    }
  }
}

