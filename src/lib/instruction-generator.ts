import { getEventSystem, EventCategory } from '../events';
/**
 * Instruction Generator
 * 
 * Automatically generates rich, detailed instructions for LLM tool calling
 * from Vowel tool schemas. These instructions guide the LLM on proper usage,
 * parameter requirements, and best practices.
 * 
 * The instructions are formatted as markdown and include:
 * - Purpose and description
 * - Required vs optional parameters
 * - Type information and constraints
 * - Usage examples (minimal and full)
 * - Best practices
 * 
 * @module instruction-generator
 */

/**
 * Generate detailed instructions for a tool from its schema
 * 
 * @param toolName - Name of the tool
 * @param userDescription - User-provided tool description
 * @param vowelSchema - Vowel tool schema (OpenAI format)
 * @returns Formatted instruction string
 */
export function generateInstructions(
  toolName: string,
  userDescription: string,
  vowelSchema: any
): string {
  const properties = vowelSchema.properties || {};
  const required = vowelSchema.required || [];
  
  getEventSystem().info(EventCategory.SYSTEM, `📝 [InstructionGenerator] Generating instructions for: ${toolName}`);
  
  const sections: string[] = [];
  
  // Header
  sections.push(`# ${toolName}`);
  sections.push(``);
  
  // Purpose (user's description)
  sections.push(`## Purpose`);
  sections.push(userDescription);
  sections.push(``);
  
  // Parameters section
  sections.push(`## Parameters`);
  sections.push(``);
  
  // Required parameters
  const requiredParams = Object.entries(properties)
    .filter(([key]) => required.includes(key));
  
  if (requiredParams.length > 0) {
    sections.push(`### Required Parameters`);
    sections.push(``);
    sections.push(`These parameters MUST be included in every call:`);
    sections.push(``);
    
    for (const [key, param] of requiredParams) {
      const paramInfo = extractParameterInfo(param as any, key);
      sections.push(`**${key}** (${paramInfo.type})`);
      sections.push(`- ${paramInfo.description}`);
      
      if (paramInfo.constraints.length > 0) {
        sections.push(`- Constraints: ${paramInfo.constraints.join(', ')}`);
      }
      
      if (paramInfo.example) {
        sections.push(`- Example: \`${JSON.stringify(paramInfo.example)}\``);
      }
      
      sections.push(``);
    }
  }
  
  // Optional parameters
  const optionalParams = Object.entries(properties)
    .filter(([key]) => !required.includes(key));
  
  if (optionalParams.length > 0) {
    sections.push(`### Optional Parameters`);
    sections.push(``);
    sections.push(`These parameters should ONLY be included when relevant:`);
    sections.push(``);
    
    for (const [key, param] of optionalParams) {
      const paramInfo = extractParameterInfo(param as any, key);
      sections.push(`**${key}** (${paramInfo.type}, optional)`);
      sections.push(`- ${paramInfo.description}`);
      sections.push(`- Include ONLY if: ${generateInclusionCondition(key, paramInfo)}`);
      
      if (paramInfo.constraints.length > 0) {
        sections.push(`- Constraints: ${paramInfo.constraints.join(', ')}`);
      }
      
      if (paramInfo.example) {
        sections.push(`- Example: \`${JSON.stringify(paramInfo.example)}\``);
      }
      
      sections.push(``);
    }
  }
  
  // Examples section
  sections.push(`## Examples`);
  sections.push(``);
  
  // Minimal example (required only)
  if (requiredParams.length > 0) {
    sections.push(`### Minimal call (required parameters only):`);
    sections.push('```json');
    sections.push(JSON.stringify(
      generateMinimalExample(requiredParams),
      null,
      2
    ));
    sections.push('```');
    sections.push(``);
  }
  
  // Full example (with optional parameters)
  if (optionalParams.length > 0) {
    sections.push(`### Full call (with optional parameters):`);
    sections.push('```json');
    sections.push(JSON.stringify(
      generateFullExample(properties),
      null,
      2
    ));
    sections.push('```');
    sections.push(``);
  }
  
  // Best practices
  sections.push(`## Best Practices`);
  sections.push(``);
  sections.push(`- Always include all required parameters`);
  sections.push(`- Only include optional parameters when they add value to the response`);
  sections.push(`- Omit optional parameters rather than sending null or empty values`);
  sections.push(`- Use clear, descriptive values that match the expected types`);
  sections.push(`- Follow the examples above for proper formatting`);
  
  const instructions = sections.join('\n');
  
  getEventSystem().info(EventCategory.SYSTEM, `✅ [InstructionGenerator] Generated ${instructions.length} characters of instructions`);
  
  return instructions;
}

/**
 * Extract parameter information from schema property
 */
