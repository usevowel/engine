/**
 * Session Update Event Handler
 * 
 * Handles session.update events including agent initialization and turn detection configuration.
 */

import { ServerWebSocket } from 'bun';
import { generateEventId, TurnDetection } from '../../lib/protocol';
import { config, validateModel, validateVoice, buildSystemPrompt, isSubagentModeEnabled } from '../../config/env';
import { AgentFactory } from '../../services/agents';
import { SoundbirdAgent } from '../../services/agent-provider';
import { sendSessionUpdated } from '../utils/event-sender';
import { parseInstructions } from '../../lib/instruction-parser';
import { convertVowelToolsToOpenAIFormat } from '../../lib/vowel-to-openai-schema';
import type { SessionData } from '../types';
import { initializeAgent } from '../agent-init';
import { SessionManager } from '../SessionManager';

import { getEventSystem, EventCategory } from '../../events';

/**
 * Validate language code (ISO 639-1)
 */
function validateLanguageCode(code: string): string | null {
  const supportedLanguages = [
    'en', 'es', 'fr', 'de', 'it', 'pt', // STT + TTS
    'ko', 'nl', 'zh', 'ja', 'pl', 'ru', // TTS only
  ];
  const normalized = code.toLowerCase();
  return supportedLanguages.includes(normalized) ? normalized : null;
}

/**
 * Handle session.update event
 */
