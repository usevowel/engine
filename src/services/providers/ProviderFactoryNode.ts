/**
 * Provider Factory (Node.js/Bun)
 * 
 * Extends the base ProviderFactory to add ONNX-based provider support.
 * Only use this in Node.js/Bun environments where onnxruntime-node is available.
 * 
 * For Cloudflare Workers, use the base ProviderFactory.
 */

import { ProviderFactory as BaseProviderFactory } from './ProviderFactory';
import { ITTSProvider, IVADProvider } from '../../types/providers';
import { RuntimeProviderConfig } from '../../config/RuntimeConfig';

/**
 * Node.js/Bun Provider Factory
 * Extends base factory to add ONNX provider support
 */
export class ProviderFactory extends BaseProviderFactory {
  /**
   * Create TTS provider
   * @param providerConfig Runtime provider configuration
   */
  static override async createTTS(providerConfig: RuntimeProviderConfig): Promise<ITTSProvider> {
    // Delegate to base implementation for all providers
    return super.createTTS(providerConfig);
  }

  /**
   * Create VAD provider (with ONNX support)
   * @param providerConfig Runtime provider configuration
   */
  static override async createVAD(providerConfig: RuntimeProviderConfig): Promise<IVADProvider | null> {
    const config = providerConfig.vad;
    
    if (config.enabled && config.provider === 'silero') {
      // Dynamic import for ONNX-based provider
      const { SileroVADProvider } = await import('../../../packages/provider-silero-vad/src');
      return new SileroVADProvider(config.silero);
    }
    
    // Delegate to base implementation for other providers
    return super.createVAD(providerConfig);
  }
}
