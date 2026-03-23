/**
 * Ask Subagent Tool Executor
 * 
 * Executes the askSubagent tool, which delegates tool execution to a specialized subagent.
 * Uses non-streaming generation since we wait for the complete result anyway.
 * 
 * CRITICAL: Subagent is a COMPLETE BLACKBOX
 * - Subagent sees ALL client tools (proxy tools) + server tools
 * - Main agent NEVER sees client tools directly
 * - Subagent's internal tool calls are NOT added to conversation history
 * - Subagent's internal messages are NOT added to conversation history
 * - Only the final text response from subagent is visible to main agent
 * - The final response is added as a function_call_output item for the askSubagent tool call
 */

import type { ConversationItem } from '../../lib/protocol';
import type { SessionData } from '../../session/types';
import { getSubagentConfig } from '../../config/env';
import type { ServerToolContext, ServerToolResult } from '../server-tool-registry';
import { getEventSystem, EventCategory } from '../../events';
import type { CoreMessage } from 'ai';
import { generateText, stepCountIs } from 'ai';
import { getProvider } from '../../services/providers/llm';

/**
 * Execute askSubagent tool
 * 
 * Uses non-streaming generateText to get the complete subagent response.
 * This is simpler than streaming since we wait for the full result anyway.
 * 
 * CRITICAL: Subagent sees ALL client tools (proxy tools) + server tools.
 * Main agent NEVER sees client tools directly.
 */
