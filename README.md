# vowel engine

> OpenAI-compatible real-time voice API server with modular runtimes and flexible LLM providers

A production-ready real-time voice API server that implements the OpenAI Realtime API protocol, compatible with the [OpenAI Agents JS SDK](https://openai.github.io/openai-agents-js/guides/voice-agents/quickstart/). The shared engine logic lives in `src/`, while deployment-specific integrations can be added via packages under `packages/`.

## What's New

**Modular Agent System** (Nov 2025)
- Flexible Architecture: Swap between different AI agent implementations
- Two Agent Types: VercelSDKAgent (battle-tested) or CustomAgent (full control)
- ConversationSummarizer: Handle very long conversations (hours) with async LLM-based summarization
- Feature Flag: Enable via `USE_MODULAR_AGENTS=true` (backward compatible)

See [docs/MODULAR_AGENTS_CONFIGURATION.md](./docs/MODULAR_AGENTS_CONFIGURATION.md) for details.

**OpenRouter Integration** (Nov 2025)
- Choose Your Model: Use Groq (fast) OR OpenRouter (Claude 3.5, GPT-4, Llama, 100+ models)
- Simple Setup: Just set `LLM_PROVIDER=openrouter` and you're good to go!

See [OPENROUTER_QUICKSTART.md](./OPENROUTER_QUICKSTART.md) for details.

## Quick Start

**Want to try a demo?** Check out the [demo folder](./demo).

**Want to deploy your own?** See deployment instructions below.

## Overview

### What is vowel engine?

vowel engine is a WebSocket-based real-time voice API server that provides an OpenAI Realtime API compatible interface, allowing you to use the OpenAI Agents SDK with your own infrastructure. The current modular shape is:

- `src/` - shared engine logic, session handling, tools, agents, and provider contracts
- `packages/runtime-node` - self-hosted Bun/Node runtime

It supports multiple LLM providers and modular STT/TTS/VAD components.

### Why vowel engine?

- OpenAI SDK Compatible - Drop-in compatible with OpenAI Agents JS SDK
- Blazing Fast - 500+ tokens/sec via Groq's LPU infrastructure
- Flexible LLM Choice - Use Groq, OpenRouter (Claude/GPT-4/Llama), or switch anytime
- Open Source Models - Supports open models (Llama, Mistral, etc.)
- Cost Effective - Lower costs than proprietary alternatives
- Full Control - Host your own server, customize everything
- Universal - Works in browser, Node.js, mobile apps

## Architecture

```
┌─────────────┐                    ┌──────────────────────────┐
│   Browser   │ ◄─── WebSocket ───►│   Runtime Package        │
│   Client    │    (Ephemeral      │  Bun or Node             │
│ (OpenAI SDK)│     Token Auth)    │                          │
└─────────────┘                    └─────────────┬────────────┘
                                                 │
                                      ┌──────────▼──────────┐
                                      │  Shared Engine      │
                                      │  src/               │
                                      └──────────┬──────────┘
                                                 │
                        ┌────────────────────────┼────────────────────────┐
                        │                        │                        │
                   ┌────▼─────┐           ┌──────▼─────┐           ┌──────▼─────┐
                   │   STT    │           │   LLM      │           │    TTS     │
                   │ Provider │           │  Groq /    │           │  Provider  │
                   │(Modular) │           │ OpenRouter │           │ (Modular)  │
                   └───────────┘           └────────────┘           └────────────┘
```

## Features

### Core Features
- Full OpenAI Realtime API protocol compliance
- WebSocket-based bidirectional streaming
- Ephemeral token authentication (5-minute expiration)
- Audio input/output streaming (PCM16, 24kHz, mono)
- Modular STT/TTS/VAD provider system
- Session management and configuration
- Conversation history tracking
- Comprehensive error handling
- Acknowledgement Responses - Automatic responses after delay for better perceived responsiveness
- Typing Sounds - Optional looping typing sounds during processing

### Differences from OpenAI's API

| Feature | OpenAI Realtime API | vowel engine |
|---------|---------------------|--------|
| **Model** | `gpt-4o-realtime-preview-2024-10-01` | Configurable |
| **Transport** | WebRTC + WebSocket | WebSocket only |
| **Provider** | OpenAI proprietary | Groq, OpenRouter, or custom |
| **Speed** | ~100-200 tps | ~500 tps (Groq) |
| **Cost** | Higher | Lower |

## Use Cases

- Voice Assistants - Build conversational AI for web/mobile apps
- Phone Agents - Customer support, IVR systems
- Interactive Tutorials - Voice-guided learning experiences
- Accessibility Tools - Voice interfaces for applications
- Gaming NPCs - Real-time voice character interactions
- Voice Bots - Discord, Telegram, custom platforms

## API Reference

### Generate Ephemeral Token

```http
POST https://your-engine.example.com/v1/realtime/sessions
Authorization: Bearer <SERVER_API_KEY>
Content-Type: application/json

{
  "model": "moonshotai/kimi-k2-instruct-0905",
  "voice": "en_US-ryan-medium"
}
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

### WebSocket Connection

```
wss://your-engine.example.com/v1/realtime?model=moonshotai/kimi-k2-instruct-0905
Authorization: Bearer <ephemeral_token>
```

### Supported Events

**Client → Server:**
- `session.update` - Update session configuration
- `input_audio_buffer.append` - Stream audio chunks
- `input_audio_buffer.commit` - Process audio
- `conversation.item.create` - Add text messages
- `response.create` - Request AI response
- `response.cancel` - Cancel in-progress response

**Server → Client:**
- `session.created` - Session initialized
- `input_audio_buffer.speech_started` - Audio detected
- `conversation.item.created` - New conversation item
- `response.text.delta` - Streaming text response
- `response.audio.delta` - Streaming audio response
- `response.done` - Response complete
- `error` - Error occurred

See the [OpenAI Realtime API documentation](https://platform.openai.com/docs/guides/realtime-websocket) for full protocol details.

## Usage Example

```typescript
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

// 1. Create agent
const agent = new RealtimeAgent({
  name: 'Assistant',
  instructions: 'You are a helpful assistant.',
});

// 2. Fetch ephemeral token from your backend
const { client_secret } = await fetch('/api/token').then(r => r.json());

// 3. Create and connect session
const session = new RealtimeSession(agent, {
  transport: 'websocket',
  model: 'moonshotai/kimi-k2-instruct-0905',
});

await session.connect({
  apiKey: client_secret.value,
  url: 'wss://your-engine.example.com/v1/realtime',
});

// 4. Start talking!
console.log('Connected! Start speaking...');
```

## Security

### Authentication Flow

1. User requests voice session
2. Your backend authenticates user
3. Backend requests ephemeral token from your engine server (using SERVER_API_KEY)
4. Backend returns ephemeral token to frontend
5. Frontend connects to WebSocket with ephemeral token
6. Voice session begins (5-minute token lifetime)

### Best Practices

- Never expose `SERVER_API_KEY` in frontend code
- Always generate ephemeral tokens from your backend
- Implement rate limiting on token generation
- Use HTTPS/WSS for all connections
- Implement user authentication before token generation

## Deployment

### Self-Hosting

The server can be hosted on any infrastructure:
- Domain: `your-engine.example.com` (configure your own)
- Protocol: WSS (secure WebSocket)

Requirements:
- Runtime: Bun or Node.js
- API keys:
  - LLM API key (Groq or OpenRouter)
  - JWT_SECRET (32+ characters)
  - API_KEY (for token generation)

For local deployment with Core plus vowel engine, see the [self-hosted deployment guide](./wiki/docs/deployment/).

## Documentation

- [QUICKSTART.md](./QUICKSTART.md) - Get started in minutes
- [demo/](./demo) - Working example
- [packages/runtime-node](./packages/runtime-node) - Self-hosted Bun/Node runtime package

## Tech Stack

- Core Runtime Model: Shared `src/` engine with pluggable runtime packages
- Node Runtime: Bun/Node for self-hosted deployments
- LLM Provider: Groq or OpenRouter
- STT: Modular provider system
- TTS: Modular provider system
- VAD: Modular provider system (Silero, etc.)
- AI SDK: Vercel AI SDK
- Auth: jose (JWT tokens)

## License

This project is open source.

## Links

- [OpenAI Agents JS SDK](https://openai.github.io/openai-agents-js)
- [Groq Console](https://console.groq.com)
- [OpenRouter](https://openrouter.ai)
- [Vercel AI SDK](https://sdk.vercel.ai)

## Audio Assets & Credits

### Typing Sounds

The typing sound feature uses Creative Commons licensed audio:

- "quiet typing on laptop computer" by lmz36 (CC0/Public Domain)
- "Typing" by L.i.Z.e.L.l.E_+ (CC0/Public Domain)

These sounds are used to provide audio feedback during AI processing to improve perceived responsiveness.

## Configuration

### Acknowledgement Responses

Acknowledgement responses automatically send short phrases when the AI takes more than 300ms to respond, improving perceived responsiveness.

**Environment Variables:**
- `ACKNOWLEDGEMENT_ENABLED` - Enable/disable (default: `true`)
- `ACKNOWLEDGEMENT_DELAY_MS` - Delay before sending acknowledgement (default: `300`)
- `ACKNOWLEDGEMENT_PHRASES` - Comma-separated list of phrases (default: `okay`)

### Typing Sounds

Typing sounds play looping audio during AI processing to eliminate dead air.

**Environment Variables:**
- `TYPING_SOUND_ENABLED` - Enable/disable (default: `false`)
- `TYPING_SOUND_VOLUME` - Volume multiplier 0.0-1.0 (default: `0.3`)
- `TYPING_SOUND_LOOP_DURATION_MS` - Duration of one loop in ms (default: `2000`)

---

Built with love for the voice AI community