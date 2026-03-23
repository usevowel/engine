# Text-to-Speech (TTS)

## Supported Providers

| Provider | Features |
|----------|----------|
| `configurable` | Modular TTS provider system |

## Configuration

```bash
TTS_PROVIDER=your-provider
VOICE=your-voice
```

## Usage

```json
{
  "type": "session.update",
  "session": {
    "voice": "Ashley",
    "output_audio_format": "pcm16"
  }
}
```

## Audio Output
- **Sample Rate:** 24,000 Hz (24kHz)
- **Format:** PCM16
- **Channels:** Mono