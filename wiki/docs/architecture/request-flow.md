# Request Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Request Flow                              │
└─────────────────────────────────────────────────────────────────┘

1. Token Generation
   ┌──────────┐     POST /v1/realtime/sessions      ┌────────────┐
   │  Client  │ ──────────────────────────────────→ │   Server   │
   │          │    (Authorization: Bearer API_KEY)  │            │
   └──────────┘                                      └────────────┘
                                                          │
                                                          ↓
                                                 ┌────────────────┐
                                                 │  JWT Token     │
                                                 │  (5 min TTL)   │
                                                 └────────────────┘

2. WebSocket Connection
   ┌──────────┐   WS /v1/realtime?model=...       ┌────────────┐
   │  Client  │ ──────────────────────────────────→ │   Worker   │
   │          │    (Authorization: Bearer ek_...)  │            │
   └──────────┘                                      └────────────┘
                                                          │
                                    ┌─────────────────────┴─────────────────────┐
                                    ↓                                           ↓
                            ┌──────────────┐                          ┌──────────────┐
                            │  Validate    │                          │  Route to    │
                            │  Token       │                          │  Durable Obj │
                            └──────────────┘                          └──────────────┘
                                                                          │
                                                                          ↓
   3. Audio Streaming (bidirectional)
   ┌──────────────────────────────────────────────────────────────────────┐
   │                                                                      │
   │   Client → Audio Buffer → VAD → STT → LLM → TTS → Audio → Client   │
   │                                                                      │
   └──────────────────────────────────────────────────────────────────────┘
```

## Step-by-Step Process

1. **Token Request** - Client requests ephemeral JWT token from server
2. **WebSocket Connect** - Client connects with token, upgrades to WS
3. **Session Created** - Server sends `session.created` event
4. **Audio Buffer** - Client sends `input_audio_buffer.append` events
5. **VAD Detection** - Server detects end of speech
6. **Transcription** - Audio sent to STT provider
7. **LLM Processing** - Transcription sent to LLM for response
8. **Text Deltas** - Text streamed back to client
9. **TTS Synthesis** - Text sent to TTS provider
10. **Audio Output** - Audio chunks streamed to client
