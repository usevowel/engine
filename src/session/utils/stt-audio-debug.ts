/**
 * Optional on-disk capture of PCM16 sent to **streaming** STT, for local debugging
 * of Grok, Deepgram, and AssemblyAI-style providers.
 *
 * **Enable:** set `STT_AUDIO_DEBUG=1` (or `true` / `yes`). **Directory:** `STT_AUDIO_DEBUG_DIR`
 * (default `.audio-debug` under `process.cwd()`). Disabled when no filesystem
 * (e.g. Cloudflare Workers) or when VAD is Silero, client-side VAD, or STT is not
 * in the allowlist.
 *
 * **Files:** per-utterance WAVs (`{session}__{itemId}__{stt}.wav`) and a **session**
 * WAV (`{session}__session_stt.wav`) of every chunk successfully sent to the streaming
 * STT socket for the connection.
 *
 * Session-close writes for WAV plus STT event JSON are orchestrated by
 * `SessionDebugDumpManager` (`session-debug-dump-manager.ts`).
 *
 * @module session/utils/stt-audio-debug
 */

import { join } from 'node:path';
import { concatenateAudio, createWavFile } from '../../lib/audio';
import { isCloudflareWorkers, hasFileSystem } from '../../lib/runtime';
import { getEventSystem, EventCategory } from '../../events';
import type { SessionData } from '../types';
import {
  isExplicitClientSideVAD,
  shouldUseStreamingSTT,
} from './streaming-stt-eligibility';

/** STT `name` values (registry) that may dump under streaming mode. */
const DEBUGgable_STT_NAMES = new Set<string>(['grok', 'deepgram', 'assemblyai', 'assembly-ai']);

/**
 * @returns true when the env var enables STT dump (Bun- or process.env).
 */
function isSttAudioDebugEnvOn(): boolean {
  const v =
    (typeof process !== 'undefined' && process.env && process.env.STT_AUDIO_DEBUG) ||
    (typeof Bun !== 'undefined' && (Bun as { env?: Record<string, string> }).env?.STT_AUDIO_DEBUG) ||
    undefined;
  if (v == null || v === '') {
    return false;
  }
  const n = v.trim().toLowerCase();
  return n === '1' || n === 'true' || n === 'yes' || n === 'on';
}

/**
 * @returns default `.audio-debug` or `STT_AUDIO_DEBUG_DIR` (single segment, no `..`).
 */
export function getSttDebugBaseDir(): string {
  const raw =
    (typeof process !== 'undefined' && process.env && process.env.STT_AUDIO_DEBUG_DIR) ||
    (typeof Bun !== 'undefined' && (Bun as { env?: Record<string, string> }).env?.STT_AUDIO_DEBUG_DIR) ||
    undefined;
  const d = (raw && raw.trim() !== '' ? raw.trim() : '.audio-debug') || '.audio-debug';
  if (d.includes('..') || d.startsWith('/')) {
    return '.audio-debug';
  }
  return d;
}

/**
 * @returns true when this session may record streaming STT audio to disk.
 */
