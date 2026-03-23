/**
 * Voice Activity Detection (VAD) Service
 * 
 * Implements Silero VAD v5 using ONNX Runtime for high-performance
 * speech detection with GPU acceleration support (CUDA, Vulkan, CPU).
 * 
 * NOTE: This module lazy-loads onnxruntime-node to avoid bundling issues.
 * Import happens on first use, not at module load.
 */

import { join } from 'path';

import { getEventSystem, EventCategory } from '../events';
// Lazy-load onnxruntime-node to avoid bundling issues
let ort: typeof import('onnxruntime-node') | null = null;

async function loadONNXRuntime() {
  if (!ort) {
    ort = await import('onnxruntime-node');
  }
  return ort;
}

const SILERO_VAD_MODEL_PATH = process.env.SILERO_VAD_MODEL_PATH || 
  join(process.cwd(), 'vendor/silero-vad/silero_vad.onnx');

/**
 * VAD configuration options
 */
export interface VADOptions {
  threshold?: number;              // Speech probability threshold (0-1), default: 0.5
  minSilenceDurationMs?: number;   // Minimum silence duration to detect end of speech (ms)
  speechPadMs?: number;            // Padding to add around speech segments (ms)
  sampleRate?: number;             // Audio sample rate (Hz), default: 16000
  executionProviders?: string[];   // ONNX execution providers (e.g., ['cuda', 'cpu'])
}

/**
 * VAD state for tracking speech segments
 */
export interface VADState {
  isSpeaking: boolean;
  speechStartMs: number | null;
  speechEndMs: number | null;
  lastSpeechProbability: number;
}

/**
 * Silero VAD model wrapper
 * 
 * Provides real-time voice activity detection using Silero VAD v5 ONNX model.
 * Supports GPU acceleration via CUDA or Vulkan when available.
 */
export class SileroVAD {
  private session: ort.InferenceSession | null = null;
  private options: Required<VADOptions>;
  private state: VADState;
  
  // Silero VAD expects 512 samples per chunk at 16kHz (32ms windows)
  private readonly CHUNK_SIZE = 512;
  private readonly CONTEXT_SIZE = 64; // Silero VAD requires 64 samples of context
  private readonly SAMPLE_RATE = 16000;
  
  // Internal state tensor for Silero VAD
  private modelState: ort.Tensor | null = null;
  private lastSr: ort.Tensor | null = null;
  private context: Float32Array | null = null; // Context from previous chunk

  constructor(options: VADOptions = {}) {
    this.options = {
      threshold: options.threshold ?? 0.5,
      minSilenceDurationMs: options.minSilenceDurationMs ?? 550,
      speechPadMs: options.speechPadMs ?? 0,
      sampleRate: options.sampleRate ?? 16000,
      executionProviders: options.executionProviders ?? this.detectExecutionProviders(),
    };

    this.state = {
      isSpeaking: false,
      speechStartMs: null,
      speechEndMs: null,
      lastSpeechProbability: 0,
    };
  }

  /**
   * Auto-detect best available execution providers
   */
  private detectExecutionProviders(): string[] {
    const providers: string[] = [];
    let hasGPU = false;

    // Try CUDA first (NVIDIA GPUs)
    try {
      // Check if CUDA is available (rough check via env or file system)
      if (process.env.CUDA_VISIBLE_DEVICES !== undefined || 
          require('fs').existsSync('/usr/local/cuda')) {
        providers.push('cuda');
        hasGPU = true;
        getEventSystem().info(EventCategory.PROVIDER, '✅ CUDA execution provider detected');
      }
    } catch {}

    // Try Vulkan (cross-platform GPU)
    try {
      const fs = require('fs');
      const vulkanPaths = [
        '/usr/lib/libvulkan.so',
        '/usr/lib/x86_64-linux-gnu/libvulkan.so.1',
        '/usr/lib/x86_64-linux-gnu/libvulkan.so',
        '/usr/local/lib/libvulkan.so',
        '/opt/amdgpu/lib/x86_64-linux-gnu/libvulkan.so.1', // AMD GPU Pro
        process.platform === 'win32' ? 'C:\\Windows\\System32\\vulkan-1.dll' : null,
        process.platform === 'darwin' ? '/usr/local/lib/libvulkan.dylib' : null,
      ].filter(Boolean);
      
      const hasVulkan = vulkanPaths.some(path => {
        try {
          return fs.existsSync(path as string);
        } catch {
          return false;
        }
      });
      
      if (hasVulkan) {
        // Note: Standard onnxruntime-node may not support Vulkan EP
        // This requires either a custom build or ROCm EP (AMD)
        // We try adding it anyway - ONNX Runtime will ignore if unsupported
        providers.push('dml'); // DirectML (Windows GPU acceleration)
        hasGPU = true;
        getEventSystem().info(EventCategory.VAD, '✅ Vulkan libraries detected (attempting DirectML/GPU acceleration)');
      }
    } catch (error) {
      // Silent fail for Vulkan detection
    }

    // Always add CPU as fallback
    providers.push('cpu');

    if (!hasGPU) {
      getEventSystem().warn(EventCategory.VAD, '⚠️  WARNING: No GPU acceleration libraries detected for VAD!');
      getEventSystem().warn(EventCategory.VAD, '⚠️  Install CUDA Toolkit (NVIDIA) or Vulkan SDK (AMD/Intel) for better performance');
      getEventSystem().warn(EventCategory.PERFORMANCE, '⚠️  Running on CPU only - expect higher latency (~50-100ms per inference)');
    }

    return providers;
  }

