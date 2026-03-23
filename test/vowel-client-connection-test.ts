import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const API_KEY = process.env.API_KEY;
const MODEL = process.env.TEST_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

if (!API_KEY) {
  console.error('❌ API_KEY environment variable not set');
  process.exit(1);
}

async function generateToken(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/v1/realtime/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      voice: 'Ashley',
    }),
  });

  if (!response.ok) {
    throw new Error(`Token request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { client_secret: { value: string } };
  return data.client_secret.value;
}

async function main(): Promise<void> {
  console.log('🧪 Vowel Client Connection Test');
  console.log('  Base URL:', API_BASE_URL);
  console.log('  Model:', MODEL);

  const token = await generateToken();
  console.log('✅ Token generated');

  const agent = new RealtimeAgent({
    name: 'Vowel Client Test',
    instructions: 'You are a helpful voice assistant. Keep responses concise.',
    tools: [],
  });

  const session = new RealtimeSession(agent, {
    transport: 'websocket',
    model: MODEL,
    config: {
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          turnDetection: {
            type: 'server_vad',
            threshold: 0.5,
            silenceDurationMs: 550,
            prefixPaddingMs: 0,
            interruptResponse: true,
          },
        },
        output: {
          voice: 'Ashley',
        },
      },
    },
  });

  session.on('transport_event', (event: any) => {
    if (event?.type !== 'response.audio.delta' && event?.type !== 'response.audio_transcript.delta') {
      console.log('📨 transport_event:', event?.type, JSON.stringify(event));
    }
  });

  session.on('session.updated', (event: any) => {
    console.log('🔄 session.updated:', JSON.stringify(event));
  });

  session.on('error', (event: any) => {
    console.log('❌ session.error:', event);
  });

  session.on('close', (event: any) => {
    console.log('🔌 session.close:', event);
  });

  session.on('disconnected', (event: any) => {
    console.log('🔌 session.disconnected:', event);
  });

  await session.connect({
    apiKey: token,
    url: `${API_BASE_URL.replace('http', 'ws')}/v1/realtime`,
  });

  console.log('✅ Connected');
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  session.close();
  console.log('✅ Closed cleanly');
}

await main();
