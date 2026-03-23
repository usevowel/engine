/**
 * Server Tools Registration
 * 
 * Registers all server-side tools with the ServerToolRegistry.
 * Called per-session to allow conditional registration based on configuration.
 */

import { getSpeechMode } from '../../constants';
import { serverToolRegistry, type ServerToolContext } from '../server-tool-registry';
import { executeSpeakTool } from './speak';
import { executeAskSubagent } from './ask-subagent';
// executeSetLanguageTool import removed - setLanguage tool is disabled, replaced by automatic language detection
import { isSubagentModeEnabled } from '../../config/env';
import { getEventSystem, EventCategory } from '../../events';

/**
 * Register all server tools for the current session
 * 
 * This function is called at the start of each response generation.
 * Tools are registered conditionally based on session configuration.
 * 
 * @param context - Server tool context (for conditional checks)
 */
export function registerServerTools(context: ServerToolContext): void {
  // Clear previous registrations (per-session registration)
  serverToolRegistry.clear();
  
  const speechMode = getSpeechMode(context.sessionData.runtimeConfig);
  const subagentMode = isSubagentModeEnabled(context.sessionData.runtimeConfig);
  
  // Register speak tool ONLY in explicit mode
  if (speechMode === 'explicit') {
    serverToolRegistry.register(
      'speak',
      executeSpeakTool,
      {
        description: 'Synthesize speech from text and stream audio to the user. Use this tool when you want to speak to the user.',
        parameters: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The text to synthesize and speak to the user.',
            },
          },
          required: ['message'],
        },
      },
      // Condition: Only available in explicit mode
      (ctx: ServerToolContext) => getSpeechMode(ctx.sessionData.runtimeConfig) === 'explicit'
    );
    
    getEventSystem().info(EventCategory.SESSION, `✅ [ServerToolRegistry] Registered 'speak' tool (explicit mode)`);
  } else {
    getEventSystem().info(EventCategory.SESSION, `ℹ️  [ServerToolRegistry] 'speak' tool not registered (implicit mode)`);
  }
  
  // Register askSubagent tool ONLY when subagent mode is enabled
  if (subagentMode) {
    serverToolRegistry.register(
      'askSubagent',
      executeAskSubagent,
      {
        description: 'Delegate tool execution to specialized subagent. Use this tool when you need to call other tools. The subagent will handle tool execution and return results.',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'Description of what tool(s) need to be executed',
            },
            tools: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific tool names to use (optional)',
            },
          },
          required: ['task'],
        },
      },
      // Condition: Only available when subagent mode is enabled
      (ctx: ServerToolContext) => isSubagentModeEnabled(ctx.sessionData.runtimeConfig)
    );
    
    getEventSystem().info(EventCategory.SESSION, `✅ [ServerToolRegistry] Registered 'askSubagent' tool (subagent mode)`);
  }
  
  // setLanguage tool is DISABLED - replaced by automatic language detection
  // Language detection now happens automatically via LanguageDetectionService
  // which uses Groq's gpt-oss-20b model with structured output to detect
  // the intended language from user transcripts and sets the session language
  // asynchronously (non-blocking) so the right voice is used for TTS.
  
  // setLanguage tool registration removed - automatic detection is enabled
  getEventSystem().info(EventCategory.SESSION, `ℹ️  [ServerToolRegistry] 'setLanguage' tool disabled - using automatic language detection instead`);
}
