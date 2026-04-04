# OpenAI-Compatible Audio

The engine's `openai-compatible` audio provider targets standard OpenAI-style batch audio endpoints:

- `POST /v1/audio/transcriptions`
- `POST /v1/audio/speech`
- `GET /v1/models/{modelId}`

Echoline is one local backend that supports this shape for batch STT and TTS.

## Engine Configuration

```bash
STT_PROVIDER=openai-compatible
TTS_PROVIDER=openai-compatible
ECHOLINE_BASE_URL=http://localhost:8000/v1

ECHOLINE_STT_MODEL=Systran/faster-whisper-tiny
ECHOLINE_TTS_MODEL=onnx-community/Kokoro-82M-v1.0-ONNX
ECHOLINE_TTS_VOICE=af_heart
ECHOLINE_TTS_RESPONSE_FORMAT=wav
DEFAULT_VOICE=af_heart
```

## Voice Validation

The provider attempts to fetch live model metadata from `GET /v1/models/{modelId}` and uses the returned `voices` list to:

- validate requested session voices
- fall back to the configured provider voice when possible
- send a structured WebSocket error if no valid voice can be resolved

## Kokoro Voices Via Echoline

For Echoline's `onnx-community/Kokoro-82M-v1.0-ONNX`, the valid voices are:

- `af_heart`
- `af_alloy`
- `af_aoede`
- `af_bella`
- `af_jessica`
- `af_kore`
- `af_nicole`
- `af_nova`
- `af_river`
- `af_sarah`
- `af_sky`
- `am_adam`
- `am_echo`
- `am_eric`
- `am_fenrir`
- `am_liam`
- `am_michael`
- `am_onyx`
- `am_puck`
- `am_santa`
- `bf_alice`
- `bf_emma`
- `bf_isabella`
- `bf_lily`
- `bm_daniel`
- `bm_fable`
- `bm_george`
- `bm_lewis`
- `jf_alpha`
- `jf_gongitsune`
- `jf_nezumi`
- `jf_tebukuro`
- `jm_kumo`
- `zf_xiaobei`
- `zf_xiaoni`
- `zf_xiaoxiao`
- `zf_xiaoyi`
- `zm_yunjian`
- `zm_yunxi`
- `zm_yunxia`
- `zm_yunyang`
- `ef_dora`
- `em_alex`
- `em_santa`
- `ff_siwis`
- `hf_alpha`
- `hf_beta`
- `hm_omega`
- `hm_psi`
- `if_sara`
- `im_nicola`
- `pf_dora`
- `pm_alex`
- `pm_santa`

## OpenAI Voice Aliases In Echoline

Echoline's Kokoro backend accepts a small set of OpenAI voice aliases and substitutes them internally:

- `alloy`
- `ash`
- `ballad`
- `coral`
- `echo`
- `sage`
- `shimmer`
- `verse`

Prefer using concrete Kokoro voices like `af_heart` in engine config.

## Runtime Errors

If voice validation still fails, the engine now:

- emits a structured WebSocket `error` event
- marks the active `response.done` as `failed`
- closes the socket with an `OpenAI-compatible TTS error` reason

## Live Inspection

```bash
curl http://localhost:8000/v1/models?task=text-to-speech
curl http://localhost:8000/v1/models/onnx-community/Kokoro-82M-v1.0-ONNX
```
