/**
 * Event System
 * 
 * Centralized event handling system for the VoiceAgent engine.
 * Uses RxJS for reactive event streaming and supports modular adapters for different outputs.
 * 
 * @example
 * ```typescript
 * import { createEventSystem, EventCategory } from './events';
 * 
 * const eventSystem = createEventSystem();
 * 
 * // Emit an event
 * eventSystem.info(EventCategory.SESSION, 'Session started', {
 *   sessionId: 'abc123',
 *   userId: 'user456',
 * });
 * ```
 */

import { EventEmitter } from './event-emitter';
import { ConsoleAdapter } from './adapters';
import { getEventSystem } from './get-event-system';
export { EventEmitter } from './event-emitter';
export { ConsoleAdapter } from './adapters';
export type { EventAdapter, ConsoleAdapterConfig } from './adapters';
export { EventLevel, EventCategory } from './types';
export type { Event, EventContext, EventMetadata } from './types';
export { getEventSystem, resetEventSystem, configurePostHogForLLM, setExecutionContext, registerPostHogAdapterFromEnv } from './get-event-system';
export type { ExecutionContext } from './event-emitter';
export { DISABLE_POSTHOG_ADAPTER, DISABLE_POSTHOG_AGENT_ANALYTICS } from './event-emitter';

/**
 * Convenience function to get the event system instance
 * 
 * @returns The global event system instance
 * 
 * @example
 * ```typescript
 * import { events } from './events';
 * 
 * // Use for LLM tracing
 * const model = events().llm(baseModel, { posthogDistinctId: 'user123' });
 * ```
 */
export function events(): EventEmitter {
  return getEventSystem();
}

/**
 * Create a new event system instance
 * 
 * Creates an event emitter with the default console adapter registered.
 * 
 * @param options - Configuration options
 * @param options.enableConsoleAdapter - Enable console adapter (default: true)
 * @param options.consoleConfig - Console adapter configuration
 * @returns Event emitter instance
 */
export function createEventSystem(options?: {
  enableConsoleAdapter?: boolean;
  consoleConfig?: import('./adapters').ConsoleAdapterConfig;
}): EventEmitter {
  const emitter = new EventEmitter();

  // Register console adapter by default
  if (options?.enableConsoleAdapter !== false) {
    const consoleAdapter = new ConsoleAdapter(options?.consoleConfig);
    emitter.registerAdapter(consoleAdapter);
  }

  return emitter;
}
