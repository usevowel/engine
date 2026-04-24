/**
 * Central coordinator for optional **per-WebSocket-session** on-disk debug artifacts
 * under `STT_AUDIO_DEBUG_DIR` (default `.audio-debug`).
 *
 * **Why this module:** One place to hook `record*` (during the session) and
 * `finalizeSessionDumps` (on connection close) so new dump kinds (TTS frames, LLM
 * tokens, protocol events, etc.) can be added later without scattering env checks
 * and `Bun.write` calls across handlers.
 *
 * **Implemented today**
 * - Streaming STT **inbound WebSocket** messages → formatted JSON (`STT_STREAM_EVENTS_DEBUG`).
 * - Same flag: **whole-session PCM** (chunks successfully `sendAudio`’d) → reference transcript via
 *   **Groq Whisper** (`GROQ_API_KEY` or session `llm` when provider is `groq`), merged into that JSON.
 * - STT session PCM WAV remains in {@link finalizeStreamingSttSessionDebugWav}; this
 *   manager calls it from {@link SessionDebugDumpManager.finalizeSessionDumps}.
 *
 * **Not implemented (extension points):** add private `finalize*` helpers and invoke
 * them from `finalizeSessionDumps`; add `record*` APIs as needed.
 *
 * @module session/utils/session-debug-dump-manager
 */

import { join } from 'node:path';
import { concatenateAudio } from '../../lib/audio';
import { config } from '../../config/env';
import { isCloudflareWorkers, hasFileSystem } from '../../lib/runtime';
import { getEventSystem, EventCategory } from '../../events';
import { isValidAudioBuffer, transcribeAudio } from '../../services/transcription';
import type { SessionData } from '../types';
import type { StreamingSttProviderDebugRecord } from '../../types/providers';
import {
  isExplicitClientSideVAD,
  shouldUseStreamingSTT,
} from './streaming-stt-eligibility';
import { finalizeStreamingSttSessionDebugWav, getSttDebugBaseDir } from './stt-audio-debug';

/** STT registry names that participate in streaming STT event logging (same allowlist as WAV). */
const STT_STREAM_EVENT_DEBUG_NAMES = new Set<string>([
  'grok',
  'deepgram',
  'assemblyai',
  'assembly-ai',
]);

function readEnvFlag(name: string): string | undefined {
  return (
    (typeof process !== 'undefined' && process.env && process.env[name]) ||
    (typeof Bun !== 'undefined' && (Bun as { env?: Record<string, string> }).env?.[name]) ||
    undefined
  );
}

function isTruthyEnv(v: string | undefined): boolean {
  if (v == null || v === '') {
    return false;
  }
  const n = v.trim().toLowerCase();
  return n === '1' || n === 'true' || n === 'yes' || n === 'on';
}

function isSttStreamEventsDebugEnvOn(): boolean {
  return isTruthyEnv(readEnvFlag('STT_STREAM_EVENTS_DEBUG'));
}

function safeFilePart(s: string, max = 80): string {
  const t = s.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return t.length > max ? t.slice(0, max) : t;
}

function shouldRecordSttStreamProviderEvents(data: SessionData): boolean {
  if (!isSttStreamEventsDebugEnvOn() || !hasFileSystem() || isCloudflareWorkers()) {
    return false;
  }
  if (!data.providers?.stt) {
    return false;
  }
  if (isExplicitClientSideVAD(data) || !shouldUseStreamingSTT(data)) {
    return false;
  }
  const vadName = data.runtimeConfig?.providers?.vad?.provider;
  if (vadName === 'silero') {
    return false;
  }
  const sttName = (data.providers.stt.name || '').toLowerCase();
  if (!STT_STREAM_EVENT_DEBUG_NAMES.has(sttName)) {
    return false;
  }
  return true;
}

/**
 * Coordinates session-scoped debug dumps. Prefer this over calling individual finalizers.
 */
export class SessionDebugDumpManager {
  private constructor() {
    // static API only
  }

  /**
   * Append one inbound streaming STT WebSocket payload (parsed object or debug envelope).
   */
  /**
   * Accumulate session PCM for Groq Whisper reference transcription (same eligibility as STT event logging).
   */
  static appendSessionPcmForSttEventsDebugIfEligible(
    data: SessionData,
    chunk: Uint8Array,
  ): void {
    if (!shouldRecordSttStreamProviderEvents(data) || chunk.length === 0) {
      return;
    }
    const prev = data.sttStreamEventsDebugSessionPcm;
    const base = prev == null ? new Uint8Array(0) : prev;
    data.sttStreamEventsDebugSessionPcm = concatenateAudio([base, chunk]);
  }

  static recordSttStreamProviderPayloadIfEligible(
    data: SessionData,
    payload: unknown,
  ): void {
    if (!shouldRecordSttStreamProviderEvents(data)) {
      return;
    }
    const row: StreamingSttProviderDebugRecord = {
      receivedAtMs: Date.now(),
      provider: (data.providers?.stt?.name || 'unknown').toLowerCase(),
      payload,
    };
    if (!data.sttStreamProviderDebugEvents) {
      data.sttStreamProviderDebugEvents = [];
    }
    data.sttStreamProviderDebugEvents.push(row);
  }