  /**
   * Initialize the VAD model
   */
  async initialize(): Promise<void> {
    if (this.session) return;

    try {
      // Lazy-load onnxruntime-node
      const runtime = await loadONNXRuntime();
      
      getEventSystem().info(EventCategory.VAD, `🎤 Loading Silero VAD model: ${SILERO_VAD_MODEL_PATH}`);
      getEventSystem().info(EventCategory.PROVIDER, `🎯 Execution providers: ${this.options.executionProviders.join(', ')}`);

      this.session = await runtime.InferenceSession.create(SILERO_VAD_MODEL_PATH, {
        executionProviders: this.options.executionProviders,
        graphOptimizationLevel: 'all',
        enableCpuMemArena: true,
        enableMemPattern: true,
      });

      if (!this.session) {
        throw new Error('InferenceSession.create returned null/undefined');
      }

      getEventSystem().info(EventCategory.VAD, '✅ Silero VAD model loaded');
      
      // Verify execution provider after session creation
      const activeProviders = this.session.executionProviders || ['unknown'];
      const usingGPU = activeProviders.some(p => 
        p !== 'cpu' && 
        p !== 'CPUExecutionProvider' && 
        p !== 'unknown'
      );
      
      getEventSystem().info(EventCategory.PROVIDER, `📊 Active execution providers: ${activeProviders.join(', ')}`);
      
      if (!usingGPU) {
        getEventSystem().warn(EventCategory.VAD, '⚠️  WARNING: VAD is running on CPU only!');
        getEventSystem().warn(EventCategory.PERFORMANCE, '⚠️  For optimal real-time performance, install GPU acceleration:');
        getEventSystem().warn(EventCategory.VAD, '⚠️    - NVIDIA GPUs: Install CUDA Toolkit (https://developer.nvidia.com/cuda-downloads)');
        getEventSystem().warn(EventCategory.VAD, '⚠️    - AMD/Intel GPUs: Install Vulkan SDK (https://vulkan.lunarg.com/)');
        getEventSystem().warn(EventCategory.PERFORMANCE, '⚠️  Expected latency: CPU ~50-100ms vs GPU ~5-10ms per inference');
      } else {
        const gpuProviders = activeProviders.filter(p => p !== 'cpu' && p !== 'CPUExecutionProvider');
        getEventSystem().info(EventCategory.VAD, `✅ VAD using GPU acceleration: ${gpuProviders.join(', ')}`);
        getEventSystem().info(EventCategory.PERFORMANCE, `⚡ Expected inference latency: ~5-10ms (vs ~50-100ms on CPU)`);
      }

      // Initialize state tensors
      this.resetState();
    } catch (error) {
      getEventSystem().error(EventCategory.VAD, '❌ Failed to load Silero VAD model:', error);
      throw new Error(`Failed to load VAD model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Reset internal VAD state
   */
  async resetState(): Promise<void> {
    const runtime = await loadONNXRuntime();
    
    // Initialize state tensor with zeros
    // Silero VAD v5 uses a combined state tensor with shape [2, 1, 128]
    const batchSize = 1;
    const hiddenSize = 128;
    const numLayers = 2;
    this.modelState = new runtime.Tensor(
      'float32', 
      new Float32Array(numLayers * batchSize * hiddenSize).fill(0), 
      [numLayers, batchSize, hiddenSize]
    );
    this.lastSr = new runtime.Tensor('int64', new BigInt64Array([BigInt(this.SAMPLE_RATE)]), [1]);
    
    // Initialize context with zeros
    this.context = new Float32Array(this.CONTEXT_SIZE).fill(0);

    this.state = {
      isSpeaking: false,
      speechStartMs: null,
      speechEndMs: null,
      lastSpeechProbability: 0,
    };
  }

  /**
   * Process an audio chunk and return speech probability
   * 
   * @param audioChunk - Float32Array of audio samples (16kHz, mono)
   * @returns Speech probability (0-1)
   */
  async process(audioChunk: Float32Array): Promise<number> {
    if (!this.session || !this.modelState || !this.lastSr || !this.context) {
      throw new Error('VAD not initialized');
    }

    // Ensure chunk is correct size (512 samples)
    if (audioChunk.length !== this.CHUNK_SIZE) {
      throw new Error(`Invalid chunk size: expected ${this.CHUNK_SIZE}, got ${audioChunk.length}`);
    }

    try {
      const runtime = await loadONNXRuntime();
      
      // Concatenate context with new audio chunk (64 + 512 = 576 samples)
      const inputWithContext = new Float32Array(this.CONTEXT_SIZE + this.CHUNK_SIZE);
      inputWithContext.set(this.context, 0);
      inputWithContext.set(audioChunk, this.CONTEXT_SIZE);
      
      // Prepare input tensor
      const inputTensor = new runtime.Tensor('float32', inputWithContext, [1, inputWithContext.length]);

      // Run inference with correct input names for Silero VAD v5
      const feeds = {
        input: inputTensor,
        state: this.modelState,
        sr: this.lastSr,
      };

      const results = await this.session.run(feeds);

      // Extract outputs
      const output = results.output as ort.Tensor;
      const stateN = results.stateN as ort.Tensor;

      // Update state for next iteration
      this.modelState = stateN;
      
      // Save last 64 samples as context for next iteration
      this.context = audioChunk.slice(-this.CONTEXT_SIZE);

      // Get speech probability
      const speechProb = output.data[0] as number;
      this.state.lastSpeechProbability = speechProb;

      return speechProb;
    } catch (error) {
      getEventSystem().error(EventCategory.VAD, '❌ VAD inference error:', error);
      throw error;
    }
  }

  /**
   * Process audio and detect speech start/stop events
   * 
   * @param audioChunk - Float32Array of audio samples
   * @param timestampMs - Current timestamp in milliseconds
   * @returns 'speech_start' | 'speech_end' | null
   */
  async detectSpeech(
    audioChunk: Float32Array,
    timestampMs: number
  ): Promise<'speech_start' | 'speech_end' | null> {
    const speechProb = await this.process(audioChunk);
    const isSpeech = speechProb >= this.options.threshold;

    // Log probability every 10 chunks (roughly every second at 32ms per chunk)
    if (!this._chunkCount) this._chunkCount = 0;
    this._chunkCount++;
    if (this._chunkCount % 10 === 0) {
      getEventSystem().info(EventCategory.VAD, `📊 VAD prob: ${speechProb.toFixed(3)} (threshold: ${this.options.threshold.toFixed(2)}, isSpeech: ${isSpeech})`);
    }

    // State machine for speech detection
    if (!this.state.isSpeaking && isSpeech) {
      // Speech started
      this.state.isSpeaking = true;
      this.state.speechStartMs = timestampMs;
      this.state.speechEndMs = null;
      getEventSystem().info(EventCategory.VAD, `🎤 Speech started at ${timestampMs}ms (prob: ${speechProb.toFixed(3)})`);
      return 'speech_start';
    } else if (this.state.isSpeaking && !isSpeech) {
      // Potential speech end (need to check silence duration)
      if (this.state.speechEndMs === null) {
        this.state.speechEndMs = timestampMs;
      }

      const silenceDuration = timestampMs - this.state.speechEndMs;
      if (silenceDuration >= this.options.minSilenceDurationMs) {
        // Confirmed speech end
        this.state.isSpeaking = false;
        getEventSystem().info(EventCategory.VAD, `🔇 Speech ended at ${timestampMs}ms (silence: ${silenceDuration}ms)`);
        return 'speech_end';
      }
    } else if (this.state.isSpeaking && isSpeech) {
      // Still speaking, reset speech end
      this.state.speechEndMs = null;
    }

    return null;
  }
  
  private _chunkCount?: number;

  /**
   * Get current VAD state
   */
  getState(): Readonly<VADState> {
    return { ...this.state };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.session = null;
    this.modelState = null;
    this.lastSr = null;
    this.context = null;
  }
}

// Singleton instance
let vadInstance: SileroVAD | null = null;

/**
 * Get or create VAD instance
 */
export async function getVAD(options?: VADOptions): Promise<SileroVAD> {
  if (!vadInstance) {
    vadInstance = new SileroVAD(options);
    await vadInstance.initialize();
  }
  return vadInstance;
}

/**
 * Check if VAD is ready
 */
export function isVADReady(): boolean {
  return vadInstance !== null;
}

