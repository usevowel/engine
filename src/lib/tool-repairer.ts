/**
 * Tool Repairer
 * 
 * Implements hybrid repair strategy for malformed tool calls:
 * 1. Automatic Repair - Fix simple errors programmatically (fast, no LLM)
 * 2. LLM Re-ask - Send error back to LLM for complex fixes (slower, intelligent)
 * 
 * The repairer respects maxSteps limit to prevent infinite loops.
 * 
 * @module tool-repairer
 */

import { z } from 'zod';

import { getEventSystem, EventCategory } from '../events';
/**
 * Repair result
 */
export interface RepairResult {
  /** Whether repair was successful */
  success: boolean;
  
  /** Repair strategy used */
  strategy: 'automatic' | 'llm-reask' | 'none';
  
  /** Repaired input (if successful) */
  repairedInput?: any;
  
  /** Error message for LLM (if using re-ask strategy) */
  errorMessage?: string;
  
  /** Hint for LLM */
  hint?: string;
  
  /** Example of correct usage */
  example?: any;
}

/**
 * Attempt to repair a malformed tool call
 * 
 * Uses hybrid approach:
 * 1. Try automatic repair first (fast, deterministic)
 * 2. If automatic fails, prepare LLM re-ask (intelligent, context-aware)
 * 
 * @param input - Original tool call input
 * @param error - Validation error from Zod
 * @param schema - Strict Zod schema
 * @param toolName - Name of the tool
 * @returns Repair result
 */
export function attemptRepair(
  input: any,
  error: z.ZodError,
  schema: z.ZodObject<any>,
  toolName: string
): RepairResult {
  
  getEventSystem().info(EventCategory.SYSTEM, `🔧 [ToolRepairer] Attempting repair for ${toolName}`);
  getEventSystem().error(EventCategory.SYSTEM, `🔍 [ToolRepairer] Validation errors:`, error.issues.length);
  
  // Phase 1: Try automatic repair
  const automaticResult = attemptAutomaticRepair(input, error, schema);
  
  if (automaticResult.success) {
    getEventSystem().info(EventCategory.SYSTEM, `✅ [ToolRepairer] Automatic repair SUCCEEDED`);
    return automaticResult;
  }
  
  getEventSystem().error(EventCategory.SYSTEM, `⚠️  [ToolRepairer] Automatic repair failed, preparing LLM re-ask`);
  
  // Phase 2: Prepare LLM re-ask
  const reaskResult = prepareLLMReask(input, error, schema, toolName);
  
  return reaskResult;
}

/**
 * Attempt automatic repair (Strategy 1)
 * 
 * Fixes common, predictable errors without LLM involvement:
 * - Type coercion (string → number, etc.)
 * - Strip extra fields
 * - Handle null/undefined for optional fields
 * - Fix simple format issues
 * 
 * @param input - Original input
 * @param error - Validation error
 * @param schema - Strict schema
 * @returns Repair result
 */
