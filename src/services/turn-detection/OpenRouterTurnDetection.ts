/**
 * OpenRouterTurnDetection - OpenRouter-based turn completion detection
 * 
 * Uses OpenRouter's unified API to access multiple LLM providers.
 * Provides flexibility to use different models (Claude, GPT-4, Llama, etc.)
 * 
 * Default model: llama-3.1-8b-instant (via OpenRouter)
 * Cost: Varies by model
 */

import { TurnDetectionService, TURN_DETECTION_PROMPT } from './TurnDetectionService';

import { getEventSystem, EventCategory } from '../../events';
export interface OpenRouterTurnDetectionConfig {
  apiKey: string;
  model?: string;
  siteUrl?: string;
  appName?: string;
  debug?: boolean;
}

export class OpenRouterTurnDetection implements TurnDetectionService {
  private apiKey: string;
  private model: string;
  private siteUrl?: string;
  private appName?: string;
  private debug: boolean;
  private apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
  
  constructor(config: OpenRouterTurnDetectionConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'meta-llama/llama-3.1-8b-instruct';
    this.siteUrl = config.siteUrl;
    this.appName = config.appName;
    this.debug = config.debug ?? false;
    
    this.log('🎯 OpenRouterTurnDetection initialized', {
      model: this.model,
    });
  }
  
  async checkTurnComplete(transcript: string): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      // Build prompt with transcript
      const prompt = TURN_DETECTION_PROMPT.replace('{transcript}', transcript);
      
      this.log('🤔 Calling OpenRouter LLM for turn detection', {
        transcript,
        model: this.model,
      });
      
      // Build headers
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      };
      
      // Add optional headers
      if (this.siteUrl) {
        headers['HTTP-Referer'] = this.siteUrl;
      }
      if (this.appName) {
        headers['X-Title'] = this.appName;
      }
      
      // Call OpenRouter API
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          // Use provider defaults (no temperature or max_tokens override)
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorData: any;
        
        // Try to parse error JSON
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: { message: errorText } };
        }
        
        // Check for specific error types
        if (response.status === 402) {
          // Insufficient credits - throw specific error
          const errorMessage = errorData.error?.message || 'Insufficient credits';
          throw new Error(`OpenRouter insufficient credits: ${errorMessage}`);
        }
        
        if (response.status === 401) {
          // Authentication error
          const errorMessage = errorData.error?.message || 'Authentication failed';
          throw new Error(`OpenRouter authentication error: ${errorMessage}`);
        }
        
        // Generic error
        throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      const llmResponse = data.choices?.[0]?.message?.content?.trim().toLowerCase();
      
      const latency = Date.now() - startTime;
      
      this.log('✅ OpenRouter LLM response received', {
        response: llmResponse,
        latency: `${latency}ms`,
      });
      
      // Parse response
      if (llmResponse === 'true') {
        return true;
      } else if (llmResponse === 'false') {
        return false;
      } else {
        // Invalid response - log warning and throw
        getEventSystem().warn(EventCategory.LLM, `⚠️  [OpenRouterTurnDetection] Invalid LLM response: "${llmResponse}" (expected "true" or "false")`);
        throw new Error(`Invalid LLM response: ${llmResponse}`);
      }
      
    } catch (error) {
      const latency = Date.now() - startTime;
      getEventSystem().error(EventCategory.PROVIDER, `❌ [OpenRouterTurnDetection] Error calling OpenRouter API (${latency}ms):`, error);
      throw error; // Re-throw so caller can fall back to timeout
    }
  }
  
  private log(message: string, data?: any): void {
    if (!this.debug) return;
    
    if (data) {
      getEventSystem().info(EventCategory.PROVIDER, `[OpenRouterTurnDetection] ${message}`, data);
    } else {
      getEventSystem().info(EventCategory.PROVIDER, `[OpenRouterTurnDetection] ${message}`);
    }
  }
}

