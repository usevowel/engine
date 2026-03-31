/**
 * Provider Factory (Base)
 * 
 * Factory for creating provider instances based on configuration.
 * Uses ProviderRegistry for dynamic provider lookup.
 */

import { ISTTProvider, ITTSProvider, IVADProvider } from '../../types/providers';
import { RuntimeProviderConfig } from '../../config/RuntimeConfig';
import { getEventSystem, EventCategory } from '../../events';
import { ProviderRegistry } from './ProviderRegistry';

/**
 * Base Provider Factory
 * Creates and initializes provider instances via the ProviderRegistry.
 * Extended by ProviderFactoryNode.ts for ONNX support.
 */
export class ProviderFactory {
  /**
   * Create STT provider
   */
  static createSTT(providerConfig: RuntimeProviderConfig, _fullRuntimeConfig?: RuntimeProviderConfig): ISTTProvider {
    const config = providerConfig.stt;
    const registration = ProviderRegistry.getSTTProvider(config.provider);

    if (!registration) {
      throw new Error(`Unknown STT provider: ${config.provider}. Available: ${ProviderRegistry.getAvailableSTTProviders().join(', ')}`);
    }

    getEventSystem().info(EventCategory.PROVIDER, `Creating STT provider: ${config.provider}`);
    const parsed = registration.configSchema.parse(config.config);
    return registration.factory(parsed, providerConfig) as ISTTProvider;
  }

  /**
   * Create TTS provider
   */
  static async createTTS(providerConfig: RuntimeProviderConfig): Promise<ITTSProvider> {
    const config = providerConfig.tts;
    const registration = ProviderRegistry.getTTSProvider(config.provider);

    if (!registration) {
      throw new Error(`Unknown TTS provider: ${config.provider}. Available: ${ProviderRegistry.getAvailableTTSProviders().join(', ')}`);
    }

    getEventSystem().info(EventCategory.PROVIDER, `Creating TTS provider: ${config.provider}`);
    const parsed = registration.configSchema.parse(config.config);
    return registration.factory(parsed, providerConfig) as ITTSProvider;
  }

  /**
   * Create VAD provider
   */
  static async createVAD(providerConfig: RuntimeProviderConfig): Promise<IVADProvider | null> {
    const config = providerConfig.vad;

    if (!config.enabled) {
      return null;
    }

    const registration = ProviderRegistry.getVADProvider(config.provider);

    if (!registration) {
      getEventSystem().warn(EventCategory.VAD, `Unknown VAD provider: ${config.provider}, disabling VAD. Available: ${ProviderRegistry.getAvailableVADProviders().join(', ')}`);
      return null;
    }

    getEventSystem().info(EventCategory.PROVIDER, `Creating VAD provider: ${config.provider}`);
    const parsed = config.config !== undefined ? registration.configSchema.parse(config.config) : {};
    return registration.factory(parsed, providerConfig) as IVADProvider | null;
  }

  /**
   * Create and initialize all providers
   */
  static async createAll(providerConfig: RuntimeProviderConfig, fullRuntimeConfig?: RuntimeProviderConfig): Promise<{
    stt: ISTTProvider;
    tts: ITTSProvider;
    vad: IVADProvider | null;
  }> {
    try {
      getEventSystem().info(EventCategory.PROVIDER, 'Creating STT provider...');
      const stt = this.createSTT(providerConfig, fullRuntimeConfig);
      getEventSystem().info(EventCategory.PROVIDER, `STT provider created: ${providerConfig.stt.provider}`);

      getEventSystem().info(EventCategory.PROVIDER, 'Creating TTS provider...');
      const tts = await this.createTTS(providerConfig);
      getEventSystem().info(EventCategory.PROVIDER, `TTS provider created: ${providerConfig.tts.provider}`);

      getEventSystem().info(EventCategory.PROVIDER, 'Creating VAD provider...');
      const vad = await this.createVAD(providerConfig);
      getEventSystem().info(EventCategory.PROVIDER, `VAD provider created: ${providerConfig.vad.provider} (enabled: ${providerConfig.vad.enabled})`);

      // Initialize all providers
      getEventSystem().info(EventCategory.PROVIDER, 'Initializing STT provider...');
      await stt.initialize();
      getEventSystem().info(EventCategory.PROVIDER, 'STT provider initialized');

      getEventSystem().info(EventCategory.PROVIDER, 'Initializing TTS provider...');
      await tts.initialize();
      getEventSystem().info(EventCategory.PROVIDER, 'TTS provider initialized');

      if (vad) {
        getEventSystem().info(EventCategory.PROVIDER, 'Initializing VAD provider...');
        await vad.initialize();
        getEventSystem().info(EventCategory.PROVIDER, 'VAD provider initialized');
      }

      getEventSystem().info(EventCategory.PROVIDER, 'All providers created and initialized successfully');
      return { stt, tts, vad };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      getEventSystem().error(EventCategory.PROVIDER, `Failed to create/initialize providers: ${errMsg}`);
      throw error;
    }
  }
}
