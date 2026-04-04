/**
 * InlineToolParsingAgent
 *
 * Custom streaming agent for model families that emit tool calls inline as raw
 * text rather than structured tool-call parts.
 */

import { generateEventId } from '../../lib/protocol';
import { convertJsonSchemaToZod } from '../../lib/json-schema-to-zod';
import { attemptRepair } from '../../lib/tool-repairer';
import { serverToolRegistry } from '../../lib/server-tool-registry';
import { resolveModelDirective } from '../../models';
import { buildLfmSystemPrompt } from '../../models/lfm/prompt';
import { coreMessagesToPlainChat, type PlainChatMessage } from '../../models/lfm/messages';
import { LfmInlineToolParser } from '../../models/lfm/inline-tool-parser';
import { formatInlineToolResult, serializePythonicToolCall } from '../../models/shared/pythonic-tool-call';
import {
  ILLMAgent,
  AgentConfig,
  AgentMetadata,
  AgentStreamOptions,
  AgentStreamPart,
} from './ILLMAgent';
import { formatApiKeyPreview } from './utils';
import { getEventSystem, EventCategory } from '../../events';

interface ToolDefinition {
  name: string;
  description?: string;
  parameters?: any;
}

interface CompletionChunk {
  delta?: string;
  finishReason?: string | null;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export class InlineToolParsingAgent implements ILLMAgent {
  private readonly config: AgentConfig & { baseUrl?: string };

  constructor(config: AgentConfig) {
    this.config = config as AgentConfig & { baseUrl?: string };
  }

  async stream(options: AgentStreamOptions): Promise<AsyncIterable<AgentStreamPart>> {
    const directive = resolveModelDirective(this.config);
    if (directive.toolCallStrategy !== 'inline-parser') {
      throw new Error(`InlineToolParsingAgent cannot handle ${this.config.model} with strategy ${directive.toolCallStrategy}`);
    }

    const systemPrompt = this.resolveSystemPrompt(options);
    const fullSystemPrompt = buildLfmSystemPrompt(systemPrompt, options.sessionTools || []);
    const baseHistory = this.buildPlainHistory(options, fullSystemPrompt);

    return this.streamWithInlineParsing(baseHistory, options, this.config.maxSteps || 5);
  }

  getMetadata(): AgentMetadata {
    return {
      type: 'inline-parser',
      provider: this.config.provider,
      model: this.config.model,
      maxSteps: this.config.maxSteps || 5,
      maxContextMessages: this.config.maxContextMessages || 15,
      contextStrategy: 'message-count',
    };
  }

  async cleanup(): Promise<void> {
    getEventSystem().info(EventCategory.LLM, '🧹 [InlineToolParsingAgent] Cleanup complete');
  }

  private async *streamWithInlineParsing(
    baseHistory: PlainChatMessage[],
    options: AgentStreamOptions,
    maxSteps: number,
  ): AsyncIterable<AgentStreamPart> {
    const sessionTools = options.sessionTools || [];
    const workingHistory = [...baseHistory];
    let toolExecutedInStream = this.hasPriorToolResult(options);

    for (let step = 0; step < maxSteps; step += 1) {
      const parser = new LfmInlineToolParser();
      const controller = new AbortController();
      let fullAssistantText = '';
      let bufferedAssistantText = '';
      let retryInstruction: string | null = null;
      let pendingToolCall: {
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
        rawCall: string;
      } | null = null;

      getEventSystem().info(EventCategory.LLM, `🧭 [InlineToolParsingAgent] Step ${step + 1}/${maxSteps} for ${this.config.model}`);

      for await (const chunk of this.streamChatCompletion(workingHistory, options, controller.signal)) {
        if (chunk.delta) {
          for (const update of parser.pushDelta(chunk.delta)) {
            if (update.textDelta) {
              fullAssistantText += update.textDelta;
              if (!toolExecutedInStream && sessionTools.length > 0) {
                bufferedAssistantText += update.textDelta;
              } else {
                yield { type: 'text', delta: update.textDelta };
              }
            }

            if (update.toolCall) {
              let validatedArgs: Record<string, unknown>;
              try {
                validatedArgs = this.validateToolCall(update.toolCall.toolName, update.toolCall.args, sessionTools);
              } catch (error) {
                retryInstruction = this.buildRetryInstruction(error, sessionTools);
                controller.abort();
                break;
              }

              pendingToolCall = {
                toolCallId: `itc_${generateEventId().slice(0, 24)}`,
                toolName: update.toolCall.toolName,
                args: validatedArgs,
                rawCall: serializePythonicToolCall(update.toolCall.toolName, validatedArgs),
              };
              controller.abort();
              break;
            }
          }
        }

        if (pendingToolCall) {
          break;
        }

        if (chunk.usage) {
          yield {
            type: 'usage',
            promptTokens: chunk.usage.promptTokens || 0,
            completionTokens: chunk.usage.completionTokens || 0,
            totalTokens: chunk.usage.totalTokens || 0,
          };
        }
      }

      if (!pendingToolCall) {
        for (const update of parser.flush()) {
          if (update.textDelta) {
            fullAssistantText += update.textDelta;
            if (!toolExecutedInStream && sessionTools.length > 0) {
              bufferedAssistantText += update.textDelta;
            } else {
              yield { type: 'text', delta: update.textDelta };
            }
          }

          if (update.toolCall) {
            let validatedArgs: Record<string, unknown>;
            try {
              validatedArgs = this.validateToolCall(update.toolCall.toolName, update.toolCall.args, sessionTools);
            } catch (error) {
              retryInstruction = this.buildRetryInstruction(error, sessionTools);
              break;
            }

            pendingToolCall = {
              toolCallId: `itc_${generateEventId().slice(0, 24)}`,
              toolName: update.toolCall.toolName,
              args: validatedArgs,
              rawCall: serializePythonicToolCall(update.toolCall.toolName, validatedArgs),
            };
            break;
          }
        }
      }

      if (retryInstruction) {
        workingHistory.push({ role: 'system', content: retryInstruction });
        continue;
      }

      if (!pendingToolCall && !toolExecutedInStream && sessionTools.length > 0 && step < maxSteps - 1) {
        workingHistory.push({
          role: 'system',
          content: this.buildMissingToolRetryInstruction(sessionTools, bufferedAssistantText || fullAssistantText),
        });
        continue;
      }

      if (!pendingToolCall) {
        if (!toolExecutedInStream && bufferedAssistantText) {
          yield { type: 'text', delta: bufferedAssistantText };
        }
        return;
      }

      if (fullAssistantText.trim()) {
        workingHistory.push({ role: 'assistant', content: fullAssistantText.trim() });
      }

      workingHistory.push({ role: 'assistant', content: pendingToolCall.rawCall });

      yield {
        type: 'tool_call',
        toolCallId: pendingToolCall.toolCallId,
        toolName: pendingToolCall.toolName,
        args: pendingToolCall.args,
      };

      const serverTools = options.serverToolContext
        ? serverToolRegistry.getServerToolsForAgent(options.serverToolContext)
        : {};
      const serverTool = serverTools[pendingToolCall.toolName];

      if (!serverTool) {
        return;
      }

      const result = await this.executeServerTool(serverTool, pendingToolCall.toolName, pendingToolCall.args);
      workingHistory.push({ role: 'user', content: formatInlineToolResult(pendingToolCall.toolName, result) });

      yield {
        type: 'tool_result',
        toolCallId: pendingToolCall.toolCallId,
        result,
      };

      toolExecutedInStream = true;
    }

    throw new Error(`Inline tool parsing exceeded max steps (${maxSteps}) for model ${this.config.model}`);
  }

  private resolveSystemPrompt(options: AgentStreamOptions): string {
    const override = options.systemPrompt;
    if (override) {
      return typeof override === 'function' ? override(options.systemPromptContext) : override;
    }

    return typeof this.config.systemPrompt === 'function'
      ? this.config.systemPrompt(options.systemPromptContext)
      : this.config.systemPrompt;
  }

  private buildPlainHistory(options: AgentStreamOptions, systemPrompt: string): PlainChatMessage[] {
    if (options.prompt && options.messages) {
      throw new Error('Cannot provide both prompt and messages');
    }

    if (!options.prompt && !options.messages) {
      throw new Error('Either prompt or messages must be provided');
    }

    const history: PlainChatMessage[] = [{ role: 'system', content: systemPrompt }];
    if (options.prompt) {
      history.push({ role: 'user', content: options.prompt });
      return history;
    }

    return [...history, ...coreMessagesToPlainChat(options.messages || [])];
  }

  private hasPriorToolResult(options: AgentStreamOptions): boolean {
    const messages = options.messages || [];

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message: any = messages[index];

      if (message.role === 'system') {
        continue;
      }

      if (message.role === 'tool') {
        return true;
      }

      if (Array.isArray(message.content) && message.content.some((part: any) => part?.type === 'tool-result')) {
        return true;
      }

      return false;
    }

    return false;
  }

