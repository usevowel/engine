/**
 * Provider Registry
 * 
 * Centralized registry for LLM providers with auto-expanding TypeScript types.
 * Adding a new provider to PROVIDER_FACTORIES automatically updates the SupportedProvider type.
 * 
 * All providers are based on Vercel AI SDK and return standard provider instances.
 */

import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import { getEventSystem, EventCategory } from '../../../events';

/**
 * Provider configuration
 */
export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  openrouterSiteUrl?: string;  // OpenRouter specific
  openrouterAppName?: string;  // OpenRouter specific
}

type ProviderFactory = (config: ProviderConfig) => any;

/**
 * Provider Factory Functions
 * 
 * Each provider is a factory that creates a Vercel AI SDK provider instance.
 * All providers follow the same interface defined by Vercel AI SDK.
 * 
 * To add a new provider:
 * 1. Install the provider package
 * 2. Import the create function
 * 3. Add entry to PROVIDER_FACTORIES
 * 4. Types update automatically everywhere!
 */
const PROVIDER_FACTORIES = {
  /**
   * Groq - Fast LPU-powered inference
   * Models: llama-3.3-70b-versatile, mixtral-8x7b-32768, etc.
   */
  groq: ((config: ProviderConfig) => createGroq({
    apiKey: config.apiKey,
  })) as ProviderFactory,
  
  /**
   * OpenRouter - Access to 100+ models
   * Models: anthropic/claude, openai/gpt-4, meta-llama/llama-3, etc.
   */
  openrouter: ((config: ProviderConfig) => createOpenRouter({
    apiKey: config.apiKey,
    headers: {
      ...(config.openrouterSiteUrl && { 'HTTP-Referer': config.openrouterSiteUrl }),
      ...(config.openrouterAppName && { 'X-Title': config.openrouterAppName }),
    },
  })) as ProviderFactory,

  /**
   * OpenAI-compatible - Local/self-hosted OpenAI API compatible endpoints
   */
  'openai-compatible': ((config: ProviderConfig) => createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    name: 'openai-compatible',
  })) as ProviderFactory,
  
  // Future providers:
  // anthropic: (config) => createAnthropic({ apiKey: config.apiKey }),
  // openai: (config) => createOpenAI({ apiKey: config.apiKey }),
} as const;

/**
 * Auto-generated type from registry keys
 * 
 * ✅ Adding a new provider to PROVIDER_FACTORIES automatically updates this type!
 * 
 * Current OSS providers: 'groq' | 'openrouter' | 'openai-compatible'
 */
export type SupportedProvider = keyof typeof PROVIDER_FACTORIES;

/**
 * Get a provider instance by name
 * 
 * @param provider - Provider name (type-safe from registry)
 * @param config - Provider configuration (API key, headers, etc.)
 * @returns Vercel AI SDK provider instance
 * 
 * @example
 * ```typescript
 * const groqProvider = getProvider('groq', { apiKey: 'gsk_...' });
 * const model = groqProvider('llama-3.3-70b-versatile');
 * ```
 * 
 * @throws Error if provider is not registered
 */
export function getProvider(provider: SupportedProvider, config: ProviderConfig) {
  const factory = PROVIDER_FACTORIES[provider];
  
  if (!factory) {
    throw new Error(`Unknown provider: ${provider}. Supported providers: ${getProviderNames().join(', ')}`);
  }
  
  // Log API key verification (first 8 chars + last 4 chars for security)
  const apiKeyPreview = config.apiKey 
    ? `${config.apiKey.substring(0, 8)}...${config.apiKey.substring(config.apiKey.length - 4)}`
    : 'MISSING';
  getEventSystem().info(EventCategory.PROVIDER, `🔑 Provider Registry: Creating ${provider} provider`, {
    apiKeyPreview,
    baseUrl: config.baseUrl,
    hasOpenRouterHeaders: !!(config.openrouterSiteUrl || config.openrouterAppName),
    openrouterSiteUrl: config.openrouterSiteUrl,
    openrouterAppName: config.openrouterAppName,
  });
  
  const providerInstance = factory(config);
  
  getEventSystem().info(EventCategory.PROVIDER, `✅ Provider Registry: ${provider} provider created successfully`, {
    provider,
    apiKeyPreview,
  });
  
  return providerInstance;
}

/**
 * Get all registered provider names
 * 
 * @returns Array of provider names
 * 
 * @example
 * ```typescript
 * const providers = getProviderNames(); // ['groq', 'openrouter']
 * ```
 */
export function getProviderNames(): SupportedProvider[] {
  return Object.keys(PROVIDER_FACTORIES) as SupportedProvider[];
}

/**
 * Check if a provider is registered
 * 
 * @param provider - Provider name to check
 * @returns True if provider is registered, false otherwise
 * 
 * @example
 * ```typescript
 * if (isValidProvider('groq')) {
 *   // Use groq provider
 * }
 * ```
 */
export function isValidProvider(provider: string): provider is SupportedProvider {
  return provider in PROVIDER_FACTORIES;
}
