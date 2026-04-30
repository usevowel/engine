import { z } from 'zod';
import { generateInstructions } from './instruction-generator';
import { jsonSchemaPropertyToZod } from './json-schema-to-zod';

import { getEventSystem, EventCategory } from '../events';

export interface DualSchema {
  strict: z.ZodObject<any>;
  loose: z.ZodObject<any>;
  instructions: string;
  toolName: string;
  originalSchema: any;
}

export function generateDualSchema(
  toolName: string,
  vowelSchema: any,
  userDescription?: string
): DualSchema {
  
  getEventSystem().info(EventCategory.SYSTEM, `🔧 [DualSchemaGenerator] Generating schemas for: ${toolName}`);
  
  const strictSchema = generateStrictSchema(vowelSchema);
  const looseSchema = z.object({}).passthrough();
  const instructions = generateInstructions(
    toolName,
    userDescription || `Call the ${toolName} function`,
    vowelSchema
  );
  
  getEventSystem().info(EventCategory.SYSTEM, `✅ [DualSchemaGenerator] Generated dual schemas for: ${toolName}`);
  getEventSystem().info(EventCategory.AUTH, `   - Strict: ${Object.keys(strictSchema.shape).length} fields`);
  getEventSystem().info(EventCategory.SYSTEM, `   - Loose: passthrough (accepts any fields)`);
  getEventSystem().info(EventCategory.SYSTEM, `   - Instructions: ${instructions.length} characters`);
  
  return {
    strict: strictSchema,
    loose: looseSchema,
    instructions,
    toolName,
    originalSchema: vowelSchema
  };
}

function generateStrictSchema(vowelSchema: any): z.ZodObject<any> {
  const properties = vowelSchema.properties || {};
  const required = vowelSchema.required || [];
  
  const zodShape: Record<string, z.ZodTypeAny> = {};
  
  for (const [key, value] of Object.entries(properties)) {
    const { zodType, isOptional } = jsonSchemaPropertyToZod(value as any, key);
    const shouldBeOptional = isOptional || !required.includes(key);
    zodShape[key] = shouldBeOptional ? zodType.nullable() : zodType;
  }
  
  return z.object(zodShape);
}
