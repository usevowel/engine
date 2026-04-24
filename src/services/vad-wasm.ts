/**
 * Voice Activity Detection (VAD) Service - WASM Mode
 *
 * Implements Silero VAD v5 using ONNX Runtime Web (WASM) for Cloudflare Workers.
 * Provides real-time speech detection optimized for edge deployment.
 *
 * This is the WASM version - use VAD_PROVIDER_MODE=wasm to enable.
 * The default Node.js version is in vad.ts.
 */

import * as ort from 'onnxruntime-web';
import { getEventSystem, EventCategory } from '../events';
import { configureONNXRuntimeWASM } from '../lib/onnx-config-wasm';

/**
 * Default Silero VAD model path (can be overridden via env var)
 * Model will be loaded from R2 (no leading slash - R2 keys don't use leading slashes)
 */
const SILERO_VAD_MODEL_PATH = process.env.SILERO_VAD_MODEL_PATH || 'models/silero-vad/silero_vad.onnx';

/**
 * VAD configuration options
 */
export interface VADOptions {
  threshold?: number; // Speech probability threshold (0-1), default: 0.5
  minSilenceDurationMs?: number; // Minimum silence duration to detect end of speech (ms)
  speechPadMs?: number; // Padding to add around speech segments (ms)
  sampleRate?: number; // Audio sample rate (Hz), default: 16000
  executionProviders?: string[]; // ONNX execution providers (default: ['wasm'] for Workers)
  modelPath?: string; // Path to ONNX model (URL or R2 path)
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
 * Silero VAD model wrapper (WASM version)
 *
 * Provides real-time voice activity detection using Silero VAD v5 ONNX model.
 * Runs in WASM for Cloudflare Workers compatibility.
 */
export class SileroVAD {
  private session: ort.InferenceSession | null = null;
  private options: Required<Omit<VADOptions, 'modelPath'>> & { modelPath: string };
  private state: VADState;
  private r2Bucket?: R2Bucket;

  // Silero VAD expects 512 samples per chunk at 16kHz (32ms windows)
  private readonly CHUNK_SIZE = 512;
  private readonly CONTEXT_SIZE = 64; // Silero VAD requires 64 samples of context
  private readonly SAMPLE_RATE = 16000;

  // Internal state tensor for Silero VAD
  private modelState: ort.Tensor | null = null;
  private lastSr: ort.Tensor | null = null;
  private context: Float32Array | null = null; // Context from previous chunk

  constructor(options: VADOptions = {}, r2Bucket?: R2Bucket) {
    this.r2Bucket = r2Bucket;
    this.options = {
      threshold: options.threshold ?? 0.5,
      minSilenceDurationMs: options.minSilenceDurationMs ?? 550,
      speechPadMs: options.speechPadMs ?? 0,
      sampleRate: options.sampleRate ?? 16000,
      executionProviders: options.executionProviders ?? ['wasm'], // Default to WASM - files loaded from Static Assets
      modelPath: options.modelPath || SILERO_VAD_MODEL_PATH,
    };

    this.state = {
      isSpeaking: false,
      speechStartMs: null,
      speechEndMs: null,
      lastSpeechProbability: 0,
    };
  }

  /**
   * Initialize the VAD model
   */
  async initialize(): Promise<void> {
    if (this.session) return;

    const startTime = performance.now();

    try {
      // Configure ONNX Runtime WASM paths for Cloudflare Workers
      // Get worker base URL from global scope (set by worker.ts)
      const workerBaseUrl = typeof globalThis !== 'undefined' ? (globalThis as any).__WORKER_BASE_URL || '' : '';
      await configureONNXRuntimeWASM(workerBaseUrl);

      getEventSystem().info(EventCategory.VAD, `🎤 Loading Silero VAD model (WASM): ${this.options.modelPath}`);
      getEventSystem().info(EventCategory.PROVIDER, `🎯 Execution providers: ${this.options.executionProviders.join(', ')}`);

      // Load model with performance tracking
      const loadStartTime = performance.now();
      const modelData = await this.loadModel(this.options.modelPath);
      const loadTime = performance.now() - loadStartTime;

      // Create session with execution provider
      // WASM files are loaded from Workers Static Assets (configured in onnx-config.ts)
      const sessionOptions: ort.InferenceSession.SessionOptions = {
        executionProviders: this.options.executionProviders,
        graphOptimizationLevel: 'all',
        executionMode: 'sequential',
        interOpNumThreads: 1,
        intraOpNumThreads: 1,
      };

      const initStartTime = performance.now();
      this.session = await ort.InferenceSession.create(modelData, sessionOptions);
      const initTime = performance.now() - initStartTime;

      if (!this.session) {
        throw new Error('InferenceSession.create returned null/undefined');
      }

      const totalTime = performance.now() - startTime;

      getEventSystem().info(EventCategory.VAD, '✅ Silero VAD model loaded (WASM)', {
        loadTimeMs: Math.round(loadTime),
        initTimeMs: Math.round(initTime),
        totalTimeMs: Math.round(totalTime),
        modelPath: this.options.modelPath,
        source: this.r2Bucket ? 'R2' : 'CDN/URL',
      });
      getEventSystem().info(EventCategory.PROVIDER, `📊 Execution providers: ${this.options.executionProviders.join(', ')}`);
      getEventSystem().info(EventCategory.PERFORMANCE, `⚡ VAD running on WASM (CPU inference)`);

      // Initialize state tensors
      this.resetState();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      getEventSystem().error(EventCategory.VAD, '❌ Failed to load Silero VAD model:', err);
      throw new Error(`Failed to load VAD model: ${err.message}`);
    }
  }

