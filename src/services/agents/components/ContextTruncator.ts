/**
 * ContextTruncator - Manages conversation context to fit within LLM limits
 * 
 * This component provides multiple strategies for truncating conversation history
 * to fit within token/message limits while preserving important context.
 * 
 * Strategies:
 * 1. **message-count**: Simple - keep last N messages
 * 2. **token-count**: Accurate - keep within token limit
 * 3. **sliding-window**: Smart - keep recent + important messages
 * 4. **summarization**: Advanced - use ConversationSummarizer (async LLM-based)
 * 
 * The summarization strategy restores the sophisticated ConversationSummarizer
 * from the previous implementation (usage-optimization branch), which handles
 * very long conversations (hours) much better than simple truncation.
 * 
 * @module ContextTruncator
 */

import { CoreMessage } from 'ai';
import { ConversationSummarizer } from './ConversationSummarizer';
import { MessageTokenCount } from '../utils/agentUtils';

import { getEventSystem, EventCategory } from '../../../events';
/**
 * Configuration for ContextTruncator
 */
export interface ContextTruncatorConfig {
  /** Truncation strategy */
  strategy: 'message-count' | 'token-count' | 'sliding-window' | 'summarization';
  
  /** Maximum number of messages to keep (for message-count strategy) */
  maxMessages?: number;
  
  /** Maximum number of tokens to keep (for token-count strategy) */
  maxTokens?: number;
  
  /** Summarization configuration (for summarization strategy) */
  summarizationConfig?: {
    /** API key for summarization LLM */
    apiKey: string;
    
    /** Number of recent messages to keep in full (default: 10) */
    activeWindowSize?: number;
    
    /** Number of messages to collect before summarizing (default: 5) */
    summarizationBufferSize?: number;
    
    /** Maximum number of summaries to keep (default: 3) */
    maxSummaries?: number;
    
    /** LLM provider for summarization (default: 'groq') */
    summarizationProvider?: string;
    
    /** Model for summarization (default: 'openai/gpt-oss-20b') */
    summarizationModel?: string;
    
    /** OpenRouter specific config (if using OpenRouter) */
    openrouterSiteUrl?: string;
    openrouterAppName?: string;
  };
}

/**
 * ContextTruncator - Manages conversation context
 * 
 * Provides multiple strategies for truncating conversation history to fit
 * within LLM limits while preserving important context.
 * 
 * @example
 * ```typescript
 * // Simple message-count strategy
 * const truncator1 = new ContextTruncator({
 *   strategy: 'message-count',
 *   maxMessages: 15,
 * });
 * 
 * const truncated1 = truncator1.truncate(messages);
 * 
 * // Advanced summarization strategy
 * const truncator2 = new ContextTruncator({
 *   strategy: 'summarization',
 *   summarizationConfig: {
 *     apiKey: 'gsk_...',
 *     activeWindowSize: 10,
 *     summarizationBufferSize: 5,
 *     maxSummaries: 3,
 *   },
 * });
 * 
 * // Add messages as conversation progresses
 * for (const msg of messages) {
 *   truncator2.addMessage(msg);
 * }
 * 
 * // Get context (includes summaries + active window)
 * const context = truncator2.getContext();
 * ```
 */
export class ContextTruncator {
  private config: ContextTruncatorConfig;
  private conversationSummarizer?: ConversationSummarizer;
  
  constructor(config: ContextTruncatorConfig) {
    this.config = config;
    
    getEventSystem().info(EventCategory.LLM, `📚 [ContextTruncator] Initialized with strategy: ${config.strategy}`);
    
    // Validate configuration
    this.validateConfig();
    
    // Initialize ConversationSummarizer if using summarization strategy
    if (this.config.strategy === 'summarization' && this.config.summarizationConfig) {
      this.conversationSummarizer = new ConversationSummarizer({
        enabled: true,
        activeWindowSize: this.config.summarizationConfig.activeWindowSize,
        summarizationBufferSize: this.config.summarizationConfig.summarizationBufferSize,
        maxSummaries: this.config.summarizationConfig.maxSummaries,
        summarizationProvider: this.config.summarizationConfig.summarizationProvider,
        summarizationModel: this.config.summarizationConfig.summarizationModel,
        apiKey: this.config.summarizationConfig.apiKey,
        openrouterSiteUrl: this.config.summarizationConfig.openrouterSiteUrl,
        openrouterAppName: this.config.summarizationConfig.openrouterAppName,
      });
    }
  }
  
  /**
   * Validate configuration
   */
  private validateConfig(): void {
    if (this.config.strategy === 'message-count' && !this.config.maxMessages) {
      throw new Error('maxMessages is required for message-count strategy');
    }
    
    if (this.config.strategy === 'token-count' && !this.config.maxTokens) {
      throw new Error('maxTokens is required for token-count strategy');
    }
    
    if (this.config.strategy === 'summarization' && !this.config.summarizationConfig) {
      throw new Error('summarizationConfig is required for summarization strategy');
    }
    
    if (this.config.strategy === 'summarization' && !this.config.summarizationConfig?.apiKey) {
      throw new Error('summarizationConfig.apiKey is required for summarization strategy');
    }
  }
  
