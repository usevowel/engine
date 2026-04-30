import { z } from 'zod';

import { getEventSystem, EventCategory } from '../events';

const registeredRefs = new Map<string, z.ZodTypeAny>();

export function registerRef(refPath: string, schema: z.ZodTypeAny): void {
  const cleanPath = refPath.replace(/^#\/\$defs\//, '').replace(/^#\/definitions\//, '');
  registeredRefs.set(cleanPath, schema);
}

function resolveRef(refPath: string, rootSchema?: any): z.ZodTypeAny | null {
  const cleanPath = refPath.replace(/^#\/\$defs\//, '').replace(/^#\/definitions\//, '');
  if (registeredRefs.has(cleanPath)) {
    return registeredRefs.get(cleanPath)!;
  }
  if (rootSchema) {
    const defs = rootSchema.$defs || rootSchema.definitions || {};
    const def = defs[cleanPath];
    if (def) {
      const result = jsonSchemaPropertyToZodInner(def, cleanPath);
      registeredRefs.set(cleanPath, result.zodType);
      return result.zodType;
    }
  }
  return null;
}

export function jsonSchemaPropertyToZod(
  property: any,
  propertyName: string,
  rootSchema?: any
): { zodType: z.ZodTypeAny; isOptional: boolean } {
  const result = jsonSchemaPropertyToZodInner(property, propertyName, rootSchema);
  return result;
}

function jsonSchemaPropertyToZodInner(
  property: any,
  propertyName: string,
  rootSchema?: any
): { zodType: z.ZodTypeAny; isOptional: boolean } {
  if (property.$ref) {
    const resolved = resolveRef(property.$ref, rootSchema);
    if (resolved) {
      return { zodType: resolved, isOptional: false };
    }
    getEventSystem().warn(EventCategory.SYSTEM, `⚠️  [JsonSchemaToZod] Unresolved $ref: ${property.$ref} for ${propertyName}, defaulting to z.any()`);
    return { zodType: z.any(), isOptional: false };
  }

  if (property.anyOf && Array.isArray(property.anyOf)) {
    const hasNull = property.anyOf.some((s: any) => s.type === 'null' || (s.$ref && (s.$ref as string).toLowerCase().includes('null')));
    const nonNullSchemas = property.anyOf.filter((s: any) => s.type !== 'null');
    
    if (hasNull && nonNullSchemas.length === 1) {
      return jsonSchemaPropertyToZodInner(nonNullSchemas[0], propertyName, rootSchema);
    }
    
    const schemas: z.ZodTypeAny[] = [];
    for (const s of nonNullSchemas) {
      const r = jsonSchemaPropertyToZodInner(s, `${propertyName}[anyOf]`, rootSchema);
      schemas.push(r.zodType);
    }
    if (schemas.length === 1) {
      return { zodType: schemas[0], isOptional: false };
    }
    return { zodType: z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]), isOptional: false };
  }

  if (property.allOf && Array.isArray(property.allOf)) {
    let merged: any = {};
    for (const s of property.allOf) {
      if (s.type) merged.type = s.type;
      if (s.properties) {
        merged.properties = { ...merged.properties, ...s.properties };
      }
      if (s.required) {
        merged.required = [...(merged.required || []), ...s.required];
      }
    }
    if (merged.properties || merged.type) {
      return jsonSchemaPropertyToZodInner(merged, propertyName, rootSchema);
    }
    getEventSystem().warn(EventCategory.SYSTEM, `⚠️  [JsonSchemaToZod] allOf for ${propertyName} couldn't be merged, defaulting to z.any()`);
    return { zodType: z.any(), isOptional: false };
  }

  if (property.oneOf && Array.isArray(property.oneOf)) {
    const schemas: z.ZodTypeAny[] = [];
    for (const s of property.oneOf) {
      const r = jsonSchemaPropertyToZodInner(s, `${propertyName}[oneOf]`, rootSchema);
      schemas.push(r.zodType);
    }
    if (schemas.length === 1) {
      return { zodType: schemas[0], isOptional: false };
    }
    return { zodType: z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]), isOptional: false };
  }

  const type = property.type;
  const description = property.description;

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
        const itemResult = jsonSchemaPropertyToZodInner(property.items, `${propertyName}[]`, rootSchema);
        zodType = z.array(itemResult.zodType);
      } else {
        zodType = z.array(z.any());
      }
      break;

    case 'object':
      if (property.properties) {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, value] of Object.entries(property.properties)) {
          const result = jsonSchemaPropertyToZodInner(value, key, rootSchema);
          shape[key] = result.zodType;
        }
        zodType = z.object(shape);
      } else {
        zodType = z.record(z.string(), z.any());
      }
      break;

    default:
      if (!type) {
        if (property.properties) {
          const shape: Record<string, z.ZodTypeAny> = {};
          for (const [key, value] of Object.entries(property.properties)) {
            const result = jsonSchemaPropertyToZodInner(value, key, rootSchema);
            shape[key] = result.zodType;
          }
          zodType = z.object(shape);
        } else {
          zodType = z.any();
        }
      } else {
        getEventSystem().warn(EventCategory.SYSTEM, `⚠️  [JsonSchemaToZod] Unknown type: ${type} for ${propertyName}, defaulting to z.any()`);
        zodType = z.any();
      }
  }

  if (description) {
    zodType = zodType.describe(description);
  }

  return { zodType, isOptional: false };
}

export function convertJsonSchemaToZod(jsonSchema: any): z.ZodObject<any> {
  if (!jsonSchema) {
    return z.object({});
  }

  if (jsonSchema.$ref) {
    const resolved = resolveRef(jsonSchema.$ref, jsonSchema);
    if (resolved && resolved instanceof z.ZodObject) {
      return resolved;
    }
    return z.object({});
  }

  if (jsonSchema.properties) {
    const properties = jsonSchema.properties || {};
    const required = jsonSchema.required || [];
    const zodShape: Record<string, z.ZodTypeAny> = {};

    for (const [key, value] of Object.entries(properties)) {
      const { zodType, isOptional } = jsonSchemaPropertyToZodInner(value, key, jsonSchema);
      const shouldBeOptional = isOptional || !required.includes(key);
      zodShape[key] = shouldBeOptional ? zodType.optional() : zodType;
    }

    return z.object(zodShape);
  }

  return z.object({});
}
