/**
 * Console Event Adapter
 * 
 * Outputs events to the console with formatted logging.
 * This is the default adapter for development and debugging.
 */

import { Subject, takeUntil } from 'rxjs';
import type { Event } from '../types';
import { EventLevel, EventCategory } from '../types';
import type { EventAdapter } from './base';

/**
 * Console adapter configuration
 */
export interface ConsoleAdapterConfig {
  /** Minimum log level to output (default: DEBUG) */
  minLevel?: EventLevel;
  /** Enable colored output (default: true) */
  enableColors?: boolean;
  /** Enable emoji prefixes (default: true) */
  enableEmojis?: boolean;
  /** Enable metadata logging (default: true) */
  enableMetadata?: boolean;
  /** Array of patterns to filter out from console logs (checks if message contains any pattern) */
  filterPatterns?: string[];
  /** Array of event categories to filter out from console logs */
  filterCategories?: EventCategory[];
}

/**
 * Console event adapter
 * 
 * Formats and outputs events to the console.
 */
export class ConsoleAdapter implements EventAdapter {
  private config: Required<Omit<ConsoleAdapterConfig, 'filterPatterns' | 'filterCategories'>> & { 
    filterPatterns: string[];
    filterCategories: EventCategory[];
  };
  private destroy$ = new Subject<void>();

  constructor(config: ConsoleAdapterConfig = {}) {
    this.config = {
      minLevel: config.minLevel ?? EventLevel.DEBUG,
      enableColors: config.enableColors ?? true,
      enableEmojis: config.enableEmojis ?? true,
      enableMetadata: config.enableMetadata ?? true,
      filterPatterns: config.filterPatterns ?? [],
      filterCategories: config.filterCategories ?? [],
    };
  }

  getName(): string {
    return 'console';
  }

  initialize(eventStream: import('rxjs').Observable<Event>): void {
    eventStream
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        this.handle(event);
      });
  }

  handle(event: Event): void {
    // Filter by minimum level
    if (!this.shouldLog(event.level)) {
      return;
    }

    // Filter by category (if configured)
    if (this.config.filterCategories.length > 0) {
      if (this.config.filterCategories.includes(event.category)) {
        return;
      }
    }

    // Filter by message patterns (if configured)
    if (this.config.filterPatterns.length > 0) {
      const messageStr = typeof event.message === 'string' ? event.message : String(event.message);
      if (this.config.filterPatterns.some(pattern => messageStr.includes(pattern))) {
        return;
      }
    }

    // Get console method based on level
    const consoleMethod = this.getConsoleMethod(event.level);

    // Build log prefix
    const prefix = this.buildPrefix(event);

    // Log main message
    consoleMethod(`${prefix} ${event.message}`);

    // Log metadata if enabled
    if (this.config.enableMetadata && event.metadata && Object.keys(event.metadata).length > 0) {
      consoleMethod(`${prefix} Metadata:`, event.metadata);
    }

    // Log error if present
    if (event.error) {
      consoleMethod(`${prefix} Error:`, event.error);
    }

    // Log tags if present
    if (event.tags && Array.isArray(event.tags) && event.tags.length > 0) {
      consoleMethod(`${prefix} Tags:`, event.tags.join(', '));
    }
  }

  cleanup(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Check if event should be logged based on minimum level
   */
  private shouldLog(level: EventLevel): boolean {
    const levels = [
      EventLevel.DEBUG,
      EventLevel.INFO,
      EventLevel.WARN,
      EventLevel.ERROR,
      EventLevel.CRITICAL,
    ];

    const minIndex = levels.indexOf(this.config.minLevel);
    const eventIndex = levels.indexOf(level);

    return eventIndex >= minIndex;
  }

  /**
   * Get appropriate console method for log level
   */
  private getConsoleMethod(level: EventLevel): typeof console.log {
    switch (level) {
      case EventLevel.ERROR:
      case EventLevel.CRITICAL:
        return console.error;
      case EventLevel.WARN:
        return console.warn;
      case EventLevel.DEBUG:
        return console.debug;
      default:
        return console.log;
    }
  }

  /**
   * Build log prefix with emoji and level
   */
  private buildPrefix(event: Event): string {
    const parts: string[] = [];

    // Add emoji if enabled
    if (this.config.enableEmojis) {
      parts.push(this.getLevelEmoji(event.level));
    }

    // Add level
    parts.push(event.level.toUpperCase());

    // Add category
    parts.push(`[${event.category}]`);

    // Add session ID if available
    if (event.metadata?.sessionId) {
      const sessionId = event.metadata.sessionId.substring(0, 8);
      parts.push(`[${sessionId}]`);
    }

    // Add durable object ID if available
    if (event.metadata?.durableObjectId) {
      const doId = event.metadata.durableObjectId.substring(0, 8);
      parts.push(`[DO:${doId}]`);
    }

    // Add operation if available
    if (event.metadata?.operation) {
      parts.push(`[${event.metadata.operation}]`);
    }

    return parts.join(' ');
  }

  /**
   * Get emoji for log level
   */
  private getLevelEmoji(level: EventLevel): string {
    switch (level) {
      case EventLevel.DEBUG:
        return '🔍';
      case EventLevel.INFO:
        return 'ℹ️';
      case EventLevel.WARN:
        return '⚠️';
      case EventLevel.ERROR:
        return '❌';
      case EventLevel.CRITICAL:
        return '🚨';
      default:
        return '📝';
    }
  }
}
