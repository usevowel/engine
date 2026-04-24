/**
 * Shared predicates for when the engine uses a live streaming STT session
 * (as opposed to batch transcription on `input_audio_buffer.commit`).
 *
 * @module session/utils/streaming-stt-eligibility
 */

import type { SessionData } from '../types';
import { SessionManager } from '../SessionManager';

/**
 * @returns true when the runtime VAD/turn model is a provider-integrated
 *   pipeline (`*-integrated`), not a standalone local VAD such as Silero.
 */
export function usesIntegratedTurnDetection(data: SessionData): boolean {
  return !!data.runtimeConfig && SessionManager.isVADIntegrated(data.runtimeConfig);
}

/**
 * Client-driven turn end (no server turn / VAD config); batch STT on commit.
 */
export function isExplicitClientSideVAD(data: SessionData): boolean {
  return data.config.turn_detection === null && !usesIntegratedTurnDetection(data);
}

/**
 * True when the STT session streams frames from append (vs commit-only batch).
 */
export function shouldUseStreamingSTT(data: SessionData): boolean {
  return (
    data.providers?.stt.type === 'streaming' &&
    (usesIntegratedTurnDetection(data) || data.config.turn_detection !== null)
  );
}
