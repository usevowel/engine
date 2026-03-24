# Text-to-Speech (TTS)

## Supported Providers

| Provider | Features |
|----------|----------|
| `deepgram` | Deepgram Aura-2 voices, streaming + batch, high quality |

## Configuration

```bash
# Deepgram
TTS_PROVIDER=deepgram
DEEPGRAM_API_KEY=your_key_here
DEEPGRAM_TTS_MODEL=aura-2-thalia-en
DEEPGRAM_TTS_SAMPLE_RATE=24000
```

## Available Voices

| Voice | Gender | Description |
|-------|--------|-------------|
| Aura-2-Thalia-en | Female | Default, natural conversational |
| Aura-2-Asteria-en | Female | Warm, friendly |
| Aura-2-Angus-en | Male | Professional, clear |
| Aura-2-Orion-en | Male | Deep, authoritative |

## Usage

```json
{
  "type": "session.update",
  "session": {
    "voice": "Aura-2-Thalia-en",
    "output_audio_format": "pcm16"
  }
}
```

## Audio Output
- **Sample Rate:** 24,000 Hz (24kHz)
- **Format:** PCM16
- **Channels:** Mono