  private validateToolCall(
    toolName: string,
    rawArgs: Record<string, unknown>,
    sessionTools: ToolDefinition[],
  ): Record<string, unknown> {
    const toolDefinition = sessionTools.find((tool) => tool.name === toolName);
    if (!toolDefinition) {
      throw new Error(`Tool call validation failed for '${toolName}'. Tool is not available in this session.`);
    }

    const schema = convertJsonSchemaToZod(toolDefinition.parameters || { type: 'object', properties: {} });
    const parsed = schema.safeParse(rawArgs);
    if (parsed.success) {
      return parsed.data;
    }

    const repaired = attemptRepair(rawArgs, parsed.error, schema, toolName);
    if (repaired.success && repaired.repairedInput) {
      return repaired.repairedInput;
    }

    throw new Error(repaired.errorMessage || parsed.error.message);
  }

  private async executeServerTool(
    serverTool: any,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (typeof serverTool?.execute !== 'function') {
      throw new Error(`Server tool '${toolName}' does not expose an execute function.`);
    }

    getEventSystem().info(EventCategory.SESSION, `🖥️ [InlineToolParsingAgent] Executing server tool ${toolName}`);
    return await serverTool.execute(args);
  }

  private buildRetryInstruction(error: unknown, sessionTools: ToolDefinition[]): string {
    const availableTools = sessionTools.map((tool) => tool.name).join(', ');
    const message = error instanceof Error ? error.message : String(error);

    return [
      'Your previous tool call was invalid.',
      `Error: ${message}`,
      `Use one of these exact tool names only: ${availableTools}`,
      'Emit only the corrected tool call in the exact format below.',
      '<|tool_call_start|>[ACTUAL_TOOL_NAME_FROM_THE_LIST_BELOW(arg1="value", arg2=value)]<|tool_call_end|>',
      'Do not add explanation before the corrected tool call.',
    ].join('\n');
  }

