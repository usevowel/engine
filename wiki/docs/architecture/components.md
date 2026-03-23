# Components

## Worker Entry Point
**File:** `src/workers/worker.ts`

Handles HTTP requests and WebSocket upgrades.

### Responsibilities
- Token generation endpoint (`POST /v1/realtime/sessions`)
- WebSocket upgrade handling
- CORS and health checks
- Routes to Durable Objects

## Durable Object (RealtimeSession)
**File:** `src/workers/durable-objects/RealtimeSession.ts`

Stateful WebSocket session handler using WebSocket Hibernation API.

### Responsibilities
- Session lifecycle management
- WebSocket message routing
- State persistence

## Session Handler
**File:** `src/session/handler.ts`

Main message router for OpenAI Realtime API events.

### Events Handled
| Event | Description |
|-------|-------------|
| `session.update` | Update session configuration |
| `input_audio_buffer.append` | Receive audio chunks |
| `input_audio_buffer.commit` | Process accumulated audio |
| `conversation.item.create` | Add messages to conversation |
| `response.create` | Generate AI response |
| `response.cancel` | Cancel in-progress response |

## Services

### LLM Service
**File:** `src/services/llm.ts`

Streams responses from LLM providers (Groq/OpenRouter).

### STT Service
**File:** `src/services/transcription.ts`

Converts audio to text via STT providers.

### TTS Service
**File:** `src/services/providers/tts/InworldTTS.ts`

Synthesizes speech using Inworld TTS API.

## Authentication
**File:** `src/auth/token-generator.ts`

JWT token generation and verification for ephemeral tokens.
