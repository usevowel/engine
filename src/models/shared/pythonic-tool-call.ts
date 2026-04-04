export interface PythonicToolCall {
  toolName: string;
  args: Record<string, unknown>;
  rawCall: string;
  repairsApplied: string[];
}

const TOOL_START_TOKEN = '<|tool_call_start|>';
const TOOL_END_TOKEN = '<|tool_call_end|>';
const BLOCK_CHAR = '█';

export function serializePythonicToolCall(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const renderedArgs = Object.entries(args)
    .map(([key, value]) => `${key}=${serializePythonicValue(value)}`)
    .join(', ');

  return `${TOOL_START_TOKEN}[${toolName}(${renderedArgs})]${TOOL_END_TOKEN}`;
}

export function formatInlineToolResult(
  toolName: string,
  result: unknown,
): string {
  const renderedResult = typeof result === 'string' ? result : JSON.stringify(result);
  return `Tool result for ${toolName}: ${renderedResult}`;
}

export function repairPythonicToolCall(rawText: string): { repaired: string; repairsApplied: string[] } {
  let repaired = rawText.replaceAll(BLOCK_CHAR, '').trim();
  const repairsApplied: string[] = [];

  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    repaired += ']'.repeat(openBrackets - closeBrackets);
    repairsApplied.push(`Added ${openBrackets - closeBrackets} closing bracket(s)`);
  }

  const openParens = (repaired.match(/\(/g) || []).length;
  const closeParens = (repaired.match(/\)/g) || []).length;
  if (openParens > closeParens) {
    repaired += ')'.repeat(openParens - closeParens);
    repairsApplied.push(`Added ${openParens - closeParens} closing parenthesis(es)`);
  }

  if (!repaired.includes(TOOL_END_TOKEN) && repaired.includes(TOOL_START_TOKEN)) {
    repaired += TOOL_END_TOKEN;
    repairsApplied.push('Added missing <|tool_call_end|> token');
  }

  return { repaired, repairsApplied };
}

export function extractPythonicToolCall(rawText: string): PythonicToolCall | null {
  const toolStartIndex = rawText.indexOf(TOOL_START_TOKEN);
  if (toolStartIndex === -1) {
    return null;
  }

  const afterStart = rawText.slice(toolStartIndex + TOOL_START_TOKEN.length);
  const firstBracketIndex = afterStart.indexOf('[');
  if (firstBracketIndex === -1) {
    return null;
  }

  const bracketStart = toolStartIndex + TOOL_START_TOKEN.length + firstBracketIndex;
  const closingIndex = findMatchingToolCallEnd(rawText, bracketStart);
  if (closingIndex === null) {
    return null;
  }

  const rawCall = rawText.slice(toolStartIndex, closingIndex.endIndex);
  const inner = rawText.slice(bracketStart + 1, closingIndex.closeBracketIndex).trim();
  const openParenIndex = inner.indexOf('(');
  const closeParenIndex = inner.lastIndexOf(')');

  if (openParenIndex === -1 || closeParenIndex === -1 || closeParenIndex < openParenIndex) {
    return null;
  }

  const toolName = inner.slice(0, openParenIndex).trim();
  if (!toolName) {
    return null;
  }

  const argsText = inner.slice(openParenIndex + 1, closeParenIndex).trim();
  const args = parsePythonicArguments(argsText);

  return {
    toolName,
    args,
    rawCall,
    repairsApplied: [],
  };
}

function findMatchingToolCallEnd(rawText: string, bracketStart: number): { closeBracketIndex: number; endIndex: number } | null {
  let bracketDepth = 0;
  let parenDepth = 0;
  let inQuote = false;
  let quoteChar = '';
  let escaping = false;

  for (let index = bracketStart; index < rawText.length; index += 1) {
    const char = rawText[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (inQuote) {
      if (char === '\\') {
        escaping = true;
        continue;
      }

      if (char === quoteChar) {
        inQuote = false;
        quoteChar = '';
      }

      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
      continue;
    }

    if (char === '[') {
      bracketDepth += 1;
      continue;
    }

    if (char === ']') {
      bracketDepth -= 1;
      if (bracketDepth === 0 && parenDepth === 0) {
        const afterClose = rawText.slice(index + 1);
        const endTokenIndex = afterClose.indexOf(TOOL_END_TOKEN);
        if (endTokenIndex !== -1) {
          return {
            closeBracketIndex: index,
            endIndex: index + 1 + endTokenIndex + TOOL_END_TOKEN.length,
          };
        }

        return {
          closeBracketIndex: index,
          endIndex: index + 1,
        };
      }
      continue;
    }

    if (char === '(') {
      parenDepth += 1;
      continue;
    }

    if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    }
  }

  return null;
}

function parsePythonicArguments(argsText: string): Record<string, unknown> {
  if (!argsText) {
    return {};
  }

  const args: Record<string, unknown> = {};
  for (const pair of splitTopLevel(argsText)) {
    const trimmedPair = pair.trim();
    if (!trimmedPair) {
      continue;
    }

    const separatorIndex = findAssignmentSeparator(trimmedPair);
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedPair.slice(0, separatorIndex).trim();
    const valueText = trimmedPair.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    args[key] = parsePythonicValue(valueText);
  }

  return args;
}

function findAssignmentSeparator(pair: string): number {
  let inQuote = false;
  let quoteChar = '';
  let escaping = false;
  let depth = 0;

  for (let index = 0; index < pair.length; index += 1) {
    const char = pair[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (inQuote) {
      if (char === '\\') {
        escaping = true;
        continue;
      }

      if (char === quoteChar) {
        inQuote = false;
        quoteChar = '';
      }

      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
      continue;
    }

    if (char === '[' || char === '{' || char === '(') {
      depth += 1;
      continue;
    }

    if (char === ']' || char === '}' || char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (char === '=' && depth === 0) {
      return index;
    }
  }

  return -1;
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  let escaping = false;
  let depth = 0;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (inQuote) {
      current += char;
      if (char === '\\') {
        escaping = true;
      } else if (char === quoteChar) {
        inQuote = false;
        quoteChar = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
      current += char;
      continue;
    }

    if (char === '[' || char === '{' || char === '(') {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ']' || char === '}' || char === ')') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function parsePythonicValue(valueText: string): unknown {
  const trimmed = valueText.trim();
  if (!trimmed) {
    return '';
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return unescapeQuotedValue(trimmed.slice(1, -1));
  }

  if (trimmed === 'true' || trimmed === 'True') return true;
  if (trimmed === 'false' || trimmed === 'False') return false;
  if (trimmed === 'null' || trimmed === 'None') return null;

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return splitTopLevel(trimmed.slice(1, -1)).map((item) => parsePythonicValue(item));
  }

  return trimmed;
}

function unescapeQuotedValue(value: string): string {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function serializePythonicValue(value: unknown): string {
  if (typeof value === 'string') {
    return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (value === null || value === undefined) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => serializePythonicValue(item)).join(', ')}]`;
  }

  return `"${JSON.stringify(value).replaceAll('"', '\\"')}"`;
}