export function shouldRecordStreamingSttDebug(data: SessionData): boolean {
  if (!isSttAudioDebugEnvOn() || !hasFileSystem() || isCloudflareWorkers()) {
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
  if (!DEBUGgable_STT_NAMES.has(sttName)) {
    return false;
  }
  return true;
}

/**
 * @returns safe filename fragment (alphanumeric, dot, dash, underscore).
 */
function safeFilePart(s: string, max = 80): string {
  const t = s.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * On streaming STT `speech_start`, begin a new PCM buffer if recording is on.
 */
export function beginStreamingSttDebugIfEligible(data: SessionData): void {
  if (shouldRecordStreamingSttDebug(data)) {
    data.sttStreamingDebugPcm = new Uint8Array(0);
  } else {
    data.sttStreamingDebugPcm = null;
  }
}

/**
 * Append a chunk of mic PCM16 that was sent to the streaming STT provider.
 */
export function appendStreamingSttDebugPcm(
  data: SessionData,
  chunk: Uint8Array,
): void {
  if (data.sttStreamingDebugPcm == null) {
    return;
  }
  data.sttStreamingDebugPcm = concatenateAudio([data.sttStreamingDebugPcm, chunk]);
}

/**
 * Append mic PCM that was **successfully** sent on the streaming STT WebSocket
 * (`sendAudio`), for a single session-level WAV written on disconnect.
 */
export function appendStreamingSttSessionDebugIfEligible(
  data: SessionData,
  chunk: Uint8Array,
): void {
  if (!shouldRecordStreamingSttDebug(data)) {
    return;
  }
  if (chunk.length === 0) {
    return;
  }
  const prev = data.sttStreamingSessionDebugPcm;
  const base = prev == null ? new Uint8Array(0) : prev;
  data.sttStreamingSessionDebugPcm = concatenateAudio([base, chunk]);
}

/**
 * Clear capture without writing (e.g. buffer clear or STT error).
 */
export function resetStreamingSttDebug(data: SessionData): void {
  data.sttStreamingDebugPcm = null;
}

/**
 * Drop session-level capture without writing (e.g. tests). Per-turn buffer unchanged.
 */
export function resetStreamingSttSessionDebug(data: SessionData): void {
  data.sttStreamingSessionDebugPcm = null;
}

/**
 * Write a WAV for the current turn at STT `onFinal`, then clear the buffer.
 */
export async function finalizeStreamingSttDebugWav(
  data: SessionData,
  sampleRateHz: number,
): Promise<void> {
  const pcm = data.sttStreamingDebugPcm;
  data.sttStreamingDebugPcm = null;
  if (pcm == null || pcm.length === 0) {
    return;
  }
  if (
    !isSttAudioDebugEnvOn() ||
    !hasFileSystem() ||
    isCloudflareWorkers() ||
    typeof Bun === 'undefined'
  ) {
    return;
  }
  const itemId = data.currentInputTranscriptionItemId;
  if (!itemId) {
    return;
  }
  try {
    const stt = safeFilePart(data.providers?.stt?.name || 'stt', 32);
    const base = getSttDebugBaseDir();
    const fileName = `${safeFilePart(data.sessionId, 32)}__${safeFilePart(itemId, 64)}__${stt}.wav`;
    const outPath = join(process.cwd(), base, fileName);
    const wav = createWavFile(pcm, sampleRateHz, 1, 16);
    await Bun.write(outPath, wav);
    getEventSystem().info(EventCategory.STT, `🎙️ Wrote STT debug WAV: ${outPath} (${(pcm.length / 2 / sampleRateHz).toFixed(2)}s @ ${sampleRateHz}Hz)`);
  } catch (e) {
    getEventSystem().warn(
      EventCategory.STT,
      '⚠️ STT debug WAV write failed',
      e instanceof Error ? e : new Error(String(e)),
    );
  }
}

function getSttDebugSampleRateHz(data: SessionData): number {
  return data.runtimeConfig?.audio?.sampleRate ?? 24000;
}

/**
 * Write one WAV for the entire streaming STT mic stream for this session (all
 * successful `sendAudio` chunks). Call from WebSocket `close` when using Bun/Node.
 */
export async function finalizeStreamingSttSessionDebugWav(data: SessionData): Promise<void> {
  const pcm = data.sttStreamingSessionDebugPcm;
  data.sttStreamingSessionDebugPcm = null;
  if (pcm == null || pcm.length === 0) {
    return;
  }
  if (
    !isSttAudioDebugEnvOn() ||
    !hasFileSystem() ||
    isCloudflareWorkers() ||
    typeof Bun === 'undefined'
  ) {
    return;
  }
  const sampleRateHz = getSttDebugSampleRateHz(data);
  try {
    const stt = safeFilePart(data.providers?.stt?.name || 'stt', 32);
    const base = getSttDebugBaseDir();
    const fileName = `${safeFilePart(data.sessionId, 32)}__session_stt__${stt}.wav`;
    const outPath = join(process.cwd(), base, fileName);
    const wav = createWavFile(pcm, sampleRateHz, 1, 16);
    await Bun.write(outPath, wav);
    getEventSystem().info(
      EventCategory.STT,
      `🎙️ Wrote STT session debug WAV: ${outPath} (${(pcm.length / 2 / sampleRateHz).toFixed(2)}s @ ${sampleRateHz}Hz)`,
    );
  } catch (e) {
    getEventSystem().warn(
      EventCategory.STT,
      '⚠️ STT session debug WAV write failed',
      e instanceof Error ? e : new Error(String(e)),
    );
  }
}
