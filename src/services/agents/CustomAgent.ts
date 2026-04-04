/**
 * CustomAgent - Manual LLM agent with full control
 * 
 * This implementation provides manual control over the LLM execution flow,
 * similar to the previous implementation before the Vercel AI SDK Agent migration.
 * 
 * Features:
 * - Manual conversation history management
 * - Pluggable context truncation strategies (via ContextTruncator)
 * - Pluggable tool orchestration (via ToolOrchestrator)
 * - Full visibility into execution flow
 * - Easy to debug and customize
 * 
 * This agent is ideal for:
 * - Experimentation with different approaches
 * - Debugging complex issues
 * - Custom behavior that doesn't fit Vercel SDK's model
 * - Very long conversations (with ConversationSummarizer)
 * 
 * @module CustomAgent
 */

import { CoreMessage, streamText, stepCountIs, experimental_tokenizer } from 'ai';
import { ILLMAgent, AgentConfig, AgentStreamOptions, AgentStreamPart, AgentMetadata, SystemPromptContext } from './ILLMAgent';
import { getProvider } from '../providers/llm';
import { convertSessionToolsToProxyTools } from '../../lib/client-tool-proxy';
import { ContextTruncator, ContextTruncatorConfig } from './components/ContextTruncator';
import { ToolOrchestrator } from './components/ToolOrchestrator';
import {
  determineReasoningEffort,
  applyReasoningOptions,
  truncateContextSimple,
  createToolCallRepairHandler,
  formatApiKeyPreview,
  normalizeToolName,
  cleanEllipsisFromMessages,
  type ExtendedStreamOptions,
  type MessageTokenCount,
} from './utils';

import { getEventSystem, EventCategory } from '../../events';
import { getServiceForTrace } from '../../lib/agent-analytics';
import { wrapModelWithAnalytics } from '../../lib/agent-analytics';
/**
 * CustomAgent - Manual LLM agent with full control
 * 
 * Provides manual control over conversation management and tool execution.
 * Uses pluggable components (ContextTruncator, ToolOrchestrator) for
 * flexibility and reusability.
 * 
 * @example
 * ```typescript
 * const agent = new CustomAgent({
 *   provider: 'groq',
 *   apiKey: 'gsk_...',
 *   model: 'moonshotai/kimi-k2-instruct-0905',
 *   systemPrompt: 'You are a helpful assistant',
 *   maxSteps: 3,
 *   maxContextMessages: 15,
 *   contextStrategy: 'message-count',
 * });
 * 
 * const stream = await agent.stream({
 *   messages: conversationHistory,
 *   sessionTools: tools,
 * });
 * 
 * for await (const part of stream) {
 *   if (part.type === 'text-delta') {
 *     getEventSystem().info(EventCategory.LLM, part.text);
 *   }
 * }
 * ```
 */
export class CustomAgent implements ILLMAgent {
  private config: AgentConfig;
  private conversationHistory: CoreMessage[] = [];
  private contextTruncator?: ContextTruncator;
  private toolOrchestrator: ToolOrchestrator;
  /** Map of message index to token counts (for accurate context truncation) */
  private messageTokenCounts: Map<number, MessageTokenCount> = new Map();
  
