import { tool } from 'ai';
import { jsonSchema } from '@ai-sdk/provider-utils';
import { z } from 'zod';

import { getEventSystem, EventCategory } from '../events';
import { generateDualSchema } from './dual-schema-generator';

function enhanceJsonSchema(params: any): any {
  if (!params || typeof params !== 'object') return params;

  const result = { ...params };

  if (result.type === 'object' && (!result.properties || Object.keys(result.properties).length === 0)) {
    if (result.additionalProperties === undefined) {
      result.additionalProperties = true;
    }
  }

  if (result.properties) {
    const enhanced: any = {};
    for (const [key, value] of Object.entries(result.properties)) {
      enhanced[key] = enhanceJsonSchema(value);
    }
    result.properties = enhanced;
  }

  if (result.items) {
    result.items = enhanceJsonSchema(result.items);
  }

  for (const key of ['anyOf', 'allOf', 'oneOf']) {
    if (Array.isArray(result[key])) {
      result[key] = result[key].map(enhanceJsonSchema);
    }
  }

  return result;
}

function createProxyTool(
  toolName: string,
  description: string,
  _inputSchema: z.ZodObject<any>,
  originalParameters?: any
): any {
  const schemaForProvider = originalParameters
    ? jsonSchema(enhanceJsonSchema(originalParameters))
    : _inputSchema;

  getEventSystem().info(EventCategory.SYSTEM, `🔧 [ClientToolProxy] Creating tool "${toolName}" with JSON schema (AI SDK v6 compatible)`);

  if (originalParameters && originalParameters.type === 'object') {
    getEventSystem().info(EventCategory.SYSTEM, `🔧 [ClientToolProxy] Using experimental_toToolCall for ${toolName} (Cerebras compatibility)`);
    return (tool as any)({
      name: toolName,
      description,
      inputSchema: schemaForProvider,
      experimental_toToolCall: (params: any) => ({
        toolName,
        args: params,
      }),
    });
  }

  return (tool as any)({
    name: toolName,
    description,
    inputSchema: schemaForProvider,
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
  getEventSystem().info(EventCategory.SYSTEM, `🔧 [ClientToolProxy] Using JSON schema-based input schemas (via @ai-sdk/provider-utils jsonSchema)`);

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

    const { strict } = generateDualSchema(name, parameters || { properties: {} }, description);

    strictSchemas.set(name, strict);

    getEventSystem().debug(EventCategory.SYSTEM, `🔧 [ClientToolProxy] Tool "${name}" strict schema:`, {
      strictKeys: Object.keys(strict.shape),
      originalParametersKeys: parameters?.properties ? Object.keys(parameters.properties) : [],
      originalRequired: parameters?.required || [],
    });

    tools[name] = createProxyTool(name, description, strict, parameters);

    getEventSystem().info(EventCategory.SYSTEM, `🔧 [ClientToolProxy] Registered JSON schema proxy tool: ${name}`);
  }

  getEventSystem().info(EventCategory.AUTH, `✅ [ClientToolProxy] Converted ${Object.keys(tools).length} client tools (server tools excluded)`);

  return tools;
}
