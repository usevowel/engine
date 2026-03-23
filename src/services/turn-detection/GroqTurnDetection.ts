/**
 * GroqTurnDetection - Groq-based turn completion detection
 * 
 * Uses Groq's fast inference API with Llama 3.1 8B Instruct model.
 * Groq provides extremely fast response times (~100-200ms) at low cost.
 * 
 * Default model: llama-3.1-8b-instant
 * Cost: ~$0.000008 per check (negligible)
 */

import { TurnDetectionService, TURN_DETECTION_PROMPT } from './TurnDetectionService';

import { getEventSystem, EventCategory } from '../../events';
export interface GroqTurnDetectionConfig {
  apiKey: string;
  model?: string;
  debug?: boolean;
  maxRetries?: number; // Maximum retry attempts on failure (default: 1)
  retryDelayMs?: number; // Delay between retries (default: 100ms)
}

export class GroqTurnDetection implements TurnDetectionService {
  private apiKey: string;
  private model: string;
  private debug: boolean;
  private maxRetries: number;
  private retryDelayMs: number;
  private apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
  
  constructor(config: GroqTurnDetectionConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'llama-3.1-8b-instant';
    this.debug = config.debug ?? false;
    this.maxRetries = config.maxRetries ?? 1;
    this.retryDelayMs = config.retryDelayMs ?? 100;
    
    this.log('🎯 GroqTurnDetection initialized', {
      model: this.model,
      maxRetries: this.maxRetries,
    });
  }
  
  async checkTurnComplete(transcript: string): Promise<boolean> {
    // Retry logic (Layer 4)
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.attemptCheck(transcript, attempt);
      } catch (error) {
        // If this was the last attempt, throw
        if (attempt === this.maxRetries) {
          throw error;
        }
        
        // Otherwise, wait and retry
        this.log(`⚠️  Attempt ${attempt + 1} failed, retrying in ${this.retryDelayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
      }
    }
    
    // Should never reach here, but TypeScript needs this
    throw new Error('Max retries exceeded');
  }
  
  private async attemptCheck(transcript: string, attempt: number): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      // Build prompt with transcript
      const prompt = TURN_DETECTION_PROMPT.replace('{transcript}', transcript);
      
      this.log('🤔 Calling Groq LLM for turn detection', {
        transcript,
        model: this.model,
        attempt: attempt + 1,
      });
      
      // Call Groq API
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
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
        throw new Error(`Groq API error: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      const llmResponse = data.choices?.[0]?.message?.content?.trim().toLowerCase();
      
      const latency = Date.now() - startTime;
      
      this.log('✅ Groq LLM response received', {
        response: llmResponse,
        latency: `${latency}ms`,
        attempt: attempt + 1,
      });
      
      // Parse response
      if (llmResponse === 'true') {
        return true;
      } else if (llmResponse === 'false') {
        return false;
      } else {
        // Invalid response - log warning and throw
        getEventSystem().warn(EventCategory.LLM, `⚠️  [GroqTurnDetection] Invalid LLM response: "${llmResponse}" (expected "true" or "false")`);
        throw new Error(`Invalid LLM response: ${llmResponse}`);
      }
      
    } catch (error) {
      const latency = Date.now() - startTime;
      getEventSystem().error(EventCategory.PROVIDER, `❌ [GroqTurnDetection] Error calling Groq API (${latency}ms, attempt ${attempt + 1}):`, error);
      throw error; // Re-throw for retry logic
    }
  }
  
  private log(message: string, data?: any): void {
    if (!this.debug) return;
    
    if (data) {
      getEventSystem().info(EventCategory.PROVIDER, `[GroqTurnDetection] ${message}`, data);
    } else {
      getEventSystem().info(EventCategory.PROVIDER, `[GroqTurnDetection] ${message}`);
    }
  }
}

