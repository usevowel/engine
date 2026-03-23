/**
 * Runtime Environment Detection
 * 
 * Utilities to detect which runtime environment the code is running in.
 */

/**
 * Detect if running in Cloudflare Workers
 */
export function isCloudflareWorkers(): boolean {
  // Check for RUNTIME_ENV environment variable
  if (typeof process !== 'undefined' && process.env?.RUNTIME_ENV === 'cloudflare-workers') {
    return true;
  }
  
  // Check for Bun global (if Bun exists, we're NOT in Workers)
  if (typeof Bun !== 'undefined') {
    return false;
  }
  
  // Check for Workers-specific globals
  if (typeof WebSocketPair !== 'undefined' || typeof DurableObjectState !== 'undefined') {
    return true;
  }
  
  return false;
}

/**
 * Detect if running in Bun
 */
export function isBun(): boolean {
  return typeof Bun !== 'undefined';
}

/**
 * Get runtime name
 */
export function getRuntimeName(): string {
  if (isCloudflareWorkers()) {
    return 'cloudflare-workers';
  }
  if (isBun()) {
    return 'bun';
  }
  return 'node';
}

/**
 * Check if file system operations are available
 */
export function hasFileSystem(): boolean {
  return !isCloudflareWorkers();
}

