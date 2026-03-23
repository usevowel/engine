/**
 * Dual Schema Generator
 * 
 * Generates two schemas from Vowel tool definitions:
 * 1. Strict Schema - Full Zod validation for internal use
 * 2. Loose Schema - Permissive schema for LLM provider
 * 
 * This enables the "Trust but Verify" pattern:
 * - Send loose schema to provider (never fails at API level)
 * - Validate with strict schema on our side (full control)
 * - Repair malformed tool calls automatically
 * 
 * @module dual-schema-generator
 */

import { z } from 'zod';
import { generateInstructions } from './instruction-generator';

import { getEventSystem, EventCategory } from '../events';
/**
 * Dual schema pair for a tool
 */
export interface DualSchema {
  /** Strict Zod schema for internal validation */
  strict: z.ZodObject<any>;
  
  /** Loose schema for LLM provider (always passes) */
  loose: z.ZodObject<any>;
  
  /** Rich instructions for LLM guidance */
  instructions: string;
  
  /** Tool name */
  toolName: string;
  
  /** Original Vowel schema */
  originalSchema: any;
}

/**
 * Generate dual schemas from Vowel tool definition
 * 
 * @param toolName - Name of the tool
 * @param vowelSchema - Vowel tool schema (OpenAI format)
 * @param userDescription - User-provided tool description
 * @returns Dual schema pair with instructions
 */
export function generateDualSchema(
  toolName: string,
  vowelSchema: any,
  userDescription?: string
): DualSchema {
  
  getEventSystem().info(EventCategory.SYSTEM, `🔧 [DualSchemaGenerator] Generating schemas for: ${toolName}`);
  
  // Generate strict schema (current logic from client-tool-proxy.ts)
  const strictSchema = generateStrictSchema(vowelSchema);
  
  // Generate loose schema (accepts anything)
  const looseSchema = z.object({}).passthrough();
  
  // Generate rich instructions for LLM guidance
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

/**
 * Generate strict Zod schema from Vowel schema
 * 
 * This is the existing logic from client-tool-proxy.ts,
 * extracted and enhanced to handle optional parameters correctly.
 * 
 * @param vowelSchema - Vowel tool schema
 * @returns Strict Zod schema
 */
function generateStrictSchema(vowelSchema: any): z.ZodObject<any> {
  const properties = vowelSchema.properties || {};
  const required = vowelSchema.required || [];
  
  const zodShape: Record<string, z.ZodTypeAny> = {};
  
  for (const [key, value] of Object.entries(properties)) {
    const { zodType, isOptional } = jsonSchemaPropertyToZod(value as any, key);
    
    // Determine if parameter is optional:
    // 1. If it has anyOf with null (Vowel's format), it's optional
    // 2. If it's not in the required array, it's optional
    const shouldBeOptional = isOptional || !required.includes(key);
    
    if (shouldBeOptional) {
      // Use .nullable() for better JSON Schema compatibility
      zodShape[key] = zodType.nullable();
    } else {
      zodShape[key] = zodType;
    }
  }
  
  return z.object(zodShape);
}

/**
 * Convert JSON Schema property to Zod schema
 * 
 * Handles anyOf with null pattern (Vowel's optional parameter format)
 * 
 * @param property - JSON Schema property definition
 * @param propertyName - Name of the property
 * @returns Zod schema and whether it's optional
 */
function jsonSchemaPropertyToZod(
  property: any,
  propertyName: string
): { zodType: z.ZodTypeAny; isOptional: boolean } {
  
  // Check if this is an anyOf with null pattern (Vowel's optional parameter format)
  if (property.anyOf && Array.isArray(property.anyOf)) {
    const hasNull = property.anyOf.some((schema: any) => schema.type === 'null');
    const nonNullSchemas = property.anyOf.filter((schema: any) => schema.type !== 'null');
    
    if (hasNull && nonNullSchemas.length === 1) {
      // This is an optional parameter in Vowel's format
      getEventSystem().debug(EventCategory.SYSTEM, `🔍 [DualSchemaGenerator] Detected anyOf with null for ${propertyName} - treating as optional`);
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
        zodType = z.record(z.any());
      }
      break;
      
    default:
      getEventSystem().warn(EventCategory.SYSTEM, `⚠️  [DualSchemaGenerator] Unknown JSON Schema type: ${type} for ${propertyName}, defaulting to z.any()`);
      zodType = z.any();
  }
  
  // Add description if available
  if (description) {
    zodType = zodType.describe(description);
  }
  
  return { zodType, isOptional: false };
}

