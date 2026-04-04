import type { CoreMessage } from 'ai';
import { formatInlineToolResult, serializePythonicToolCall } from '../shared/pythonic-tool-call';

export interface PlainChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function coreMessagesToPlainChat(messages: CoreMessage[]): PlainChatMessage[] {
  const plainMessages: PlainChatMessage[] = [];

  for (const message of messages) {
    if (typeof message.content === 'string') {
      plainMessages.push({
        role: mapRole(message.role),
        content: message.content,
      });
      continue;
    }

    if (!Array.isArray(message.content)) {
      continue;
    }

    if (message.role === 'assistant') {
      const textParts = message.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text || '')
        .join('');

      if (textParts) {
        plainMessages.push({ role: 'assistant', content: textParts });
      }

      for (const part of message.content.filter((entry: any) => entry.type === 'tool-call') as any[]) {
        plainMessages.push({
          role: 'assistant',
          content: serializePythonicToolCall(part.toolName, part.input || {}),
        });
      }
      continue;
    }

    if (message.role === 'tool') {
      for (const part of message.content.filter((entry: any) => entry.type === 'tool-result') as any[]) {
        plainMessages.push({
          role: 'user',
          content: formatInlineToolResult(part.toolName, unwrapToolOutput(part.output)),
        });
      }
      continue;
    }

    const combinedText = message.content
      .map((part: any) => {
        if (part.type === 'text') return part.text || '';
        if (typeof part === 'string') return part;
        return '';
      })
      .join('');

    if (combinedText) {
      plainMessages.push({
        role: mapRole(message.role),
        content: combinedText,
      });
    }
  }

  return plainMessages;
}

function unwrapToolOutput(output: any): unknown {
  if (!output || typeof output !== 'object') {
    return output;
  }

  if ('value' in output) {
    return output.value;
  }

  return output;
}

function mapRole(role: CoreMessage['role']): 'system' | 'user' | 'assistant' {
  if (role === 'system' || role === 'assistant') {
    return role;
  }

  return 'user';
}
