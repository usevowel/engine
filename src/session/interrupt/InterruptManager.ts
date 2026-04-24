/**
 * Interrupt manager for deciding whether VAD/STT speech starts should cancel
 * an in-flight assistant response.
 */

import type { ServerWebSocket } from 'bun';
import type { SessionData, InterruptPolicyConfig } from '../types';
import { tryEmitResponseCancelled } from '../response/response-turn-scope';
import { getEventSystem, EventCategory } from '../../events';

type InterruptReason = 'turn_detected' | 'client_cancelled';

type SessionSocket = Pick<ServerWebSocket<SessionData>, 'send' | 'data'>;

const DEFAULT_BACKCHANNELS = [
  'yeah',
  'yep',
  'yes',
  'ok',
  'okay',
  'mm',
  'mhm',
  'mm-hmm',
  'uh-huh',
  'right',
  'sure',
];

const DEFAULT_INTERRUPT_POLICY: Required<InterruptPolicyConfig> = {
  mode: 'confirm_before_cancel',
  minSpeechMs: 250,
  maxPendingMs: 1200,
  minWordsWhileAssistantSpeaking: 2,
  ignoreBackchannels: true,
  backchannels: DEFAULT_BACKCHANNELS,
};

function getPolicy(data: SessionData): Required<InterruptPolicyConfig> {
  const runtimePolicy = (data.runtimeConfig as any)?.interruptPolicy ?? {};
  const sessionPolicy = (data.config as any)?.interrupt_policy ?? {};
  return {
    ...DEFAULT_INTERRUPT_POLICY,
    ...runtimePolicy,
    ...sessionPolicy,
    backchannels: sessionPolicy.backchannels ?? runtimePolicy.backchannels ?? DEFAULT_BACKCHANNELS,
  };
}

function clearPendingTimers(data: SessionData): void {
  const pending = data.pendingInterrupt;
  if (!pending) return;
  if (pending.confirmTimer) clearTimeout(pending.confirmTimer);
  if (pending.maxTimer) clearTimeout(pending.maxTimer);
}

export function clearPendingInterrupt(data: SessionData): void {
  clearPendingTimers(data);
  data.pendingInterrupt = null;
}

function normalizeTranscript(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(transcript: string): number {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return 0;
  return normalized.split(' ').filter(Boolean).length;
}

function isBackchannel(transcript: string, policy: Required<InterruptPolicyConfig>): boolean {
  const normalized = normalizeTranscript(transcript);
  return normalized.length > 0 && policy.backchannels.includes(normalized);
}

export function confirmInterrupt(
  ws: SessionSocket,
  reason: InterruptReason = 'turn_detected',
  detail: string = 'confirmed',
): boolean {
  const data = ws.data;
  const responseId = data.pendingInterrupt?.responseId ?? data.currentResponseId;
  if (!responseId || responseId !== data.currentResponseId) {
    clearPendingInterrupt(data);
    return false;
  }

  getEventSystem().info(
    EventCategory.SESSION,
    `⚡ Confirming response interrupt ${responseId} (${detail})`,
  );

  clearPendingInterrupt(data);
  data.responseTurnAbort?.abort();
  data.responseTurnAbort = null;
  data.currentResponseId = null;
  tryEmitResponseCancelled(ws as ServerWebSocket<SessionData>, responseId, reason);
  return true;
}

export function rejectPendingInterrupt(ws: SessionSocket, reason: string = 'false_start'): boolean {
  const data = ws.data;
  const pending = data.pendingInterrupt;
  if (!pending) return false;

  getEventSystem().info(
    EventCategory.SESSION,
    `↩️ Rejecting pending response interrupt ${pending.responseId} (${reason})`,
  );

  clearPendingInterrupt(data);
  return true;
}

export function handleInterruptSpeechStart(
  ws: SessionSocket,
  source: string,
  audioStartMs?: number,
): void {
  const data = ws.data;
  const responseId = data.currentResponseId;
  if (!responseId) return;

  const policy = getPolicy(data);
  if (policy.mode === 'immediate') {
    confirmInterrupt(ws, 'turn_detected', `${source}:immediate`);
    return;
  }

  if (data.pendingInterrupt?.responseId === responseId) return;

  clearPendingInterrupt(data);
  getEventSystem().info(
    EventCategory.SESSION,
    `⏳ Pending response interrupt ${responseId} (${source}, minSpeechMs=${policy.minSpeechMs})`,
  );

  data.pendingInterrupt = {
    responseId,
    startedAt: Date.now(),
    audioStartMs,
    source,
    transcript: '',
  };

  // minSpeechMs is a gate, not a confirmation. Provider VAD can stay in
  // speech_start on echo/noise, so never cancel the LLM on time alone.
  data.pendingInterrupt.confirmTimer = setTimeout(() => {
    if (data.pendingInterrupt?.responseId === responseId) {
      getEventSystem().info(
        EventCategory.SESSION,
        `⏳ Pending response interrupt ${responseId} passed time gate; awaiting transcript evidence`,
      );
    }
  }, policy.minSpeechMs);

  data.pendingInterrupt.maxTimer = setTimeout(() => {
    if (data.pendingInterrupt?.responseId === responseId) {
      rejectPendingInterrupt(ws, `${source}:no_transcript_evidence`);
    }
  }, policy.maxPendingMs);
}

export function handleInterruptSpeechEnd(ws: SessionSocket, source: string): void {
  const pending = ws.data.pendingInterrupt;
  if (!pending) return;

  const policy = getPolicy(ws.data);
  const elapsedMs = Date.now() - pending.startedAt;
  const words = wordCount(pending.transcript);

  if (words >= policy.minWordsWhileAssistantSpeaking) {
    confirmInterrupt(ws, 'turn_detected', `${source}:speech_end_words`);
    return;
  }

  if (elapsedMs < policy.minSpeechMs || words < policy.minWordsWhileAssistantSpeaking) {
    rejectPendingInterrupt(ws, `${source}:short_false_start`);
  }
}

export function handleInterruptTranscript(ws: SessionSocket, transcript: string, source: string): void {
  const pending = ws.data.pendingInterrupt;
  if (!pending || !transcript) return;

  const policy = getPolicy(ws.data);
  pending.transcript = source.includes('partial')
    ? transcript.trim()
    : `${pending.transcript} ${transcript}`.trim();
  const elapsedMs = Date.now() - pending.startedAt;

  if (policy.ignoreBackchannels && isBackchannel(pending.transcript, policy)) {
    return;
  }

  if (
    elapsedMs >= policy.minSpeechMs &&
    wordCount(pending.transcript) >= policy.minWordsWhileAssistantSpeaking
  ) {
    confirmInterrupt(ws, 'turn_detected', `${source}:min_words`);
  }
}
