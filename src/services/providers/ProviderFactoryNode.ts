/**
 * Provider Factory (Node.js/Bun)
 * 
 * Extends the base ProviderFactory.
 * In the registry-based model, all providers (including Silero VAD)
 * are registered via ProviderRegistry at startup, so this class
 * simply delegates to the base implementation.
 */

import { ProviderFactory as BaseProviderFactory } from './ProviderFactory';
import { ITTSProvider, IVADProvider } from '../../types/providers';
import { RuntimeProviderConfig } from '../../config/RuntimeConfig';

export class ProviderFactory extends BaseProviderFactory {
  static override async createTTS(providerConfig: RuntimeProviderConfig): Promise<ITTSProvider> {
    return super.createTTS(providerConfig);
  }

  static override async createVAD(providerConfig: RuntimeProviderConfig): Promise<IVADProvider | null> {
    return super.createVAD(providerConfig);
  }
}
