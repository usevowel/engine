import { tool } from 'ai';
import { z } from 'zod';

import { getEventSystem, EventCategory } from '../events';
import { generateDualSchema } from './dual-schema-generator';

function createProxyTool(
  toolName: string,
  description: string,
  inputSchema: z.ZodObject<any>,
  originalParameters?: any
): any {
  if (originalParameters && originalParameters.type === 'object') {
    getEventSystem().info(EventCategory.SYSTEM, `🔧 [ClientToolProxy] Using original JSON schema for ${toolName} (Cerebras compatibility)`);
    return (tool as any)({
      name: toolName,
      description,
      inputSchema: inputSchema,
      experimental_toToolCall: (params: any) => ({
        toolName,
        args: params,
      }),
    });
  }
  
  return (tool as any)({
    name: toolName,
    description,
    inputSchema: inputSchema,
  });
}

const strictSchemas = new Map<string, z.ZodObject<any>>();

export function getStrictSchema(toolName: string): z.ZodObject<any> | undefined {
  return strictSchemas.get(toolName);
}

export function clearStrictSchemas(): void {
  strictSchemas.clear();
}

export function convertSessionToolsToProxyTools(
  sessionTools: any[],
  context?: import('./server-tool-registry').ServerToolContext,
  options?: {
    toolExecutor?: (toolName: string, args: Record<string, any>) => Promise<any>;
  }
): Record<string, any> {
  const tools: Record<string, any> = {};
  
  getEventSystem().info(EventCategory.SESSION, `🔧 [ClientToolProxy] Converting ${sessionTools.length} session tools to proxy tools`);
  getEventSystem().info(EventCategory.SYSTEM, `🔧 [ClientToolProxy] Using DUAL SCHEMA mode (loose for provider, strict for validation)`);
  
  const { serverToolRegistry } = require('./server-tool-registry');
  
  for (const sessionTool of sessionTools) {
    const { name, description, parameters } = sessionTool;
    
    if (!name || !description) {
      getEventSystem().warn(EventCategory.SYSTEM, `⚠️  [ClientToolProxy] Skipping tool with missing name or description:`, sessionTool);
      continue;
    }
    
    if (context && serverToolRegistry.isServerTool(name, context)) {
      getEventSystem().info(EventCategory.SESSION, `🚫 [ClientToolProxy] Skipping server tool: ${name} (exempted from client tool pipeline)`);
      continue;
    }
    
    getEventSystem().debug(EventCategory.SYSTEM, `🔍 [ClientToolProxy] Tool "${name}" schema:`, JSON.stringify(parameters, null, 2));
    
    const { strict, loose } = generateDualSchema(name, parameters || { properties: {} }, description);
    
    strictSchemas.set(name, strict);
    
    getEventSystem().debug(EventCategory.SYSTEM, `🔧 [ClientToolProxy] Tool "${name}" dual schemas:`, {
      strictKeys: Object.keys(strict.shape),
      looseType: loose._def.typeName,
      originalParametersKeys: parameters?.properties ? Object.keys(parameters.properties) : [],
      originalRequired: parameters?.required || [],
    });
    
    tools[name] = createProxyTool(name, description, loose, parameters);
    
    getEventSystem().info(EventCategory.SYSTEM, `🔧 [ClientToolProxy] Registered DUAL SCHEMA proxy tool: ${name}`);
  }
  
  getEventSystem().info(EventCategory.AUTH, `✅ [ClientToolProxy] Converted ${Object.keys(tools).length} client tools (server tools excluded)`);
  
  return tools;
}
