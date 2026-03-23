/**
 * JSON Schema to Zod Converter
 * 
 * Utility for converting JSON Schema definitions to Zod schemas.
 * Used by server tool registry to create type-safe tool definitions.
 */

import { z } from 'zod';

/**
 * Convert JSON Schema property to Zod schema
 * 
 * Handles basic type conversions from JSON Schema to Zod.
 * Properly converts optional parameter format (anyOf with null) to Zod optional.
 * 
 * @param property - JSON Schema property definition
 * @param propertyName - Name of the property (for error messages)
 * @returns Zod schema and whether it's optional (has anyOf with null pattern)
 */
function jsonSchemaPropertyToZod(property: any, propertyName: string): { zodType: z.ZodTypeAny; isOptional: boolean } {
  // Check if this is an anyOf with null pattern (optional parameter format)
  // Example: { anyOf: [{ type: 'string', description: '...' }, { type: 'null' }] }
  if (property.anyOf && Array.isArray(property.anyOf)) {
    const hasNull = property.anyOf.some((schema: any) => schema.type === 'null');
    const nonNullSchemas = property.anyOf.filter((schema: any) => schema.type !== 'null');
    
    if (hasNull && nonNullSchemas.length === 1) {
      // This is an optional parameter - extract the actual type schema
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
      zodType = z.any();
  }
  
  // Add description if available
  if (description) {
    zodType = zodType.describe(description);
  }
  
  return { zodType, isOptional: false };
}

/**
 * Convert JSON Schema to Zod schema
 * 
 * @param jsonSchema - JSON Schema object (with properties, required, etc.)
 * @returns Zod schema object
 */
export function convertJsonSchemaToZod(jsonSchema: any): z.ZodObject<any> {
  if (!jsonSchema || jsonSchema.type !== 'object') {
    return z.object({});
  }
  
  const properties = jsonSchema.properties || {};
  const required = jsonSchema.required || [];
  
  const zodShape: Record<string, z.ZodTypeAny> = {};
  
  for (const [key, value] of Object.entries(properties)) {
    const { zodType, isOptional } = jsonSchemaPropertyToZod(value, key);
    
    const shouldBeOptional = isOptional || !required.includes(key);
    
    if (shouldBeOptional) {
      zodShape[key] = zodType.optional();
    } else {
      zodShape[key] = zodType;
    }
  }
  
  return z.object(zodShape);
}
