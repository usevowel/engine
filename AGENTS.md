# AGENTS.md

## Project Overview

**sndbrd** is a production-ready real-time voice API server that implements the OpenAI Realtime API protocol. It provides an OpenAI-compatible WebSocket-based interface for building voice agents using open-source models.

**Tech Stack:**
- **Runtime:** Cloudflare Workers (global edge network)
- **State Management:** Durable Objects (stateful WebSocket sessions)
- **LLM:** Groq (500+ tokens/sec) **OR** OpenRouter (Claude, GPT-4, Llama, 100+ models)
- **STT:** Modular (AssemblyAI, Groq Whisper, Fennec ASR)
- **TTS:** Modular (Inworld)
- **VAD:** Modular (integrated with STT providers)
- **WebSocket:** Native Cloudflare Workers WebSocket API
- **AI SDK:** Vercel AI SDK (LLM integration)
- **Auth:** jose (JWT tokens)

**Key Features:**
- OpenAI Realtime API protocol compliance
- Ephemeral token authentication (5-minute expiration)
- Bidirectional audio streaming (PCM16, 24kHz, mono)
- **Modular provider system** - swap STT/TTS/VAD/LLM via configuration
- **OpenRouter LLM support** - use Claude, GPT-4, Llama, or 100+ other models
- **Test mode** - disable billing/metering for development
- Server-side Voice Activity Detection (VAD)
- Tool/function calling support with **automatic repair** for malformed tool calls
- **Subagent mode** - delegate tasks to specialized subagents
- **Language switching** - dynamic language detection and switching
- Conversation history management with summarization
- **Agent analytics** - PostHog integration for LLM tracing

**Deployment:**
- **Production URL:** https://your-engine.example.com
- **Test/Development Tunnel:** https://localhost:8787/
- **Hosting:** Cloudflare Tunnel
- **Protocol:** WSS (secure WebSocket)

---

## Development Commands

### Setup
```bash
# Install dependencies
bun install

# Setup and validate environment
bun run setup

# Download voice models (optional)
bun run download-voice -- en_US-ryan-medium

# Download VAD model
bun run download-vad
```

### Running the Server
```bash
# Development mode (local testing with Wrangler)
bun run dev

# Build Workers bundle
bun run build

# Deploy to Cloudflare Workers
bun run deploy              # Deploy to staging (default)
bun run deploy:testing     # Deploy to testing environment
bun run deploy:dev         # Deploy to dev environment
bun run deploy:staging     # Deploy to staging environment
bun run deploy:production  # Deploy to production environment

# View logs
bun run tail                # Tail staging logs
bun run tail:testing        # Tail testing logs
bun run tail:production     # Tail production logs
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

### Cloudflare Tunnel (Local Development)
```bash
# Start Worker dev server with Cloudflare tunnel
./scripts/start-worker-tunnel.sh [environment]

# Examples:
./scripts/start-worker-tunnel.sh          # Uses testing environment
./scripts/start-worker-tunnel.sh dev      # Uses dev environment
./scripts/start-worker-tunnel.sh staging  # Uses staging environment
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
- Structure:
  - `/` - Homepage with quick links
  - `/getting-started` - Setup and quick start guides
  - `/tutorials/` - Step-by-step tutorials
  - `/architecture/` - Architecture docs with mermaid diagrams
  - `/api/` - API reference
  - `/providers/` - Provider configuration
  - `/deployment/` - Deployment guides
  - `/guides/` - In-depth guides (error handling, performance, security)
  - `/troubleshooting` - Common issues and solutions

---

## Project Structure