  /**
   * Truncate conversation history to fit within limits
   * 
   * This method is used for simple strategies (message-count, token-count, sliding-window).
   * For summarization strategy, use addMessage() and getContext() instead.
   * 
   * @param messages - Full conversation history
   * @param tokenCounts - Optional map of message index to token counts (for accurate token-count strategy)
   * @returns Truncated messages
   */
  truncate(messages: CoreMessage[], tokenCounts?: Map<number, MessageTokenCount>): CoreMessage[] {
    switch (this.config.strategy) {
      case 'message-count':
        return this.truncateByMessageCount(messages);
      
      case 'token-count':
        return this.truncateByTokenCount(messages, tokenCounts);
      
      case 'sliding-window':
        return this.truncateWithSlidingWindow(messages);
      
      case 'summarization':
        throw new Error('For summarization strategy, use addMessage() and getContext() instead of truncate()');
      
      default:
        throw new Error(`Unsupported strategy: ${this.config.strategy}`);
    }
  }
  
  /**
   * Truncate by message count - keep last N messages
   * 
   * Simple strategy that keeps the system prompt and the last N-1 messages.
   * 
   * @param messages - Full conversation history
   * @returns Truncated messages
   */
  private truncateByMessageCount(messages: CoreMessage[]): CoreMessage[] {
    const maxMessages = this.config.maxMessages!;
    
    if (messages.length <= maxMessages) {
      return messages;
    }
    
    getEventSystem().info(EventCategory.LLM, `🔄 [ContextTruncator] Message-count truncation: ${messages.length} → ${maxMessages} messages`);
    
    // Keep system prompt + last N-1 messages
    return this.repairToolPairs([
      messages[0], // System prompt (always keep)
      ...messages.slice(-(maxMessages - 1)),
    ]);
  }
  
  /**
   * Truncate by token count - keep within token limit
   * 
   * Uses actual token counts from Vercel AI SDK when available, falls back to estimation.
   * Ensures minimum token count is preserved (6,000 tokens minimum by default).
   * 
   * @param messages - Full conversation history
   * @param tokenCounts - Optional map of message index to token counts (from experimental_tokenizer)
   * @returns Truncated messages
   */
  private truncateByTokenCount(messages: CoreMessage[], tokenCounts?: Map<number, MessageTokenCount>): CoreMessage[] {
    const maxTokens = this.config.maxTokens!;
    const minTokens = 6000; // Minimum tokens to preserve (ensures meaningful context)
    
    // Helper to get token count for a message
    const getMessageTokens = (index: number, msg: CoreMessage): number => {
      if (tokenCounts && tokenCounts.has(index)) {
        // Use actual token count if available
        return tokenCounts.get(index)!.totalTokens;
      }
      
      // Fallback to estimation
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return Math.ceil(content.length / 4);
    };
    
    let totalTokens = 0;
    const truncatedMessages: CoreMessage[] = [];
    
    // Always keep system prompt
    if (messages.length > 0) {
      truncatedMessages.push(messages[0]);
      totalTokens += getMessageTokens(0, messages[0]);
    }
    
    // Add messages from the end until we hit the token limit
    // We work backwards to keep the most recent messages
    for (let i = messages.length - 1; i >= 1; i--) {
      const msgTokens = getMessageTokens(i, messages[i]);
      
      // Check if adding this message would exceed max tokens
      if (totalTokens + msgTokens > maxTokens) {
        // If we're below minimum, try to include at least one more message
        // This ensures we always have meaningful context
        if (totalTokens < minTokens && i > 1) {
          // Try to include this message even if it slightly exceeds maxTokens
          // This is a trade-off to ensure minimum context
          truncatedMessages.unshift(messages[i]);
          totalTokens += msgTokens;
          getEventSystem().warn(EventCategory.LLM, `⚠️ [ContextTruncator] Exceeded max tokens (${totalTokens} > ${maxTokens}) to preserve minimum context (${minTokens} tokens)`);
        }
        break;
      }
      
      truncatedMessages.unshift(messages[i]);
      totalTokens += msgTokens;
    }
    
    // Verify minimum token count
    if (totalTokens < minTokens && messages.length > truncatedMessages.length) {
      getEventSystem().warn(EventCategory.LLM, `⚠️ [ContextTruncator] Truncated context below minimum (${totalTokens} < ${minTokens} tokens)`);
    }
    
    getEventSystem().info(EventCategory.LLM, `🔄 [ContextTruncator] Token-count truncation: ${messages.length} → ${truncatedMessages.length} messages (${totalTokens} tokens, max: ${maxTokens}, min: ${minTokens})`);
    
    return this.repairToolPairs(truncatedMessages);
  }
  
