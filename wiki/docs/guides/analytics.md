# Analytics & Event Tracking

sndbrd integrates with PostHog for analytics and performance monitoring. This guide explains what events are tracked and how to configure analytics.

## Overview

PostHog tracking is designed to provide actionable insights for:
- **Round-trip speech timing** - Measure end-to-end latency
- **STT/TTS performance** - Track transcription and synthesis metrics
- **Cost tracking** - Monitor STT and TTS usage costs
- **Error monitoring** - Track critical failures

**Note**: LLM metrics (tokens, latency, costs) are automatically tracked via the Vercel AI SDK PostHog integration (`@posthog/ai`), so they're not included in custom events.

---

## Tracked Events

### Session Lifecycle

#### `session_session_created`
**When**: New WebSocket session initialized

**Properties**:
- `initBreakdown.total` - Total initialization time (ms)
- `providers` - Provider configuration (stt, tts, vad)
- `model` - LLM model used
- `voice` - TTS voice used
- `connection_paradigm` - Connection type

---

#### `session_session_closed` / `websocket_websocket_close`
**When**: Session ends

**Properties**:
- `code` - WebSocket close code
- `reason` - Close reason
- `wasClean` - Whether connection closed cleanly
- `duration` - Session duration (if available)

---

#### `session_interrupt`
**When**: User interrupts AI response

**Properties**:
- `responseId` - Cancelled response ID

---

### STT (Speech-to-Text) Performance

#### `stt_transcription_start`
**When**: STT transcription request initiated

**Properties**:
- `audioDurationMs` - Audio duration being transcribed
- `sttProvider` - STT provider name
- `audioBufferSize` - Buffer size in bytes

---

#### `stt_transcription_complete`
**When**: Transcription received from STT provider

**Properties**:
- `transcriptionDurationMs` - Time taken to transcribe (latency)
- `audioDurationMs` - Original audio duration
- `transcriptLength` - Length of transcript text
- `sttProvider` - STT provider name

---

### TTS (Text-to-Speech) Performance

#### `tts_tts_synthesis_start`
**When**: TTS synthesis request initiated

**Properties**:
- `textLength` - Character count (TTS usage metric)
- `ttsVoice` - Voice used
- `ttsProvider` - TTS provider name
- `speakingRate` - Speaking rate multiplier

---

#### `tts_tts_complete`
**When**: TTS synthesis complete

**Properties**:
- `synthesisDurationMs` - Time taken to synthesize (latency)
- `textLength` - Character count (TTS usage metric)
- `audioDurationSec` - Generated audio duration
- `chunkCount` - Number of audio chunks generated
- `ttsProvider` - TTS provider name
- `ttsVoice` - Voice used

---

### Round-Trip Performance

#### `performance_round_trip_complete`
**When**: Complete round-trip finishes (user speaks → AI responds)

**Properties**:
- `totalDuration` - End-to-end response time (ms)
- `asrDuration` - STT transcription time (ms)
- `llmDuration` - LLM stream duration (ms)
- `ttsDuration` - Total TTS synthesis time (ms)
- `ttfs` - Time to first sound (speech end → first audio) (ms)
- `responseId` - Response ID for correlation

---

### Cost Tracking

#### `stt_stt_cost_calculated`
**When**: STT cost calculated after transcription

**Properties**:
- `stt_provider` - STT provider name
- `stt_model` - STT model used
- `stt_duration_seconds` - Audio duration processed
- `stt_cost_usd` - Cost in USD (rounded to cents)

---

#### `tts_tts_cost_calculated`
**When**: TTS cost calculated after synthesis

**Properties**:
- `tts_provider` - TTS provider name
- `tts_voice` - Voice used
- `tts_character_count` - Characters synthesized
- `tts_audio_duration_seconds` - Generated audio duration
- `tts_cost_usd` - Cost in USD (rounded to cents)

---

### Error Events

All **ERROR** and **CRITICAL** level events are tracked, including:

- `stt_stt_stream` - STT stream errors
- `provider_provider_init` - Provider initialization failures
- `websocket_websocket_error` - WebSocket connection errors

---

## Standard Event Properties

All events include these base properties:

```typescript
{
  category: string,              // Event category
  level: string,                 // Event level (info, warn, error, critical)
  operation: string,             // Operation name
  connection_paradigm: string,  // Connection type
  durable_object_id?: string,    // Durable Object ID
  sessionId?: string,           // Session ID (from token)
  sessionKey?: string,          // Session key (for sidecar sessions)
  duration_ms?: number,          // Duration in milliseconds
  error_code?: string,           // Error code (if error event)
  error_message?: string,       // Error message (if error event)
}
```

---

## Configuration

### Environment Variables

```bash
# PostHog Configuration
POSTHOG_API_KEY="phc_..."           # PostHog project API key
POSTHOG_ENABLED="true"               # Enable/disable PostHog
POSTHOG_HOST="https://app.posthog.com"  # PostHog API host
```

### Cloudflare Workers

Set secrets via Wrangler:

```bash
wrangler secret put POSTHOG_API_KEY --env production
```

---

## Event Filtering

By default, only curated analytics events are sent to PostHog. This excludes:
- Debug events
- Verbose logging
- Internal system events
- Health checks
- Token generation details

See [PostHog Event Filtering Proposal](../../../.ai/proposals/posthog-event-filtering/README.md) for the complete list of tracked events.

---

## LLM Metrics

LLM performance metrics (tokens, latency, costs) are automatically tracked via the Vercel AI SDK PostHog integration (`@posthog/ai`). These events are separate from custom events and include:

- Token usage (input/output)
- Latency metrics
- Cost tracking
- Model performance

---

## Connection Paradigm Tracking

All events include `connection_paradigm` to identify the connection type:

- `direct` - Client requests token directly
- `fixed_api_key` - Backend uses `vkey_xxx` API key
- `developer_managed` - Backend mints tokens
- `sidecar` - Multiple connections share session

---

## Session Correlation

Events are correlated by:
- **`sessionKey`** - If available (sidecar/developer-managed paradigms)
- **`sessionId`** - Otherwise (from token `sub` field)

This allows tracking complete conversation journeys across multiple connections.

---

## Analytics Dashboard Use Cases

### Performance Monitoring
- Track round-trip latency trends
- Monitor STT/TTS latency by provider
- Identify performance bottlenecks

### Cost Analysis
- Monitor STT and TTS costs per session
- Track usage by provider
- Calculate cost per conversation

### Error Tracking
- Monitor error rates by provider
- Track connection failures
- Identify reliability issues

### User Behavior
- Track interrupt rates
- Monitor session durations
- Analyze conversation patterns

---

## See Also

- [Performance Guide](/guides/performance) - Performance optimization strategies
- [Connection Paradigms](/architecture/connection-paradigms) - Advanced integration patterns
- [PostHog Cloudflare Workers Best Practices](/docs/POSTHOG_CLOUDFLARE_WORKERS_BEST_PRACTICES.md) - Implementation details