```
sndbrd/
├── wiki/                      # VitePress documentation wiki
│   ├── docs/                  # Documentation pages
│   │   ├── architecture/      # Architecture docs
│   │   ├── api/               # API reference
│   │   ├── providers/         # Provider docs
│   │   └── deployment/        # Deployment guides
│   └── .vitepress/            # VitePress config
├── src/
│   ├── workers/
│   │   ├── worker.ts          # Cloudflare Worker entry point
│   │   ├── durable-objects/
│   │   │   ├── RealtimeSession.ts     # Durable Object for WebSocket sessions
│   │   │   └── helpers/       # DO helper modules
│   │   │       ├── SessionStateManager.ts  # Session state persistence
│   │   │       ├── session.ts            # Session data management
│   │   │       ├── websocket.ts          # WebSocket utilities
│   │   │       ├── events.ts             # Event handling
│   │   │       ├── errors.ts             # Error handling
│   │   │       └── token.ts              # Token utilities
│   │   ├── lib/
│   │   │   ├── logger.ts     # Centralized logging
│   │   │   ├── config.ts     # Workers config helpers
│   │   │   └── usage-tracker.ts  # Usage tracking
│   │   └── polyfills/
│   │       └── ws-polyfill.ts # WebSocket polyfill for AssemblyAI SDK
│   ├── config/
│   │   ├── env.ts             # Environment configuration and validation
│   │   ├── providers.ts       # Provider configurations
│   │   ├── RuntimeConfig.ts   # Runtime configuration types
│   │   ├── provider-costs.ts  # Provider cost tracking
│   │   └── loaders/
│   │       └── WorkersConfigLoader.ts  # Workers config loader
│   ├── auth/
│   │   ├── token-generator.ts # JWT ephemeral token generation/verification
│   │   ├── tokens.ts          # Token utilities
│   │   └── white-label.ts     # White-label configuration
│   ├── lib/
│   │   ├── protocol.ts        # OpenAI Realtime API protocol types
│   │   ├── audio.ts           # Audio format conversion utilities
│   │   ├── text-chunking.ts   # Text chunking for TTS synthesis
│   │   ├── vowel-to-openai-schema.ts  # Tool schema conversion
│   │   ├── client-tool-proxy.ts       # Client tool proxy
│   │   ├── server-tool-registry.ts    # Server tool registry
│   │   ├── tool-repairer.ts           # Tool call repair
│   │   ├── instruction-generator.ts   # Instruction generation
│   │   ├── instruction-parser.ts      # Instruction parsing
│   │   ├── conversation-summarizer.ts # Conversation summarization
│   │   ├── json-schema-to-zod.ts      # JSON Schema to Zod conversion
│   │   ├── dual-schema-generator.ts   # Dual schema generation
│   │   ├── voice-selector.ts          # Voice selection
│   │   ├── connection-paradigm.ts     # Connection paradigms
│   │   ├── preflight-checks.ts        # Preflight checks
│   │   ├── runtime.ts                 # Runtime utilities
│   │   ├── ai-utils.ts                # AI utilities
│   │   ├── text-utils.ts              # Text utilities
│   │   ├── logger.ts                  # Logger utilities
│   │   ├── server-tools/              # Server-side tools
│   │   │   ├── index.ts               # Server tools exports
│   │   │   ├── speak.ts               # Speak tool
│   │   │   ├── ask-subagent.ts        # Ask subagent tool
│   │   │   ├── set-language.ts        # Set language tool
│   │   │   └── switch-language.ts     # Switch language tool
│   │   ├── tools/                     # Tool utilities
│   │   │   ├── index.ts               # Tool exports
│   │   │   ├── types.ts               # Tool types
│   │   │   ├── tool-builder.ts        # Tool builder
│   │   │   ├── tool-call-emitter.ts   # Tool call emitter
│   │   │   ├── tool-result-handler.ts # Tool result handler
│   │   │   ├── tool-event-bus.ts      # Tool event bus
│   │   │   └── agent-event-subscriber.ts  # Agent event subscriber
│   │   └── agent-analytics/           # Agent analytics
│   │       ├── AgentAnalyticsService.ts
│   │       ├── model-wrapper.ts
│   │       ├── service-registry.ts
│   │       ├── types.ts
│   │       ├── utils.ts
│   │       └── index.ts
│   ├── services/
│   │   ├── llm.ts             # LLM streaming (Groq/OpenRouter)
│   │   ├── agent-provider.ts  # Agent provider (Vercel AI SDK)
│   │   ├── transcription.ts   # Speech-to-text services
│   │   ├── vad.ts             # Voice activity detection
│   │   ├── stt-pre-filter.ts  # STT pre-filtering
│   │   ├── acknowledgement/   # Acknowledgement service
│   │   ├── agents/            # Agent implementations
│   │   │   ├── AgentFactory.ts
│   │   │   ├── CustomAgent.ts
│   │   │   ├── components/    # Agent components
│   │   │   └── utils/         # Agent utilities
│   │   └── providers/         # Provider implementations
│   │       ├── stt/           # STT providers (AssemblyAI, Groq Whisper, Fennec)
│   │       └── tts/           # TTS providers (Inworld)
│   ├── session/
│   │   ├── handler.ts         # WebSocket message handler & session logic
│   │   ├── SessionManager.ts  # Session lifecycle management
│   │   ├── types.ts           # Session types
│   │   ├── handlers/          # Session event handlers
│   │   │   ├── index.ts
│   │   │   ├── audio.ts
│   │   │   ├── conversation.ts
│   │   │   ├── debug.ts
│   │   │   ├── response.ts
│   │   │   └── session-update.ts
│   │   ├── response/          # Response handling
│   │   ├── utils/             # Session utilities
│   │   └── vad/               # VAD processing
│   ├── billing/               # Billing and metering
│   │   ├── types.ts
│   │   ├── turn-tracker.ts
│   │   ├── turn-tracking-init.ts
│   │   ├── token-to-time.ts
│   │   └── event-emitter.ts
│   └── events/                # Event system
│       ├── index.ts
│       ├── types.ts
│       ├── event-emitter.ts
│       └── get-event-system.ts
├── scripts/
│   ├── build-worker.ts        # Workers build script (esbuild)
│   ├── setup.ts               # Environment setup script
│   ├── download-voice.ts      # Voice model downloader
│   ├── download-vad-model.sh  # VAD model downloader
│   └── start-worker-tunnel.sh # Cloudflare tunnel startup
├── demo/                      # Demo React app using OpenAI Agents SDK
│   ├── src/
│   │   ├── App.tsx            # Main demo application
│   │   └── components/        # Voice agent UI components
│   ├── generate-token.js      # Token generation utility
│   └── server.ts              # Demo server for token generation
├── test/                      # Tests and test fixtures
├── docs/                      # Additional documentation
├── package.json               # Project dependencies
├── wrangler.toml              # Cloudflare Workers configuration
├── tsconfig.json              # TypeScript configuration
└── playwright.config.ts       # Playwright test configuration
```

