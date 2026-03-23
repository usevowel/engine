/**
 * Session Manager
 * 
 * Manages provider instances for each session.
 * Handles initialization and cleanup of STT, TTS, and VAD providers.
 * 
 * NOW RUNTIME-AGNOSTIC: Accepts configuration as parameter.
 */

import { ISTTProvider, ITTSProvider, IVADProvider } from '../types/providers';
import { ProviderFactory } from '../services/providers/ProviderFactory';
import { RuntimeConfig } from '../config/RuntimeConfig';

import { getEventSystem, EventCategory } from '../events';
export interface SessionProviders {
  stt: ISTTProvider;
  tts: ITTSProvider;
  vad: IVADProvider | null;
}

/**
 * Session Manager
 * Creates and manages provider instances
 */
export class SessionManager {
  private static globalProviders: SessionProviders | null = null;
  private static runtimeConfig: RuntimeConfig | null = null;
  private static providerFactory: typeof ProviderFactory = ProviderFactory;

  /**
   * Override the provider factory for the current runtime.
   * Node/Bun uses this to supply ONNX-capable providers without pulling them into Workers.
   */
  static setProviderFactory(providerFactory: typeof ProviderFactory): void {
    if (this.providerFactory !== providerFactory) {
      this.providerFactory = providerFactory;
      this.globalProviders = null;
      this.runtimeConfig = null;
    }
  }

  /**
   * Get or create global provider instances
   * Providers are shared across sessions for efficiency
   * @param config Runtime configuration
   */
  static async getProviders(config: RuntimeConfig): Promise<SessionProviders> {
    // If config changes, recreate providers
    if (this.runtimeConfig && this.runtimeConfig !== config) {
      this.globalProviders = null;
    }
    
    if (!this.globalProviders) {
      getEventSystem().info(EventCategory.PROVIDER, '🔧 Initializing providers...');
      this.runtimeConfig = config;
      this.globalProviders = await this.providerFactory.createAll(config.providers, config);
      getEventSystem().info(EventCategory.PROVIDER, '✅ Providers initialized');
    }
    return this.globalProviders;
  }

  /**
   * Check if current STT provider supports streaming
   * @param config Runtime configuration
   */
  static isStreamingSTT(config: RuntimeConfig): boolean {
    return config.providers.stt.provider !== 'groq-whisper';
  }

  /**
   * Check if VAD is enabled
   * @param config Runtime configuration
   */
  static isVADEnabled(config: RuntimeConfig): boolean {
    return config.providers.vad.enabled;
  }

  /**
   * Check if VAD is integrated (no separate VAD provider needed)
   * @param config Runtime configuration
   */
  static isVADIntegrated(config: RuntimeConfig): boolean {
    return config.providers.vad.provider === 'fennec-integrated' || 
           config.providers.vad.provider === 'assemblyai-integrated';
  }

  /**
   * Cleanup providers
   */
  static async cleanup(): Promise<void> {
    if (this.globalProviders) {
      await this.globalProviders.stt.dispose();
      await this.globalProviders.tts.dispose();
      if (this.globalProviders.vad) {
        await this.globalProviders.vad.dispose();
      }
      this.globalProviders = null;
    }
  }
}