  /**
   * Write all enabled session debug artifacts. Safe to call multiple times if handlers
   * clear fields after write (current STT finalizers do).
   */
  static async finalizeSessionDumps(data: SessionData): Promise<void> {
    await Promise.all([
      finalizeStreamingSttSessionDebugWav(data),
      SessionDebugDumpManager.finalizeSttStreamEventsJson(data),
    ]);
  }

  /**
   * Pretty-printed JSON (`JSON.stringify` indent 2): `{sessionId}__session_stt_events__{stt}.json`.
   */
  private static resolveGroqApiKeyForWhisper(data: SessionData): string | undefined {
    const rc = data.runtimeConfig;
    if (rc?.llm?.provider === 'groq' && rc.llm.apiKey?.trim()) {
      return rc.llm.apiKey.trim();
    }
    const k = config.groq?.apiKey?.trim();
    return k || undefined;
  }

  /**
   * Whole-session reference ASR via Groq Whisper (batch) for comparison with streaming STT events.
   */
  private static async buildGroqWhisperSessionReference(
    data: SessionData,
    pcm: Uint8Array | null | undefined,
    sampleRateHz: number,
  ): Promise<Record<string, unknown>> {
    const model = config.groq?.whisperModel ?? 'whisper-large-v3';
    const sr =
      Number.isFinite(sampleRateHz) && sampleRateHz > 0 ? sampleRateHz : 24000;

    if (!pcm || pcm.length === 0) {
      return {
        model,
        sampleRateHz: sr,
        pcmByteLength: 0,
        approximateDurationSec: 0,
        skipped: true,
        skipReason: 'no_session_pcm_captured',
      };
    }

    const approxSec = pcm.length / 2 / sr;

    if (!isValidAudioBuffer(pcm)) {
      return {
        model,
        sampleRateHz: sr,
        pcmByteLength: pcm.length,
        approximateDurationSec: approxSec,
        skipped: true,
        skipReason: 'pcm_below_minimum_for_whisper',
      };
    }

    const apiKey = SessionDebugDumpManager.resolveGroqApiKeyForWhisper(data);
    if (!apiKey) {
      return {
        model,
        sampleRateHz: sr,
        pcmByteLength: pcm.length,
        approximateDurationSec: approxSec,
        skipped: true,
        skipReason: 'no_groq_api_key_configure_llm_provider_groq_or_GROQ_API_KEY',
      };
    }

    const languageHint =
      data.language?.current ?? data.language?.configured ?? undefined;

    try {
      const result = await transcribeAudio(
        pcm,
        languageHint ?? undefined,
        apiKey,
        model,
        sr,
      );
      return {
        model,
        sampleRateHz: sr,
        pcmByteLength: pcm.length,
        approximateDurationSec: approxSec,
        transcript: result.text,
        detectedLanguage: result.language,
        groqReportedDuration: result.duration,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        model,
        sampleRateHz: sr,
        pcmByteLength: pcm.length,
        approximateDurationSec: approxSec,
        error: msg,
      };
    }
  }

  private static async finalizeSttStreamEventsJson(data: SessionData): Promise<void> {
    if (
      !isSttStreamEventsDebugEnvOn() ||
      !hasFileSystem() ||
      isCloudflareWorkers() ||
      typeof Bun === 'undefined'
    ) {
      return;
    }

    const events = data.sttStreamProviderDebugEvents ?? [];
    data.sttStreamProviderDebugEvents = undefined;

    const pcm = data.sttStreamEventsDebugSessionPcm;
    data.sttStreamEventsDebugSessionPcm = null;

    if (events.length === 0 && (!pcm || pcm.length === 0)) {
      return;
    }

    const sampleRateHz = data.runtimeConfig?.audio?.sampleRate ?? 24000;
    const groqWhisperSessionReference =
      await SessionDebugDumpManager.buildGroqWhisperSessionReference(
        data,
        pcm,
        sampleRateHz,
      );

    const dump = {
      sessionId: data.sessionId,
      sttProvider: data.providers?.stt?.name ?? null,
      eventCount: events.length,
      closedAtMs: Date.now(),
      events,
      groqWhisperSessionReference,
    };
    try {
      const base = getSttDebugBaseDir();
      const stt = safeFilePart(data.providers?.stt?.name || 'stt', 32);
      const fileName = `${safeFilePart(data.sessionId, 32)}__session_stt_events__${stt}.json`;
      const outPath = join(process.cwd(), base, fileName);
      const json = `${JSON.stringify(dump, null, 2)}\n`;
      await Bun.write(outPath, json);
      const ref = groqWhisperSessionReference;
      const refSummary =
        typeof ref.transcript === 'string'
          ? 'transcript'
          : ref.skipped === true
            ? 'skipped'
            : typeof ref.error === 'string'
              ? 'error'
              : 'n/a';
      getEventSystem().info(
        EventCategory.STT,
        `📝 Wrote STT stream debug JSON: ${outPath} (${events.length} stream events, Groq Whisper ref: ${refSummary})`,
      );
    } catch (e) {
      getEventSystem().warn(
        EventCategory.STT,
        '⚠️ STT stream events JSON write failed',
        e instanceof Error ? e : new Error(String(e)),
      );
    }
  }
}
