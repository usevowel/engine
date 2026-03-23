/**
 * Tool Utilities
 * 
 * Tool conversion and injection utilities for session handling.
 */

import { jsonSchema } from 'ai';

import { getEventSystem, EventCategory } from '../../events';
/**
 * Map voice names to provider-specific voice names
 */
export function mapVoiceToProvider(voice: string | undefined, providerName: string): string | undefined {
  // Always pass through the provided voice string verbatim.
  // Provider-specific validation will surface any invalid voice errors upstream.
  return voice;
}

/**
 * Inject speak tool into session tools array
 *
 * @deprecated This function is deprecated. The 'speak' tool is now handled
 * via the ServerToolRegistry system. This function is kept for backward
 * compatibility but will be removed in a future version.
 * 
 * NOTE: The speak tool is now registered via ServerToolRegistry and executed
 * server-side. This function is still used to ensure the agent sees the tool
 * definition, but execution is handled by the registry.
 *
 * @param sessionTools - Existing session tools
 * @returns Session tools array with speak tool added
 */
export function injectSpeakToolIntoSessionTools(sessionTools: any[]): any[] {
  const speakTool = {
    type: 'function',
    name: 'speak',
    description: '🔊 CRITICAL: Use this tool to speak to the user. The user can ONLY hear you when you use this tool. Text responses without this tool are SILENT.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to speak aloud to the user. Keep it conversational and concise (1-2 sentences).',
        },
      },
      required: ['message'],
    },
  };
  
  return [...sessionTools, speakTool];
}

/**
 * Convert session config tools to LLM service format
 *
 * Wraps JSON schemas from the client in jsonSchema() for the AI SDK
 */
export function convertToolsToLLMFormat(sessionTools: any[]): Record<string, any> {
  const tools: Record<string, any> = {};
  let firstToolLogged = false;

  for (const tool of sessionTools) {
    if (tool.type === 'function') {
      const schema = tool.parameters || { type: 'object', properties: {} };

      tools[tool.name] = {
        description: tool.description || '',
        parameters: jsonSchema(schema),
      };

      // Only log the first tool in the set
      if (!firstToolLogged) {
        getEventSystem().info(EventCategory.SESSION, `🔧 [Tools] Converted tool: ${tool.name}`);
        
        // Debug: Log the full tool schema to verify parameters are preserved
        getEventSystem().debug(EventCategory.SESSION, `🔧 [Tools] Tool "${tool.name}" schema:`, {
          hasParameters: !!tool.parameters,
          parameterKeys: tool.parameters ? Object.keys(tool.parameters) : [],
          schemaType: schema.type,
          schemaProperties: schema.properties ? Object.keys(schema.properties) : [],
          schemaRequired: schema.required || [],
          fullSchema: JSON.stringify(schema).substring(0, 500),
        });
        
        firstToolLogged = true;
      }
    }
  }

  return tools;
}
