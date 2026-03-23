import { getEventSystem, EventCategory } from './events';
/**
 * Global constants for sndbrd
 */

/**
 * Get speech mode from environment
 * 
 * Works in both Bun (process.env) and Workers (checks wrangler.toml vars)
 * Priority order:
 * 1. runtimeConfig.speech.defaultMode (most reliable)
 * 2. process.env.DEFAULT_SPEECH_MODE (Bun runtime)
 * 3. globalThis.DEFAULT_SPEECH_MODE (Workers fallback)
 * 4. 'implicit' (default)
 * 
 * @param runtimeConfig - Optional runtime configuration object
 * @returns 'explicit' or 'implicit'
 */
export function getSpeechMode(runtimeConfig?: any): 'implicit' | 'explicit' {
  // First priority: Check runtimeConfig (most reliable, works in both Bun and Workers)
  if (runtimeConfig?.speech?.defaultMode === 'explicit') {
    getEventSystem().info(EventCategory.VAD, '🎤 [getSpeechMode] Explicit mode from runtimeConfig.speech.defaultMode');
    return 'explicit';
  }
  if (runtimeConfig?.speech?.defaultMode === 'implicit') {
    getEventSystem().info(EventCategory.VAD, '🎤 [getSpeechMode] Implicit mode from runtimeConfig.speech.defaultMode');
    return 'implicit';
  }
  
  // Second priority: Try to get from process.env (Bun runtime)
  if (typeof process !== 'undefined' && process.env?.DEFAULT_SPEECH_MODE === 'explicit') {
    getEventSystem().info(EventCategory.VAD, '🎤 [getSpeechMode] Bun: explicit mode from process.env');
    return 'explicit';
  }
  
  // Third priority: Try to get from globalThis (Workers fallback)
  if ((globalThis as any).DEFAULT_SPEECH_MODE === 'explicit') {
    getEventSystem().info(EventCategory.VAD, '🎤 [getSpeechMode] Workers: explicit mode from globalThis');
    return 'explicit';
  }
  
  getEventSystem().info(EventCategory.VAD, '🎤 [getSpeechMode] Defaulting to implicit mode');
  return 'implicit';
}

