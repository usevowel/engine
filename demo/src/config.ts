/**
 * Configuration for the Voice Agent Demo
 * 
 * Environment configurations for different deployment targets.
 */

/**
 * Environment configuration type
 */
export interface EnvironmentConfig {
  id: string;
  name: string;
  serverUrl: string;
  apiBaseUrl: string;
  tokenEndpoint: string;
  model: string;
  voice: string;
  llmProvider?: string;
}

/**
 * Available environment configurations
 */
export const ENVIRONMENTS: Record<string, EnvironmentConfig> = {
  localhostWrangler: {
    id: 'localhostWrangler',
    name: 'Localhost Wrangler (localhost:8787)',
    serverUrl: 'ws://localhost:8787/v1/realtime',
    apiBaseUrl: 'http://localhost:8787',
    tokenEndpoint: 'http://localhost:3081/api/token',
    model: 'openai/gpt-oss-120b',
    llmProvider: 'groq',
    voice: 'Ashley',
  },
  localhostBun: {
    id: 'localhostBun',
    name: 'Localhost Bun (localhost:3001)',
    serverUrl: 'ws://localhost:3001/v1/realtime',
    apiBaseUrl: 'http://localhost:3001',
    tokenEndpoint: 'http://localhost:3081/api/token',
    model: 'openai/gpt-oss-120b',
    llmProvider: 'groq',
    voice: 'Ashley',
  },
  selfHosted: {
    id: 'selfHosted',
    name: 'Self-Hosted (configure your server)',
    serverUrl: 'wss://your-engine.example.com/v1/realtime',
    apiBaseUrl: 'https://your-engine.example.com',
    tokenEndpoint: 'http://localhost:3081/api/token',
    model: 'openai/gpt-oss-120b',
    llmProvider: 'groq',
    voice: 'Ashley',
  },
};

/**
 * Default environment
 */
export const DEFAULT_ENVIRONMENT = 'dev';

/**
 * Get configuration for a specific environment
 */
export function getConfig(environmentId: string, customUrl?: string): EnvironmentConfig {
  if (environmentId === 'custom' && customUrl) {
    // Parse custom URL and create config
    const isSecure = customUrl.startsWith('https://');
    const wsProtocol = isSecure ? 'wss://' : 'ws://';
    const httpProtocol = isSecure ? 'https://' : 'http://';
    
    // Remove protocol if present
    const baseUrl = customUrl.replace(/^https?:\/\//, '');
    
    return {
      id: 'custom',
      name: `Custom (${baseUrl})`,
      serverUrl: `${wsProtocol}${baseUrl}/v1/realtime`,
      apiBaseUrl: `${httpProtocol}${baseUrl}`,
      tokenEndpoint: 'http://localhost:3002/api/token',
      model: 'openai/gpt-oss-120b',
      llmProvider: 'groq',
      voice: 'Ashley',
    };
  }
  
  return ENVIRONMENTS[environmentId] || ENVIRONMENTS[DEFAULT_ENVIRONMENT];
}

/**
 * Legacy CONFIG export (for backward compatibility)
 * This will be dynamically set based on selected environment
 */
export let CONFIG: EnvironmentConfig = getConfig(DEFAULT_ENVIRONMENT);

export type ConnectionStatus = 
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'speaking'
  | 'error';

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: Date;
}

