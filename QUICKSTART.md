# Voice Agents Quickstart

Get started with voice agents using the OpenAI Agents SDK connected to your own real-time API server.

## Overview

This quickstart will guide you through creating a browser-based voice agent that connects to your custom real-time API server hosted at `your-engine.example.com`. The server uses:
- **Model**: OpenAI GPT-OSS 120B (120B parameter model running on Groq at ~500 tokens/sec)
- **STT**: Groq Whisper Large V3
- **TTS**: Modular provider system (configurable)
- **Transport**: WebSocket

## Prerequisites

- Node.js 18+ or Bun
- A modern web browser
- Access to the server's API key (for generating ephemeral tokens)

---

## Step 1: Create a Project

In this quickstart we will create a voice agent you can use in the browser. You can use Next.js or Vite for your project.

**Using Vite (recommended for quick testing):**

```bash
npm create vite@latest my-voice-agent -- --template vanilla-ts
cd my-voice-agent
```

**Or using Next.js:**

```bash
npx create-next-app@latest my-voice-agent --typescript
cd my-voice-agent
```

**Or try the demo:**

See the [demo folder](./demo) for a ready-to-run vanilla example.

---

## Step 2: Install the Agents SDK

```bash
npm install @openai/agents zod@3
```

Alternatively, you can install `@openai/agents-realtime` for a standalone browser package with a smaller bundle size.

---

## Step 3: Generate a Client Ephemeral Token

Since this application will run in the user's browser, you need a secure way to connect to the model through the Realtime API. Use an **ephemeral client token** that should be generated on your backend server.

### For Testing: Generate Token via curl

For testing purposes, you can generate a token using `curl` and your server's API key:

```bash
export SERVER_API_KEY="gsk_...(your Groq API key)"

curl -X POST https://your-engine.example.com/v1/realtime/sessions \
  -H "Authorization: Bearer $SERVER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "moonshotai/kimi-k2-instruct-0905",
    "voice": "en_US-ryan-medium"
  }'
```

**Response:**
```json
{
  "client_secret": {
    "value": "ek_...",
    "expires_at": 1234567890
  }
}
```

The response contains a `client_secret.value` string that starts with `ek_` prefix. This ephemeral key is valid for **5 minutes** and allows browser clients to connect securely.

### For Production: Backend Token Endpoint

