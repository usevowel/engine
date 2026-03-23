/**
 * Provider Registry
 * 
 * Centralized registry for LLM providers with auto-expanding TypeScript types.
 * Adding a new provider to PROVIDER_FACTORIES automatically updates the SupportedProvider type.
 * 
 * All providers are based on Vercel AI SDK and return standard provider instances.
 */

import { createGroq } from '@ai-sdk/groq';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createCerebras } from '@ai-sdk/cerebras';
import { createWorkersAI } from 'workers-ai-provider';

import { getEventSystem, EventCategory } from '../../../events';

export interface WorkersAIBinding {
  run(model: string, inputs: unknown, options?: unknown): Promise<unknown>;
}

let registeredWorkersAIBinding: WorkersAIBinding | null = null;

/**
 * Provider configuration
 */
export interface ProviderConfig {
  apiKey: string;
  openrouterSiteUrl?: string;  // OpenRouter specific
  openrouterAppName?: string;  // OpenRouter specific
  workersAI?: WorkersAIBinding;
}

type ProviderFactory = (config: ProviderConfig) => any;

function getWorkersAIBinding(config: ProviderConfig): WorkersAIBinding {
  const binding = config.workersAI ?? registeredWorkersAIBinding;

  if (!binding) {
    throw new Error(
      'Cloudflare Workers AI binding not configured. Call registerWorkersAIBinding(env.AI) before using the workers-ai provider.'
    );
  }

  return binding;
}

/**
 * Provider Factory Functions
 * 
 * Each provider is a factory that creates a Vercel AI SDK provider instance.
 * All providers follow the same interface defined by Vercel AI SDK.
 * 
 * To add a new provider:
 * 1. Install the provider package (e.g., bun add @cerebras/ai-sdk-provider)
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
   * Cerebras - Ultra-fast inference on CS-3 chips
   * Models: llama-3.3-70b, llama-3.1-8b, llama-3.1-70b
   */
  cerebras: ((config: ProviderConfig) => createCerebras({
    apiKey: config.apiKey,
  })) as ProviderFactory,

  /**
   * Cloudflare Workers AI - Runs on the Worker-side AI binding
   * Models: @cf/... catalog entries such as @cf/zai-org/glm-4.7-flash
   */
  'workers-ai': ((config: ProviderConfig) => createWorkersAI({
    binding: getWorkersAIBinding(config) as any,
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
 * Current providers: 'groq' | 'openrouter' | 'cerebras' | 'workers-ai'
 */
export type SupportedProvider = keyof typeof PROVIDER_FACTORIES;

/**
 * Register the Cloudflare Workers AI binding for this isolate.
 *
 * The hosted runtime does this during Worker/DO startup so shared engine code can
 * instantiate the `workers-ai` provider without threading the binding through
 * every call site.
 */
export function registerWorkersAIBinding(binding?: WorkersAIBinding | null): void {
  registeredWorkersAIBinding = binding ?? null;
}

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
    hasOpenRouterHeaders: !!(config.openrouterSiteUrl || config.openrouterAppName),
    openrouterSiteUrl: config.openrouterSiteUrl,
    openrouterAppName: config.openrouterAppName,
    hasWorkersAIBinding: !!(config.workersAI ?? registeredWorkersAIBinding),
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