---

## Provider System

**sndbrd** features a modular provider architecture that allows you to swap STT, TTS, and VAD components via configuration.

### Supported Providers

**Speech-to-Text (STT):**
- `groq-whisper` - Groq Whisper Large V3 (batch mode, high quality)
- `fennec` - Fennec ASR (streaming, integrated VAD)
- `assemblyai` - AssemblyAI (streaming, integrated VAD, advanced features)

**Text-to-TTS (TTS):**
- `inworld` - Inworld TTS (cloud, high quality)

**Voice Activity Detection (VAD):**
- `silero` - Silero VAD (local, standalone)
- `fennec-integrated` - Integrated with Fennec ASR
- `assemblyai-integrated` - Integrated with AssemblyAI
- `none` - Disable VAD

### Configuration Examples

**Default (Groq + Inworld + Silero):**
```bash
STT_PROVIDER=groq-whisper
TTS_PROVIDER=inworld
VAD_PROVIDER=silero
```

**Fennec ASR + Inworld:**
```bash
STT_PROVIDER=fennec
TTS_PROVIDER=inworld
VAD_PROVIDER=fennec-integrated
```

**AssemblyAI + Inworld:**
```bash
STT_PROVIDER=assemblyai
TTS_PROVIDER=inworld
VAD_PROVIDER=assemblyai-integrated
```

See `docs/PROVIDER_CONFIG.md` for complete configuration reference.

---

## Environment Variables

### Required Variables

```bash
# API Key for token issuance (used by clients to generate ephemeral tokens)
API_KEY="your-server-api-key"

# JWT secret for ephemeral token generation (minimum 32 characters)
JWT_SECRET="your-secure-random-string-min-32-chars"

# LLM API key (required unless TEST_MODE=true)
# Choose one based on LLM_PROVIDER:
GROQ_API_KEY="gsk_..."              # If LLM_PROVIDER=groq (default)
# OR
OPENROUTER_API_KEY="sk-or-v1-..."  # If LLM_PROVIDER=openrouter
```

