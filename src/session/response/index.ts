/**
 * Response Generation Module
 * 
 * Handles AI response generation with streaming TTS and tool support.
 * 
 * This module orchestrates the complete response generation flow:
 * - LLM streaming (Agent Mode only)
 * - Text chunking and deduplication
 * - TTS synthesis
 * - Audio streaming
 * - Tool call handling
 * - Latency tracking
 * 
 * TODO: Break down into smaller modules:
 * - response/text-processing.ts - Text chunking and deduplication
 * - response/tts-synthesis.ts - TTS synthesis orchestration
 * - response/tool-handling.ts - Tool call processing
 * - response/completion.ts - Response completion and metrics
 */

import { ServerWebSocket } from 'bun';
import { generateEventId, generateItemId, generateResponseId, ConversationItem } from '../../lib/protocol';
import { buildSystemPrompt } from '../../config/env';
import { TextChunker } from '../../lib/text-chunking';
import { SessionManager } from '../SessionManager';
import { getSpeechMode } from '../../constants';
import { concatenateAudio, createWavFile } from '../../lib/audio';
import { join } from 'path';
import { hasFileSystem } from '../../lib/runtime';
import { selectVoiceForLanguageChange } from '../../lib/voice-selector';
import { SoundbirdAgent } from '../../services/agent-provider';
import { AgentFactory } from '../../services/agents';
import { config } from '../../config/env';

import { getEventSystem, EventCategory } from '../../events';
// Import types
import type { SessionData, ResponseLatencyMetrics } from '../types';

// Import utilities
// Removed normalizeSpokenText import - no longer needed (replaced by AI-driven filter)
import { ResponseFilterService } from '../../services/response-filter';
import type { ResponseFilterConfig } from '../../services/response-filter';
import type { LanguageDetectionResult } from '../../services/language/LanguageDetectionService';
import { synthesizeTextWithProvider } from '../utils/audio-utils';
import { getServiceForTrace, removeService } from '../../lib/agent-analytics';
import { injectSpeakToolIntoSessionTools } from '../utils/tools';
import { serverToolRegistry, type ServerToolContext } from '../../lib/server-tool-registry';
import { registerServerTools } from '../../lib/server-tools';
import { convertSessionToolsToProxyTools } from '../../lib/client-tool-proxy';
import { buildToolsForAgent } from '../../lib/tools/tool-builder';
import { isSubagentModeEnabled } from '../../config/env';
import { detectFatalLLMError, sendError, sendStructuredError } from '../utils/errors';
import { formatToolsForRetryError } from '../../lib/tool-repairer';
// Import acknowledgement and typing sound services
import { AcknowledgementResponseService } from '../../services/acknowledgement';
import { TypingSoundService } from '../../services/typing-sound';
import {
  sendResponseCreated,
  sendOutputItemAdded,
  sendContentPartAdded,
  sendTextDelta,
  sendTextDone,
  sendAudioTranscriptDelta,
  sendAudioTranscriptDone,
  sendAudioDelta,
  sendAudioDone,
  sendOutputItemDone,
  sendResponseDone,
} from '../utils/event-sender';
import { tryEmitResponseCancelled } from './response-turn-scope';

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

/**
 * Generate AI response with streaming TTS and tool support
 */
