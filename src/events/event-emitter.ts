/**
 * Event Emitter
 *
 * Core event emitter using RxJS Subject for reactive event handling.
 * Manages event stream and adapter registration.
 *
 * Supports Cloudflare Workers ExecutionContext for adapter cleanup and other
 * async shutdown tasks via ctx.waitUntil().
 */

import { Subject, Observable } from 'rxjs';
import type { Event, EventContext } from './types';
import { EventCategory, EventLevel } from './types';
import type { EventAdapter } from './adapters';
import type { LanguageModel } from 'ai';

/**
 * Disable PostHog adapter (custom events)
 */
export const DISABLE_POSTHOG_ADAPTER = true;

/**
 * Hosted owns the PostHog-backed agent analytics implementation now.
 * OSS no longer provides the implementation, but hosted still consumes this
 * flag through the vendor engine path.
 */
export const DISABLE_POSTHOG_AGENT_ANALYTICS = false;

/**
 * Cloudflare Workers ExecutionContext type
 */
export interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

export class EventEmitter {
  private eventSubject = new Subject<Event>();
  private adapters: Map<string, EventAdapter> = new Map();
  private eventCounter = 0;
  private executionContext: ExecutionContext | null = null;

  getEventStream(): Observable<Event> {
    return this.eventSubject.asObservable();
  }

  registerAdapter(adapter: EventAdapter): void {
    if (this.adapters.has(adapter.getName())) {
      throw new Error(
        `Adapter with name "${adapter.getName()}" is already registered`
      );
    }

    this.adapters.set(adapter.getName(), adapter);
    adapter.initialize(this.getEventStream());

    if (
      this.executionContext &&
      'setExecutionContext' in adapter &&
      typeof adapter.setExecutionContext === 'function'
    ) {
      (adapter as any).setExecutionContext(this.executionContext);
    }
  }

  unregisterAdapter(name: string): void {
    const adapter = this.adapters.get(name);
    if (adapter) {
      adapter.cleanup?.();
      this.adapters.delete(name);
    }
  }

  getAdapters(): EventAdapter[] {
    return Array.from(this.adapters.values());
  }

  emit(context: EventContext): void {
    const event: Event = {
      id: this.generateEventId(),
      timestamp: Date.now(),
      level: context.level ?? EventLevel.INFO,
      category: context.category,
      message: context.message,
      metadata: context.metadata,
      error: context.error,
      tags: context.tags,
    };

    this.eventSubject.next(event);
  }

  debug(
    category: EventCategory,
    message: string,
    metadata?: Event['metadata'],
    tags?: string[]
  ): void {
    this.emit({
      level: EventLevel.DEBUG,
      category,
      message,
      metadata,
      tags,
    });
  }

  info(
    category: EventCategory,
    message: string,
    metadata?: Event['metadata'],
    tags?: string[]
  ): void {
    this.emit({
      level: EventLevel.INFO,
      category,
      message,
      metadata,
      tags,
    });
  }

  warn(
    category: EventCategory,
    message: string,
    metadata?: Event['metadata'],
    tags?: string[]
  ): void {
    this.emit({
      level: EventLevel.WARN,
      category,
      message,
      metadata,
      tags,
    });
  }

  error(
    category: EventCategory,
    message: string,
    error?: Error,
    metadata?: Event['metadata'],
    tags?: string[]
  ): void {
    this.emit({
      level: EventLevel.ERROR,
      category,
      message,
      error,
      metadata,
      tags,
    });
  }

  critical(
    category: EventCategory,
    message: string,
    error?: Error,
    metadata?: Event['metadata'],
    tags?: string[]
  ): void {
    this.emit({
      level: EventLevel.CRITICAL,
      category,
      message,
      error,
      metadata,
      tags,
    });
  }

  sessionEvent(
    event: string,
    properties?: Record<string, any>,
    duration?: number
  ): void {
    this.info(
      EventCategory.SESSION,
      `Session event: ${event}`,
      {
        operation: event,
        duration,
        ...properties,
      },
      ['session', event]
    );
  }

  audioEvent(event: string, properties?: Record<string, any>): void {
    this.info(
      EventCategory.AUDIO,
      `Audio event: ${event}`,
      {
        operation: event,
        ...properties,
      },
      ['audio', event]
    );
  }

  providerEvent(
    provider: string,
    operation: string,
    properties?: Record<string, any>,
    duration?: number
  ): void {
    this.info(
      EventCategory.PROVIDER,
      `Provider ${provider}: ${operation}`,
      {
        operation: `${provider}.${operation}`,
        duration,
        provider,
        ...properties,
      },
      ['provider', provider, operation]
    );
  }

  performance(
    metric: string,
    value: number,
    unit: string = 'ms',
    properties?: Record<string, any>
  ): void {
    this.info(
      EventCategory.PERFORMANCE,
      `Performance: ${metric} = ${value}${unit}`,
      {
        operation: metric,
        duration: value,
        unit,
        ...properties,
      },
      ['performance', metric]
    );
  }

  setExecutionContext(ctx: ExecutionContext | null): void {
    this.executionContext = ctx;

    for (const adapter of this.adapters.values()) {
      if (
        'setExecutionContext' in adapter &&
        typeof adapter.setExecutionContext === 'function'
      ) {
        (adapter as any).setExecutionContext(ctx);
      }
    }
  }

  getExecutionContext(): ExecutionContext | null {
    return this.executionContext;
  }

  /**
   * OSS no longer owns PostHog LLM tracing. This method stays as a no-op so
   * existing call sites do not need to change in the same cleanup slice.
   */
  configurePostHog(_config: {
    apiKey: string;
    apiHost?: string;
    enabled?: boolean;
  }): void {}

  /**
   * OSS no longer wraps models with PostHog tracing. The method remains for
   * compatibility and simply returns the original model.
   */
  llm<T extends LanguageModel>(
    model: T,
    _options?: {
      posthogDistinctId?: string;
      posthogTraceId?: string;
      posthogProperties?: Record<string, any>;
      posthogPrivacyMode?: boolean;
      posthogGroups?: Record<string, string>;
    }
  ): T {
    return model;
  }

  shutdown(): void {
    const shutdownPromise = (async () => {
      for (const adapter of this.adapters.values()) {
        adapter.cleanup?.();
      }

      this.eventSubject.complete();
      this.adapters.clear();
    })();

    if (this.executionContext) {
      this.executionContext.waitUntil(shutdownPromise);
    } else {
      shutdownPromise.catch((err) =>
        console.error('[EventEmitter] Shutdown error:', err)
      );
    }
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${++this.eventCounter}`;
  }
}
