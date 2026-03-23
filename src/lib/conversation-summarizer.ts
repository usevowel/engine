/**
 * Conversation Summarizer - Rolling Buffer Strategy
 * 
 * Manages long-running conversation context using hierarchical summarization:
 * 
 * 1. **Active Window** (default: 10 messages) - Recent messages kept in full
 * 2. **Summarization Buffer** (default: 5 messages) - Older messages waiting to be summarized
 * 3. **Summary Buffer** (default: 3 summaries) - Condensed history of older conversations
 * 
 * When the summarization buffer fills up, it triggers async summarization using
 * a fast LLM (default: Groq llama-3.3-70b-versatile with low reasoning).
 * 
 * The summary is then added to the summary buffer, which is prepended to the
 * active window when building context for the Agent.
 * 
 * @module conversation-summarizer
 */

import { generateText, CoreMessage } from 'ai';
import { getProvider, type SupportedProvider } from '../services/providers/llm';

import { getEventSystem, EventCategory } from '../events';
/**
 * Configuration for conversation summarization
 */
export interface SummarizationConfig {
  /** Enable summarization (default: false) */
  enabled: boolean;
  
  /** Number of recent messages to keep in full (default: 10) */
  activeWindowSize?: number;
  
  /** Number of messages to collect before summarizing (default: 5) */
  summarizationBufferSize?: number;
  
  /** Maximum number of summaries to keep (default: 3) */
  maxSummaries?: number;
  
  /** LLM provider for summarization (default: 'groq') */
  summarizationProvider?: SupportedProvider;
  
  /** Model for summarization (default: 'llama-3.3-70b-versatile') */
  summarizationModel?: string;
  
  /** API key for summarization provider */
  apiKey: string;
  
  /** OpenRouter specific config (if using OpenRouter) */
  openrouterSiteUrl?: string;
  openrouterAppName?: string;
}

/**
 * Summary entry in the summary buffer
 */
interface SummaryEntry {
  /** Condensed summary of messages */
  summary: string;
  
  /** Number of messages this summary represents */
  messageCount: number;
  
  /** Timestamp when summary was created */
  timestamp: number;
}

/**
 * State snapshot for debugging/monitoring
 */
export interface SummarizerState {
  activeWindowSize: number;
  summarizationBufferSize: number;
  summaryCount: number;
  totalMessagesSummarized: number;
  isProcessing: boolean;
}

/**
 * Conversation Summarizer with Rolling Buffer Strategy
 * 
 * Manages context for long-running voice sessions (hours of conversation)
 * by summarizing older messages asynchronously.
 * 
 * @example
 * ```typescript
 * const summarizer = new ConversationSummarizer({
 *   enabled: true,
 *   activeWindowSize: 10,
 *   summarizationBufferSize: 5,
 *   summarizationProvider: 'groq',
 *   summarizationModel: 'llama-3.3-70b-versatile',
 *   apiKey: process.env.GROQ_API_KEY!,
 * });
 * 
 * // Add messages as conversation progresses
 * summarizer.addMessage({ role: 'user', content: 'Hello' });
 * summarizer.addMessage({ role: 'assistant', content: 'Hi there!' });
 * 
 * // Get context for Agent (includes summaries + active window)
 * const context = summarizer.getContext();
 * ```
 */
export class ConversationSummarizer {
  private config: Required<Omit<SummarizationConfig, 'openrouterSiteUrl' | 'openrouterAppName'>> & {
    openrouterSiteUrl?: string;
    openrouterAppName?: string;
  };
  
  /** Recent messages (full content) */
  private activeWindow: CoreMessage[] = [];
  
  /** Older messages waiting to be summarized */
  private summarizationBuffer: CoreMessage[] = [];
  
  /** Condensed summaries of oldest messages */
  private summaryBuffer: SummaryEntry[] = [];
  
  /** Track if summarization is in progress */
  private isProcessing = false;
  
  /** Total messages summarized (for metrics) */
  private totalMessagesSummarized = 0;

