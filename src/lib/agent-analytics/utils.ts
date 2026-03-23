/**
 * Unified PostHog Tracking Utilities
 * 
 * Utility functions for formatting and processing data for PostHog events.
 * Replicates @posthog/ai patterns for compatibility.
 */

import type { CoreMessage } from 'ai';
import type {
  LanguageModelV2Content,
  LanguageModelV3Content,
  LanguageModelV2Prompt,
  LanguageModelV3Prompt,
} from '@ai-sdk/provider';

// Union types for dual version support
type LanguageModelContent = LanguageModelV2Content | LanguageModelV3Content;
type LanguageModelPrompt = LanguageModelV2Prompt | LanguageModelV3Prompt;
import type { PostHogInput, TokenUsage, ToolCall, Tool } from './types';
import { Buffer } from 'buffer';

// Limit large outputs by truncating to 200KB (approx 200k bytes)
export const MAX_OUTPUT_SIZE = 200000;
const STRING_FORMAT = 'utf8';

/**
 * Safely converts content to a string, preserving structure for objects/arrays.
 */
export function toContentString(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (content !== undefined && content !== null && typeof content === 'object') {
    try {
      return JSON.stringify(content);
    } catch {
      // Fallback for circular refs, BigInt, or objects with throwing toJSON
      return String(content);
    }
  }
  return String(content);
}

/**
 * Truncate content to prevent oversized PostHog events (200KB limit)
 * Replicates @posthog/ai's truncate() function
 */
export function truncate(input: unknown): string {
  const str = toContentString(input);
  if (str === '') {
    return '';
  }

  // Check if we need to truncate and ensure STRING_FORMAT is respected
  const encoder = new TextEncoder();
  const buffer = encoder.encode(str);
  if (buffer.length <= MAX_OUTPUT_SIZE) {
    return new TextDecoder().decode(buffer);
  }

  // Truncate the buffer and ensure a valid string is returned
  const truncatedBuffer = buffer.slice(0, MAX_OUTPUT_SIZE);
  const decoder = new TextDecoder(undefined, { fatal: false });
  let truncatedStr = decoder.decode(truncatedBuffer);
  if (truncatedStr.endsWith('\uFFFD')) {
    truncatedStr = truncatedStr.slice(0, -1);
  }
  return `${truncatedStr}... [truncated]`;
}

/**
 * Sanitize values for PostHog (ensure UTF-8 validity, handle circular refs)
 * Replicates @posthog/ai's sanitizeValues() function
 */
export function sanitizeValues(obj: any): any {
  if (obj === undefined || obj === null) {
    return obj;
  }
  const jsonSafe = JSON.parse(JSON.stringify(obj));
  if (typeof jsonSafe === 'string') {
    return Buffer.from(jsonSafe, STRING_FORMAT).toString(STRING_FORMAT);
  } else if (Array.isArray(jsonSafe)) {
    return jsonSafe.map(sanitizeValues);
  } else if (jsonSafe && typeof jsonSafe === 'object') {
    return Object.fromEntries(Object.entries(jsonSafe).map(([k, v]) => [k, sanitizeValues(v)]));
  }
  return jsonSafe;
}

/**
 * Format CoreMessage[] for PostHog (replicates @posthog/ai's mapVercelPrompt)
 */
