/**
 * Test Harness
 * 
 * Main entry point for running end-to-end voice agent tests.
 * 
 * @module tester
 */

import { EngineConnection, ConnectionConfig, ToolCall } from './connection/EngineConnection.js';
import { TestDriver, TestDriverConfig } from './driver/TestDriver.js';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export interface TestScenario {
  name: string;
  driver: TestDriverConfig;
  connection: Omit<ConnectionConfig, 'apiKey'>;
  expectedToolCalls?: Array<{
    name: string;
    required: boolean;
    validate?: (args: Record<string, unknown>) => boolean;
    mockResult?: unknown;
  }>;
  timeout?: number;
}

export interface TestResult {
  passed: boolean;
  name: string;
  duration: number;
  turns: number;
  conversation: Array<{
    role: 'user' | 'agent';
    content: string;
  }>;
  toolCalls: ToolCall[];
  evaluation: string;
  error?: string;
  timedOut?: boolean;
}

interface LogEntry {
  timestamp: string;
  type: 'info' | 'user' | 'agent' | 'tool' | 'error' | 'debug';
  message: string;
  data?: unknown;
}

export class TestHarness {
  private apiKey: string;
  private logsDir: string;
  private logEntries: LogEntry[] = [];
  private currentTestName: string = '';

  constructor(apiKey: string, logsDir: string = './logs') {
    this.apiKey = apiKey;
    this.logsDir = logsDir;
  }

  private async ensureLogsDir(): Promise<void> {
    if (!existsSync(this.logsDir)) {
      await mkdir(this.logsDir, { recursive: true });
    }
  }

