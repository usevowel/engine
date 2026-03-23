/**
 * Base STT Provider
 * 
 * Abstract base class for STT providers.
 * Provides common functionality and enforces interface.
 */

import { ISTTProvider, ProviderCapabilities, STTResult, STTTranscribeOptions, STTStreamCallbacks, STTStreamingSession } from '../../../types/providers';

export abstract class BaseSTTProvider implements ISTTProvider {
  abstract readonly name: string;
  abstract readonly type: 'streaming' | 'batch';
  
  protected initialized = false;

  abstract initialize(): Promise<void>;
  abstract transcribe(audioBuffer: Uint8Array, options?: STTTranscribeOptions): Promise<STTResult>;
  abstract startStream(callbacks: STTStreamCallbacks, tokenTurnDetection?: any, languageDetectionEnabled?: boolean): Promise<STTStreamingSession>;
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

