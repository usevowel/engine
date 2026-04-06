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
import { existsSync, createWriteStream, mkdirSync } from 'fs';

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

// Model download URL from official Silero VAD repository
const SILERO_VAD_MODEL_URL = 'https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx';

/**
 * Auto-download Silero VAD model if not present
 */
async function ensureVADModel(): Promise<void> {
  if (existsSync(SILERO_VAD_MODEL_PATH)) {
    return;
  }

  getEventSystem().info(EventCategory.VAD, '📥 Silero VAD model not found, auto-downloading...');
  getEventSystem().info(EventCategory.VAD, `   URL: ${SILERO_VAD_MODEL_URL}`);
  getEventSystem().info(EventCategory.VAD, `   Target: ${SILERO_VAD_MODEL_PATH}`);

  try {
    // Create directory if needed
    const targetDir = join(process.cwd(), 'vendor', 'silero-vad');
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // Download model
    const response = await fetch(SILERO_VAD_MODEL_URL);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    const fileStream = createWriteStream(SILERO_VAD_MODEL_PATH);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('Response body is not readable');
    }

    let downloaded = 0;
    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      fileStream.write(Buffer.from(value));
      downloaded += value.length;

      if (total) {
        const percent = ((downloaded / total) * 100).toFixed(1);
        process.stdout.write(`\r   Progress: ${percent}% (${(downloaded / 1024 / 1024).toFixed(2)} MB)`);
      }
    }

    fileStream.end();
    console.log('\n✅ Silero VAD model downloaded successfully');
  } catch (error) {
    getEventSystem().error(EventCategory.VAD, '❌ Failed to auto-download VAD model:', error);
    throw new Error(`Failed to download VAD model: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

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
   * 
   * NOTE: onnxruntime-node npm package only includes CPU execution provider.
   * GPU support (CUDA/DirectML) requires:
   * - Custom onnxruntime build with GPU support
   * - Proper NVIDIA/AMD drivers and libraries
   * - ORT_CUDA_PROVIDER or ORT_DML_PROVIDER env vars explicitly set
   */
  private detectExecutionProviders(): string[] {
    const providers: string[] = [];
    let hasGPU = false;

    // Check for explicit GPU provider configuration
    // Standard onnxruntime-node only supports CPU - GPU requires custom build
    if (process.env.ORT_CUDA_PROVIDER === '1' || process.env.ORT_CUDA_PROVIDER === 'true') {
      // Only try CUDA if explicitly requested via env (requires custom onnxruntime build)
      getEventSystem().warn(EventCategory.VAD, '⚠️  ORT_CUDA_PROVIDER set but onnxruntime-node requires custom CUDA build');
      getEventSystem().warn(EventCategory.VAD, '⚠️  Standard npm package only supports CPU execution');
      getEventSystem().info(EventCategory.VAD, '   To enable CUDA, install onnxruntime-node from source with CUDA support');
    }

    if (process.env.ORT_DML_PROVIDER === '1' || process.env.ORT_DML_PROVIDER === 'true') {
      // DirectML for Windows GPU
      getEventSystem().warn(EventCategory.VAD, '⚠️  ORT_DML_PROVIDER set but DirectML requires onnxruntime-node with DirectML support');
    }

    // Always use CPU for standard onnxruntime-node package
    // GPU support requires:
    // 1. Building onnxruntime from source with CUDA/DirectML flags
    // 2. Installing with: npm install onnxruntime-node --build-from-source --onnxruntime_cuda_version=11.8
    // 3. Or using the official CUDA-enabled binaries (separate package)
    providers.push('cpu');

    if (!hasGPU) {
      getEventSystem().info(EventCategory.VAD, 'ℹ️  VAD using CPU execution (standard onnxruntime-node)');
      getEventSystem().info(EventCategory.PERFORMANCE, '⚡ To enable GPU acceleration (~5-10ms vs ~50-100ms):');
      getEventSystem().info(EventCategory.VAD, '   1. Build onnxruntime-node with CUDA: https://onnxruntime.ai/docs/build/');
      getEventSystem().info(EventCategory.VAD, '   2. Or use pre-built CUDA binaries (requires separate installation)');
      getEventSystem().info(EventCategory.PERFORMANCE, '⚡ Current latency: ~50-100ms per inference (acceptable for most use cases)');
    }

    return providers;
  }

  /**
   * Initialize the VAD model
   */
  async initialize(): Promise<void> {
    if (this.session) return;

    try {
      // Auto-download model if not present
      await ensureVADModel();

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

