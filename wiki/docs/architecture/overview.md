# Architecture Overview

The vowel engine is built with a modular, event-driven architecture for real-time voice interactions.

## Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Runtime** | Bun / Node.js | Self-hosted runtime |
| **WebSocket** | Native WebSocket API | Bidirectional communication |
| **LLM** | Groq / OpenRouter | Fast inference, multiple models |
| **STT** | Groq Whisper | Audio transcription |
| **TTS** | Modular provider system | Speech synthesis |
| **Auth** | jose (JWT) | Ephemeral token generation |

## Core Principles

### Event-Driven Architecture

All communication happens via WebSocket events following the OpenAI Realtime API protocol. This provides:

- **Bidirectional streaming** - Audio and text flow simultaneously
- **Real-time responses** - Low latency interaction
- **Protocol compatibility** - Works with OpenAI clients

### Modular Provider System

Providers can be swapped without changing core logic:

```mermaid
graph LR
    A[Core] --> B[LLM Provider]
    A --> C[STT Provider]
    A --> D[TTS Provider]
    A --> E[VAD Provider]
    
    B --> B1[Groq]
    B --> B2[OpenRouter]
    
    C --> C1[AssemblyAI]
    C --> C2[Groq Whisper]
    C --> C3[Fennec]
    
    D --> D1[Inworld]
    
    E --> E1[Silero]
    E --> E2[Fennec Integrated]
    E --> E3[AssemblyAI Integrated]
```

### Edge-Native Design

Built specifically for Cloudflare Workers environment:

- **Zero cold starts** - Always warm at edge locations
- **Global distribution** - Automatic CDN routing
- **Cost efficient** - Only pay for what you use
- **Type-safe** - Full TypeScript with strict mode

## System Architecture

### High-Level View

```mermaid
graph TB
    subgraph Client Side
        A[Browser/Mobile App]
        B[Microphone]
        C[Speaker]
    end
    
    subgraph Cloudflare Workers
        D[Worker Entry Point]
        E[Durable Object]
        F[Session Handler]
        G[LLM Service]
        H[STT Service]
        I[TTS Service]
        J[VAD Service]
    end
    
    subgraph External Services
        K[Groq/OpenRouter]
        L[AssemblyAI/Groq]
        M[Inworld]
    end
    
    A -->|WebSocket| D
    D --> E
    E --> F
    
    B -->|PCM16 Audio| F
    F -->|Detect Speech| J
    J -->|Transcribe| H
    H -->|Text| F
    F -->|Generate| G
    G --> K
    K -->|Text| F
    F -->|Synthesize| I
    I --> M
    M -->|PCM16 Audio| I
    I -->|Audio| F
    F --> C
```

### Data Flow

```mermaid
sequenceDiagram
    autonumber
    participant Client as Browser
    participant W as WebSocket
    participant VAD as Voice Activity Detection
    participant STT as Speech-to-Text
    participant LLM as Language Model
    participant TTS as Text-to-Speech
    
    Note over Client,Browser: Connection Phase
    Browser->>W: Connect with token
    W-->>Browser: session.created
    
    Note over Client,Browser: Audio Streaming Phase
    Browser->>W: input_audio_buffer.append
    W->>VAD: Analyze audio stream
    VAD->>W: speech_started
    VAD->>W: speech_stopped
    
    Note over Client,Browser: Processing Phase
    Browser->>W: input_audio_buffer.commit
    W->>STT: Send audio for transcription
    STT-->>W: Transcription result
    W-->>Browser: input_audio_buffer.transcribed
    
    Note over Client,Browser: Response Phase
    Browser->>W: response.create
    W->>LLM: Send user transcript
    LLM->>W: Stream text deltas
    W-->>Browser: response.text.delta
    W->>TTS: Synthesize speech
    TTS-->>W: Audio chunks
    W-->>Browser: response.audio.delta
    W-->>Browser: response.audio_transcript.delta
```

## Component Details

### Worker Entry Point

**Location:** `src/workers/worker.ts`

Handles HTTP requests and routes WebSocket upgrades:

- **Token generation** - Creates ephemeral JWT tokens
- **WebSocket routing** - Routes to Durable Objects
- **CORS handling** - Manages cross-origin requests
- **Health checks** - `/health` endpoint