  constructor(config: AgentConfig) {
    this.config = config;
    
    getEventSystem().info(EventCategory.LLM, '🎯 [CustomAgent] Initializing custom agent');
    getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] Provider: ${config.provider}, Model: ${config.model}`);
    
    const maxContextTokens = config.maxContextTokens ?? 72000;
    const minContextTokens = config.minContextTokens ?? 32000;
    
    // Ensure minimum is not greater than maximum
    const effectiveMaxTokens = Math.max(maxContextTokens, minContextTokens);
    const effectiveMinTokens = Math.min(minContextTokens, maxContextTokens);
    
    getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] Context: Token-based (max: ${effectiveMaxTokens}, min: ${effectiveMinTokens})`);
    
    // Initialize ContextTruncator with token-count strategy by default
    const contextStrategy = config.contextStrategy || 'token-count';
    
    if (contextStrategy === 'summarization' && config.summarizationConfig) {
      // Use ContextTruncator with summarization strategy
      this.contextTruncator = new ContextTruncator({
        strategy: 'summarization',
        summarizationConfig: {
          ...config.summarizationConfig,
          apiKey: config.apiKey, // Required for summarization LLM calls
          openrouterSiteUrl: config.openrouterSiteUrl,
          openrouterAppName: config.openrouterAppName,
        },
      });
    } else if (contextStrategy === 'token-count') {
      // Use ContextTruncator with token-count strategy (default)
      this.contextTruncator = new ContextTruncator({
        strategy: 'token-count',
        maxTokens: effectiveMaxTokens,
      });
    } else if (contextStrategy !== 'message-count') {
      // Use ContextTruncator for other strategies
      this.contextTruncator = new ContextTruncator({
        strategy: contextStrategy,
        maxMessages: config.maxContextMessages,
        maxTokens: config.maxContextMessages ? config.maxContextMessages * 100 : undefined, // Rough estimate
      });
    }
    // For message-count strategy (legacy), we'll use the simple truncation method
    
    // Initialize ToolOrchestrator
    this.toolOrchestrator = new ToolOrchestrator({
      maxSteps: config.maxSteps || 5,
      enableRepetitionDetection: true,
      repetitionWindowSize: 3,
    });
    
    getEventSystem().info(EventCategory.LLM, '✅ [CustomAgent] Custom agent initialized successfully');
  }
  
  /**
   * Stream a response with manual conversation management
   * 
   * This method provides full control over the LLM execution flow:
   * 1. Add user message to conversation history
   * 2. Apply context truncation (via ContextTruncator in Layer 3)
   * 3. Stream LLM response
   * 4. Handle tool calls (via ToolOrchestrator in Layer 4)
   * 5. Repeat until done or max steps reached
   * 
   * @param options - Stream options (messages, tools, temperature, etc.)
   * @returns AsyncIterable of stream parts
   */
  async stream(options: AgentStreamOptions): Promise<AsyncIterable<AgentStreamPart>> {
    getEventSystem().info(EventCategory.LLM, '🎯 [CustomAgent] Streaming response');
    
    const {
      messages,
      prompt,
      sessionTools = [],
      temperature,
      maxTokens,
      frequencyPenalty,
      presencePenalty,
      repetitionPenalty,
      systemPrompt: systemPromptOverride,
      serverToolContext,
    } = options;
    
    // Validate input
    if (!prompt && !messages) {
      throw new Error('Either prompt or messages must be provided');
    }
    if (prompt && messages) {
      throw new Error('Cannot provide both prompt and messages');
    }
    
    // Generate system prompt dynamically on each call
    // Priority: override > config function > config string
    let baseSystemPrompt: string;
    
    if (systemPromptOverride) {
      // Use override (can be string or function)
      if (typeof systemPromptOverride === 'function') {
        baseSystemPrompt = systemPromptOverride(options.systemPromptContext);
      } else {
        baseSystemPrompt = systemPromptOverride;
      }
      getEventSystem().info(EventCategory.LLM, '🎯 [CustomAgent] Using system prompt override');
    } else if (typeof this.config.systemPrompt === 'function') {
      // Call the system prompt generator function with context
      const context = options.systemPromptContext || {};
      baseSystemPrompt = this.config.systemPrompt(context);
      getEventSystem().info(EventCategory.LLM, '🎯 [CustomAgent] Generated system prompt from function', {
        targetLanguage: context.targetLanguage || 'not specified',
        hasUserInstructions: !!context.userInstructions,
      });
    } else {
      // Use static system prompt from config
      baseSystemPrompt = this.config.systemPrompt;
    }
    
    // Build deterministic tool instructions to inject into system prompt
    const toolInstructions = sessionTools.length > 0 ? this.buildToolInstructions(sessionTools) : '';
    console.log(
      `[DEBUG] Tool Instructions Tools: ${sessionTools.length}`
    )
    const systemPromptWithTools = toolInstructions
      ? `${baseSystemPrompt}\n\n[TOOL DEFINITIONS]\n${toolInstructions}\n\nCALL TOOLS EXACTLY USING THE LISTED ARGUMENT NAMES AND TYPES. DO NOT INVENT FIELDS.`
      : baseSystemPrompt;
    
    // const systemPromptWithTools = baseSystemPrompt;

    // Build conversation history
    let conversationMessages: CoreMessage[];
    
    if (prompt) {
      // Simple prompt - create single user message
      conversationMessages = [
        { role: 'system', content: systemPromptWithTools },
        { role: 'user', content: prompt },
      ];
    } else {
      // Full conversation history provided
      conversationMessages = [
        { role: 'system', content: systemPromptWithTools },
        ...(messages || []),
      ];
    }
    
    // Use stored token counts from ConversationItem if available
    // These are actual token counts from previous LLM responses (more accurate than estimation)
    // Always initialize as empty Map to avoid undefined errors
    let messageTokenCounts: Map<number, MessageTokenCount> = new Map();
    
    // Check if token counts were provided from conversation history
    if (this.messageTokenCounts && this.messageTokenCounts.size > 0) {
      getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] Using stored token counts from conversation history (${this.messageTokenCounts.size} messages)`);
      // Convert stored token counts to MessageTokenCount format
      for (const [index, count] of this.messageTokenCounts.entries()) {
        messageTokenCounts.set(index, {
          promptTokens: count.promptTokens,
          completionTokens: count.completionTokens,
          totalTokens: count.totalTokens,
        });
      }
      
      // Calculate total tokens from stored counts
      let totalTokens = 0;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      for (const count of messageTokenCounts.values()) {
        totalTokens += count.totalTokens;
        totalPromptTokens += count.promptTokens;
        totalCompletionTokens += count.completionTokens || 0;
      }
      getEventSystem().info(EventCategory.LLM, `📊 [Token Tracking] Conversation context: ${conversationMessages.length} messages`);
      getEventSystem().info(EventCategory.LLM, `📊 [Token Tracking] Stored tokens - Prompt: ${totalPromptTokens}, Completion: ${totalCompletionTokens}, Total: ${totalTokens}`);
    } else {
      // No stored token counts available - we'll use empty map
      // Actual token counts will come from the streamText result.totalUsage
      getEventSystem().info(EventCategory.LLM, `📊 [Token Tracking] Conversation context: ${conversationMessages.length} messages (no stored token counts, will track from stream)`);
    }
    
    // Log system prompt segments for verification
    getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] ===== SYSTEM PROMPT SEGMENTS =====`);
    
    const systemPrompt = systemPromptWithTools;
    
    // Check if using structured format (with XML-like tags)
    const hasStructuredFormat = systemPrompt.includes('<SYSTEM_PRIORITY>') || systemPrompt.includes('<USER_INSTRUCTIONS>');
    
    if (hasStructuredFormat) {
      // Parse structured format
      const priorityMatch = systemPrompt.match(/<SYSTEM_PRIORITY>([\s\S]*?)<\/SYSTEM_PRIORITY>/);
      const userInstructionsMatch = systemPrompt.match(/<USER_INSTRUCTIONS>([\s\S]*?)<\/USER_INSTRUCTIONS>/);
      
      if (priorityMatch) {
        const priorityLines = priorityMatch[1].trim().split('\n');
        const first20Priority = priorityLines.slice(0, 20).join('\n');
        getEventSystem().info(EventCategory.LLM, `📋 [SYSTEM_PRIORITY] (first 20 lines):\n${first20Priority}${priorityLines.length > 20 ? `\n... (${priorityLines.length - 20} more lines)` : ''}`);
      }
      
      if (userInstructionsMatch) {
        const userLines = userInstructionsMatch[1].trim().split('\n');
        const first20User = userLines.slice(0, 20).join('\n');
        getEventSystem().info(EventCategory.LLM, `📋 [USER_INSTRUCTIONS] (first 20 lines):\n${first20User}${userLines.length > 20 ? `\n... (${userLines.length - 20} more lines)` : ''}`);
      }
      
      // Also log the final instructions section (after USER_INSTRUCTIONS)
      const afterUserInstructions = systemPrompt.split('</USER_INSTRUCTIONS>')[1];
      if (afterUserInstructions && afterUserInstructions.trim()) {
        const finalLines = afterUserInstructions.trim().split('\n');
        const first10Final = finalLines.slice(0, 10).join('\n');
        getEventSystem().info(EventCategory.LLM, `📋 [FINAL_INSTRUCTIONS] (first 10 lines):\n${first10Final}${finalLines.length > 10 ? `\n... (${finalLines.length - 10} more lines)` : ''}`);
      }
    } else {
      // Raw format - just log first 20 lines
      getEventSystem().info(EventCategory.LLM, `📋 [RAW_SYSTEM_PROMPT] (unstructured format)`);
      const promptLines = systemPrompt.split('\n');
      const first20Lines = promptLines.slice(0, 20).join('\n');
      getEventSystem().info(EventCategory.LLM, `${first20Lines}${promptLines.length > 20 ? `\n... (${promptLines.length - 20} more lines)` : ''}`);
    }
    
    getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] ===== END SYSTEM PROMPT =====`);
    
    // Apply context truncation with actual token counts
    let truncatedMessages = this.truncateContext(conversationMessages, messageTokenCounts);
    
    // Clean ellipsis (repeating dots) from message content
    truncatedMessages = cleanEllipsisFromMessages(truncatedMessages);
    
    // Calculate tokens after truncation
    let truncatedTokens = 0;
    for (let i = 0; i < truncatedMessages.length; i++) {
      const originalIndex = conversationMessages.indexOf(truncatedMessages[i]);
      if (originalIndex >= 0 && messageTokenCounts.has(originalIndex)) {
        truncatedTokens += messageTokenCounts.get(originalIndex)!.totalTokens;
      } else {
        // Fallback estimation for messages not in original array
        truncatedTokens += this.estimateTotalTokens([truncatedMessages[i]]);
      }
    }
    
    getEventSystem().info(EventCategory.LLM, `📊 [Token Tracking] After truncation: ${truncatedMessages.length} messages, ${truncatedTokens} tokens (max: ${this.config.maxContextTokens ?? 72000}, min: ${this.config.minContextTokens ?? 6000})`);
    
    // Get agent analytics service if trace ID is available
    const traceId = options.traceId;
    const analyticsService = traceId ? getServiceForTrace(traceId) : undefined;
    
    // Track context truncation with actual token counts
    if (analyticsService) {
      let beforeTokens = 0;
      for (const count of messageTokenCounts.values()) {
        beforeTokens += count.totalTokens;
      }
      
      let afterTokens = 0;
      for (let i = 0; i < truncatedMessages.length; i++) {
        const originalIndex = conversationMessages.indexOf(truncatedMessages[i]);
        if (originalIndex >= 0 && messageTokenCounts.has(originalIndex)) {
          afterTokens += messageTokenCounts.get(originalIndex)!.totalTokens;
        } else {
          afterTokens += this.estimateTotalTokens([truncatedMessages[i]]);
        }
      }
      
      analyticsService.trackContextTruncation({
        beforeMessages: conversationMessages.length,
        afterMessages: truncatedMessages.length,
        strategy: this.config.contextStrategy || 'token-count',
        messagesRemoved: conversationMessages.length - truncatedMessages.length,
        beforeTokens,
        afterTokens,
        tokensRemoved: beforeTokens - afterTokens,
      });
    }
    
    // Verify system message is preserved
    const hasSystemMessage = truncatedMessages[0]?.role === 'system';
    getEventSystem().error(EventCategory.LLM, `🎯 [CustomAgent] System message preserved: ${hasSystemMessage ? '✅' : '❌'}`);
    
    // Convert session tools to proxy tools (client-side execution)
    // NOTE: Server tools are NOT filtered here (context not available in agent)
    // Server tool filtering happens in response handler before tool calls
    // However, in subagent mode, askSubagent is a server tool that needs execute function
    // So we need to merge server tools if serverToolContext is provided
    let proxyTools: Record<string, any> = {};
    if (sessionTools.length > 0) {
      if (options.serverToolContext) {
        // We have context - convert all sessionTools to proxy tools (including server tools for definitions)
        // CRITICAL: Don't filter out server tools here - the AI SDK needs their definitions in sessionTools
        // The execute functions will come from the registry merge below, which will override proxy versions
        const { serverToolRegistry } = require('../../lib/server-tool-registry');
        proxyTools = convertSessionToolsToProxyTools(sessionTools, options.serverToolContext);
        
        // Merge server tools with execute functions from registry
        // This will override any proxy versions with actual execute functions
        const serverTools = serverToolRegistry.getServerToolsForAgent(options.serverToolContext);
        const serverToolNames = Object.keys(serverTools);
        proxyTools = { ...proxyTools, ...serverTools };
        
        getEventSystem().info(EventCategory.LLM, 
          `🔧 [CustomAgent] Merged ${serverToolNames.length} server tools: ${serverToolNames.join(', ')}`
        );
        getEventSystem().info(EventCategory.LLM, 
          `🔧 [CustomAgent] Total tools after merge: ${Object.keys(proxyTools).length} (${Object.keys(proxyTools).join(', ')})`
        );
      } else {
        // No context - convert all sessionTools (legacy behavior)
        proxyTools = convertSessionToolsToProxyTools(sessionTools);
      }
    }
    
    getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] Tools: ${Object.keys(proxyTools).length} available`);
    
    // Get provider from registry
    let llmClient;
    try {
      llmClient = getProvider(this.config.provider as any, {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
        openrouterSiteUrl: this.config.openrouterSiteUrl,
        openrouterAppName: this.config.openrouterAppName,
      });
    } catch (error) {
      const keyPreview = formatApiKeyPreview(this.config.apiKey);
      getEventSystem().error(EventCategory.LLM, `❌ [CustomAgent] Failed to get provider: ${this.config.provider}`);
      getEventSystem().error(EventCategory.PROVIDER, `🔑 Error context: provider=${this.config.provider}, apiKey=${keyPreview}`);
      throw error;
    }
    
    // Create base model
    const baseModel = llmClient(this.config.model);
    
    // Wrap model with agent analytics if service is available (replaces events().llm())
    const model = analyticsService
      ? wrapModelWithAnalytics(baseModel, analyticsService, {
          provider: this.config.provider,
          model: this.config.model,
          privacyMode: false,
        })
      : baseModel;
    
    if (analyticsService) {
      getEventSystem().info(EventCategory.LLM, '✅ [CustomAgent] Model wrapped with agent analytics', {
        agent: 'CustomAgent',
        provider: this.config.provider,
        model: this.config.model,
        traceId,
      });
    } else if (traceId) {
      getEventSystem().warn(EventCategory.LLM, '⚠️ [CustomAgent] Trace ID provided but analytics service not found', {
        agent: 'CustomAgent',
        traceId,
        sessionId: this.config.sessionId,
      });
    }
    
    // Determine reasoning effort based on model family
    // For real-time voice applications, we want minimal reasoning to reduce latency
    // Use groqReasoningEffort from config if provided (takes precedence over env var)
    getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] groqReasoningEffort from config: ${this.config.groqReasoningEffort || '(not set)'}`);
    const reasoningEffort = determineReasoningEffort(
      this.config.model, 
      this.config.provider,
      this.config.groqReasoningEffort // Override from config (from env or token)
    );
    getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] Reasoning effort: ${reasoningEffort} (for low-latency voice)`);
    
    // Log first message to verify system prompt is preserved after truncation
    if (truncatedMessages.length > 0) {
      const firstMsg = truncatedMessages[0];
      getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] First message role: ${firstMsg.role}`);
      if (firstMsg.role === 'system') {
        getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] ===== SYSTEM PROMPT AFTER TRUNCATION =====`);
        
        const systemContent = String(firstMsg.content);
        
        // Check if using structured format
        const hasStructuredFormat = systemContent.includes('<SYSTEM_PRIORITY>') || systemContent.includes('<USER_INSTRUCTIONS>');
        
        if (hasStructuredFormat) {
          // Verify all segments are still present
          const hasPriority = systemContent.includes('<SYSTEM_PRIORITY>');
          const hasUserInstructions = systemContent.includes('<USER_INSTRUCTIONS>');
          const hasFinalInstructions = systemContent.includes('Always prioritize the SYSTEM_PRIORITY');
          
          getEventSystem().info(EventCategory.LLM, `✅ Segments preserved: SYSTEM_PRIORITY=${hasPriority}, USER_INSTRUCTIONS=${hasUserInstructions}, FINAL=${hasFinalInstructions}`);
        } else {
          getEventSystem().info(EventCategory.LLM, `✅ Raw system prompt preserved (unstructured format)`);
        }
        
        // Show first 20 lines to verify content
        const systemContentLines = systemContent.split('\n');
        const first20Lines = systemContentLines.slice(0, 20).join('\n');
        getEventSystem().info(EventCategory.LLM, `📋 First 20 lines:\n${first20Lines}${systemContentLines.length > 20 ? `\n... (${systemContentLines.length - 20} more lines)` : ''}`);
        
        getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] ===== END VERIFICATION =====`);
      }
    }
    
    // Stream LLM response using AI SDK v5 proper patterns
    // Build options object with correct property names
    const streamOptions: ExtendedStreamOptions = {
      model,
      messages: truncatedMessages,
      tools: Object.keys(proxyTools).length > 0 ? proxyTools : undefined,
      stopWhen: stepCountIs(this.config.maxSteps || 5), // AI SDK v5: Use stopWhen with stepCountIs
    };
    
    // Add optional parameters only if defined (undefined = use provider defaults)
    if (temperature !== undefined) {
      streamOptions.temperature = temperature;
    }
    
    if (maxTokens !== undefined) {
      // AI SDK v5: Use maxOutputTokens (maxTokens was renamed)
      (streamOptions as any).maxOutputTokens = maxTokens;
    }
    
    // Add frequency penalty if defined (helps reduce repetition)
    if (frequencyPenalty !== undefined) {
      (streamOptions as any).frequencyPenalty = frequencyPenalty;
      getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] Frequency penalty: ${frequencyPenalty}`);
    }
    
    // Add presence penalty if defined (helps reduce repetition)
    if (presencePenalty !== undefined) {
      (streamOptions as any).presencePenalty = presencePenalty;
      getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] Presence penalty: ${presencePenalty}`);
    }
    
    // Add repetition penalty for OpenRouter (provider-specific, via extraBody)
    if (repetitionPenalty !== undefined && this.config.provider === 'openrouter') {
      const existingOpenRouter = streamOptions.providerOptions?.openrouter;
      const existingExtraBody = existingOpenRouter && typeof existingOpenRouter === 'object' && 'extraBody' in existingOpenRouter
        ? existingOpenRouter.extraBody
        : undefined;
      
      streamOptions.providerOptions = {
        ...streamOptions.providerOptions,
        openrouter: {
          ...(existingOpenRouter && typeof existingOpenRouter === 'object' ? existingOpenRouter : {}),
          extraBody: {
            ...(existingExtraBody && typeof existingExtraBody === 'object' ? existingExtraBody : {}),
            repetition_penalty: repetitionPenalty,
          },
        },
      };
      getEventSystem().info(EventCategory.LLM, `🎯 [CustomAgent] Repetition penalty (OpenRouter): ${repetitionPenalty}`);
    }
    
    // Add provider-specific options for reasoning control
    // Apply low reasoning effort across all supported providers for low-latency voice
    // Pass model to check if it supports reasoning effort (e.g., Groq models)
    applyReasoningOptions(streamOptions, this.config.provider, reasoningEffort, '[CustomAgent]', this.config.model);
    
    // Add experimental tool call repair
    // This uses structured outputs to fix malformed tool calls
    streamOptions.experimental_repairToolCall = createToolCallRepairHandler(model, '[CustomAgent]');
    
    // Stream with error handling and retry logic
    const maxRetries = this.config.maxStreamRetries ?? 3;
    let retryCount = 0;
    let currentMessages = truncatedMessages;
    let accumulatedText = '';
    
    while (retryCount <= maxRetries) {
      try {
        if (retryCount > 0) {
          getEventSystem().info(EventCategory.LLM, `🔄 [CustomAgent] Retrying stream (attempt ${retryCount}/${maxRetries})`);
          
          // Track retry (agent analytics)
          if (analyticsService) {
            const errorMessage = accumulatedText ? 'Stream incomplete' : 'Stream failed';
            analyticsService.trackRetry({
              attemptNumber: retryCount,
              reason: 'stream_error',
              errorMessage,
            });
          }
          
          // Add continuation prompt if we had errors but no response
          if (accumulatedText.trim()) {
            currentMessages = [
              ...currentMessages,
              { role: 'assistant', content: accumulatedText },
              { role: 'user', content: 'Please continue and complete your response.' },
            ];
          }
        }
        
        // Update messages in stream options
        streamOptions.messages = currentMessages;
        
        const result = await streamText(streamOptions);
        
        // Capture usage information from streamText result.totalUsage
        // This provides actual token counts from the LLM provider (inputTokens, outputTokens, totalTokens)
        // Note: totalUsage is a PromiseLike, so we'll await it after the stream completes
        // For now, we'll capture it in the finish event of the stream
        
        // Process stream with error handling and return the transformed stream
        // The stream will handle errors internally and continue processing
        // Pass result so we can access totalUsage after stream completes
        return this.processStreamWithErrorHandling(
          result.fullStream,
          accumulatedText,
          result // Pass entire result to access totalUsage
        );
        
      } catch (error) {
        retryCount++;
        const keyPreview = formatApiKeyPreview(this.config.apiKey);
        getEventSystem().error(EventCategory.LLM, `❌ [CustomAgent] streamText failed (attempt ${retryCount}/${maxRetries + 1})`);
        getEventSystem().error(EventCategory.PROVIDER, `🔑 Error context: provider=${this.config.provider}, model=${this.config.model}, apiKey=${keyPreview}`);
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        const lowerMessage = errorMessage.toLowerCase();
        
        // Check for fatal LLM provider errors (don't retry these)
        const isFatalError = 
          // Credit errors
          lowerMessage.includes('insufficient credits') ||
          lowerMessage.includes('payment required') ||
          lowerMessage.includes('402') ||
          lowerMessage.includes('insufficient balance') ||
          lowerMessage.includes('credit balance') ||
          lowerMessage.includes('not enough credits') ||
          (error as any)?.status === 402 ||
          (error as any)?.response?.status === 402 ||
          // Authentication errors
          lowerMessage.includes('api key') || 
          lowerMessage.includes('unauthorized') ||
          lowerMessage.includes('authentication') ||
          lowerMessage.includes('invalid key') ||
          lowerMessage.includes('wrong api key') ||
          lowerMessage.includes('401') ||
          (lowerMessage.includes('invalid') && lowerMessage.includes('key')) ||
          (error as any)?.status === 401 ||
          (error as any)?.response?.status === 401 ||
          // Rate limit errors
          lowerMessage.includes('rate limit') ||
          lowerMessage.includes('quota exceeded') ||
          lowerMessage.includes('429') ||
          lowerMessage.includes('too many requests') ||
          (error as any)?.status === 429 ||
          (error as any)?.response?.status === 429 ||
          // Account suspension
          lowerMessage.includes('account suspended') ||
          lowerMessage.includes('account banned') ||
          lowerMessage.includes('access denied') ||
          lowerMessage.includes('forbidden') ||
          lowerMessage.includes('403') ||
          (error as any)?.status === 403 ||
          (error as any)?.response?.status === 403;
        
        if (isFatalError) {
          // Log specific error type
          if (lowerMessage.includes('insufficient credits') || lowerMessage.includes('402') || (error as any)?.status === 402) {
            getEventSystem().error(EventCategory.AUTH, `💳 INSUFFICIENT CREDITS ERROR DETECTED! Using key: ${keyPreview}`);
          } else if (lowerMessage.includes('api key') || lowerMessage.includes('unauthorized') || lowerMessage.includes('401') || (error as any)?.status === 401) {
            getEventSystem().critical(EventCategory.AUTH, `🚨 API KEY ERROR DETECTED! Using key: ${keyPreview}`);
          } else if (lowerMessage.includes('rate limit') || lowerMessage.includes('429') || (error as any)?.status === 429) {
            getEventSystem().error(EventCategory.AUTH, `⏱️ RATE LIMIT ERROR DETECTED! Using key: ${keyPreview}`);
          } else {
            getEventSystem().critical(EventCategory.LLM, `💀 FATAL LLM PROVIDER ERROR DETECTED! Using key: ${keyPreview}`);
          }
          getEventSystem().error(EventCategory.LLM, `🔍 Full error message: ${errorMessage}`);
          // Don't retry on fatal errors - throw immediately
          throw error;
        }
        
        // If we've exhausted retries, throw
        if (retryCount > maxRetries) {
          getEventSystem().error(EventCategory.LLM, `❌ [CustomAgent] Max retries (${maxRetries}) reached`);
          throw error;
        }
        
        // Wait before retrying
        getEventSystem().info(EventCategory.LLM, `🔄 [CustomAgent] Waiting before retry...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // This should never be reached, but TypeScript needs it
    throw new Error('Stream processing failed after all retries');
  }
  
  /**
   * Truncate conversation context to fit within token limits
   * 
   * Uses ContextTruncator with token-count strategy by default.
   * Ensures minimum token count is preserved (6,000 tokens minimum).
   * Uses actual token counts from Vercel AI SDK when available.
   * 
   * @param messages - Full conversation history
   * @param tokenCounts - Optional map of message index to token counts
   * @returns Truncated messages
   */
  private truncateContext(messages: CoreMessage[], tokenCounts?: Map<number, MessageTokenCount>): CoreMessage[] {
    // Use ContextTruncator if available
    if (this.contextTruncator) {
      // For summarization strategy, use getContext()
      if (this.config.contextStrategy === 'summarization') {
        return this.contextTruncator.getContext(messages[0]); // Pass system message
      }
      
      // For token-count strategy (default), use truncate() with actual token counts
      const truncated = this.contextTruncator.truncate(messages, tokenCounts);
      
      // ContextTruncator already handles minimum token verification
      // We just log the result for debugging
      const minContextTokens = this.config.minContextTokens ?? 6000;
      let truncatedTokenCount = 0;
      if (tokenCounts) {
        for (let i = 0; i < truncated.length; i++) {
          const originalIndex = messages.indexOf(truncated[i]);
          if (originalIndex >= 0 && tokenCounts.has(originalIndex)) {
            truncatedTokenCount += tokenCounts.get(originalIndex)!.totalTokens;
          }
        }
      } else {
        truncatedTokenCount = this.estimateTotalTokens(truncated);
      }
      
      if (truncatedTokenCount < minContextTokens && messages.length > truncated.length) {
        getEventSystem().warn(EventCategory.LLM, `⚠️ [CustomAgent] Truncated context below minimum (${truncatedTokenCount} < ${minContextTokens} tokens)`);
      }
      
      return truncated;
    }
    
    // Fallback: Simple message-count truncation (legacy support)
    // This should rarely be used now that token-count is default
    return truncateContextSimple(
      messages,
      this.config.maxContextMessages || 15,
      '[CustomAgent]'
    );
  }
  
  /**
   * Estimate total tokens in messages (simple heuristic: ~4 chars per token)
   * 
   * @param messages - Messages to estimate
   * @returns Estimated token count
   */
  private estimateTotalTokens(messages: CoreMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      totalChars += content.length;
    }
    return Math.ceil(totalChars / 4);
  }
  
  /**
   * Process stream with error handling - handles tool validation errors gracefully
   * 
   * According to Vercel AI SDK docs, tool validation errors should appear as
   * tool-error parts and allow the stream to continue. Provider-level errors
   * may appear as error parts and need special handling.
   * 
   * @param aiStream - Stream from streamText
   * @param initialAccumulatedText - Initial accumulated text (for retries)
   * @param streamResult - StreamText result object (for accessing totalUsage)
   */
  private async *processStreamWithErrorHandling(
    aiStream: AsyncIterable<any>,
    initialAccumulatedText: string = '',
    streamResult?: { totalUsage?: PromiseLike<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }> }
  ): AsyncIterable<AgentStreamPart> {
    let accumulatedText = initialAccumulatedText;
    
    try {
      for await (const part of aiStream) {
        // Handle all part types including errors
        yield* this.transformStreamPart(part, accumulatedText);
        
        // Update accumulated text for text deltas
        if (part.type === 'text-delta') {
          const delta = part.textDelta || part.text || part.delta || '';
          accumulatedText += delta;
        }
      }
    } catch (streamError) {
      // Handle stream processing errors
      const errorMsg = streamError instanceof Error ? streamError.message : String(streamError);
      
      // Check if this is a tool validation error (recoverable)
      const isToolValidationError = 
        errorMsg.includes('tool call validation') || 
        errorMsg.includes('did not match schema') ||
        errorMsg.includes('missing properties') ||
        errorMsg.includes('additionalProperties');
      
      if (isToolValidationError) {
        getEventSystem().error(EventCategory.LLM, `🔍 [CustomAgent] Tool validation error in stream - emitting as error part`);
        
        // Emit as error part so caller can handle it (recoverable)
        yield {
          type: 'error',
          error: streamError instanceof Error ? streamError : new Error(String(streamError)),
        };
      } else {
        // All other errors are fatal - throw immediately
        getEventSystem().critical(EventCategory.LLM, '💀 [CustomAgent] Fatal error in stream processing - throwing');
        throw streamError;
      }
    }
  }
  
  /**
   * Transform a single AI SDK stream part to our format
   * 
   * @param part - Stream part from AI SDK
   * @param accumulatedText - Accumulated text so far
   * @param streamResult - Optional streamText result for accessing totalUsage
   */
  private *transformStreamPart(part: any, accumulatedText: string, streamResult?: { totalUsage?: PromiseLike<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }> }): Generator<AgentStreamPart, void, unknown> {
    if (part.type === 'text-delta') {
      // Convert text-delta to session handler format
      // AI SDK v5 uses different property names depending on version
      // Try: textDelta, text, delta
      let delta = part.textDelta;
      
      // Fix for Cloudflare Workers / specific adapters:
      // part.text might be accumulated text instead of a delta.
      // We detect this by checking if it starts with what we've already accumulated.
      if (!delta && part.text) {
        const text = part.text;
        // If text starts with accumulatedText and is longer, it's likely accumulated text
        if (accumulatedText && text.startsWith(accumulatedText) && text.length > accumulatedText.length) {
          delta = text.slice(accumulatedText.length);
        } else {
          // Otherwise treat it as a delta (or it's the start of the stream)
          delta = text;
        }
      }
      
      // Fallback to .delta
      if (!delta && part.delta) {
        delta = part.delta;
      }
      
      if (!delta && delta !== '') {
        // Only log if we really couldn't find any content (and it's not an empty string delta)
        getEventSystem().critical(EventCategory.LLM, '🚨 [CustomAgent] text-delta part has no text content:', JSON.stringify(part));
      }
      
      yield {
        type: 'text',
        delta: delta || '',
      };
    } else if (part.type === 'tool-call') {
      // Convert tool-call format to session handler format
      // AI SDK v5: { type: 'tool-call', toolName, toolCallId, input }
      // Our format: { type: 'tool_call', toolName, toolCallId, args }
      const normalizedToolName = normalizeToolName(part.toolName);
      getEventSystem().info(EventCategory.LLM, `🔧 [CustomAgent] Tool call received from LLM: ${part.toolName}${normalizedToolName !== part.toolName ? ` (normalized to: ${normalizedToolName})` : ''}`);
      getEventSystem().debug(EventCategory.LLM, `🔍 [CustomAgent] RAW AI SDK STREAM PART (COMPLETE, NO TRUNCATION):`);
      getEventSystem().info(EventCategory.LLM, JSON.stringify(part, null, 2));
      getEventSystem().debug(EventCategory.LLM, `🔍 [CustomAgent] Raw tool input:`, part.input);
      getEventSystem().debug(EventCategory.LLM, `🔍 [CustomAgent] Raw tool args (if different):`, part.args);
      
      // Log any text that came before the tool call (reasoning, thinking, etc.)
      if (accumulatedText.trim()) {
        getEventSystem().info(EventCategory.LLM, `💭 [CustomAgent] Text output before tool call:`, accumulatedText);
      }
      
      const toolInput = part.args || part.input;
      
      yield {
        type: 'tool_call',
        toolCallId: part.toolCallId,
        toolName: normalizedToolName,
        args: toolInput,
      };
    } else if (part.type === 'tool-result') {
      // Convert tool-result format to session handler format
      // AI SDK v5: { type: 'tool-result', toolName, toolCallId, result }
      // Our format: { type: 'tool_result', toolName, toolCallId, result }
      yield {
        type: 'tool_result', // underscore, not hyphen
        toolCallId: part.toolCallId,
        result: part.result,
      };
    } else if (part.type === 'tool-error') {
      // Handle tool execution errors - these should allow the stream to continue
      // According to Vercel AI SDK docs, tool-error parts enable automated LLM roundtrips
      getEventSystem().error(EventCategory.LLM, `❌ [CustomAgent] Tool error: ${part.toolName || 'unknown'}`);
      getEventSystem().error(EventCategory.LLM, `   Error:`, part.error);
      
      // Emit as error part so the session handler can forward it to the client
      // The AI should be able to see this error and respond to it
      yield {
        type: 'error',
        error: part.error,
      };
    } else if (part.type === 'usage') {
        // Pass through usage events (from stream parts)
        // These are incremental usage updates during streaming
        getEventSystem().info(EventCategory.LLM, `📊 [Token Tracking] Usage event - Prompt: ${part.promptTokens}, Completion: ${part.completionTokens}, Total: ${part.totalTokens}`);
        yield {
          type: 'usage',
          promptTokens: part.promptTokens,
          completionTokens: part.completionTokens,
          totalTokens: part.totalTokens,
        };
    } else if (part.type === 'finish') {
        // Capture final usage from finish event
        // This is the most accurate token count from the provider
        if (part.usage) {
          // AI SDK uses inputTokens/outputTokens, not promptTokens/completionTokens
          const inputTokens = part.usage.inputTokens || 0;
          const outputTokens = part.usage.outputTokens || 0;
          const totalTokens = part.usage.totalTokens || inputTokens + outputTokens;
          
          getEventSystem().info(EventCategory.LLM, `📊 [Token Tracking] Finish event - Input: ${inputTokens}, Output: ${outputTokens}, Total: ${totalTokens}`);
          
          // Yield usage event for session handler to track
          // Convert to our format (promptTokens/completionTokens for compatibility)
          yield {
            type: 'usage',
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens: totalTokens,
          };
        }
        // Note: If finish event doesn't have usage, we'll get it from totalUsage after stream completes
    } else if (part.type === 'error') {
      // Handle stream-level errors
      const streamError = part.error;
      getEventSystem().critical(EventCategory.LLM, '🚨 [CustomAgent] Stream error:', streamError);
      
      // Log API key context for debugging
      const keyPreview = formatApiKeyPreview(this.config.apiKey);
      getEventSystem().error(EventCategory.LLM, `🔑 [CustomAgent] Error context: provider=${this.config.provider}, model=${this.config.model}, apiKey=${keyPreview}`);
      
      const errorMessage = streamError?.message || String(streamError);
      
      // Check if this is a tool validation error
      // According to Vercel AI SDK docs, these should be converted to tool-error parts
      // but provider-level errors may come through as error parts
      if (errorMessage.includes('tool call validation') || 
          errorMessage.includes('did not match schema') ||
          errorMessage.includes('missing properties') ||
          errorMessage.includes('additionalProperties') ||
          errorMessage.includes('InvalidToolInputError')) {
        getEventSystem().error(EventCategory.LLM, `   🔍 [CustomAgent] This is a tool validation error - allowing stream to continue`);
        // Emit as error part - the retry logic will handle continuing the conversation
      }
      
      // Check for fatal LLM provider errors
      const lowerMessage = errorMessage.toLowerCase();
      const isFatalError = 
        // Credit errors
        lowerMessage.includes('insufficient credits') ||
        lowerMessage.includes('payment required') ||
        lowerMessage.includes('402') ||
        lowerMessage.includes('insufficient balance') ||
        lowerMessage.includes('credit balance') ||
        lowerMessage.includes('not enough credits') ||
        streamError?.status === 402 ||
        streamError?.response?.status === 402 ||
        // Authentication errors
        lowerMessage.includes('api key') || 
        lowerMessage.includes('wrong api key') ||
        lowerMessage.includes('unauthorized') ||
        lowerMessage.includes('authentication') ||
        lowerMessage.includes('invalid key') ||
        lowerMessage.includes('401') ||
        (lowerMessage.includes('invalid') && lowerMessage.includes('key')) ||
        streamError?.status === 401 ||
        streamError?.response?.status === 401 ||
        // Rate limit errors
        lowerMessage.includes('rate limit') ||
        lowerMessage.includes('quota exceeded') ||
        lowerMessage.includes('429') ||
        lowerMessage.includes('too many requests') ||
        streamError?.status === 429 ||
        streamError?.response?.status === 429 ||
        // Account suspension
        lowerMessage.includes('account suspended') ||
        lowerMessage.includes('account banned') ||
        lowerMessage.includes('access denied') ||
        lowerMessage.includes('forbidden') ||
        lowerMessage.includes('403') ||
        streamError?.status === 403 ||
        streamError?.response?.status === 403;
      
      if (isFatalError) {
        // Log specific error type
        if (lowerMessage.includes('insufficient credits') || lowerMessage.includes('402') || streamError?.status === 402) {
          getEventSystem().error(EventCategory.LLM, `💳 INSUFFICIENT CREDITS ERROR DETECTED in stream! Using key: ${keyPreview}`);
        } else if (lowerMessage.includes('api key') || lowerMessage.includes('unauthorized') || lowerMessage.includes('401') || streamError?.status === 401) {
          getEventSystem().critical(EventCategory.LLM, `🚨 API KEY ERROR DETECTED in stream! Using key: ${keyPreview}`);
        } else if (lowerMessage.includes('rate limit') || lowerMessage.includes('429') || streamError?.status === 429) {
          getEventSystem().error(EventCategory.LLM, `⏱️ RATE LIMIT ERROR DETECTED in stream! Using key: ${keyPreview}`);
        } else {
          getEventSystem().critical(EventCategory.LLM, `💀 FATAL LLM PROVIDER ERROR DETECTED in stream! Using key: ${keyPreview}`);
        }
        getEventSystem().error(EventCategory.LLM, `🔍 Full error message: ${errorMessage}`);
        getEventSystem().error(EventCategory.LLM, `📋 Error object:`, JSON.stringify(streamError, null, 2));
      }
      
      yield {
        type: 'error',
        error: streamError,
      };
    } else {
      // Silently ignore lifecycle events (start, finish, etc.)
      // and reasoning events (reasoning-start, reasoning-delta, reasoning-end)
      // and text boundary events (text-start, text-end)
      // and step events (step-start, step-finish)
      // These are informational only and not needed for our processing
      const ignoredEvents = [
        'start', 'finish',
        'step-start', 'step-finish', 'finish-step',
        'text-start', 'text-end',
        'tool-input-start', 'tool-input-delta', 'tool-input-end',
        'reasoning', 'reasoning-start', 'reasoning-delta', 'reasoning-end',
      ];
      
      if (!ignoredEvents.includes(part.type)) {
        getEventSystem().warn(EventCategory.LLM, `⚠️ [CustomAgent] Unknown stream event type: ${part.type}`);
      }
    }
  }
  
  /**
   * Build deterministic tool instructions for the system prompt
   */
  private buildToolInstructions(sessionTools: any[]): string {
    if (!sessionTools || sessionTools.length === 0) {
      return '';
    }
    
    const lines: string[] = [];
    lines.push('You MUST call tools exactly with the argument names and types listed below.');
    lines.push('Use a single JSON object for args. Do not add extra fields. Provide all required fields.');
    lines.push('');
    lines.push('CRITICAL: For optional parameters, if you do not need to use them, OMIT them entirely from the tool call.');
    lines.push('NEVER send null for optional parameters - this will cause tool call validation to fail.');
    lines.push('Only include parameters that you actually want to use with non-null values.');
    lines.push('');
    
    for (const tool of sessionTools) {
      const name = tool.name || 'unknown_tool';
      const description = tool.description || '';
      const parameters = tool.parameters || {};
      const props = parameters.properties || {};
      const required: string[] = parameters.required || [];
      
      lines.push(`${name}: ${description}`);
      lines.push('args: {');
      
      for (const [propName, propSchema] of Object.entries<any>(props)) {
        const type = (propSchema as any).type || 'any';
        const desc = (propSchema as any).description || '';
        const isReq = required.includes(propName);
        lines.push(`  "${propName}" (${type})${isReq ? ' [required]' : ' [optional]'}${desc ? ` - ${desc}` : ''}`);
      }
      
      lines.push('}');
      lines.push('Call format:');
      lines.push(`  ${name}({ ...args });`);
      lines.push('');
    }
    
    lines.push('When unsure, ask clarifying questions before calling a tool.');
    return lines.join('\n');
  }
  
  /**
   * Get agent metadata for debugging and monitoring
   * 
   * @returns Agent metadata
   */
  getMetadata(): AgentMetadata {
    return {
      type: 'custom',
      provider: this.config.provider,
      model: this.config.model,
      maxSteps: this.config.maxSteps || 3,
      maxContextMessages: this.config.maxContextMessages || 15,
      contextStrategy: this.config.contextStrategy || 'message-count',
    };
  }
  
  /**
   * Cleanup resources (called on disconnect)
   * 
   * Clears conversation history and any other state.
   * 
   * @returns Promise that resolves when cleanup is complete
   */
  async cleanup(): Promise<void> {
    getEventSystem().info(EventCategory.LLM, '🧹 [CustomAgent] Cleaning up');
    
    // Clear conversation history
    this.conversationHistory = [];
    
    // Cleanup ContextTruncator (e.g., ConversationSummarizer)
    if (this.contextTruncator) {
      await this.contextTruncator.cleanup();
    }
    
    // Reset ToolOrchestrator
    this.toolOrchestrator.reset();
    
    getEventSystem().info(EventCategory.LLM, '✅ [CustomAgent] Cleanup complete');
  }
}
