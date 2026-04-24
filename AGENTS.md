# AGENTS.md

## Project Overview

**vowel engine** is a production-ready real-time voice API server that implements the OpenAI Realtime API protocol. It provides an OpenAI-compatible WebSocket-based interface for building voice agents using open-source models.

**Tech Stack:**
- **Runtime:** Node.js / Bun
- **LLM:** Groq (500+ tokens/sec) OR OpenRouter (Claude, GPT-4, Llama, 100+ models)
- **STT:** Modular provider system (Groq Whisper, Deepgram)
- **TTS:** Modular provider system (Deepgram)
- **VAD:** Modular provider system (Silero)
- **WebSocket:** Native WebSocket API
- **AI SDK:** Vercel AI SDK (LLM integration)
- **Auth:** jose (JWT tokens)

**Key Features:**
- OpenAI Realtime API protocol compliance
- Ephemeral token authentication (5-minute expiration)
- Bidirectional audio streaming (PCM16, 24kHz, mono)
- Modular provider system - swap STT/TTS/VAD/LLM via configuration
- OpenRouter LLM support - use Claude, GPT-4, Llama, or 100+ other models
- Server-side Voice Activity Detection (VAD)
- Tool/function calling support with automatic repair for malformed tool calls
- Subagent mode - delegate tasks to specialized subagents
- Language switching - dynamic language detection and switching
- Conversation history management with summarization

---

## Development Commands

### Setup
```bash
# Install dependencies
bun install

# Setup and validate environment
bun run setup

# Download VAD model
bun run download-vad
```

### Running the Server
```bash
# Development mode (local testing)
bun run dev

# Build for production
bun run build

# Start production server
bun run start
```

### Testing
```bash
# Connection test (WebSocket client)
bun run test:connection

# Browser connection test
bun run test:browser

# Playwright E2E tests
bun run test:playwright

# JWT token decoding test
bun run test:token
```

### Documentation Wiki
```bash
cd wiki

# Install dependencies
bun install

# Start local wiki server
bun run dev

# Build static wiki
bun run build

# Preview built wiki
bun run preview
```

The wiki is located in the `wiki/` subfolder and is built with VitePress. Access documentation at:
- Local: http://localhost:5173 (when running `bun run dev` from wiki directory)

---

## Project Structure

```
engine/
├── wiki/                      # VitePress documentation wiki
│   ├── docs/                  # Documentation pages
│   └── .vitepress/            # VitePress config
├── src/
│   ├── auth/
│   │   ├── token-generator.ts # JWT ephemeral token generation/verification
│   │   ├── tokens.ts          # Token utilities
│   │   └── white-label.ts     # White-label configuration
│   ├── config/
│   │   ├── env.ts             # Environment configuration and validation
│   │   ├── providers.ts       # Provider configurations
│   │   ├── RuntimeConfig.ts   # Runtime configuration types
│   │   └── loaders/           # Config loaders
│   ├── lib/
│   │   ├── protocol.ts        # OpenAI Realtime API protocol types
│   │   ├── audio.ts           # Audio format conversion utilities
│   │   ├── text-chunking.ts   # Text chunking for TTS synthesis
│   │   ├── vowel-to-openai-schema.ts  # Tool schema conversion
│   │   ├── client-tool-proxy.ts       # Client tool proxy
│   │   ├── server-tool-registry.ts    # Server tool registry
│   │   ├── tool-repairer.ts           # Tool call repair
│   │   ├── instruction-generator.ts   # Instruction generation
│   │   ├── conversation-summarizer.ts # Conversation summarization
│   │   ├── server-tools/              # Server-side tools
│   │   └── tools/                     # Tool utilities
│   ├── services/
│   │   ├── llm.ts             # LLM streaming (Groq/OpenRouter)
│   │   ├── agent-provider.ts  # Agent provider (Vercel AI SDK)
│   │   ├── transcription.ts   # Speech-to-text services
│   │   ├── vad.ts             # Voice activity detection
│   │   ├── agents/            # Agent implementations
│   │   └── providers/         # Provider implementations
│   ├── session/
│   │   ├── handler.ts         # WebSocket message handler & session logic
│   │   ├── SessionManager.ts  # Session lifecycle management
│   │   ├── types.ts           # Session types
│   │   ├── handlers/          # Session event handlers
│   │   └── utils/             # Session utilities
│   └── events/                # Event system
├── packages/
│   ├── runtime-node/          # Node/Bun runtime
│   ├── provider-*/            # Provider packages (STT, TTS, VAD)
│   └── tester/                # Testing utilities
├── engine-config/             # Runtime configuration presets
├── demo/                      # Demo app using OpenAI Agents SDK
├── test/                      # Tests and test fixtures
├── scripts/                   # Build and utility scripts
├── package.json               # Project dependencies
└── tsconfig.json              # TypeScript configuration
```

---

## Provider System

**vowel engine** features a modular provider architecture that allows you to swap STT, TTS, and VAD components via configuration.