In production, create a backend endpoint that generates tokens. See the [Production Backend Example](#example-production-backend-endpoint) below.

---

## Step 4: Create Your First Agent

Creating a `RealtimeAgent` is straightforward:

```typescript
import { RealtimeAgent } from '@openai/agents/realtime';

const agent = new RealtimeAgent({
  name: 'Assistant',
  instructions: 'You are a helpful assistant. Be concise and friendly.',
});
```

You can customize the agent's behavior with different instructions, or add tools and guardrails later.

---

## Step 5: Create a Session

A Voice Agent runs continuously inside a `RealtimeSession` that handles the conversation and connection over time. The session manages audio processing, interruptions, and conversation history.

```typescript
import { RealtimeSession } from '@openai/agents/realtime';

const session = new RealtimeSession(agent, {
  transport: 'websocket',  // Use WebSocket transport
  model: 'moonshotai/kimi-k2-instruct-0905',  // Your server's model
});
```

The `RealtimeSession` constructor takes an `agent` as the first argument. This agent will be the first agent your user can interact with.

---

## Step 6: Connect to the Session

To connect to the session, you need to:
1. Fetch an ephemeral token from your backend
2. Connect using that token with your server's URL

```typescript
// Fetch ephemeral token from your backend
const tokenResponse = await fetch('/api/token');  // Your backend endpoint
const { client_secret } = await tokenResponse.json();

// Connect to your real-time server
await session.connect({ 
  apiKey: client_secret.value,
  url: 'wss://your-engine.example.com/v1/realtime',
});
```

This will connect to your server using WebSocket and automatically configure your microphone and speaker for audio input and output.

---

## Step 7: Putting It All Together

Here's a complete example for a Vite vanilla TypeScript project:

```typescript
// src/main.ts
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

async function initVoiceAgent() {
  // Create the agent
  const agent = new RealtimeAgent({
    name: 'Assistant',
    instructions: 'You are a helpful assistant. Be concise and friendly.',
  });

  // Create the session
  const session = new RealtimeSession(agent, {
    transport: 'websocket',
    model: 'moonshotai/kimi-k2-instruct-0905',
  });

  try {
    // For testing: Use a pre-generated token
    // In production: Fetch from your backend endpoint
    const tokenResponse = await fetch('/api/token');
    const { client_secret } = await tokenResponse.json();

    // Connect to your server
    await session.connect({
      apiKey: client_secret.value,
      url: 'wss://your-engine.example.com/v1/realtime',
    });

    console.log('✅ Connected to voice agent!');
    console.log('🎤 Start speaking to interact with the agent');

    // Optional: Listen for audio events
    session.on('audio', (event) => {
      console.log('Received audio chunk from agent');
    });

    // Optional: Listen for transcript events
    session.on('transcript', (event) => {
      if (event.role === 'user') {
        console.log('You said:', event.text);
      } else {
        console.log('Agent said:', event.text);
      }
    });

  } catch (error) {
    console.error('Failed to connect:', error);
  }
}

// Add a button to start the session
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>
    <h1>Voice Agent Demo</h1>
    <button id="start-btn">Start Voice Agent</button>
    <div id="status"></div>
  </div>
`;

document.getElementById('start-btn')?.addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = 'Connecting...';
  
  await initVoiceAgent();
  
  if (statusEl) statusEl.textContent = '✅ Connected! Start speaking...';
});
```

---

## Step 8: Fire Up the Engines and Start Talking

Start your development server:

```bash
npm run dev
```

Navigate to the page in your browser. You should see:
1. A button to start the voice agent
2. A request for microphone access (click "Allow")
3. Once connected, start speaking to interact with the agent!

---

## Configuration Options

### Customizing Voice

Your server supports configurable TTS voices. You can specify the voice when generating the ephemeral token:

```typescript
const response = await fetch('https://your-engine.example.com/v1/realtime/sessions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SERVER_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'moonshotai/kimi-k2-instruct-0905',
    voice: 'Ashley',  // Configured TTS voice
  }),
});
```

**Available Voices** (default: `Ashley`):
- `Ashley` - Natural US English female voice
- `Brian` - Natural US English male voice
- Voice names depend on your TTS provider configuration.

### Session Configuration

You can update session configuration after connection:

```typescript
// Update agent instructions on the fly
session.send({
  type: 'session.update',
  session: {
    instructions: 'You are now a pirate. Speak like one!',
    voice: 'en_US-ryan-medium',
  },
});
```

---

## Differences from OpenAI's Realtime API

Your custom server has a few differences from OpenAI's official Realtime API:

| Feature | OpenAI Realtime API | Your Server (`your-engine.example.com`) |
|---------|---------------------|--------------------------------|
| **Model** | `gpt-4o-realtime-preview-2024-10-01` | `moonshotai/kimi-k2-instruct-0905` |
| **Base URL** | `wss://api.openai.com/v1/realtime` | `wss://your-engine.example.com/v1/realtime` |
| **Token Endpoint** | `/v1/realtime/client_secrets` | `/v1/realtime/sessions` |
| **Voices** | `alloy`, `echo`, `ash`, `fable`, `onyx`, `nova` | Configurable voices |
| **Transport** | WebRTC (browser) + WebSocket (server) | WebSocket only |
| **TTS** | Remote API | Modular provider system |
| **Model Provider** | OpenAI proprietary | Groq (OpenAI GPT-OSS 120B) |
| **Speed** | ~100-200 tps | ~500 tps (via Groq LPU) |

---

## Troubleshooting

### Connection Issues

**Error: "Failed to connect"**
- Check that the server is running and accessible at `https://your-engine.example.com`
- Verify your ephemeral token hasn't expired (tokens are valid for 5 minutes)
- Ensure you're using `wss://` (secure WebSocket) not `ws://`

**Error: "Unauthorized"**
- Your ephemeral token may have expired
- Generate a new token and retry

### Audio Issues

**Microphone not working:**
- Check browser permissions (should prompt on first use)
- Ensure you're on HTTPS (required for microphone access)
- Try a different browser (Chrome/Edge recommended)

**No audio output:**
- Check your system volume and browser audio settings
- The agent may be generating text but TTS hasn't completed yet
- Look for errors in the browser console