### LLM Provider Configuration (New!)

```bash
# LLM Provider: 'groq' (default) or 'openrouter'
LLM_PROVIDER="groq"

# --- Groq Configuration (when LLM_PROVIDER=groq) ---
GROQ_API_KEY="gsk_..."
GROQ_MODEL="moonshotai/kimi-k2-instruct-0905"  # Default model

# --- OpenRouter Configuration (when LLM_PROVIDER=openrouter) ---
OPENROUTER_API_KEY="sk-or-v1-..."
OPENROUTER_MODEL="anthropic/claude-3-5-sonnet"  # Default model
OPENROUTER_SITE_URL="https://yourdomain.com"   # Optional
OPENROUTER_APP_NAME="YourApp"                    # Optional
```

### Test Mode Configuration (New!)

```bash
# Enable test mode to disable billing/metering
# ⚠️  NEVER enable in production!
TEST_MODE="false"  # Default: false
```

### Optional Variables

```bash
# Server Configuration
PORT="3001"                              # Server port (default: 3001)
NODE_ENV="development"                   # Environment (development/production)

# Voice Configuration
INWORLD_VOICE="Ashley"  # Default TTS voice

# Voice Activity Detection (VAD)
VAD_ENABLED="true"                       # Enable server-side VAD (default: true)
VAD_THRESHOLD="0.5"                      # VAD sensitivity (0.0-1.0, default: 0.5)
VAD_MIN_SILENCE_MS="550"                 # Minimum silence duration (default: 550ms)
VAD_SPEECH_PAD_MS="0"                    # Speech padding (default: 0ms)

# LLM Model Parameters (defaults for repetition control)
# These can be overridden per-session via token configuration
DEFAULT_TEMPERATURE="0.7"                # Temperature (0.0-2.0, undefined = provider default)
DEFAULT_FREQUENCY_PENALTY="0.5"          # Frequency penalty (0.0-2.0, reduces repetition)
DEFAULT_PRESENCE_PENALTY="0.3"           # Presence penalty (0.0-2.0, reduces repetition)
```

### Quick Examples

**Default (Groq):**
```bash
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
```

**OpenRouter with Claude:**
```bash
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=anthropic/claude-3-5-sonnet
```

**Development with Test Mode:**
```bash
TEST_MODE=true
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
```

**See `OPENROUTER_QUICKSTART.md` and `docs/OPENROUTER_AND_TEST_MODE.md` for detailed guides.**

### Setup

1. Copy `.env.example` to `.env` (if it exists)
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
     a) Transcribes audio via Groq Whisper
     b) Sends to LLM (Groq GPT-OSS 120B)
     c) Streams text deltas back to client
     d) Synthesizes speech via Inworld TTS
     e) Streams audio chunks to client