function attemptAutomaticRepair(
  input: any,
  error: z.ZodError,
  schema: z.ZodObject<any>
): RepairResult {
  
  getEventSystem().info(EventCategory.SYSTEM, `🔧 [ToolRepairer] Trying automatic repair strategies...`);
  
  let repairedInput = { ...input };
  let madeChanges = false;
  
  // Strategy 1: Type Coercion
  for (const issue of error.issues) {
    if (issue.code === 'invalid_type') {
      const path = issue.path.join('.');
      const expected = issue.expected;
      const received = issue.received;
      const value = getNestedValue(repairedInput, issue.path);
      
      getEventSystem().info(EventCategory.SYSTEM, `🔧 [ToolRepairer] Type mismatch at ${path}: expected ${expected}, got ${received}`);
      
      // Try to coerce the type
      const coerced = coerceType(value, expected);
      if (coerced !== undefined) {
        setNestedValue(repairedInput, issue.path, coerced);
        madeChanges = true;
        getEventSystem().info(EventCategory.SYSTEM, `✅ [ToolRepairer] Coerced ${path} from ${received} to ${expected}`);
      }
    }
  }
  
  // Strategy 2: Strip Extra Fields
  const extraFields = error.issues.filter(i => i.code === 'unrecognized_keys');
  if (extraFields.length > 0) {
    const schemaKeys = Object.keys(schema.shape);
    const inputKeys = Object.keys(repairedInput);
    
    for (const key of inputKeys) {
      if (!schemaKeys.includes(key)) {
        delete repairedInput[key];
        madeChanges = true;
        getEventSystem().info(EventCategory.AUTH, `✅ [ToolRepairer] Stripped extra field: ${key}`);
      }
    }
  }
  
  // Strategy 3: Handle Null/Undefined for Optional Fields
  for (const issue of error.issues) {
    if (issue.code === 'invalid_type' && issue.received === 'undefined') {
      const path = issue.path.join('.');
      const schemaField = getSchemaField(schema, issue.path);
      
      // Check if field is optional (nullable)
      if (schemaField && isOptionalField(schemaField)) {
        setNestedValue(repairedInput, issue.path, null);
        madeChanges = true;
        getEventSystem().info(EventCategory.SYSTEM, `✅ [ToolRepairer] Set undefined optional field ${path} to null`);
      }
    }
  }
  
  // If we made changes, try validating again
  if (madeChanges) {
    try {
      const validated = schema.parse(repairedInput);
      getEventSystem().info(EventCategory.SYSTEM, `✅ [ToolRepairer] Automatic repair successful!`);
      
      return {
        success: true,
        strategy: 'automatic',
        repairedInput: validated
      };
    } catch (retryError) {
      getEventSystem().error(EventCategory.SYSTEM, `⚠️  [ToolRepairer] Automatic repair made changes but validation still failed`);
      // Fall through to LLM re-ask
    }
  } else {
    getEventSystem().warn(EventCategory.SYSTEM, `⚠️  [ToolRepairer] No automatic repairs applicable`);
  }
  
  return {
    success: false,
    strategy: 'none'
  };
}

/**
 * Prepare LLM re-ask (Strategy 2)
 * 
 * Creates a structured error message that will be sent back to the LLM
 * as a tool-result, prompting it to retry with correct parameters.
 * 
 * @param input - Original input
 * @param error - Validation error
 * @param schema - Strict schema
 * @param toolName - Tool name
 * @returns Repair result with error message for LLM
 */
