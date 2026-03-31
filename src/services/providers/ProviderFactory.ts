/**
 * Provider Factory (Base)
 * 
 * Factory for creating provider instances based on configuration.
 * This base version only supports public/shared providers.
 * 
 * For Node.js/Bun environments with ONNX support, use ProviderFactoryNode.ts
 * which extends this class and adds Silero VAD support.
 */

import { ISTTProvider, ITTSProvider, IVADProvider } from '../../types/providers';
import { RuntimeProviderConfig } from '../../config/RuntimeConfig';

import { getEventSystem, EventCategory } from '../../events';
// Public/shared providers
import { GroqWhisperSTT } from '../../../packages/provider-groq-whisper-stt/src';
import { MistralVoxtralRealtimeSTT } from '../../../packages/provider-mistral-voxtral-realtime-stt/src';
import { DeepgramSTT } from '../../../packages/provider-deepgram-stt/src';
import { DeepgramTTS } from '../../../packages/provider-deepgram-tts/src';

/**
 * Base Provider Factory
 * Creates and initializes public/shared provider instances only.
 * Extended by ProviderFactoryNode.ts for ONNX support.
 */
export class ProviderFactory {
  /**
   * Create STT provider
   * @param providerConfig Runtime provider configuration
   * @param fullRuntimeConfig Full runtime configuration (for turn detection, etc.)
   */
  static createSTT(providerConfig: RuntimeProviderConfig, fullRuntimeConfig?: any): ISTTProvider {
    const config = providerConfig.stt;
    
    switch (config.provider) {
      case 'groq-whisper':
        if (!config.groqWhisper?.apiKey) {
          throw new Error('Groq API key not configured');
        }
        return new GroqWhisperSTT(
          config.groqWhisper.apiKey,
          {
            model: config.groqWhisper.model,
            whisperModel: config.groqWhisper.whisperModel,
          }
        );
        
      case 'fennec':
        throw new Error('Fennec STT is hosted-only. Use the private engine-hosted runtime.');
        
      case 'assemblyai':
        throw new Error('AssemblyAI STT is hosted-only. Use the private engine-hosted runtime.');

      case 'modulate':
        throw new Error('Modulate STT is hosted-only. Use the private engine-hosted runtime.');

      case 'mistral-voxtral-realtime':
        if (!config.mistralVoxtralRealtime?.apiKey) {
          throw new Error('Mistral API key not configured');
        }
        return new MistralVoxtralRealtimeSTT(
          config.mistralVoxtralRealtime.apiKey,
          config.mistralVoxtralRealtime
        );
        
      case 'deepgram':
        if (!config.deepgram?.apiKey) {
          throw new Error('Deepgram API key not configured');
        }
        return new DeepgramSTT(
          config.deepgram.apiKey,
          {
            model: config.deepgram.model,
            language: config.deepgram.language,
            sampleRate: config.deepgram.sampleRate,
          }
        );
        
      default:
        getEventSystem().warn(EventCategory.STT, `Unknown STT provider: ${config.provider}, using default (groq-whisper)`);
        return new GroqWhisperSTT();
    }
  }

  /**
   * Create TTS provider
   * @param providerConfig Runtime provider configuration
   */
  static async createTTS(providerConfig: RuntimeProviderConfig): Promise<ITTSProvider> {
    const config = providerConfig.tts;
    
    switch (config.provider) {
      case 'inworld':
        throw new Error('Inworld TTS is hosted-only. Use the private engine-hosted runtime.');
        
      case 'deepgram':
        if (!config.deepgram?.apiKey) {
          throw new Error('Deepgram API key not configured');
        }
        return new DeepgramTTS(
          config.deepgram.apiKey,
          {
            model: config.deepgram.model,
            sampleRate: config.deepgram.sampleRate,
            encoding: config.deepgram.encoding,
          }
        );
        
      default:
        throw new Error(`Unsupported public TTS provider: ${config.provider}`);
    }
  }

