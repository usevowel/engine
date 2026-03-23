# Text-to-Speech (TTS)

## Supported Providers

| Provider | Features |
|----------|----------|
| `inworld` | Inworld TTS, cloud-based, high quality |

## Configuration

```bash
TTS_PROVIDER=inworld
INWORLD_VOICE=Ashley
```

## Inworld TTS

### Available Voices
- Ashley
- Ryan
- And more...

### Audio Output
- **Sample Rate:** 24,000 Hz (24kHz)
- **Format:** PCM16
- **Channels:** Mono

### Usage

```json
{
  "type": "session.update",
  "session": {
    "voice": "Ashley",
    "output_audio_format": "pcm16"
  }
}
```