```

### Key Components

**Authentication (`src/auth/token-generator.ts`)**
- Generates JWT ephemeral tokens with 5-minute expiration
- Verifies tokens on WebSocket upgrade
- Tokens prefixed with `ek_` for easy identification

**Worker Entry Point (`src/workers/worker.ts`)**
- Cloudflare Worker HTTP handler
- Handles token generation endpoint (`POST /v1/realtime/sessions`)
- Routes WebSocket upgrades to Durable Objects
- Manages CORS and health checks

**Durable Object (`src/workers/durable-objects/RealtimeSession.ts`)**
- Stateful WebSocket session handler
- Uses WebSocket Hibernation API for cost efficiency
- Manages session lifecycle and state
- Routes messages to session handler

**Session State Manager (`src/workers/durable-objects/helpers/SessionStateManager.ts`)**
- Manages session state persistence
- Handles Durable Object hibernation/restoration
- **Critical:** Prevents double conversion of tool schemas on restoration

**Session Handler (`src/session/handler.ts`)**
- Main WebSocket message router
- Handles all OpenAI Realtime API events:
  - `session.update` - Update session configuration
  - `input_audio_buffer.append` - Receive audio chunks
  - `input_audio_buffer.commit` - Process accumulated audio
  - `conversation.item.create` - Add messages to conversation
  - `response.create` - Generate AI response
  - `response.cancel` - Cancel in-progress response
- Manages conversation history
- Coordinates VAD, STT, LLM, and TTS services

**LLM Service (`src/services/llm.ts`)**
- Streams responses from Groq GPT-OSS 120B
- Uses Vercel AI SDK for streaming
- Supports tool calling (tools defined by client, executed client-side)
- Formats conversation history for LLM context

**Agent Provider (`src/services/agent-provider.ts`)**
- Vercel AI SDK Agent integration
- Supports subagent mode for task delegation
- Tool orchestration and execution
- PostHog LLM analytics integration

**Transcription Service (`src/services/transcription.ts`)**
- Converts audio to text via Groq Whisper Large V3
- Handles PCM16 audio format
- Returns transcription with confidence scores

**TTS Service (`src/services/providers/tts/InworldTTS.ts`)**
- Synthesizes speech using Inworld TTS API
- Outputs PCM16 audio at 24kHz mono
- Supports multiple Inworld voices

**VAD (Voice Activity Detection)**
- Integrated with STT providers (AssemblyAI, Fennec)
- Server-side VAD handled by provider SDKs
- Configurable threshold and silence duration
- Prevents mid-sentence cutoffs with speech padding

**Tool System**
- **Client Tool Proxy** (`src/lib/client-tool-proxy.ts`) - Proxy for client-side tools
- **Server Tool Registry** (`src/lib/server-tool-registry.ts`) - Registry for server-side tools
- **Tool Repairer** (`src/lib/tool-repairer.ts`) - Automatic repair for malformed tool calls
- **Tool Builder** (`src/lib/tools/tool-builder.ts`) - Build tools for agents

---

## Code Style and Conventions

### TypeScript Guidelines

- **Strict Mode:** All code uses TypeScript strict mode
- **Module System:** ESNext modules (`import`/`export`)
- **Target:** ESNext (compatible with Cloudflare Workers)
- **Type Safety:** Prefer explicit types over `any`

### Code Organization

- **Comments:** All files have TSDoc header comments explaining purpose
- **Exports:** Named exports preferred over default exports
- **Error Handling:** Try-catch blocks with descriptive error messages
- **Logging:** Structured console logs with emoji prefixes:
  - 🚀 Server startup
  - 🔌 WebSocket connections
  - 🎤 Audio/VAD events
  - 🤖 LLM operations
  - ✅ Success operations
  - ❌ Errors
  - ⚠️ Warnings

### Function Documentation

```typescript
/**
 * Brief function description
 * 
 * @param paramName - Parameter description
 * @returns Return value description
 */
```

### Naming Conventions

- **Files:** kebab-case (`tts-onnx.ts`, `voice-agent.tsx`)
- **Functions:** camelCase (`generateToken`, `handleMessage`)
- **Types/Interfaces:** PascalCase (`SessionData`, `LLMStreamOptions`)
- **Constants:** UPPER_SNAKE_CASE (`SUPPORTED_MODEL`, `DEFAULT_VOICE`)

### Audio Format Standards

- **Sample Rate:** 24,000 Hz (24kHz)
- **Format:** PCM16 (16-bit signed little-endian)
- **Channels:** Mono (1 channel)
- **Encoding:** Base64 for transmission over WebSocket

---

## Testing

### Test Files

- `test/connection-test.ts` - Basic WebSocket connection test
- `test/browser-connection-test.ts` - Browser-based connection test
- `test/browser-realtime.spec.ts` - Playwright E2E test
- `scripts/test-token-decoding.ts` - JWT token generation and decoding test
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
     - Authorization header: `Bearer ek_...`
     - WebSocket subprotocol: `openai-insecure-api-key.ek_...`
     - Query parameter: `?token=ek_...` (fallback only)

### Best Practices

- ✅ Always use HTTPS/WSS in production
- ✅ Validate all incoming messages
- ✅ Implement rate limiting on token generation
- ✅ Monitor usage and set quotas
- ✅ Keep dependencies updated
- ❌ Never commit `.env` files
- ❌ Never expose `API_KEY` or `GROQ_API_KEY` to clients

---

## Dependencies

### Production Dependencies

```json
{
  "@ai-sdk/groq": "2.0.29",              // Groq provider for Vercel AI SDK
  "@ai-sdk/cerebras": "^1.0.31",         // Cerebras provider
  "@openrouter/ai-sdk-provider": "1.2.2", // OpenRouter provider
  "ai": "^5.0.93",                       // Vercel AI SDK
  "assemblyai": "^4.19.0",               // AssemblyAI SDK (STT)
  "jose": "^5.2.0",                      // JWT token operations
  "wrangler": "^4.51.0",                 // Cloudflare Workers CLI
  "zod": "^4.1.12"                       // Schema validation
}
```

### Development Dependencies

```json
{
  "@cloudflare/workers-types": "^4.20241127.0", // Workers type definitions
  "@openai/agents": "^0.3.0",                    // OpenAI Agents SDK (for demo)
  "@playwright/test": "^1.56.1",                // E2E testing
  "@types/node": "^20.0.0",                     // Node type definitions
  "esbuild": "^0.27.0",                          // Build tool for Workers
  "ws": "^8.18.3"                                // WebSocket client (for tests)
}
```


---

## Build and Deployment

### Building for Production

```bash
# Build Workers bundle (outputs to dist/worker.js)
bun run build

