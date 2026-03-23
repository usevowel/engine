/**
 * Debug WebSocket Connection
 * 
 * Simple script to debug WebSocket message flow
 */

import WebSocket from 'ws';

const BASE_URL = process.env.TEST_BASE_URL || process.env.SNDBRD_BASE_URL || 'http://localhost:8787';
const API_KEY = process.env.API_KEY || 'your_api_key_here';
const MODEL = process.env.TEST_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

async function getToken() {
  const response = await fetch(`${BASE_URL}/v1/realtime/sessions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      voice: 'Ashley',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get token: ${response.status}`);
  }

  const data = await response.json() as { client_secret: { value: string } };
  return data.client_secret.value;
}

async function main() {
  console.log('🔑 Getting token...');
  const token = await getToken();
  console.log('✅ Token acquired');

  const wsUrl = BASE_URL.replace(/^http/, 'ws');
  const url = `${wsUrl}/v1/realtime?model=${encodeURIComponent(MODEL)}`;

  console.log(`🔌 Connecting to ${url}...`);
  
  const ws = new WebSocket(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  ws.on('open', () => {
    console.log('✅ WebSocket connected');
  });

  let textBuffer = '';
  let pendingToolCall: { call_id: string; name: string } | null = null;

  ws.on('message', (data) => {
    const event = JSON.parse(data.toString());
    console.log(`📥 Received: ${event.type}`, JSON.stringify(event, null, 2).substring(0, 300));

    // When session.created is received, configure session
    if (event.type === 'session.created') {
      console.log('⚙️  Configuring session for text mode...');
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text'],
          instructions: 'You are a helpful assistant with access to weather tools.',
          tools: [
            {
              type: 'function',
              name: 'get_weather',
              description: 'Get weather information for a location',
              parameters: {
                type: 'object',
                properties: {
                  location: {
                    type: 'string',
                    description: 'The city and state, e.g. San Francisco, CA',
                  },
                },
                required: ['location'],
              },
            },
          ],
          tool_choice: 'auto',
          initial_greeting_prompt: null, // Disable initial greeting
        },
      }));
    }

    // When session.updated is received, send user message
    if (event.type === 'session.updated') {
      console.log('✅ Session configured, sending user message...');
      
      // Create conversation item (server auto-triggers response for user messages)
      ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'What is the weather in New York?' }],
        },
      }));
      
      console.log('📤 Sent user message (server will auto-trigger response)');
    }

    // Log text deltas
    if (event.type === 'response.text.delta') {
      textBuffer += event.delta;
      console.log(`📝 Text delta: "${event.delta}"`);
    }

    // Detect tool calls
    if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      console.log(`🔧 Tool call detected: ${event.item.name}`);
      pendingToolCall = {
        call_id: event.item.call_id,
        name: event.item.name,
      };
    }

    // Log when response is done
    if (event.type === 'response.done') {
      console.log('✅ Response done, text so far:', textBuffer);
      
      if (pendingToolCall) {
        console.log('📤 Sending tool result...');
        ws.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: pendingToolCall.call_id,
            name: pendingToolCall.name,
            output: JSON.stringify({
              location: 'New York, NY',
              temperature: '72°F',
              condition: 'Sunny',
            }),
          },
        }));
        
        // Trigger another response
        ws.send(JSON.stringify({
          type: 'response.create',
        }));
        
        pendingToolCall = null;
        textBuffer = '';
        console.log('📤 Sent tool result and triggered new response');
      } else {
        console.log('✅ Final response complete, no tool calls pending');
        setTimeout(() => {
          ws.close();
          process.exit(0);
        }, 1000);
      }
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket closed');
  });

  // Timeout after 30 seconds
  setTimeout(() => {
    console.log('⏱️ Timeout - closing connection');
    ws.close();
    process.exit(1);
  }, 30000);
}

main().catch(console.error);