  constructor(config: SummarizationConfig) {
    // Apply defaults
    this.config = {
      enabled: config.enabled,
      activeWindowSize: config.activeWindowSize ?? 10,
      summarizationBufferSize: config.summarizationBufferSize ?? 5,
      maxSummaries: config.maxSummaries ?? 3,
      summarizationProvider: config.summarizationProvider ?? 'groq',
      summarizationModel: config.summarizationModel ?? 'openai/gpt-oss-20b', // GPT-OSS 20B (Nov 2025, fast & modern)
      apiKey: config.apiKey,
      openrouterSiteUrl: config.openrouterSiteUrl,
      openrouterAppName: config.openrouterAppName,
    };

    getEventSystem().info(EventCategory.SYSTEM, '📚 [ConversationSummarizer] Initialized');
    getEventSystem().info(EventCategory.SYSTEM, `   Enabled: ${this.config.enabled}`);
    getEventSystem().info(EventCategory.SYSTEM, `   Active Window: ${this.config.activeWindowSize} messages`);
    getEventSystem().info(EventCategory.SYSTEM, `   Summarization Buffer: ${this.config.summarizationBufferSize} messages`);
    getEventSystem().info(EventCategory.SYSTEM, `   Max Summaries: ${this.config.maxSummaries}`);
    getEventSystem().info(EventCategory.PROVIDER, `   Provider: ${this.config.summarizationProvider}`);
    getEventSystem().info(EventCategory.SYSTEM, `   Model: ${this.config.summarizationModel}`);
  }

  /**
   * Add a new message to the conversation
   * 
   * Manages the rolling buffer strategy:
   * 1. Add to active window
   * 2. If active window exceeds limit, move oldest to summarization buffer
   * 3. If summarization buffer fills, trigger async summarization
   * 
   * @param message The message to add
   */
  public addMessage(message: CoreMessage): void {
    if (!this.config.enabled) {
      // If summarization disabled, just keep adding to active window
      this.activeWindow.push(message);
      return;
    }

    // Add to active window
    this.activeWindow.push(message);

    // Check if active window exceeds limit
    if (this.activeWindow.length > this.config.activeWindowSize) {
      // Move oldest message from active window to summarization buffer
      const oldestMessage = this.activeWindow.shift()!;
      this.summarizationBuffer.push(oldestMessage);

      getEventSystem().info(EventCategory.SYSTEM, `📤 [ConversationSummarizer] Moved message to summarization buffer`);
      getEventSystem().info(EventCategory.SYSTEM, `   Active Window: ${this.activeWindow.length}/${this.config.activeWindowSize}`);
      getEventSystem().info(EventCategory.SYSTEM, `   Summarization Buffer: ${this.summarizationBuffer.length}/${this.config.summarizationBufferSize}`);

      // Check if summarization buffer is full
      if (this.summarizationBuffer.length >= this.config.summarizationBufferSize) {
        getEventSystem().info(EventCategory.SYSTEM, `🔄 [ConversationSummarizer] Summarization buffer full, triggering summarization...`);
        this.triggerSummarization();
      }
    }
  }

  /**
   * Trigger async summarization of the summarization buffer
   * 
   * This is non-blocking - summarization happens in the background
   * while the conversation continues.
   */
  private triggerSummarization(): void {
    if (this.isProcessing) {
      getEventSystem().warn(EventCategory.SYSTEM, '⚠️ [ConversationSummarizer] Summarization already in progress, skipping...');
      return;
    }

    // Take snapshot of buffer (so we can clear it immediately)
    const messagesToSummarize = [...this.summarizationBuffer];
    this.summarizationBuffer = [];
    this.isProcessing = true;

    getEventSystem().info(EventCategory.SYSTEM, `🤖 [ConversationSummarizer] Starting async summarization of ${messagesToSummarize.length} messages...`);

    // Run summarization asynchronously (don't await)
    this.summarizeMessages(messagesToSummarize)
      .then((summary) => {
        // Add summary to summary buffer
        this.summaryBuffer.push({
          summary,
          messageCount: messagesToSummarize.length,
          timestamp: Date.now(),
        });

        this.totalMessagesSummarized += messagesToSummarize.length;

        // Trim summary buffer if needed
        if (this.summaryBuffer.length > this.config.maxSummaries) {
          const removed = this.summaryBuffer.shift()!;
          getEventSystem().info(EventCategory.SYSTEM, `🗑️ [ConversationSummarizer] Removed oldest summary (${removed.messageCount} messages)`);
        }

        getEventSystem().info(EventCategory.SYSTEM, `✅ [ConversationSummarizer] Summarization complete`);
        getEventSystem().info(EventCategory.SYSTEM, `   Summary Buffer: ${this.summaryBuffer.length}/${this.config.maxSummaries}`);
        getEventSystem().info(EventCategory.SYSTEM, `   Total Summarized: ${this.totalMessagesSummarized} messages`);

        this.isProcessing = false;
      })
      .catch((error) => {
        getEventSystem().error(EventCategory.SYSTEM, '❌ [ConversationSummarizer] Summarization failed:', error);
        
        // On error, put messages back in buffer (at the front)
        this.summarizationBuffer.unshift(...messagesToSummarize);
        getEventSystem().info(EventCategory.SYSTEM, `🔄 [ConversationSummarizer] Restored ${messagesToSummarize.length} messages to buffer`);
        
        this.isProcessing = false;
      });
  }