# The build uses esbuild to bundle the worker
# Output is optimized for Cloudflare Workers runtime
```

### Deployment Methods

**1. Cloudflare Workers (Primary)**
- Install Wrangler CLI: `bun install -g wrangler` (or use `bunx wrangler`)
- Authenticate: `wrangler login`
- Set secrets: `wrangler secret put <NAME> --env <environment>`
- Deploy: `bun run deploy:production`
- See [workers/README.md](./workers/README.md) for detailed setup

**2. Local Development with Tunnel**
- Install `cloudflared`: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/
- Run: `./scripts/start-worker-tunnel.sh [environment]`
- This starts Wrangler dev server + Cloudflare tunnel
- Production tunnel: https://your-engine.example.com

### Production Checklist

- [ ] Set `NODE_ENV=production` in `wrangler.toml`
- [ ] Configure secure `JWT_SECRET` (32+ characters) via `wrangler secret put`
- [ ] Set production `API_KEY` via `wrangler secret put`
- [ ] Provide valid LLM API key (`GROQ_API_KEY` or `OPENROUTER_API_KEY`)
- [ ] Provide valid `ASSEMBLYAI_API_KEY` (for STT)
- [ ] Provide valid `INWORLD_API_KEY` (for TTS)
- [ ] Configure provider settings in `wrangler.toml`
- [ ] Deploy to Cloudflare Workers: `bun run deploy:production`
- [ ] Verify deployment: `wrangler tail --env production`
- [ ] Set up monitoring via Cloudflare Dashboard
- [ ] Configure custom domain (optional)

---

## Common Tasks

### Adding a New Voice

```bash
# Option 1: Use download script
bun run download-voice -- en_US-ryan-medium

```

### Modifying System Instructions

Edit the system prompt in `src/config/env.ts`:

```typescript
export const DEFAULT_SYSTEM_PROMPT = `...`;
```

The default prompt is optimized for voice conversations (no markdown, concise responses, natural speech patterns).

### Adding Tool Support

Tools are defined client-side using the OpenAI Agents SDK. Server-side:
1. Server receives tool definitions in `session.update` event
2. LLM can call tools during generation
3. Tool calls are streamed to client as `response.function_call_arguments.*` events
4. Client executes tools and sends results back
5. Server continues conversation with tool results

See `demo/WEATHER-TOOL-EXAMPLE.md` for a complete example.

### Debugging WebSocket Issues

1. Check server logs for connection attempts
2. Verify token is valid and not expired
3. Ensure WebSocket URL is correct: `wss://host/v1/realtime`
4. Check browser console for client-side errors
5. Use `test/connection-test.ts` to isolate server issues

### Performance Tuning

**VAD Settings** (`src/config/env.ts`):
- `VAD_THRESHOLD`: Lower = more sensitive (0.3-0.7 recommended)
- `VAD_MIN_SILENCE_MS`: Longer = fewer false positives
- `VAD_SPEECH_PAD_MS`: Add padding to prevent cutoffs

