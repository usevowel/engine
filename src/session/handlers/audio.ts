/**
 * Audio Event Handlers
 * 
 * Handlers for audio buffer events (append, commit, clear).
 */

import { ServerWebSocket } from 'bun';
import { base64ToUint8Array, concatenateAudio } from '../../lib/audio';
import { generateEventId, generateItemId } from '../../lib/protocol';
import { transcribeAudio, isValidAudioBuffer } from '../../services/transcription';
import { SessionManager } from '../SessionManager';
import { sendError } from '../utils/errors';
import { 
  sendSpeechStarted, 
  sendSpeechStopped, 
  sendConversationItemCreated,
  sendTranscriptionCompleted,
  sendAudioBufferCleared,
  sendResponseCancelled
} from '../utils/event-sender';
import { trackSilenceStart, clearSilenceTracking, shouldHibernate, enterHibernation, exitHibernation } from '../utils/hibernation';
import { processVAD } from '../vad/processor';
import type { SessionData } from '../types';
import type { ConversationItem } from '../../lib/protocol';

import { getEventSystem, EventCategory } from '../../events';
import { getOrCreateService, getServiceForTrace } from '../../lib/agent-analytics';
import { cleanupSTTTranscription } from '../../services/stt-pre-filter';
import { GroqWhisperSTT } from '../../../packages/provider-groq-whisper-stt/src';
import { LanguageDetectionService } from '../../services/language-detection/LanguageDetectionService';
// Forward declaration - will be imported from response/index.ts
let generateResponse: (ws: ServerWebSocket<SessionData>, options?: any) => Promise<void>;

function usesIntegratedTurnDetection(data: SessionData): boolean {
  return !!data.runtimeConfig && SessionManager.isVADIntegrated(data.runtimeConfig);
}

function isExplicitClientSideVAD(data: SessionData): boolean {
  return data.config.turn_detection === null && !usesIntegratedTurnDetection(data);
}

function shouldUseStreamingSTT(data: SessionData): boolean {
  return data.providers?.stt.type === 'streaming' && (
    usesIntegratedTurnDetection(data) || data.config.turn_detection !== null
  );
}

/**
 * Set the generateResponse function (to avoid circular dependency)
 */
export function setGenerateResponse(fn: typeof generateResponse): void {
  generateResponse = fn;
}

/**
 * Handle input_audio_buffer.append event
 * 
 * This follows the OpenAI Realtime API protocol for audio streaming:
 * - Client sends multiple append events with audio chunks
 * - Server accumulates chunks in data.audioBuffer
 * - When commit event is received, accumulated buffer is transcribed
 * 
 * This pattern prevents stack overflow errors that occur when trying to
 * send large audio buffers (>300KB) in a single operation.
 */
