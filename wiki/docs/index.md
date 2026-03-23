# sndbrd

Real-time voice AI engine with OpenAI-compatible WebSocket protocol.

---

## Features

- 🚀 **Real-time Voice AI** - Sub-second latency for natural conversations
- 🌍 **Edge Computing** - Deployed on 300+ Cloudflare locations worldwide
- 🔌 **OpenAI Compatible** - Drop-in replacement for OpenAI Realtime API
- 🧩 **Modular Architecture** - Swap LLM, STT, TTS, and VAD providers
- 🔐 **Secure by Default** - Ephemeral tokens, JWT authentication, scoped API keys
- 🎤 **Voice Activity Detection** - Intelligent speech detection with configurable sensitivity
- 🛠️ **Tool Calling** - Automatic tool call repair and execution support

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/your-org/sndbrd.git
cd sndbrd
bun install
```

### 2. Configure

Create a `.env` file:

```bash
API_KEY="your-server-api-key"
JWT_SECRET="your-secure-random-min-32-chars"
GROQ_API_KEY="gsk_..."
```

### 3. Start

```bash
bun run dev
```

Server runs at `http://localhost:8787`.

---

## Documentation

### 📚 Getting Started

:::tip New to sndbrd? Start here!
- [Quick Start Guide](/getting-started) - 5-minute setup guide
- [Tutorial: Voice Agent](/tutorials/voice-agent) - Build your first voice agent
- [Common Issues](/troubleshooting) - Solutions to frequent problems

### 🏗️ Architecture

- [Architecture Overview](/architecture/overview) - System design and components
- [Request Flow](/architecture/request-flow) - How data flows through system
- [Component Details](/architecture/components) - Implementation details
- [Connection Paradigms](/architecture/connection-paradigms) - Advanced integration patterns

### 🔌 API Reference

- [WebSocket Protocol](/api/websocket) - Connection and event reference
- [Authentication](/api/authentication) - Token generation and validation
- [Events Reference](/api/events) - All WebSocket events

### ⚙️ Providers

- [Speech-to-Text](/providers/stt) - Groq Whisper, AssemblyAI, Fennec
- [Text-to-Speech](/providers/tts) - Inworld TTS configuration
- [LLM](/providers/llm) - Groq, OpenRouter, and models
- [Voice Activity Detection](/providers/vad) - VAD configuration

### 🚀 Deployment

- [Cloudflare Workers](/deployment/cloudflare) - Production deployment guide
- [Environment Variables](/deployment/env-vars) - Configuration reference
- [Local Development](/deployment/local-dev) - Development setup

### 📖 Guides

- [Error Handling](/guides/error-handling) - Graceful error management
- [Performance](/guides/performance) - Optimization strategies
- [Security](/guides/security) - Security best practices
- [Analytics](/guides/analytics) - PostHog event tracking and analytics

---

## Tech Stack

```
┌─────────────────────────────────────────────────┐
│                 Cloudflare Workers                 │
│                 (Global Edge Network)                 │
└──────────────────────┬──────────────────────────────┘
                       │
     ┌─────────────────┼─────────────────┐
     │                 │                 │
┌───▼──┐        ┌───▼──┐        ┌───▼──┐
│ Durable│        │  LLM   │        │  STT   │
│ Object │        │ Service │        │ Service │
└───┬──┘        └───┬──┘        └───┬──┘
    │                 │                 │
    └─────────────────┴─────────────────┘
                       │
          ┌────────▼────────┐
          │  Session        │
          │  Handler       │
          └────────┬────────┘
                   │
          ┌────────▼───────┐
          │  TTS   │  VAD │
          └─────────┴───────┘
```

**Runtime:** Cloudflare Workers (Edge)
**State:** Durable Objects
**Auth:** JWT (jose)
**WebSocket:** Native Workers API
**LLM:** Groq / OpenRouter (500+ tok/s)
**STT:** AssemblyAI / Groq Whisper / Fennec
**TTS:** Inworld

---

## Use Cases

### Voice Assistants

Build intelligent voice assistants for:
- Customer support
- Information retrieval
- Task automation
- Personal productivity

### Interactive Applications

Add voice to:
- Games
- Educational platforms
- Accessibility features
- Smart home control

### Enterprise Integration

- Call center automation
- Meeting transcription
- Voice-enabled workflows
- Internal tools

---

## Performance

| Metric | Value |
|---------|--------|
| **TTFS** | < 500ms |
| **Latency** | < 1s |
| **First Token Time** | < 300ms |
| **TTS Latency** | < 200ms |
| **WebSocket Ping** | < 50ms |
| **Audio Quality** | 24kHz PCM16 |
| **Uptime** | 99.9% |
| **Edge Locations** | 300+ |
| **Throughput** | 500+ tokens/s |

---

## Community & Support

- 📖 [Documentation](/) - Comprehensive guides and API reference
- 💻 [GitHub](https://github.com/your-org/sndbrd) - Source code and issues
- 🐛 [Report Issues](https://github.com/your-org/sndbrd/issues) - Bug reports and feature requests
- 📧 [Discord](https://discord.gg) - Community discussion (optional)
- 🐦 [Twitter](https://twitter.com) - Updates and announcements (optional)

---

## License

MIT License - Open source, free to use in commercial and personal projects.

---

**Built with ❤️ for the voice AI community**
