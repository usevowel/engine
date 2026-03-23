/**
 * Engine Connection
 * 
 * Manages WebSocket connection to the voice agent engine.
 * Follows the real client flow: get token -> connect WebSocket -> configure session.
 * 
 * @module connection
 */

import WebSocket from 'ws';

export interface ConnectionConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  voice?: string;
  instructions?: string;
  tools?: unknown[];
}

export interface ToolCall {
  name: string;
  call_id: string;
  arguments: Record<string, unknown>;
}

export interface SessionConfig {
  modalities: string[];
  instructions?: string;
  tools?: unknown[];
}

export class EngineConnection {
  private ws?: WebSocket;
  private sessionId?: string;
  private messageCallbacks: Array<(data: unknown) => void> = [];
  private connected = false;
  private responseBuffer = '';
  private receivedEvents: unknown[] = [];

  async connect(config: ConnectionConfig): Promise<void> {
    // Step 1: Get ephemeral token from REST API
    console.log('🔑 Getting ephemeral token...');
    const token = await this.getEphemeralToken({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      voice: config.voice || 'Ashley',
    });
    console.log('✅ Token acquired');

    // Step 2: Connect to WebSocket with token
    console.log('🔌 Connecting to WebSocket...');
    await this.connectWebSocket({
      baseUrl: config.baseUrl,
      token: token,
      model: config.model,
    });
    console.log('✅ WebSocket connected');

    // Step 3: Wait for session.created event
    console.log('⏳ Waiting for session.created...');
    const session = await this.waitForSessionCreated();
    this.sessionId = session.id;
    console.log(`✅ Session created: ${this.sessionId}`);

    // Step 4: Configure session for text mode
    console.log('⚙️  Configuring session for text mode...');
    await this.configureSession({
      modalities: ['text'],
      instructions: config.instructions,
      tools: config.tools,
    });
    console.log('✅ Session configured');
  }

  private async getEphemeralToken(params: {
    baseUrl: string;
    apiKey: string;
    model: string;
    voice: string;
  }): Promise<string> {
    const response = await fetch(`${params.baseUrl}/v1/realtime/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        voice: params.voice,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get token: ${response.status} ${error}`);
    }