export function formatMessagesForPostHog(messages: LanguageModelPrompt | CoreMessage[] | any): PostHogInput[] {
  const inputs: PostHogInput[] = messages.map((message: any) => {
    let content: any;

    // Handle system role which has string content
    if (message.role === 'system') {
      content = [
        {
          type: 'text',
          text: truncate(toContentString(message.content)),
        },
      ];
    } else {
      // Handle other roles which have array content
      if (Array.isArray(message.content)) {
        content = message.content.map((c: any) => {
          if (c.type === 'text') {
            return {
              type: 'text',
              text: truncate(c.text),
            };
          } else if (c.type === 'file') {
            // For file type, check if it's a data URL and redact if needed
            let fileData: string;
            const contentData: unknown = c.data;

            if (contentData instanceof URL) {
              fileData = contentData.toString();
            } else if (typeof contentData === 'string') {
              // Redact base64 data URLs to prevent oversized events
              fileData = redactBase64DataUrl(contentData);
            } else {
              fileData = 'raw files not supported';
            }

            return {
              type: 'file',
              file: fileData,
              mediaType: c.mediaType,
            };
          } else if (c.type === 'reasoning') {
            return {
              type: 'reasoning',
              text: truncate(c.reasoning),
            };
          } else if (c.type === 'tool-call') {
            return {
              type: 'tool-call',
              toolCallId: c.toolCallId,
              toolName: c.toolName,
              input: c.input,
            };
          } else if (c.type === 'tool-result') {
            return {
              type: 'tool-result',
              toolCallId: c.toolCallId,
              toolName: c.toolName,
              output: c.output,
              isError: c.isError,
            };
          }
          return {
            type: 'text',
            text: '',
          };
        });
      } else {
        // Fallback for non-array content
        content = [
          {
            type: 'text',
            text: truncate(toContentString(message.content)),
          },
        ];
      }
    }

    return {
      role: message.role,
      content,
    };
  });

  try {
    // Trim the inputs array until its JSON size fits within MAX_OUTPUT_SIZE
    let serialized = JSON.stringify(inputs);
    let removedCount = 0;
    const initialSize = inputs.length;
    for (let i = 0; i < initialSize && Buffer.byteLength(serialized, 'utf8') > MAX_OUTPUT_SIZE; i++) {
      inputs.shift();
      removedCount++;
      serialized = JSON.stringify(inputs);
    }
    if (removedCount > 0) {
      inputs.unshift({
        role: 'posthog',
        content: `[${removedCount} message${removedCount === 1 ? '' : 's'} removed due to size limit]`,
      });
    }
  } catch (error) {
    console.error('Error stringifying inputs', error);
    return [{ role: 'posthog', content: 'An error occurred while processing your request. Please try again.' }];
  }
  return inputs;
}

/**
 * Format output for PostHog (replicates @posthog/ai's mapVercelOutput)
 */
export function formatOutputForPostHog(result: LanguageModelContent[]): PostHogInput[] {
  type OutputContentItem =
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'tool-call'; id: string; function: { name: string; arguments: string } }
    | { type: 'file'; name: string; mediaType: string; data: string };

  const content: OutputContentItem[] = result.map((item) => {
    if (item.type === 'text') {
      return { type: 'text', text: truncate(item.text) };
    }
    if (item.type === 'tool-call') {
      return {
        type: 'tool-call',
        id: item.toolCallId,
        function: {
          name: item.toolName,
          arguments: (item as any).args || JSON.stringify((item as any).arguments || {}),
        },
      };
    }
    if (item.type === 'reasoning') {
      return { type: 'reasoning', text: truncate(item.text) };
    }
    if (item.type === 'file') {
      let fileData: string;
      if (item.data instanceof URL) {
        fileData = item.data.toString();
      } else if (typeof item.data === 'string') {
        fileData = redactBase64DataUrl(item.data);
        if (fileData === item.data && item.data.length > 1000) {
          fileData = `[${item.mediaType} file - ${item.data.length} bytes]`;
        }
      } else {
        fileData = `[binary ${item.mediaType} file]`;
      }

      return {
        type: 'file',
        name: 'generated_file',
        mediaType: item.mediaType,
        data: fileData,
      };
    }
    return { type: 'text', text: truncate(JSON.stringify(item)) };
  });

  if (content.length > 0) {
    return [
      {
        role: 'assistant',
        content: content.length === 1 && content[0].type === 'text' ? content[0].text : content,
      },
    ];
  }
  
  try {
    const jsonOutput = JSON.stringify(result);
    return [{ content: truncate(jsonOutput), role: 'assistant' }];
  } catch {
    console.error('Error stringifying output');
    return [];
  }
}

/**
 * Redact base64 data URLs to prevent oversized events
 */
function redactBase64DataUrl(data: string): string {
  if (data.startsWith('data:') && data.includes('base64,')) {
    return '[base64 data URL redacted]';
  }
  if (data.length > 10000 && /^[A-Za-z0-9+/=]+$/.test(data)) {
    // Likely base64 encoded data
    return '[base64 data redacted]';
  }
  return data;
}

/**
 * Extract usage from V2 or V3 format
 * Replicates @posthog/ai's extractTokenCount logic
 */
