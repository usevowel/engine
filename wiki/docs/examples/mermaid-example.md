# Mermaid Diagram Examples

This page demonstrates Mermaid diagram support in the sndbrd wiki.

## Flowchart

```mermaid
flowchart TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug]
    D --> B
    C --> E[End]
```

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Client
    participant Worker
    participant DO as Durable Object
    participant LLM
    
    Client->>Worker: WebSocket Connect
    Worker->>DO: Create Session
    DO-->>Client: session.created
    
    Client->>DO: input_audio_buffer.append
    DO->>DO: Process Audio
    DO->>LLM: Transcribe & Generate
    LLM-->>DO: Response Stream
    DO-->>Client: response.text.delta
DO-->>Client: response.output_audio.delta
```

## Architecture Diagram

```mermaid
graph TB
    subgraph "Cloudflare Edge"
        W[Worker]
        DO[Durable Object]
    end
    
    subgraph "Providers"
        LLM[LLM Service]
        STT[STT Service]
        TTS[TTS Service]
        VAD[VAD Service]
    end
    
    Client[Client] -->|WebSocket| W
    W --> DO
    DO --> LLM
    DO --> STT
    DO --> TTS
    DO --> VAD
```

## State Diagram

```mermaid
stateDiagram-v2
    [*] --> Connecting
    Connecting --> Connected: WebSocket Open
    Connected --> Processing: Audio Received
    Processing --> Streaming: LLM Response
    Streaming --> Connected: Response Complete
    Connected --> [*]: WebSocket Close
    Processing --> Error: Exception
    Streaming --> Error: Exception
    Error --> [*]: Reset
```

## Gantt Chart

```mermaid
gantt
    title Voice Session Timeline
    dateFormat X
    axisFormat %Ls
    
    section Audio
    Capture Audio     :0, 2000
    Process VAD       :2000, 500
    Transcribe        :2500, 1000
    
    section LLM
    Send to LLM       :3500, 500
    Stream Response   :4000, 2000
    
    section TTS
    Synthesize        :6000, 1000
    Stream Audio      :7000, 2000
```

## Class Diagram

```mermaid
classDiagram
    class RealtimeSession {
        -WebSocket ws
        -SessionState state
        +handleMessage()
        +processAudio()
        +generateResponse()
    }
    
    class SessionHandler {
        +handleSessionUpdate()
        +handleAudioAppend()
        +handleResponseCreate()
    }
    
    class LLMService {
        +streamResponse()
        +callTools()
    }
    
    class STTService {
        +transcribe()
    }
    
    class TTSService {
        +synthesize()
    }
    
    RealtimeSession --> SessionHandler
    SessionHandler --> LLMService
    SessionHandler --> STTService
    SessionHandler --> TTSService
```