    const data = await response.json() as { client_secret: { value: string } };
    return data.client_secret.value;
  }

  private async connectWebSocket(params: {
    baseUrl: string;
    token: string;
    model: string;
  }): Promise<void> {
    // Convert http to ws
    const wsUrl = params.baseUrl.replace(/^http/, 'ws');
    const url = `${wsUrl}/v1/realtime?model=${encodeURIComponent(params.model)}`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${params.token}`,
        },
      });

      this.ws.on('open', () => {
        this.connected = true;
        resolve();
      });

      this.ws.on('error', (error) => {
        reject(error);
      });

      this.ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleMessage(event);
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      });
    });
  }

  private handleMessage(event: unknown): void {
    this.receivedEvents.push(event);
    if (this.receivedEvents.length > 200) {
      this.receivedEvents.shift();
    }
    this.messageCallbacks.forEach(cb => cb(event));
  }

  private async waitForSessionCreated(): Promise<{ id: string }> {
    const existing = this.receivedEvents.find((event) => {
      const e = event as { type?: string; session?: { id?: string } };
      return e.type === 'session.created' && !!e.session?.id;
    }) as { session?: { id: string } } | undefined;

    if (existing?.session?.id) {
      return { id: existing.session.id };
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for session.created'));
      }, 10000);

      const handler = (event: unknown) => {
        const e = event as { type: string; session?: { id: string } };
        if (e.type === 'session.created' && e.session) {
          clearTimeout(timeout);
          this.offMessage(handler);
          resolve({ id: e.session.id });
        }
      };

      this.onMessage(handler);
    });
  }

  private async configureSession(config: SessionConfig): Promise<void> {
    this.send({
      type: 'session.update',
      session: {
        modalities: config.modalities,
        instructions: config.instructions,
        tools: config.tools || [],
        tool_choice: 'auto',
        initial_greeting_prompt: null, // Disable initial greeting for testing
      },
    });

    const existing = this.receivedEvents.find((event) => {
      const e = event as { type?: string };
      return e.type === 'session.updated';
    });

    if (existing) {
      return;
    }

    // Wait for session.updated confirmation
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for session.updated'));
      }, 5000);

      const handler = (event: unknown) => {
        const e = event as { type: string };
        if (e.type === 'session.updated') {
          clearTimeout(timeout);
          this.offMessage(handler);
          resolve();
        }
      };

      this.onMessage(handler);
    });
  }

  send(event: unknown): void {
    if (!this.ws || !this.connected) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify(event));
  }

  // Send text as user input
  async sendInputText(text: string): Promise<void> {
    // Send as conversation.item.create (user message)
    // Note: The server automatically triggers a response when it receives a user message
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    });
  }

  // Listen for agent text responses
  onResponseText(callback: (text: string) => void): () => void {
    const handler = (event: unknown) => {
      const e = event as { type: string; delta?: string; text?: string };
      if (e.type === 'response.text.delta' && e.delta) {
        callback(e.delta);
      }
    };
    this.onMessage(handler);
    return () => this.offMessage(handler);
  }

  // Listen for complete responses
  onResponseComplete(callback: (text: string) => void): () => void {
    let buffer = '';
    
    const textHandler = (event: unknown) => {
      const e = event as { type: string; delta?: string };
      if (e.type === 'response.text.delta' && e.delta) {
        buffer += e.delta;
      }
    };

    const doneHandler = (event: unknown) => {
      const e = event as { type: string };
      if (e.type === 'response.done') {
        callback(buffer);
        buffer = '';
      }
    };

    this.onMessage(textHandler);
    this.onMessage(doneHandler);

    return () => {
      this.offMessage(textHandler);
      this.offMessage(doneHandler);
    };
  }

  // Listen for tool calls (handles both proper events and text-based tool calls)
  onToolCall(callback: (toolCall: ToolCall) => void): () => void {
    let textBuffer = '';
    const detectedCalls = new Set<string>(); // Track already-detected calls

    const handler = (event: unknown) => {
      const e = event as {
        type: string;
        delta?: string;
        item?: {
          type: string;
          name?: string;
          call_id?: string;
          arguments?: string;
        };
      };

      // Method 1: Proper function_call events (if server supports them)
      if (e.type === 'response.output_item.added' && e.item?.type === 'function_call') {
        callback({
          name: e.item.name || '',
          call_id: e.item.call_id || '',
          arguments: JSON.parse(e.item.arguments || '{}'),
        });
        return;
      }

      // Method 2: Parse text-based tool calls (current server behavior)
      // Format: tool_name:call_id<|tool_call_argument_begin|>{"key": "value"}<|tool_call_end|>
      // Note: tool_call_end may not always be present
      if (e.type === 'response.text.delta' && e.delta) {
        textBuffer += e.delta;

        // Look for complete tool call patterns (with or without tool_call_end)
        const toolCallPattern = /(\w+):(\d+)<\|tool_call_argument_begin\|>(\{[^}]*\})(?:<\|tool_call_end\|>)?/g;
        let match;

        while ((match = toolCallPattern.exec(textBuffer)) !== null) {
          const [, name, callId, argsJson] = match;
          const callKey = `${name}:${callId}`;

          // Only report each unique call once
          if (!detectedCalls.has(callKey)) {
            detectedCalls.add(callKey);
            try {
              const args = JSON.parse(argsJson);
              callback({
                name,
                call_id: callId,
                arguments: args,
              });
            } catch {
              // Invalid JSON, ignore
            }
          }
        }
      }

      // Clear buffer when response is done
      if (e.type === 'response.done') {
        textBuffer = '';
      }
    };

    this.onMessage(handler);
    return () => this.offMessage(handler);
  }

  // Send tool result back to the server
  sendToolResult(call_id: string, name: string, output: unknown): void {
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: call_id,
        name: name,
        output: JSON.stringify(output),
      },
    });

    // Trigger a new response after sending tool result
    this.send({
      type: 'response.create',
    });
  }

  // Generic message handler
  onMessage(callback: (data: unknown) => void): void {
    this.messageCallbacks.push(callback);
  }

  offMessage(callback: (data: unknown) => void): void {
    const index = this.messageCallbacks.indexOf(callback);
    if (index > -1) {
      this.messageCallbacks.splice(index, 1);
    }
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.connected = false;
    }
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }
}