function prepareLLMReask(
  input: any,
  error: z.ZodError,
  schema: z.ZodObject<any>,
  toolName: string
): RepairResult {
  
  getEventSystem().info(EventCategory.LLM, `🔧 [ToolRepairer] Preparing LLM re-ask strategy`);
  
  // Format validation errors in a clear, actionable way
  const errorMessages: string[] = [];
  const hints: string[] = [];
  
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'root';
    
    switch (issue.code) {
      case 'invalid_type':
        errorMessages.push(`Field '${path}': Expected ${issue.expected}, but received ${issue.received}`);
        hints.push(`Ensure '${path}' is a ${issue.expected}`);
        break;
        
      case 'invalid_literal':
        errorMessages.push(`Field '${path}': Must be exactly ${JSON.stringify(issue.expected)}`);
        hints.push(`Set '${path}' to ${JSON.stringify(issue.expected)}`);
        break;
        
      case 'invalid_enum_value':
        errorMessages.push(`Field '${path}': Must be one of: ${issue.options.join(', ')}`);
        hints.push(`Choose a valid value for '${path}' from the allowed options`);
        break;
        
      case 'too_small':
        if (issue.type === 'string') {
          errorMessages.push(`Field '${path}': String is too short (minimum ${issue.minimum} characters)`);
        } else if (issue.type === 'number') {
          errorMessages.push(`Field '${path}': Number is too small (minimum ${issue.minimum})`);
        } else if (issue.type === 'array') {
          errorMessages.push(`Field '${path}': Array is too short (minimum ${issue.minimum} items)`);
        }
        break;
        
      case 'too_big':
        if (issue.type === 'string') {
          errorMessages.push(`Field '${path}': String is too long (maximum ${issue.maximum} characters)`);
        } else if (issue.type === 'number') {
          errorMessages.push(`Field '${path}': Number is too large (maximum ${issue.maximum})`);
        } else if (issue.type === 'array') {
          errorMessages.push(`Field '${path}': Array is too long (maximum ${issue.maximum} items)`);
        }
        break;
        
      case 'unrecognized_keys':
        const keys = (issue as any).keys?.join(', ') || 'unknown';
        errorMessages.push(`Unrecognized fields: ${keys}`);
        hints.push(`Remove the extra fields: ${keys}`);
        break;
        
      default:
        errorMessages.push(`Field '${path}': ${issue.message}`);
    }
  }
  
  // Generate example of correct usage
  const example = generateExampleFromSchema(schema);
  
  // Create comprehensive error message
  const errorMessage = [
    `Tool call validation failed for '${toolName}'.`,
    ``,
    `Errors:`,
    ...errorMessages.map(msg => `  - ${msg}`),
    ``,
    `Please call the tool again with the correct parameters.`
  ].join('\n');
  
  const hint = hints.length > 0
    ? hints.join('; ')
    : 'Review the tool schema and ensure all required parameters are provided with correct types';
  
  getEventSystem().info(EventCategory.LLM, `📝 [ToolRepairer] LLM re-ask prepared`);
  getEventSystem().error(EventCategory.SYSTEM, `   Error message: ${errorMessages.length} issues`);
  getEventSystem().info(EventCategory.SYSTEM, `   Hint: ${hint}`);
  
  return {
    success: false,
    strategy: 'llm-reask',
    errorMessage,
    hint,
    example
  };
}

/**
 * Coerce value to expected type
 */
function coerceType(value: any, expectedType: string): any {
  if (value === null || value === undefined) {
    return undefined;
  }
  
  switch (expectedType) {
    case 'string':
      return String(value);
      
    case 'number':
      const num = Number(value);
      return isNaN(num) ? undefined : num;
      
    case 'boolean':
      if (typeof value === 'string') {
        return value.toLowerCase() === 'true';
      }
      return Boolean(value);
      
    case 'array':
      return Array.isArray(value) ? value : undefined;
      
    case 'object':
      return typeof value === 'object' ? value : undefined;
      
    default:
      return undefined;
  }
}

/**
 * Get nested value from object by path
 */
function getNestedValue(obj: any, path: Array<string | number>): any {
  let current = obj;
  for (const key of path) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

/**
 * Set nested value in object by path
 */
function setNestedValue(obj: any, path: Array<string | number>, value: any): void {
  if (path.length === 0) return;
  
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }
  
  current[path[path.length - 1]] = value;
}

/**
 * Get schema field definition by path
 */
function getSchemaField(schema: z.ZodObject<any>, path: Array<string | number>): any {
  if (path.length === 0) return schema;
  
  let current: any = schema.shape;
  for (const key of path) {
    if (!current || typeof key !== 'string') {
      return undefined;
    }
    current = current[key];
  }
  
  return current;
}

/**
 * Check if schema field is optional (nullable)
 */
function isOptionalField(field: any): boolean {
  // Check if field is ZodNullable
  return field && field._def && field._def.typeName === 'ZodNullable';
}

/**
 * Generate example from schema
 */
