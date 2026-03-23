/**
 * Reasoning Effort Utilities
 * 
 * Provider-specific reasoning effort configuration for low-latency voice applications.
 * 
 * Reasoning models can use significant compute for "thinking" tokens, which increases
 * latency. For real-time voice applications, we want to minimize reasoning effort to
 * reduce latency and token costs.
 * 
 * This module provides:
 * - Reasoning effort determination based on model and provider
 * - Provider-specific option application for stream options
 */

import type { Parameters } from 'ai';

import { getEventSystem, EventCategory } from '../../../events';
/**
 * Extended stream options for AI SDK v5
 */
export type ExtendedStreamOptions = Parameters<typeof import('ai').streamText>[0];

/**
 * Reasoning effort level for low-latency voice applications
 * 
 * Supported values:
 * - 'none': Disable reasoning completely (lowest latency)
 * - 'minimal': Minimal reasoning (OpenAI/OpenRouter)
 * - 'low': Low reasoning effort (default for most providers)
 * - 'medium': Medium reasoning effort (Groq GPT-OSS models)
 * - 'high': High reasoning effort (Groq GPT-OSS models)
 * - 'default': Default reasoning effort (Groq Qwen models - enables reasoning)
 */
export type ReasoningEffort = "low" | "minimal" | "none" | "medium" | "high" | "default";

/**
 * Set of Groq model IDs that support reasoning effort parameter
 * 
 * Based on Groq API documentation (https://console.groq.com/docs/reasoning):
 * 
 * Reasoning effort support by model:
 * - Qwen 3 32B: supports 'none' and 'default'
 * - GPT-OSS 20B: supports 'low', 'medium', 'high'
 * - GPT-OSS 120B: supports 'low', 'medium', 'high'
 * - GPT-OSS-Safeguard 20B: supports 'low', 'medium', 'high' (listed as reasoning model)
 * 
 * All other Groq models (llama-3.3-70b-versatile, mixtral-8x7b-32768, moonshotai/kimi-k2-instruct-0905, etc.)
 * do NOT support reasoning effort and will ignore the parameter.
 * 
 * @see https://console.groq.com/docs/reasoning
 * @see https://console.groq.com/docs/models
 */
const GROQ_REASONING_EFFORT_SUPPORTED_MODELS = new Set([
  'qwen/qwen3-32b',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-safeguard-20b',
]);

/**
 * Check if a Groq model supports reasoning effort parameter
 * 
 * @param model - Model identifier (e.g., 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile')
 * @returns true if the model supports reasoning effort, false otherwise
 * 
 * @example
 * ```typescript
 * supportsReasoningEffort('openai/gpt-oss-120b'); // Returns: true
 * supportsReasoningEffort('llama-3.3-70b-versatile'); // Returns: false
 * ```
 */
export function groqSupportsReasoningEffort(model: string): boolean {
  return GROQ_REASONING_EFFORT_SUPPORTED_MODELS.has(model);
}

/**
 * Get configured reasoning effort from environment variable
 * 
 * Checks GROQ_REASONING_EFFORT environment variable for Groq models.
 * Valid values: 'none', 'low', 'medium', 'high'
 * 
 * Works in both Bun (via Bun.env) and Cloudflare Workers (via optional env parameter).
 * 
 * @param env - Optional environment object (for Cloudflare Workers)
 * @returns Configured reasoning effort or undefined if not set
 */
function getConfiguredReasoningEffort(env?: { GROQ_REASONING_EFFORT?: string }): ReasoningEffort | undefined {
  let value: string | undefined;
  
  // Check Bun environment
  if (typeof Bun !== 'undefined' && Bun.env.GROQ_REASONING_EFFORT) {
    value = Bun.env.GROQ_REASONING_EFFORT;
  }
  // Check provided env (for Cloudflare Workers)
  else if (env?.GROQ_REASONING_EFFORT) {
    value = env.GROQ_REASONING_EFFORT;
  }
  
  if (value) {
    const configured = value.toLowerCase();
    if (['none', 'low', 'medium', 'high', 'default'].includes(configured)) {
      return configured as ReasoningEffort;
    }
  }
  
  return undefined;
}

