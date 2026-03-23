/**
 * AgentFactory - Factory for creating LLM agent instances
 * 
 * This factory provides a centralized way to create agent instances based on
 * configuration. It handles the complexity of instantiating different agent
 * types and ensures they all implement the ILLMAgent interface.
 * 
 * The factory supports:
 * - Creating agents via configuration object
 * - Validating configuration before instantiation
 * - Providing sensible defaults
 * - Easy extensibility for new agent types
 * 
 * @module AgentFactory
 */

import { ILLMAgent, AgentConfig } from './ILLMAgent';
import { VercelSDKAgent } from './VercelSDKAgent';
import { CustomAgent } from './CustomAgent';

import { getEventSystem, EventCategory } from '../../events';
/**
 * AgentFactory - Factory for creating LLM agent instances
 * 
 * @example
 * ```typescript
 * // Create a Vercel SDK agent (default)
 * const agent1 = AgentFactory.create({
 *   provider: 'groq',
 *   apiKey: 'gsk_...',
 *   model: 'moonshotai/kimi-k2-instruct-0905',
 *   systemPrompt: 'You are a helpful assistant',
 * });
 * 
 * // Create a custom agent with summarization
 * const agent2 = AgentFactory.create({
 *   agentType: 'custom',
 *   provider: 'groq',
 *   apiKey: 'gsk_...',
 *   model: 'moonshotai/kimi-k2-instruct-0905',
 *   systemPrompt: 'You are a helpful assistant',
 *   maxSteps: 5,
 *   contextStrategy: 'summarization',
 *   summarizationConfig: {
 *     activeWindowSize: 10,
 *     summarizationBufferSize: 5,
 *     maxSummaries: 3,
 *   },
 * });
 * ```
 */
export class AgentFactory {
  /**
   * Create an agent instance based on configuration
   * 
   * @param config - Agent configuration
   * @returns Agent instance implementing ILLMAgent
   * @throws Error if agent type is not supported
   * 
   * @example
   * ```typescript
   * const agent = AgentFactory.create({
   *   agentType: 'custom',  // or 'vercel-sdk'
   *   provider: 'groq',
   *   apiKey: 'gsk_...',
   *   model: 'moonshotai/kimi-k2-instruct-0905',
   *   systemPrompt: 'You are a helpful assistant',
   *   maxSteps: 3,
   *   maxContextMessages: 15,
   * });
   * ```
   */
  static create(config: AgentConfig): ILLMAgent {
    // Validate configuration
    this.validateConfig(config);
    
    // Apply defaults
    const configWithDefaults = this.applyDefaults(config);
    
    // Create agent based on type
    const agentType = configWithDefaults.agentType || 'vercel-sdk';
    
    switch (agentType) {
      case 'vercel-sdk':
        getEventSystem().info(EventCategory.LLM, '🏭 [AgentFactory] Creating VercelSDKAgent');
        return new VercelSDKAgent(configWithDefaults);
      
      case 'custom':
        getEventSystem().info(EventCategory.LLM, '🏭 [AgentFactory] Creating CustomAgent');
        return new CustomAgent(configWithDefaults);
      
      default:
        throw new Error(`Unsupported agent type: ${agentType}`);
    }
  }
  
  /**
   * Validate agent configuration
   * 
   * Ensures all required fields are present and valid.
   * 
   * @param config - Agent configuration to validate
   * @throws Error if configuration is invalid
   */
  private static validateConfig(config: AgentConfig): void {
    if (!config.provider) {
      throw new Error('AgentConfig.provider is required');
    }
    
    if (config.provider !== 'workers-ai' && !config.apiKey) {
      throw new Error('AgentConfig.apiKey is required');
    }
    
    if (!config.model) {
      throw new Error('AgentConfig.model is required');
    }
    
    if (!config.systemPrompt) {
      throw new Error('AgentConfig.systemPrompt is required (can be a string or function)');
    }
    
    // Validate systemPrompt type
    if (typeof config.systemPrompt !== 'string' && typeof config.systemPrompt !== 'function') {
      throw new Error('AgentConfig.systemPrompt must be a string or a function');
    }
    
    // Validate context strategy if specified
    if (config.contextStrategy) {
      const validStrategies = ['message-count', 'token-count', 'sliding-window', 'summarization'];
      if (!validStrategies.includes(config.contextStrategy)) {
        throw new Error(
          `Invalid contextStrategy: ${config.contextStrategy}. Must be one of: ${validStrategies.join(', ')}`
        );
      }
    }
    
    // Validate summarization config if using summarization strategy
    if (config.contextStrategy === 'summarization' && !config.summarizationConfig) {
      throw new Error('summarizationConfig is required when using summarization strategy');
    }
  }
  
  /**
   * Apply default values to configuration
   * 
   * @param config - Agent configuration
   * @returns Configuration with defaults applied
   */
  private static applyDefaults(config: AgentConfig): Required<Omit<AgentConfig, 'openrouterSiteUrl' | 'openrouterAppName' | 'summarizationConfig' | 'sessionId' | 'maxStreamRetries'>> & {
    openrouterSiteUrl?: string;
    openrouterAppName?: string;
    summarizationConfig?: AgentConfig['summarizationConfig'];
    sessionId?: string;
    maxStreamRetries?: number;
  } {
    return {
      agentType: config.agentType || 'vercel-sdk',
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      systemPrompt: config.systemPrompt,
      maxSteps: config.maxSteps ?? 15,
      maxContextMessages: config.maxContextMessages ?? 15,
      contextStrategy: config.contextStrategy || 'message-count',
      openrouterSiteUrl: config.openrouterSiteUrl,
      openrouterAppName: config.openrouterAppName,
      summarizationConfig: config.summarizationConfig,
      sessionId: config.sessionId,
      maxStreamRetries: config.maxStreamRetries,
    };
  }
  
  /**
   * Get list of supported agent types
   * 
   * @returns Array of supported agent type identifiers
   * 
   * @example
   * ```typescript
   * const types = AgentFactory.getSupportedTypes();
   * getEventSystem().info(EventCategory.LLM, types); // ['vercel-sdk', 'custom']
   * ```
   */
  static getSupportedTypes(): string[] {
    return ['vercel-sdk', 'custom'];
  }
  
  /**
   * Check if an agent type is supported
   * 
   * @param agentType - Agent type to check
   * @returns True if supported, false otherwise
   * 
   * @example
   * ```typescript
   * if (AgentFactory.isSupported('custom')) {
   *   // Create custom agent
   * }
   * ```
   */
  static isSupported(agentType: string): boolean {
    return this.getSupportedTypes().includes(agentType);
  }
}