  /**
   * Create VAD provider
   * @param providerConfig Runtime provider configuration
   */
  static async createVAD(providerConfig: RuntimeProviderConfig): Promise<IVADProvider | null> {
    const config = providerConfig.vad;
    
    if (!config.enabled) {
      return null;
    }
    
    switch (config.provider) {
      case 'silero':
        throw new Error(
          'Silero VAD is not available in base ProviderFactory. ' +
          'Use ProviderFactory from "ProviderFactoryNode" in Node.js/Bun environments.'
        );
        
      case 'fennec-integrated':
        throw new Error('Fennec integrated VAD is hosted-only. Use the private engine-hosted runtime.');
        
      case 'assemblyai-integrated':
        // VAD is integrated into AssemblyAISTT, no separate provider needed
        return null;
        
      case 'none':
        return null;
        
      default:
        getEventSystem().warn(EventCategory.VAD, `Unknown VAD provider: ${config.provider}, disabling VAD`);
        return null;
    }
  }

  /**
   * Create and initialize all providers
   * @param providerConfig Runtime provider configuration
   * @param fullRuntimeConfig Full runtime configuration (for turn detection, etc.)
   */
  static async createAll(providerConfig: RuntimeProviderConfig, fullRuntimeConfig?: any): Promise<{
    stt: ISTTProvider;
    tts: ITTSProvider;
    vad: IVADProvider | null;
  }> {
    try {
      getEventSystem().info(EventCategory.PROVIDER, '🔧 [ProviderFactory] Creating STT provider...');
      const stt = this.createSTT(providerConfig, fullRuntimeConfig);
      getEventSystem().info(EventCategory.PROVIDER, `✅ [ProviderFactory] STT provider created: ${providerConfig.stt.provider}`);
      
      getEventSystem().info(EventCategory.PROVIDER, '🔧 [ProviderFactory] Creating TTS provider...');
      const tts = await this.createTTS(providerConfig);
      getEventSystem().info(EventCategory.PROVIDER, `✅ [ProviderFactory] TTS provider created: ${providerConfig.tts.provider}`);
      
      getEventSystem().info(EventCategory.PROVIDER, '🔧 [ProviderFactory] Creating VAD provider...');
      const vad = await this.createVAD(providerConfig);
      getEventSystem().info(EventCategory.PROVIDER, `✅ [ProviderFactory] VAD provider created: ${providerConfig.vad.provider} (enabled: ${providerConfig.vad.enabled})`);

      // Initialize all providers
      getEventSystem().info(EventCategory.PROVIDER, '🔧 [ProviderFactory] Initializing STT provider...');
      await stt.initialize();
      getEventSystem().info(EventCategory.PROVIDER, '✅ [ProviderFactory] STT provider initialized');
      
      getEventSystem().info(EventCategory.PROVIDER, '🔧 [ProviderFactory] Initializing TTS provider...');
      await tts.initialize();
      getEventSystem().info(EventCategory.PROVIDER, '✅ [ProviderFactory] TTS provider initialized');
      
      if (vad) {
        getEventSystem().info(EventCategory.PROVIDER, '🔧 [ProviderFactory] Initializing VAD provider...');
        await vad.initialize();
        getEventSystem().info(EventCategory.PROVIDER, '✅ [ProviderFactory] VAD provider initialized');
      }

      getEventSystem().info(EventCategory.PROVIDER, '✅ [ProviderFactory] All providers created and initialized successfully');
      return { stt, tts, vad };
    } catch (error) {
      getEventSystem().error(EventCategory.PROVIDER, '❌ [ProviderFactory] Failed to create/initialize providers', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : 'No stack',
        errorName: error instanceof Error ? error.name : 'Unknown',
        sttProvider: providerConfig.stt.provider,
        ttsProvider: providerConfig.tts.provider,
        vadProvider: providerConfig.vad.provider,
      });
      throw error;
    }
  }
}
