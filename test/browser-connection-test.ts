/**
 * Browser-Style WebSocket Connection Test
 * 
 * Tests WebSocket connection using browser-style subprotocol authentication
 * (mimics how the OpenAI SDK works in browsers).
 */

import { WebSocket } from 'ws';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error('❌ API_KEY environment variable not set');
  process.exit(1);
}

console.log('🧪 Browser-Style WebSocket Connection Test\n');
console.log('Configuration:');
console.log('  API Base URL:', API_BASE_URL);
console.log('  WebSocket URL:', API_BASE_URL.replace('http', 'ws') + '/v1/realtime');
console.log('');

/**
 * Generate ephemeral token
 */
async function generateToken() {
  console.log('📝 Step 1: Generating ephemeral token...');
  
  const response = await fetch(`${API_BASE_URL}/v1/realtime/sessions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'moonshotai/kimi-k2-instruct-0905',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('❌ Token generation failed:', error);
    throw new Error('Failed to generate token');
  }

  const data = await response.json();
  console.log('✅ Token generated:', data.client_secret.value.substring(0, 20) + '...');
  console.log('');
  
  return data.client_secret.value;
}

/**
 * Connect using browser-style subprotocol authentication
 */
async function connectBrowserStyle(token: string): Promise<void> {
  console.log('📝 Step 2: Connecting with browser-style subprotocol auth...');
  console.log('   Method: WebSocket subprotocols');
  console.log('   Protocols:');
  console.log('     - realtime');
  console.log('     - openai-insecure-api-key.' + token.substring(0, 20) + '...');
  console.log('     - openai-beta.realtime-v1');
  console.log('');
  
  return new Promise((resolve, reject) => {
    const wsUrl = `${API_BASE_URL.replace('http', 'ws')}/v1/realtime?model=moonshotai/kimi-k2-instruct-0905`;
    
    // This mimics exactly how browsers send WebSocket with subprotocols
    const ws = new WebSocket(wsUrl, [
      'realtime',
      `openai-insecure-api-key.${token}`,
      'openai-beta.realtime-v1',
    ]);
    
    ws.on('open', () => {
      console.log('✅ WebSocket connection opened!');
      console.log('   Protocol selected:', ws.protocol || '(none)');
      console.log('');
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('📨 Received message:', message.type);
        
        if (message.type === 'session.created') {
          console.log('✅ session.created event received!');
          console.log('   Session ID:', message.session.id);
          console.log('   Model:', message.session.model);
          console.log('   Voice:', message.session.voice);
          console.log('');
          
          // Success! Close and resolve
          setTimeout(() => {
            console.log('Closing connection...');
            ws.close();
            resolve();
          }, 1000);
        }
      } catch (error) {
        console.error('❌ Error parsing message:', error);
      }
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
      reject(error);
    });
    
    ws.on('close', (code, reason) => {
      console.log('🔌 WebSocket closed');
      console.log('   Code:', code);
      console.log('   Reason:', reason.toString() || '(none)');
      console.log('');
      
      // If closed before we resolved, it's an error
      if (code !== 1000) {
        reject(new Error(`WebSocket closed unexpectedly: ${code} - ${reason.toString()}`));
      }
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      if (ws.readyState !== WebSocket.CLOSED) {
        reject(new Error('Connection timeout - no session.created event received'));
        ws.close();
      }
    }, 5000);
  });
}

/**
 * Main test function
 */
async function runTest() {
  try {
    // Step 1: Generate token
    const token = await generateToken();
    
    // Step 2: Connect using browser-style authentication
    await connectBrowserStyle(token);
    
    console.log('🎉 Browser-style connection test PASSED!');
    console.log('');
    console.log('✅ The server correctly handles browser WebSocket subprotocol auth');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Test FAILED:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
runTest();