### Token Generation Issues

**Cannot generate token:**
- Verify your `SERVER_API_KEY` is correct (should be your Groq API key)
- Check that the server is accessible at `https://your-engine.example.com`
- Ensure you're sending the correct `Content-Type: application/json` header

---

## Next Steps

From here you can enhance your voice agent with additional features:

### Add Tools and Functions
Give your agent the ability to call functions and use tools:

```typescript
import { tool } from '@openai/agents/realtime';

const agent = new RealtimeAgent({
  name: 'Assistant',
  instructions: 'You can help with weather information.',
  tools: [
    tool({
      name: 'get_weather',
      description: 'Get the current weather for a location',
      parameters: z.object({
        location: z.string().describe('The city name'),
      }),
      execute: async ({ location }) => {
        // Fetch weather data
        return `The weather in ${location} is sunny and 72°F`;
      },
    }),
  ],
});
```

### Add Guardrails
Implement safety guardrails for your agent:

```typescript
const session = new RealtimeSession(agent, {
  transport: 'websocket',
  model: 'moonshotai/kimi-k2-instruct-0905',
  guardrails: {
    output: [
      {
        validate: (text) => {
          // Check for inappropriate content
          if (text.includes('badword')) {
            throw new Error('Inappropriate content detected');
          }
        },
      },
    ],
  },
});
```

### Handle Agent Handoffs
Create multi-agent systems with handoffs:

```typescript
const supportAgent = new RealtimeAgent({
  name: 'Support',
  instructions: 'Handle customer support inquiries.',
});

const salesAgent = new RealtimeAgent({
  name: 'Sales',
  instructions: 'Help with sales and product information.',
});

// Implement handoff logic between agents
```

### Manage Session History
Access and manage the conversation history:

```typescript
session.on('history_added', (item) => {
  console.log('New conversation item:', item);
  
  // Store in database or display in UI
  if (item.type === 'message') {
    console.log(`${item.role}: ${item.content}`);
  }
});

// Get full history
const history = session.getHistory();
```

---

## Learn More

- **OpenAI Agents SDK Documentation**: [https://openai.github.io/openai-agents-js](https://openai.github.io/openai-agents-js)
- **Voice Agents Guide**: [https://openai.github.io/openai-agents-js/guides/voice-agents/overview/](https://openai.github.io/openai-agents-js/guides/voice-agents/overview/)
- **Transport Mechanisms**: [https://openai.github.io/openai-agents-js/guides/voice-agents/transport-mechanisms/](https://openai.github.io/openai-agents-js/guides/voice-agents/transport-mechanisms/)
- **Moonshot Kimi K2 Instruct 0905**: [https://platform.moonshot.cn/docs/intro](https://platform.moonshot.cn/docs/intro)

---

## Example: Production Backend Endpoint

Here's a complete example of a secure backend endpoint for generating ephemeral tokens:

```typescript
// app/api/token/route.ts (Next.js App Router)
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate the user (example using session)
    const session = await getServerSession(request);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Optional: Check user permissions/rate limits
    const canUseVoice = await checkUserPermissions(session.user.id);
    if (!canUseVoice) {
      return NextResponse.json(
        { error: 'Voice agent access denied' },
        { status: 403 }
      );
    }

    // 3. Generate ephemeral token from your server
    const response = await fetch('https://your-engine.example.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SERVER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moonshotai/kimi-k2-instruct-0905',
        voice: 'en_US-ryan-medium',
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate token');
    }

    const data = await response.json();

    // 4. Return token to client
    return NextResponse.json(data);

  } catch (error) {
    console.error('Token generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate token' },
      { status: 500 }
    );
  }
}
```

---

## Security Best Practices

1. **Never expose your `SERVER_API_KEY` to the browser** - Always generate ephemeral tokens from your backend
2. **Implement authentication** - Ensure only authorized users can request tokens
3. **Rate limiting** - Limit token generation per user to prevent abuse
4. **Token expiration** - Tokens expire after 5 minutes; generate new ones as needed
5. **HTTPS only** - Always use secure connections (`wss://` and `https://`)
6. **Content moderation** - Implement guardrails to filter inappropriate content
7. **Usage tracking** - Monitor API usage and costs in your backend

---

Happy building! 🎙️✨

