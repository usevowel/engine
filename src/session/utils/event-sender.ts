/**
 * Event Sender Utilities
 * 
 * Helper functions for sending WebSocket events to clients.
 * Eliminates duplicate code for event sending throughout the handler.
 */

import { ServerWebSocket } from 'bun';
import { generateEventId, generateItemId } from '../../lib/protocol';
import type { SessionData } from '../types';
import type { ConversationItem } from '../../lib/protocol';

/**
 * Send response.created event
 */
export function sendResponseCreated(
  ws: ServerWebSocket<SessionData>,
  responseId: string
): void {
  ws.send(JSON.stringify({
    type: 'response.created',
    event_id: generateEventId(),
    response: {
      id: responseId,
      object: 'realtime.response',
      status: 'in_progress',
      status_details: null,
      output: [],
      usage: null,
    },
  }));
}

/**
 * Send response.output_item.added event
 */
export function sendOutputItemAdded(
  ws: ServerWebSocket<SessionData>,
  responseId: string,
  outputIndex: number,
  item: ConversationItem
): void {
  ws.send(JSON.stringify({
    type: 'response.output_item.added',
    event_id: generateEventId(),
    response_id: responseId,
    output_index: outputIndex,
    item,
  }));
}

/**
 * Send response.content_part.added event
 */
export function sendContentPartAdded(
  ws: ServerWebSocket<SessionData>,
  responseId: string,
  itemId: string,
  outputIndex: number,
  contentIndex: number,
  part: { type: 'text'; text: string } | { type: 'audio'; transcript: string }
): void {
  ws.send(JSON.stringify({
    type: 'response.content_part.added',
    event_id: generateEventId(),
    response_id: responseId,
    item_id: itemId,
    output_index: outputIndex,
    content_index: contentIndex,
    part,
  }));
}

/**
 * Send response.text.delta event
 */
export function sendTextDelta(
  ws: ServerWebSocket<SessionData>,
  responseId: string,
  itemId: string,
  delta: string,
  outputIndex = 0,
  contentIndex = 0
): void {
  ws.send(JSON.stringify({
    type: 'response.text.delta',
    event_id: generateEventId(),
    response_id: responseId,
    item_id: itemId,
    output_index: outputIndex,
    content_index: contentIndex,
    delta,
  }));
}

/**
 * Send response.text.done event
 */
export function sendTextDone(
  ws: ServerWebSocket<SessionData>,
  responseId: string,
  itemId: string,
  text: string,
  outputIndex = 0,
  contentIndex = 0
): void {
  ws.send(JSON.stringify({
    type: 'response.text.done',
    event_id: generateEventId(),
    response_id: responseId,
    item_id: itemId,
    output_index: outputIndex,
    content_index: contentIndex,
    text,
  }));
}

/**
 * Send response.output_audio_transcript.delta event
 */
export function sendAudioTranscriptDelta(
  ws: ServerWebSocket<SessionData>,
  responseId: string,
  itemId: string,
  delta: string,
  outputIndex = 0,
  contentIndex = 1
): void {
  ws.send(JSON.stringify({
    type: 'response.output_audio_transcript.delta',
    event_id: generateEventId(),
    response_id: responseId,
    item_id: itemId,
    output_index: outputIndex,
    content_index: contentIndex,
    delta,
  }));
}

/**
 * Send response.output_audio_transcript.done event
 */
export function sendAudioTranscriptDone(
  ws: ServerWebSocket<SessionData>,
  responseId: string,
  itemId: string,
  transcript: string,
  outputIndex = 0,
  contentIndex = 1
): void {
  ws.send(JSON.stringify({
    type: 'response.output_audio_transcript.done',
    event_id: generateEventId(),
    response_id: responseId,
    item_id: itemId,
    output_index: outputIndex,
    content_index: contentIndex,
    transcript,
  }));
}

/**
 * Send response.output_audio.delta event
 */
export function sendAudioDelta(
  ws: ServerWebSocket<SessionData>,
  responseId: string,
  itemId: string,
  audioChunk: Uint8Array | string,
  outputIndex = 0,
  contentIndex = 1
): void {
  const base64Audio = typeof audioChunk === 'string' 
    ? audioChunk 
    : Buffer.from(audioChunk).toString('base64');
    
  ws.send(JSON.stringify({
    type: 'response.output_audio.delta',
    event_id: generateEventId(),
    response_id: responseId,
    item_id: itemId,
    output_index: outputIndex,
    content_index: contentIndex,
    delta: base64Audio,
  }));
}

/**
 * Send response.output_audio.done event
 */
export function sendAudioDone(
  ws: ServerWebSocket<SessionData>,
  responseId: string,
  itemId: string,
  outputIndex = 0,
  contentIndex = 1
): void {
  ws.send(JSON.stringify({
    type: 'response.output_audio.done',
    event_id: generateEventId(),
    response_id: responseId,
    item_id: itemId,
    output_index: outputIndex,
    content_index: contentIndex,
  }));
}

/**
 * Send response.output_item.done event
 */
export function sendOutputItemDone(
  ws: ServerWebSocket<SessionData>,
  responseId: string,
  outputIndex: number,
  item: ConversationItem
): void {
  ws.send(JSON.stringify({
    type: 'response.output_item.done',
    event_id: generateEventId(),
    response_id: responseId,
    output_index: outputIndex,
    item,
  }));
}

