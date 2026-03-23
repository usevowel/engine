/**
 * Base Event Adapter Interface
 * 
 * Defines the interface that all event adapters must implement.
 * Adapters handle the output/processing of events (e.g., console logging, PostHog).
 */

import type { Event } from '../types';
import type { Observable } from 'rxjs';

/**
 * Base adapter interface
 * 
 * All event adapters must implement this interface to handle events.
 */
export interface EventAdapter {
  /**
   * Handle an event
   * 
   * @param event - The event to handle
   */
  handle(event: Event): void | Promise<void>;

  /**
   * Initialize the adapter
   * 
   * Called when the adapter is registered with the event emitter.
   * 
   * @param eventStream - Observable stream of events
   */
  initialize(eventStream: Observable<Event>): void | Promise<void>;

  /**
   * Cleanup the adapter
   * 
   * Called when the adapter is removed or the system is shutting down.
   */
  cleanup?(): void | Promise<void>;

  /**
   * Get adapter name for identification
   */
  getName(): string;
}
