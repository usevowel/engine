/**
 * ONNX Runtime Web Configuration for Cloudflare Workers
 *
 * Configures ONNX Runtime Web to use WASM files from Workers Static Assets.
 *
 * Strategy: Use Workers Static Assets to serve WASM files from edge cache.
 * This is faster than R2 and avoids external CDN dependencies.
 *
 * Models and WASM files are served from the Worker's own Static Assets:
 * - Models: /models/smart-turn-v3.1-int8.onnx, /models/silero-vad/silero_vad.onnx
 * - WASM: /onnx-wasm/ort-wasm.wasm, /onnx-wasm/ort-wasm-simd.wasm
 *
 * VERSION: v3 - Fixed Durable Object worker base URL + object-based wasmPaths
 */

import * as ort from 'onnxruntime-web';
import { getEventSystem, EventCategory } from '../events';

let wasmConfigured = false;
let workerBaseUrl: string | null = null;

/**
 * Set the Worker's base URL for loading Static Assets
 * This should be called once when the Worker initializes
 */
export function setWorkerBaseUrl(url: string): void {
  workerBaseUrl = url;
}

/**
 * Get the Worker's base URL (origin)
 * Falls back to constructing from request URL if not set
 */
function getWorkerBaseUrl(): string {
  if (workerBaseUrl) {
    return workerBaseUrl;
  }

  // Try to get from global scope if available (Workers environment)
  if (typeof globalThis !== 'undefined' && (globalThis as any).__WORKER_BASE_URL) {
    return (globalThis as any).__WORKER_BASE_URL;
  }

  // Fallback - will need to be set via setWorkerBaseUrl()
  return '';
}

/**
 * Configure ONNX Runtime WASM paths to use Workers Static Assets
 *
 * This must be called before creating any ONNX Runtime sessions.
 * It's safe to call multiple times - it only configures once.
 *
 * WASM files are served from Static Assets at:
 * - /onnx-wasm/ort-wasm.wasm (basic WASM, single-threaded)
 * - /onnx-wasm/ort-wasm-simd.wasm (SIMD-optimized, single-threaded)
 *
 * Strategy: Fetch WASM binary and provide it directly via wasmBinary to bypass
 * script source URL detection issues in Cloudflare Workers.
 */
export async function configureONNXRuntimeWASM(baseUrl?: string): Promise<void> {
  getEventSystem().info(EventCategory.PROVIDER, '🚀 configureONNXRuntimeWASM called (WASM mode)', {
    timestamp: new Date().toISOString(),
    wasmConfigured,
    baseUrlProvided: !!baseUrl,
    baseUrl,
    codeVersion: 'v5-direct-wasm-binary',
  });

  if (wasmConfigured) {
    getEventSystem().info(EventCategory.PROVIDER, '✅ ONNX Runtime WASM already configured, skipping');
    return; // Already configured
  }

  // Set base URL if provided
  if (baseUrl) {
    getEventSystem().info(EventCategory.PROVIDER, `📝 Setting worker base URL: ${baseUrl}`);
    setWorkerBaseUrl(baseUrl);
  }

  const workerUrl = getWorkerBaseUrl();
  getEventSystem().info(EventCategory.PROVIDER, '🔍 Worker base URL resolved', {
    workerUrl,
    hasWorkerUrl: !!workerUrl,
    globalScopeUrl: typeof globalThis !== 'undefined' ? (globalThis as any).__WORKER_BASE_URL : 'N/A',
  });

  if (!workerUrl) {
    getEventSystem().warn(EventCategory.PROVIDER, '⚠️ Worker base URL not set, ONNX Runtime may not find WASM files', {
      baseUrlProvided: !!baseUrl,
      globalScopeCheck: typeof globalThis !== 'undefined' ? (globalThis as any).__WORKER_BASE_URL : 'undefined',
    });
    // Still configure other settings
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = false;
    getEventSystem().info(EventCategory.PROVIDER, '⚙️ Configured ONNX Runtime with CPU fallback (no WASM paths)', {
      numThreads: ort.env.wasm.numThreads,
      simd: ort.env.wasm.simd,
    });
    wasmConfigured = true;
    return;
  }

  // Configure WASM settings for Workers
  ort.env.wasm.numThreads = 1; // Workers are single-threaded isolates (no threading support)
  ort.env.wasm.simd = true; // Enable SIMD - we'll use SIMD WASM file
  ort.env.wasm.proxy = false; // Disable proxy worker - not needed for single-threaded and causes URL resolution issues

  // CRITICAL: Fetch WASM binary and provide it directly via wasmBinary
  // This bypasses script source URL detection entirely (which fails in Workers)
  // According to ONNX Runtime docs: if wasmBinary is set, wasmPaths will be ignored
  const wasmFileUrl = `${workerUrl}/onnx-wasm/ort-wasm-simd.wasm`;

  try {
    getEventSystem().info(EventCategory.PROVIDER, `📥 Fetching WASM binary from Static Assets: ${wasmFileUrl}`);
    const wasmResponse = await fetch(wasmFileUrl);
    if (!wasmResponse.ok) {
      throw new Error(`Failed to fetch WASM file: ${wasmResponse.status} ${wasmResponse.statusText}`);
    }
    const wasmBinary = await wasmResponse.arrayBuffer();

    // Provide WASM binary directly - this bypasses all path resolution
    // CRITICAL: Convert ArrayBuffer to Uint8Array as ONNX Runtime expects Uint8Array
    ort.env.wasm.wasmBinary = new Uint8Array(wasmBinary);

    // Explicitly clear wasmPaths to prevent any URL resolution attempts
    ort.env.wasm.wasmPaths = undefined;

    getEventSystem().info(EventCategory.PROVIDER, `✅ WASM BINARY LOADED DIRECTLY`, {
      wasmFileUrl,
      wasmBinarySize: wasmBinary.byteLength,
      wasmBinaryType: typeof ort.env.wasm.wasmBinary,
      wasmBinaryIsUint8Array: ort.env.wasm.wasmBinary instanceof Uint8Array,
      wasmPathsCleared: ort.env.wasm.wasmPaths === undefined,
      approach: 'direct_binary_no_paths',
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    getEventSystem().error(EventCategory.PROVIDER, `❌ Failed to fetch WASM binary, falling back to wasmPaths: ${err.message}`, err);

    // Fallback: Use wasmPaths (may still have script source URL issues)
    ort.env.wasm.wasmPaths = {
      wasm: wasmFileUrl,
    };

    getEventSystem().warn(EventCategory.PROVIDER, '⚠️ Falling back to wasmPaths (may fail if script source URL unavailable)');
  }

  // Log current ONNX Runtime environment state
  getEventSystem().info(EventCategory.PROVIDER, '📊 ONNX Runtime environment state', {
    wasmNumThreads: ort.env.wasm.numThreads,
    wasmSimd: ort.env.wasm.simd,
    wasmProxy: ort.env.wasm.proxy,
    wasmBinarySet: !!ort.env.wasm.wasmBinary,
    wasmBinarySize: ort.env.wasm.wasmBinary ? ort.env.wasm.wasmBinary.byteLength : 0,
    wasmPathsConfigured: !!ort.env.wasm.wasmPaths,
  });

  wasmConfigured = true;
  getEventSystem().info(EventCategory.PROVIDER, '✅ ONNX Runtime WASM configuration complete');
}
