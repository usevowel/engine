/**
 * Valtio Store
 * 
 * Global state management for the voice agent demo
 */

import { proxy } from 'valtio';
import type { ConnectionStatus, TranscriptMessage } from './config';
import type { LatencyPhase } from './components/LatencyGantt';
import { DEFAULT_ENVIRONMENT } from './config';

interface DebugEvent {
  timestamp: Date;
  type: 'status' | 'event' | 'error' | 'info';
  category?: string;
  message: string;
  data?: any;
}

interface VoiceAgentStore {
  // Connection state
  status: ConnectionStatus;
  statusMessage: string;
  isConnected: boolean;
  
  // Environment selection
  selectedEnvironment: string;
  customEnvironmentUrl: string;
  
  // Provider and model selection
  selectedProvider: 'groq' | 'cerebras' | 'openrouter';
  selectedModel: string;
  customModel: string;
  
  // Language selection
  selectedLanguage: string; // ISO 639-1 code (en, es, fr, de, it, pt)
  languageDetectionEnabled: boolean; // Enable automatic language detection
  
  // Transcript
  transcript: TranscriptMessage[];
  
  // Debug log
  debugLog: DebugEvent[];
  
  // Latency tracking
  latencyPhases: LatencyPhase[];
  currentResponseId: string | null;
}

export const store = proxy<VoiceAgentStore>({
  status: 'idle',
  statusMessage: 'Not connected',
  isConnected: false,
  selectedEnvironment: DEFAULT_ENVIRONMENT,
  customEnvironmentUrl: '',
  selectedProvider: 'groq',
  selectedModel: 'openai/gpt-oss-120b',
  customModel: '',
  selectedLanguage: 'en', // Default to English
  languageDetectionEnabled: true, // Enable automatic language detection by default
  transcript: [],
  debugLog: [],
  latencyPhases: [],
  currentResponseId: null,
});

/**
 * Actions
 */

export const actions = {
  updateStatus(status: ConnectionStatus, message: string) {
    console.log(`[Status] ${status}: ${message}`);
    store.status = status;
    store.statusMessage = message;
    
    // Log to debug
    store.debugLog.push({
      timestamp: new Date(),
      type: 'status',
      message: `${status}: ${message}`,
      data: { status, message },
    });
  },

  addTranscript(role: 'user' | 'assistant' | 'system', text: string) {
    const message: TranscriptMessage = {
      id: `${Date.now()}-${Math.random()}`,
      role,
      text,
      timestamp: new Date(),
    };
    store.transcript.push(message);
    
    // Log to debug
    store.debugLog.push({
      timestamp: new Date(),
      type: 'info',
      category: 'transcript',
      message: `[${role}] ${text}`,
      data: message,
    });
  },

  setConnected(connected: boolean) {
    store.isConnected = connected;
    
    // Log to debug
    store.debugLog.push({
      timestamp: new Date(),
      type: 'info',
      category: 'connection',
      message: connected ? 'Connected' : 'Disconnected',
      data: { connected },
    });
  },

  logEvent(category: string, message: string, data?: any) {
    store.debugLog.push({
      timestamp: new Date(),
      type: 'event',
      category,
      message,
      data,
    });
  },

  logError(message: string, error?: any) {
    console.error(`[Error] ${message}`, error);
    store.debugLog.push({
      timestamp: new Date(),
      type: 'error',
      message,
      data: error ? { 
        message: error.message, 
        stack: error.stack,
        ...error 
      } : undefined,
    });
  },

  addLatencyPhase(phase: LatencyPhase) {
    store.latencyPhases.push(phase);
  },

  clearLatencyPhases() {
    store.latencyPhases = [];
    store.currentResponseId = null;
  },

  setCurrentResponseId(responseId: string | null) {
    store.currentResponseId = responseId;
  },

  setEnvironment(environmentId: string) {
    store.selectedEnvironment = environmentId;
  },

  setCustomEnvironmentUrl(url: string) {
    store.customEnvironmentUrl = url;
  },

  setProvider(provider: 'groq' | 'cerebras' | 'openrouter') {
    store.selectedProvider = provider;
    // Reset model to default for the provider
    if (provider === 'groq') {
      store.selectedModel = 'openai/gpt-oss-120b';
    } else if (provider === 'cerebras') {
      store.selectedModel = 'gpt-oss-120b';
    } else {
      store.selectedModel = 'openai/gpt-oss-120b';
    }
  },

  setModel(model: string) {
    store.selectedModel = model;
  },

  setCustomModel(model: string) {
    store.customModel = model;
  },

  setLanguage(language: string) {
    store.selectedLanguage = language;
  },

  setLanguageDetectionEnabled(enabled: boolean) {
    store.languageDetectionEnabled = enabled;
  },

  reset() {
    store.status = 'idle';
    store.statusMessage = 'Disconnected';
    store.isConnected = false;
    store.latencyPhases = [];
    store.currentResponseId = null;
  },

  clearDebugLog() {
    store.debugLog = [];
  },

  exportDebugData() {
    return {
      exportDate: new Date().toISOString(),
      session: {
        status: store.status,
        statusMessage: store.statusMessage,
        isConnected: store.isConnected,
      },
      transcript: store.transcript.map(t => ({
        ...t,
        timestamp: t.timestamp.toISOString(),
      })),
      debugLog: store.debugLog.map(e => ({
        ...e,
        timestamp: e.timestamp.toISOString(),
      })),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      secureContext: window.isSecureContext,
      https: window.location.protocol === 'https:',
    };
  },
};

