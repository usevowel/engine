/**
 * Client-Side Tool Proxy
 * 
 * Converts OpenAI Realtime API tool definitions to Vercel AI SDK tools
 * WITHOUT execute functions, enabling client-side tool execution.
 * 
 * When tools don't have execute functions:
 * 1. Agent emits tool-call events in stream
 * 2. Agent does NOT try to execute tools
 * 3. Handler forwards tool calls to client via WebSocket
 * 4. Client executes and sends results back
 * 5. Handler adds results to conversation and continues
 * 
 * This maintains compatibility with the OpenAI Realtime API pattern
 * while leveraging the Agent's multi-step reasoning capabilities.
 */

import { tool } from 'ai';
import { z } from 'zod';

import { getEventSystem, EventCategory } from '../events';
/**
 * Create a proxy tool that emits tool calls without executing them
 * 
 * Returns a CoreTool WITHOUT an execute function, which means:
 * 1. Agent emits tool-call event in stream
 * 2. Agent does NOT try to execute the tool
 * 3. Handler receives tool-call event and forwards to client
 * 4. Client executes and sends result back
 * 5. Handler adds result to conversation and continues
 * 
 * This enables client-side tool execution while maintaining
 * compatibility with the OpenAI Realtime API pattern.
 * 
 * @param toolName - Name of the tool (must match client-side tool)
 * @param description - Tool description for LLM
 * @param inputSchema - Zod schema for tool parameters
 * @returns CoreTool that emits calls without executing
 */
function createProxyTool(
  toolName: string,
  description: string,
  inputSchema: z.ZodObject<any>,
  originalParameters?: any
): any {
  // Create tool WITHOUT execute function
  // This tells the Agent to emit tool-call events but not execute
  
  // For Cerebras compatibility: Use original JSON schema if available
  // Cerebras requires explicit "type": "object" at top level
  if (originalParameters && originalParameters.type === 'object') {
    getEventSystem().info(EventCategory.SYSTEM, `🔧 [ClientToolProxy] Using original JSON schema for ${toolName} (Cerebras compatibility)`);
    return (tool as any)({
      name: toolName, // Required by AI SDK tokenization system ("harmony")
      description,
      inputSchema: inputSchema, // Vercel AI SDK uses inputSchema, not parameters
      // Experimental: Try passing JSON schema directly
      experimental_toToolCall: (params: any) => ({
        toolName,
        args: params,
      }),
      // NO execute function - this is intentional!
    });
  }
  
  return (tool as any)({
    name: toolName, // Required by AI SDK tokenization system ("harmony")
    description,
    inputSchema: inputSchema, // Vercel AI SDK uses inputSchema, not parameters
    // NO execute function - this is intentional!
    // The Agent will emit tool-call events without trying to execute
  });
}

/**
 * Convert JSON Schema property to Zod schema
 * 
 * Handles basic type conversions from JSON Schema to Zod.
 * Properly converts Vowel's optional parameter format (anyOf with null) to Zod optional.
 * 
 * @param property - JSON Schema property definition
 * @param propertyName - Name of the property (for error messages)
 * @returns Zod schema and whether it's optional (has anyOf with null pattern)
 */
function jsonSchemaPropertyToZod(property: any, propertyName: string): { zodType: z.ZodTypeAny; isOptional: boolean } {
  // Check if this is an anyOf with null pattern (Vowel's optional parameter format)
  // Example: { anyOf: [{ type: 'string', description: '...' }, { type: 'null' }] }
  if (property.anyOf && Array.isArray(property.anyOf)) {
    const hasNull = property.anyOf.some((schema: any) => schema.type === 'null');
    const nonNullSchemas = property.anyOf.filter((schema: any) => schema.type !== 'null');
    
    if (hasNull && nonNullSchemas.length === 1) {
      // This is an optional parameter in Vowel's format (anyOf: [type, null])
      // Extract the actual type schema and mark as optional
      // The caller will use .optional() instead of .nullable() for proper Zod optional handling
      getEventSystem().debug(EventCategory.SYSTEM, `🔍 [ClientToolProxy] Detected anyOf with null for ${propertyName} - converting to proper optional parameter`);
      const actualSchema = nonNullSchemas[0];
      const result = jsonSchemaPropertyToZod(actualSchema, propertyName);
      return { zodType: result.zodType, isOptional: true };
    }
  }
  
  const type = property.type;
  const description = property.description;
  
  // Basic type mapping
  let zodType: z.ZodTypeAny;
  
  switch (type) {
    case 'string':
      zodType = z.string();
      if (property.enum) {
        zodType = z.enum(property.enum as [string, ...string[]]);
      }
      break;
      
    case 'number':
      zodType = z.number();
      break;
      
    case 'integer':
      zodType = z.number().int();
      break;
      
    case 'boolean':
      zodType = z.boolean();
      break;
      
    case 'array':
      if (property.items) {
        const itemResult = jsonSchemaPropertyToZod(property.items, `${propertyName}[]`);
        zodType = z.array(itemResult.zodType);
      } else {
        zodType = z.array(z.any());
      }
      break;
      
    case 'object':
      if (property.properties) {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, value] of Object.entries(property.properties)) {
          const result = jsonSchemaPropertyToZod(value, key);
          shape[key] = result.zodType;
        }
        zodType = z.object(shape);
      } else {
        zodType = z.record(z.string(), z.any());
      }
      break;
      
    default:
      getEventSystem().warn(EventCategory.SYSTEM, `⚠️  [ClientToolProxy] Unknown JSON Schema type: ${type} for ${propertyName}, defaulting to z.any()`);
      zodType = z.any();
  }
  
  // Add description if available
  if (description) {
    zodType = zodType.describe(description);
  }
  
  return { zodType, isOptional: false };
}

