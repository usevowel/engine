/**
 * Vowel to OpenAI Schema Converter
 * 
 * Converts Vowel tool parameter definitions to OpenAI JSON Schema format.
 * 
 * Vowel Format:
 * ```
 * parameters: {
 *   query: { type: 'string', description: '...', optional: true },
 *   maxPrice: { type: 'number', description: '...', optional: true }
 * }
 * ```
 * 
 * OpenAI Format:
 * ```
 * parameters: {
 *   type: 'object',
 *   properties: {
 *     query: { type: 'string', description: '...' },
 *     maxPrice: { type: 'number', description: '...' }
 *   },
 *   required: [] // Empty if all optional
 * }
 * ```
 */

import { getEventSystem, EventCategory } from '../events';

/**
 * Convert Vowel tool definition to OpenAI JSON Schema format
 * 
 * @param toolDef - Tool definition from client (may be in Vowel or OpenAI format)
 * @returns Tool definition in OpenAI format
 */
export function convertVowelToolToOpenAIFormat(toolDef: any): any {
  // Debug: Log the incoming tool definition
  getEventSystem().debug(EventCategory.SYSTEM, `🔧 [VowelToOpenAI] Checking tool "${toolDef.name}":`, {
    hasParameters: !!toolDef.parameters,
    parametersType: toolDef.parameters?.type,
    hasProperties: toolDef.parameters?.properties !== undefined,
    propertiesValue: toolDef.parameters?.properties,
    parametersKeys: toolDef.parameters ? Object.keys(toolDef.parameters) : [],
  });
  
  // If already in OpenAI format (has type: 'object'), return as-is
  // Check for 'type: object' to detect OpenAI format - properties may be empty or undefined
  if (toolDef.parameters?.type === 'object') {
    // Ensure properties exists (even if empty)
    if (toolDef.parameters.properties === undefined || toolDef.parameters.properties === null) {
      getEventSystem().debug(EventCategory.SYSTEM, `🔧 [VowelToOpenAI] Tool "${toolDef.name}" is OpenAI format but missing properties - adding empty object`);
      return {
        ...toolDef,
        parameters: {
          ...toolDef.parameters,
          properties: toolDef.parameters.properties || {},
        },
      };
    }
    getEventSystem().debug(EventCategory.SYSTEM, `🔧 [VowelToOpenAI] Tool "${toolDef.name}" already in OpenAI format`);
    return toolDef;
  }
  
  // If no parameters, return with empty object schema
  if (!toolDef.parameters || Object.keys(toolDef.parameters).length === 0) {
    getEventSystem().debug(EventCategory.SYSTEM, `🔧 [VowelToOpenAI] Tool "${toolDef.name}" has no parameters`);
    return {
      ...toolDef,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    };
  }
  
  // Convert Vowel format to OpenAI format
  getEventSystem().info(EventCategory.SYSTEM, `🔧 [VowelToOpenAI] Converting tool "${toolDef.name}" from Vowel to OpenAI format`);
  getEventSystem().debug(EventCategory.SYSTEM, `   Input parameters:`, JSON.stringify(toolDef.parameters, null, 2));
  
  // SAFETY CHECK: Detect if parameters looks like OpenAI format that slipped through
  // OpenAI format has keys like 'type', 'properties', 'required', 'additionalProperties'
  // Vowel format has keys that are parameter names with nested type/description
  const paramKeys = Object.keys(toolDef.parameters);
  const openaiFormatKeys = ['type', 'properties', 'required', 'additionalProperties'];
  const looksLikeOpenAI = paramKeys.some(key => openaiFormatKeys.includes(key));
  
  if (looksLikeOpenAI) {
    getEventSystem().warn(EventCategory.SYSTEM, 
      `⚠️ [VowelToOpenAI] Tool "${toolDef.name}" looks like OpenAI format but wasn't detected as such! ` +
      `Keys: ${paramKeys.join(', ')}. This may cause issues.`
    );
    // If it has 'type' and 'properties', treat it as OpenAI format
    if (toolDef.parameters.type && (toolDef.parameters.properties !== undefined || paramKeys.includes('properties'))) {
      getEventSystem().warn(EventCategory.SYSTEM, 
        `⚠️ [VowelToOpenAI] Returning tool "${toolDef.name}" as-is (looks like OpenAI format)`
      );
      return {
        ...toolDef,
        parameters: {
          ...toolDef.parameters,
          properties: toolDef.parameters.properties || {},
        },
      };
    }
  }
  
  const properties: Record<string, any> = {};
  const required: string[] = [];
  
  for (const [paramName, paramDef] of Object.entries(toolDef.parameters)) {
    const param = paramDef as any;
    
    // Build property schema (without 'optional' field)
    const propertySchema: any = {
      type: param.type,
    };
    
    // Add description if present
    if (param.description) {
      propertySchema.description = param.description;
    }
    
    // Add enum if present
    if (param.enum) {
      propertySchema.enum = param.enum;
    }
    
    // Add items if array type
    if (param.type === 'array' && param.items) {
      propertySchema.items = param.items;
    }
    
    // Add properties if object type
    if (param.type === 'object' && param.properties) {
      propertySchema.properties = param.properties;
    }
    
    properties[paramName] = propertySchema;
    
    // Add to required array if not optional
    if (!param.optional) {
      required.push(paramName);
    }
    
    getEventSystem().debug(EventCategory.SYSTEM, 
      `  - ${paramName}: ${param.type}${param.optional ? ' (optional)' : ' (required)'}`
    );
  }
  
  const openAISchema = {
    ...toolDef,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  };
  
  getEventSystem().info(EventCategory.SYSTEM, 
    `✅ [VowelToOpenAI] Converted tool "${toolDef.name}": ${Object.keys(properties).length} properties, ${required.length} required`
  );
  getEventSystem().debug(EventCategory.SYSTEM, `   Output schema:`, JSON.stringify(openAISchema.parameters, null, 2));
  
  return openAISchema;
}

/**
 * Convert array of Vowel tools to OpenAI format
 * 
 * @param tools - Array of tool definitions
 * @returns Array of tool definitions in OpenAI format
 */
export function convertVowelToolsToOpenAIFormat(tools: any[]): any[] {
  if (!tools || tools.length === 0) {
    return [];
  }
  
  getEventSystem().info(EventCategory.SYSTEM, `🔧 [VowelToOpenAI] Converting ${tools.length} tools to OpenAI format`);
  
  return tools.map(tool => convertVowelToolToOpenAIFormat(tool));
}