/**
 * Send response.done event
 */
export function sendResponseDone(
  ws: ServerWebSocket<SessionData>,
  responseId: string,
  status: 'completed' | 'incomplete' | 'failed' | 'cancelled',
  output: ConversationItem[] = [],
  statusDetails: string | null = null
): void {
  ws.send(JSON.stringify({
    type: 'response.done',
    event_id: generateEventId(),
    response: {
      id: responseId,
      object: 'realtime.response',
      status,
      status_details: statusDetails,
      output,
      usage: null,
    },
  }));
}

/**
 * Send response.cancelled event
 */
export function sendResponseCancelled(
  ws: ServerWebSocket<SessionData>,
  responseId: string
): void {
  ws.send(JSON.stringify({
    type: 'response.cancelled',
    event_id: generateEventId(),
    response: {
      id: responseId,
      object: 'realtime.response',
      status: 'cancelled',
    },
  }));
}

/**
 * Send input_audio_buffer.speech_started event
 */
export function sendSpeechStarted(
  ws: ServerWebSocket<SessionData>,
  audioStartMs: number,
  itemId?: string
): void {
  ws.send(JSON.stringify({
    type: 'input_audio_buffer.speech_started',
    event_id: generateEventId(),
    audio_start_ms: audioStartMs,
    item_id: itemId || generateItemId(),
  }));
}

/**
 * Send input_audio_buffer.speech_stopped event
 */
export function sendSpeechStopped(
  ws: ServerWebSocket<SessionData>,
  audioEndMs: number,
  itemId?: string
): void {
  ws.send(JSON.stringify({
    type: 'input_audio_buffer.speech_stopped',
    event_id: generateEventId(),
    audio_end_ms: audioEndMs,
    item_id: itemId || generateItemId(),
  }));
}

/**
 * Send input_audio_buffer.cleared event
 */
export function sendAudioBufferCleared(ws: ServerWebSocket<SessionData>): void {
  ws.send(JSON.stringify({
    type: 'input_audio_buffer.cleared',
    event_id: generateEventId(),
  }));
}

/**
 * Send conversation.item.created event
 */
export function sendConversationItemCreated(
  ws: ServerWebSocket<SessionData>,
  item: ConversationItem
): void {
  ws.send(JSON.stringify({
    type: 'conversation.item.created',
    event_id: generateEventId(),
    item,
  }));
}

/**
 * Send conversation.item.retrieved event
 */
export function sendConversationItemRetrieved(
  ws: ServerWebSocket<SessionData>,
  item: ConversationItem
): void {
  ws.send(JSON.stringify({
    type: 'conversation.item.retrieved',
    event_id: generateEventId(),
    item,
  }));
}

/**
 * Send conversation.item.truncated event
 */
export function sendConversationItemTruncated(
  ws: ServerWebSocket<SessionData>,
  itemId: string,
  contentIndex: number,
  audioEndMs: number
): void {
  ws.send(JSON.stringify({
    type: 'conversation.item.truncated',
    event_id: generateEventId(),
    item_id: itemId,
    content_index: contentIndex,
    audio_end_ms: audioEndMs,
  }));
}

/**
 * Send conversation.item.input_audio_transcription.completed event
 */
export function sendTranscriptionCompleted(
  ws: ServerWebSocket<SessionData>,
  itemId: string,
  contentIndex: number,
  transcript: string
): void {
  ws.send(JSON.stringify({
    type: 'conversation.item.input_audio_transcription.completed',
    event_id: generateEventId(),
    item_id: itemId,
    content_index: contentIndex,
    transcript,
  }));
}

/**
 * Send session.updated event
 */
export function sendSessionUpdated(
  ws: ServerWebSocket<SessionData>,
  sessionId: string,
  model: string,
  config: any
): void {
  ws.send(JSON.stringify({
    type: 'session.updated',
    event_id: generateEventId(),
    session: {
      id: sessionId,
      object: 'realtime.session',
      model,
      ...config,
    },
  }));
}

/**
 * Send debug.latency_response event
 */
export function sendDebugLatencyResponse(
  ws: ServerWebSocket<SessionData>,
  current: any,
  historical?: any[]
): void {
  ws.send(JSON.stringify({
    type: 'debug.latency_response',
    event_id: generateEventId(),
    metrics: {
      current: current || null,
      historical: historical,
    },
  }));
}



/**
 * Send session.hibernate event
 * Notifies client that session is entering hibernation mode
 */
export function sendSessionHibernated(
  ws: ServerWebSocket<SessionData>,
  sessionId: string
): void {
  ws.send(JSON.stringify({
    type: 'session.hibernate',
    event_id: generateEventId(),
    session: {
      id: sessionId,
      hibernated: true,
    },
  }));
}

/**
 * Send session.resumed event
 * Notifies client that session has resumed from hibernation
 */
export function sendSessionResumed(
  ws: ServerWebSocket<SessionData>,
  sessionId: string
): void {
  ws.send(JSON.stringify({
    type: 'session.resumed',
    event_id: generateEventId(),
    session: {
      id: sessionId,
      hibernated: false,
    },
  }));
}