export function extractUsage(usage: any): TokenUsage {
  if (!usage) {
    return {};
  }

  const usageObj = usage as Record<string, unknown>;

  // Helper to extract numeric token value from V2 (number) or V3 (object with .total)
  const extractTokenCount = (value: unknown): number | undefined => {
    if (typeof value === 'number') {
      return value;
    }
    if (
      value &&
      typeof value === 'object' &&
      'total' in value &&
      typeof (value as { total: unknown }).total === 'number'
    ) {
      return (value as { total: number }).total;
    }
    return undefined;
  };

  // Helper to extract reasoning tokens
  const extractReasoningTokens = (usage: Record<string, unknown>): unknown => {
    if ('reasoningTokens' in usage) {
      return usage.reasoningTokens;
    }
    if (
      'outputTokens' in usage &&
      usage.outputTokens &&
      typeof usage.outputTokens === 'object' &&
      'reasoning' in usage.outputTokens
    ) {
      return (usage.outputTokens as { reasoning: unknown }).reasoning;
    }
    return undefined;
  };

  // Helper to extract cached input tokens
  const extractCacheReadTokens = (usage: Record<string, unknown>): unknown => {
    if ('cachedInputTokens' in usage) {
      return usage.cachedInputTokens;
    }
    if (
      'inputTokens' in usage &&
      usage.inputTokens &&
      typeof usage.inputTokens === 'object' &&
      'cacheRead' in usage.inputTokens
    ) {
      return (usage.inputTokens as { cacheRead: unknown }).cacheRead;
    }
    return undefined;
  };

  return {
    inputTokens: extractTokenCount(usage.inputTokens),
    outputTokens: extractTokenCount(usage.outputTokens),
    reasoningTokens: extractReasoningTokens(usageObj),
    cacheReadInputTokens: extractCacheReadTokens(usageObj),
    cacheCreationInputTokens: extractAdditionalTokenValues(usageObj).cacheCreationInputTokens,
    webSearchCount: extractWebSearchCount(usageObj, usage),
  };
}

/**
 * Extract additional token values from provider metadata
 */
function extractAdditionalTokenValues(providerMetadata: unknown): Record<string, any> {
  if (
    providerMetadata &&
    typeof providerMetadata === 'object' &&
    'anthropic' in providerMetadata &&
    providerMetadata.anthropic &&
    typeof providerMetadata.anthropic === 'object' &&
    'cacheCreationInputTokens' in providerMetadata.anthropic
  ) {
    return {
      cacheCreationInputTokens: providerMetadata.anthropic.cacheCreationInputTokens,
    };
  }
  return {};
}

/**
 * Calculate web search count from usage/metadata
 */
function extractWebSearchCount(usageObj: Record<string, unknown>, usage: any): number {
  // Check for Anthropic-specific extraction
  if (
    usageObj &&
    typeof usageObj === 'object' &&
    'anthropic' in usageObj &&
    usageObj.anthropic &&
    typeof usageObj.anthropic === 'object' &&
    'server_tool_use' in usageObj.anthropic
  ) {
    const serverToolUse = usageObj.anthropic.server_tool_use;
    if (
      serverToolUse &&
      typeof serverToolUse === 'object' &&
      'web_search_requests' in serverToolUse &&
      typeof serverToolUse.web_search_requests === 'number'
    ) {
      return serverToolUse.web_search_requests;
    }
  }

  // Fall back to binary detection
  if ('citations' in usageObj && Array.isArray(usageObj.citations) && usageObj.citations.length > 0) {
    return 1;
  }
  if ('search_results' in usageObj && Array.isArray(usageObj.search_results) && usageObj.search_results.length > 0) {
    return 1;
  }

  return 0;
}

/**
 * Extract tool calls from content
 */
export function extractToolCalls(content: LanguageModelContent[]): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  
  for (const item of content) {
    if (item.type === 'tool-call') {
      toolCalls.push({
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        input: (item as any).args || (item as any).arguments || {},
      });
    }
  }
  
  return toolCalls;
}

/**
 * Extract available tools from params
 */
export function extractAvailableTools(tools: any): Tool[] {
  if (!tools) {
    return [];
  }

  const toolArray: Tool[] = [];
  
  if (typeof tools === 'object') {
    for (const [name, tool] of Object.entries(tools)) {
      if (tool && typeof tool === 'object') {
        toolArray.push({
          name,
          description: (tool as any).description,
          parameters: (tool as any).parameters || {},
        });
      }
    }
  }
  
  return toolArray;
}

/**
 * Extract system prompt length from messages
 */
export function extractSystemPromptLength(prompt: LanguageModelPrompt): number {
  if (!Array.isArray(prompt)) {
    return 0;
  }
  
  const systemMessage = prompt.find((msg) => msg.role === 'system');
  if (!systemMessage) {
    return 0;
  }
  
  return toContentString(systemMessage.content).length;
}

/**
 * Extract HTTP status from error
 */
export function extractHttpStatus(error: unknown): number {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status;
    }
  }
  return 500;
}

/**
 * Map Vercel AI SDK params to PostHog format
 */
export function mapVercelParams(params: any): Record<string, any> {
  return {
    temperature: params.temperature,
    max_output_tokens: params.maxOutputTokens,
    top_p: params.topP,
    frequency_penalty: params.frequencyPenalty,
    presence_penalty: params.presencePenalty,
    stop: params.stopSequences,
    stream: params.stream,
  };
}
