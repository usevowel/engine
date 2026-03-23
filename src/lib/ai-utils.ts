/**
 * AI SDK Utilities
 * 
 * Lazy-loaded utilities from the AI SDK to prevent bundling in Workers.
 * These are only needed in Bun environment where LLM integration happens.
 */

/**
 * Lazily import jsonSchema from AI SDK
 * This prevents esbuild from bundling 'ai' package in Workers
 */
export async function getJsonSchema() {
  const { jsonSchema } = await import('ai');
  return jsonSchema;
}

/**
 * Synchronous version that throws if used in Workers
 * Use this only in code paths that definitely run in Bun
 */
export function getJsonSchemaSync() {
  try {
    // This will only work if 'ai' is already loaded or in Bun environment
    const { jsonSchema } = require('ai');
    return jsonSchema;
  } catch (error) {
    throw new Error('jsonSchema is not available in Workers environment');
  }
}