interface ParameterInfo {
  type: string;
  description: string;
  constraints: string[];
  example: any;
}

function extractParameterInfo(param: any, paramName: string): ParameterInfo {
  // Handle anyOf with null pattern (Vowel's optional format)
  let actualParam = param;
  if (param.anyOf && Array.isArray(param.anyOf)) {
    const nonNullSchemas = param.anyOf.filter((s: any) => s.type !== 'null');
    if (nonNullSchemas.length === 1) {
      actualParam = nonNullSchemas[0];
    }
  }
  
  const type = actualParam.type || 'any';
  const description = actualParam.description || `The ${paramName} parameter`;
  const constraints: string[] = [];
  
  // Extract constraints
  if (actualParam.enum) {
    constraints.push(`Must be one of: ${actualParam.enum.join(', ')}`);
  }
  
  if (actualParam.minLength !== undefined) {
    constraints.push(`Minimum length: ${actualParam.minLength}`);
  }
  
  if (actualParam.maxLength !== undefined) {
    constraints.push(`Maximum length: ${actualParam.maxLength}`);
  }
  
  if (actualParam.minimum !== undefined) {
    constraints.push(`Minimum value: ${actualParam.minimum}`);
  }
  
  if (actualParam.maximum !== undefined) {
    constraints.push(`Maximum value: ${actualParam.maximum}`);
  }
  
  if (actualParam.pattern) {
    constraints.push(`Pattern: ${actualParam.pattern}`);
  }
  
  if (actualParam.format) {
    constraints.push(`Format: ${actualParam.format}`);
  }
  
  // Generate example value
  const example = generateExampleValue(actualParam, paramName);
  
  return {
    type,
    description,
    constraints,
    example
  };
}

/**
 * Generate example value for a parameter
 */
function generateExampleValue(param: any, paramName: string): any {
  const type = param.type;
  
  switch (type) {
    case 'string':
      if (param.enum && param.enum.length > 0) {
        return param.enum[0];
      }
      if (param.format === 'email') {
        return 'user@example.com';
      }
      if (param.format === 'uri' || param.format === 'url') {
        return 'https://example.com';
      }
      if (param.format === 'date') {
        return '2025-11-28';
      }
      if (param.format === 'date-time') {
        return '2025-11-28T10:30:00Z';
      }
      // Generate descriptive example based on parameter name
      if (paramName.toLowerCase().includes('id')) {
        return 'abc123';
      }
      if (paramName.toLowerCase().includes('name')) {
        return 'Example Name';
      }
      if (paramName.toLowerCase().includes('response')) {
        return 'Yes, I am interested';
      }
      return 'example value';
      
    case 'number':
    case 'integer':
      if (param.minimum !== undefined) {
        return param.minimum;
      }
      if (param.maximum !== undefined) {
        return Math.floor(param.maximum / 2);
      }
      return 42;
      
    case 'boolean':
      return true;
      
    case 'array':
      if (param.items) {
        const itemExample = generateExampleValue(param.items, paramName);
        return [itemExample];
      }
      return ['item1', 'item2'];
      
    case 'object':
      if (param.properties) {
        const obj: any = {};
        for (const [key, value] of Object.entries(param.properties)) {
          obj[key] = generateExampleValue(value, key);
        }
        return obj;
      }
      return { key: 'value' };
      
    default:
      return null;
  }
}

/**
 * Generate inclusion condition for optional parameter
 */
function generateInclusionCondition(paramName: string, info: ParameterInfo): string {
  // Generate smart conditions based on parameter name and type
  const name = paramName.toLowerCase();
  
  if (name.includes('extract') || name.includes('info')) {
    return 'the user volunteers specific structured information';
  }
  
  if (name.includes('skip') || name.includes('jump')) {
    return 'the user provides information that allows skipping ahead';
  }
  
  if (name.includes('summary')) {
    return 'you need to provide a brief summary of the action';
  }
  
  if (name.includes('reason')) {
    return 'you need to explain why an action is being taken';
  }
  
  if (name.includes('metadata') || name.includes('context')) {
    return 'additional context would be helpful';
  }
  
  // Default condition
  return 'the information is available and relevant to the current context';
}

/**
 * Generate minimal example with only required parameters
 */
function generateMinimalExample(requiredParams: Array<[string, any]>): any {
  const example: any = {};
  
  for (const [key, param] of requiredParams) {
    example[key] = generateExampleValue(param, key);
  }
  
  return example;
}

/**
 * Generate full example with all parameters
 */
function generateFullExample(properties: Record<string, any>): any {
  const example: any = {};
  
  for (const [key, param] of Object.entries(properties)) {
    example[key] = generateExampleValue(param, key);
  }
  
  return example;
}

