/**
 * Model Wrapper for Agent Analytics
 *
 * OSS leaves models untouched by default. Hosted can register a proprietary
 * implementation that wraps Vercel AI SDK models with analytics behavior.
 */

import type { LanguageModel } from 'ai';
import type { LanguageModelV2, LanguageModelV3 } from '@ai-sdk/provider';
import type { ModelWrapperOptions } from './types';
import {
  getAgentAnalyticsImplementation,
  type AgentAnalyticsServiceLike,
} from './implementation';

export function isV3Model(
  model: LanguageModel
): model is LanguageModel & LanguageModelV3 {
  return (
    typeof model === 'object' &&
    model !== null &&
    'specificationVersion' in model &&
    (model as { specificationVersion?: string }).specificationVersion === 'v3'
  );
}

export function isV2Model(
  model: LanguageModel
): model is LanguageModel & LanguageModelV2 {
  return (
    typeof model === 'object' &&
    model !== null &&
    (!('specificationVersion' in model) ||
      (model as { specificationVersion?: string }).specificationVersion ===
        'v2')
  );
}

export function wrapModelWithAnalytics<T extends LanguageModel>(
  model: T,
  service: AgentAnalyticsServiceLike,
  options: ModelWrapperOptions
): T {
  const implementation = getAgentAnalyticsImplementation();
  if (implementation) {
    return implementation.wrapModelWithAnalytics(model, service, options);
  }

  return model;
}
