# Echoline

Echoline is a backend implementation you can point the engine's `openai-compatible` batch STT/TTS provider at.

## Batch APIs

These Echoline endpoints align with the engine's `openai-compatible` provider:

- `POST /v1/audio/transcriptions`
- `POST /v1/audio/speech`
- `GET /v1/models/{modelId}`

Use the generic provider doc for engine configuration details:

- [OpenAI-Compatible Audio](/providers/openai-compatible)

## Experimental Realtime STT

Echoline also has experimental realtime and VAD-stream APIs in its own repo, including paths and event flows under:

- `routers/vad_stream_ws.py`
- `realtime/input_audio_buffer_event_router.py`
- `ui/tabs/realtime_stt.py`

That realtime STT path is Echoline-specific and is not treated by the engine as part of the generic `openai-compatible` batch STT/TTS provider.

If the engine integrates Echoline realtime STT later, it should land as a separate provider with its own protocol handling rather than being folded into the generic OpenAI-compatible provider.