function generateExampleFromSchema(schema: z.ZodObject<any>): any {
  const example: any = {};
  
  for (const [key, value] of Object.entries(schema.shape)) {
    const field = value as any;
    
    // Skip optional fields in example
    if (field._def?.typeName === 'ZodNullable') {
      continue;
    }
    
    // Generate example value based on type
    const typeName = field._def?.typeName;
    switch (typeName) {
      case 'ZodString':
        example[key] = 'example value';
        break;
      case 'ZodNumber':
        example[key] = 42;
        break;
      case 'ZodBoolean':
        example[key] = true;
        break;
      case 'ZodArray':
        example[key] = [];
        break;
      case 'ZodObject':
        example[key] = {};
        break;
      default:
        example[key] = null;
    }
  }
  
  return example;
}

/**
 * Format tool schema as human-readable bullet-point text
 * 
 * Converts a tool's JSON schema into a clear, textual format that helps
 * the LLM understand what parameters are required/optional and their types.
 * 
 * @param toolName - Name of the tool
 * @param toolSchema - The tool's schema (parameters or inputSchema field)
 * @returns Formatted string with bullet-point parameter descriptions
 */
export function formatToolSchemaAsText(toolName: string, toolSchema: any): string {
  if (!toolSchema) {
    return `Tool: ${toolName}\nNo parameters required.`;
  }

  // Handle both OpenAI format (parameters) and Vercel AI SDK format (inputSchema)
  const schema = toolSchema.parameters || toolSchema.inputSchema || toolSchema;
  
  if (!schema || typeof schema !== 'object') {
    return `Tool: ${toolName}\nNo parameters required.`;
  }

  const lines: string[] = [];
  lines.push(`Tool: ${toolName}`);
  lines.push('');

  // Extract properties and required fields
  const properties = schema.properties || {};
  const required = schema.required || [];

  if (Object.keys(properties).length === 0) {
    lines.push('No parameters required.');
  } else {
    lines.push('Parameters:');
    lines.push('');

    for (const [paramName, paramDef] of Object.entries(properties)) {
      const param = paramDef as any;
      const isRequired = required.includes(paramName);
      const type = param.type || 'any';
      const description = param.description || '';
      
      // Build parameter line
      const requiredIndicator = isRequired ? '(REQUIRED)' : '(optional)';
      lines.push(`  • ${paramName} ${requiredIndicator}`);
      lines.push(`    Type: ${type}`);
      
      if (description) {
        lines.push(`    Description: ${description}`);
      }

      // Handle enum values
      if (param.enum && Array.isArray(param.enum)) {
        lines.push(`    Allowed values: ${param.enum.join(', ')}`);
      }

      // Handle array item types
      if (type === 'array' && param.items) {
        const itemType = param.items.type || 'any';
        lines.push(`    Items type: ${itemType}`);
      }

      // Handle nested objects
      if (type === 'object' && param.properties) {
        const nestedProps = Object.keys(param.properties).join(', ');
        lines.push(`    Properties: ${nestedProps}`);
      }

      lines.push('');
    }
  }

  // Add note about valid parameters
  const validParams = Object.keys(properties);
  if (validParams.length > 0) {
    lines.push('Note: Only the parameters listed above are valid for this tool.');
    lines.push('Any additional or invalid parameters will be rejected.');
  }

  return lines.join('\n');
}

/**
 * Format all available tools as human-readable text
 * 
 * Creates a comprehensive guide showing all tools and their parameters
 * to help the LLM understand what tools are available and how to use them.
 * 
 * @param tools - Array of tool definitions
 * @returns Formatted string with all tool descriptions
 */