/**
 * Determine reasoning effort based on model and provider
 * 
 * Default strategy for Groq (reasoning is fast enough):
 * - GPT-OSS models (gpt-oss-20b, gpt-oss-120b, gpt-oss-safeguard-20b): default to 'medium' for better reasoning quality
 * - Qwen models: default to 'default' (enable reasoning - Groq's reasoning is fast enough)
 * - Other Groq models: default to 'low' (if they support reasoning effort)
 * 
 * Default strategy for other providers (reasoning adds latency):
 * - OpenAI/OpenRouter: default to 'none' (lowest latency)
 * - Anthropic/xAI: default to 'low' (minimum available)
 * 
 * Can be overridden via:
 * - GROQ_REASONING_EFFORT environment variable
 * - Override parameter (takes highest precedence)
 * 
 * @param model - Model identifier (e.g., 'moonshotai/kimi-k2-instruct-0905')
 * @param provider - Provider name (e.g., 'groq', 'openai', 'openrouter')
 * @param override - Optional override value (takes precedence over environment variable)
 * @param env - Optional environment object (for Cloudflare Workers)
 * @returns Reasoning effort level
 * 
 * @example
 * ```typescript
 * const effort = determineReasoningEffort('qwen/qwen3-32b', 'groq');
 * // Returns: 'default' (enables reasoning for Qwen on Groq)
 * 
 * const effort2 = determineReasoningEffort('openai/gpt-oss-120b', 'groq');
 * // Returns: 'medium' (default for GPT-OSS models)
 * 
 * const effort3 = determineReasoningEffort('claude-3-5-sonnet', 'openrouter');
 * // Returns: 'none' (lowest latency for non-Groq providers)
 * ```
 */
export function determineReasoningEffort(
  model: string,
  provider: string,
  override?: ReasoningEffort,
  env?: { GROQ_REASONING_EFFORT?: string }
): ReasoningEffort {
  // Override takes highest precedence
  if (override) {
    return override;
  }
  
  // Check provider capabilities
  if (provider === 'groq') {
    // Check for environment variable configuration
    const configured = getConfiguredReasoningEffort(env);
    if (configured) {
      return configured;
    }
    
    // For Groq, enable reasoning for all models that support it (Groq's reasoning is fast enough)
    // Special cases for specific model families:
    if (model.includes('qwen')) {
      // Qwen models support 'none' and 'default' -> use 'default' to enable reasoning
      return 'default' as ReasoningEffort; // 'default' enables reasoning for Qwen models
    } else if (model.includes('gpt-oss')) {
      // GPT-OSS models support 'low', 'medium', 'high' -> default to 'medium' for better reasoning quality
      return 'medium';
    }
    
    // For other Groq models that support reasoning effort, default to 'low'
    // (This is a fallback - most non-GPT-OSS models don't support reasoning effort)
    return 'low';
  } else if (provider === 'openai' || provider === 'openrouter') {
    // These providers support 'none' - use it for lowest latency
    return 'none';
  } else if (provider === 'anthropic' || provider === 'xai') {
    // These providers don't support 'none' - use 'low' as minimum
    return 'low';
  }
  
  // Default: assume provider supports 'none' (most modern providers do)
  return 'none';
}

/**
 * Apply provider-specific reasoning options to stream options
 * 
 * This function modifies the streamOptions object to include provider-specific
 * reasoning effort settings. Different providers use different property names
 * and value formats for reasoning control.
 * 
 * For Groq, only certain models support reasoning effort. Models that don't
 * support it will ignore the parameter, so we check before applying.
 * 
 * @param streamOptions - Stream options to modify (mutated in place)
 * @param provider - Provider name (e.g., 'groq', 'openai', 'anthropic')
 * @param reasoningEffort - Desired reasoning effort level
 * @param logPrefix - Optional prefix for log messages (e.g., '[CustomAgent]')
 * @param model - Optional model identifier (required for Groq to check support)
 * 
 * @example
 * ```typescript
 * const streamOptions: ExtendedStreamOptions = {
 *   model,
 *   messages,
 * };
 * 
 * applyReasoningOptions(streamOptions, 'groq', 'low', '[CustomAgent]', 'openai/gpt-oss-120b');
 * // streamOptions.providerOptions.groq.reasoningEffort is now set
 * ```
 */
