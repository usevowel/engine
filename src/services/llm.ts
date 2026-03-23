/**
 * LLM Service
 * 
 * Integrates with Groq GPT-OSS 120B and OpenRouter via Vercel AI SDK.
 * 
 * NOW RUNTIME-AGNOSTIC: Creates LLM client with provided API key and provider.
 */

import { getProvider, type SupportedProvider } from './providers/llm';
import { streamText, CoreMessage, CoreTool, jsonSchema, generateObject, NoSuchToolError } from 'ai';

import { getEventSystem, EventCategory } from '../events';
import { groqSupportsReasoningEffort, determineReasoningEffort } from './providers/llm/reasoning-effort';
export interface LLMStreamOptions {
  provider?: SupportedProvider; // LLM provider (default: 'groq', from registry)
  apiKey: string; // API key (required, from RuntimeConfig)
  model?: string;
  instructions?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: Record<string, CoreTool>;
  // OpenRouter-specific options
  openrouterSiteUrl?: string;
  openrouterAppName?: string;
  // Session identifier reserved for hosted instrumentation paths
  sessionId?: string;
}

export interface ToolCallPart {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  args: any;
}

export interface TextPart {
  type: 'text';
  delta: string;
}

export interface UsagePart {
  type: 'usage';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type LLMStreamPart = TextPart | ToolCallPart | UsagePart;

/**
 * Stream LLM response with tool support
 * 
 * NOTE: Tools are NOT executed server-side. Tool calls are yielded to the caller,
 * which should send them to the client for execution. The client will send back
 * tool results via conversation.item.create events.
 * 
 * NOW RUNTIME-AGNOSTIC: Accepts API key as parameter instead of using static config.
 * 
 * @param messages Conversation history
 * @param options Stream options (including apiKey from RuntimeConfig)
 * @returns Async generator of text deltas, tool calls, and usage data
 */
export async function* streamLLMResponse(
  messages: CoreMessage[],
  options: LLMStreamOptions
): AsyncGenerator<LLMStreamPart, void, unknown> {
  const {
    provider = 'groq',
    apiKey,
    model = provider === 'openrouter'
      ? 'anthropic/claude-3-5-sonnet'
      : provider === 'cerebras'
        ? 'llama-3.3-70b'
        : provider === 'workers-ai'
          ? '@cf/zai-org/glm-4.7-flash'
          : 'moonshotai/kimi-k2-instruct-0905',
    instructions,
    temperature,
    maxTokens,
    tools = {},
    openrouterSiteUrl,
    openrouterAppName,
    sessionId,
  } = options;
  
  // Get provider from registry (replaces manual if/else logic)
  const llmClient = getProvider(provider, {
    apiKey,
    openrouterSiteUrl,
    openrouterAppName,
  });
  
  try {
    // Prepend system message if instructions provided
    const fullMessages: CoreMessage[] = instructions
      ? [{ role: 'system', content: instructions }, ...messages]
      : messages;
    
    getEventSystem().info(EventCategory.LLM, `🤖 [LLM] Provider: ${provider}, Streaming with ${fullMessages.length} messages, ${Object.keys(tools).length} tools`);
    getEventSystem().info(EventCategory.LLM, `🤖 [LLM] Model: ${model}, Temperature: ${temperature}`);
    
    // Determine reasoning effort based on provider and model family
    // Uses centralized determineReasoningEffort function which checks GROQ_REASONING_EFFORT env var
    // Only apply to Groq provider (OpenRouter handles this internally)
    let reasoningEffort: ReturnType<typeof determineReasoningEffort> | undefined;
    if (provider === 'groq') {
      reasoningEffort = determineReasoningEffort(model, provider);
      getEventSystem().info(EventCategory.LLM, `🤖 [LLM] Reasoning effort: ${reasoningEffort}, include_reasoning: false`);
    }
    
    // Create the base model directly in OSS.
    // Hosted-specific analytics instrumentation is layered elsewhere.
    const baseModel = llmClient(model);
    
    // Build stream options based on provider
    const streamOptions: any = {
      model: baseModel,
      messages: fullMessages,
      temperature,
      maxTokens,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      maxSteps: 15, // Allow multiple tool calls and continuations
    };
    
    // Add provider-specific parameters for reasoning effort
    if (provider === 'groq') {
      // Groq-specific reasoning control
      // Only apply reasoning effort if the model supports it
      if (reasoningEffort && groqSupportsReasoningEffort(model)) {
        // Map reasoning effort values for Groq models
        // Qwen models only support 'none' and 'default'
        // GPT-OSS models support 'low', 'medium', 'high'
        let groqEffort: string;
        if (model.includes('qwen')) {
          // Qwen models: map 'none' to 'none', everything else to 'default'
          groqEffort = reasoningEffort === 'none' ? 'none' : 'default';
        } else {
          // GPT-OSS models: map 'none'/'minimal' to 'low', pass through others
          if (reasoningEffort === 'none' || reasoningEffort === 'minimal') {
            groqEffort = 'low';
          } else {
            groqEffort = reasoningEffort; // 'low', 'medium', or 'high'
          }
        }
        streamOptions.reasoning_effort = groqEffort;
        streamOptions.include_reasoning = false;
        getEventSystem().info(EventCategory.LLM, `🤖 [LLM] Applied Groq reasoning_effort: ${groqEffort} for model '${model}'`);
      } else if (reasoningEffort) {
        getEventSystem().info(EventCategory.LLM, `🤖 [LLM] Skipping Groq reasoning_effort - model '${model}' does not support reasoning effort`);
      }
    } else if (provider === 'openrouter') {
      // OpenRouter-specific reasoning control (for low latency voice)
      // For models that support reasoning parameters:
      // - Use 'minimal' reasoning effort for lowest latency
      // - Disable reasoning output to reduce tokens
      streamOptions.reasoning_effort = 'minimal';
      
      // For GPT-5 and reasoning-capable models, use nested reasoning object
      // Note: This works with models like o1, o4-mini that support advanced reasoning
      if (model.includes('gpt-5') || model.includes('o1') || model.includes('o4') || model.includes('o3')) {
        streamOptions.reasoning = {
          effort: 'minimal'
        };
        delete streamOptions.reasoning_effort; // Use nested format for these models
      }
      
      getEventSystem().info(EventCategory.LLM, `🤖 [LLM] OpenRouter: Using minimal reasoning for low latency`);
    }
    
    // Add experimental tool call repair
    // This uses structured outputs to fix malformed tool calls
    streamOptions.experimental_repairToolCall = async ({
      toolCall,
      tools: toolsParam,
      inputSchema,
      error,
    }: any) => {
      getEventSystem().info(EventCategory.LLM, `🔧 [LLM] Tool call repair triggered for: ${toolCall.toolName}`);
      getEventSystem().error(EventCategory.LLM, `🔧 [LLM] Error: ${error.message}`);
      
      // Don't attempt to fix invalid tool names
      if (NoSuchToolError.isInstance(error)) {
        getEventSystem().info(EventCategory.LLM, `🔧 [LLM] Invalid tool name, cannot repair: ${toolCall.toolName}`);
        return null;
      }
      
      try {
        const tool = toolsParam[toolCall.toolName as keyof typeof toolsParam];
        
        getEventSystem().info(EventCategory.LLM, `🔧 [LLM] Attempting to repair tool call with structured outputs`);
        getEventSystem().info(EventCategory.LLM, `🔧 [LLM] Original input: ${JSON.stringify(toolCall.input).substring(0, 200)}`);
        
        // Use generateObject with the same model to repair the tool call
        const { object: repairedArgs } = await generateObject({
          model: baseModel,
          schema: tool.parameters,
          prompt: [
            `The model tried to call the tool "${toolCall.toolName}" with the following inputs:`,
            JSON.stringify(toolCall.input),
            `The tool accepts the following schema:`,
            JSON.stringify(inputSchema(toolCall)),
            `The error was: ${error.message}`,
            `Please fix the inputs to match the schema exactly.`,
          ].join('\n'),
        });
        
        getEventSystem().info(EventCategory.LLM, `✅ [LLM] Tool call repaired successfully`);
        getEventSystem().info(EventCategory.LLM, `🔧 [LLM] Repaired input: ${JSON.stringify(repairedArgs).substring(0, 200)}`);
        
        return { ...toolCall, input: JSON.stringify(repairedArgs) };
      } catch (repairError) {
        getEventSystem().error(EventCategory.LLM, `❌ [LLM] Tool call repair failed: ${repairError}`);
        return null;
      }
    };
    
    // Stream text from LLM with tools
    const streamStartTime = Date.now();
    let firstTokenTime: number | null = null;
    let textContent = '';

    const result = await streamText(streamOptions);
    
    getEventSystem().info(EventCategory.LLM, `🤖 [LLM] Stream started, processing parts...`);
    
    // Track first token time
    const trackFirstToken = () => {
      if (firstTokenTime === null) {
        firstTokenTime = Date.now() - streamStartTime;
        getEventSystem().performance(EventCategory.LLM, 'llm_first_token', firstTokenTime, 'ms', {
          provider,
          model,
        });
      }
    };
    
    // Stream all parts (text and tool calls)
    // Note: AI SDK v5 uses 'text' property (not 'textDelta') for text-delta events
    let partCount = 0;
    for await (const part of result.fullStream) {
      partCount++;
      // Detailed part logging (commented out to reduce verbosity)
      // getEventSystem().info(EventCategory.LLM, `🤖 [LLM] Part ${partCount}:`, part.type, part);
      
      if (part.type === 'text-delta') {
        // Track first token on first text delta
        trackFirstToken();
        // AI SDK v5: part.text contains the incremental text content
        textContent += part.text;
        yield { type: 'text', delta: part.text };
      } else if (part.type === 'tool-call') {
        // Yield tool call for client-side execution
        getEventSystem().info(EventCategory.LLM, `🔧 Tool call requested: ${part.toolName}`, part.args);
        yield { 
          type: 'tool_call', 
          toolName: part.toolName, 
          toolCallId: part.toolCallId,
          args: (part as any).args 
        };
      } else if (part.type === 'error') {
        getEventSystem().error(EventCategory.LLM, `❌ [LLM] Error part received:`, part);
        // Extract failed_generation if available for debugging parsing errors
        const errorObj = (part as any).error;
        if (errorObj?.failed_generation) {
          getEventSystem().error(EventCategory.LLM, `❌ [LLM] Failed generation output:`, errorObj.failed_generation);
        }
        throw new Error(`LLM stream error: ${JSON.stringify(part)}`);
      } else if (part.type === 'usage') {
        // Pass through usage events for token tracking
        yield {
          type: 'usage',
          promptTokens: (part as any).promptTokens,
          completionTokens: (part as any).completionTokens,
          totalTokens: (part as any).totalTokens,
        };
      } else if (
        part.type === 'start' || 
        part.type === 'start-step' || 
        part.type === 'finish-step' || 
        part.type === 'finish' ||
        part.type === 'reasoning-start' ||
        part.type === 'reasoning-delta' ||
        part.type === 'reasoning-end' ||
        part.type === 'text-start' ||
        part.type === 'text-end' ||
        part.type === 'tool-input-start' ||
        part.type === 'tool-input-delta' ||
        part.type === 'tool-input-end'
      ) {
        // Silently ignore lifecycle, reasoning, and text boundary events
        // These are informational only and not needed for our processing
      } else {
        getEventSystem().warn(EventCategory.LLM, `⚠️  [LLM] Unhandled part type: ${part.type}`);
      }
    }
    
    const streamDuration = Date.now() - streamStartTime;
    getEventSystem().info(EventCategory.LLM, `🤖 [LLM] Stream complete. Total parts: ${partCount}, Duration: ${streamDuration}ms`);
    
    // Emit stream complete event with performance metrics
    getEventSystem().info(EventCategory.LLM, 'llm_stream_complete', {
      provider,
      model,
      partCount,
      durationMs: streamDuration,
      firstTokenMs: firstTokenTime,
      textLength: textContent.length,
    }, ['llm', 'stream', 'complete']);
    
    // Yield usage data after stream completes
    try {
      const usage = await result.usage;
      getEventSystem().info(EventCategory.LLM, `🤖 [LLM] Usage:`, usage);
      yield {
        type: 'usage',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      };
    } catch (error) {
      getEventSystem().warn(EventCategory.LLM, '⚠️  [LLM] Failed to get usage data:', error);
    }
  } catch (error) {
    // Log error with API key preview for debugging
    const keyPreview = apiKey 
      ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`
      : 'MISSING';
    getEventSystem().error(EventCategory.LLM, '❌ LLM streaming error:', error);
    getEventSystem().error(EventCategory.PROVIDER, `🔑 Error context: provider=${provider}, model=${model}, apiKey=${keyPreview}`);
    
    // Check for common API key errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.toLowerCase().includes('api key') || 
        errorMessage.toLowerCase().includes('unauthorized') ||
        errorMessage.toLowerCase().includes('authentication') ||
        errorMessage.toLowerCase().includes('invalid') ||
        errorMessage.toLowerCase().includes('401')) {
      getEventSystem().critical(EventCategory.AUTH, `🚨 API KEY ERROR DETECTED! Using key: ${keyPreview}`);
      getEventSystem().error(EventCategory.LLM, `🔍 Full error message: ${errorMessage}`);
    }
    
    throw new Error(
      `Failed to generate LLM response: ${errorMessage}`
    );
  }
}

/**
 * Get full LLM response (non-streaming)
 * 
 * @param messages Conversation history
 * @param options Response options
 * @returns Complete response text
 */

/**
 * Format conversation history for LLM
 * 
 * @param history Array of conversation items (supports both simple and complex messages)
 * @returns Formatted messages for LLM
 */
export function formatConversationHistory(
  history: Array<{ role: string; content: any }>
): CoreMessage[] {
  return history.map(item => {
    // Handle tool role with structured content
    if (item.role === 'tool') {
      return {
        role: 'tool',
    content: item.content,
      } as CoreMessage;
    }
    
    // Handle assistant role with potential tool calls
    if (item.role === 'assistant') {
      return {
        role: 'assistant',
        content: item.content,
      } as CoreMessage;
    }
    
    // Handle simple string content for user/system messages
    return {
      role: item.role as 'user' | 'system',
      content: typeof item.content === 'string' ? item.content : String(item.content),
    } as CoreMessage;
  });
}