  private log(type: LogEntry['type'], message: string, data?: unknown): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      type,
      message,
      data,
    };
    this.logEntries.push(entry);

    const emoji = {
      info: '📋',
      user: '👤',
      agent: '🤖',
      tool: '🔧',
      error: '❌',
      debug: '🔍',
    }[type];
    console.log(`   ${emoji} ${message}`);
  }

  private async writeMarkdownLog(result: TestResult): Promise<string> {
    await this.ensureLogsDir();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${result.name.replace(/\s+/g, '_').toLowerCase()}_${timestamp}.md`;
    const filepath = join(this.logsDir, filename);

    let markdown = `# Test Log: ${result.name}\n\n`;
    markdown += `**Status:** ${result.passed ? '✅ PASSED' : '❌ FAILED'}\n\n`;
    markdown += `**Duration:** ${result.duration}ms\n\n`;
    markdown += `**Turns:** ${result.turns}\n\n`;
    markdown += `**Tool Calls:** ${result.toolCalls.length}\n\n`;
    
    if (result.timedOut) {
      markdown += `**⚠️ TIMED OUT**\n\n`;
    }
    
    if (result.error) {
      markdown += `**Error:** ${result.error}\n\n`;
    }

    markdown += `**Evaluation:** ${result.evaluation}\n\n`;

    markdown += `## Event Log\n\n`;
    markdown += `| Time | Type | Message |\n`;
    markdown += `|------|------|---------|\n`;
    
    for (const entry of this.logEntries) {
      const time = entry.timestamp.split('T')[1].slice(0, 8);
      const type = entry.type.toUpperCase();
      const msg = entry.message.replace(/\|/g, '\\|');
      markdown += `| ${time} | ${type} | ${msg} |\n`;
    }

    markdown += `\n## Conversation\n\n`;
    for (const msg of result.conversation) {
      markdown += `### ${msg.role.toUpperCase()}\n\n`;
      markdown += `${msg.content}\n\n`;
    }

    if (result.toolCalls.length > 0) {
      markdown += `## Tool Calls\n\n`;
      for (const tool of result.toolCalls) {
        markdown += `### ${tool.name}\n\n`;
        markdown += `- **Call ID:** ${tool.call_id}\n`;
        markdown += `- **Arguments:** \`\`\`json\n${JSON.stringify(tool.arguments, null, 2)}\n\`\`\`\n\n`;
      }
    }

    await writeFile(filepath, markdown, 'utf-8');
    return filepath;
  }

  async runScenario(scenario: TestScenario): Promise<TestResult> {
    const startTime = Date.now();
    const connection = new EngineConnection();
    const driver = new TestDriver(scenario.driver);
    
    const conversation: Array<{ role: 'user' | 'agent'; content: string }> = [];
    const toolCalls: ToolCall[] = [];
    let evaluation = '';
    let timedOut = false;

    this.logEntries = [];
    this.currentTestName = scenario.name;

    let currentResponseText = '';
    let responseComplete = false;
    let pendingToolCall: ToolCall | null = null;

    try {
      this.log('info', `Running test: ${scenario.name}`);
      await connection.connect({
        ...scenario.connection,
        apiKey: this.apiKey,
      });
      this.log('info', 'Connected to engine');

      const unsubscribeText = connection.onResponseText((delta) => {
        currentResponseText += delta;
      });

      const unsubscribeDone = connection.onResponseComplete((text) => {
        currentResponseText = text;
        responseComplete = true;
        conversation.push({ role: 'agent', content: text });
        this.log('agent', text.slice(0, 100) + (text.length > 100 ? '...' : ''));
      });

      const debugHandler = (event: unknown) => {
        const e = event as { type: string; item?: { type: string; name?: string } };
        if (e.type === 'response.output_item.added' && e.item?.type === 'function_call') {
          this.log('debug', `function_call event received: ${e.item.name}`);
        }
      };
      connection.onMessage(debugHandler);

      const unsubscribeTool = connection.onToolCall((toolCall) => {
        toolCalls.push(toolCall);
        pendingToolCall = toolCall;
        this.log('tool', `Tool called: ${toolCall.name}`);
        this.log('debug', `Args: ${JSON.stringify(toolCall.arguments)}`);
      });

      let shouldContinue = true;
      let agentResponse: string | null = null;

      while (shouldContinue) {
        const driverResponse = await driver.generateNextMessage(agentResponse);
        
        if (driverResponse.evaluation) {
          evaluation = driverResponse.evaluation;
        }

        if (!driverResponse.shouldContinue || !driverResponse.message) {
          shouldContinue = false;
          break;
        }

        currentResponseText = '';
        responseComplete = false;
        pendingToolCall = null;

        conversation.push({ role: 'user', content: driverResponse.message });
        this.log('user', driverResponse.message);
        
        await connection.sendInputText(driverResponse.message);

        try {
          await this.waitForTurnEnd(
            () => responseComplete,
            () => pendingToolCall,
            scenario.timeout || 30000
          );
        } catch (error) {
          this.log('error', 'Timeout waiting for response');
          timedOut = true;
          shouldContinue = false;
          break;
        }

        if (pendingToolCall) {
          const toolName = pendingToolCall.name;
          const expectedTool = scenario.expectedToolCalls?.find(
            t => t.name === toolName
          );
          const mockResult = expectedTool?.mockResult ?? { 
            success: true, 
            message: 'Mock result' 
          };

          this.log('info', `Sending tool result for ${pendingToolCall.name}...`);
          
          currentResponseText = '';
          responseComplete = false;
          pendingToolCall = null;

          connection.sendToolResult(
            toolCalls[toolCalls.length - 1].call_id,
            toolCalls[toolCalls.length - 1].name,
            mockResult
          );

          try {
            await this.waitForCondition(
              () => responseComplete,
              scenario.timeout || 30000
            );
          } catch (error) {
            this.log('error', 'Timeout waiting for tool response');
            timedOut = true;
            shouldContinue = false;
            break;
          }
        }

        agentResponse = currentResponseText;
      }

      unsubscribeText();
      unsubscribeDone();
      connection.offMessage(debugHandler);
      unsubscribeTool();
      connection.close();

      const toolValidation = this.validateToolCalls(toolCalls, scenario.expectedToolCalls);

      // Test fails if: validation fails OR timeout OR no conversation
      const passed = toolValidation.valid && conversation.length > 0 && !timedOut;

      const result: TestResult = {
        passed,
        name: scenario.name,
        duration: Date.now() - startTime,
        turns: conversation.filter(m => m.role === 'user').length,
        conversation,
        toolCalls,
        evaluation: evaluation || toolValidation.message,
        error: timedOut ? 'Test timed out' : (toolValidation.valid ? undefined : toolValidation.message),
        timedOut,
      };

      const logPath = await this.writeMarkdownLog(result);
      this.log('info', `Log written to: ${logPath}`);

      return result;

    } catch (error) {
      connection.close();
      
      const result: TestResult = {
        passed: false,
        name: scenario.name,
        duration: Date.now() - startTime,
        turns: conversation.filter(m => m.role === 'user').length,
        conversation,
        toolCalls,
        evaluation: `Test failed: ${error}`,
        error: String(error),
        timedOut,
      };

      const logPath = await this.writeMarkdownLog(result);
      this.log('info', `Log written to: ${logPath}`);

      return result;
    }
  }

  private async waitForTurnEnd(
    isResponseComplete: () => boolean,
    getPendingTool: () => ToolCall | null,
    timeout: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        
        if (elapsed > timeout) {
          clearInterval(checkInterval);
          reject(new Error('Timeout'));
          return;
        }

        if (isResponseComplete() || getPendingTool() !== null) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  private async waitForCondition(
    condition: () => boolean,
    timeout: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        
        if (elapsed > timeout) {
          clearInterval(checkInterval);
          reject(new Error('Timeout'));
          return;
        }

        if (condition()) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  private validateToolCalls(
    actual: ToolCall[],
    expected?: TestScenario['expectedToolCalls']
  ): { valid: boolean; message: string } {
    if (!expected || expected.length === 0) {
      return { valid: true, message: 'No tool calls expected' };
    }

    for (const exp of expected) {
      const found = actual.find(tc => tc.name === exp.name);
      
      if (!found) {
        if (exp.required) {
          return { valid: false, message: `Required tool "${exp.name}" was not called` };
        }
        continue;
      }

      if (exp.validate && !exp.validate(found.arguments)) {
        return { valid: false, message: `Tool "${exp.name}" called with invalid arguments` };
      }
    }

    return { valid: true, message: `All ${actual.length} tool calls validated` };
  }
}

export { EngineConnection, TestDriver };
export type { ConnectionConfig, TestDriverConfig, ToolCall };
