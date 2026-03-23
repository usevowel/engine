/**
 * Silero VAD Provider
 * 
 * Local voice activity detection using Silero VAD ONNX model.
 * Supports GPU acceleration via CUDA/Vulkan.
 * 
 * ⚠️ PRODUCTION WARNING:
 * This provider is NOT compatible with Cloudflare Workers deployment.
 * Cloudflare Workers do not support:
 * - Native ONNX runtime (onnxruntime-node)
 * - File system access for model loading
 * - Real-time audio processing requirements
 * 
 * For Cloudflare Workers deployment, use AssemblyAI or Fennec with integrated VAD.
 * This provider works only in Bun/Node.js runtime environments.
 */

import { BaseVADProvider } from '../../../src/services/providers/base/BaseVADProvider';
import { VADConfig, VADState, VADEvent, ProviderCapabilities } from '../../../src/types/providers';
import { SileroVAD } from '../../../src/services/vad';

import { getEventSystem, EventCategory } from '../../../src/events';
export class SileroVADProvider extends BaseVADProvider {
  readonly name = 'silero-vad';
  readonly mode = 'local' as const;
  
  private vad: SileroVAD | null = null;
  private config: VADConfig;

  constructor(config?: Partial<VADConfig>) {
    super();
    this.config = {
      threshold: config?.threshold ?? 0.5,
      minSilenceDurationMs: config?.minSilenceDurationMs ?? 550,
      speechPadMs: config?.speechPadMs ?? 0,
      sampleRate: config?.sampleRate ?? 16000,
    };
  }

  async initialize(): Promise<void> {
    this.vad = new SileroVAD({
      threshold: this.config.threshold,
      minSilenceDurationMs: this.config.minSilenceDurationMs,
      speechPadMs: this.config.speechPadMs,
      sampleRate: this.config.sampleRate,
    });
    
    await this.vad.initialize();
    this.initialized = true;
    getEventSystem().info(EventCategory.PROVIDER, '🎤 [Silero] VAD settings:', {
      provider: 'silero',
      threshold: this.config.threshold,
      minSilenceDurationMs: this.config.minSilenceDurationMs,
      speechPadMs: this.config.speechPadMs,
      sampleRate: this.config.sampleRate,
    });
  }

  async detectSpeech(
    audioChunk: Float32Array,
    timestampMs: number
  ): Promise<VADEvent | null> {
    this.ensureInitialized();
    return this.vad!.detectSpeech(audioChunk, timestampMs);
  }

  getState(): VADState {
    this.ensureInitialized();
    return this.vad!.getState();
  }

  async resetState(): Promise<void> {
    this.ensureInitialized();
    await this.vad!.resetState();
  }

  updateConfig(config: Partial<VADConfig>): void {
    this.config = { ...this.config, ...config };
    // Note: Silero VAD doesn't support runtime config updates
    // Would need to reinitialize
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsVAD: true,
      supportsLanguageDetection: false,
      supportsMultipleVoices: false,
      requiresNetwork: false,
      supportsGPU: true,
    };
  }
}