### Durable Object (RealtimeSession)

**Location:** `src/workers/durable-objects/RealtimeSession.ts`

Stateful WebSocket session manager:

- **Session lifecycle** - Manages connection, state, and cleanup
- **Hibernation API** - Cost-efficient long-lived connections
- **State persistence** - Survives Worker restarts
- **Message routing** - Delegates to session handler

### Session Handler

**Location:** `src/session/handler.ts`

Main message router handling all OpenAI Realtime API events:

| Event | Direction | Purpose |
|-------|-----------|---------|
| `session.update` | Client → Server | Update session configuration |
| `input_audio_buffer.append` | Client → Server | Receive audio chunks |
| `input_audio_buffer.commit` | Client → Server | Process accumulated audio |
| `conversation.item.create` | Client → Server | Add messages to conversation |
| `response.create` | Client → Server | Generate AI response |
| `response.cancel` | Client → Server | Cancel in-progress response |
| `session.created` | Server → Client | Session established |
| `input_audio_buffer.transcribed` | Server → Client | Transcription available |
| `response.text.delta` | Server → Client | Text delta |
| `response.audio.delta` | Server → Client | Audio delta |

### Services Layer

**Location:** `src/services/`

Modular providers for each component:

```mermaid
graph LR
    SH[Session Handler] -->|Coordinates| LLMS[LLM Service]
    SH --> STTS[STT Service]
    SH --> TTSS[TTS Service]
    
    LLMS -->|Groq SDK| GRQ[Groq API]
    LLMS -->|AI SDK| ORT[OpenRouter API]
    
    STTS -->|Batch| WHIS[Groq Whisper]
    STTS -->|Streaming| ASMB[AssemblyAI]
    STTS -->|Streaming| FEN[Fennec]
    
    TTSS --> INW[Inworld TTS]
```

## Audio Pipeline

The complete audio processing pipeline from microphone to speaker:

```mermaid
graph LR
    subgraph "Input (User)"
        M1[Microphone]
        M2[PCM16 24kHz Mono]
    end
    
    subgraph "Processing (Server)"
        P1[VAD Detection]
        P2[Speech Buffer]
        P3[Transcription]
        P4[LLM Generation]
        P5[TTS Synthesis]
    end
    
    subgraph "Output (AI)"
        O1[Speaker]
        O2[PCM16 24kHz Mono]
    end
    
    M1 -->|Capture| M2
    M2 -->|WebSocket Stream| P2
    P2 -->|On Silence| P1
    P1 -->|Trigger| P3
    P3 -->|Text| P4
    P4 -->|Text| P5
    P5 -->|Audio| O2
    O2 -->|Play| O1
```

## Scaling & Performance

### Edge Deployment

- **Global locations** - 300+ edge locations worldwide
- **Auto-scaling** - Handles traffic spikes automatically
- **No cold starts** - Workers always warm at edge

### Performance Metrics

| Metric | Target |
|--------|--------|
| **TTFS (Time to First Speech)** | < 500ms |
| **Latency (Round-trip)** | < 1s |
| **Audio quality** | 24kHz PCM16 |
| **Uptime** | 99.9% |

## Security Architecture

```mermaid
graph TB
    subgraph "Authentication Flow"
        A1[Client App]
        A2[Your Backend]
        A3[sndbrd API]
        A4[WebSocket Session]
    end
    
    A1 -->|Request token| A2
    A2 -->|Mint ephemeral| A3
    A3 -->|JWT Token| A1
    A1 -->|Connect with token| A4
    
    style A2 fill:#e1f5fe
    style A3 fill:#f3f4f6
```

- **Ephemeral tokens** - 5-minute expiration, auto-refresh
- **JWT signing** - HMAC-SHA256, 32+ character secret
- **API key scoping** - Least privilege for backend services
- **No secrets in frontend** - Tokens generated server-side only

## Related

- [Request Flow](/architecture/request-flow) - Detailed request/response flow
- [Components](/architecture/components) - Component implementation details
- [Connection Paradigms](/architecture/connection-paradigms) - Advanced integration patterns
