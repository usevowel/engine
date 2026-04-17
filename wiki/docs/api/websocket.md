# WebSocket Protocol

## Connection

```bash
wss://host/v1/realtime?model=moonshotai/kimi-k2-instruct-0905
```

### Authentication Methods

1. **Authorization Header**
   ```
   Authorization: Bearer ek_...
   ```

2. **WebSocket Subprotocol**
   ```
   Sec-WebSocket-Protocol: openai-insecure-api-key.ek_...
   ```

3. **Query Parameter** (fallback)
   ```
   ws://host/v1/realtime?token=ek_...
   ```

## Audio Format

- **Sample Rate:** 24,000 Hz (24kHz)
- **Format:** PCM16 (16-bit signed little-endian)
- **Channels:** Mono (1 channel)
- **Encoding:** Base64 for WebSocket transmission

## Session Lifecycle

### 1. Connect
Client connects with ephemeral token

### 2. session.created (Server → Client)
```json
{
  "type": "session.created",
  "session": {
    "id": "session_id",
    "object": "realtime.session"
  }
}
```

### 3. session.update (Client → Server)
```json
{
  "type": "session.update",
  "session": {
    "turn_detection": {
      "type": "server_vad"
    },
    "input_audio_format": "pcm16",
    "output_audio_format": "pcm16",
    "voice": "Ashley",
    "instructions": "You are a helpful voice assistant."
  }
}
```

### 4. Audio Streaming

**Client → Server:**
```json
{
  "type": "input_audio_buffer.append",
  "audio": "<base64-encoded-audio>"
}
```

**Server → Client (transcription):**
```json
{
  "type": "input_audio_buffer.transcript",
  "transcript": "Hello, how can I help you?"
}
```

**Server → Client (response):**
```json
{
  "type": "response.output_audio.delta",
  "delta": "<base64-encoded-audio>"
}
```
