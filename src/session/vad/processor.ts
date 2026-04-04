/**
 * VAD Processor
 * 
 * Voice Activity Detection processing for session handling.
 */

import { ServerWebSocket } from 'bun';
import { generateEventId, generateItemId } from '../../lib/protocol';
import { SessionManager } from '../SessionManager';
import { sendResponseCancelled, sendSpeechStarted, sendSpeechStopped } from '../utils/event-sender';
import type { SessionData } from '../types';

import { getEventSystem, EventCategory } from '../../events';
/**
 * Process audio with VAD for speech detection
 */
export async function processVAD(
  ws: ServerWebSocket<SessionData>,
  audioChunk: Uint8Array,
  timestampMs: number,
  onSpeechEnd?: () => Promise<void>
): Promise<void> {
  try {
    const data = ws.data;
    
    // Get providers
    if (!data.providers) {
      data.providers = await SessionManager.getProviders(data.runtimeConfig!);
    }
    
    // Skip if no VAD provider (integrated VAD handles this differently)
    if (!data.providers.vad) {
      return;
    }

    // Convert PCM16 24kHz to Float32 16kHz for VAD
    const float32Audio = new Float32Array(audioChunk.length / 2);
    for (let i = 0; i < float32Audio.length; i++) {
      // Read int16 sample
      const sample = (audioChunk[i * 2 + 1] << 8) | audioChunk[i * 2];
      // Convert to float32 (-1 to 1)
      float32Audio[i] = sample < 0x8000 ? sample / 0x8000 : (sample - 0x10000) / 0x8000;
    }

    // Calculate RMS for debugging (commented out to reduce log verbosity)
    // let sum = 0;
    // for (let i = 0; i < float32Audio.length; i++) {
    //   sum += float32Audio[i] * float32Audio[i];
    // }
    // const rms = Math.sqrt(sum / float32Audio.length);
    // 
    // // Log audio level periodically (every 500ms)
    // const now = Date.now();
    // if (!ws.data.lastVadLogTime || now - ws.data.lastVadLogTime > 500) {
    //   getEventSystem().info(EventCategory.AUDIO, `🎙️  Audio RMS: ${rms.toFixed(4)} (${(rms * 100).toFixed(1)}%)`);
    //   ws.data.lastVadLogTime = now;
    // }

    // Resample from 24kHz to 16kHz (simple decimation by 3/2)
    const targetLength = Math.floor(float32Audio.length * 16000 / 24000);
    const resampled = new Float32Array(targetLength);
    for (let i = 0; i < targetLength; i++) {
      const srcIdx = (i * 24000 / 16000);
      const idx = Math.floor(srcIdx);
      const frac = srcIdx - idx;
      if (idx + 1 < float32Audio.length) {
        resampled[i] = float32Audio[idx] * (1 - frac) + float32Audio[idx + 1] * frac;
      } else {
        resampled[i] = float32Audio[idx];
      }
    }

    // Process in 512-sample chunks (VAD requirement)
    const chunkSize = 512;
    let processedChunks = 0;
    for (let i = 0; i + chunkSize <= resampled.length; i += chunkSize) {
      const vadChunk = resampled.slice(i, i + chunkSize);
      const event = await data.providers.vad!.detectSpeech(vadChunk, timestampMs);
      processedChunks++;

      if (event === 'speech_start') {
        getEventSystem().info(EventCategory.VAD, `🗣️  Speech started (prob: ${data.providers.vad!.getState().lastSpeechProbability.toFixed(3)})`);
        
        // Update last speech time for idle detection
        ws.data.lastSpeechTime = Date.now();
        
        // Interrupt any ongoing response
        if (ws.data.currentResponseId) {
          const cancelledResponseId = ws.data.currentResponseId;
          getEventSystem().info(EventCategory.SESSION, `⚡ User interrupt detected - canceling response ${cancelledResponseId}`);
          ws.data.currentResponseId = null;
          
          // Send response.cancelled event to notify client
          sendResponseCancelled(ws, cancelledResponseId);
          getEventSystem().info(EventCategory.SESSION, `📤 Sent response.cancelled for ${cancelledResponseId}`);
        }
        
        sendSpeechStarted(ws, timestampMs);
      } else if (event === 'speech_end') {
        getEventSystem().info(EventCategory.VAD, `🔇 Speech ended (prob: ${data.providers.vad!.getState().lastSpeechProbability.toFixed(3)})`);
        
        // Track speech end time for TTFS calculation
        ws.data.speechEndTime = Date.now();
        
        sendSpeechStopped(ws, timestampMs);
        
        // Always commit buffered audio on speech end for server VAD.
        // `create_response` controls whether we auto-generate the assistant turn,
        // not whether we perform transcription.
        if (onSpeechEnd) {
          await onSpeechEnd();
        }
      }
    }
    
    // Log if no chunks were processed
    if (processedChunks === 0 && resampled.length > 0) {
      getEventSystem().warn(EventCategory.AUDIO, `⚠️  No VAD chunks processed (resampled length: ${resampled.length}, need: ${chunkSize})`);
    }
  } catch (error) {
    getEventSystem().error(
      EventCategory.VAD,
      '❌ VAD processing error:',
      error instanceof Error ? error : new Error(String(error))
    );
    // Don't send error to client, just log it
  }
}