export async function executeAskSubagent(
  args: Record<string, any>,
  context: ServerToolContext
): Promise<ServerToolResult> {
  const { task } = args;
  const { sessionData } = context;
  
  if (!task || typeof task !== 'string') {
    return {
      success: false,
      error: 'Task parameter is required',
    };
  }
  
  getEventSystem().info(EventCategory.SESSION, `🤖 [Subagent] Executing task: "${task.substring(0, 100)}..."`);
  
  // CRITICAL: Mark subagent as executing to prevent response.create loop
  // This prevents the client SDK from triggering new responses while subagent is running
  sessionData.subagentExecuting = true;
  
  // Get subagent configuration
  const subagentConfig = getSubagentConfig(sessionData.runtimeConfig);
  
  if (!subagentConfig.enabled) {
    // Clear executing flag before returning
    sessionData.subagentExecuting = false;
    return {
      success: false,
      error: 'Subagent mode is not enabled',
    };
  }
  
  // Generate unique subagent ID for this execution (for event bus routing)
  // CRITICAL: Reuse existing subagentId if there's an active subagent with pending tool calls
  // This prevents creating multiple concurrent subagents
  const { generateEventId } = await import('../protocol');
  let subagentId = sessionData.subagentId;
  
  // Check if there's an active subagent with pending calls
  if (subagentId && sessionData.subagentEventSubscriber) {
    const pendingCount = sessionData.subagentEventSubscriber.getPendingCount();
    if (pendingCount > 0) {
      getEventSystem().warn(EventCategory.SESSION,
        `⚠️ [Subagent] Reusing existing subagent (${subagentId}) with ${pendingCount} pending tool calls`
      );
      // Reuse existing subagentId - don't create a new one
    } else {
      // No pending calls, safe to create new subagent
      subagentId = `subagent_${generateEventId().substring(0, 36)}`;
      sessionData.subagentId = subagentId;
      getEventSystem().info(EventCategory.SESSION, `🔌 [Subagent] Created new subagent ID: ${subagentId}`);
    }
  } else {
    // No existing subagent, create new one
    subagentId = `subagent_${generateEventId().substring(0, 36)}`;
    sessionData.subagentId = subagentId;
    getEventSystem().info(EventCategory.SESSION, `🔌 [Subagent] Created new subagent ID: ${subagentId}`);
  }
  
  // Build client tools directly using centralized tool builder
  // Subagent automatically gets ALL client tools - no filtering needed
  const { buildClientToolsForSubagent } = await import('../tools/tool-builder');
  
  const sessionTools = sessionData.config.tools || [];
  getEventSystem().info(EventCategory.SESSION, `🔧 [Subagent] Building tools from ${sessionTools.length} session tools: ${sessionTools.map(t => t.name).join(', ')}`);
  
  const clientTools = buildClientToolsForSubagent(
    sessionTools,
    context
    // No requestedTools parameter - subagent gets all tools automatically
  );
  
  const toolNames = Object.keys(clientTools);
  getEventSystem().info(EventCategory.SESSION, `🤖 [Subagent] Available tools (${toolNames.length}): ${toolNames.join(', ')}`);
  
  // Verify tools are properly formatted
  if (toolNames.length === 0) {
    getEventSystem().warn(EventCategory.SESSION, `⚠️ [Subagent] No client tools available! Session tools: ${sessionTools.map(t => t.name).join(', ')}`);
  }
  
  // Log tool structure for debugging
  for (const [toolName, toolDef] of Object.entries(clientTools)) {
    const hasExecute = typeof (toolDef as any).execute === 'function';
    const hasDescription = !!(toolDef as any).description;
    const hasParameters = !!(toolDef as any).parameters || !!(toolDef as any).inputSchema;
    getEventSystem().info(EventCategory.SESSION, `🔍 [Subagent] Tool ${toolName}: hasExecute=${hasExecute}, hasDescription=${hasDescription}, hasParameters=${hasParameters}`);
  }
  
  // Build subagent prompt with tool_instructions
  const toolInstructions = sessionData.subagentToolInstructions || '';
  const subagentPrompt = buildSubagentPrompt(task, clientTools, toolInstructions);
  
  // Get conversation context (last few messages for context)
  // NOTE: This pulls from main agent's conversation history, which is fine
  // Subagent's own tool calls/results are NOT in conversation history (blackbox)
  // So subagent sees main conversation but not its own internal operations
  const recentMessages = getRecentMessages(sessionData.conversationHistory, 5);
  
  // Build messages array for non-streaming generation
  // These messages are used ONLY internally for generation - NOT added to conversation history
  // CRITICAL: Each subagent invocation gets a FRESH messages array with NO tool call history
  // - getRecentMessages() filters out all function_call and function_call_output items
  // - Only regular messages (user/assistant) are included for context
  // - Tool calls from previous subagent invocations are completely excluded
  // - Each invocation starts with a clean slate for tool execution
  const messages: CoreMessage[] = [
    { role: 'system', content: subagentPrompt },
    ...recentMessages,
    { role: 'user', content: task },
  ];
  
  // Execute subagent using non-streaming generateText
  // This is simpler since we wait for the complete result anyway
  try {
    getEventSystem().info(EventCategory.SESSION, `🔧 [Subagent] Generating non-streaming response with ${Object.keys(clientTools).length} tools`);
    
    // Get provider and model configuration
    const provider = subagentConfig.provider || sessionData.runtimeConfig?.llm.provider || 'groq';
    const model =
      subagentConfig.model ||
      sessionData.model ||
      (provider === 'openrouter'
        ? 'anthropic/claude-3-5-sonnet'
        : provider === 'cerebras'
          ? 'llama-3.3-70b'
          : provider === 'workers-ai'
            ? '@cf/zai-org/glm-4.7-flash'
            : 'moonshotai/kimi-k2-instruct-0905');
    const apiKey = sessionData.runtimeConfig?.llm.apiKey || '';
    
    if (!apiKey) {
      throw new Error(`API key required for provider: ${provider}`);
    }
    
    // Get provider client
    const llmClient = getProvider(provider, {
      apiKey,
      openrouterSiteUrl: sessionData.runtimeConfig?.llm.openrouterSiteUrl,
      openrouterAppName: sessionData.runtimeConfig?.llm.openrouterAppName,
    });
    
    // Generate text with tools (non-streaming)
    // generateText automatically handles tool calls and waits for results
    // CRITICAL: Use stopWhen: stepCountIs(2) to enable multi-step tool calling:
    //   - Step 1: Call the tool and wait for result
    //   - Step 2: Generate a summary text based on the tool result
    // Without stopWhen, generateText only does single-step (call tool but no summary)
    getEventSystem().info(EventCategory.SESSION, `🤖 [Subagent] Starting generateText with stepCountIs(2)`);
    const result = await generateText({
      model: llmClient(model) as any, // Type assertion for AI SDK compatibility
      messages,
      tools: clientTools,
      temperature: subagentConfig.temperature,
      stopWhen: stepCountIs(2), // Allow tool call + summary generation
      ...(subagentConfig.maxTokens && { maxTokens: subagentConfig.maxTokens }),
      // Log step completion for debugging
      onStepFinish: ({ stepNumber, text, toolCalls, finishReason }) => {
        getEventSystem().info(EventCategory.SESSION, 
          `📊 [Subagent] Step ${stepNumber} finished: finishReason=${finishReason}, ` +
          `toolCalls=${toolCalls?.length || 0}, textLength=${text?.length || 0}`
        );
        if (toolCalls && toolCalls.length > 0) {
          toolCalls.forEach((tc, i) => {
            getEventSystem().info(EventCategory.SESSION, 
              `   🔧 Tool call ${i + 1}: ${tc.toolName} (${tc.toolCallId})`
            );
          });
        }
      },
    });
    
    getEventSystem().info(EventCategory.SESSION, `✅ [Subagent] Generation completed: ${result.text.length} chars, ${result.steps?.length || 0} steps`);
    
    // CRITICAL: Clear subagent executing flag BEFORE cleanup
    // This allows response.create events to be processed again
    sessionData.subagentExecuting = false;
    
    // Count tool calls from steps (for logging only, not returned to main agent)
    const toolCalls = result.steps?.filter(step => step.toolCalls && step.toolCalls.length > 0).length || 0;
    getEventSystem().info(EventCategory.SESSION, `📊 [Subagent] Tool calls made: ${toolCalls}`);
    
    // Wait a bit for any pending tool results to complete
    // Then cleanup the subscriber if it matches this subagentId
    // Note: We don't cleanup immediately because tool results might still be in flight
    // The subscriber will be cleaned up when:
    // 1. All pending tool results are received (automatic via timeout)
    // 2. Session ends (cleanup in RealtimeSession)
    // 3. New subagent execution starts (old subscriber replaced if no pending calls)
    
    // Clear subagentId to allow new subagent executions
    // But keep subscriber until all pending calls complete
    const currentSubagentId = sessionData.subagentId;
    sessionData.subagentId = undefined;
    
    // Schedule cleanup after a short delay to allow pending results to arrive
    // Only cleanup if subscriber matches this subagentId
    setTimeout(() => {
      if (sessionData.subagentEventSubscriber && 
          sessionData.subagentEventSubscriber.getAgentId() === currentSubagentId) {
        const pendingCount = sessionData.subagentEventSubscriber.getPendingCount();
        if (pendingCount === 0) {
          getEventSystem().info(EventCategory.SESSION,
            `🧹 [Subagent] Cleaning up subscriber for completed subagent: ${currentSubagentId}`
          );
          sessionData.subagentEventSubscriber.cleanup();
          sessionData.subagentEventSubscriber = undefined;
        } else {
          getEventSystem().warn(EventCategory.SESSION,
            `⚠️ [Subagent] Subscriber still has ${pendingCount} pending calls, keeping alive: ${currentSubagentId}`
          );
        }
      }
    }, 1000); // Wait 1 second for pending results
    
    // Return ONLY the final text response - main agent should not see tool calls or metadata
    // The response handler will add this as a function_call_output item in conversation history
    return {
      success: true,
      data: {
        response: result.text, // ONLY the final text response, no metadata
      },
      addToHistory: true,
    };
  } catch (error) {
    getEventSystem().error(EventCategory.SESSION, `❌ [Subagent] Execution failed:`, error instanceof Error ? error : new Error(String(error)));
    
    // CRITICAL: Clear subagent executing flag on error
    sessionData.subagentExecuting = false;
    
    // Clear subagentId
    const currentSubagentId = sessionData.subagentId;
    sessionData.subagentId = undefined;
    
    // Cleanup event subscriber on error (after a delay to allow any in-flight results)
    setTimeout(() => {
      if (sessionData.subagentEventSubscriber && 
          sessionData.subagentEventSubscriber.getAgentId() === currentSubagentId) {
        const pendingCount = sessionData.subagentEventSubscriber.getPendingCount();
        if (pendingCount === 0) {
          sessionData.subagentEventSubscriber.cleanup();
          sessionData.subagentEventSubscriber = undefined;
        } else {
          getEventSystem().warn(EventCategory.SESSION,
            `⚠️ [Subagent] Error cleanup: Subscriber still has ${pendingCount} pending calls, keeping alive`
          );
        }
      }
    }, 1000);
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Build subagent system prompt
 * 
 * @param task - Task description from main agent
 * @param availableTools - Tools available to subagent
 * @param toolInstructions - Tool-specific instructions from client library
 */
function buildSubagentPrompt(
  task: string, 
  availableTools: Record<string, any>,
  toolInstructions: string
): string {
  const toolNames = Object.keys(availableTools);
  
  let prompt = `You are a specialized tool execution agent. Your role is to execute tools accurately and efficiently.

Available tools: ${toolNames.join(', ')}

Task: ${task}

Instructions:
1. Analyze the task and determine which tools to use
2. Call tools with correct parameters
3. Process tool results
4. Return a clear summary of what was accomplished

Be precise and efficient. Execute tools correctly on the first try.`;

  // Add tool-specific instructions if provided
  if (toolInstructions && toolInstructions.trim().length > 0) {
    prompt += `\n\n[Tool Execution Guidelines]\n${toolInstructions}`;
  }
  
  return prompt;
}


/**
 * Get recent messages from conversation history
 * 
 * CRITICAL: This function EXCLUDES all tool calls and tool results from the returned messages.
 * Only regular messages (type === 'message') are included. This ensures that:
 * - Each subagent invocation starts with a clean slate (no tool call history)
 * - Tool calls from previous subagent invocations are completely isolated
 * - Only the main conversation context (user/assistant messages) is provided
 * 
 * @param conversationHistory - Full conversation history
 * @param count - Number of recent messages to return
 * @returns Recent messages in CoreMessage format (NO tool calls included)
 */
function getRecentMessages(
  conversationHistory: ConversationItem[],
  count: number
): CoreMessage[] {
  // Get last N messages (excluding function calls/outputs for simplicity)
  // CRITICAL: We filter to only include type === 'message' items, which excludes:
  // - function_call items (tool calls)
  // - function_call_output items (tool results)
  // This ensures each subagent invocation has NO tool call history
  const recentItems = conversationHistory.slice(-count * 2); // Get more items to account for function calls
  
  const messages: CoreMessage[] = [];
  
  for (const item of recentItems) {
    // Only include regular messages - explicitly exclude tool calls and tool results
    if (item.type === 'message' && item.role) {
      const content = item.content?.map(c => c.text || c.transcript || '').join(' ') || '';
      if (content.trim().length > 0) {
        messages.push({
          role: item.role as 'user' | 'assistant' | 'system',
          content,
        });
      }
    }
    // Explicitly skip: function_call, function_call_output, and any other non-message types
  }
  
  // Return last N messages
  return messages.slice(-count);
}