export function formatAllToolsAsText(tools: any[]): string {
  if (!tools || tools.length === 0) {
    return 'No tools available.';
  }

  const sections: string[] = [];
  sections.push('='.repeat(60));
  sections.push('AVAILABLE TOOLS REFERENCE');
  sections.push('='.repeat(60));
  sections.push('');

  for (const tool of tools) {
    const toolName = tool.name || tool.function?.name || 'unnamed';
    const toolDescription = tool.description || tool.function?.description || '';
    const toolSchema = tool.parameters || tool.inputSchema || tool.function?.parameters;

    sections.push('-'.repeat(40));
    sections.push(`Tool: ${toolName}`);
    if (toolDescription) {
      sections.push(`Description: ${toolDescription}`);
    }
    sections.push('');

    // Format parameters
    if (toolSchema && toolSchema.properties) {
      const properties = toolSchema.properties;
      const required = toolSchema.required || [];

      if (Object.keys(properties).length > 0) {
        sections.push('Parameters:');
        
        for (const [paramName, paramDef] of Object.entries(properties)) {
          const param = paramDef as any;
          const isRequired = required.includes(paramName);
          const type = param.type || 'any';
          const description = param.description || '';
          
          const requiredText = isRequired ? 'REQUIRED' : 'optional';
          sections.push(`  • ${paramName} (${type}, ${requiredText})`);
          
          if (description) {
            sections.push(`    ${description}`);
          }

          if (param.enum && Array.isArray(param.enum)) {
            sections.push(`    Must be one of: ${param.enum.join(', ')}`);
          }
        }
        sections.push('');
      } else {
        sections.push('No parameters required.');
        sections.push('');
      }
    } else {
      sections.push('No parameters required.');
      sections.push('');
    }
  }

  sections.push('-'.repeat(40));
  sections.push('');
  sections.push('IMPORTANT NOTES:');
  sections.push('• Only use the parameters listed for each tool');
  sections.push('• Required parameters must be provided');
  sections.push('• Optional parameters can be omitted');
  sections.push('• Invalid parameter names will cause the tool call to fail');
  sections.push('');
  sections.push('='.repeat(60));

  return sections.join('\n');
}

/**
 * Extract tool name from error message
 * 
 * Attempts to find which tool the LLM tried to call based on the error message.
 * Common patterns include:
 * - "Tool 'toolName' validation failed"
 * - "Invalid parameters for toolName"
 * - Tool names mentioned in the error
 * 
 * @param errorMessage - The error message from the failed tool call
 * @returns The extracted tool name or null if not found
 */
export function extractToolNameFromError(errorMessage: string): string | null {
  if (!errorMessage) return null;
  
  const lowerMessage = errorMessage.toLowerCase();
  
  // Pattern 1: "Tool 'toolName' ..." or "tool 'toolName' ..."
  const toolQuoteMatch = errorMessage.match(/tool\s+['"]([^'"]+)['"]/i);
  if (toolQuoteMatch) {
    const extractedName = toolQuoteMatch[1];
    // Filter out generic words like "tool" itself
    const genericWords = ['tool', 'function', 'call', 'error'];
    if (!genericWords.includes(extractedName.toLowerCase())) {
      return extractedName;
    }
  }
  
  // Pattern 2: "... for toolName" or "... in toolName" or "... toolName function"
  const forToolMatch = errorMessage.match(/(?:for|in)\s+(\w+)(?:\s|$|[.:])/i);
  if (forToolMatch) return forToolMatch[1];
  
  // Pattern 2b: "toolName function" or "toolName tool"
  const functionToolMatch = errorMessage.match(/(\w+)\s+(?:function|tool)/i);
  if (functionToolMatch) return functionToolMatch[1];
  
  // Pattern 3: Look for camelCase or snake_case tool names (common patterns)
  // Tool names often follow patterns like: searchCourses, list_certificates, getWeather
  const toolNameMatch = errorMessage.match(/\b([a-z][a-zA-Z0-9]*(?:[A-Z][a-zA-Z0-9]*)*)\b/);
  if (toolNameMatch && toolNameMatch[1].length > 2) {
    // Filter out common words that aren't tool names
    const commonWords = ['the', 'and', 'for', 'with', 'error', 'invalid', 'tool', 'call', 'parameter', 'schema', 'validation', 'failed', 'missing', 'required'];
    if (!commonWords.includes(toolNameMatch[1].toLowerCase())) {
      return toolNameMatch[1];
    }
  }
  
  return null;
}

