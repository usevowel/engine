/**
 * Voice Agent Component
 * 
 * Manages the WebSocket connection to the voice agent and handles
 * all real-time interactions.
 * 
 * Debug Mode:
 * To enable automatic latency metrics fetching, set in browser console:
 *   window.__DEBUG_LATENCY__ = true
 * 
 * This will automatically request latency metrics after each response completes.
 * Metrics are stored server-side and fetched on-demand to avoid message overhead.
 */

import { useCallback, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { StatusIndicator } from './StatusIndicator';
import { Controls } from './Controls';
import { Transcript } from './Transcript';
import { DebugPanel } from './DebugPanel';
import { VUMeter } from './VUMeter';
import { LatencyGantt } from './LatencyGantt';
import { getConfig } from '../config';
import { actions, store } from '../store';
import './VoiceAgent.css';

// Define hard-coded weather tool
const getWeatherTool = tool({
  name: 'get_weather',
  description: 'Get the current weather for a location. Returns temperature, conditions, and humidity.',
  parameters: z.object({
    location: z.string().describe('The city or location to get weather for'),
  }),
  execute: async ({ location }) => {
    console.log(`🌤️ [Tool] get_weather called for location: ${location}`);
    
    // Return hard-coded weather data
    const weatherData = {
      location,
      temperature: 79,
      unit: 'fahrenheit',
      conditions: 'windy and rainy',
      humidity: 68,
    };
    
    console.log(`🌤️ [Tool] Returning weather data:`, weatherData);
    return weatherData;
  },
});

// Define a more complex tool with multiple parameters
const scheduleEventTool = tool({
  name: 'schedule_event',
  description: 'Schedule a calendar event with a title, date, time, and optional description.',
  parameters: z.object({
    title: z.string().describe('The title of the event'),
    date: z.string().describe('The date of the event in YYYY-MM-DD format'),
    time: z.string().describe('The time of the event in HH:MM format (24-hour)'),
    duration: z.number().describe('Duration in minutes'),
    description: z.string().nullable().optional().describe('Optional description of the event'),
  }),
  execute: async ({ title, date, time, duration, description }) => {
    console.log(`📅 [Tool] schedule_event called with:`);
    console.log(`   Title: ${title}`);
    console.log(`   Date: ${date}`);
    console.log(`   Time: ${time}`);
    console.log(`   Duration: ${duration} minutes`);
    console.log(`   Description: ${description || 'N/A'}`);
    
    // Return confirmation data
    const eventData = {
      success: true,
      eventId: `evt_${Date.now()}`,
      title,
      date,
      time,
      duration,
      description: description || null,
      message: `Event "${title}" scheduled for ${date} at ${time} (${duration} minutes)`,
    };
    
    console.log(`📅 [Tool] Event scheduled:`, eventData);
    return eventData;
  },
});

export function VoiceAgent() {
  // Use refs for session/agent to avoid Valtio proxy issues
  const sessionRef = useRef<RealtimeSession | null>(null);
  const agentRef = useRef<RealtimeAgent | null>(null);
  
  // Subscribe to store for latency data
  const snap = useSnapshot(store);
  
  // VU meter state
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  
  // Audio playback state
  const playbackContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef<number>(0);

  /**
   * Queue and play audio chunks in order
   */
  const playAudioChunk = useCallback(async (pcm16Data: ArrayBuffer) => {
    // TTS sample rate - 24000 Hz for OpenAI Realtime API (both Inworld and Piper)
    const TTS_SAMPLE_RATE = 24000;
    
    // Initialize playback context if needed
    if (!playbackContextRef.current) {
      playbackContextRef.current = new AudioContext({ sampleRate: TTS_SAMPLE_RATE });
      console.log(`[Playback] AudioContext created for playback at ${TTS_SAMPLE_RATE}Hz`);
      console.log(`[Playback] Actual sample rate: ${playbackContextRef.current.sampleRate}Hz`);
      console.log(`[Playback] Initial state: ${playbackContextRef.current.state}`);
    }

    const ctx = playbackContextRef.current;
    
    // Resume AudioContext if suspended (required by browser autoplay policies)
    if (ctx.state === 'suspended') {
      console.log('[Playback] AudioContext suspended, resuming...');
      try {
        await ctx.resume();
        console.log(`[Playback] AudioContext resumed, new state: ${ctx.state}`);
      } catch (error) {
        console.error('[Playback] Failed to resume AudioContext:', error);
        throw error;
      }
    }
    
    // Convert PCM16 to Float32Array
    const pcm16 = new Int16Array(pcm16Data);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
    }

    // Debug: Check audio level
    let maxAmplitude = 0;
    for (let i = 0; i < float32.length; i++) {
      maxAmplitude = Math.max(maxAmplitude, Math.abs(float32[i]));
    }
    console.log(`[Playback] Chunk: ${pcm16.length} samples (${(pcm16.length / TTS_SAMPLE_RATE).toFixed(3)}s), max amplitude: ${maxAmplitude.toFixed(3)}`);

    // Create audio buffer
    const audioBuffer = ctx.createBuffer(1, float32.length, TTS_SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(float32);

    // Verify AudioContext is running before scheduling playback
    if (ctx.state !== 'running') {
      console.warn(`[Playback] AudioContext not running (state: ${ctx.state}), attempting to resume...`);
      try {
        await ctx.resume();
        console.log(`[Playback] AudioContext resumed, state: ${ctx.state}`);
      } catch (error) {
        console.error('[Playback] Failed to resume AudioContext:', error);
        throw new Error(`Cannot play audio: AudioContext is ${ctx.state}`);
      }
    }

    // Schedule playback to prevent gaps/overlaps
    const currentTime = ctx.currentTime;
    const startTime = Math.max(currentTime, nextPlayTimeRef.current);
    
    // Create source and schedule
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    
    try {
      source.start(startTime);
      console.log(`[Playback] Scheduled at ${startTime.toFixed(3)}s (current: ${currentTime.toFixed(3)}s, duration: ${audioBuffer.duration.toFixed(3)}s, state: ${ctx.state})`);
    } catch (error) {
      console.error('[Playback] Failed to start audio source:', error);
      throw error;
    }
    
    // Update next play time
    nextPlayTimeRef.current = startTime + audioBuffer.duration;
  }, []);

  /**
   * Request microphone access
   */
  const requestMicrophoneAccess = useCallback(async (): Promise<MediaStream> => {
    console.log('[Microphone] Requesting microphone access...');
    console.log('[Microphone] Secure context:', window.isSecureContext);
    console.log('[Microphone] HTTPS:', window.location.protocol === 'https:');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('MediaDevices API not available');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    console.log('[Microphone] ✅ Access granted');
    console.log('[Microphone] Tracks:', stream.getAudioTracks().length);

    return stream;
  }, []);

  /**
   * Get ephemeral token from backend
   */
  const getEphemeralToken = useCallback(async (): Promise<string> => {
    // Access store directly for current values (not snapshot)
    const selectedEnv = store.selectedEnvironment;
    const customUrl = store.customEnvironmentUrl;
    const selectedProvider = store.selectedProvider;
    const selectedModel = store.selectedModel;
    const customModel = store.customModel;
    const selectedLanguage = store.selectedLanguage;
    const languageDetectionEnabled = store.languageDetectionEnabled;
    
    // Determine the effective model (use custom if selected, otherwise use selected)
    const effectiveModel = selectedModel === 'custom' ? customModel : selectedModel;
    
    // Get current config based on selected environment
    const config = getConfig(selectedEnv, customUrl);
    console.log('[Token] Requesting from backend...');
    console.log(`[Token] Environment: ${selectedEnv}`);
    console.log(`[Token] Server URL: ${config.serverUrl}`);
    console.log(`[Token] Provider: ${selectedProvider}`);
    console.log(`[Token] Model: ${effectiveModel}`);
    console.log(`[Token] Language: ${selectedLanguage}`);
    console.log(`[Token] Language Detection: ${languageDetectionEnabled ? 'enabled' : 'disabled'}`);

    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        environment: selectedEnv,
        customUrl: selectedEnv === 'custom' ? customUrl : undefined,
        llmProvider: selectedProvider,
        model: effectiveModel,
        language: selectedLanguage,
        languageDetection: {
          enabled: languageDetectionEnabled,
          confidenceThreshold: 0.8,
          // minConsecutiveDetections: 2,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to get token');
    }

    const data = await response.json();
    console.log('[Token] ✅ Received:', data.client_secret.value.substring(0, 20) + '...');

    return data.client_secret.value;
  }, []);

  /**
   * Fetch latency metrics from server (debug mode only)
   */
  const fetchLatencyMetrics = (session: RealtimeSession) => {
    console.log('[Debug] Requesting latency metrics...');
    
    // Send debug message to server
    // Note: This is NOT a real protocol event, it's a custom debug message
    const wsTransport = (session as any).transport;
    if (wsTransport && wsTransport.send) {
      wsTransport.send({
        type: 'debug.get_latency',
        includeHistory: true,
      });
    } else {
      console.warn('[Debug] Could not access WebSocket transport to send debug message');
    }
  };

  /**
   * Set up event listeners for the session
   */
  const setupEventListeners = useCallback((session: RealtimeSession) => {
    console.log('[Events] Setting up listeners...');
    actions.logEvent('setup', 'Setting up event listeners');
    
    // Log ALL events from the session for debugging
    const originalOn = session.on.bind(session);
    (session as any).on = function(event: string, handler: any) {
      return originalOn(event, (...args: any[]) => {
        console.log(`[Session Event] ${event}:`, ...args);
        return handler(...args);
      });
    };

    // Conversation updates
    session.on('conversation.updated', (event: any) => {
      console.log('[Events] Conversation updated:', event);
      actions.logEvent('conversation', 'Conversation updated', event);
      
      if (event.item?.type === 'message') {
        const content =
          event.item.content?.[0]?.transcript ||
          event.item.content?.[0]?.text ||
          '';
        if (content) {
          actions.addTranscript(event.item.role, content);
        }
      }
    });

    // Response lifecycle
    session.on('response.created', (event: any) => {
      console.log('[Events] Response created:', event);
      actions.logEvent('response', 'Response created');
      actions.updateStatus('speaking', '🔊 AI is speaking...');
      
      // Clear latency phases for new response
      actions.clearLatencyPhases();
      if (event.response?.id) {
        actions.setCurrentResponseId(event.response.id);
      }
    });

    session.on('response.done', () => {
      console.log('[Events] Response done');
      actions.logEvent('response', 'Response done');
      actions.updateStatus('listening', '🎤 Listening... Speak now!');
      actions.setCurrentResponseId(null);
      
      // Automatically fetch latency metrics after response completes (debug mode)
      if ((window as any).__DEBUG_LATENCY__) {
        fetchLatencyMetrics(session);
      }
    });
    
    // Listen for debug latency responses
    session.on('debug.latency_response', (event: any) => {
      console.log('[Debug] Latency metrics received:', event.metrics);
      actions.logEvent('debug', 'Latency metrics received', event.metrics);
      
      // Process and store latency data
      if (event.metrics?.current) {
        const m = event.metrics.current;
        // Convert to legacy format for existing UI
        if (m.llmFirstToken) {
          actions.addLatencyPhase({
            phase: 'llm_first_token',
            timestamp: m.timestamp,
            duration: m.llmFirstToken,
          });
        }
        if (m.ttfs) {
          actions.addLatencyPhase({
            phase: 'first_audio',
            timestamp: m.timestamp,
            ttfs: m.ttfs,
          });
        }
        if (m.llmDuration) {
          actions.addLatencyPhase({
            phase: 'llm_end',
            timestamp: m.timestamp + (m.llmDuration || 0),
            duration: m.llmDuration,
            tokenCount: m.llmTokenCount,
          });
        }
      }
    });

    // Audio output - SDK processes response.output_audio.delta and emits 'audio' event
    session.on('audio', (event: any) => {
      console.log('[Events] Audio received:', event.data?.byteLength || 0, 'bytes');
      actions.logEvent('audio', `Audio chunk received: ${event.data?.byteLength || 0} bytes`);
      
      // Play the audio (SDK already decoded base64 to ArrayBuffer)
      if (event.data && event.data.byteLength > 0) {
        playAudioChunk(event.data).catch((err) => {
          console.error('[Playback] Error playing audio:', err);
          actions.logEvent('error', `Audio playback failed: ${err.message || err}`);
          
          // Log AudioContext state for debugging
          if (playbackContextRef.current) {
            console.error(`[Playback] AudioContext state: ${playbackContextRef.current.state}`);
            console.error(`[Playback] AudioContext sample rate: ${playbackContextRef.current.sampleRate}Hz`);
          }
        });
      } else {
        console.warn('[Events] Audio event received but data is empty or invalid');
      }
    });
    
    // Reset playback timing when response starts
    session.on('response.created', () => {
      nextPlayTimeRef.current = 0;
      console.log('[Playback] Reset playback queue for new response');
    });

    // User speech detection - triggers interrupt
    // IMPORTANT: The SDK emits 'audio_interrupted', NOT 'input_audio_buffer.speech_started'
    // The SDK receives 'input_audio_buffer.speech_started' from server and processes it internally,
    // then emits 'audio_interrupted' for client code to handle
    session.on('audio_interrupted', () => {
      console.log('[Events] ⚡ Audio interrupted - stopping playback');
      actions.logEvent('speech', 'Audio interrupted (user speech detected)');
      actions.updateStatus('listening', '🎤 Listening...');
      
      // Stop audio playback immediately on interrupt
      if (playbackContextRef.current) {
        try {
          // Close the current audio context entirely to stop all playback immediately
          const oldContext = playbackContextRef.current;
          playbackContextRef.current = null;
          nextPlayTimeRef.current = 0;
          isPlayingRef.current = false;
          
          // Clear the audio queue to prevent old audio from playing
          const queueLength = audioQueueRef.current.length;
          audioQueueRef.current = [];
          console.log(`[Interrupt] 🗑️  Cleared ${queueLength} queued audio chunks`);
          
          // Close the old context (this stops all sources immediately)
          oldContext.close().then(() => {
            console.log('[Interrupt] ✅ Audio context closed and playback stopped');
          }).catch((err) => {
            console.warn('[Interrupt] Error closing audio context:', err);
          });
          
          // Create a fresh audio context for new audio (24kHz for OpenAI Realtime API)
          playbackContextRef.current = new AudioContext({ sampleRate: 24000 });
          console.log('[Interrupt] ✅ New audio context created at 24kHz');
          
          // Resume the new context if suspended (required by browser autoplay policies)
          if (playbackContextRef.current.state === 'suspended') {
            playbackContextRef.current.resume().then(() => {
              console.log(`[Interrupt] ✅ New AudioContext resumed, state: ${playbackContextRef.current?.state}`);
            }).catch((err) => {
              console.warn('[Interrupt] Failed to resume new AudioContext:', err);
            });
          }
        } catch (error) {
          console.error('[Interrupt] Error stopping audio:', error);
        }
      }
    });

    // Response cancelled - additional safeguard for interrupt handling
    session.on('response.cancelled', (event: any) => {
      console.log('[Events] 🚫 Response cancelled:', event?.response?.id);
      actions.logEvent('response', 'Response cancelled (interrupted)');
      
      // Ensure audio playback is stopped (redundant with speech_started, but safer)
      if (playbackContextRef.current) {
        try {
          const oldContext = playbackContextRef.current;
          playbackContextRef.current = null;
          nextPlayTimeRef.current = 0;
          isPlayingRef.current = false;
          
          // Clear audio queue
          const queueLength = audioQueueRef.current.length;
          audioQueueRef.current = [];
          if (queueLength > 0) {
            console.log(`[Cancel] 🗑️  Cleared ${queueLength} queued audio chunks`);
          }
          
          // Close old context
          oldContext.close().catch((err) => {
            console.warn('[Cancel] Error closing audio context:', err);
          });
          
          // Create fresh context for next response
          playbackContextRef.current = new AudioContext({ sampleRate: 24000 });
          console.log('[Cancel] ✅ Audio stopped and reset');
        } catch (error) {
          console.error('[Cancel] Error stopping audio:', error);
        }
      }
    });

    session.on('input_audio_buffer.speech_stopped', () => {
      console.log('[Events] User speech stopped');
      actions.logEvent('speech', 'User speech stopped');
      actions.updateStatus('listening', '⏳ Processing...');
    });

    // Function calls (tool execution)
    session.on('function_call', (event: any) => {
      console.log('[Events] 🔧 Function call received:', event);
      actions.logEvent('tool', `Tool call: ${event.name}`, event);
      actions.addTranscript('system', `🔧 Calling tool: ${event.name}(${event.arguments})`);
    });

    // Errors
    session.on('error', (error: any) => {
      console.error('[Events] Session error:', error);
      
      // Check if this is a session timeout (graceful disconnect, not an error)
      // Note: The error structure is nested: error.error.error.type === 'session_timeout'
      if (error.error?.error?.type === 'session_timeout' || error.error?.type === 'session_timeout' || error.type === 'session_timeout') {
        const message = error.error?.error?.message || error.error?.message || error.message || 'Session ended';
        console.log('[Events] Session timeout (graceful disconnect):', message);
        actions.logEvent('connection', `Session timeout: ${message}`);
        actions.updateStatus('idle', 'Session ended');
        actions.addTranscript('system', message);
        
        // Trigger cleanup like a normal disconnect
        actions.setConnected(false);
        if (mediaStream) {
          mediaStream.getTracks().forEach(track => track.stop());
          setMediaStream(null);
          console.log('[Cleanup] Media stream stopped (from session timeout)');
        }
        if (audioContext) {
          audioContext.close().catch(err => console.warn('[Cleanup] Error closing audio context:', err));
          setAudioContext(null);
          console.log('[Cleanup] Audio context closed (from session timeout)');
        }
      } else {
        // Regular error
        actions.logError('Session error', error);
        actions.updateStatus('error', `Error: ${error.message || 'Unknown error'}`);
        actions.addTranscript('system', `Error: ${error.message || 'Unknown error'}`);
      }
    });

    // Connection disconnected (SDK emits 'disconnected', not 'close')
    // This is emitted by the transport layer when WebSocket closes
    (session as any).on('disconnected', () => {
      console.log('[Events] Connection disconnected (SDK event)');
      actions.logEvent('connection', 'Connection disconnected');
      actions.updateStatus('idle', 'Disconnected');
      actions.addTranscript('system', 'Connection closed by server');
      actions.setConnected(false);
      
      // Clean up audio resources
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        setMediaStream(null);
        console.log('[Cleanup] Media stream stopped (from disconnected event)');
      }
      if (audioContext) {
        audioContext.close().catch(err => console.warn('[Cleanup] Error closing audio context:', err));
        setAudioContext(null);
        console.log('[Cleanup] Audio context closed (from disconnected event)');
      }
    });
    
    // Connection status changes
    (session as any).on('connection_change', (event: any) => {
      console.log('[Events] Connection status changed:', event);
      actions.logEvent('connection', `Connection status: ${event?.status || 'unknown'}`);
      
      if (event?.status === 'disconnected') {
        actions.updateStatus('idle', 'Disconnected');
        actions.setConnected(false);
      } else if (event?.status === 'connected') {
        actions.updateStatus('listening', '🎤 Listening... Speak now!');
        actions.setConnected(true);
      }
    });

    console.log('[Events] ✅ All listeners set up');
    actions.logEvent('setup', 'Event listeners ready');
  }, [playAudioChunk]);

  /**
   * Connect to the voice agent
   */
  const handleConnect = useCallback(async () => {
    try {
      // Access store directly for current values (not snapshot)
      const selectedEnv = store.selectedEnvironment;
      const customUrl = store.customEnvironmentUrl;
      const selectedProvider = store.selectedProvider;
      const selectedModel = store.selectedModel;
      const customModel = store.customModel;
      
      // Determine the effective model (use custom if selected, otherwise use selected)
      const effectiveModel = selectedModel === 'custom' ? customModel : selectedModel;
      
      // Get current config based on selected environment
      const config = getConfig(selectedEnv, customUrl);
      
      actions.updateStatus('connecting', 'Initializing...');
      actions.logEvent('connection', 'Connection initiated', {
        environment: selectedEnv,
        serverUrl: config.serverUrl,
        provider: selectedProvider,
        model: effectiveModel,
        language: store.selectedLanguage,
        languageDetection: store.languageDetectionEnabled,
      });

      // Step 1: Microphone access
      actions.updateStatus('connecting', 'Requesting microphone access...');
      console.log('[Connect] Step 1: Microphone');
      const stream = await requestMicrophoneAccess();
      actions.logEvent('microphone', 'Microphone access granted', {
        tracks: stream.getAudioTracks().length,
        settings: stream.getAudioTracks()[0]?.getSettings(),
      });

      // Step 2: Get token
      actions.updateStatus('connecting', 'Getting authentication token...');
      console.log('[Connect] Step 2: Token');
      const token = await getEphemeralToken();
      actions.logEvent('auth', 'Ephemeral token received', {
        tokenPrefix: token.substring(0, 10) + '...',
      });

      // Step 3: Create agent with tools
      console.log('[Connect] Step 3: Agent');
      
      /**
       * DUAL-PROMPT WORKFLOW
       * 
       * Instructions are separated into two parts using XML-like tags:
       * - <<main_instructions>...</main_instructions> - Instructions for the main agent
       * - <<tool_instructions>...</tool_instructions> - Instructions for the subagent (tool execution)
       * 
       * When subagent mode is enabled:
       * - Main agent receives only main_instructions (sees only askSubagent tool)
       * - Subagent receives tool_instructions when executing tools (sees all client tools)
       * 
       * When subagent mode is disabled:
       * - Main agent receives all instructions (tags are stripped)
       * - All tools are available to the main agent directly
       * 
       * This separation allows:
       * - Main agent to focus on conversation and high-level reasoning
       * - Subagent to focus on precise tool execution with detailed instructions
       */
      
      // Build dual-prompt instructions with tags for main and tool instructions
      const mainInstructions = `You are a helpful assistant. Be concise and friendly. Answer questions clearly.

!!!Always answer in the language that was last spoken by the user. !!!`;

      const toolInstructions = `When asked about weather, use the get_weather tool with the location parameter.
When asked to schedule events, use the schedule_event tool with all required parameters (title, date, time, duration).
Always call tools with correct parameters on the first try.`;

      // Combine instructions with tags for dual-prompt workflow
      const combinedInstructions = `<<main_instructions>
${mainInstructions}
</main_instructions>

<<tool_instructions>
${toolInstructions}
</tool_instructions>`;

      const agent = new RealtimeAgent({
        name: 'Assistant',
        instructions: combinedInstructions, // Will be parsed by server into main/tool instructions
        tools: [getWeatherTool, scheduleEventTool],
      });
      agentRef.current = agent;
      actions.logEvent('agent', 'Agent created with dual-prompt instructions and tools: get_weather, schedule_event');
      console.log('[Connect] ✅ Agent configured with dual-prompt instructions');
      console.log('[Connect]   Main instructions:', mainInstructions.substring(0, 100) + '...');
      console.log('[Connect]   Tool instructions:', toolInstructions.substring(0, 100) + '...');

      // Step 4: Create session with server-side VAD
      console.log('[Connect] Step 4: Session');
      
      // Enable debug logging for the SDK
      (window as any).DEBUG = 'openai-agents:*';
      
      // Use effective model from store, fallback to config.model if not set
      const modelToUse = effectiveModel || config.model;
      
      console.log('[Connect] Using model:', modelToUse);
      console.log('[Connect] Using provider:', selectedProvider);
      
      const session = new RealtimeSession(agent, {
        transport: 'websocket',
        model: modelToUse,
        // Use NEW audio config format (not deprecated turnDetection)
        config: {
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 }, // Input audio (microphone)
              turnDetection: {
                type: 'server_vad',
                threshold: 0.5,
                silenceDurationMs: 550,
                prefixPaddingMs: 0,
                interruptResponse: true, // CRITICAL: Enable interrupt handling
              },
            },
          },
        },
      });
      sessionRef.current = session;
      
      // Log the session configuration for debugging
      console.log('[Connect] Session options:', JSON.stringify((session as any).options, null, 2));
      
      // Log all WebSocket messages for debugging
      const originalSend = (session as any).transport?.send;
      if (originalSend) {
        (session as any).transport.send = function(data: any) {
          console.log('[WS →]', JSON.stringify(data, null, 2));
          return originalSend.call(this, data);
        };
      }
      
      // Hook into the underlying WebSocket close event as a backup
      // The SDK should emit 'disconnected' events, but this ensures cleanup happens
      const setupWebSocketCloseHandler = (stream?: MediaStream, ctx?: AudioContext) => {
        const ws = (session as any).transport?.ws;
        if (ws) {
          console.log('[Connect] Setting up backup WebSocket close handler for cleanup');
          ws.addEventListener('close', (event: CloseEvent) => {
            console.log('[WebSocket] Raw close event (backup handler):', { code: event.code, reason: event.reason, wasClean: event.wasClean });
            
            // Log the close reason for debugging
            if (event.reason) {
              console.log('[WebSocket] Close reason from server:', event.reason);
            }
            
            // Clean up audio context and media stream
            // The SDK's 'disconnected' event handler should update the UI
            if (stream) {
              stream.getTracks().forEach(track => track.stop());
              setMediaStream(null);
              console.log('[Cleanup] Media stream stopped');
            }
            if (ctx) {
              ctx.close().catch(err => console.warn('[Cleanup] Error closing audio context:', err));
              setAudioContext(null);
              console.log('[Cleanup] Audio context closed');
            }
          });
        } else {
          console.warn('[Connect] WebSocket not yet available for backup handler');
        }
      };
      
      actions.logEvent('session', 'Session created with server_vad', {
        model: modelToUse,
        provider: selectedProvider,
        transport: 'websocket',
      });

      // Step 5: Event listeners
      console.log('[Connect] Step 5: Events');
      setupEventListeners(session);

      // Step 6: Connect
      actions.updateStatus('connecting', 'Connecting to voice agent...');
      console.log('[Connect] Step 6: Connect');
      console.log('[Connect] URL:', config.serverUrl);
      actions.logEvent('connection', 'Attempting WebSocket connection', {
        url: config.serverUrl,
      });

      await session.connect({
        apiKey: token,
        url: config.serverUrl,
      });

      console.log('[Connect] ✅ Connected!');
      actions.logEvent('connection', 'WebSocket connected successfully');

      // Step 6.5: Send session.update with dual-prompt instructions
      // The SDK may send instructions automatically, but we ensure they're sent
      // with the proper dual-prompt format via session.update
      try {
        // Access the underlying transport to send session.update event
        const transport = (session as any).transport;
        if (transport && transport.send) {
          const sessionUpdateEvent = {
            type: 'session.update',
            session: {
              instructions: combinedInstructions,
            },
          };
          
          console.log('[Connect] Sending session.update with dual-prompt instructions');
          console.log('[Connect] Instructions preview:', combinedInstructions.substring(0, 200) + '...');
          transport.send(sessionUpdateEvent);
          actions.logEvent('session', 'Sent session.update with dual-prompt instructions');
        } else {
          console.log('[Connect] Transport not available, instructions sent via agent constructor');
        }
      } catch (error) {
        console.warn('[Connect] Could not send session.update explicitly:', error);
        // Not critical - instructions may have been sent via agent constructor
      }

      // Step 7: Set up audio capture and streaming
      console.log('[Connect] Step 7: Audio streaming');
      const audioCtx = new AudioContext({ sampleRate: 24000 }); // Input audio context
      
      // Log the ACTUAL sample rate (browser may ignore our request)
      const actualSampleRate = audioCtx.sampleRate;
      console.log(`[Audio] Input AudioContext - Requested: 24000 Hz, Actual: ${actualSampleRate} Hz`);
      actions.logEvent('audio', `Input AudioContext sample rate: ${actualSampleRate} Hz (requested 24000 Hz)`);
      
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);

      source.connect(processor);
      processor.connect(audioCtx.destination);

      let chunkCount = 0;
      processor.onaudioprocess = (event) => {
        const inputBuffer = event.inputBuffer.getChannelData(0);
        
        // Resample to 24kHz if needed
        let samples = inputBuffer;
        if (actualSampleRate !== 24000) {
          const targetLength = Math.floor(inputBuffer.length * 24000 / actualSampleRate);
          const resampled = new Float32Array(targetLength);
          for (let i = 0; i < targetLength; i++) {
            const srcIdx = (i * actualSampleRate / 24000);
            const idx = Math.floor(srcIdx);
            const frac = srcIdx - idx;
            if (idx + 1 < inputBuffer.length) {
              resampled[i] = inputBuffer[idx] * (1 - frac) + inputBuffer[idx + 1] * frac;
            } else {
              resampled[i] = inputBuffer[idx];
            }
          }
          samples = resampled;
          
          // Log resampling info once
          if (chunkCount === 0) {
            console.log(`[Audio] Resampling ${actualSampleRate}Hz → 24000Hz (${inputBuffer.length} → ${samples.length} samples)`);
          }
        }
        chunkCount++;
        
        // Convert Float32Array to PCM16
        const pcm16 = new ArrayBuffer(samples.length * 2);
        const view = new DataView(pcm16);
        for (let i = 0; i < samples.length; i++) {
          let s = Math.max(-1, Math.min(1, samples[i]));
          s = s < 0 ? s * 0x8000 : s * 0x7fff;
          view.setInt16(i * 2, s, true); // little-endian
        }

        // Send audio to session
        session.sendAudio(pcm16);
      };

      console.log('[Connect] ✅ Audio streaming started');
      actions.logEvent('audio', 'Audio capture and streaming started');
      
      // Set VU meter state
      setAudioContext(audioCtx);
      setMediaStream(stream);
      
      // Now set up the raw WebSocket close handler with audio cleanup
      setupWebSocketCloseHandler(stream, audioCtx);
      
      actions.updateStatus('listening', '🎤 Listening... Speak now!');
      actions.setConnected(true);
      actions.addTranscript('system', 'Connected! Start speaking to interact.');
    } catch (error) {
      console.error('[Connect] ❌ Error:', error);
      actions.logError('Connection failed', error);
      actions.updateStatus('error', `Error: ${(error as Error).message}`);
      actions.addTranscript('system', `Connection failed: ${(error as Error).message}`);
    }
  }, [
    requestMicrophoneAccess,
    getEphemeralToken,
    setupEventListeners,
  ]);

  /**
   * Disconnect from the voice agent
   */
  const handleDisconnect = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    agentRef.current = null;

    // Clean up audio context and media stream
    if (audioContext) {
      audioContext.close();
      setAudioContext(null);
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      setMediaStream(null);
    }
    
    // Clean up playback context
    if (playbackContextRef.current) {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextPlayTimeRef.current = 0;

    actions.logEvent('connection', 'Disconnect requested');
    actions.reset();
    console.log('[Disconnect] Disconnected');
  }, [audioContext, mediaStream]);

  return (
    <div className="voice-agent">
      <StatusIndicator />
      <Controls
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />
      <VUMeter audioContext={audioContext} mediaStream={mediaStream} />
      <LatencyGantt phases={snap.latencyPhases} responseId={snap.currentResponseId} />
      <Transcript />
      <DebugPanel />
    </div>
  );
}