/**
 * Convert OpenAI Realtime API tool definitions to Vercel AI SDK proxy tools
 * 
 * Takes tool definitions from session.update (OpenAI format) and converts them
 * to Vercel AI SDK CoreTools WITHOUT execute functions.
 * 
 * CRITICAL: Server tools are FILTERED OUT and never converted here.
 * Server tools are handled separately via ServerToolRegistry.
 * 
 * This enables client-side tool execution:
 * - Agent emits tool-call events
 * - Handler forwards to client
 * - Client executes and returns results
 * - Handler continues conversation
 * 
 * @param sessionTools - Tool definitions from session.update (OpenAI format)
 * @param context - Server tool context for filtering server tools
 * @param options - Conversion options (deprecated, kept for backward compatibility)
 * @returns Record of CoreTools that emit calls without executing (server tools excluded)
 */
export function convertSessionToolsToProxyTools(
  sessionTools: any[],
  context?: import('./server-tool-registry').ServerToolContext,
  options?: {
    toolExecutor?: (toolName: string, args: Record<string, any>) => Promise<any>;
  }
): Record<string, any> {
  const tools: Record<string, any> = {};
  
  getEventSystem().info(EventCategory.SESSION, `🔧 [ClientToolProxy] Converting ${sessionTools.length} session tools to proxy tools`);
  getEventSystem().info(EventCategory.SYSTEM, `🔧 [ClientToolProxy] Using STRICT SCHEMA mode`);
  
  // Import serverToolRegistry dynamically to avoid circular dependencies
  const { serverToolRegistry } = require('./server-tool-registry');
  
  for (const sessionTool of sessionTools) {
    const { name, description, parameters } = sessionTool;
    
    if (!name || !description) {
      getEventSystem().warn(EventCategory.SYSTEM, `⚠️  [ClientToolProxy] Skipping tool with missing name or description:`, sessionTool);
      continue;
    }
    
    // CRITICAL: Filter out server tools - they are NEVER converted to proxy tools
    // Only filter if context is provided (backward compatibility)
    if (context && serverToolRegistry.isServerTool(name, context)) {
      getEventSystem().info(EventCategory.SESSION, `🚫 [ClientToolProxy] Skipping server tool: ${name} (exempted from client tool pipeline)`);
      continue; // Skip server tools entirely
    }
    
    // Log incoming schema for debugging
    getEventSystem().debug(EventCategory.SYSTEM, `🔍 [ClientToolProxy] Tool "${name}" schema:`, JSON.stringify(parameters, null, 2));
    
    const properties = parameters?.properties || {};
    const required = parameters?.required || [];
    
    const zodShape: Record<string, z.ZodTypeAny> = {};
    
    for (const [key, value] of Object.entries(properties)) {
      const { zodType, isOptional } = jsonSchemaPropertyToZod(value, key);
      
      const shouldBeOptional = isOptional || !required.includes(key);
      
      if (shouldBeOptional) {
        // Use .optional() instead of .nullable() - this allows the field to be omitted entirely
        // rather than requiring null to be passed
        zodShape[key] = zodType.optional();
        getEventSystem().debug(EventCategory.AUTH, `🔍 [ClientToolProxy] Marked ${key} as optional (can be omitted)`);
      } else {
        zodShape[key] = zodType;
      }
    }
    
    const zodSchema = z.object(zodShape);
    
    // Debug: Log the Zod schema shape to verify parameters are preserved
    getEventSystem().debug(EventCategory.SYSTEM, `🔧 [ClientToolProxy] Tool "${name}" Zod schema shape:`, {
      zodShapeKeys: Object.keys(zodShape),
      originalParameterProperties: properties ? Object.keys(properties) : [],
      originalRequired: required,
      hasParameters: !!parameters,
      parametersType: parameters?.type,
      parametersPropertiesKeys: parameters?.properties ? Object.keys(parameters.properties) : [],
    });
    
    // Create proxy tool WITHOUT execute function
    tools[name] = createProxyTool(name, description, zodSchema, parameters);
    
    getEventSystem().info(EventCategory.SYSTEM, `🔧 [ClientToolProxy] Registered STRICT SCHEMA proxy tool: ${name}`);
  }
  
  getEventSystem().info(EventCategory.AUTH, `✅ [ClientToolProxy] Converted ${Object.keys(tools).length} client tools (server tools excluded)`);
  
  return tools;
}
