/**
 * Silero VAD Provider
 *
 * Local voice activity detection using Silero VAD ONNX model.
 * Supports GPU acceleration via CUDA/Vulkan (Node.js mode) or WASM (Workers mode).
 *
 * MODE SELECTION:
 * - VAD_PROVIDER_MODE=node (default): Uses onnxruntime-node (Node.js/Bun)
 *   - Supports GPU acceleration via CUDA/Vulkan
 *   - Requires local model file
 * - VAD_PROVIDER_MODE=wasm: Uses onnxruntime-web (WASM for Cloudflare Workers)
 *   - Runs in Cloudflare Workers
 *   - Loads models from Static Assets or R2
 */

import { BaseVADProvider } from '../../../src/services/providers/base/BaseVADProvider';
import { VADConfig, VADState, VADEvent, ProviderCapabilities } from '../../../src/types/providers';
import { SileroVAD, VAD_PROVIDER_MODE } from '../../../src/services/vad';

import { getEventSystem, EventCategory } from '../../../src/events';

export class SileroVADProvider extends BaseVADProvider {
  readonly name = 'silero-vad';
  readonly mode = 'local' as const;

  private vad: SileroVAD | null = null;
  private config: VADConfig;
  private r2Bucket?: R2Bucket;

  constructor(config?: Partial<VADConfig>, r2Bucket?: R2Bucket) {
    super();
    this.config = {
      threshold: config?.threshold ?? 0.5,
      minSilenceDurationMs: config?.minSilenceDurationMs ?? 550,
      speechPadMs: config?.speechPadMs ?? 0,
      sampleRate: config?.sampleRate ?? 16000,
    };
    this.r2Bucket = r2Bucket;
  }

  async initialize(): Promise<void> {
    // Get model path from config or environment
    const modelPath = (this.config as any).modelPath || process.env.SILERO_VAD_MODEL_PATH;

    this.vad = new SileroVAD({
      threshold: this.config.threshold,
      minSilenceDurationMs: this.config.minSilenceDurationMs,
      speechPadMs: this.config.speechPadMs,
      sampleRate: this.config.sampleRate,
      modelPath: modelPath, // Pass model path for Workers (R2/CDN)
    });

    await this.vad.initialize();
    this.initialized = true;
    getEventSystem().info(EventCategory.PROVIDER, '🎤 [Silero] VAD settings:', {
      provider: 'silero',
      mode: VAD_PROVIDER_MODE,
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
    // Capabilities differ by mode
    if (VAD_PROVIDER_MODE === 'wasm') {
      return {
        supportsStreaming: false,
        supportsVAD: true,
        supportsLanguageDetection: false,
        supportsMultipleVoices: false,
        requiresNetwork: false, // Model can be bundled or cached
        supportsGPU: false, // WASM runs on CPU
      };
    }

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