export function applyReasoningOptions(
  streamOptions: ExtendedStreamOptions,
  provider: string,
  reasoningEffort: ReasoningEffort,
  logPrefix: string = '[Agent]',
  model?: string
): void {
  if (provider === 'groq') {
    // Extract model identifier from streamOptions if not provided
    const modelId = model || (typeof streamOptions.model === 'string' ? streamOptions.model : undefined);
    
    // Only apply reasoning effort if the model supports it
    if (!modelId || !groqSupportsReasoningEffort(modelId)) {
      getEventSystem().info(EventCategory.PROVIDER, `${logPrefix} Skipping Groq reasoningEffort - model '${modelId || 'unknown'}' does not support reasoning effort`);
      return;
    }
    
    // Debug: Log the reasoning effort value received
    getEventSystem().info(EventCategory.PROVIDER, `${logPrefix} applyReasoningOptions received reasoningEffort: ${reasoningEffort} for model '${modelId}'`);
    
    // Groq: reasoningEffort ('none' | 'default' | 'low' | 'medium' | 'high')
    // Pass through the reasoning effort value directly (validated by determineReasoningEffort)
    // For Qwen models, only 'none' and 'default' are supported
    // For GPT-OSS models, 'low', 'medium', and 'high' are supported
    let groqEffort: 'none' | 'default' | 'low' | 'medium' | 'high';
    if (modelId.includes('qwen')) {
      // Qwen models only support 'none' and 'default'
      // Map 'default' directly, map other values appropriately
      if (reasoningEffort === 'none') {
        groqEffort = 'none';
      } else if (reasoningEffort === 'default') {
        groqEffort = 'default';
      } else {
        // For Qwen, any other value (low, medium, high) maps to 'default' to enable reasoning
        groqEffort = 'default';
      }
    } else {
      // GPT-OSS models support 'low', 'medium', 'high'
      // Map 'none' to 'low' for GPT-OSS models (they don't support 'none')
      if (reasoningEffort === 'none' || reasoningEffort === 'minimal') {
        groqEffort = 'low';
      } else {
        groqEffort = reasoningEffort as 'low' | 'medium' | 'high';
      }
    }
    streamOptions.providerOptions = {
      ...streamOptions.providerOptions,
      groq: {
        ...streamOptions.providerOptions?.groq,
        reasoningEffort: groqEffort,
      },
    };
    getEventSystem().info(EventCategory.PROVIDER, `${logPrefix} Applied Groq reasoningEffort: ${groqEffort} for model '${modelId}'`);
  } else if (provider === 'openai') {
    // OpenAI: reasoningEffort ('none' | 'minimal' | 'low' | 'medium' | 'high')
    // Prefer 'none' for lowest latency, fallback to 'minimal' if needed
    const openaiEffort = reasoningEffort === 'none' ? 'none' : 'minimal';
    streamOptions.providerOptions = {
      ...streamOptions.providerOptions,
      openai: {
        ...streamOptions.providerOptions?.openai,
        reasoningEffort: openaiEffort,
      },
    };
    getEventSystem().info(EventCategory.LLM, `${logPrefix} Applied OpenAI reasoningEffort: ${openaiEffort}`);
  } else if (provider === 'anthropic') {
    // Anthropic: effort ('low' | 'medium' | 'high')
    streamOptions.providerOptions = {
      ...streamOptions.providerOptions,
      anthropic: {
        ...streamOptions.providerOptions?.anthropic,
        effort: 'low',
      },
    };
    getEventSystem().info(EventCategory.LLM, `${logPrefix} Applied Anthropic effort: low`);
  } else if (provider === 'xai') {
    // xAI: reasoningEffort ('low' | 'high')
    streamOptions.providerOptions = {
      ...streamOptions.providerOptions,
      xai: {
        ...streamOptions.providerOptions?.xai,
        reasoningEffort: 'low',
      },
    };
    getEventSystem().info(EventCategory.LLM, `${logPrefix} Applied xAI reasoningEffort: low`);
  } else if (provider === 'openrouter') {
    // OpenRouter: Uses OpenAI-compatible API with extraBody for reasoning.effort
    // Prefer 'none' (mapped to 'minimal' for OpenRouter), fallback to 'low' if needed
    const existingOpenRouter = streamOptions.providerOptions?.openrouter;
    const existingExtraBody = existingOpenRouter && typeof existingOpenRouter === 'object' && 'extraBody' in existingOpenRouter
      ? existingOpenRouter.extraBody
      : undefined;
    
    // OpenRouter maps 'none' to 'minimal' in their API
    const openrouterEffort = reasoningEffort === 'none' ? 'minimal' : reasoningEffort === 'minimal' ? 'minimal' : 'low';
    
    streamOptions.providerOptions = {
      ...streamOptions.providerOptions,
      openrouter: {
        ...(existingOpenRouter && typeof existingOpenRouter === 'object' ? existingOpenRouter : {}),
        extraBody: {
          ...(existingExtraBody && typeof existingExtraBody === 'object' ? existingExtraBody : {}),
          reasoning: {
            effort: openrouterEffort,
          },
        },
      },
    };
    getEventSystem().info(EventCategory.PROVIDER, `${logPrefix} Applied OpenRouter reasoning.effort: ${openrouterEffort}${reasoningEffort === 'none' ? ' (none mapped to minimal)' : ''}`);
  }
}
