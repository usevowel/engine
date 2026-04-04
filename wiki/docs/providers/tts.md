# Text-to-Speech (TTS)

## Supported Providers

| Provider | Features |
|----------|----------|
| `deepgram` | Deepgram Aura-2 voices, streaming + batch, high quality |
| `openai-compatible` | Local OpenAI-compatible TTS, including Echoline/Kokoro |

## Configuration

```bash
# Deepgram
TTS_PROVIDER=deepgram
DEEPGRAM_API_KEY=your_key_here
DEEPGRAM_TTS_MODEL=aura-2-thalia-en
DEEPGRAM_TTS_SAMPLE_RATE=24000

# OpenAI-compatible (Echoline example)
TTS_PROVIDER=openai-compatible
ECHOLINE_BASE_URL=http://localhost:8000/v1
ECHOLINE_TTS_MODEL=onnx-community/Kokoro-82M-v1.0-ONNX
ECHOLINE_TTS_VOICE=af_heart
DEFAULT_VOICE=af_heart
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

## OpenAI-Compatible

- [OpenAI-Compatible Audio](/providers/openai-compatible)
- [Echoline](/providers/echoline)
- Voice validation can use the live model metadata from `GET /v1/models/{modelId}`
- For Kokoro via Echoline, prefer a concrete voice such as `af_heart` instead of legacy names like `Ashley`

## Audio Output
- **Sample Rate:** 24,000 Hz (24kHz)
- **Format:** PCM16
- **Channels:** Mono