export async function generateResponse(ws: ServerWebSocket<SessionData>, options?: any): Promise<void> {
  const data = ws.data;
  // End any in-flight turn so the previous `generateResponse` stream observes
  // this scope's `AbortSignal` on the next chunk (replaces ad-hoc id equality checks).
  data.responseTurnAbort?.abort();
  const turnAbort = new AbortController();
  data.responseTurnAbort = turnAbort;
  const responseId = generateResponseId();
  data.currentResponseId = responseId;

  const ttsConfig = data.runtimeConfig?.providers?.tts?.config as Record<string, unknown> | undefined;
  const providerDefaultVoice = typeof ttsConfig?.voice === 'string' ? ttsConfig.voice : undefined;
  
  // Initialize response filter service (enabled by default)
  // This replaces the old algorithmic TextDeduplicator with AI-driven filtering
  // Filter LLM uses Groq (GPT-OSS 20B), so we need Groq API key
  const groqApiKey = data.runtimeConfig?.llm.provider === 'groq' 
    ? data.runtimeConfig.llm.apiKey 
    : (data.runtimeConfig?.providers?.stt?.provider === 'groq-whisper'
      ? (data.runtimeConfig.providers.stt.config as Record<string, unknown>)?.apiKey as string | undefined
      : undefined); // Fallback to STT Groq key if available
  
  // Response filter (post-filter) - enabled by default
  // Uses algorithmic pre-filtering + LLM deduplication for duplicate detection
  const filterEnabled = data.runtimeConfig?.responseFilter?.enabled ?? true;
  
  // Get current language from language detection system
  const currentTargetLanguage = data.language?.current || 
                                data.language?.detected || 
                                data.language?.configured ||
                                data.runtimeConfig?.responseFilter?.targetLanguage;
  
  // Initialize filter config and service if enabled
  const filterConfig: ResponseFilterConfig | null = filterEnabled && groqApiKey ? {
    enabled: true,
    targetLanguage: currentTargetLanguage,
    filterModel: data.runtimeConfig?.responseFilter?.filterModel || 'openai/gpt-oss-20b',
    groqApiKey,
    lastUserMessage: data.lastUserMessage,
    maxRecentChunks: data.runtimeConfig?.responseFilter?.maxRecentChunks || 10,
    mode: data.runtimeConfig?.responseFilter?.mode || 'both',
  } : null;
  
  const responseFilter = filterConfig ? new ResponseFilterService(filterConfig.maxRecentChunks) : null;
  
  // Send response.created event
  // CRITICAL: This must be sent BEFORE any response.output_audio.delta events
  // The SDK needs this to set #ongoingResponse = true for interrupts to work
  sendResponseCreated(ws, responseId);
  getEventSystem().info(EventCategory.SESSION, `📤 Sent response.created: ${responseId}`);
  getEventSystem().info(EventCategory.LLM, `🔍 [Response] After response.created, continuing execution...`);
  
  // Debug: Log agent availability
  const hasAgent = !!(data.newAgent || data.agent);
  getEventSystem().info(EventCategory.LLM, `🔍 [Debug] Agent check: hasAgent=${hasAgent}, newAgent=${!!data.newAgent}, agent=${!!data.agent}, useAgentMode=${data.useAgentMode}`);
  getEventSystem().info(EventCategory.LLM, `🔍 [Response] About to check subagent mode...`);
  
  // Get configuration (needed before acknowledgement service)
  // Get base voice from options or session config
  const baseVoice = options?.voice || data.config.voice || providerDefaultVoice || 'Ashley';
  
  // Dynamically select voice based on current language, maintaining gender preference
  const currentLanguage = data.language?.current || 
                         data.language?.configured || 
                         'en';
  
  // Select appropriate voice for current language (maintains gender preference from initial voice)
  // Pass baseVoice as both initialVoice (for gender detection) and currentVoice (to check if already appropriate)
  const voice = selectVoiceForLanguageChange(
    currentLanguage,
    baseVoice, // Use base voice to determine gender preference
    baseVoice, // Fallback to base voice
    baseVoice // Check if base voice is already appropriate for current language
  );
  const speakingRate = data.config.speaking_rate; // Use session config speaking rate if set
  
  getEventSystem().info(EventCategory.LLM, `🔍 [Response] Voice selected: ${voice}, speakingRate: ${speakingRate}`);
  getEventSystem().info(EventCategory.LLM, `🔍 [Response] About to check acknowledgement service...`);
  
  // Start acknowledgement monitoring (if enabled)
  // This will send "okay" or similar after 300ms if no response yet
  if (data.acknowledgementService && data.providers) {
    getEventSystem().info(EventCategory.LLM, `🔍 [Response] Acknowledgement service enabled, starting monitoring...`);
    // Set callback to start typing sounds after acknowledgement
    if (data.typingSoundService) {
      data.acknowledgementService.setOnAcknowledgementSent((ackResponseId: string) => {
        data.typingSoundService!.startPlaying(ws, ackResponseId);
      });
    }
    await data.acknowledgementService.startMonitoring(
      ws,
      responseId,
      data.providers,
      voice,
      speakingRate
    );
    getEventSystem().info(EventCategory.LLM, `🔍 [Response] Acknowledgement monitoring started`);
  } else {
    getEventSystem().info(EventCategory.LLM, `🔍 [Response] Acknowledgement service disabled or providers not available`);
  }
  
  getEventSystem().info(EventCategory.LLM, `🔍 [Response] About to initialize latency metrics...`);
  // Initialize latency metrics storage for this response
  if (!data.latencyMetrics) {
    data.latencyMetrics = {
      currentResponse: undefined,
      historical: [],
    };
  }
  
  // Create new metrics object for this response
  const metrics: ResponseLatencyMetrics = {
    responseId,
    timestamp: Date.now(),
  };
  data.latencyMetrics.currentResponse = metrics;
  
  // Latency tracking (internal, stored in-memory)
  const latency = {
    responseStart: Date.now(),
    asrStart: 0,
    asrEnd: 0,
    llmStreamStart: 0,
    llmFirstToken: 0,
    llmStreamEnd: 0,
    llmTokenCount: 0,
    firstAudioSent: 0,
    ttsChunks: [] as Array<{ text: string; start: number; end: number }>,
    responseEnd: 0,
  };
  
  // Create output item ID (needed for toolContext)
  const itemId = generateItemId();
  
  // Register server tools for this session (must be done before tool conversion)
  const toolContext: ServerToolContext = {
    ws,
    sessionData: data,
    responseId,
    itemId,
    voice,
    speakingRate: speakingRate || 1.0,
    latency,
  };
  getEventSystem().info(EventCategory.LLM, `🔍 [Response] About to register server tools...`);
  registerServerTools(toolContext);
  getEventSystem().info(EventCategory.LLM, `🔍 [Response] Server tools registered`);
  
  // Check if subagent mode is enabled
  getEventSystem().info(EventCategory.LLM, `🔍 [Response] About to call isSubagentModeEnabled...`);
  let subagentMode: boolean;
  try {
    subagentMode = isSubagentModeEnabled(data.runtimeConfig);
    getEventSystem().info(EventCategory.LLM, `🔍 [Response] isSubagentModeEnabled returned: ${subagentMode}`);
  } catch (error) {
    getEventSystem().error(EventCategory.LLM, `❌ [Response] Error calling isSubagentModeEnabled:`, error);
    subagentMode = false; // Default to false on error
  }
  getEventSystem().info(EventCategory.LLM, `🔍 [Response] subagentMode: ${subagentMode}`);
  
  // Use pre-parsed instructions from SessionData (parsed in session-update.ts)
  // Instructions are parsed every time session.update is called, so they're always current
  const mainInstructions = data.config.instructions || '';
  const toolInstructions = data.subagentToolInstructions || '';
  getEventSystem().info(EventCategory.LLM, `🔍 [Response] mainInstructions.length: ${mainInstructions.length}, toolInstructions.length: ${toolInstructions.length}`);
  
  // Get configuration (voice and speakingRate already defined above)
  const userInstructions = options?.instructions || mainInstructions;
  const speechMode = getSpeechMode(data.runtimeConfig);
  const targetLanguage = data.language?.current || data.language?.detected || null;
  
  // Build system prompt based on mode
  // In subagent mode, main agent gets main_instructions only
  // In normal mode, all instructions go to main agent
  const instructions = buildSystemPrompt(userInstructions, data.agentType, speechMode, targetLanguage);
  
  // Pass system instructions to filter config so restrictions are enforced
  // This allows the filter to enforce any abstract restrictions (e.g., "only speak in English", "use Shakespearean language")
  if (filterConfig && instructions) {
    filterConfig.systemInstructions = instructions;
    getEventSystem().debug(EventCategory.RESPONSE_FILTER,
      `📋 [Filter] System instructions passed to filter for restriction enforcement`);
  }
  
  // Create output item (itemId already generated above)
  const outputItem: ConversationItem = {
    id: itemId,
    type: 'message',
    status: 'in_progress',
    role: 'assistant',
    content: [],
  };
  
  // Send response.output_item.added
  sendOutputItemAdded(ws, responseId, 0, outputItem);
  
  // Add text content part
  sendContentPartAdded(ws, responseId, itemId, 0, 0, { type: 'text', text: '' });
  
  try {
    getEventSystem().info(EventCategory.LLM, `🔍 [Response] Inside try block, starting message building...`);
    // Format conversation history including function calls and outputs
    // For Agent mode, we build messages directly without formatConversationHistory
    // to ensure exact AI SDK v5 compliance
    // Also extract token counts from ConversationItem for accurate context truncation
    const messageTokenCounts = new Map<number, { promptTokens: number; completionTokens?: number; totalTokens: number }>();
    getEventSystem().info(EventCategory.LLM, `🔍 [Response] conversationHistory.length: ${data.conversationHistory.length}`);
    const messages = data.conversationHistory.map((item, index) => {
      // Extract token counts from ConversationItem if available
      if (item.tokens) {
        messageTokenCounts.set(index, {
          promptTokens: item.tokens.prompt || 0,
          completionTokens: item.tokens.completion,
          totalTokens: item.tokens.total || (item.tokens.prompt || 0) + (item.tokens.completion || 0),
        });
      }
      
      if (item.type === 'function_call') {
        // AI SDK v5 format: assistant message with tool-call content
        // Note: Must use 'input' not 'args' for AI SDK v5
        return {
          role: 'assistant' as const,
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: item.call_id,
              toolName: item.name,
              input: JSON.parse(item.arguments || '{}'), // 'input' not 'args'
            }
          ],
        };
      } else if (item.type === 'function_call_output') {
        // AI SDK v5 format: tool message with tool-result content
        // CRITICAL: output must be a discriminated union with 'type' field!
        // Valid types: 'text', 'json', 'error-text', 'error-json', 'content'
        
        // Validate required fields
        if (!item.call_id) {
          getEventSystem().warn(EventCategory.SESSION, `⚠️ [MessageFormat] function_call_output missing call_id, skipping`);
          // Return a dummy message to maintain array structure
          return {
            role: 'user' as const,
            content: '[Tool result missing call_id]',
          };
        }
        
        if (!item.name) {
          getEventSystem().warn(EventCategory.SESSION, `⚠️ [MessageFormat] function_call_output missing name for call_id: ${item.call_id}`);
        }
        
        let outputValue: any;
        const outputStr = item.output || '';
        
        // Check if this is an error message
        const isError = outputStr.includes('error occurred') || 
                       outputStr.includes('Error:') || 
                       outputStr.includes('failed');
        
        try {
          // Try to parse as JSON first
          const parsed = outputStr ? JSON.parse(outputStr) : {};
          // Wrap in AI SDK v5 format
          outputValue = isError 
            ? { type: 'error-json', value: parsed }
            : { type: 'json', value: parsed };
          getEventSystem().info(EventCategory.SESSION, `🔄 Transformed tool result to ${outputValue.type} format`);
        } catch {
          // If not valid JSON, treat as text or error-text
          outputValue = isError
            ? { type: 'error-text', value: outputStr }
            : { type: 'text', value: outputStr };
          getEventSystem().info(EventCategory.SESSION, `🔄 Transformed tool result to ${outputValue.type} format`);
        }
        
        const toolMessage = {
          role: 'tool' as const,
          content: [
            {
              type: 'tool-result' as const,
              toolCallId: item.call_id!,
              toolName: item.name || 'unknown', // Fallback to 'unknown' if missing
              output: outputValue, // Must be discriminated union for AI SDK v5
            }
          ],
        };
        
        getEventSystem().debug(EventCategory.SESSION, `🔍 [MessageFormat] Created tool message:`, {
          toolCallId: item.call_id,
          toolName: item.name || 'unknown',
          outputType: outputValue.type,
        });
        
        return toolMessage;
      }
      // Regular message content
      // Handle content: it can be an array of ContentPart, a string, or undefined
      let contentValue: string = '';
      if (Array.isArray(item.content)) {
        contentValue = item.content.map(c => c.text || c.transcript || '').join(' ') || '';
      } else if (typeof item.content === 'string') {
        contentValue = item.content;
      }
      
      return {
        role: (item.role || 'user') as 'user' | 'system' | 'assistant',
        content: contentValue,
      };
    });
    
    // Log tool results in messages for verification
    const toolResultMessages = messages.filter(m => 
      Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool-result')
    );
    if (toolResultMessages.length > 0) {
      getEventSystem().info(EventCategory.LLM, `🔍 [Response] Messages include ${toolResultMessages.length} tool result(s):`);
      toolResultMessages.forEach((msg, idx) => {
        const toolResult = (msg.content as any[]).find((c: any) => c.type === 'tool-result');
        if (toolResult) {
          const outputPreview = typeof toolResult.output === 'string' 
            ? toolResult.output.substring(0, 100)
            : JSON.stringify(toolResult.output).substring(0, 100);
          getEventSystem().info(EventCategory.LLM, `  ${idx + 1}. ${toolResult.toolName} (${toolResult.toolCallId}): ${outputPreview}...`);
        }
      });
    } else {
      getEventSystem().info(EventCategory.LLM, `🔍 [Response] No tool results found in messages array`);
    }
    
    // Log full message structure for debugging parsing errors
    getEventSystem().debug(EventCategory.LLM, `🔍 [Response] Full messages structure (first 3 messages):`);
    messages.slice(0, 3).forEach((msg, idx) => {
      getEventSystem().debug(EventCategory.LLM, `  [${idx}] role: ${msg.role}, content type: ${Array.isArray(msg.content) ? 'array[' + msg.content.length + ']' : typeof msg.content}`);
      if (Array.isArray(msg.content)) {
        msg.content.forEach((c: any, cIdx: number) => {
          getEventSystem().debug(EventCategory.LLM, `    [${cIdx}] type: ${c.type}, toolCallId: ${c.toolCallId || 'N/A'}, toolName: ${c.toolName || 'N/A'}`);
        });
      }
    });
    
    getEventSystem().info(EventCategory.LLM, `🔍 [Response] Finished building messages, about to prepare tools...`);
    
    /**
     * TOOL ROUTING ARCHITECTURE
     * 
     * Normal Mode:
     *   Main Agent → sees all tools (client + server)
     *   Client tools → forwarded to client via WebSocket
     *   Server tools → executed server-side
     * 
     * Subagent Mode:
     *   Main Agent → sees ONLY askSubagent
     *   Subagent → sees ONLY client tools (with execute functions)
     *   Client tools → forwarded to client, result returned to subagent
     *   Server tools → NOT visible to subagent
     */
    
    // Prepare tools for agent based on mode using centralized tool builder
    let toolsForAgent: Record<string, any>;
    let sessionToolsForAgent: any[];
    let systemInstructions: string;
    
    getEventSystem().info(EventCategory.LLM, `🔍 [Response] About to check subagentMode (value: ${subagentMode})...`);
    
    // Get speech mode to determine if we need to inject speak tool
    const speechModeForTools = getSpeechMode(data.runtimeConfig);
    
    // Prepare session tools (inject speak tool in explicit mode)
    const baseSessionTools = data.config.tools || [];
    
    // Debug: Log full tool details to diagnose empty arguments issue
    getEventSystem().debug(EventCategory.SESSION, `🔧 [Response] baseSessionTools count: ${baseSessionTools.length}`);
    baseSessionTools.forEach((tool: any, idx: number) => {
      getEventSystem().debug(EventCategory.SESSION, `🔧 [Response] Tool[${idx}] "${tool.name}":`, {
        type: tool.type,
        hasDescription: !!tool.description,
        hasParameters: !!tool.parameters,
        parametersType: tool.parameters?.type,
        parametersPropertiesKeys: tool.parameters?.properties ? Object.keys(tool.parameters.properties) : [],
        parametersRequired: tool.parameters?.required || [],
        fullParameters: tool.parameters ? JSON.stringify(tool.parameters).substring(0, 300) : 'undefined',
      });
    });
    
    const sessionToolsWithSpeak = speechModeForTools === 'explicit' 
      ? injectSpeakToolIntoSessionTools(baseSessionTools)
      : baseSessionTools;
    
    if (subagentMode) {
      // Subagent mode: Main agent ONLY sees askSubagent
      getEventSystem().info(EventCategory.LLM, `🤖 [Subagent Mode] Main agent tools: askSubagent only`);
      
      // Build tool set using centralized builder
      // CRITICAL: Pass 'subagent' mode to get subagent-mode behavior (only askSubagent for main agent)
      const toolSet = buildToolsForAgent(sessionToolsWithSpeak, toolContext, 'subagent');
      
      // Merge server and client tools (in subagent mode, only server tools exist)
      toolsForAgent = {
        ...toolSet.serverTools,
        ...toolSet.clientTools,
      };
      
      // Create sessionTools array with askSubagent definition (OpenAI format for agent)
      const askSubagentToolDef = serverToolRegistry.getToolDefinition('askSubagent');
      sessionToolsForAgent = askSubagentToolDef ? [{
        type: 'function',
        name: 'askSubagent',
        description: askSubagentToolDef.description,
        parameters: askSubagentToolDef.parameters,
      }] : [];
      
      // Main agent gets main_instructions only
      systemInstructions = mainInstructions;
      
      // tool_instructions already stored in SessionData (parsed in session-update.ts)
      // Used when askSubagent is called
    } else {
      // Normal mode: All tools available
      getEventSystem().info(EventCategory.LLM, `🤖 [Normal Mode] All tools available`);
      
      // Build tool set using centralized builder
      const toolSet = buildToolsForAgent(sessionToolsWithSpeak, toolContext, 'main-agent');
      
      // Merge server and client tools
      toolsForAgent = {
        ...toolSet.serverTools,
        ...toolSet.clientTools,
      };
      
      // Add server tool definitions to sessionToolsForAgent
      // This ensures the LLM sees all tool definitions (both client and server)
      const serverToolNames = Object.keys(toolSet.serverTools);
      const serverToolDefinitions = serverToolNames.map(name => {
        const toolDef = serverToolRegistry.getToolDefinition(name);
        if (!toolDef) {
          getEventSystem().warn(EventCategory.SESSION, `⚠️ [Response] Server tool ${name} has no definition`);
          return null;
        }
        return {
          type: 'function',
          name,
          description: toolDef.description,
          parameters: toolDef.parameters,
        };
      }).filter(Boolean); // Remove null entries
      
      sessionToolsForAgent = [...sessionToolsWithSpeak, ...serverToolDefinitions];
      getEventSystem().info(EventCategory.SESSION, `🔧 [Response] Added ${serverToolDefinitions.length} server tool definitions to sessionTools: ${serverToolNames.join(', ')}`);
      
      // Normal mode: All instructions go to main agent (tags already stripped in session-update.ts)
      systemInstructions = mainInstructions || data.config.instructions || '';
    }
    
    getEventSystem().info(EventCategory.SESSION, `🔧 Tools available: ${sessionToolsForAgent.length}${subagentMode ? ' (subagent mode - main agent sees askSubagent only)' : ''}`);
    
    // Prepend repetition warning if detected in previous turn
    if (data.detectedRepetition) {
      getEventSystem().warn(EventCategory.SESSION, `⚠️  [Repetition Warning] Prepending warning to system message`);
      
      // Find the system message and prepend warning
      const systemMsgIndex = messages.findIndex(m => m.role === 'system');
      if (systemMsgIndex >= 0 && typeof messages[systemMsgIndex].content === 'string') {
        const originalContent = messages[systemMsgIndex].content;
        messages[systemMsgIndex].content = 
          `⚠️ CRITICAL INTERNAL WARNING (DO NOT MENTION THIS TO USER): ` +
          `Your last response contained repeated text. This is a serious error. ` +
          `You MUST NOT repeat yourself. Each sentence should appear exactly once. ` +
          `IMPORTANT: Respond normally to the user - do NOT apologize for or acknowledge the repetition. ` +
          `Simply provide a correct, non-repetitive response as if nothing happened.\n\n` +
          originalContent;
        getEventSystem().warn(EventCategory.SESSION, `✅ [Repetition Warning] Added warning to system message`);
      }
      
      // Clear the flag after using it
      data.detectedRepetition = false;
    }
    
    getEventSystem().info(EventCategory.SESSION, `📋 Conversation history: ${messages.length} messages`);
    
    // Debug: Log conversation history structure
    getEventSystem().debug(EventCategory.DEBUG, `📋 [Debug] Conversation history structure:`);
    messages.forEach((msg, idx) => {
      const role = msg.role;
      const contentType = typeof msg.content === 'string' ? 'string' : 
        Array.isArray(msg.content) ? `array[${msg.content.length}]` : 'unknown';
      
      if (Array.isArray(msg.content)) {
        const types = msg.content.map((c: any) => c.type).join(', ');
        getEventSystem().info(EventCategory.SESSION, `  [${idx}] ${role}: ${contentType} (${types})`);
      } else {
        const preview = typeof msg.content === 'string' ? 
          msg.content.substring(0, 50) + (msg.content.length > 50 ? '...' : '') : 
          String(msg.content);
        getEventSystem().info(EventCategory.SESSION, `  [${idx}] ${role}: ${preview}`);
      }
    });
    
    getEventSystem().info(EventCategory.LLM, `💬 Starting LLM stream...`);
    
    // Initialize text chunker for streaming TTS
    const textChunker = new TextChunker();
    let fullText = '';
    let audioStarted = false;
    const allAudioChunks: Uint8Array[] = [];
    let toolCalled = false;
    let serverToolCalled = false; // Track if a server tool (like setLanguage) was called
    let llmFirstTokenReceived = false;
    let responseFinalized = false;
    /** Token usage from LLM provider (captured from usage events) */
    let tokenUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null = null;

    const logResponseDebug = (
      stage: string,
      extra: Record<string, unknown> = {},
      category: EventCategory = EventCategory.SESSION,
    ): void => {
      const details = {
        responseId,
        currentResponseId: data.currentResponseId,
        turnAborted: turnAbort.signal.aborted,
        itemId,
        fullTextLength: fullText.length,
        audioStarted,
        streamedAudioChunkCount: allAudioChunks.length,
        toolCalled,
        serverToolCalled,
        llmFirstTokenReceived,
        firstAudioSentAt: latency.firstAudioSent || null,
        ...extra,
      };

      getEventSystem().warn(category, `🔬 [Response Debug] ${stage} :: ${JSON.stringify(details)}`);
    };

    const finalizeCancelledResponse = (reason: 'client_cancelled' | 'turn_detected' = 'client_cancelled'): void => {
      if (responseFinalized) {
        return;
      }

      responseFinalized = true;
      tryEmitResponseCancelled(ws, responseId, reason);
    };
    
    // Stream LLM response with tool support
    latency.llmStreamStart = Date.now();
    
    getEventSystem().info(EventCategory.LLM, `🚀 [Response] Starting LLM stream generation...`);
    getEventSystem().info(EventCategory.LLM, `🔍 [Response] subagentMode: ${subagentMode}`);
    getEventSystem().info(EventCategory.LLM, `🔍 [Response] sessionToolsForAgent.length: ${sessionToolsForAgent.length}`);
    getEventSystem().info(EventCategory.LLM, `🔍 [Response] systemInstructions.length: ${systemInstructions.length}`);
    
    // Track LLM start for the active turn
    if (data.turnTracker) {
      const turnTracker = data.turnTracker as any; // Avoid circular deps
      turnTracker.trackLLMStart();
    }
    
    getEventSystem().info(EventCategory.SESSION, `🤖 [LLM] Using model: ${data.model} (from ${data.model === 'moonshotai/kimi-k2-instruct-0905' ? 'default/token' : 'client session.update'})`);
    getEventSystem().info(EventCategory.LLM, `🤖 [LLM] Provider: ${data.runtimeConfig!.llm.provider}`);
    
    // Check if streaming is disabled via ENV
    const disableStreaming = data.runtimeConfig?.agent?.disableStreaming ?? false;
    getEventSystem().info(EventCategory.LLM, `🎛️  [LLM] Streaming Mode: ${disableStreaming ? 'DISABLED (buffered response)' : 'ENABLED (real-time streaming)'}`);
    
    // Agent Mode: Always use agent for LLM streaming
    // Note: Agent Mode uses the AI SDK Agent's built-in context management (prepareStep)
    // Absence of agent is considered a failure - we should never stream LLM response without an agent
    let llmStream;
    const hasAgent = !!(data.newAgent || data.agent);
    
    getEventSystem().info(EventCategory.LLM, `🔍 [Response] hasAgent: ${hasAgent}, newAgent: ${!!data.newAgent}, agent: ${!!data.agent}`);
    
    // CRITICAL: Absence of agent is a failure condition - we should never stream LLM response without an agent
    if (!hasAgent) {
      const errorMessage = 'No agent available - agent is required for response generation';
      getEventSystem().critical(EventCategory.LLM, `❌ [LLM] ${errorMessage}`);
      throw new Error(errorMessage);
    }
    
    // Agent Mode: Always use agent if it exists
    getEventSystem().info(EventCategory.LLM, `🤖 [LLM] Agent Mode: ENABLED ✅ (agent exists)`);
    // Agent Mode: Use modular agent (new) or SoundbirdAgent (old)
    // Pass structured messages array (not flattened prompt) so Agent can see tool calls/results
    getEventSystem().info(EventCategory.LLM, `🤖 [Agent Mode] Passing ${messages.length} messages to Agent`);
    
    // Count tool-related messages for debugging
    const toolCallMsgs = messages.filter(m => 
      Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool-call')
    );
    const toolResultMsgs = messages.filter(m => 
      Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool-result')
    );
    getEventSystem().info(EventCategory.LLM, `🤖 [Agent Mode] Messages include: ${toolCallMsgs.length} tool calls, ${toolResultMsgs.length} tool results`);
    
    if (data.newAgent) {
      // NEW: Use modular agent via ILLMAgent interface
      getEventSystem().info(EventCategory.LLM, `🏭 [Modular Agent] Using ${data.newAgent.getMetadata().type} agent`);
      
      // Pass context for system prompt generation (agent will call its generator function with this)
      // This ensures the system prompt is regenerated on each call with current language
      const targetLanguage = data.language?.current || data.language?.detected || null;
      
      // Log subagent mode and tools for debugging
      if (subagentMode) {
        getEventSystem().info(EventCategory.LLM, `🤖 [Subagent Mode] sessionToolsForAgent: ${JSON.stringify(sessionToolsForAgent)}`);
        getEventSystem().info(EventCategory.LLM, `🤖 [Subagent Mode] toolsForAgent keys: ${Object.keys(toolsForAgent).join(', ')}`);
        getEventSystem().info(EventCategory.LLM, `🤖 [Subagent Mode] systemInstructions length: ${systemInstructions.length}`);
      }
      
      // For CustomAgent, pass token counts for accurate context truncation
      // CustomAgent will use stored token counts from ConversationItem if available,
      // otherwise it will count tokens itself using experimental_tokenizer
      const streamOptions = {
        messages, // Pass structured messages array with tool calls and results
        sessionTools: sessionToolsForAgent, // Use tools based on mode (empty in subagent mode for main agent)
        temperature: data.agentConfig?.temperature, // undefined = provider optimized
        maxTokens: data.agentConfig?.maxTokens, // undefined = provider optimized
        frequencyPenalty: data.agentConfig?.frequencyPenalty, // undefined = provider default
        presencePenalty: data.agentConfig?.presencePenalty, // undefined = provider default
        repetitionPenalty: data.agentConfig?.repetitionPenalty, // undefined = provider default (OpenRouter-specific)
        traceId: data.currentTraceId, // Pass unified trace ID for agent analytics
        serverToolContext: toolContext, // Pass server tool context for merging server tools with execute functions
        systemPromptContext: {
          targetLanguage,
          userInstructions: systemInstructions, // Main instructions only in subagent mode
          agentType: data.agentType,
          speechMode,
        },
      };
      
      // Store token counts in CustomAgent instance if available
      // This allows CustomAgent to use actual token counts from ConversationItem
      // instead of counting tokens again (more efficient and accurate)
      if (messageTokenCounts.size > 0 && data.newAgent.getMetadata().type === 'custom') {
        (data.newAgent as any).messageTokenCounts = messageTokenCounts;
      }
      
      getEventSystem().info(EventCategory.LLM, `🚀 [Agent Stream] Starting agent.stream() call...`);
      try {
        llmStream = await data.newAgent.stream(streamOptions);
        getEventSystem().info(EventCategory.LLM, `✅ [Agent Stream] agent.stream() returned successfully`);
      } catch (streamError) {
        getEventSystem().error(EventCategory.LLM, `❌ [Agent Stream] agent.stream() failed:`, streamError);
        throw streamError;
      }
    } else if (data.agent) {
      // Use SoundbirdAgent (older implementation, still supported)
      getEventSystem().info(EventCategory.LLM, `🔧 [Agent] Using SoundbirdAgent`);
      
      llmStream = await data.agent.stream({
        messages, // Pass structured messages array with tool calls and results
        sessionTools: sessionToolsForAgent, // Use tools based on mode (empty in subagent mode for main agent)
        temperature: data.agentConfig?.temperature, // undefined = provider optimized
        maxTokens: data.agentConfig?.maxTokens, // undefined = provider optimized
        traceId: data.currentTraceId, // Pass unified trace ID for agent analytics
        serverToolContext: toolContext, // Pass server tool context for merging server tools with execute functions
      });
    } else {
      // This should never happen since we check hasAgent above, but TypeScript needs this
      const errorMessage = 'Agent exists but stream() method returned undefined';
      getEventSystem().critical(EventCategory.LLM, `❌ [LLM] ${errorMessage}`);
      throw new Error(errorMessage);
    }
    
    // Ensure llmStream is defined (TypeScript type narrowing)
    if (!llmStream) {
      const errorMessage = 'Failed to initialize LLM stream';
      getEventSystem().critical(EventCategory.LLM, `❌ [LLM] ${errorMessage}`);
      throw new Error(errorMessage);
    }
    
    for await (const part of llmStream) {
      // Turn scope cancelled (VAD, client cancel, or superseded by a newer response)
      if (turnAbort.signal.aborted) {
        getEventSystem().warn(
          EventCategory.SESSION,
          `⚠️ Response turn aborted: responseId=${responseId}`,
        );
        logResponseDebug('early return before processing LLM part', {
          partType: part.type,
          reason: 'turn aborted at stream loop top',
        });
        latency.responseEnd = Date.now();
        finalizeCancelledResponse();
        return;
      }
      
      if (part.type === 'text') {
        // Handle text delta
        getEventSystem().info(EventCategory.LLM, `📝 [Stream Delta] Received text delta: "${part.delta}"`);
        
        // Track first LLM token
        if (!llmFirstTokenReceived) {
          llmFirstTokenReceived = true;
          latency.llmFirstToken = Date.now();
          const ttft = latency.llmFirstToken - latency.llmStreamStart;
          getEventSystem().info(EventCategory.LLM, `⚡ First LLM token received: ${ttft}ms`);
        }

        // Check speech mode before TTS synthesis
        // In explicit mode, only synthesize from 'speak' tool, not from text
        // In implicit mode, synthesize all text (default behavior)
        const speechModeForTTS = getSpeechMode(data.runtimeConfig);
        const shouldSynthesizeText = speechModeForTTS !== 'explicit';
        getEventSystem().info(EventCategory.TTS, `🎤 [Speech Mode Check] speechMode="${speechModeForTTS}", shouldSynthesizeText=${shouldSynthesizeText}`);

        if (shouldSynthesizeText) {
          fullText += part.delta;

          // Send text delta (streaming mode only)
          sendTextDelta(ws, responseId, itemId, part.delta);

          // Add to text chunker and process ready chunks (streaming mode only)
          const readyChunks = textChunker.addText(part.delta);
          getEventSystem().info(EventCategory.AUDIO, `📦 [Text Chunker] Received ${readyChunks.length} ready chunk(s) from delta`);

          for (const textChunk of readyChunks) {
            if (textChunk.trim().length === 0) {
              getEventSystem().info(EventCategory.AUDIO, `⏭️  [Text Chunker] Skipping empty chunk`);
              continue;
            }

            // Filter chunk through response filter service (AI-driven deduplication)
            let filteredChunk = textChunk;
            let chunkSkipped = false;

            if (responseFilter && filterConfig) {
              try {
                filteredChunk = await responseFilter.filterChunk(textChunk, filterConfig);
                
                // If filter returns empty string, skip entire chunk
                if (filteredChunk === '') {
                  chunkSkipped = true;
                  getEventSystem().info(EventCategory.RESPONSE_FILTER,
                    `⏭️  [Filter] Chunk skipped (duplicate detected): "${textChunk.substring(0, 60)}..."`);
                  logResponseDebug('streaming chunk skipped by response filter', {
                    originalChunkLength: textChunk.length,
                    filteredChunkLength: filteredChunk.length,
                  }, EventCategory.RESPONSE_FILTER);

                  // Mark that we detected repetition for next LLM turn
                  if (!data.detectedRepetition) {
                    data.detectedRepetition = true;
                    getEventSystem().warn(EventCategory.LLM, `⚠️  [Filter] Flagging repetition for next LLM turn`);
                  }
                  continue; // Skip chunk entirely - don't send to client, don't synthesize
                }

                // Chunk passed filter, add to recent history
                responseFilter.addChunkToHistory(filteredChunk);
                getEventSystem().info(EventCategory.RESPONSE_FILTER,
                  `✅ [Filter] Chunk passed filter: "${filteredChunk.substring(0, 60)}..."`);
              } catch (error) {
                getEventSystem().warn(EventCategory.RESPONSE_FILTER,
                  `⚠️  [Filter] Error filtering chunk, using original:`, error);
                // On error, use original chunk (don't skip)
                filteredChunk = textChunk;
              }
            }

            // Use filtered chunk for TTS (or original if filter disabled/failed)
            const chunkToSynthesize = filteredChunk;

            // Check if response was cancelled (interrupt) - stop immediately before TTS synthesis
            if (turnAbort.signal.aborted) {
              getEventSystem().info(EventCategory.AUDIO, `⚡ Response ${responseId} cancelled during text chunking - stopping TTS`);
              logResponseDebug('early return before streaming TTS synthesis', {
                chunkLength: chunkToSynthesize.length,
                reason: 'turn aborted during text chunking',
              }, EventCategory.AUDIO);
              finalizeCancelledResponse();
              return;
            }

            const ttsStart = Date.now();
            
            // Track TTS start for the active turn (first chunk only)
            if (data.turnTracker && latency.ttsChunks.length === 0) {
              const turnTracker = data.turnTracker as any; // Avoid circular deps
              turnTracker.trackTTSStart();
            }
            getEventSystem().info(EventCategory.AUDIO, `🔊 Streaming TTS chunk: "${chunkToSynthesize.substring(0, 50)}..."`);

            // Start audio content part if not started
            if (!audioStarted) {
              audioStarted = true;
              logResponseDebug('starting audio content part for streaming response', {
                chunkLength: chunkToSynthesize.length,
              }, EventCategory.AUDIO);
              sendContentPartAdded(ws, responseId, itemId, 0, 1, { type: 'audio', transcript: '' });
            }

            // Synthesize chunk to audio using provider
            if (!data.providers) {
              data.providers = await SessionManager.getProviders(data.runtimeConfig!);
            }
            // Get current language from session state
            const currentLanguage = data.language?.current || 
                                   data.language?.configured || 
                                   'en';
            
            const voiceForTTS = data.config?.voice || voice;
            
            const audioChunks = await synthesizeTextWithProvider(
              data.providers,
              chunkToSynthesize, // Use filtered chunk
              voiceForTTS,
              speakingRate,
              data.currentTraceId, // Pass unified trace ID for agent analytics
              data.sessionId,
              data.sessionKey,
              'direct', // TODO: Detect connection paradigm
              currentLanguage // Use current language from session state
            );
            const ttsEnd = Date.now();
            latency.ttsChunks.push({ text: chunkToSynthesize.substring(0, 30), start: ttsStart, end: ttsEnd });
            getEventSystem().info(EventCategory.AUDIO, `⏱️  TTS synthesis: ${ttsEnd - ttsStart}ms for ${chunkToSynthesize.length} chars`);
            
            // Track TTS completion for the active turn (last chunk only)
            if (data.turnTracker && latency.ttsChunks.length === 1) {
              const turnTracker = data.turnTracker as any; // Avoid circular deps
              // Calculate total TTS duration from all chunks
              const totalTTSDuration = latency.ttsChunks.reduce((sum, chunk) => sum + (chunk.end - chunk.start), 0);
              turnTracker.trackTTSComplete();
            }

            // Check again after TTS synthesis completes (interrupt may have occurred during synthesis)
            if (turnAbort.signal.aborted) {
              getEventSystem().info(EventCategory.AUDIO, `⚡ Response ${responseId} cancelled after TTS synthesis - discarding audio`);
              logResponseDebug('early return after streaming TTS synthesis', {
                synthesizedAudioChunkCount: audioChunks.length,
                chunkLength: chunkToSynthesize.length,
                reason: 'turn aborted after TTS synthesis',
              }, EventCategory.AUDIO);
              finalizeCancelledResponse();
              return;
            }

            allAudioChunks.push(...audioChunks);

            // Send transcript delta (use filtered chunk)
            logResponseDebug('sending streaming audio transcript delta', {
              transcriptChunkLength: chunkToSynthesize.length,
              synthesizedAudioChunkCount: audioChunks.length,
            }, EventCategory.AUDIO);
            sendAudioTranscriptDelta(ws, responseId, itemId, chunkToSynthesize);

            // Stream audio chunks
            for (const chunk of audioChunks) {
              if (turnAbort.signal.aborted) {
                getEventSystem().info(EventCategory.AUDIO, `⚡ Response ${responseId} cancelled during audio streaming - stopping`);
                logResponseDebug('early return during streaming audio delta send', {
                  pendingChunkBytes: chunk.byteLength,
                  synthesizedAudioChunkCount: audioChunks.length,
                  reason: 'turn aborted during audio streaming',
                }, EventCategory.AUDIO);
                finalizeCancelledResponse();
                return;
              }

              // Track first audio sent for TTFS (user speech end → first AI audio sent)
              if (latency.firstAudioSent === 0) {
                latency.firstAudioSent = Date.now();
                const ttfs = data.speechEndTime ? latency.firstAudioSent - data.speechEndTime : 0;
                getEventSystem().info(EventCategory.AUDIO, `🎵 First audio sent: TTFS = ${ttfs}ms (user speech end → first AI audio)`);
                
                // Stop acknowledgement monitoring and typing sounds when actual audio starts
                if (data.acknowledgementService) {
                  data.acknowledgementService.stopMonitoring();
                }
                if (data.typingSoundService) {
                  data.typingSoundService.stopPlaying();
                }
              }

              sendAudioDelta(ws, responseId, itemId, chunk);
            }

            logResponseDebug('completed streaming audio delta batch', {
              synthesizedAudioChunkCount: audioChunks.length,
              transcriptChunkLength: chunkToSynthesize.length,
            }, EventCategory.AUDIO);
          }
        } else {
          // Explicit mode: send text delta but skip TTS synthesis
          // Text still sent to UI via response.text.delta events
          // Only speak tool output is synthesized to audio
          getEventSystem().info(EventCategory.SESSION, `🎤 [Explicit Mode] Sending text delta to UI only, skipping TTS`);
          fullText += part.delta;
          
          // Send text delta
          sendTextDelta(ws, responseId, itemId, part.delta);
        }
        
      } else if (part.type === 'tool_call') {
        // Tool call: log details, differentiate server vs client tools
        getEventSystem().info(EventCategory.SESSION, `🔧 Tool call requested: ${part.toolName}`);
        getEventSystem().info(EventCategory.SESSION, `📤 Tool call details (call_id: ${part.toolCallId}) - FULL UNTRUNCATED:`);
        // Log the full tool call with no truncation - critical for debugging
        const fullToolCall = { toolName: part.toolName, toolCallId: part.toolCallId, args: part.args };
        getEventSystem().info(EventCategory.SESSION, JSON.stringify(fullToolCall, null, 2));
        getEventSystem().info(EventCategory.SESSION, `📤 Raw args object:`, part.args);

        // Check if this is a server tool (executed server-side)
        // CRITICAL: Server tools are executed AUTOMATICALLY by the AI SDK via their execute functions
        // We do NOT manually execute them here - the SDK already ran them when it received the tool call
        // We need to add the function_call to history so tool-result can look it up
        if (serverToolRegistry.isServerTool(part.toolName, toolContext)) {
          getEventSystem().info(EventCategory.SESSION, `🖥️  [ServerTool] ${part.toolName} - AI SDK executed via tool's execute function (no manual execution needed)`);
          
          // Add function_call to conversation history so tool-result can look it up
          const serverToolCallItem: ConversationItem = {
            id: generateItemId(),
            type: 'function_call',
            status: 'completed',
            role: 'assistant',
            name: part.toolName,
            call_id: part.toolCallId,
            arguments: part.args !== undefined ? JSON.stringify(part.args) : '{}',
          };
          data.conversationHistory.push(serverToolCallItem);
          getEventSystem().info(EventCategory.SESSION, `📝 [ServerTool] Added function_call to history for ${part.toolName} (call_id: ${part.toolCallId})`);
          
          // DON'T set toolCalled=true for server tools - they complete synchronously within the stream
          // The LLM continues generating after server tool execution, so we need to save the response to history
          serverToolCalled = true; // Track that a server tool was called (for empty response detection)
          
          // Log warning for setLanguage to help diagnose if AI stops after tool call
          if (part.toolName === 'setLanguage') {
            getEventSystem().warn(EventCategory.LLM, `⚠️ [setLanguage Tool] AI called setLanguage - watching if generation continues or stops...`);
          }
          
          continue;
        }

        // CLIENT TOOL: Set toolCalled flag - we'll break and wait for client to send tool output
        // This causes early return at end of function, which is correct for client tools
        toolCalled = true;

        // Non-speak tools in explicit mode: send tool call but don't synthesize audio
        if (data.speechMode === 'explicit' && part.toolName !== 'speak') {
          getEventSystem().info(EventCategory.TTS, `🎤 [Explicit Mode] Non-speak tool call: ${part.toolName} (no TTS)`);
        }

        // Create function_call item (OpenAI Realtime API format)
        // CRITICAL: arguments must be a string (JSON-encoded), never undefined
        // JSON.stringify(undefined) returns undefined, which breaks OpenAI SDK validation
        const functionCallItem: ConversationItem = {
          id: generateItemId(),
          type: 'function_call',
          status: 'completed',
          role: 'assistant',
          name: part.toolName,
          call_id: part.toolCallId,
          arguments: part.args !== undefined ? JSON.stringify(part.args) : '{}',
        };

        // Add to conversation history
        data.conversationHistory.push(functionCallItem);

        // Send as response.output_item.added event (SDK will emit function_call event)
        sendOutputItemAdded(ws, responseId, 1, functionCallItem);

        // Stop generating - wait for client to send tool output and response.create
        break;
      } else if (part.type === 'tool-result') {
        // Tool result from AI SDK - server tools are executed automatically
        // We use this to update conversation history for server tools
        const toolResultPart = part as any; // AI SDK tool-result part
        
        getEventSystem().info(EventCategory.SESSION, `📥 [ToolResult] Received result for: ${toolResultPart.toolName} (call_id: ${toolResultPart.toolCallId})`);
        
        // Only add to conversation history for server tools
        if (serverToolRegistry.isServerTool(toolResultPart.toolName, toolContext)) {
          // Check if function_call already exists (might have been added during tool_call handler)
          const existingCall = data.conversationHistory.find(
            item => item.type === 'function_call' && item.call_id === toolResultPart.toolCallId
          );
          
          if (!existingCall) {
            // Add tool call to conversation history
            const serverToolCallItem: ConversationItem = {
              id: generateItemId(),
              type: 'function_call',
              status: 'completed',
              role: 'assistant',
              name: toolResultPart.toolName,
              call_id: toolResultPart.toolCallId,
              // CRITICAL: arguments must be a string, never undefined
              arguments: JSON.stringify(toolResultPart.args || toolResultPart.input || {}),
            };
            data.conversationHistory.push(serverToolCallItem);
            getEventSystem().info(EventCategory.SESSION, `📝 [ToolResult] Added function_call to history for ${toolResultPart.toolName}`);
          }
          
          // Check if result already exists (avoid duplicates)
          const existingResult = data.conversationHistory.find(
            item => item.type === 'function_call_output' && item.call_id === toolResultPart.toolCallId
          );
          
          if (existingResult) {
            getEventSystem().info(EventCategory.SESSION, `⚠️ [ToolResult] Result already exists for call_id: ${toolResultPart.toolCallId}, skipping`);
            continue;
          }
          
          // Get the result output
          const output = toolResultPart.result || toolResultPart.output;
          
          // For askSubagent, extract the response text
          if (toolResultPart.toolName === 'askSubagent') {
            const responseText = output?.response || output?.data?.response || 
              (typeof output === 'string' ? output : JSON.stringify(output));
            
            const subagentResultItem: ConversationItem = {
              id: generateItemId(),
              type: 'function_call_output',
              status: 'completed',
              role: 'tool',
              name: toolResultPart.toolName,
              call_id: toolResultPart.toolCallId,
              output: responseText,
            };
            data.conversationHistory.push(subagentResultItem);
            getEventSystem().info(EventCategory.SESSION, `📝 [Subagent] Added result to conversation: "${String(responseText).substring(0, 100)}..."`);
          } else {
            // For other server tools
            const toolResultItem: ConversationItem = {
              id: generateItemId(),
              type: 'function_call_output',
              status: 'completed',
              role: 'tool',
              name: toolResultPart.toolName,
              call_id: toolResultPart.toolCallId,
              output: typeof output === 'string' ? output : JSON.stringify(output),
            };
            data.conversationHistory.push(toolResultItem);
          }
          
          getEventSystem().info(EventCategory.SESSION, `✅ [ServerTool] ${toolResultPart.toolName} result added to conversation history`);
        }
        // Client tool results are handled via function_call_output events from the client
        
      } else if (part.type === 'tool_result') {
        // Tool result from CustomAgent (uses underscore instead of hyphen)
        // CustomAgent doesn't include toolName, so we need to look it up from conversation history
        const toolResultPart = part as any;
        
        getEventSystem().info(EventCategory.SESSION, `📥 [ToolResult] Received tool_result for call_id: ${toolResultPart.toolCallId}`);
        
        // Look up the tool name from conversation history using toolCallId
        const matchingCall = data.conversationHistory.find(
          item => item.type === 'function_call' && item.call_id === toolResultPart.toolCallId
        );
        
        if (!matchingCall) {
          getEventSystem().warn(EventCategory.SESSION, `⚠️ [ToolResult] No matching function_call found for call_id: ${toolResultPart.toolCallId}`);
          continue;
        }
        
        const toolName = matchingCall.name;
        getEventSystem().info(EventCategory.SESSION, `📥 [ToolResult] Found tool name: ${toolName} for call_id: ${toolResultPart.toolCallId}`);
        
        // Only add to conversation history for server tools
        if (serverToolRegistry.isServerTool(toolName, toolContext)) {
          // Check if we already added the function_call (might have been added during tool_call handler)
          const existingCall = data.conversationHistory.find(
            item => item.type === 'function_call' && item.call_id === toolResultPart.toolCallId
          );
          
          if (!existingCall) {
            // Add tool call to conversation history (shouldn't happen, but safety check)
            const serverToolCallItem: ConversationItem = {
              id: generateItemId(),
              type: 'function_call',
              status: 'completed',
              role: 'assistant',
              name: toolName,
              call_id: toolResultPart.toolCallId,
              arguments: matchingCall.arguments || '{}',
            };
            data.conversationHistory.push(serverToolCallItem);
            getEventSystem().info(EventCategory.SESSION, `📝 [ToolResult] Added function_call to history for ${toolName}`);
          }
          
          // Check if we already added the result (avoid duplicates)
          const existingResult = data.conversationHistory.find(
            item => item.type === 'function_call_output' && item.call_id === toolResultPart.toolCallId
          );
          
          if (existingResult) {
            getEventSystem().info(EventCategory.SESSION, `⚠️ [ToolResult] Result already exists for call_id: ${toolResultPart.toolCallId}, skipping`);
            continue;
          }
          
          // Get the result output
          const output = toolResultPart.result || toolResultPart.output;
          
          // For askSubagent, extract the response text
          if (toolName === 'askSubagent') {
            const responseText = output?.response || output?.data?.response || 
              (typeof output === 'string' ? output : JSON.stringify(output));
            
            const subagentResultItem: ConversationItem = {
              id: generateItemId(),
              type: 'function_call_output',
              status: 'completed',
              role: 'tool',
              name: toolName,
              call_id: toolResultPart.toolCallId,
              output: responseText,
            };
            data.conversationHistory.push(subagentResultItem);
            getEventSystem().info(EventCategory.SESSION, `📝 [Subagent] Added result to conversation: "${String(responseText).substring(0, 100)}..."`);
          } else {
            // For other server tools (like setLanguage)
            const toolResultItem: ConversationItem = {
              id: generateItemId(),
              type: 'function_call_output',
              status: 'completed',
              role: 'tool',
              name: toolName,
              call_id: toolResultPart.toolCallId,
              output: typeof output === 'string' ? output : JSON.stringify(output),
            };
            data.conversationHistory.push(toolResultItem);
            getEventSystem().info(EventCategory.SESSION, `✅ [ServerTool] ${toolName} result added to conversation history: "${String(output).substring(0, 100)}..."`);
          }
        }
        // Client tool results are handled via function_call_output events from the client
        
      } else if (part.type === 'usage') {
        // Real token usage data from the provider
        // Store complete token usage for performance metrics and analytics
        tokenUsage = {
          promptTokens: part.promptTokens,
          completionTokens: part.completionTokens,
          totalTokens: part.totalTokens,
        };
        
        // Update latency metrics with total tokens (for tokens/second calculation)
        latency.llmTokenCount = part.totalTokens;
        
        getEventSystem().info(EventCategory.LLM, `📊 [Token Tracking] Usage event - Prompt: ${part.promptTokens}, Completion: ${part.completionTokens}, Total: ${part.totalTokens}`);
      } else if (part.type === 'error') {
        // Handle error parts from the stream
        const streamError = part.error;
        const errorMessage = formatUnknownError(streamError);
        
        getEventSystem().critical(EventCategory.LLM, `🚨 [Response Generation] Stream error part received: ${errorMessage}`);
        getEventSystem().error(EventCategory.LLM, `🔍 Error details:`, streamError);
        
        // Throw error so it's caught by the try-catch block below
        // This ensures proper error handling, socket closure, and error message sending
        throw new Error(errorMessage);
      }
    }
    
    latency.llmStreamEnd = Date.now();
    const llmDuration = latency.llmStreamEnd - latency.llmStreamStart;
    
    // Track LLM completion for the active turn
    if (data.turnTracker) {
      const turnTracker = data.turnTracker as any; // Avoid circular deps
      turnTracker.trackLLMComplete();
    }
    
    // Use tokenUsage if available (from usage event), otherwise fall back to latency.llmTokenCount
    const totalTokens = tokenUsage?.totalTokens || latency.llmTokenCount || 0;
    const promptTokens = tokenUsage?.promptTokens || 0;
    const completionTokens = tokenUsage?.completionTokens || 0;
    
    // Track LLM tool usage for the active turn
    // Only track when tools were called - token cost of tool definitions, args, and results
    if (data.turnTracker && totalTokens > 0 && (serverToolCalled || toolCalled)) {
      const turnTracker = data.turnTracker as any; // Avoid circular deps
      turnTracker.trackLLMToolUsage(totalTokens);
    }
    
    // Calculate tokens per second using total tokens (input + output)
    const tokensPerSecond = totalTokens > 0 && llmDuration > 0
      ? (totalTokens / (llmDuration / 1000)).toFixed(1)
      : '0';
    
    getEventSystem().info(EventCategory.LLM, `⏱️  LLM stream complete: ${llmDuration}ms (${tokensPerSecond} tokens/sec)`);
    getEventSystem().info(EventCategory.LLM, `📊 [Token Tracking] Final metrics - Prompt: ${promptTokens}, Completion: ${completionTokens}, Total: ${totalTokens}`);
    
    // Store LLM metrics
    metrics.llmDuration = llmDuration;
    metrics.llmTokenCount = totalTokens; // Store total tokens for performance metrics
    metrics.tokensPerSecond = parseFloat(tokensPerSecond);
    metrics.llmFirstToken = latency.llmFirstToken > 0 ? latency.llmFirstToken - latency.llmStreamStart : 0;
    
    // Process buffered response if streaming was disabled
    if (disableStreaming && fullText && !toolCalled) {
      getEventSystem().info(EventCategory.SESSION, `📦 [Buffered Mode] Processing complete response: ${fullText.length} chars`);
      
      // Send complete text delta
      sendTextDelta(ws, responseId, itemId, fullText);
      
      // Process as single TTS chunk
      const ttsStart = Date.now();
      getEventSystem().info(EventCategory.SESSION, `🔊 [Buffered Mode] Synthesizing complete response: "${fullText.substring(0, 50)}..."`);
      
      // Start audio content part
      audioStarted = true;
      sendContentPartAdded(ws, responseId, itemId, 0, 1, { type: 'audio', transcript: '' });
      
      // Synthesize entire text
      if (!data.providers) {
        data.providers = await SessionManager.getProviders(data.runtimeConfig!);
      }
      // Get current language from session state
      const currentLanguage = data.language?.current || 
                             data.language?.configured || 
                             'en';
      
      const voiceForTTS = data.config?.voice || voice;
      
      const audioChunks = await synthesizeTextWithProvider(
        data.providers,
        fullText,
        voiceForTTS,
        speakingRate,
        data.currentTraceId, // Pass unified trace ID for agent analytics
        data.sessionId,
              data.sessionKey,
              'direct', // TODO: Detect connection paradigm
              currentLanguage // Use current language from session state
            );
      const ttsEnd = Date.now();
      getEventSystem().info(EventCategory.TTS, `⏱️  [Buffered Mode] TTS synthesis: ${ttsEnd - ttsStart}ms for ${fullText.length} chars`);
      
      allAudioChunks.push(...audioChunks);
      
      // Send transcript delta
      logResponseDebug('sending buffered audio transcript delta', {
        transcriptChunkLength: fullText.length,
        synthesizedAudioChunkCount: audioChunks.length,
      }, EventCategory.AUDIO);
      sendAudioTranscriptDelta(ws, responseId, itemId, fullText);
      
      // Stream audio chunks
      for (const chunk of audioChunks) {
        if (turnAbort.signal.aborted) {
          logResponseDebug('early return during buffered audio delta send', {
            pendingChunkBytes: chunk.byteLength,
            synthesizedAudioChunkCount: audioChunks.length,
            reason: 'turn aborted during buffered audio streaming',
          }, EventCategory.AUDIO);
          finalizeCancelledResponse();
          return;
        }
        
        sendAudioDelta(ws, responseId, itemId, chunk);
      }

      logResponseDebug('completed buffered audio delta batch', {
        synthesizedAudioChunkCount: audioChunks.length,
        transcriptChunkLength: fullText.length,
      }, EventCategory.AUDIO);
    }
    
    // If a tool was called, don't flush text or complete the response
    // Wait for client to send tool output and response.create
    if (toolCalled) {
      getEventSystem().info(EventCategory.SESSION, '⏸️  Response paused - waiting for tool output from client');
      logResponseDebug('response paused awaiting client tool output', {
        status: 'incomplete',
      });
      
      // Send text.done with what we have so far
      if (fullText) {
        sendTextDone(ws, responseId, itemId, fullText);
      }
      
      // Mark response as incomplete (waiting for tool output)
      sendResponseDone(ws, responseId, 'incomplete', [], null);
      responseFinalized = true;
      
      return;
    }
    
    // Flush remaining text from chunker (streaming mode only)
    if (!disableStreaming) {
      const finalChunks = textChunker.flush();
      for (const textChunk of finalChunks) {
        if (textChunk.trim().length === 0) continue;

        // Filter chunk through response filter service (AI-driven deduplication)
        let filteredChunk = textChunk;
        let chunkSkipped = false;

        if (responseFilter && filterConfig) {
          try {
            filteredChunk = await responseFilter.filterChunk(textChunk, filterConfig);
            
            // If filter returns empty string, skip entire chunk
            if (filteredChunk === '') {
              chunkSkipped = true;
              getEventSystem().info(EventCategory.RESPONSE_FILTER,
                `⏭️  [Filter] Final chunk skipped (duplicate detected): "${textChunk.substring(0, 60)}..."`);
              logResponseDebug('final chunk skipped by response filter', {
                originalChunkLength: textChunk.length,
                filteredChunkLength: filteredChunk.length,
              }, EventCategory.RESPONSE_FILTER);

              // Mark that we detected repetition for next LLM turn
              if (!data.detectedRepetition) {
                data.detectedRepetition = true;
                getEventSystem().warn(EventCategory.LLM, `⚠️  [Filter] Flagging repetition for next LLM turn`);
              }
              continue; // Skip chunk entirely - don't send to client, don't synthesize
            }

            // Chunk passed filter, add to recent history
            responseFilter.addChunkToHistory(filteredChunk);
            getEventSystem().info(EventCategory.RESPONSE_FILTER,
              `✅ [Filter] Final chunk passed filter: "${filteredChunk.substring(0, 60)}..."`);
          } catch (error) {
            getEventSystem().warn(EventCategory.RESPONSE_FILTER,
              `⚠️  [Filter] Error filtering final chunk, using original:`, error);
            // On error, use original chunk (don't skip)
            filteredChunk = textChunk;
          }
        }

        // Use filtered chunk for TTS (or original if filter disabled/failed)
        const chunkToSynthesize = filteredChunk;
    
        const ttsStart = Date.now();
        getEventSystem().info(EventCategory.AUDIO, `🔊 Final TTS chunk: "${chunkToSynthesize.substring(0, 50)}..."`);
        
        if (!audioStarted) {
          audioStarted = true;
          logResponseDebug('starting audio content part for final chunk flush', {
            chunkLength: chunkToSynthesize.length,
          }, EventCategory.AUDIO);
          sendContentPartAdded(ws, responseId, itemId, 0, 1, { type: 'audio', transcript: '' });
        }
        
        if (!data.providers) {
          data.providers = await SessionManager.getProviders(data.runtimeConfig!);
        }
        // Get current language from session state
        const currentLanguage = data.language?.current || 
                               data.language?.configured || 
                               'en';
        
        const voiceForTTS = data.config?.voice || voice;
        
        const audioChunks = await synthesizeTextWithProvider(
          data.providers,
          chunkToSynthesize,
          voiceForTTS,
          speakingRate,
          data.currentTraceId, // Pass unified trace ID for agent analytics
          data.sessionId,
              data.sessionKey,
              'direct', // TODO: Detect connection paradigm
              currentLanguage // Use current language from session state
            );
        const ttsEnd = Date.now();
        latency.ttsChunks.push({ text: chunkToSynthesize.substring(0, 30), start: ttsStart, end: ttsEnd });
        getEventSystem().info(EventCategory.TTS, `⏱️  TTS synthesis (final): ${ttsEnd - ttsStart}ms for ${chunkToSynthesize.length} chars`);
        allAudioChunks.push(...audioChunks);
        
        logResponseDebug('sending final audio transcript delta', {
          transcriptChunkLength: chunkToSynthesize.length,
          synthesizedAudioChunkCount: audioChunks.length,
        }, EventCategory.AUDIO);
        sendAudioTranscriptDelta(ws, responseId, itemId, chunkToSynthesize);
        
        for (const chunk of audioChunks) {
          if (turnAbort.signal.aborted) {
            logResponseDebug('early return during final audio delta send', {
              pendingChunkBytes: chunk.byteLength,
              synthesizedAudioChunkCount: audioChunks.length,
              reason: 'turn aborted during final audio streaming',
            }, EventCategory.AUDIO);
            finalizeCancelledResponse();
            return;
          }
          
          // Track first audio sent for TTFS
          if (latency.firstAudioSent === 0) {
            latency.firstAudioSent = Date.now();
            const ttfs = data.speechEndTime ? latency.firstAudioSent - data.speechEndTime : 0;
            getEventSystem().info(EventCategory.AUDIO, `🎵 First audio sent: TTFS = ${ttfs}ms`);
            
            // Stop acknowledgement monitoring and typing sounds when actual audio starts
            if (data.acknowledgementService) {
              data.acknowledgementService.stopMonitoring();
            }
            // Stop typing sounds when actual audio starts
            if (data.typingSoundService) {
              data.typingSoundService.stopPlaying();
            }
          }
          
          sendAudioDelta(ws, responseId, itemId, chunk);
        }

        logResponseDebug('completed final audio delta batch', {
          synthesizedAudioChunkCount: audioChunks.length,
          transcriptChunkLength: chunkToSynthesize.length,
        }, EventCategory.AUDIO);
      }
    }
    
    getEventSystem().info(EventCategory.SESSION, `💬 Generated response: "${fullText}"`);
    
    // Detect empty response after server tool call (LLM called tool but forgot to respond)
    // This can happen with some models that treat tool calls as complete responses
    if (serverToolCalled && fullText.trim() === '' && !toolCalled) {
      const maxEmptyRetries = data.runtimeConfig?.agent?.maxToolRetries ?? config.agent.maxToolRetries;
      const currentRetryCount = data.emptyResponseRetryCount ?? 0;
      
      // Specific warning for setLanguage - this can happen anytime, not just initial greeting
      getEventSystem().warn(EventCategory.SESSION, `⚠️ [Empty Response] Server tool called but no text generated - retry ${currentRetryCount}/${maxEmptyRetries}`);
      getEventSystem().warn(EventCategory.LLM, `🚨 [setLanguage Stop Detected] AI called setLanguage and stopped without generating text! Applying retry hack to remove tool from history.`);
      
      if (currentRetryCount < maxEmptyRetries) {
        data.emptyResponseRetryCount = currentRetryCount + 1;
        
        getEventSystem().info(EventCategory.SESSION, `🔄 [Empty Response Retry] Attempting automatic retry ${data.emptyResponseRetryCount}/${maxEmptyRetries}`);
        
        // HACK: Remove setLanguage tool calls from history to help AI continue generating
        // The AI tends to stop after calling setLanguage, so we remove it and add a confirmation instead
        const originalHistoryLength = data.conversationHistory.length;
        data.conversationHistory = data.conversationHistory.filter(item => {
          // Remove function_call items for setLanguage
          if (item.type === 'function_call' && item.name === 'setLanguage') {
            getEventSystem().info(EventCategory.SESSION, `🗑️ [Retry Hack] Removing setLanguage function_call from history`);
            return false;
          }
          // Remove function_call_output items for setLanguage
          if (item.type === 'function_call_output' && item.name === 'setLanguage') {
            getEventSystem().info(EventCategory.SESSION, `🗑️ [Retry Hack] Removing setLanguage function_call_output from history`);
            return false;
          }
          return true;
        });
        
        // Add a system message confirming language was set (replacing the tool call)
        const languageConfirmationItem: ConversationItem = {
          id: generateItemId(),
          type: 'message',
          status: 'completed',
          role: 'system',
          content: [
            {
              type: 'text',
              text: `[System Note] Language has been set to ${data.language?.current || 'en'}. Please continue your response to the user.`
            }
          ]
        };
        data.conversationHistory.push(languageConfirmationItem);
        getEventSystem().info(EventCategory.SESSION, `📝 [Retry Hack] Added language confirmation message to history`);
        
        // Add hint to conversation so LLM knows to actually respond
        const retryHintItem: ConversationItem = {
          id: generateItemId(),
          type: 'message',
          status: 'completed',
          role: 'system',
          content: [
            {
              type: 'text',
              text: `🔄 [Empty Response Retry - Message to Assistant] You MUST respond to the user in the selected language and continue the conversation. Attempt ${data.emptyResponseRetryCount}/${maxEmptyRetries} of empty response retry.`
            }
          ]
        };
        data.conversationHistory.push(retryHintItem);
        
        // Mark response as failed
        ws.send(JSON.stringify({
          type: 'response.done',
          event_id: generateEventId(),
          response: {
            id: responseId,
            object: 'realtime.response',
            status: 'failed',
            output: [],
          },
        }));
        
        // Automatically retry synchronously to prevent race conditions with currentResponseId
        // This ensures the retry happens before the finally block sets currentResponseId = null
        getEventSystem().info(EventCategory.SESSION, `🔄 [Empty Response Retry] Starting synchronous retry attempt ${data.emptyResponseRetryCount}/${maxEmptyRetries}`);
        
        // Reset currentResponseId before retry so the new response can take over
        data.currentResponseId = null;
        
        // Retry immediately (synchronously) to avoid hibernation/race issues
        try {
          await generateResponse(ws, options);
          // If retry succeeds, return without going through normal completion
          return;
        } catch (retryError) {
          getEventSystem().error(EventCategory.SESSION, `❌ [Empty Response Retry] Retry attempt failed:`, retryError);
          // Continue with normal completion (empty response)
        }
      } else {
        getEventSystem().error(EventCategory.SESSION, `❌ [Empty Response] Max retries (${maxEmptyRetries}) exceeded - continuing with empty response`);
        data.emptyResponseRetryCount = 0;
      }
    } else if (fullText.trim() !== '') {
      // Reset retry count on successful non-empty response
      data.emptyResponseRetryCount = 0;
    }
    
    // Send text.done
    sendTextDone(ws, responseId, itemId, fullText);
    
    // Update output item
    outputItem.content = [{ type: 'text', text: fullText }];
    
    // Send audio transcript done
    if (audioStarted) {
      logResponseDebug('sending audio completion events', {
        transcriptLength: fullText.length,
        finalAudioChunkCount: allAudioChunks.length,
      }, EventCategory.AUDIO);
      sendAudioTranscriptDone(ws, responseId, itemId, fullText);
      
      // Send audio.done
      sendAudioDone(ws, responseId, itemId);
      
      // Update output item with audio
      outputItem.content!.push({
        type: 'audio',
        transcript: fullText,
      });
      
      // Debug: Save full audio as WAV file (only when file system is available)
      if (hasFileSystem()) {
        const fullAudio = concatenateAudio(allAudioChunks);
        const wavFile = createWavFile(fullAudio, 22050, 1, 16);
        const debugPath = join(process.cwd(), `debug_tts_${Date.now()}.wav`);
        await Bun.write(debugPath, wavFile);
        getEventSystem().debug(EventCategory.AUDIO, `🎵 Saved debug audio to: ${debugPath}`);
        getEventSystem().info(EventCategory.AUDIO, `📊 Audio stats: ${fullAudio.length} bytes, ${allAudioChunks.length} chunks, ${(fullAudio.length / 2 / 22050).toFixed(2)}s duration`);
      } else {
        const fullAudio = concatenateAudio(allAudioChunks);
        getEventSystem().info(EventCategory.AUDIO, `📊 Audio stats: ${fullAudio.length} bytes, ${allAudioChunks.length} chunks, ${(fullAudio.length / 2 / 22050).toFixed(2)}s duration (debug WAV skipped in Workers)`);
      }
    }
    
    outputItem.status = 'completed';
    
    // Store token counts in conversation history (for accurate context truncation)
    if (tokenUsage) {
      outputItem.tokens = {
        prompt: tokenUsage.promptTokens,
        completion: tokenUsage.completionTokens,
        total: tokenUsage.totalTokens,
      };
      getEventSystem().info(EventCategory.LLM, `💾 [ConversationHistory] Stored token counts: ${tokenUsage.promptTokens} prompt + ${tokenUsage.completionTokens} completion = ${tokenUsage.totalTokens} total`);
    }
    
    // Add to conversation history
    data.conversationHistory.push(outputItem);
    
    // Send output_item.done
    logResponseDebug('sending final response completion events', {
      outputItemStatus: outputItem.status,
      finalAudioChunkCount: allAudioChunks.length,
      transcriptLength: fullText.length,
    });
    sendOutputItemDone(ws, responseId, 0, outputItem);
    
    // Send response.done
    sendResponseDone(ws, responseId, 'completed', [outputItem], null);
    responseFinalized = true;
    
    // Reset tool retry count on successful response
    if (data.toolRetryCount !== undefined || data.lastToolError !== undefined) {
      getEventSystem().info(EventCategory.SESSION, `✅ [Tool Retry] Response completed successfully - resetting retry count`);
      data.toolRetryCount = 0;
      data.lastToolError = undefined;
    }
    
    // Track audio output duration and end the active turn
    if (data.turnTracker) {
      const turnTracker = data.turnTracker as any; // Avoid circular deps
      // Calculate total audio duration from all chunks
      const totalAudioDurationMs = allAudioChunks.reduce((sum, chunk) => sum + chunk.length / 2 / 24000 * 1000, 0);
      turnTracker.trackAudioOutput(totalAudioDurationMs);
      await turnTracker.endTurn();
    }
    
    // Calculate final metrics and store
    latency.responseEnd = Date.now();
    const totalTime = latency.responseEnd - latency.responseStart;
    const timeToFirstToken = latency.llmFirstToken > 0 ? latency.llmFirstToken - latency.llmStreamStart : 0;
    const llmStreamTime = latency.llmStreamEnd - latency.llmStreamStart;
    const totalTTSTime = latency.ttsChunks.reduce((sum, chunk) => sum + (chunk.end - chunk.start), 0);
    const avgTTSTime = latency.ttsChunks.length > 0 ? totalTTSTime / latency.ttsChunks.length : 0;
    const asrTime = data.lastAsrDuration || 0;
    const ttfs = (latency.firstAudioSent > 0 && data.speechEndTime) 
      ? latency.firstAudioSent - data.speechEndTime 
      : 0;
    
    // Calculate tokens per second using total tokens from tokenUsage
    const totalTokensForMetrics = tokenUsage?.totalTokens || latency.llmTokenCount || 0;
    const finalTokensPerSecond = llmStreamTime > 0 && totalTokensForMetrics > 0 
      ? (totalTokensForMetrics / (llmStreamTime / 1000)).toFixed(1) 
      : '0';
    
    // Finalize metrics
    metrics.asrDuration = asrTime;
    metrics.totalDuration = totalTime;
    metrics.ttsChunks = latency.ttsChunks.map(c => ({
      duration: c.end - c.start,
      text: c.text,
    }));
    
    // Move completed response to historical (keep last 10 responses)
    if (!data.latencyMetrics!.historical) {
      data.latencyMetrics!.historical = [];
    }
    data.latencyMetrics!.historical.push(metrics);
    if (data.latencyMetrics!.historical.length > 10) {
      data.latencyMetrics!.historical.shift(); // Remove oldest
    }
    data.latencyMetrics!.currentResponse = undefined;
    
    // Track pipeline completion (agent analytics)
    const traceId = data.currentTraceId;
    if (traceId) {
      const analyticsService = getServiceForTrace(traceId);
      if (analyticsService) {
        // Calculate total TTS duration
        const totalTTSDuration = latency.ttsChunks.reduce((sum, chunk) => sum + (chunk.end - chunk.start), 0);
        
        // Convert tokenUsage to analytics format (inputTokens/outputTokens)
        // Analytics expects inputTokens/outputTokens, we have promptTokens/completionTokens
        const analyticsTokenUsage = tokenUsage ? {
          inputTokens: tokenUsage.promptTokens,
          outputTokens: tokenUsage.completionTokens,
          totalTokens: tokenUsage.totalTokens,
        } : undefined;
        
        analyticsService.trackPipelineComplete({
          sttDurationMs: asrTime,
          llmDurationMs: llmStreamTime,
          ttsDurationMs: totalTTSDuration,
          totalDurationMs: totalTime,
          ttfsMs: ttfs,
          // Token usage is tracked separately via trackLLMComplete in model wrapper
          // TODO: Add cost calculation if needed
        });
        
        // Log token usage for analytics debugging
        if (analyticsTokenUsage) {
          getEventSystem().info(EventCategory.POSTHOG_LLM, `📊 [Analytics] Token usage tracked - Input: ${analyticsTokenUsage.inputTokens}, Output: ${analyticsTokenUsage.outputTokens}, Total: ${analyticsTokenUsage.totalTokens}`);
        }
        
        // End the top-level trace (required for PostHog trace grouping)
        analyticsService.endTrace({
          outputState: {
            responseLength: fullText.length,
            audioChunks: allAudioChunks.length,
            totalDurationMs: totalTime,
            ttfsMs: ttfs,
          },
        });
        
        // Clean up service after pipeline completes
        removeService(traceId);
        // Don't clear trace ID - it's the session ID and should persist for the session
      }
    }
    
    getEventSystem().info(EventCategory.PERFORMANCE, '\n📊 ===== RESPONSE LATENCY SUMMARY =====');
    getEventSystem().info(EventCategory.PERFORMANCE, `⏱️  Total response time: ${totalTime}ms`);
    getEventSystem().info(EventCategory.STT, `🎤 ASR (transcription): ${asrTime}ms`);
    getEventSystem().info(EventCategory.AUDIO, `🎵 TTFS (user speech end → first AI audio): ${ttfs}ms`);
    getEventSystem().info(EventCategory.STT, `⚡ Time to first token: ${timeToFirstToken}ms`);
    getEventSystem().info(EventCategory.LLM, `🤖 LLM stream duration: ${llmStreamTime}ms`);
    if (tokenUsage) {
      getEventSystem().info(EventCategory.LLM, `   - Tokens: ${tokenUsage.totalTokens} total (${tokenUsage.promptTokens} prompt + ${tokenUsage.completionTokens} completion) - actual from provider`);
    } else {
      getEventSystem().info(EventCategory.LLM, `   - Tokens: ${totalTokensForMetrics} (actual from provider)`);
    }
    getEventSystem().info(EventCategory.AUTH, `   - Tokens/second: ${finalTokensPerSecond}`);
    getEventSystem().info(EventCategory.TTS, `🔊 TTS synthesis:`);
    getEventSystem().info(EventCategory.AUDIO, `   - Total chunks: ${latency.ttsChunks.length}`);
    getEventSystem().info(EventCategory.TTS, `   - Total time: ${totalTTSTime}ms`);
    getEventSystem().info(EventCategory.TTS, `   - Average time: ${avgTTSTime.toFixed(1)}ms/chunk`);
    if (latency.ttsChunks.length > 0) {
      getEventSystem().info(EventCategory.SESSION, `   - Breakdown:`);
      latency.ttsChunks.forEach((chunk, i) => {
        const duration = chunk.end - chunk.start;
        getEventSystem().info(EventCategory.AUDIO, `     ${i + 1}. "${chunk.text}..." → ${duration}ms`);
      });
    }
    getEventSystem().info(EventCategory.SESSION, `📝 Response length: ${fullText.length} characters`);
    getEventSystem().info(EventCategory.AUDIO, `🎵 Audio chunks: ${allAudioChunks.length}`);
    getEventSystem().info(EventCategory.SESSION, '========================================\n');
    
    // Send response.done event
    // This tells the SDK the response is complete and resets #ongoingResponse = false
    if (!responseFinalized) {
      sendResponseDone(ws, responseId, 'completed', outputItem ? [outputItem] : [], null);
      responseFinalized = true;
    }
    getEventSystem().info(EventCategory.SESSION, `✅ Response complete: ${responseId}`);
    
    // Reset tool retry count on successful response
    if (data.toolRetryCount !== undefined || data.lastToolError !== undefined) {
      getEventSystem().info(EventCategory.SESSION, `✅ [Tool Retry] Response completed successfully - resetting retry count`);
      data.toolRetryCount = 0;
      data.lastToolError = undefined;
    }
    
  } catch (error) {
    getEventSystem().error(EventCategory.SESSION, '❌ Response generation error:', error instanceof Error ? error : new Error(String(error)));

    // Diagnostic logging for truncation-related errors
    // Handle error-like objects that may have a message property but aren't Error instances
    let errMsg: string;
    if (error instanceof Error) {
      errMsg = error.message;
    } else if (typeof error === 'object' && error !== null && 'message' in error) {
      errMsg = String((error as Record<string, unknown>).message);
    } else {
      try {
        errMsg = JSON.stringify(error);
      } catch {
        errMsg = String(error);
      }
    }
    getEventSystem().error(EventCategory.SESSION, `❌ [Diagnostics] Error message: ${errMsg}`);
    getEventSystem().error(EventCategory.SESSION, `❌ [Diagnostics] Conversation history length: ${data.conversationHistory?.length ?? 0}`);
    
    if (data.conversationHistory && data.conversationHistory.length > 0) {
      const toolCalls = data.conversationHistory.filter(
        (item: ConversationItem) => item.type === 'function_call'
      );
      const toolResults = data.conversationHistory.filter(
        (item: ConversationItem) => item.type === 'function_call_output'
      );
      
      getEventSystem().error(EventCategory.LLM, `❌ [Diagnostics] Tool calls (function_call): ${toolCalls.length}, Tool results (function_call_output): ${toolResults.length}`);
      
      if (toolCalls.length !== toolResults.length) {
        getEventSystem().error(EventCategory.LLM, `🚨 [CRITICAL] Tool call/result mismatch! Potential orphaned tool messages. Calls: ${toolCalls.length}, Results: ${toolResults.length}`);
        
        const callIds = new Set(toolCalls.map((item: ConversationItem) => item.call_id));
        const resultCallIds = new Set(toolResults.map((item: ConversationItem) => item.call_id));
        const orphanedCalls = toolCalls.filter((item: ConversationItem) => !resultCallIds.has(item.call_id));
        const orphanedResults = toolResults.filter((item: ConversationItem) => !callIds.has(item.call_id));
        
        if (orphanedCalls.length > 0) {
          getEventSystem().error(EventCategory.LLM, `🚨 [CRITICAL] Orphaned tool calls (no matching result): ${orphanedCalls.map((item: ConversationItem) => `${item.name}[${item.call_id}]`).join(', ')}`);
        }
        if (orphanedResults.length > 0) {
          getEventSystem().error(EventCategory.LLM, `🚨 [CRITICAL] Orphaned tool results (no matching call): ${orphanedResults.map((item: ConversationItem) => item.call_id).join(', ')}`);
        }
      }
      
      const last5 = data.conversationHistory.slice(-5);
      const last5Summary = last5.map((item: ConversationItem) => `${item.type}(${item.role ?? item.name ?? '-'})`).join(' → ');
      getEventSystem().error(EventCategory.SESSION, `❌ [Diagnostics] Last 5 messages: ${last5Summary}`);
      
      if (/function.?call|tool/i.test(errMsg)) {
        getEventSystem().error(EventCategory.LLM, `🚨 [CRITICAL] Error message references tool/function_call — likely a tool-pair issue. Error: ${errMsg}`);
      }
    }
    
    // End the trace with error (if analytics service exists)
    const traceId = data.currentTraceId;
    if (traceId) {
      const analyticsService = getServiceForTrace(traceId);
      if (analyticsService) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        analyticsService.endTrace({
          isError: true,
          error: errorMessage,
        });
        removeService(traceId);
      }
    }
    
    // Log API key context if available
    if (data.runtimeConfig?.llm?.apiKey) {
      const apiKey = data.runtimeConfig.llm.apiKey;
      const keyPreview = apiKey 
        ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`
        : 'MISSING';
      const provider = data.runtimeConfig.llm.provider;
      getEventSystem().error(EventCategory.PROVIDER, `🔑 Response error context: provider=${provider}, apiKey=${keyPreview}`);
    }
    
    // Detect fatal LLM provider errors using whitelist approach
    // Only tool errors are recoverable; everything else is fatal
    const errorAnalysis = detectFatalLLMError(error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Check for provider-specific TTS structured errors (special cases)
    const isInworldError = error instanceof Error && error.name === 'InworldTTSError';
    const inworldErrorDetails = isInworldError ? (error as any).details : null;
    const isOpenAICompatibleTTSError = error instanceof Error && error.name === 'OpenAICompatibleTTSError';
    const openAICompatibleErrorDetails = isOpenAICompatibleTTSError ? (error as any).details : null;
    
    // Log API key errors prominently (in addition to fatal error detection)
    if (errorMessage.toLowerCase().includes('api key') || 
        errorMessage.toLowerCase().includes('unauthorized') ||
        errorMessage.toLowerCase().includes('authentication') ||
        errorMessage.toLowerCase().includes('invalid') ||
        errorMessage.toLowerCase().includes('401')) {
      getEventSystem().critical(EventCategory.AUTH, `🚨 API KEY ERROR in response generation!`);
      getEventSystem().error(EventCategory.SESSION, `🔍 Full error: ${errorMessage}`);
    }
    
    if (!errorAnalysis.isFatal) {
      // Recoverable error (tool errors only) - Check retry count and attempt retry
      const maxToolRetries = data.runtimeConfig?.agent?.maxToolRetries ?? config.agent.maxToolRetries;
      const currentRetryCount = data.toolRetryCount ?? 0;
      
      getEventSystem().error(EventCategory.SESSION, `⚠️ Recoverable error (${errorAnalysis.errorType}) - retry ${currentRetryCount}/${maxToolRetries}`);
      
      if (currentRetryCount < maxToolRetries) {
        // Increment retry count
        data.toolRetryCount = currentRetryCount + 1;
        data.lastToolError = {
          errorMessage: errorAnalysis.message,
          errorType: errorAnalysis.errorType,
          timestamp: Date.now(),
        };
        
        getEventSystem().info(EventCategory.SESSION, `🔄 [Tool Retry] Attempting automatic retry ${data.toolRetryCount}/${maxToolRetries}`);
        
        // Add error context to conversation history so LLM can see what went wrong
        // Format only the relevant tool(s) based on the error message to help the LLM
        // understand correct parameter usage without overwhelming it with all tools
        const toolsReference = formatToolsForRetryError(errorAnalysis.message, data.config.tools || [], data.conversationHistory);
        
        const errorContextItem: ConversationItem = {
          id: generateItemId(),
          type: 'message',
          status: 'completed',
          role: 'system',
          content: [
            `Tool call validation error (attempt ${data.toolRetryCount}/${maxToolRetries}): ${errorAnalysis.message}.`,
            '',
            'Please retry the tool call with corrected parameters that match the tool schema exactly.',
            '',
            'IMPORTANT: The agent harness will not pick up any parameters if an invalid parameter name is submitted.',
            'Only use the parameters listed below for each tool.',
            '',
            toolsReference,
          ].join('\n'),
        };
        data.conversationHistory.push(errorContextItem);
        
        // Mark response as failed
        ws.send(JSON.stringify({
          type: 'response.done',
          event_id: generateEventId(),
          response: {
            id: responseId,
            object: 'realtime.response',
            status: 'failed',
            output: [],
          },
        }));
        
        // Automatically retry by calling generateResponse again
        // Small delay to avoid immediate retry loops
        setTimeout(() => {
          getEventSystem().info(EventCategory.SESSION, `🔄 [Tool Retry] Starting retry attempt ${data.toolRetryCount}/${maxToolRetries}`);
          generateResponse(ws, options).catch((retryError) => {
            getEventSystem().error(EventCategory.SESSION, `❌ [Tool Retry] Retry attempt failed:`, retryError);
            // Error will be handled by the catch block in the retry call
          });
        }, 100); // 100ms delay before retry
        
        return; // Exit early, retry will handle continuation
      } else {
        // Max retries exceeded - send error and keep connection open for manual retry
        getEventSystem().error(EventCategory.SESSION, `❌ [Tool Retry] Max retries (${maxToolRetries}) exceeded - sending error to client`);
        sendError(ws, errorAnalysis.errorType, `${errorAnalysis.message} (Max retries exceeded: ${maxToolRetries})`);
        
        // Reset retry count for next attempt
        data.toolRetryCount = 0;
        data.lastToolError = undefined;
        
        // Mark response as failed
        ws.send(JSON.stringify({
          type: 'response.done',
          event_id: generateEventId(),
          response: {
            id: responseId,
            object: 'realtime.response',
            status: 'failed',
            output: [],
          },
        }));
        
        // Connection remains open - client can manually retry
      }
    } else if (isInworldError && inworldErrorDetails) {
      // Inworld TTS error: Send structured error with code and param
      getEventSystem().error(EventCategory.TTS, `⚠️ Inworld TTS error - sending structured error`);
      sendStructuredError(
        ws,
        'invalid_request_error',
        inworldErrorDetails.message,
        inworldErrorDetails.code,
        inworldErrorDetails.param
      );
      
      // Mark response as failed
      ws.send(JSON.stringify({
        type: 'response.done',
        event_id: generateEventId(),
        response: {
          id: responseId,
          object: 'realtime.response',
          status: 'failed',
          output: [],
        },
      }));
      
      // Close WebSocket with error code after short delay to allow client to process the error
      getEventSystem().error(EventCategory.SESSION, `🔌 Closing WebSocket due to TTS error (code: 1011): ${inworldErrorDetails.message}`);
      setTimeout(() => {
        ws.close(1011, `Inworld TTS error: ${inworldErrorDetails.message}`);
      }, 100);
    } else if (isOpenAICompatibleTTSError && openAICompatibleErrorDetails) {
      getEventSystem().error(EventCategory.TTS, '⚠️ OpenAI-compatible TTS error - sending structured error');

      sendStructuredError(
        ws,
        'invalid_request_error',
        openAICompatibleErrorDetails.message,
        openAICompatibleErrorDetails.code,
        openAICompatibleErrorDetails.param
      );

      ws.send(JSON.stringify({
        type: 'response.done',
        event_id: generateEventId(),
        response: {
          id: responseId,
          object: 'realtime.response',
          status: 'failed',
          output: [],
        },
      }));

      getEventSystem().error(EventCategory.SESSION, `🔌 Closing WebSocket due to OpenAI-compatible TTS error (code: 1011): ${openAICompatibleErrorDetails.message}`);
      setTimeout(() => {
        ws.close(1011, `OpenAI-compatible TTS error: ${openAICompatibleErrorDetails.message}`);
      }, 100);
    } else {
      // Fatal error (default): Send error and close WebSocket
      // This catches all errors not explicitly whitelisted as recoverable
      getEventSystem().critical(EventCategory.LLM, `💀 Fatal error (${errorAnalysis.errorType}) - closing WebSocket connection`);
      getEventSystem().critical(EventCategory.SESSION, `🔍 Error details: ${errorAnalysis.message}`);
      
      sendError(ws, errorAnalysis.errorType, errorAnalysis.message);
      
      // Mark response as failed
      ws.send(JSON.stringify({
        type: 'response.done',
        event_id: generateEventId(),
        response: {
          id: responseId,
          object: 'realtime.response',
          status: 'failed',
          output: [],
        },
      }));
      
      // Close WebSocket with error code after short delay to allow client to process the error
      getEventSystem().critical(EventCategory.SESSION, `🔌 Closing WebSocket due to fatal error (code: 1011): ${errorAnalysis.errorType} - ${errorAnalysis.message}`);
      setTimeout(() => {
        ws.close(1011, errorAnalysis.message);
      }, 100);
    }
  } finally {
    if (data.currentResponseId === responseId) {
      data.currentResponseId = null;
    }
    if (data.responseTurnAbort === turnAbort) {
      data.responseTurnAbort = null;
    }
  }
}
