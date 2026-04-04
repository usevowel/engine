function exampleValueForSchema(schema: any, fieldName: string): string {
  if (!schema || typeof schema !== 'object') {
    return defaultExampleForField(fieldName);
  }

  if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
    const first = schema.enum[0];
    return typeof first === 'string' ? `"${first}"` : String(first);
  }

  switch (schema.type) {
    case 'string':
      return defaultExampleForField(fieldName);
    case 'number':
    case 'integer':
      return '1';
    case 'boolean':
      return 'true';
    case 'array':
      return '["value"]';
    default:
      return defaultExampleForField(fieldName);
  }
}

function defaultExampleForField(fieldName: string): string {
  const lowered = fieldName.toLowerCase();
  if (lowered.includes('location') || lowered.includes('city')) return '"New York"';
  if (lowered.includes('date')) return '"2026-04-04"';
  if (lowered.includes('hotelid') || lowered.includes('id')) return '"item_001"';
  if (lowered.includes('email')) return '"user@example.com"';
  if (lowered.includes('name')) return '"Taylor"';
  return '"value"';
}

function buildToolCatalog(sessionTools: any[]): string {
  const sections: string[] = [];

  for (const tool of sessionTools) {
    const properties = tool.parameters?.properties || {};
    const required = tool.parameters?.required || [];
    const argsList = Object.keys(properties)
      .map((name) => `${name}${required.includes(name) ? '' : '?'}`)
      .join(', ');

    const exampleArgs = Object.entries<any>(properties)
      .map(([name, schema]) => `${name}=${exampleValueForSchema(schema, name)}`)
      .join(', ');

    sections.push(`TOOL: ${tool.name}`);
    sections.push(`PURPOSE: ${tool.description || `Use ${tool.name} when it is relevant.`}`);
    sections.push(`ARGUMENTS: ${argsList || '(none)'}`);

    if (Object.keys(properties).length > 0) {
      sections.push('FIELDS:');
      for (const [name, schema] of Object.entries<any>(properties)) {
        const requiredLabel = required.includes(name) ? 'required' : 'optional';
        sections.push(`- ${name} (${schema.type || 'any'}, ${requiredLabel}): ${schema.description || ''}`.trim());
      }
    }

    if (exampleArgs) {
      sections.push(`EXAMPLE TOOL CALL: <|tool_call_start|>[${tool.name}(${exampleArgs})]<|tool_call_end|>`);
    }

    sections.push('');
  }

  return sections.join('\n').trim();
}

export function buildLfmSystemPrompt(userInstructions: string, sessionTools: any[]): string {
  const normalizedInstructions = userInstructions?.trim() || 'You are a helpful assistant.';
  const toolCatalog = sessionTools.length > 0
    ? buildToolCatalog(sessionTools)
    : 'NO TOOLS AVAILABLE';

  return [
    'You are a voice assistant that MUST use tools to get real information.',
    '',
    'CRITICAL RULES:',
    '1. If a relevant tool exists and the user already provided the required arguments, your FIRST output MUST be the tool call.',
    '2. Do NOT explain what you are about to do before the tool call.',
    '3. Do NOT say "let me check" or "I am checking" before the tool call.',
    '4. Do NOT ask for clarification if the required arguments are already present.',
    '5. After tool results are returned, answer the user using the actual tool results.',
    '6. Never invent tool results.',
    '',
    'TOOL CALL FORMAT (EXACT):',
    '<|tool_call_start|>[ACTUAL_TOOL_NAME_FROM_THE_LIST_BELOW(arg1="value", arg2=value)]<|tool_call_end|>',
    '',
    'BAD EXAMPLE:',
    'I am checking the weather for New York now.',
    '',
    'GOOD EXAMPLE:',
    '<|tool_call_start|>[get_weather(location="New York")]<|tool_call_end|>',
    '',
    'WORKFLOW:',
    '1. Read the user request.',
    '2. If a tool is needed, emit the tool call immediately in the exact format above.',
    '3. Wait for the tool result.',
    '4. Respond to the user with the result.',
    '',
    'USER INSTRUCTIONS:',
    normalizedInstructions,
    '',
    'AVAILABLE TOOLS:',
    toolCatalog,
  ].join('\n');
}