  /**
   * Truncate with sliding window - keep recent + important messages
   * 
   * Smart strategy that keeps:
   * - System prompt (always)
   * - Recent messages (last N)
   * - Important messages (tool calls/results, errors)
   * 
   * @param messages - Full conversation history
   * @returns Truncated messages
   */
  private truncateWithSlidingWindow(messages: CoreMessage[]): CoreMessage[] {
    const maxMessages = this.config.maxMessages || 15;
    
    if (messages.length <= maxMessages) {
      return messages;
    }
    
    getEventSystem().info(EventCategory.LLM, `🔄 [ContextTruncator] Sliding-window truncation: ${messages.length} → ${maxMessages} messages`);
    
    // Keep system prompt
    const systemPrompt = messages[0];
    const restMessages = messages.slice(1);
    
    // Keep last N-1 messages (recent context)
    const recentCount = Math.floor((maxMessages - 1) * 0.7); // 70% for recent
    const recentMessages = restMessages.slice(-recentCount);
    
    // Keep important messages from the rest
    const importantCount = (maxMessages - 1) - recentCount;
    const olderMessages = restMessages.slice(0, -recentCount);
    
    // Filter for important messages (tool calls, tool results)
    const importantMessages = olderMessages
      .filter(msg => {
        // Keep tool-related messages
        if (msg.role === 'tool') return true;
        if (Array.isArray(msg.content)) {
          return msg.content.some((c: any) => 
            c.type === 'tool-call' || c.type === 'tool-result'
          );
        }
        return false;
      })
      .slice(-importantCount);
    
    // Combine: system + important + recent
    const result = [systemPrompt, ...importantMessages, ...recentMessages];
    
    getEventSystem().info(EventCategory.LLM, `   Recent: ${recentMessages.length}, Important: ${importantMessages.length}`);
    
    return this.repairToolPairs(result);
  }
  
  private repairToolPairs(messages: CoreMessage[]): CoreMessage[] {
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

    const repaired = messages.filter(msg => {
      if (!Array.isArray(msg.content)) return true;

      if (msg.role === 'assistant') {
        const callParts = (msg.content as any[]).filter((p: any) => p.type === 'tool-call');
        if (callParts.length === 0) return true;
        const allOrphaned = callParts.every((p: any) => orphanedCallIds.has(p.toolCallId));
        if (allOrphaned) {
          for (const p of callParts) {
            getEventSystem().warn(EventCategory.LLM, `⚠️ [ContextTruncator] Removing orphaned tool-call: ${p.toolName || 'unknown'} (id: ${p.toolCallId})`);
          }
          return false;
        }
      }

      if (msg.role === 'tool') {
        const resultParts = (msg.content as any[]).filter((p: any) => p.type === 'tool-result');
        if (resultParts.length === 0) return true;
        const allOrphaned = resultParts.every((p: any) => orphanedResultIds.has(p.toolCallId));
        if (allOrphaned) {
          for (const p of resultParts) {
            getEventSystem().warn(EventCategory.LLM, `⚠️ [ContextTruncator] Removing orphaned tool-result: ${p.toolName || 'unknown'} (id: ${p.toolCallId})`);
          }
          return false;
        }
      }

      return true;
    });

    getEventSystem().info(EventCategory.LLM, `🔧 [ContextTruncator] Repaired tool pairs: removed ${messages.length - repaired.length} orphaned message(s)`);
    return repaired;
  }

  /**
   * Add a message to the conversation (for summarization strategy)
   * 
   * This method is used with the summarization strategy to add messages
   * incrementally as the conversation progresses.
   * 
   * @param message - Message to add
   */
  addMessage(message: CoreMessage): void {
    if (this.config.strategy !== 'summarization') {
      throw new Error('addMessage() is only supported for summarization strategy');
    }
    
    if (!this.conversationSummarizer) {
      throw new Error('ConversationSummarizer not initialized');
    }
    
    this.conversationSummarizer.addMessage(message);
  }
  
  /**
   * Get the current context (for summarization strategy)
   * 
   * Returns the context including summaries and active window.
   * 
   * @param systemMessage - Optional system message to prepend
   * @returns Context messages
   */
  getContext(systemMessage?: CoreMessage): CoreMessage[] {
    if (this.config.strategy !== 'summarization') {
      throw new Error('getContext() is only supported for summarization strategy');
    }
    
    if (!this.conversationSummarizer) {
      throw new Error('ConversationSummarizer not initialized');
    }
    
    return this.conversationSummarizer.getContext(systemMessage);
  }
  
  /**
   * Cleanup resources (called on disconnect)
   */
  async cleanup(): Promise<void> {
    getEventSystem().info(EventCategory.LLM, '🧹 [ContextTruncator] Cleanup called');
    
    // Cleanup ConversationSummarizer if present
    if (this.conversationSummarizer) {
      this.conversationSummarizer.clear();
    }
  }
}

