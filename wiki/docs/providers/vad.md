# Voice Activity Detection (VAD)

## Supported Providers

| Provider | Features |
|----------|----------|
| `silero` | Silero VAD, local, standalone |
| `none` | Disable VAD |

## Configuration

```bash
VAD_PROVIDER=silero
VAD_ENABLED=true
VAD_THRESHOLD=0.5
VAD_MIN_SILENCE_MS=550
VAD_SPEECH_PAD_MS=0
```

## Tuning Parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| `VAD_THRESHOLD` | 0.0-1.0 | 0.5 | Sensitivity (lower = more sensitive) |
| `VAD_MIN_SILENCE_MS` | - | 550 | Min silence before end of speech |
| `VAD_SPEECH_PAD_MS` | - | 0 | Padding to prevent cutoffs |

## Recommendations

- **Quiet environments:** Lower threshold (0.3-0.4)
- **Noisy environments:** Higher threshold (0.6-0.7)
- **Fast responses:** Reduce `VAD_MIN_SILENCE_MS`
- **More natural speech:** Increase `VAD_SPEECH_PAD_MS`
