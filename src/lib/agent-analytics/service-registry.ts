/**
 * Service Registry
 *
 * OSS keeps a neutral in-memory registry. Hosted can register a proprietary
 * implementation and take over the full registry lifecycle.
 */

import { AgentAnalyticsService } from './AgentAnalyticsService';
import {
  getAgentAnalyticsImplementation,
  type AgentAnalyticsCreateOptions,
  type AgentAnalyticsPostHogConfig,
  type AgentAnalyticsServiceLike,
} from './implementation';

const serviceRegistry = new Map<string, AgentAnalyticsServiceLike>();

export function getOrCreateService(
  traceId: string,
  sessionId: string,
  posthogConfig: AgentAnalyticsPostHogConfig,
  options?: AgentAnalyticsCreateOptions
): AgentAnalyticsServiceLike {
  const implementation = getAgentAnalyticsImplementation();
  if (implementation) {
    return implementation.getOrCreateService(
      traceId,
      sessionId,
      posthogConfig,
      options
    );
  }

  let service = serviceRegistry.get(traceId);
  if (!service) {
    service = new AgentAnalyticsService({
      traceId,
      sessionId,
      posthogApiKey: posthogConfig.apiKey,
      posthogHost: posthogConfig.host,
    });
    serviceRegistry.set(traceId, service);

    if (options?.startTrace !== false) {
      service.startTrace({
        spanName: options?.spanName || 'voice_pipeline',
        inputState: options?.inputState,
      });
    }
  }

  return service;
}

export function getServiceForTrace(
  traceId: string
): AgentAnalyticsServiceLike | undefined {
  const implementation = getAgentAnalyticsImplementation();
  if (implementation) {
    return implementation.getServiceForTrace(traceId);
  }

  return serviceRegistry.get(traceId);
}

export function removeService(traceId: string): void {
  const implementation = getAgentAnalyticsImplementation();
  if (implementation) {
    implementation.removeService(traceId);
    return;
  }

  serviceRegistry.delete(traceId);
}

export function clearAllServices(): void {
  const implementation = getAgentAnalyticsImplementation();
  if (implementation) {
    implementation.clearAllServices();
    return;
  }

  serviceRegistry.clear();
}