### Supported Providers

**Speech-to-Text (STT):**
- `groq-whisper` - Groq Whisper Large V3 (batch mode, high quality)

**Text-to-Speech (TTS):**
- Configurable via modular provider system

**Voice Activity Detection (VAD):**
- `silero` - Silero VAD (local, standalone)
- `none` - Disable VAD

### VAD Provider Mode

**VAD_PROVIDER_MODE** - Selects the ONNX Runtime backend:
- `node` (default): Uses onnxruntime-node (Node.js/Bun runtime, supports GPU acceleration)
- `wasm`: Uses onnxruntime-web (WASM for Cloudflare Workers deployment)

### Configuration Examples

**Default (Groq + Silero Node.js):**
```bash
LLM_PROVIDER=groq
STT_PROVIDER=groq-whisper
VAD_PROVIDER=silero
VAD_PROVIDER_MODE=node  # Default
```

**Cloudflare Workers (WASM mode):**
```bash
LLM_PROVIDER=groq
STT_PROVIDER=groq-whisper
VAD_PROVIDER=silero
VAD_PROVIDER_MODE=wasm  # For Cloudflare Workers
SILERO_VAD_MODEL_PATH=models/silero-vad/silero_vad.onnx  # R2/Static Assets path
```

**OpenRouter:**
```bash
LLM_PROVIDER=openrouter
STT_PROVIDER=groq-whisper
VAD_PROVIDER=silero
```

---

## Environment Variables

### Required Variables

```bash
# API Key for token issuance (used by clients to generate ephemeral tokens)
API_KEY="your-server-api-key"

# JWT secret for ephemeral token generation (minimum 32 characters)
JWT_SECRET="your-secure-random-string-min-32-chars"

# LLM API key
# Choose one based on LLM_PROVIDER:
GROQ_API_KEY="gsk_..."              # If LLM_PROVIDER=groq (default)
# OR
OPENROUTER_API_KEY="sk-or-v1-..."  # If LLM_PROVIDER=openrouter
```

### LLM Provider Configuration

```bash
# LLM Provider: 'groq' (default) or 'openrouter'
LLM_PROVIDER="groq"

# --- Groq Configuration (when LLM_PROVIDER=groq) ---
GROQ_API_KEY="gsk_..."
GROQ_MODEL="moonshotai/kimi-k2-instruct-0905"  # Default model

# --- OpenRouter Configuration (when LLM_PROVIDER=openrouter) ---
OPENROUTER_API_KEY="sk-or-v1-..."
OPENROUTER_MODEL="anthropic/claude-3-5-sonnet"  # Default model
```

### Optional Variables

```bash
# Server Configuration
PORT="3001"                              # Server port (default: 3001)
NODE_ENV="development"                   # Environment (development/production)

# Voice Configuration
DEFAULT_VOICE="Ashley"  # Default TTS voice

# Voice Activity Detection (VAD)
VAD_ENABLED="true"                       # Enable server-side VAD (default: true)
VAD_THRESHOLD="0.5"                      # VAD sensitivity (0.0-1.0, default: 0.5)
VAD_MIN_SILENCE_MS="550"                 # Minimum silence duration (default: 550ms)
VAD_SPEECH_PAD_MS="0"                    # Speech padding (default: 0ms)

# LLM Model Parameters (defaults for repetition control)
DEFAULT_TEMPERATURE="0.7"                # Temperature (0.0-2.0, undefined = provider default)
DEFAULT_FREQUENCY_PENALTY="0.5"          # Frequency penalty (0.0-2.0, reduces repetition)
DEFAULT_PRESENCE_PENALTY="0.3"           # Presence penalty (0.0-2.0, reduces repetition)
```

### Setup

1. Copy `.env.example` to `.env`
2. Set all required variables
3. Run `bun run setup` to validate configuration

---

## Architecture

### Request Flow

```
1. Client requests ephemeral token
   → POST /v1/realtime/sessions (with SERVER API_KEY)
   → Returns 5-minute JWT token

2. Client connects via WebSocket
   → WS /v1/realtime?model=moonshotai/kimi-k2-instruct-0905
   → Authenticates with ephemeral token
   → Server sends session.created event

3. Audio streaming begins
   → Client sends input_audio_buffer.append events
   → Server runs VAD on audio stream
   → When speech ends, server:
     a) Transcribes audio via STT provider
     b) Sends to LLM (Groq/OpenRouter)
     c) Streams text deltas back to client
     d) Synthesizes speech via TTS provider
     e) Streams audio chunks to client
```

### Key Components

**Authentication (`src/auth/token-generator.ts`)**
- Generates JWT ephemeral tokens with 5-minute expiration
- Verifies tokens on WebSocket upgrade
- Tokens prefixed with `ek_` for easy identification

**Session Handler (`src/session/handler.ts`)**
- Main WebSocket message router
- Handles all OpenAI Realtime API events
- Manages conversation history
- Coordinates VAD, STT, LLM, and TTS services

