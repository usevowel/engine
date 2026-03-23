/**
 * Base VAD Provider
 * 
 * Abstract base class for VAD providers.
 * Provides common functionality and enforces interface.
 */

import { IVADProvider, ProviderCapabilities, VADConfig, VADState, VADEvent } from '../../../types/providers';

export abstract class BaseVADProvider implements IVADProvider {
  abstract readonly name: string;
  abstract readonly mode: 'local' | 'remote' | 'integrated';
  
  protected initialized = false;

  abstract initialize(): Promise<void>;
  abstract detectSpeech(audioChunk: Float32Array, timestampMs: number): Promise<VADEvent | null>;
  abstract getState(): VADState;
  abstract resetState(): Promise<void>;
  abstract updateConfig(config: Partial<VADConfig>): void;
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

