/**
 * Test Driver
 * 
 * LLM-powered agent that conducts test conversations and evaluates responses.
 * Prefer free-tier models for tester runs unless a scenario explicitly needs
 * a paid model or a provider-specific behavior check.
 * 
 * @module driver
 */

import { generateText } from 'ai';
import { groq } from '@ai-sdk/groq';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export interface TestDriverConfig {
  objective: string;
  personality?: string;
  maxTurns: number;
  model?: string;
  provider?: 'groq' | 'openrouter';
  temperature?: number;
}

export interface ConversationState {
  turn: number;
  history: Array<{
    role: 'user' | 'agent';
    content: string;
    toolCalls?: Array<{
      name: string;
      arguments: Record<string, unknown>;
    }>;
  }>;
  context: {
    topics: string[];
    entities: string[];
    lastUserIntent?: string;
  };
}

export interface DriverResponse {
  message: string;
  shouldContinue: boolean;
  evaluation?: string;
}

export class TestDriver {
  private config: TestDriverConfig;
  private state: ConversationState;

  constructor(config: TestDriverConfig) {
    this.config = {
      personality: 'helpful test user',
      provider: (process.env.TEST_DRIVER_PROVIDER as 'groq' | 'openrouter' | undefined) || 'openrouter',
      model:
        process.env.TEST_DRIVER_MODEL ||
        process.env.OPENROUTER_MODEL ||
        process.env.GROQ_MODEL ||
        'arcee-ai/trinity-large-preview:free',
      temperature: 0.3,
      ...config,
    };
    
    this.state = {
      turn: 0,
      history: [],
      context: {
        topics: [],
        entities: [],
      },
    };
  }

  async generateNextMessage(agentResponse: string | null): Promise<DriverResponse> {
    this.state.turn++;
    
    if (this.state.turn > this.config.maxTurns) {
      return {
        message: '',
        shouldContinue: false,
        evaluation: 'Max turns reached',
      };
    }

    // Add agent response to history if present
    if (agentResponse) {
      this.state.history.push({
        role: 'agent',
        content: agentResponse,
      });
    }

    const prompt = this.buildPrompt();
    
    try {
      const model =
        this.config.provider === 'openrouter'
          ? createOpenRouter({
              apiKey: process.env.OPENROUTER_API_KEY || '',
              headers: {
                ...(process.env.OPENROUTER_SITE_URL && {
                  'HTTP-Referer': process.env.OPENROUTER_SITE_URL,
                }),
                ...(process.env.OPENROUTER_APP_NAME && {
                  'X-Title': process.env.OPENROUTER_APP_NAME,
                }),
              },
            })(this.config.model!)
          : groq(this.config.model!);

      const { text } = await generateText({
        model,
        temperature: this.config.temperature,
        prompt,
      });

      const parsed = this.parseResponse(text);
      
      // Add user message to history
      this.state.history.push({
        role: 'user',
        content: parsed.message,
      });

      return parsed;
    } catch (error) {
      console.error('TestDriver LLM error:', error);
      return {
        message: 'I need to end this conversation.',
        shouldContinue: false,
        evaluation: `Error: ${error}`,
      };
    }
  }

  private buildPrompt(): string {
    const historyText = this.state.history
      .map(h => `${h.role.toUpperCase()}: ${h.content}`)
      .join('\n\n');

    return `You are a test user conducting a conversation with a voice assistant.

OBJECTIVE: ${this.config.objective}

PERSONALITY: ${this.config.personality}

CONVERSATION HISTORY:
${historyText || '[No messages yet]'}

CURRENT TURN: ${this.state.turn}/${this.config.maxTurns}

Your task is to generate the next message in this conversation.

INSTRUCTIONS:
1. Respond naturally as a user would in a voice conversation
2. Stay in character with your personality
3. Work toward the stated objective
4. Keep responses concise (1-2 sentences typical for voice)
5. Evaluate if the assistant is meeting the objective

RESPONSE FORMAT (JSON):
{
  "message": "Your next message to the assistant",
  "shouldContinue": true/false,
  "evaluation": "Brief evaluation of the assistant's last response"
}

If shouldContinue is false, the conversation will end.

Generate your response now:`;
  }

  private parseResponse(text: string): DriverResponse {
    try {
      // Try to parse JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          message: parsed.message || '',
          shouldContinue: parsed.shouldContinue ?? true,
          evaluation: parsed.evaluation,
        };
      }
    } catch {
      // Fall back to treating entire response as message
    }

    // Simple fallback: treat text as message
    return {
      message: text.trim(),
      shouldContinue: this.state.turn < this.config.maxTurns,
    };
  }

  getState(): ConversationState {
    return { ...this.state };
  }

  reset(): void {
    this.state = {
      turn: 0,
      history: [],
      context: {
        topics: [],
        entities: [],
      },
    };
  }
}