**LLM Settings**:
- Adjust `max_response_output_tokens` in session config
- Modify system prompt for shorter/longer responses
- **Context Window Management**: Token-based context truncation (default: 12,000 max, 6,000 min tokens)
  - **Real-world usage example**: 10-minute customer support session with 15 messages used ~8,911 tokens (74% of max)
  - Average: ~594 tokens per message
  - Defaults are optimized for typical voice conversations (10-30 minutes)
  - For longer sessions, consider enabling conversation summarization strategy
- **Reasoning Optimization**: Configurable reasoning effort for GROQ models (see `docs/REASONING_EFFORT_OPTIMIZATION.md`)
  - **Groq models** (reasoning is fast enough, so enabled by default):
    - GPT-OSS models: Supports `reasoning_effort: "low"`, `"medium"`, or `"high"` (default: `"medium"` for better reasoning quality)
    - Qwen models: Supports `reasoning_effort: "none"` or `"default"` (default: `"default"` to enable reasoning)
    - Other Groq models: Default to `"low"` if they support reasoning effort
  - **Other providers** (reasoning adds latency, so disabled by default):
    - OpenAI/OpenRouter: Default to `"none"` (lowest latency)
    - Anthropic/xAI: Default to `"low"` (minimum available)
  - Configure via `GROQ_REASONING_EFFORT` environment variable: `'none'`, `'low'`, `'medium'`, `'high'`, or `'default'`
  - Can be overridden per-session via token configuration

**TTS Settings**:
- Different voice models have different quality/speed tradeoffs
- Use `-medium` voices for balanced performance

---

## Known Issues

### Fixed: Tool Parameters Lost After DO Hibernation

**Issue:** When the Durable Object wakes up from hibernation, tools passed to the LLM have empty `parameters: {}` instead of full JSON schema definitions.

**Root Cause:** Double conversion of tool schemas during session restoration. The `SessionStateManager.restore()` method was unconditionally calling `convertVowelToolsToOpenAIFormat()` on tools that were already in OpenAI format.

**Fix:** Modified `SessionStateManager.restore()` to check if tools are already in OpenAI/Vercel AI SDK format before attempting conversion. See `.ai/attempts/2026-02-02-llm-tools-missing-parameters.md` for detailed analysis.

**Status:** ✅ Fixed in `SessionStateManager.ts`

---

## Known Limitations (POC Status)

This is currently a **proof of concept**. Features not yet implemented:

- ❌ Rate limiting (implement at reverse proxy or application level)
- ❌ Analytics and observability (add logging/metrics solution)
- ❌ Multi-tenancy (single API key for all users)
- ❌ Conversation persistence (sessions are ephemeral)
- ❌ Advanced tool execution (client-side only)

---

## Additional Resources

- **OpenAI Realtime API Docs:** https://platform.openai.com/docs/guides/realtime-websocket
- **OpenAI Agents JS SDK:** https://openai.github.io/openai-agents-js
- **Moonshot Kimi K2 Instruct 0905:** https://platform.moonshot.cn/docs/intro
- **Inworld AI:** https://www.inworld.ai
- **Silero VAD:** https://github.com/snakers4/silero-vad
- **Vercel AI SDK:** https://sdk.vercel.ai
- **AI SDK Tool Call Repair:** https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling#tool-call-repair

### Internal Documentation

- **Tool Call Repair:** `docs/TOOL_CALL_REPAIR.md` - Automatic repair for malformed tool calls
- **Optional Parameters Fix:** `docs/OPTIONAL_PARAMETERS_FIX.md` - Fix for optional parameter validation issues
- **LLM Tools Bug:** `.ai/attempts/2026-02-02-llm-tools-missing-parameters.md` - Analysis of tool parameter loss after DO hibernation

---

## Quick Reference

### Start Development
```bash
bun install
bun run setup
bun run dev  # Starts Wrangler dev server on http://localhost:8787
```

### Generate Token (for testing)
```bash
curl -X POST http://localhost:8787/v1/realtime/sessions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"moonshotai/kimi-k2-instruct-0905","voice":"Ashley"}'
```

### Connect via WebSocket
```bash
wscat -c "ws://localhost:8787/v1/realtime?model=moonshotai/kimi-k2-instruct-0905" \
  -H "Authorization: Bearer ek_..."
```

---

**Last Updated:** February 02, 2026
**Repository:** https://github.com/usevowel/sndbrd