**LLM Service (`src/services/llm.ts`)**
- Streams responses from Groq/OpenRouter
- Uses Vercel AI SDK for streaming
- Supports tool calling

**Agent Provider (`src/services/agent-provider.ts`)**
- Vercel AI SDK Agent integration
- Supports subagent mode for task delegation

**Transcription Service (`src/services/transcription.ts`)**
- Converts audio to text via configured STT provider
- Handles PCM16 audio format

**VAD (Voice Activity Detection)**
- Standalone Silero VAD support
- Configurable threshold and silence duration

---

## Code Style and Conventions

### TypeScript Guidelines

- Strict Mode: All code uses TypeScript strict mode
- Module System: ESNext modules (import/export)
- Target: ESNext
- Type Safety: Prefer explicit types over any

### Code Organization

- Comments: All files have TSDoc header comments explaining purpose
- Exports: Named exports preferred over default exports
- Error Handling: Try-catch blocks with descriptive error messages
- Logging: Structured console logs with emoji prefixes

### Naming Conventions

- Files: kebab-case (tts-onnx.ts, voice-agent.tsx)
- Functions: camelCase (generateToken, handleMessage)
- Types/Interfaces: PascalCase (SessionData, LLMStreamOptions)
- Constants: UPPER_SNAKE_CASE (SUPPORTED_MODEL, DEFAULT_VOICE)

### Audio Format Standards

- Sample Rate: 24,000 Hz (24kHz)
- Format: PCM16 (16-bit signed little-endian)
- Channels: Mono (1 channel)
- Encoding: Base64 for transmission over WebSocket

---

## Testing

### Test Files

- `test/connection-test.ts` - Basic WebSocket connection test
- `test/browser-connection-test.ts` - Browser-based connection test
- `test/browser-realtime.spec.ts` - Playwright E2E test
- `src/lib/__tests__/vowel-to-openai-schema.test.ts` - Tool schema conversion tests

### Running Tests

```bash
# Unit/integration tests
bun run test:connection
bun run test:browser

# E2E tests (requires server running)
bun run test:playwright

# JWT token decoding test (validates token generation)
bun run test:token
```

### Manual Testing

The `demo/` folder contains a full React application for manual testing:

```bash
cd demo
bun install
bun run dev
```

---

## Security Considerations

### Authentication Flow

1. **Server API Key** - Required for generating ephemeral tokens
   - Never expose this in frontend code
   - Use environment variables only
   - Rotate periodically

2. **Ephemeral Tokens** - Short-lived client tokens
   - Generated server-side only
   - 5-minute expiration
   - Prefixed with `ek_` for identification
   - JWT-based with HMAC-SHA256 signing

3. **Token Transmission**
   - Supports multiple methods for compatibility:
     - Authorization header: Bearer ek_...
     - WebSocket subprotocol: openai-insecure-api-key.ek_...
     - Query parameter: ?token=ek_... (fallback only)

### Best Practices

- Always use HTTPS/WSS in production
- Validate all incoming messages
- Implement rate limiting on token generation
- Monitor usage and set quotas
- Keep dependencies updated
- Never commit .env files
- Never expose API_KEY or GROQ_API_KEY to clients

---

## Common Tasks

### Modifying System Instructions

Edit the system prompt in `src/config/env.ts`:

```typescript
export const DEFAULT_SYSTEM_PROMPT = `...`;
```

### Adding Tool Support

Tools are defined client-side using the OpenAI Agents SDK. Server-side:
1. Server receives tool definitions in session.update event
2. LLM can call tools during generation
3. Tool calls are streamed to client as response.function_call_arguments.* events
4. Client executes tools and sends results back
5. Server continues conversation with tool results

See `demo/WEATHER-TOOL-EXAMPLE.md` for a complete example.

### Debugging WebSocket Issues

1. Check server logs for connection attempts
2. Verify token is valid and not expired
3. Ensure WebSocket URL is correct: wss://host/v1/realtime
4. Check browser console for client-side errors
5. Use `test/connection-test.ts` to isolate server issues

---

## Additional Resources

- OpenAI Realtime API Docs: https://platform.openai.com/docs/guides/realtime-websocket
- OpenAI Agents JS SDK: https://openai.github.io/openai-agents-js
- Groq: https://console.groq.com
- OpenRouter: https://openrouter.ai
- Vercel AI SDK: https://sdk.vercel.ai

---

## Quick Reference

### Start Development
```bash
bun install
bun run setup
bun run dev
```

### Generate Token (for testing)
```bash
curl -X POST http://localhost:3001/v1/realtime/sessions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"moonshotai/kimi-k2-instruct-0905","voice":"Ashley"}'
```

### Connect via WebSocket
```bash
wscat -c "ws://localhost:3001/v1/realtime?model=moonshotai/kimi-k2-instruct-0905" \
  -H "Authorization: Bearer ek_..."
```

---

Last Updated: March 23, 2026
Repository: https://github.com/usevowel/engine