export async function handleSessionUpdate(ws: ServerWebSocket<SessionData>, event: any): Promise<void> {
  const data = ws.data;
  const transcriptionModel = data.config.input_audio_transcription?.model || '';
  const usesIntegratedVAD =
    (data.runtimeConfig ? SessionManager.isVADIntegrated(data.runtimeConfig) : false) ||
    transcriptionModel.startsWith('assemblyai-') ||
    transcriptionModel.startsWith('fennec-');
  
  // Debug: Log what the client is sending
  getEventSystem().info(EventCategory.SESSION, '📥 session.update received:', JSON.stringify({
    has_turn_detection_snake: !!event.session?.turn_detection,
    has_turn_detection_camel: !!(event.session as any)?.turnDetection,
    has_audio_input_turn_detection_snake: !!event.session?.audio?.input?.turn_detection,
    has_audio_input_turn_detection_camel: !!event.session?.audio?.input?.turnDetection,
    has_audio: !!event.session?.audio,
    has_audio_input: !!event.session?.audio?.input,
    current_turn_detection: data.config.turn_detection,
    has_instructions: !!event.session?.instructions,
    instructions_length: event.session?.instructions?.length || 0,
  }, null, 2));
  
  // Log instructions if provided
  if (event.session?.instructions) {
    getEventSystem().info(EventCategory.SESSION, '📝 Instructions received in session.update:');
    getEventSystem().info(EventCategory.SESSION, '  Length:', event.session.instructions.length, 'chars');
    getEventSystem().info(EventCategory.SESSION, '  Preview (first 200 chars):', event.session.instructions.substring(0, 200) + '...');
  } else {
    getEventSystem().warn(EventCategory.SESSION, '⚠️  No instructions provided in session.update');
  }

  // Log speech mode if provided
  if (event.session?.speech_mode) {
    getEventSystem().info(EventCategory.SESSION, '🎤 Speech mode received in session.update:', event.session.speech_mode);
  }

  // SOURCE OF TRUTH: Store the original session.update event BEFORE any transformations
  // This allows us to rebuild the config on restore without double-conversion issues
  data.lastSessionUpdate = {
    type: 'session.update',
    session: { ...event.session }
  };
  
  getEventSystem().info(EventCategory.SESSION, '💾 Stored session.update as source of truth for persistence');
  
  // Update session config
  if (event.session) {
    // Update model if provided (allow runtime model switching)
    // Client-provided model ALWAYS takes precedence over token/default
    if (event.session.model) {
      const newModel = validateModel(event.session.model);
      if (newModel !== data.model) {
        getEventSystem().info(EventCategory.SESSION, `🔄 Model changed: ${data.model} → ${newModel}`);
        getEventSystem().info(EventCategory.SESSION, `   ✅ Now using client-specified model: ${newModel}`);
        data.model = newModel;
      } else {
        getEventSystem().info(EventCategory.SESSION, `   ℹ️  Model already set to: ${data.model}`);
      }
    }
    
    // Validate and update voice
    if (event.session.voice) {
      event.session.voice = validateVoice(event.session.voice);
      getEventSystem().info(EventCategory.SESSION, `🎤 Voice changed: ${data.config.voice} → ${event.session.voice}`);
    }
    
    // Update language if provided
    if ((event.session as any).language) {
      const languageCode = validateLanguageCode((event.session as any).language);
      if (languageCode) {
        if (!data.language) {
          data.language = {
            current: languageCode,
            detected: null,
            configured: languageCode,
            detectionEnabled: true,
          };
        } else {
          data.language.configured = languageCode;
          // Update current language if no detected language
          if (!data.language.detected) {
            data.language.current = languageCode;
          }
        }
        
        // Update language detection service if it exists
        if (data.languageDetectionService) {
          data.languageDetectionService.setConfiguredLanguage(languageCode);
        }
        
        getEventSystem().info(EventCategory.SESSION, `🌍 Language changed: ${data.language.configured || 'none'} → ${languageCode}`);
      } else {
        getEventSystem().warn(EventCategory.SESSION, `⚠️  Invalid language code: ${(event.session as any).language}`);
      }
    }
    
    // ACCUMULATIVE SESSION CONFIG UPDATE
    // Preserve existing config and only update fields that client explicitly provided
    // This prevents partial updates from wiping out previously set fields
    
    const { model: _model, ...sessionUpdates } = event.session;
    
    // ALWAYS force turn_detection config to support interrupts
    // We always want interrupts to work, so ensure config is always present
    
    // Check both deprecated turn_detection and new audio.input.turn_detection
    // Support both snake_case and camelCase (SDK might send either)
    const requestedTurnDetection = 
      sessionUpdates.turn_detection || 
      (sessionUpdates as any).turnDetection ||
      sessionUpdates.audio?.input?.turn_detection ||
      sessionUpdates.audio?.input?.turnDetection;
    
    getEventSystem().debug(EventCategory.SESSION, '🔍 Requested turn_detection:', requestedTurnDetection ? JSON.stringify(requestedTurnDetection) : 'undefined');
    
    // Check if client is requesting client-side VAD mode
    // Client sends type: 'disabled' to indicate they will handle VAD client-side
    const isClientVADRequested = requestedTurnDetection?.type === 'disabled' || 
      requestedTurnDetection?.mode === 'client_vad';
    
    // Default turn_detection config that always supports interrupts
    const defaultTurnDetection: TurnDetection | null = usesIntegratedVAD
      ? null
      : {
          type: 'server_vad',
          threshold: 0.5,
          silence_duration_ms: 550,
          prefix_padding_ms: 0,
          create_response: false, // We handle response creation manually
          interrupt_response: true, // ALWAYS enable interrupts
        };
    
    // Start with default, then merge in client preferences (but keep interrupt_response: true)
    let turnDetectionConfig: TurnDetection | null;
    
    if (isClientVADRequested) {
      getEventSystem().info(EventCategory.SESSION, '✅ Client-side VAD requested - disabling server VAD');
      // Client will handle VAD - set to null to signal client-side mode
      turnDetectionConfig = null;
    } else if (usesIntegratedVAD) {
      getEventSystem().info(
        EventCategory.SESSION,
        '✅ Integrated STT/VAD provider active - using provider-managed turn detection'
      );
      turnDetectionConfig = null;
    } else if (requestedTurnDetection && requestedTurnDetection !== null) {
      getEventSystem().info(EventCategory.SESSION, '✅ Merging client turn_detection with defaults');
      // Client sent turn_detection - merge with defaults
      turnDetectionConfig = {
        ...defaultTurnDetection, // Start with our defaults
        ...requestedTurnDetection, // Merge in client settings
        type: 'server_vad', // Force server_vad (we don't support semantic_vad)
        interrupt_response: true, // FORCE interrupt support (never let client disable this)
        // Normalize camelCase to snake_case if needed
        ...(requestedTurnDetection.silenceDurationMs !== undefined && {
          silence_duration_ms: requestedTurnDetection.silenceDurationMs
        }),
        ...(requestedTurnDetection.prefixPaddingMs !== undefined && {
          prefix_padding_ms: requestedTurnDetection.prefixPaddingMs
        }),
        ...(requestedTurnDetection.createResponse !== undefined && {
          create_response: requestedTurnDetection.createResponse
        }),
      };
      
      // Remove camelCase versions to avoid confusion (keep snake_case for protocol)
      delete (turnDetectionConfig as any).silenceDurationMs;
      delete (turnDetectionConfig as any).prefixPaddingMs;
      delete (turnDetectionConfig as any).createResponse;
      delete (turnDetectionConfig as any).interruptResponse;
      
      if (requestedTurnDetection.type === 'semantic_vad') {
        getEventSystem().warn(EventCategory.VAD, '⚠️  Client requested semantic_vad, converted to server_vad');
      }
    } else if (data.config.turn_detection !== undefined) {
      getEventSystem().info(EventCategory.SESSION, '✅ Preserving existing turn_detection config');
      // No new turn_detection from client, preserve existing (including null for client-side VAD)
      turnDetectionConfig = data.config.turn_detection;
    } else {
      getEventSystem().info(EventCategory.SESSION, '✅ Using default turn_detection config');
      // No existing config, use defaults
      turnDetectionConfig = defaultTurnDetection;
    }
    
    getEventSystem().debug(EventCategory.SESSION, '🔍 Final turnDetectionConfig:', JSON.stringify(turnDetectionConfig));
    
    // Deep merge audio config to preserve nested fields across partial updates
    const existingAudio = data.config.audio || {};
    const existingInput = existingAudio.input || {};
    const newAudio = sessionUpdates.audio;
    
    const mergedAudio = newAudio ? {
      // Start with existing audio config
      ...existingAudio,
      // Merge in new audio updates
      ...newAudio,
      // Deep merge input config
      input: newAudio.input ? {
        // Start with existing input config
        ...existingInput,
        // Merge in new input updates
        ...newAudio.input,
        // Always use our accumulated turn_detection (preserves it across partial updates)
        turn_detection: turnDetectionConfig,
      } : existingInput, // If no input updates, keep existing
    } : existingAudio; // If no audio updates, keep existing
    
    // Accumulate all config updates (deep merge, preserving existing fields)
    data.config = {
      ...data.config, // Start with existing config
      ...sessionUpdates, // Merge in new updates
      audio: mergedAudio, // Use our deeply merged audio config
      turn_detection: turnDetectionConfig, // Use accumulated turn_detection
    };
    
    // Convert tools from Vowel format to OpenAI format if needed
    // This ensures optional parameters are properly represented in the schema
    if (data.config.tools && Array.isArray(data.config.tools) && data.config.tools.length > 0) {
      getEventSystem().info(EventCategory.SESSION, `🔧 Converting ${data.config.tools.length} tools from Vowel to OpenAI format`);
      data.config.tools = convertVowelToolsToOpenAIFormat(data.config.tools);
    }
    
    // Parse instructions EVERY TIME session.update is called with instructions
    // This allows clients to update instructions mid-conversation
    if (event.session?.instructions !== undefined) {
      const subagentMode = isSubagentModeEnabled(data.runtimeConfig);
      const { mainInstructions, toolInstructions } = parseInstructions(
        event.session.instructions,
        subagentMode
      );
      
      // Update config with main instructions (or all if no tags)
      data.config.instructions = mainInstructions || event.session.instructions;
      
      // Store tool instructions separately if subagent mode enabled
      if (subagentMode && toolInstructions) {
        data.subagentToolInstructions = toolInstructions;
        getEventSystem().info(EventCategory.SESSION, `📝 [InstructionParser] Parsed instructions - main: ${mainInstructions.length} chars, tool: ${toolInstructions.length} chars`);
      } else {
        // Clear tool instructions if subagent mode disabled
        data.subagentToolInstructions = undefined;
        if (subagentMode) {
          getEventSystem().info(EventCategory.SESSION, `📝 [InstructionParser] Parsed instructions - main: ${mainInstructions.length} chars, tool: (none)`);
        }
      }
    }
    
    getEventSystem().debug(EventCategory.SESSION, '🔍 Final data.config.turn_detection:', data.config.turn_detection ? JSON.stringify(data.config.turn_detection) : 'null');
    getEventSystem().debug(EventCategory.AUDIO, '🔍 Final data.config.audio?.input?.turn_detection:', data.config.audio?.input?.turn_detection ? JSON.stringify(data.config.audio?.input?.turn_detection) : 'null');
  }
  
  // Initialize Agent Mode if not already initialized
  // TODO: Add production preset configuration here
  //       Currently using test mode defaults (or token config). In production, use optimized presets:
  //       - "fast": Fast responses, fewer steps (maxSteps: 2)
  //       - "quality": Best quality, more reasoning (maxSteps: 5)
  //       - "balanced": Good balance (maxSteps: 3, default)
  //       User can select preset via ephemeral token in production.
  
  // Initialize agent if it doesn't exist yet
  if (!data.agent && !data.newAgent) {
    // Use helper function to create agent (reusable for both initial setup and hibernation restore)
    initializeAgent(data, data.runtimeConfig!);
    
    getEventSystem().info(EventCategory.SESSION, `   Model: ${data.model}`);
    if (data.agentConfig) {
      getEventSystem().info(EventCategory.LLM, `   MaxSteps: ${data.agentConfig.maxSteps} (from token)`);
      getEventSystem().info(EventCategory.LLM, `   MaxContextMessages: ${data.agentConfig.maxContextMessages} (from token)`);
    }
  } else if (data.agent || data.newAgent) {
    // Model changed, reinitialize agent with new model
    // Use provider from runtimeConfig (set from token or env)
    // Fall back to heuristic only if not specified
    const provider = data.runtimeConfig?.llm.provider || (data.model.includes('/') ? 'openrouter' : 'groq');
    
    if (data.runtimeConfig?.llm.provider) {
      getEventSystem().info(EventCategory.LLM, `   ✅ Using LLM provider from token/config: ${provider}`);
    } else {
      getEventSystem().warn(EventCategory.LLM, `   ⚠️  Using heuristic LLM provider (no token override): ${provider}`);
    }
    
    // Apply same subagent mode step limit for model reinitialization
    const subagentModeReinit = isSubagentModeEnabled(data.runtimeConfig);
    const maxSteps = subagentModeReinit ? 2 : (data.agentConfig?.maxSteps || 3);
    const maxContextMessages = data.agentConfig?.maxContextMessages || 15;
    
    if (true && data.newAgent) {
      // Cleanup old agent
      await data.newAgent.cleanup();
      
      // Reinitialize with new model
      const agentType = data.agentType || data.runtimeConfig?.agent?.defaultType || config.agent.defaultType;
      
      // Use sessionKey for PostHog tracking if available (sidecar connections), otherwise use sessionId
      const posthogSessionId = data.sessionKey || data.sessionId;
      
      data.newAgent = AgentFactory.create({
        agentType,
        provider,
        apiKey: data.runtimeConfig!.llm.apiKey,
        model: data.model,
        systemPrompt: buildSystemPrompt(data.config.instructions, agentType, undefined, data.language?.current || data.language?.detected || null),
        maxSteps,
        maxContextMessages,
        openrouterSiteUrl: data.runtimeConfig!.llm.openrouterSiteUrl,
        openrouterAppName: data.runtimeConfig!.llm.openrouterAppName,
        contextStrategy: 'message-count',
        maxStreamRetries: data.runtimeConfig?.agent?.maxStreamRetries ?? config.agent.maxStreamRetries,
        sessionId: posthogSessionId, // Pass session ID/key for PostHog tracking
        groqReasoningEffort: data.groqReasoningEffort, // Pass Groq reasoning effort from env
      });
      
      getEventSystem().info(EventCategory.LLM, '🔄 Modular Agent reinitialized with new model');
    } else if (data.agent) {
      // Legacy path
      // Use sessionKey for PostHog tracking if available (sidecar connections), otherwise use sessionId
      const posthogSessionId = data.sessionKey || data.sessionId;
      
      data.agent = new SoundbirdAgent({
        provider,
        apiKey: data.runtimeConfig!.llm.apiKey,
        model: data.model,
        systemPrompt: buildSystemPrompt(data.config.instructions, undefined, undefined, data.language?.current || data.language?.detected || null),
        maxSteps,
        maxContextMessages,
        openrouterSiteUrl: data.runtimeConfig!.llm.openrouterSiteUrl,
        openrouterAppName: data.runtimeConfig!.llm.openrouterAppName,
        sessionId: posthogSessionId, // Pass session ID/key for PostHog tracking
      });
      
      getEventSystem().info(EventCategory.LLM, '🔄 Legacy Agent reinitialized with new model');
    }
    
    // Ensure agent mode is still enabled after reinitialization
    data.useAgentMode = true;
    
    getEventSystem().info(EventCategory.LLM, `   MaxSteps: ${maxSteps} ${data.agentConfig ? '(from token)' : '(default)'}`);
    getEventSystem().info(EventCategory.LLM, `   MaxContextMessages: ${maxContextMessages} ${data.agentConfig ? '(from token)' : '(default)'}`);
  }
  
  // Send confirmation with actual turn_detection config
  sendSessionUpdated(ws, data.sessionId, data.model, data.config);
  
  // Debug: Log what we're sending back
  getEventSystem().info(EventCategory.SESSION, '📤 session.updated sending:', JSON.stringify({
    turn_detection: data.config.turn_detection,
    audio_input_turn_detection: data.config.audio?.input?.turn_detection,
  }, null, 2));
}