export async function handleAudioAppend(ws: ServerWebSocket<SessionData>, event: any): Promise<void> {
  const data = ws.data;
  
  // Check if session is hibernated - wake up on audio input
  // This follows OpenAI Realtime API compliance: server wakes automatically
  // when receiving input_audio_buffer.append events while hibernated
  if (data.hibernated) {
    getEventSystem().info(EventCategory.SESSION, '☀️ Waking from hibernation - audio received');
    
    await exitHibernation(ws, async () => {
      if (!shouldUseStreamingSTT(data)) {
        getEventSystem().info(EventCategory.STT, '⏭️ Skipping STT stream reinit in explicit client-side VAD mode');
        return;
      }

      // Reinitialize STT stream
      // Use same callbacks as initial STT setup
      data.sttStream = await data.providers!.stt.startStream({
        onPartial: (text) => {
          getEventSystem().info(EventCategory.STT, '📝 [STT] Partial:', { text });
        },
        onFinal: async (result) => {
          getEventSystem().info(EventCategory.STT, '✅ [STT] Final:', { text: result.text });
          await handleStreamingTranscript(ws, result.text);
        },
        onVADEvent: async (event) => {
          getEventSystem().info(EventCategory.STT, '🗣️  [STT] VAD event:', { event: String(event) });
          
          if (event === 'speech_start') {
            getEventSystem().info(EventCategory.VAD, '🗣️  Speech started (integrated VAD)');
            
            // Start turn lifecycle tracking
            if (data.turnTracker) {
              const turnTracker = data.turnTracker as any;
              turnTracker.startTurn();
              turnTracker.trackSTTStart();
            }
            
            // Create agent analytics service if PostHog is enabled
            if (data.posthogConfig?.enabled && data.posthogConfig?.apiKey && data.currentTraceId) {
              try {
                const traceId = data.currentTraceId;
                const sttProvider = data.providers!.stt.name || 'unknown';
                const analyticsService = getOrCreateService(
                  traceId,
                  data.sessionId,
                  {
                    apiKey: data.posthogConfig.apiKey,
                    host: data.posthogConfig.host,
                  },
                  {
                    startTrace: true,
                    spanName: 'voice_turn',
                    inputState: { sttProvider, streaming: true },
                  }
                );
                
                analyticsService.trackSTTStart({
                  sttProvider,
                  audioDurationMs: 0,
                  audioBufferSize: 0,
                });
              } catch (error) {
                getEventSystem().error(EventCategory.STT, 'Failed to create agent analytics service for streaming STT', error instanceof Error ? error : new Error(String(error)));
              }
            }
            
            // Update last speech time for idle detection
            ws.data.lastSpeechTime = Date.now();
            
            // Interrupt any ongoing response
            if (ws.data.currentResponseId) {
              const cancelledResponseId = ws.data.currentResponseId;
              getEventSystem().info(EventCategory.SESSION, `⚡ User interrupt detected - canceling response ${cancelledResponseId}`);
              ws.data.currentResponseId = null;
              sendResponseCancelled(ws, cancelledResponseId, 'turn_detected');
              getEventSystem().info(EventCategory.SESSION, `📤 Sent response.done(cancelled) for ${cancelledResponseId}`);
            }
            
            // Send speech_started event to client
            sendSpeechStarted(ws, data.totalAudioMs);
            
            // Clear silence tracking on speech start (for hibernation)
            clearSilenceTracking(data);
          } else if (event === 'speech_end') {
            getEventSystem().info(EventCategory.VAD, '🔇 Speech ended (integrated VAD)');
            ws.data.speechEndTime = Date.now();
            sendSpeechStopped(ws, data.totalAudioMs);
            // Start silence tracking on speech end (for hibernation)
            trackSilenceStart(data);
          }
        },
        onError: (error) => {
          getEventSystem().error(EventCategory.STT, '❌ [STT] Error:', error instanceof Error ? error : new Error(String(error)));
        },
      }, data.tokenTurnDetection as any);
    });
    
    getEventSystem().info(EventCategory.SESSION, '✅ Session resumed from hibernation');
  }
  
  // Decode base64 audio
  const audioChunk = base64ToUint8Array(event.audio);
  
  // VALIDATION: Check for suspiciously small audio chunks
  // Expected chunk size at 24kHz: 4096 samples * 2 bytes = 8192 bytes
  // Minimum acceptable: 2048 bytes (1024 samples, ~43ms at 24kHz)
  // Exception: 0-byte chunks are allowed (used as commit signal in some SDKs)
  const MIN_CHUNK_SIZE = 2048;
  const EXPECTED_CHUNK_SIZE = 8192;
  
  // Allow 0-byte chunks (used by some SDKs as commit signal)
  // Just ignore them and wait for the actual commit event
  if (audioChunk.length === 0) {
    getEventSystem().debug(EventCategory.AUDIO, '📭 Received empty audio chunk (likely commit signal), ignoring');
    return;
  }
  
  if (audioChunk.length < MIN_CHUNK_SIZE) {
    getEventSystem().critical(EventCategory.AUDIO, `❌ CRITICAL: Audio chunk too small! Received ${audioChunk.length} bytes, expected ~${EXPECTED_CHUNK_SIZE} bytes`);
    getEventSystem().error(EventCategory.AUDIO, `   This indicates a bug in the client audio processing.`);
    getEventSystem().error(EventCategory.AUDIO, `   Chunk size: ${audioChunk.length} bytes (${audioChunk.length / 2} samples, ${(audioChunk.length / 2 / 24000 * 1000).toFixed(1)}ms @ 24kHz)`);
    
    // Send error to client
    sendError(
      ws,
      'invalid_audio_chunk',
      `Audio chunk too small: ${audioChunk.length} bytes (expected ~${EXPECTED_CHUNK_SIZE} bytes). This indicates a client-side audio processing bug.`
    );
    
// Close connection to prevent further issues after short delay to allow client to process the error
      getEventSystem().error(EventCategory.AUDIO, `🔌 Closing WebSocket due to invalid audio chunk (code: 1003): chunk size ${audioChunk.length} bytes, expected ~${EXPECTED_CHUNK_SIZE} bytes`);
      setTimeout(() => {
        ws.close(1003, 'Invalid audio chunk size - client audio processing error');
      }, 100);
    return;
  }
  
  // Log warning for chunks smaller than expected (but still acceptable)
  if (audioChunk.length < EXPECTED_CHUNK_SIZE && !data.smallChunkWarningLogged) {
    getEventSystem().warn(EventCategory.AUDIO, `⚠️  Audio chunk smaller than expected: ${audioChunk.length} bytes (expected ~${EXPECTED_CHUNK_SIZE} bytes)`);
    data.smallChunkWarningLogged = true;
  }
  
  // Get providers
  if (!data.providers) {
    data.providers = await SessionManager.getProviders(data.runtimeConfig!);
  }
  
  // For streaming STT providers, start a streaming session if not already active
  // GUARD: Check both sttStream and sttStreamInitializing to prevent race conditions
  if (shouldUseStreamingSTT(data) && !data.sttStream && !data.sttStreamInitializing) {
    getEventSystem().info(EventCategory.SESSION, '🎤 Starting streaming STT session');
    getEventSystem().info(EventCategory.SESSION, '🎯 Turn detection config:', { config: data.tokenTurnDetection || 'balanced (default)' });
    
    // Set initializing flag BEFORE async operation to prevent concurrent creation
    data.sttStreamInitializing = true;
    
    try {
      data.sttStream = await data.providers.stt.startStream({
      onPartial: (text) => {
        getEventSystem().info(EventCategory.STT, '📝 [STT] Partial:', { text });
        // Could send partial transcript events here if needed
      },
      onFinal: async (result) => {
        getEventSystem().info(EventCategory.STT, '✅ [STT] Final:', { text: result.text });
        // Handle final transcript
        await handleStreamingTranscript(ws, result.text);
      },
      onVADEvent: async (event) => {
        getEventSystem().info(EventCategory.STT, '🗣️  [STT] VAD event:', { event: String(event) });
        
        // Handle speech_start from integrated VAD (AssemblyAI, Fennec)
        if (event === 'speech_start') {
          getEventSystem().info(EventCategory.VAD, '🗣️  Speech started (integrated VAD)');
          
          // Start turn lifecycle tracking
          if (data.turnTracker) {
            const turnTracker = data.turnTracker as any; // Avoid circular deps
            turnTracker.startTurn();
            turnTracker.trackSTTStart();
          }
          
          // Use session ID as trace ID (set during session initialization)
          // Create agent analytics service if PostHog is enabled and service doesn't exist yet
          if (data.posthogConfig?.enabled && data.posthogConfig?.apiKey && data.currentTraceId) {
            try {
              // Get providers if not already loaded
              if (!data.providers) {
                data.providers = await SessionManager.getProviders(data.runtimeConfig!);
              }
              
              const traceId = data.currentTraceId; // Use session ID as trace ID
              const sttProvider = data.providers.stt.name || 'unknown';
              const analyticsService = getOrCreateService(
                traceId,
                data.sessionId,
                {
                  apiKey: data.posthogConfig.apiKey,
                  host: data.posthogConfig.host,
                },
                {
                  startTrace: true, // Start trace automatically when service is created
                  spanName: 'voice_turn',
                  inputState: { sttProvider, streaming: true },
                }
              );
              
              // Track STT start (for streaming STT, we track when speech starts)
              analyticsService.trackSTTStart({
                sttProvider,
                audioDurationMs: 0, // Unknown for streaming (will be tracked when complete)
                audioBufferSize: 0, // Unknown for streaming
              });
            } catch (error) {
              getEventSystem().error(EventCategory.STT, 'Failed to create agent analytics service for streaming STT', error instanceof Error ? error : new Error(String(error)));
            }
          }
          
          // Update last speech time for idle detection
          ws.data.lastSpeechTime = Date.now();
          
          // Interrupt any ongoing response
          if (ws.data.currentResponseId) {
            const cancelledResponseId = ws.data.currentResponseId;
            getEventSystem().info(EventCategory.SESSION, `⚡ User interrupt detected - canceling response ${cancelledResponseId}`);
            ws.data.currentResponseId = null;
            
            // OpenAI Realtime cancellation terminates with response.done(status=cancelled).
            sendResponseCancelled(ws, cancelledResponseId, 'turn_detected');
            getEventSystem().info(EventCategory.SESSION, `📤 Sent response.done(cancelled) for ${cancelledResponseId}`);
          }
          
          // Send speech_started event to client
          sendSpeechStarted(ws, data.totalAudioMs);
          
          // Clear silence tracking on speech start (for hibernation)
          clearSilenceTracking(data);
        } else if (event === 'speech_end') {
          getEventSystem().info(EventCategory.VAD, '🔇 Speech ended (integrated VAD)');
          
          // Track speech end time for TTFS calculation
          ws.data.speechEndTime = Date.now();
          
          // Send speech_stopped event to client
          sendSpeechStopped(ws, data.totalAudioMs);
          
          // Start silence tracking on speech end (for hibernation)
          trackSilenceStart(data);
        }
      },
      onError: (error) => {
        getEventSystem().error(EventCategory.STT, '❌ [STT] Error:', error instanceof Error ? error : new Error(String(error)));
      },
    }, data.tokenTurnDetection as any); // Pass turn detection config from token
    } finally {
      // Always clear the initializing flag, even if startStream fails
      data.sttStreamInitializing = false;
    }
  }
  
  // Send audio to streaming STT if active
  if (data.sttStream) {
    // Note: Audio continues to be sent even during AI response for interrupt detection
    if (data.sttStream.isActive()) {
      try {
        await data.sttStream.sendAudio(audioChunk);
      } catch (error) {
        getEventSystem().error(EventCategory.STT, '❌ Failed to send audio to STT stream:', error instanceof Error ? error : new Error(String(error)));
      }
    } else {
      // STT stream is still connecting - this is normal for first few chunks
      // Audio will be processed once connection is established
      if (data.totalAudioMs < 1000) {
        // Only log once during initial connection (first second)
        if (!data.sttConnectionWarningLogged) {
          getEventSystem().info(EventCategory.STT, '⏳ [STT] Waiting for streaming connection to complete...');
          data.sttConnectionWarningLogged = true;
        }
      } else {
        // If not active after 1 second, something is wrong
        getEventSystem().warn(EventCategory.STT, '⚠️  STT stream exists but is not active after 1s - cannot send audio');
      }
    }
  } else if (shouldUseStreamingSTT(data)) {
    getEventSystem().warn(EventCategory.STT, '⚠️  No STT stream - audio not being sent to streaming provider');
  }
  
  // Append to buffer (still needed for batch mode and fallback)
  if (!data.audioBuffer) {
    data.audioBuffer = audioChunk;
    data.audioBufferStartMs = data.totalAudioMs;
  } else {
    data.audioBuffer = concatenateAudio([data.audioBuffer, audioChunk]);
  }
  
  // Update total audio time
  const chunkDurationMs = (audioChunk.length / 2 / 24000) * 1000; // PCM16 24kHz
  data.totalAudioMs += chunkDurationMs;
  
  // If VAD is enabled and not integrated, process audio for speech detection
  if (data.vadEnabled && data.config.turn_detection && !SessionManager.isVADIntegrated(data.runtimeConfig!)) {
    await processVAD(ws, audioChunk, data.totalAudioMs, async () => {
      await handleAudioCommit(ws, { type: 'input_audio_buffer.commit' });
    });
  }
}

