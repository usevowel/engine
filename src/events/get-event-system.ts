/**
 * Event System Access Helper
 *
 * Provides a singleton event system instance for use throughout the codebase.
 * This ensures consistent event logging across all modules.
 */

import { createEventSystem, EventEmitter, type ExecutionContext } from './index';
import { EventCategory } from './types';

let globalEventSystem: EventEmitter | null = null;
let globalExecutionContext: ExecutionContext | null = null;

export function setExecutionContext(ctx: ExecutionContext | null): void {
  globalExecutionContext = ctx;

  if (globalEventSystem) {
    globalEventSystem.setExecutionContext(ctx);
  }
}

/**
 * OSS no longer owns PostHog LLM tracing. This stays as a compatibility no-op
 * so hosted and legacy callers can keep their current call shape.
 */
export function configurePostHogForLLM(_config: {
  apiKey: string;
  apiHost?: string;
  enabled?: boolean;
}): void {}

/**
 * OSS no longer configures PostHog from environment variables. This remains as
 * a compatibility no-op for existing runtime call sites.
 */
export function registerPostHogAdapterFromEnv(
  _env: Record<string, string | undefined>,
  _sessionId?: string,
  _sessionKey?: string,
  _durableObjectId?: string
): void {}

export function getEventSystem(): EventEmitter {
  if (!globalEventSystem) {
    globalEventSystem = createEventSystem({
      consoleConfig: {
        filterPatterns: ['[ClientToolProxy]'],
        filterCategories: [EventCategory.STT],
      },
    });

    if (globalExecutionContext) {
      globalEventSystem.setExecutionContext(globalExecutionContext);
    }
  }
  return globalEventSystem;
}

export function resetEventSystem(): void {
  globalEventSystem = null;
}
