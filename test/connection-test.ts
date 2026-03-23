/**
 * WebSocket Connection Test
 * 
 * Tests the real-time server connection using the actual OpenAI Agents SDK.
 * This helps debug connection issues before testing in the browser.
 */

import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const API_KEY = process.env.API_KEY;
const MODEL = process.env.TEST_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

if (!API_KEY) {
  console.error('❌ API_KEY environment variable not set');
  console.error('   Run: export API_KEY=<your-api-key>');
  process.exit(1);
}

console.log('🧪 WebSocket Connection Test\n');
console.log('Configuration:');
console.log('  API Base URL:', API_BASE_URL);
console.log('  Server URL:', API_BASE_URL.replace('http', 'ws') + '/v1/realtime');
console.log('  Model:', MODEL);
console.log('');

/**
 * Step 1: Generate ephemeral token
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
      model: MODEL,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('❌ Token generation failed:', error);
    throw new Error('Failed to generate token');
  }

  const data = await response.json();
  console.log('✅ Token generated:', data.client_secret.value.substring(0, 20) + '...');
  console.log('   Expires at:', new Date(data.client_secret.expires_at * 1000).toLocaleString());
  console.log('');
  
  return data.client_secret.value;
}

/**
 * Step 2: Create agent and session
 */
function createSession() {
  console.log('📝 Step 2: Creating agent and session...');
  
  const agent = new RealtimeAgent({
    name: 'TestAgent',
    instructions: 'You are a test assistant. Say "Connection test successful!" when you hear anything.',
  });
  
  const session = new RealtimeSession(agent, {
    transport: 'websocket',
    model: MODEL,
  });
  
  console.log('✅ Agent and session created');
  console.log('');
  
  return { agent, session };
}

/**
 * Step 3: Connect to server
 */
async function connectToServer(session: RealtimeSession, token: string) {
  console.log('📝 Step 3: Connecting to server...');
  console.log('   Token:', token.substring(0, 20) + '...');
  console.log('   URL:', API_BASE_URL.replace('http', 'ws') + '/v1/realtime');
  console.log('');
  
  try {
    await session.connect({
      apiKey: token,
      url: `${API_BASE_URL.replace('http', 'ws')}/v1/realtime`,
    });
    
    console.log('✅ Connected successfully!');
    console.log('');
    return true;
  } catch (error) {
    console.error('❌ Connection failed:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
    console.log('');
    return false;
  }
}

/**
 * Step 4: Set up event listeners
 */
function setupEventListeners(session: RealtimeSession) {
  console.log('📝 Step 4: Setting up event listeners...');
  
  session.on('error', (error) => {
    console.error('❌ Session error:', error);
  });
  
  session.on('conversation.updated', (event) => {
    console.log('💬 Conversation updated:', event);
  });
  
  session.on('audio', (event) => {
    console.log('🔊 Received audio chunk:', event.data.byteLength, 'bytes');
  });
  
  session.on('response.created', (event) => {
    console.log('📤 Response created:', event);
  });
  
  session.on('response.done', (event) => {
    console.log('✅ Response done:', event);
  });
  
  // Log all events for debugging
  (session as any).on('*', (event: any) => {
    if (!['audio', 'conversation.updated'].includes(event.type)) {
      console.log('📡 Event:', event.type, event);
    }
  });
  
  console.log('✅ Event listeners set up');
  console.log('');
}

/**
 * Main test function
 */
async function runTest() {
  try {
    // Step 1: Generate token
    const token = await generateToken();
    
    // Step 2: Create session
    const { session } = createSession();
    
    // Step 3: Set up event listeners
    setupEventListeners(session);
    
    // Step 4: Connect
    const connected = await connectToServer(session, token);
    
    if (!connected) {
      console.error('❌ Test failed: Could not connect to server');
      process.exit(1);
    }
    
    console.log('🎉 Connection test passed!');
    console.log('');
    console.log('Keeping connection open for 5 seconds to test events...');
    
    // Keep connection open for a bit to see events
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('');
    console.log('Closing connection...');
    session.close();
    
    console.log('✅ Test completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    if (error instanceof Error) {
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
runTest();