  /**
   * Load model from Workers Static Assets (preferred) or R2 bucket (fallback)
   *
   * Models are served from Workers Static Assets for better performance.
   * Falls back to R2 if Static Assets aren't available.
   */
  private async loadModel(path: string): Promise<ArrayBuffer> {
    // If path is a URL, use it directly
    if (path.startsWith('http://') || path.startsWith('https://')) {
      getEventSystem().info(EventCategory.VAD, `🌐 Loading Silero VAD model from URL: ${path}`);
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to load model from URL: ${response.status} ${response.statusText}`);
      }
      return await response.arrayBuffer();
    }

    // Get worker base URL for Static Assets
    const workerBaseUrl = typeof globalThis !== 'undefined' ? (globalThis as any).__WORKER_BASE_URL || '' : '';

    // Try Static Assets first (faster, edge-cached)
    if (workerBaseUrl) {
      // Handle nested paths like 'models/silero-vad/silero_vad.onnx'
      const staticPath = path.replace(/^models\//, '');
      const staticAssetUrl = `${workerBaseUrl}/models/${staticPath}`;
      try {
        getEventSystem().info(EventCategory.VAD, `📦 Loading Silero VAD model from Static Assets: ${staticAssetUrl}`);
        const response = await fetch(staticAssetUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          getEventSystem().info(EventCategory.VAD, `✅ Model loaded from Static Assets, size: ${arrayBuffer.byteLength} bytes`);
          return arrayBuffer;
        }
        getEventSystem().warn(EventCategory.VAD, `⚠️ Model not found in Static Assets, falling back to R2`);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        getEventSystem().warn(EventCategory.VAD, `⚠️ Failed to load from Static Assets, falling back to R2: ${err.message}`);
      }
    }

    // Fallback to R2 bucket
    if (!this.r2Bucket) {
      throw new Error(
        `Silero VAD model not found in Static Assets and R2 bucket binding is missing. ` +
          `Please ensure models are in public/models/ or configure MODELS_R2 bucket. ` +
          `Run: bun run download-models`
      );
    }

    try {
      getEventSystem().info(EventCategory.VAD, `📦 Loading Silero VAD model from R2 (fallback): ${path}`);
      const r2Object = await this.r2Bucket.get(path);

      if (!r2Object) {
        throw new Error(
          `Silero VAD model not found in R2 bucket at path "${path}". ` +
            `Please upload the model to R2 or ensure it's in public/models/. ` +
            `Run: bun run download-models && bun run upload-models [env]`
        );
      }

      getEventSystem().info(EventCategory.VAD, `✅ Model found in R2, size: ${r2Object.size} bytes`);
      const arrayBuffer = await r2Object.arrayBuffer();
      getEventSystem().info(EventCategory.VAD, `✅ Model loaded successfully, buffer size: ${arrayBuffer.byteLength} bytes`);
      return arrayBuffer;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      getEventSystem().error(EventCategory.VAD, `❌ R2 load error: ${err.message}`, {
        error: err.message,
        stack: err.stack,
        path,
        r2BucketAvailable: !!this.r2Bucket,
      });
      throw new Error(
        `Failed to load Silero VAD model from R2 bucket at "${path}": ${err.message}. ` +
          `Ensure the model is uploaded to R2 or in public/models/. ` +
          `Run: bun run download-models && bun run upload-models [env]`
      );
    }
  }

  /**
   * Reset internal VAD state
   */
  async resetState(): Promise<void> {
    // Initialize state tensor with zeros
    // Silero VAD v5 uses a combined state tensor with shape [2, 1, 128]
    const batchSize = 1;
    const hiddenSize = 128;
    const numLayers = 2;
    this.modelState = new ort.Tensor(
      'float32',
      new Float32Array(numLayers * batchSize * hiddenSize).fill(0),
      [numLayers, batchSize, hiddenSize]
    );
    this.lastSr = new ort.Tensor('int64', new BigInt64Array([BigInt(this.SAMPLE_RATE)]), [1]);

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
      const inferenceStartTime = performance.now();

      // Concatenate context with new audio chunk (64 + 512 = 576 samples)
      const inputWithContext = new Float32Array(this.CONTEXT_SIZE + this.CHUNK_SIZE);
      inputWithContext.set(this.context, 0);
      inputWithContext.set(audioChunk, this.CONTEXT_SIZE);

      // Prepare input tensor
      const inputTensor = new ort.Tensor('float32', inputWithContext, [1, inputWithContext.length]);

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

      const inferenceTime = performance.now() - inferenceStartTime;

      // Log performance metrics (only occasionally to avoid spam)
      if (Math.random() < 0.01) {
        // Log ~1% of inferences
        getEventSystem().info(EventCategory.PERFORMANCE, '📊 VAD inference', {
          inferenceTimeMs: Math.round(inferenceTime),
          speechProb: speechProb.toFixed(3),
        });
      }

      return speechProb;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      getEventSystem().error(EventCategory.VAD, '❌ VAD inference error:', err);
      throw err;
    }
  }

  /**
   * Process audio and detect speech start/stop events
   *
   * @param audioChunk - Float32Array of audio samples
   * @param timestampMs - Current timestamp in milliseconds
   * @returns 'speech_start' | 'speech_end' | null
   */
  async detectSpeech(audioChunk: Float32Array, timestampMs: number): Promise<'speech_start' | 'speech_end' | null> {
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
export async function getVAD(options?: VADOptions, r2Bucket?: R2Bucket): Promise<SileroVAD> {
  if (!vadInstance) {
    vadInstance = new SileroVAD(options, r2Bucket);
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

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetVAD(): void {
  vadInstance = null;
}
