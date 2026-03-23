# vowel engine

> OpenAI-compatible real-time voice API server with modular runtimes and flexible LLM providers

A production-ready real-time voice API server that implements the OpenAI Realtime API protocol, compatible with the [OpenAI Agents JS SDK](https://openai.github.io/openai-agents-js/guides/voice-agents/quickstart/). The shared engine logic lives in `src/`, while deployment-specific and proprietary integrations are being pulled into packages under `packages/`.

## 🆕 What's New

**Modular Agent System** (Nov 2025)
- 🏗️ **Flexible Architecture:** Swap between different AI agent implementations
- 🔧 **Two Agent Types:** VercelSDKAgent (battle-tested) or CustomAgent (full control)
- 📚 **ConversationSummarizer:** Handle very long conversations (hours) with async LLM-based summarization
- 🎯 **Feature Flag:** Enable via `USE_MODULAR_AGENTS=true` (backward compatible)

See [docs/MODULAR_AGENTS_CONFIGURATION.md](./docs/MODULAR_AGENTS_CONFIGURATION.md) for details.

**OpenRouter Integration & Test Mode** (Nov 2025)
- 🎯 **Choose Your Model:** Use Groq (fast) OR OpenRouter (Claude 3.5, GPT-4, Llama, 100+ models)
- 🧪 **Test Mode:** Disable billing/metering for development
- ⚙️ **Simple Setup:** Just set `LLM_PROVIDER=openrouter` and you're good to go!

See [OPENROUTER_QUICKSTART.md](./OPENROUTER_QUICKSTART.md) for details.

## 🚀 Quick Start

**Want to use the hosted server?** See the [QUICKSTART.md](./QUICKSTART.md) guide.

**Want to try a demo?** Check out the [demo folder](./demo).

**Want to deploy your own?** See deployment instructions below.

**Status note:** vowel engine is currently being split into a shared `src/` engine plus self-host/open packages. The private Cloudflare runtime now lives in `engine-hosted`, and the remaining work is to finish unwinding older package and documentation assumptions.

## 📋 Overview

### What is vowel engine?

vowel engine is a WebSocket-based real-time voice API server that provides an OpenAI Realtime API compatible interface, allowing you to use the OpenAI Agents SDK with your own infrastructure. The current modular shape is:

- `src/` - shared engine logic, session handling, tools, agents, and provider contracts
- `packages/runtime-node` - self-hosted Bun/Node runtime
- `packages/provider-assemblyai-stt` - hosted AssemblyAI speech-to-text integration
- `packages/provider-inworld-tts` - hosted Inworld text-to-speech integration

It combines:

- **Flexible LLM Providers:**
  - **Groq** (default) - Moonshot Kimi K2 at 500+ tokens/sec via Groq LPU
  - **OpenRouter** (new!) - Claude 3.5, GPT-4, Llama 3.1, and 100+ other models
- **Groq Whisper Large V3** - State-of-the-art speech-to-text
- **Inworld TTS** - High-quality cloud text-to-speech synthesis
- **WebSocket Transport** - Universal compatibility (browser, Node.js, CLI)
- **Test Mode** - Disable billing/metering for development

### Why vowel engine?

- ✅ **OpenAI SDK Compatible** - Drop-in compatible with OpenAI Agents JS SDK
- ⚡ **Blazing Fast** - 500+ tokens/sec via Groq's LPU infrastructure
- 🔀 **Flexible LLM Choice** - Use Groq, OpenRouter (Claude/GPT-4/Llama), or switch anytime
- 🔓 **Open Source Models** - Supports open models (Llama, Mistral, etc.)
- 💰 **Cost Effective** - Lower costs than proprietary alternatives
- 🎯 **Full Control** - Host your own server, customize everything
- 🔒 **Privacy** - Local TTS, configurable data handling
- 🌐 **Universal** - Works in browser, Node.js, mobile apps
- 🧪 **Test Mode** - Develop without billing/metering concerns

## 🏗️ Architecture

```
┌─────────────┐                    ┌──────────────────────────┐
│   Browser   │ ◄─── WebSocket ───►│   Runtime Package        │
│   Client    │    (Ephemeral      │  Bun or Cloudflare       │
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
                   │ AssemblyAI│           │ Groq /     │           │  Inworld    │
                   │   STT     │           │ OpenRouter │           │    TTS      │
                   │(Streaming)│           │    LLM     │           │   (Cloud)   │
                   └───────────┘           └────────────┘           └────────────┘
```

## ⚡ Features

### Core Features
- ✅ Full OpenAI Realtime API protocol compliance
- ✅ WebSocket-based bidirectional streaming
- ✅ Ephemeral token authentication (5-minute expiration)
- ✅ Audio input/output streaming (PCM16, 24kHz, mono)
- ✅ Real-time transcription via Groq Whisper
- ✅ Streaming LLM responses via Groq GPT-OSS 120B
- ✅ Cloud TTS synthesis via Inworld
- ✅ Session management and configuration
- ✅ Conversation history tracking
- ✅ Comprehensive error handling
- ✅ **Acknowledgement Responses** - Automatic "okay" responses after 300ms delay for better perceived responsiveness
- ✅ **Typing Sounds** - Optional looping typing sounds during processing to eliminate dead air

### Differences from OpenAI's API

| Feature | OpenAI Realtime API | vowel engine |
|---------|---------------------|--------|
| **Model** | `gpt-4o-realtime-preview-2024-10-01` | `moonshotai/kimi-k2-instruct-0905` |
| **Voices** | `alloy`, `echo`, `ash`, etc. | `Ashley`, `Brian`, etc. (Inworld voices) |
| **Transport** | WebRTC + WebSocket | WebSocket only |
| **TTS** | Remote API | Inworld TTS (cloud) |
| **Provider** | OpenAI proprietary | Groq + Local |
| **Speed** | ~100-200 tps | ~500 tps |
| **Cost** | Higher | Lower |
| **License** | Proprietary | Apache 2.0 (model) |

## 🎯 Use Cases

- **Voice Assistants** - Build conversational AI for web/mobile apps
- **Phone Agents** - Customer support, IVR systems
- **Interactive Tutorials** - Voice-guided learning experiences
- **Accessibility Tools** - Voice interfaces for applications
- **Gaming NPCs** - Real-time voice character interactions
- **Voice Bots** - Discord, Telegram, custom platforms

## 🔧 API Reference

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

## 📦 Usage Example

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

## 🎤 Available Voices

Default voice: `Ashley`

Additional Inworld voices can be configured via the Inworld API. See [Inworld documentation](https://docs.inworld.ai) for available voices.

## 🔒 Security

### Authentication Flow

```
1. User requests voice session
        ↓
2. Your backend authenticates user
        ↓
3. Backend requests ephemeral token from your engine server
   (using SERVER_API_KEY)
        ↓
4. Backend returns ephemeral token to frontend
        ↓
5. Frontend connects to WebSocket with ephemeral token
        ↓
6. Voice session begins (5-minute token lifetime)
```

### Best Practices

- ✅ Never expose `SERVER_API_KEY` in frontend code
- ✅ Always generate ephemeral tokens from your backend
- ✅ Implement rate limiting on token generation
- ✅ Use HTTPS/WSS for all connections
- ✅ Implement user authentication before token generation
- ✅ Monitor usage and set quotas

## 🚀 Deployment

### Hosted Version

The server can be hosted on any infrastructure:
- **Domain**: `your-engine.example.com` (configure your own)
- **Protocol**: WSS (secure WebSocket)

### Self-Hosting

Self-hosting is the direction of the runtime split. The intended model is:

- Shared `src/` engine plus Bun/Node runtime for self-hosted deployments
- Private `engine-hosted` runtime package plus hosted provider packages for the proprietary deployment path

For the current hosted Cloudflare deployment path, use the private `engine-hosted`
wrapper repo. The Cloudflare runtime code now lives there, while this repo keeps
the shared engine logic and self-hosted/runtime-neutral packages.

For local stack planning with Core plus vowel engine, see the [self-hosted deployment guide](./wiki/docs/deployment/).

**Requirements:**
- Runtime-specific requirements depend on the adapter you deploy
- API keys:
  - Groq API key (for LLM) OR OpenRouter API key
  - AssemblyAI API key (for STT)
  - Inworld API key (for TTS)
  - JWT_SECRET (32+ characters)
  - API_KEY (for token generation)

## 📚 Documentation

- **[QUICKSTART.md](./QUICKSTART.md)** - Get started in minutes
- **[demo/](./demo)** - Working vanilla JavaScript example
- **`engine-hosted`** - Private Cloudflare deployment wrapper for the hosted product
- **[packages/runtime-node](./packages/runtime-node)** - Self-hosted Bun/Node runtime package
- **`engine-hosted/packages/runtime-cloudflare`** - Private Cloudflare runtime package
- **[MIGRATION_TO_WORKERS_ONLY.md](./MIGRATION_TO_WORKERS_ONLY.md)** - Migration documentation

## 🛠️ Tech Stack

- **Core Runtime Model**: Shared `src/` engine with pluggable runtime packages
- **Node Runtime**: Bun/Node for self-hosted deployments
- **Cloudflare Runtime**: Private `engine-hosted` Workers + Durable Objects for the hosted/proprietary path
- **LLM Provider**: [Groq](https://console.groq.com) OR [OpenRouter](https://openrouter.ai) - Ultra-fast AI inference
- **Model**: Moonshot Kimi K2 (default) OR 100+ models via OpenRouter
- **STT**: [AssemblyAI](https://www.assemblyai.com) (default) - Streaming speech-to-text
- **TTS**: [Inworld](https://www.inworld.ai) - Cloud text-to-speech
- **AI SDK**: [Vercel AI SDK](https://sdk.vercel.ai) - LLM integration
- **Auth**: [jose](https://github.com/panva/jose) - JWT tokens

## 🤝 Contributing

Contributions are welcome! This project is in active development.

## 📝 License

This project is open source. See individual components for their licenses:
- OpenAI GPT-OSS 120B: [Apache 2.0](https://openai.com/index/introducing-gpt-oss/)

## 🔗 Links

- [OpenAI Agents JS SDK](https://openai.github.io/openai-agents-js)
- [Groq Console](https://console.groq.com)
- [Moonshot Kimi K2 Instruct 0905](https://platform.moonshot.cn/docs/intro)
- [Inworld AI](https://www.inworld.ai)

## 🎵 Audio Assets & Credits

### Typing Sounds

The typing sound feature uses Creative Commons licensed audio:

- **"quiet typing on laptop computer"** by [lmz36](https://freesound.org/people/lmz36/)
  - License: [CC0 (Public Domain)](https://freesound.org/people/lmz36/sounds/721033/)
  - Source: [Freesound.org](https://freesound.org/people/lmz36/sounds/721033/)
  - No attribution required

- **"Typing"** by [L.i.Z.e.L.l.E_+](https://freesound.org/people/L.i.Z.e.L.l.E_%2B/)
  - License: [CC0 (Public Domain)](https://freesound.org/people/L.i.Z.e.L.l.E_%2B/sounds/707731/)
  - Source: [Freesound.org](https://freesound.org/people/L.i.Z.e.L.l.E_%2B/sounds/707731/)
  - No attribution required

These sounds are used to provide audio feedback during AI processing to improve perceived responsiveness.

## ⚙️ Configuration

### Acknowledgement Responses

Acknowledgement responses automatically send short phrases (like "okay") when the AI takes more than 300ms to respond, improving perceived responsiveness.

**Environment Variables:**
- `ACKNOWLEDGEMENT_ENABLED` - Enable/disable (default: `true`)
- `ACKNOWLEDGEMENT_DELAY_MS` - Delay before sending acknowledgement (default: `300`)
- `ACKNOWLEDGEMENT_PHRASES` - Comma-separated list of phrases (default: `okay`)
- `ACKNOWLEDGEMENT_CACHE_R2` - R2 bucket binding for caching audio (optional)

**Token Configuration:**
```json
{
  "acknowledgementEnabled": true,
  "acknowledgementDelayMs": 300,
  "acknowledgementPhrases": ["okay", "let me check on that"]
}
```

### Typing Sounds

Typing sounds play looping audio during AI processing to eliminate dead air.

**Environment Variables:**
- `TYPING_SOUND_ENABLED` - Enable/disable (default: `false`)
- `TYPING_SOUND_R2_BUCKET` - R2 bucket binding containing typing sound file
- `TYPING_SOUND_R2_KEY` - R2 key for typing sound file (default: `typing-sound.pcm`)
- `TYPING_SOUND_VOLUME` - Volume multiplier 0.0-1.0 (default: `0.3`)
- `TYPING_SOUND_LOOP_DURATION_MS` - Duration of one loop in ms (default: `2000`)

**Token Configuration:**
```json
{
  "typingSoundEnabled": true,
  "typingSoundVolume": 0.3,
  "typingSoundLoopDurationMs": 2000
}
```

**Setup:**
1. Download a Creative Commons typing sound (see credits above)
2. Convert to PCM16, 24kHz, mono format
3. Upload to R2 bucket configured in `TYPING_SOUND_R2_BUCKET`
4. Set `TYPING_SOUND_ENABLED=true` or enable via token

## ⚠️ POC Status

This is currently a **proof of concept**. Production features not yet implemented:

- ❌ Server-side VAD (voice activity detection)
- ❌ Function/tool calling
- ❌ Rate limiting
- ❌ Analytics and observability
- ❌ Multi-tenancy
- ❌ Conversation persistence

See the [implementation plan](./.ai/plans/real-time-server/POC-Implementation-Plan.md) for the roadmap to production readiness.

---

**Built with ❤️ for the voice AI community**
