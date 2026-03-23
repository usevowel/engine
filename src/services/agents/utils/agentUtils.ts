/**
 * Agent Utilities - Shared helper functions for agent implementations
 * 
 * This module contains shared logic that is used across multiple agent types,
 * such as context truncation helpers and tool call repair utilities.
 * 
 * Note: Reasoning effort utilities have been moved to services/providers/llm/
 * 
 * @module agentUtils
 */

import { CoreMessage } from 'ai';
import { generateObject, NoSuchToolError } from 'ai';
import type { LanguageModel } from 'ai';

import { getEventSystem, EventCategory } from '../../../events';
/**
 * Extended stream options for AI SDK v5
 */
export type ExtendedStreamOptions = Parameters<typeof import('ai').streamText>[0];

// Re-export reasoning effort types and functions from LLM provider module
export type {
  ReasoningEffort,
} from '../../providers/llm';

export {
  determineReasoningEffort,
  applyReasoningOptions,
} from '../../providers/llm';

/**
 * Clean and compress message content to preserve tokens
 * 
 * Performs aggressive cleaning to compress conversation history:
 * - Removes repeating dots (ellipsis): "..", "...", "...." → ""
 * - Removes extra whitespace: multiple spaces/tabs/newlines → single space
 * - Removes trailing/leading whitespace
 * - Compresses content while preserving meaning
 * 
 * @param content - String content to clean
 * @returns Cleaned content
 */