/**
 * Find matching tools using fuzzy search
 * 
 * Searches for tools that match the given tool name with various strategies:
 * 1. Exact match
 * 2. Case-insensitive match
 * 3. Partial match (tool name contains search or vice versa)
 * 4. Normalized match (removing special characters)
 * 
 * @param toolName - The tool name to search for
 * @param tools - Array of available tools
 * @returns Array of matching tools (empty if no matches)
 */
export function findMatchingTools(toolName: string, tools: any[]): any[] {
  if (!toolName || !tools || tools.length === 0) return [];
  
  const searchName = toolName.toLowerCase();
  const matches: any[] = [];
  
  for (const tool of tools) {
    const candidateName = (tool.name || tool.function?.name || '').toLowerCase();
    if (!candidateName) continue;
    
    // Strategy 1: Exact match
    if (candidateName === searchName) {
      matches.push(tool);
      continue;
    }
    
    // Strategy 2: Case-insensitive exact match (already handled by toLowerCase)
    
    // Strategy 3: Partial match - tool name contains search term
    if (candidateName.includes(searchName)) {
      matches.push(tool);
      continue;
    }
    
    // Strategy 4: Partial match - search term contains tool name
    if (searchName.includes(candidateName)) {
      matches.push(tool);
      continue;
    }
    
    // Strategy 5: Normalized match (remove special characters)
    const normalizedCandidate = candidateName.replace(/[_-]/g, '');
    const normalizedSearch = searchName.replace(/[_-]/g, '');
    if (normalizedCandidate === normalizedSearch || 
        normalizedCandidate.includes(normalizedSearch) ||
        normalizedSearch.includes(normalizedCandidate)) {
      matches.push(tool);
      continue;
    }
    
    // Strategy 6: Word boundary matching
    // Split by common separators and check if any words match
    const candidateWords = candidateName.split(/[_\-]+/);
    const searchWords = searchName.split(/[_\-]+/);
    const hasMatchingWord = candidateWords.some((cw: string) =>
      searchWords.some((sw: string) => cw === sw || cw.includes(sw) || sw.includes(cw))
    );
    if (hasMatchingWord) {
      matches.push(tool);
      continue;
    }
  }
  
  return matches;
}

/**
 * Format relevant tools based on error message
 * 
 * Extracts the tool name from the error and formats only the matching tool(s)
 * to help the LLM understand what went wrong without overwhelming it with
 * all available tools.
 * 
 * @param errorMessage - The error message from the failed tool call
 * @param tools - Array of available tools
 * @returns Formatted string with relevant tool information
 */
export function formatRelevantToolsFromError(errorMessage: string, tools: any[]): string {
  if (!tools || tools.length === 0) {
    return 'No tools available.';
  }
  
  // Try to extract tool name from error
  const toolName = extractToolNameFromError(errorMessage);
  
  if (!toolName) {
    // Could not determine which tool failed - show first few tools as examples
    const exampleTools = tools.slice(0, 3);
    const examples = formatAllToolsAsText(exampleTools);
    return `Could not determine which tool failed. Here are some example tools:\n\n${examples}\n\nNote: Only these example tools are shown. There are ${tools.length} total tools available.`;
  }
  
  // Find matching tools
  const matchingTools = findMatchingTools(toolName, tools);
  
  if (matchingTools.length === 0) {
    // No matches found - the tool name in the error doesn't match any available tool
    // This is a critical error - the LLM tried to call a non-existent tool
    const availableToolNames = tools.map(t => t.name || t.function?.name || 'unnamed').join(', ');
    return `ERROR: The tool "${toolName}" mentioned in the error does not exist in the available tools.\n\nAvailable tools are: ${availableToolNames}\n\nPlease use only the tools listed above.`;
  }
  
  if (matchingTools.length === 1) {
    // Single match - format just that tool
    const tool = matchingTools[0];
    const toolName = tool.name || tool.function?.name || 'unnamed';
    return formatToolSchemaAsText(toolName, tool.parameters || tool.inputSchema || tool.function?.parameters);
  }
  
  // Multiple matches - show all of them
  return formatAllToolsAsText(matchingTools);
}