  private buildMissingToolRetryInstruction(sessionTools: ToolDefinition[], previousText: string): string {
    const availableTools = sessionTools.map((tool) => tool.name).join(', ');

    return [
      'Your previous response was invalid because you answered with text instead of calling a tool.',
      `Previous response: ${previousText || '(empty)'}`,
      `You must call one of these exact tools first: ${availableTools}`,
      'Do not answer with prose before the tool call.',
      'Emit only the tool call in this exact format:',
      '<|tool_call_start|>[ACTUAL_TOOL_NAME_FROM_THE_LIST_BELOW(arg1="value", arg2=value)]<|tool_call_end|>',
    ].join('\n');
  }

  private async *streamChatCompletion(
    history: PlainChatMessage[],
    options: AgentStreamOptions,
    signal: AbortSignal,
  ): AsyncIterable<CompletionChunk> {
    if (this.config.provider !== 'openai-compatible') {
      throw new Error(`InlineToolParsingAgent requires provider=openai-compatible, received ${this.config.provider}`);
    }

    const baseUrl = this.config.baseUrl || process.env.OPENAI_COMPATIBLE_BASE_URL || 'http://127.0.0.1:8067/v1';
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: history,
      stream: true,
      stream_options: { include_usage: true },
    };

    const openAITools = this.toOpenAITools(options.sessionTools || []);
    if (openAITools.length > 0) {
      body.tools = openAITools;
      body.tool_choice = 'auto';
    }

    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.frequencyPenalty !== undefined) body.frequency_penalty = options.frequencyPenalty;
    if (options.presencePenalty !== undefined) body.presence_penalty = options.presencePenalty;

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey || 'EMPTY'}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const message = await response.text();
      const keyPreview = formatApiKeyPreview(this.config.apiKey);
      throw new Error(
        `OpenAI-compatible streaming request failed (${response.status}) for ${this.config.model} using ${keyPreview}: ${message}`,
      );
    }

    if (!response.body) {
      throw new Error('OpenAI-compatible streaming response did not include a body.');
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          for (const line of event.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) {
              continue;
            }

            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') {
              continue;
            }

            const parsed = JSON.parse(payload);
            const choice = parsed.choices?.[0];

            if (choice?.delta?.content) {
              yield { delta: choice.delta.content };
            }

            if (parsed.usage) {
              yield {
                usage: {
                  promptTokens: parsed.usage.prompt_tokens,
                  completionTokens: parsed.usage.completion_tokens,
                  totalTokens: parsed.usage.total_tokens,
                },
              };
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return;
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private toOpenAITools(sessionTools: ToolDefinition[]): Array<Record<string, unknown>> {
    return sessionTools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters || { type: 'object', properties: {} },
      },
    }));
  }
}