function cleanMessageContent(content: string): string {
  let cleaned = content;
  
  // Remove repeating dots (ellipsis) - 2 or more consecutive dots
  cleaned = cleaned.replace(/\.{2,}/g, '');
  
  // Remove multiple consecutive punctuation marks (but keep single ones)
  // Examples: "???" → "?", "!!!" → "!", "---" → "-"
  cleaned = cleaned.replace(/([?!])\1{2,}/g, '$1'); // Multiple ? or !
  cleaned = cleaned.replace(/(-)\1{2,}/g, '$1'); // Multiple dashes
  
  // Remove extra whitespace: multiple spaces/tabs → single space
  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  
  // Remove multiple newlines → single newline (but preserve paragraph breaks)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // Remove newlines that are just whitespace (but keep intentional line breaks)
  cleaned = cleaned.replace(/[ \t]+\n/g, '\n');
  cleaned = cleaned.replace(/\n[ \t]+/g, '\n');
  
  // Remove spaces around punctuation (conservative - only obvious formatting issues)
  // Remove space before punctuation (common formatting issue: "word ," → "word,")
  cleaned = cleaned.replace(/ +([,.!?;:])/g, '$1');
  // Remove space after opening punctuation (common formatting issue: "( word" → "(word")
  cleaned = cleaned.replace(/([([{]) +/g, '$1');
  
  // Remove trailing/leading whitespace from each line
  cleaned = cleaned.split('\n').map(line => line.trim()).join('\n');
  
  // Remove trailing/leading whitespace from entire content
  cleaned = cleaned.trim();
  
  return cleaned;
}

/**
 * Clean and compress message content to preserve tokens
 * 
 * Removes unnecessary punctuation, extra whitespace, and compresses content
 * while preserving meaning. Applied to all messages before sending to LLM.
 * 
 * @param message - Message to clean
 * @returns Cleaned message with compressed content
 */
export function cleanEllipsisFromMessage(message: CoreMessage): CoreMessage {
  if (typeof message.content === 'string') {
    const cleanedContent = cleanMessageContent(message.content);
    return { ...message, content: cleanedContent };
  } else if (Array.isArray(message.content)) {
    // Handle array content (for complex messages with multiple parts)
    const cleanedContent = message.content.map((part: any) => {
      if (part.type === 'text' && typeof part.text === 'string') {
        return { ...part, text: cleanMessageContent(part.text) };
      }
      return part;
    });
    return { ...message, content: cleanedContent };
  }
  return message;
}

/**
 * Clean and compress all messages in the array to preserve tokens
 * 
 * Removes unnecessary punctuation, extra whitespace, and compresses content
 * from all messages before sending to LLM.
 * 
 * @param messages - Messages to clean
 * @returns Array of cleaned and compressed messages
 */
export function cleanEllipsisFromMessages(messages: CoreMessage[]): CoreMessage[] {
  return messages.map(msg => cleanEllipsisFromMessage(msg));
}

/**
 * Truncate conversation context using simple message-count strategy
 * 
 * This is a fallback truncation method when ContextTruncator is not available.
 * It preserves the system message and keeps the last N-1 messages.
 * 
 * @param messages - Full conversation history
 * @param maxMessages - Maximum number of messages to keep (default: 15)
 * @param logPrefix - Optional prefix for log messages
 * @returns Truncated messages
 * 
 * @example
 * ```typescript
 * const truncated = truncateContextSimple(messages, 10, '[CustomAgent]');
 * // Keeps system message + last 9 messages
 * ```
 */
export function truncateContextSimple(
  messages: CoreMessage[],
  maxMessages: number = 15,
  logPrefix: string = '[Agent]'
): CoreMessage[] {
  if (messages.length <= maxMessages) {
    return messages;
  }
  
  getEventSystem().info(EventCategory.LLM, `${logPrefix} Truncating context: ${messages.length} → ${maxMessages} messages`);
  
  // Keep system prompt + last N-1 messages
  const truncated = [
    messages[0], // System prompt
    ...messages.slice(-(maxMessages - 1)),
  ];
  
  // Repair orphaned tool-call/tool-result pairs that may have been split by truncation
  return repairToolPairsSimple(truncated, logPrefix);
}

/**
 * Repair orphaned tool-call/tool-result pairs after truncation
 * 
 * Removes any tool-call messages without matching tool-result messages (and vice versa)
 * to prevent LLM API errors like "Not the same number of function calls and responses".
 */
function repairToolPairsSimple(messages: CoreMessage[], logPrefix: string): CoreMessage[] {
  const toolCallIds = new Set<string>();
  const toolResultIds = new Set<string>();
  
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    if (msg.role === 'assistant') {
      for (const part of msg.content as any[]) {
        if (part.type === 'tool-call' && part.toolCallId) {
          toolCallIds.add(part.toolCallId);
        }
      }
    } else if (msg.role === 'tool') {
      for (const part of msg.content as any[]) {
        if (part.type === 'tool-result' && part.toolCallId) {
          toolResultIds.add(part.toolCallId);
        }
      }
    }
  }
  
  const orphanedCallIds = new Set<string>();
  for (const id of toolCallIds) {
    if (!toolResultIds.has(id)) orphanedCallIds.add(id);
  }
  const orphanedResultIds = new Set<string>();
  for (const id of toolResultIds) {
    if (!toolCallIds.has(id)) orphanedResultIds.add(id);
  }
  
  if (orphanedCallIds.size === 0 && orphanedResultIds.size === 0) {
    return messages;
  }
  
  getEventSystem().warn(EventCategory.LLM, `${logPrefix} ⚠️ Detected ${orphanedCallIds.size} orphaned tool-calls, ${orphanedResultIds.size} orphaned tool-results after truncation — removing`);
  
  return messages.filter(msg => {
    if (!Array.isArray(msg.content)) return true;
    
    if (msg.role === 'assistant') {
      const callParts = (msg.content as any[]).filter((p: any) => p.type === 'tool-call');
      if (callParts.length > 0 && callParts.every((p: any) => orphanedCallIds.has(p.toolCallId))) {
        return false;
      }
    }
    
    if (msg.role === 'tool') {
      const resultParts = (msg.content as any[]).filter((p: any) => p.type === 'tool-result');
      if (resultParts.length > 0 && resultParts.every((p: any) => orphanedResultIds.has(p.toolCallId))) {
        return false;
      }
    }
    
    return true;
  });
}

/**
 * Create a tool call repair handler for AI SDK
 * 
 * This creates an experimental_repairToolCall handler that uses structured outputs
 * to fix malformed tool calls. It attempts to repair tool calls that fail validation
 * by using generateObject to fix the inputs to match the schema.
 * 
 * @param model - Language model instance for repair generation
 * @param logPrefix - Optional prefix for log messages
 * @returns Tool call repair handler function
 * 
 * @example
 * ```typescript
 * const repairHandler = createToolCallRepairHandler(model, '[CustomAgent]');
 * streamOptions.experimental_repairToolCall = repairHandler;
 * ```
 */
export function createToolCallRepairHandler(
  model: LanguageModel,
  logPrefix: string = '[Agent]'
) {
  return async ({
    toolCall,
    tools,
    inputSchema,
    error,
  }: any) => {
    getEventSystem().info(EventCategory.LLM, `${logPrefix} Tool call repair triggered for: ${toolCall.toolName}`);
    
    if (NoSuchToolError.isInstance(error)) {
      getEventSystem().info(EventCategory.LLM, `${logPrefix} Invalid tool name, cannot repair: ${toolCall.toolName}`);
      return null;
    }
    
    try {
      const tool = tools[toolCall.toolName as keyof typeof tools];
      
      getEventSystem().info(EventCategory.LLM, `${logPrefix} Attempting to repair tool call with structured outputs`);
      
      // Use generateObject with the same model to repair the tool call
      const { object: repairedArgs } = await generateObject({
        model,
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
      
      getEventSystem().info(EventCategory.LLM, `${logPrefix} Tool call repaired successfully`);
      
      return { ...toolCall, input: JSON.stringify(repairedArgs) };
    } catch (repairError) {
      getEventSystem().error(EventCategory.LLM, `${logPrefix} Tool call repair failed: ${repairError}`);
      return null;
    }
  };
}

/**
 * Format API key for logging (shows first 8 and last 4 characters)
 * 
 * @param apiKey - API key to format
 * @returns Formatted key preview or 'MISSING'
 * 
 * @example
 * ```typescript
 * formatApiKeyPreview('sk-1234567890abcdef');
 * // Returns: 'sk-12345...cdef'
 * ```
 */
export function formatApiKeyPreview(apiKey?: string): string {
  if (!apiKey) {
    return 'MISSING';
  }
  
  if (apiKey.length <= 12) {
    return apiKey.substring(0, 8) + '...';
  }
  
  return `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`;
}

/**
 * Normalize tool name by stripping reasoning tokens and special markers
 * 
 * Reasoning models sometimes append special tokens to tool names like:
 * - `<|channel|>commentary`
 * - `<|thinking|>`
 * - `<|reasoning|>`
 * 
 * This function strips these tokens to get the actual tool name.
 * 
 * @param toolName - Raw tool name from LLM (may contain reasoning tokens)
 * @returns Normalized tool name
 * 
 * @example
 * ```typescript
 * normalizeToolName('navigate<|channel|>commentary');
 * // Returns: 'navigate'
 * 
 * normalizeToolName('addToCart<|thinking|>');
 * // Returns: 'addToCart'
 * ```
 */
export function normalizeToolName(toolName: string): string {
  if (!toolName) {
    return toolName;
  }
  
  // Strip common reasoning token patterns
  // Pattern: <|token|> or <|token|>suffix
  let normalized = toolName;
  
  // Remove reasoning tokens like <|channel|>commentary, <|thinking|>, etc.
  // Match: <|...|> followed by optional text
  normalized = normalized.replace(/<\|[^|]+\|>[^<]*/g, '');
  
  // Also handle cases where tokens might be at the start
  normalized = normalized.replace(/^<\|[^|]+\|>/g, '');
  
  // Trim any whitespace
  normalized = normalized.trim();
  
  // If normalization changed the name, log it
  if (normalized !== toolName) {
    getEventSystem().info(EventCategory.LLM, `🔧 [ToolNameNormalizer] Normalized tool name: "${toolName}" → "${normalized}"`);
  }
  
  return normalized;
}

/**
 * Token count information for a message
 */
export interface MessageTokenCount {
  /** Prompt/input tokens for this message */
  promptTokens: number;
  /** Completion/output tokens for this message (if applicable) */
  completionTokens?: number;
  /** Total tokens for this message */
  totalTokens: number;
}

/**
 * Count tokens for a CoreMessage
 * 
 * Uses estimation based on character count (fallback method).
 * Note: Vercel AI SDK's experimental_tokenizer is not available in Cloudflare Workers,
 * so we use a character-based estimation (approximately 4 characters per token).
 * 
 * For more accurate token counts, use the token counts stored in ConversationItem.tokens
 * which come from the LLM provider's usage response.
 * 
 * @param message - Message to count tokens for
 * @param model - Model identifier (for logging purposes)
 * @returns Token count for the message
 * 
 * @example
 * ```typescript
 * const count = await countMessageTokens(
 *   { role: 'user', content: 'Hello, world!' },
 *   'gpt-4'
 * );
 * // Returns: { promptTokens: 3, totalTokens: 3 }
 * ```
 */
export async function countMessageTokens(
  message: CoreMessage,
  model: string
): Promise<MessageTokenCount> {
  // Convert message content to string for tokenization
  let contentStr = '';
  
  if (typeof message.content === 'string') {
    contentStr = message.content;
  } else if (Array.isArray(message.content)) {
    // For structured content (tool calls, etc.), serialize to JSON
    contentStr = JSON.stringify(message.content);
  } else {
    contentStr = String(message.content);
  }
  
  // Add role prefix (most models include role in token count)
  // Approximate: role name + ": " = ~2 tokens
  const roleTokens = 2;
  const contentTokens = Math.ceil(contentStr.length / 4); // ~4 chars per token
  
  const totalTokens = roleTokens + contentTokens;
  
  return {
    promptTokens: totalTokens,
    totalTokens: totalTokens,
  };
}

/**
 * Count tokens for multiple messages
 * 
 * @param messages - Messages to count tokens for
 * @param model - Model identifier
 * @returns Map of message index to token count
 */
export async function countMessagesTokens(
  messages: CoreMessage[],
  model: string
): Promise<Map<number, MessageTokenCount>> {
  const tokenCounts = new Map<number, MessageTokenCount>();
  
  // Count tokens for each message
  for (let i = 0; i < messages.length; i++) {
    const count = await countMessageTokens(messages[i], model);
    tokenCounts.set(i, count);
  }
  
  return tokenCounts;
}