/**
 * Handle streaming transcript from STT provider
 * Exported for use in server.ts during early STT initialization
 */
export async function handleStreamingTranscript(ws: ServerWebSocket<SessionData>, transcript: string): Promise<void> {
  const data = ws.data;
  
  // Track STT completion for the active turn
  if (data.turnTracker) {
    const turnTracker = data.turnTracker as any; // Avoid circular deps
    turnTracker.trackSTTComplete();
  }
  const itemId = generateItemId();
  
  // Use session ID as trace ID (should be set during session initialization)
  const traceId = data.currentTraceId || data.sessionId;
  
  // Warn if trace ID wasn't set (shouldn't happen, but fallback to session ID)
  if (!data.currentTraceId) {
    getEventSystem().warn(EventCategory.STT, '⚠️ [AgentAnalytics] Trace ID not set, using session ID as fallback', {
      traceId,
      sessionId: data.sessionId,
    });
    data.currentTraceId = data.sessionId; // Set it for future use
  }
  
  // Get providers if not already loaded
  if (!data.providers) {
    data.providers = await SessionManager.getProviders(data.runtimeConfig!);
  }
  
  const sttProvider = data.providers.stt.name || 'unknown';
  
  // Track STT complete (agent analytics)
  // The trace ID and service should already exist from speech_start event
  if (data.posthogConfig?.enabled && data.posthogConfig?.apiKey) {
    try {
      const analyticsService = getServiceForTrace(traceId);
      if (analyticsService) {
        // Track STT complete (transcription is done)
        // For streaming STT, we don't have exact timing, so use 0
        analyticsService.trackSTTComplete({
          sttProvider,
          audioDurationMs: 0, // Unknown for streaming
          transcriptionDurationMs: 0, // Unknown for streaming STT
          transcriptLength: transcript.length,
          transcriptPreview: transcript.substring(0, 100),
        });
      } else {
        getEventSystem().warn(EventCategory.STT, '⚠️ [AgentAnalytics] Analytics service not found for trace', {
          traceId,
          sessionId: data.sessionId,
        });
      }
    } catch (error) {
      getEventSystem().error(EventCategory.STT, 'Failed to track STT complete for streaming STT', error instanceof Error ? error : new Error(String(error)));
    }
  }
  
  // Update last speech time for idle detection
  data.lastSpeechTime = Date.now();
  
  // Pre-filter: Clean up STT transcription using Llama 8B
  let cleanedTranscript = transcript;
  const groqApiKey = data.runtimeConfig?.llm.provider === 'groq'
    ? data.runtimeConfig.llm.apiKey
    : (data.runtimeConfig?.providers?.stt?.provider === 'groq-whisper'
      ? (data.runtimeConfig.providers.stt.config as Record<string, unknown>)?.apiKey as string | undefined
      : undefined);
  
  if (groqApiKey && transcript.trim().length > 0) {
    try {
      // Pass current language to preserve it during cleanup
      const targetLanguage = data.language?.current || data.language?.detected || null;
      cleanedTranscript = await cleanupSTTTranscription(transcript, groqApiKey, targetLanguage);
    } catch (error) {
      getEventSystem().warn(EventCategory.STT,
        `⚠️  [STT Pre-Filter] Failed to clean transcription, using original`, 
        error instanceof Error ? error : new Error(String(error)));
      // Continue with original transcript on error
    }
  }
  
  // Language detection: Non-blocking async call to detect language and set session language
  if (groqApiKey && cleanedTranscript.trim().length >= 3) {
    try {
      const languageDetectionService = new LanguageDetectionService(groqApiKey);
      // This is non-blocking - runs asynchronously
      languageDetectionService.detectAndSetLanguage(cleanedTranscript, data);
    } catch (error) {
      getEventSystem().warn(EventCategory.SESSION,
        `⚠️  [LanguageDetection] Failed to initialize language detection service`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
  
  // Send speech started event
  sendSpeechStarted(ws, 0, itemId);
  
  // Send speech stopped event
  sendSpeechStopped(ws, 0, itemId);
  
  // Create conversation item with cleaned transcript
  const conversationItem: ConversationItem = {
    id: itemId,
    type: 'message',
    status: 'completed',
    role: 'user',
    content: [{
      type: 'input_text',
      text: cleanedTranscript,
    }],
  };
  
  // Add to history
  data.conversationHistory.push(conversationItem);
  
  // Send conversation item created
  sendConversationItemCreated(ws, conversationItem);
  
  // Send transcription completed (use cleaned transcript)
  sendTranscriptionCompleted(ws, itemId, 0, cleanedTranscript);
  
  // Clear audio buffer
  data.audioBuffer = null;
  
  // Automatically trigger response
  await generateResponse(ws);
}

/**
 * Handle input_audio_buffer.commit event
 * 
 * This processes the accumulated audio buffer that was built up from
 * multiple input_audio_buffer.append events. The commit event itself
 * contains no audio data - it's just a signal that says "I'm done sending
 * audio, transcribe what you have."
 * 
 * This matches the OpenAI Realtime API protocol:
 * 1. Client streams chunks via append (N times)
 * 2. Client sends commit signal (1 time)
 * 3. Server transcribes accumulated buffer
 */
export async function handleAudioCommit(ws: ServerWebSocket<SessionData>, event: any): Promise<void> {
  const data = ws.data;
  
  // Check if there's audio to transcribe
  if (!isValidAudioBuffer(data.audioBuffer)) {
    sendError(ws, 'invalid_request_error', 'No audio buffer to commit');
    return;
  }
  
  const itemId = generateItemId();
  const audioBuffer = data.audioBuffer!;
  
  // Update last speech time for idle detection
  data.lastSpeechTime = Date.now();
  
  // Send speech started event
  sendSpeechStarted(ws, 0, itemId);
  
    try {
    // Get providers
    if (!data.providers) {
      data.providers = await SessionManager.getProviders(data.runtimeConfig!);
    }
    
    const sttProvider = data.providers.stt.name || 'unknown';
    const audioDurationMs = (audioBuffer.length / 2 / 24000) * 1000;
    const audioDurationSec = audioDurationMs / 1000;
    
    // Use session ID as trace ID (should be set during session initialization)
    const traceId = data.currentTraceId || data.sessionId;
    if (!data.currentTraceId) {
      data.currentTraceId = data.sessionId; // Set it if not already set
    }
    
    // Create agent analytics service if PostHog is enabled
    let analyticsService;
    if (data.posthogConfig?.enabled && data.posthogConfig?.apiKey) {
      try {
        analyticsService = getOrCreateService(
          traceId,
          data.sessionId,
          {
            apiKey: data.posthogConfig.apiKey,
            host: data.posthogConfig.host,
          },
          {
            startTrace: true, // Start trace automatically when service is created
            spanName: 'voice_turn',
            inputState: { sttProvider, audioDurationMs, audioBufferSize: audioBuffer.length },
          }
        );
        
        // Track STT start
        analyticsService.trackSTTStart({
          sttProvider,
          audioDurationMs,
          audioBufferSize: audioBuffer.length,
        });
      } catch (error) {
        getEventSystem().error(EventCategory.STT, 'Failed to create agent analytics service', error instanceof Error ? error : new Error(String(error)));
      }
    }
    
    // Emit transcription_start event for PostHog (legacy event emitter - keep for now)
    getEventSystem().info(EventCategory.STT, 'transcription_start', {
      sessionId: data.sessionId,
      sttProvider,
      audioDurationMs,
      audioDurationSec,
      audioBufferSize: audioBuffer.length,
    }, ['stt', 'transcription', 'start']);
    
    // Transcribe audio with timing
    const asrStart = Date.now();
    let transcript: string;
    let detectedLanguage: string | undefined;
    
    // Only explicit client-side VAD should force batch transcription.
    // Provider-managed integrated VAD also uses null turn_detection, but still relies on
    // a live streaming STT session.
    const isClientSideVAD = isExplicitClientSideVAD(data);
    
    // Use provider-based transcription
    // When client-side VAD is enabled, always use batch transcription (Groq Whisper)
    // even if the provider type is 'streaming'
    if (data.providers.stt.type === 'streaming' && !isClientSideVAD) {
      // For streaming providers in batch mode, we still use the old method
      // (streaming is handled in handleAudioAppend for real-time)
      const result = await transcribeAudio(audioBuffer);
      transcript = result.text;
      detectedLanguage = result.language;
    } else {
      // Batch transcription (Groq Whisper)
      // When client-side VAD is enabled but current provider doesn't support batch mode
      // (e.g., AssemblyAI), we need to use Groq Whisper instead
      let sttProvider = data.providers.stt;
      
      if (isClientSideVAD && data.providers.stt.type === 'streaming') {
        // Provider doesn't support batch transcription, use Groq Whisper
        getEventSystem().info(EventCategory.STT, '🎤 Client-side VAD enabled with streaming provider - using Groq Whisper for batch transcription');
        sttProvider = new GroqWhisperSTT();
        await sttProvider.initialize();
      }
      
      const result = await sttProvider.transcribe(audioBuffer);
      transcript = result.text;
      detectedLanguage = result.language;
    }
    
    // Log language information if available
    if (detectedLanguage) {
      getEventSystem().info(EventCategory.STT, `🌍 [STT] Language detected in batch transcription: ${detectedLanguage}`, {
        operation: 'stt_language_detection',
        languageCode: detectedLanguage,
        transcriptPreview: transcript.substring(0, 50),
        sttProvider,
      });
    }
    
    const asrEnd = Date.now();
    const asrDuration = asrEnd - asrStart;
    
    // Store ASR duration for latency reporting
    data.lastAsrDuration = asrDuration;
    
    // Track STT complete (agent analytics)
    if (analyticsService) {
      analyticsService.trackSTTComplete({
        sttProvider,
        audioDurationMs,
        transcriptionDurationMs: asrDuration,
        transcriptLength: transcript.length,
        transcriptPreview: transcript.substring(0, 100),
      });
    }
    
    // Emit transcription_complete event for PostHog (legacy event emitter - keep for now)
    getEventSystem().info(EventCategory.STT, 'transcription_complete', {
      sessionId: data.sessionId,
      sttProvider,
      audioDurationMs,
      audioDurationSec,
      transcriptionDurationMs: asrDuration,
      transcriptLength: transcript.length,
      transcriptPreview: transcript.substring(0, 100),
    }, ['stt', 'transcription', 'complete']);
    
    getEventSystem().info(EventCategory.STT, `📝 Transcript: "${transcript}" (ASR: ${asrDuration}ms)`);
    
    // Pre-filter: Clean up STT transcription using Llama 8B
    let cleanedTranscript = transcript;
    const groqApiKey = data.runtimeConfig?.llm.provider === 'groq'
      ? data.runtimeConfig.llm.apiKey
      : (data.runtimeConfig?.providers?.stt?.provider === 'groq-whisper'
        ? (data.runtimeConfig.providers.stt.config as Record<string, unknown>)?.apiKey as string | undefined
        : undefined);
    
    if (groqApiKey && transcript.trim().length > 0) {
      try {
        cleanedTranscript = await cleanupSTTTranscription(transcript, groqApiKey);
      } catch (error) {
        getEventSystem().warn(EventCategory.STT,
          `⚠️  [STT Pre-Filter] Failed to clean transcription, using original`, 
          error instanceof Error ? error : new Error(String(error)));
        // Continue with original transcript on error
      }
    }
    
    // Language detection: Non-blocking async call to detect language and set session language
    if (groqApiKey && cleanedTranscript.trim().length >= 3) {
      try {
        const languageDetectionService = new LanguageDetectionService(groqApiKey);
        // This is non-blocking - runs asynchronously
        languageDetectionService.detectAndSetLanguage(cleanedTranscript, data);
      } catch (error) {
        getEventSystem().warn(EventCategory.SESSION,
          `⚠️  [LanguageDetection] Failed to initialize language detection service`,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
    
    // Clear audio buffer
    data.audioBuffer = null;
    
    // Send speech stopped event
    sendSpeechStopped(ws, 0, itemId);
    
    // Create conversation item with cleaned transcript
    const conversationItem: ConversationItem = {
      id: itemId,
      type: 'message',
      status: 'completed',
      role: 'user',
      content: [{
        type: 'input_text',
        text: cleanedTranscript,
      }],
    };
    
    // Add to history
    data.conversationHistory.push(conversationItem);
    
    // Send conversation item created
    sendConversationItemCreated(ws, conversationItem);
    
    // Send transcription completed (use cleaned transcript)
    sendTranscriptionCompleted(ws, itemId, 0, cleanedTranscript);
    
    // `create_response: false` means the client wants transcription/turn commit
    // without automatically starting the assistant response.
    if (data.config.turn_detection?.create_response !== false) {
      await generateResponse(ws);
    } else {
      getEventSystem().info(EventCategory.STT, '⏭️ Skipping automatic response generation because turn_detection.create_response is false');
    }
    
  } catch (error) {
    getEventSystem().error(EventCategory.STT, '❌ Transcription error:', error instanceof Error ? error : new Error(String(error)));
    data.audioBuffer = null;
    sendError(ws, 'server_error', `Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Handle input_audio_buffer.clear event
 */
export async function handleAudioClear(ws: ServerWebSocket<SessionData>, event: any): Promise<void> {
  ws.data.audioBuffer = null;
  sendAudioBufferCleared(ws);
}