/**
 * Extract tool name from conversation history
 * 
 * When the error message doesn't contain the tool name, we can look at the
 * conversation history to find the most recent tool call that failed.
 * 
 * @param conversationHistory - Array of conversation items
 * @returns The tool name from the last function_call or null if not found
 */
export function extractToolNameFromHistory(conversationHistory: any[]): string | null {
  if (!conversationHistory || conversationHistory.length === 0) return null;
  
  // Search backwards through history to find the most recent function_call
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const item = conversationHistory[i];
    
    // Look for function_call items (tool calls)
    if (item.type === 'function_call' && item.name) {
      return item.name;
    }
    
    // Also check for tool results that might have the tool name
    if (item.type === 'function_call_output' && item.name) {
      return item.name;
    }
  }
  
  return null;
}

/**
 * Format relevant tools for retry error message
 * 
 * Combines error message extraction with conversation history fallback
 * to find and format the tool(s) that caused the error.
 * 
 * @param errorMessage - The error message from the failed tool call
 * @param tools - Array of available tools
 * @param conversationHistory - Optional conversation history for fallback lookup
 * @returns Formatted string with relevant tool information
 */
export function formatToolsForRetryError(
  errorMessage: string, 
  tools: any[], 
  conversationHistory?: any[]
): string {
  if (!tools || tools.length === 0) {
    return 'No tools available.';
  }
  
  // Get available tool names for validation
  const availableToolNames = tools.map(t => (t.name || t.function?.name || '').toLowerCase()).filter(n => n);
  
  // Try to extract tool name from error message first
  let toolName = extractToolNameFromError(errorMessage);
  
  // Validate that the extracted name is actually a valid tool
  if (toolName && !availableToolNames.includes(toolName.toLowerCase())) {
    // Extracted name is not a valid tool - try conversation history instead
    toolName = null;
  }
  
  // If not found in error or invalid, try conversation history
  if (!toolName && conversationHistory && conversationHistory.length > 0) {
    const historyName = extractToolNameFromHistory(conversationHistory);
    // Only use history name if it's a valid tool
    if (historyName && availableToolNames.includes(historyName.toLowerCase())) {
      toolName = historyName;
    }
  }
  
  if (!toolName) {
    // Could not determine which tool failed - show first few tools as examples
    const exampleTools = tools.slice(0, 3);
    const examples = formatAllToolsAsText(exampleTools);
    return `Could not determine which tool failed. Here are some example tools:\n\n${examples}\n\nNote: Only these example tools are shown. There are ${tools.length} total tools available.`;
  }
  
  // Find matching tools
  const matchingTools = findMatchingTools(toolName, tools);
  
  if (matchingTools.length === 0) {
    // No matches found - the tool name in the error doesn't match any available tool
    // This is a critical error - the LLM tried to call a non-existent tool
    const availableToolNames = tools.map(t => t.name || t.function?.name || 'unnamed').join(', ');
    return `ERROR: The tool "${toolName}" mentioned in the error does not exist in the available tools.\n\nAvailable tools are: ${availableToolNames}\n\nPlease use only the tools listed above.`;
  }
  
  if (matchingTools.length === 1) {
    // Single match - format just that tool
    const tool = matchingTools[0];
    const matchedToolName = tool.name || tool.function?.name || 'unnamed';
    return formatToolSchemaAsText(matchedToolName, tool.parameters || tool.inputSchema || tool.function?.parameters);
  }
  
  // Multiple matches - show all of them
  return formatAllToolsAsText(matchingTools);
}