  /**
   * Summarize a batch of messages using the configured LLM
   * 
   * @param messages Messages to summarize
   * @returns Condensed summary
   */
  private async summarizeMessages(messages: CoreMessage[]): Promise<string> {
    const startTime = Date.now();

    try {
      // Get provider from registry
      const provider = getProvider(this.config.summarizationProvider, {
        apiKey: this.config.apiKey,
        openrouterSiteUrl: this.config.openrouterSiteUrl,
        openrouterAppName: this.config.openrouterAppName,
      });

      const model = provider(this.config.summarizationModel);

      // Format messages for summarization
      const conversationText = messages
        .map((m) => {
          const content = typeof m.content === 'string' ? m.content : '[complex content]';
          return `${m.role}: ${content}`;
        })
        .join('\n');

      // Generate summary with minimal reasoning effort
      const { text } = await generateText({
        model,
        prompt: `You are a conversation summarizer. Condense the following conversation into a brief, coherent summary that captures the key points, decisions, and context. Keep it concise (2-3 sentences max).

Conversation:
${conversationText}

Summary:`,
        temperature: 0.3,     // Low temperature for consistent summaries
        maxTokens: 150,       // Keep summaries short
        experimental_providerMetadata: {
          groq: {
            reasoning_effort: 'low', // Minimize reasoning tokens for speed
          },
          openrouter: {
            reasoning_effort: 'low', // Minimize reasoning tokens for speed
          },
          cerebras: {
            reasoning_effort: 'low', // Minimize reasoning tokens for speed
          },
        },
      });

      const duration = Date.now() - startTime;
      getEventSystem().info(EventCategory.PERFORMANCE, `⚡ [ConversationSummarizer] Summarized ${messages.length} messages in ${duration}ms`);

      return text.trim();
    } catch (error) {
      getEventSystem().error(EventCategory.SYSTEM, '❌ [ConversationSummarizer] Summarization error:', error);
      throw error;
    }
  }

  /**
   * Get the full context for the Agent
   * 
   * Returns: [system message, summary message (if any), ...active window]
   * 
   * @param systemMessage Optional system message to prepend
   * @returns Array of messages for Agent context
   */
  public getContext(systemMessage?: CoreMessage): CoreMessage[] {
    const context: CoreMessage[] = [];

    // 1. Add system message if provided
    if (systemMessage) {
      context.push(systemMessage);
    }

    // 2. Add summary message if we have summaries
    if (this.summaryBuffer.length > 0) {
      const summaryMessage = this.getSummaryMessage();
      context.push(summaryMessage);
    }

    // 3. Add active window (recent messages in full)
    context.push(...this.activeWindow);

    return context;
  }

  /**
   * Build a summary message from all summaries in the buffer
   * 
   * @returns CoreMessage containing all summaries
   */
  private getSummaryMessage(): CoreMessage {
    const summaryText = this.summaryBuffer
      .map((entry, index) => {
        return `[Summary ${index + 1} - ${entry.messageCount} messages]: ${entry.summary}`;
      })
      .join('\n\n');

    return {
      role: 'system',
      content: `Previous conversation summary (${this.totalMessagesSummarized} messages condensed):\n\n${summaryText}`,
    };
  }

  /**
   * Get current state for debugging/monitoring
   * 
   * @returns State snapshot
   */
  public getState(): SummarizerState {
    return {
      activeWindowSize: this.activeWindow.length,
      summarizationBufferSize: this.summarizationBuffer.length,
      summaryCount: this.summaryBuffer.length,
      totalMessagesSummarized: this.totalMessagesSummarized,
      isProcessing: this.isProcessing,
    };
  }

  /**
   * Clear all buffers (useful for testing or resetting conversation)
   */
  public clear(): void {
    this.activeWindow = [];
    this.summarizationBuffer = [];
    this.summaryBuffer = [];
    this.totalMessagesSummarized = 0;
    getEventSystem().info(EventCategory.SYSTEM, '🧹 [ConversationSummarizer] Cleared all buffers');
  }

  /**
   * Get total message count across all buffers
   */
  public getTotalMessageCount(): number {
    return this.activeWindow.length + this.summarizationBuffer.length + this.totalMessagesSummarized;
  }
}

