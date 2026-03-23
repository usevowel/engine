/**
 * Speak Tool Executor
 * 
 * Server-side executor for the 'speak' tool.
 * Handles TTS synthesis and audio streaming in explicit speech mode.
 */

import { generateItemId } from '../../lib/protocol';
import { SessionManager } from '../../session/SessionManager';
import { synthesizeTextWithProvider } from '../../session/utils/audio-utils';
import {
  sendAudioTranscriptDelta,
  sendAudioDelta,
} from '../../session/utils/event-sender';
import { getEventSystem, EventCategory } from '../../events';
import type { ServerToolContext, ServerToolResult } from '../server-tool-registry';

/**
 * Execute the speak tool
 * 
 * Synthesizes text via TTS and streams audio chunks to the client.
 * This is ONLY called in explicit speech mode.
 * 
 * @param args - Tool arguments (must contain 'message' field)
 * @param context - Server tool execution context
 * @returns Tool execution result
 */
export async function executeSpeakTool(
  args: Record<string, any>,
  context: ServerToolContext
): Promise<ServerToolResult> {
  const message = args?.message || '';
  const { ws, sessionData, responseId, itemId, voice, speakingRate, latency } = context;
  
  getEventSystem().info(EventCategory.SESSION, `🎤 [Explicit Mode] speak tool called with message: "${message.substring(0, 50)}..."`);

  // Get providers if needed
  if (!sessionData.providers) {
    sessionData.providers = await SessionManager.getProviders(sessionData.runtimeConfig!);
  }
  
  // Get current language from session state
  const currentLanguage = sessionData.language?.current || 
                         sessionData.language?.configured || 
                         'en';
  
  const voiceForTTS = sessionData.config?.voice || voice;
  
  // Synthesize speech
  const ttsStart = Date.now();
  const audioChunks = await synthesizeTextWithProvider(
    sessionData.providers,
    message,
    voiceForTTS,
    speakingRate,
    sessionData.currentTraceId, // Pass unified trace ID for agent analytics
    sessionData.sessionId,
    sessionData.sessionKey,
    'direct', // TODO: Detect connection paradigm
    currentLanguage // Use current language from session state
  );
  const ttsEnd = Date.now();
  
  latency.ttsChunks.push({ 
    text: message.substring(0, 30), 
    start: ttsStart, 
    end: ttsEnd 
  });
  
  getEventSystem().info(EventCategory.TTS, `⏱️  [Explicit Mode] TTS synthesis: ${ttsEnd - ttsStart}ms for ${message.length} chars`);
  
  // Send transcript delta
  sendAudioTranscriptDelta(ws, responseId, itemId, message);
  
  // Stream audio chunks
  for (const chunk of audioChunks) {
    if (sessionData.currentResponseId !== responseId) {
      getEventSystem().info(EventCategory.AUDIO, `⚡ Response ${responseId} cancelled during audio streaming - stopping`);
      return { success: false, error: 'Response cancelled' };
    }
    
    // Track first audio sent for TTFS (user speech end → first AI audio sent)
    if (latency.firstAudioSent === 0) {
      latency.firstAudioSent = Date.now();
      const ttfs = sessionData.speechEndTime 
        ? latency.firstAudioSent - sessionData.speechEndTime 
        : 0;
      getEventSystem().info(EventCategory.AUDIO, `🎵 First audio sent: TTFS = ${ttfs}ms (user speech end → first AI audio)`);
      
      if (sessionData.acknowledgementService) {
        sessionData.acknowledgementService.stopMonitoring();
      }
      if (sessionData.typingSoundService) {
        sessionData.typingSoundService.stopPlaying();
      }
    }
    
    sendAudioDelta(ws, responseId, itemId, chunk);
  }
  
  return { 
    success: true, 
    addToHistory: true 
  };
}
