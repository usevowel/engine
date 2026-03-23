/**
 * Centralized logging service for SNDBRD engine
 *
 * Provides structured logging with consistent formatting across all durable objects and workers.
 * PostHog integration temporarily disabled - using console.log only.
 */

// import type { PostHog } from 'posthog-js'; // Temporarily disabled

// Log levels for filtering and categorization
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  CRITICAL = 'critical',
}

// Structured log context interface
export interface LogContext {
  sessionId?: string;
  userId?: string;
  durableObjectId?: string;
  operation?: string;
  duration?: number;
  metadata?: Record<string, any>;
  tags?: string[];
}

/**
 * Centralized Logger class for SNDBRD engine
 * Uses console.log with consistent formatting
 */
export class SNDBRDLogger {
  private sessionId: string;
  private durableObjectId?: string;
  private source: string;

  constructor(
    posthogInstance: any, // Ignored for now
    sessionId: string,
    durableObjectId?: string,
    source = 'sndbrd'
  ) {
    this.sessionId = sessionId;
    this.durableObjectId = durableObjectId;
    this.source = source;
  }

  /**
   * Create a logger instance for a specific durable object
   */
  static forDurableObject(
    posthogInstance: PostHog | null,
    sessionId: string,
    durableObjectId: string,
    source = 'durable-object'
  ): SNDBRDLogger {
    return new SNDBRDLogger(posthogInstance, sessionId, durableObjectId, source);
  }

  /**
   * Create a logger instance for worker-level logging
   */
  static forWorker(
    posthogInstance: PostHog | null,
    source = 'worker'
  ): SNDBRDLogger {
    return new SNDBRDLogger(posthogInstance, 'worker-global', undefined, source);
  }

  /**
   * Log a debug message (development only)
   */
  debug(message: string, context: Partial<LogContext> = {}): void {
    this.logToConsole(LogLevel.DEBUG, message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context: Partial<LogContext> = {}): void {
    this.logToConsole(LogLevel.INFO, message, context);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context: Partial<LogContext> = {}): void {
    this.logToConsole(LogLevel.WARN, message, context);
  }

  /**
   * Log an error message
   */
  error(message: string, context: Partial<LogContext> = {}): void {
    this.logToConsole(LogLevel.ERROR, message, context);
  }

  /**
   * Log a critical error message
   */
  critical(message: string, context: Partial<LogContext> = {}): void {
    this.logToConsole(LogLevel.CRITICAL, message, context);
  }

  /**
   * Log a session event with timing
   */
  sessionEvent(
    event: string,
    properties: Record<string, any> = {},
    duration?: number
  ): void {
    this.info(`Session event: ${event}`, {
      sessionId: this.sessionId,
      durableObjectId: this.durableObjectId,
      operation: event,
      duration,
      metadata: properties,
      tags: ['session', event],
    });
  }

  /**
   * Log audio processing event
   */
  audioEvent(
    event: string,
    properties: Record<string, any> = {}
  ): void {
    this.info(`Audio event: ${event}`, {
      sessionId: this.sessionId,
      durableObjectId: this.durableObjectId,
      operation: event,
      metadata: properties,
      tags: ['audio', event],
    });
  }

  /**
   * Log provider operation
   */
  providerEvent(
    provider: string,
    operation: string,
    properties: Record<string, any> = {},
    duration?: number
  ): void {
    this.info(`Provider ${provider}: ${operation}`, {
      sessionId: this.sessionId,
      durableObjectId: this.durableObjectId,
      operation: `${provider}.${operation}`,
      duration,
      metadata: properties,
      tags: ['provider', provider, operation],
    });
  }

  /**
   * Log performance metrics
   */
  performance(
    metric: string,
    value: number,
    unit: string = 'ms',
    properties: Record<string, any> = {}
  ): void {
    this.info(`Performance: ${metric} = ${value}${unit}`, {
      sessionId: this.sessionId,
      durableObjectId: this.durableObjectId,
      operation: metric,
      duration: value,
      metadata: { unit, ...properties },
      tags: ['performance', metric],
    });
  }

  /**
   * Core logging method - just uses console.log for now
   */
  private logToConsole(level: LogLevel, message: string, context: Partial<LogContext>): void {
    const prefix = this.buildConsolePrefix(level);
    const consoleMethod = this.getConsoleMethod(level);

    consoleMethod(`${prefix} ${message}`);

    // Log additional context for structured debugging
    if (context.metadata && Object.keys(context.metadata).length > 0) {
      consoleMethod(`${prefix} Context:`, context.metadata);
    }
  }

  /**
   * Get appropriate console method for log level
   */
  private getConsoleMethod(level: LogLevel): typeof console.log {
    switch (level) {
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        return console.error;
      case LogLevel.WARN:
        return console.warn;
      default:
        return console.log;
    }
  }

  /**
   * Get emoji for log level
   */
  private getLevelEmoji(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return '🔍';
      case LogLevel.INFO:
        return 'ℹ️';
      case LogLevel.WARN:
        return '⚠️';
      case LogLevel.ERROR:
        return '❌';
      case LogLevel.CRITICAL:
        return '🚨';
      default:
        return '📝';
    }
  }

  /**
   * Build console log prefix with emoji and context
   */
  private buildConsolePrefix(level: LogLevel): string {
    const emoji = this.getLevelEmoji(level);
    const levelStr = level.toUpperCase();
    const sourceStr = this.source ? `[${this.source}]` : '';
    const sessionStr = this.sessionId ? `[${this.sessionId.substring(0, 8)}]` : '';
    const doStr = this.durableObjectId ? `[DO:${this.durableObjectId.substring(0, 8)}]` : '';
    
    return `${emoji} ${levelStr} ${sourceStr}${sessionStr}${doStr}`;
  }
}

// Global logger instance for shared use
let globalLogger: SNDBRDLogger | null = null;

/**
 * Get or create global logger instance
 */
export function getGlobalLogger(): SNDBRDLogger | null {
  return globalLogger;
}

/**
 * Set global logger instance
 */
export function setGlobalLogger(logger: SNDBRDLogger): void {
  globalLogger = logger;
}

/**
 * Convenience function for creating a console logger
 */
export function createConsoleLogger(
  sessionId: string,
  durableObjectId?: string,
  source = 'sndbrd'
): SNDBRDLogger {
  return new SNDBRDLogger(null, sessionId, durableObjectId, source);
}
