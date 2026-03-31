/**
 * Provider Costs Configuration
 *
 * Centralized cost definitions for all STT and TTS providers.
 * Used for analytics, usage estimation, and cost tracking.
 *
 * Cost Units:
 * - Audio-based: $ per minute of audio processed
 * - Character-based: $ per 1K characters
 * - Token-based: $ per 1K tokens
 */

// =============================================================================
// SPEECH-TO-TEXT (STT) COSTS
// =============================================================================

export interface STTCostConfig {
  provider: string;
  model?: string;
  costPerMinute: number;      // $ per minute of audio
  costPerCharacter?: number;   // $ per character (if applicable)
  unit: 'minute' | 'character' | 'request';
  notes?: string;
}

export const STT_COSTS: STTCostConfig[] = [
  // Groq Whisper - Batch transcription
  // Source: https://console.groq.com/docs/asr (Whisper Large V3)
  {
    provider: 'groq-whisper',
    model: 'whisper-large-v3',
    costPerMinute: 0.18,
    unit: 'minute',
    notes: 'Batch mode - high quality, fast turnaround',
  },
  {
    provider: 'groq-whisper',
    model: 'whisper-large-v3-turbo',
    costPerMinute: 0.08,
    unit: 'minute',
    notes: 'Faster, slightly less accurate',
  },
];

// =============================================================================
// TEXT-TO-SPEECH (TTS) COSTS
// =============================================================================

export interface TTSCostConfig {
  provider: string;
  voice?: string;
  costPerCharacter: number;     // $ per character
  costPerMinute?: number;       // $ per minute of output audio
  unit: 'character' | 'minute';
  notes?: string;
}

export const TTS_COSTS: TTSCostConfig[] = [
  // Deepgram TTS - Cloud TTS
  {
    provider: 'deepgram',
    costPerCharacter: 0.00005,
    costPerMinute: 0.05,
    unit: 'character',
    notes: 'Aura-2 models, low latency',
  },
];

// =============================================================================
// LLM COSTS (for reference - used with Vercel AI SDK)
// =============================================================================

export interface LLMCostConfig {
  provider: string;
  model: string;
  costPer1KInputTokens: number;   // $ per 1K input tokens
  costPer1KOutputTokens: number;  // $ per 1K output tokens
  notes?: string;
}

export const LLM_COSTS: LLMCostConfig[] = [
  // Groq - Ultra-fast inference
  // Source: https://console.groq.com/docs/pricing
  {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    costPer1KInputTokens: 0.0059,   // $0.0059 per 1K input
    costPer1KOutputTokens: 0.0079,  // $0.0079 per 1K output
    notes: 'Fastest model on Groq',
  },
  {
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
    costPer1KInputTokens: 0.0005,
    costPer1KOutputTokens: 0.0008,
    notes: 'Lightweight, very fast',
  },
  {
    provider: 'groq',
    model: 'moonshotai/kimi-k2-instruct-0905',
    costPer1KInputTokens: 0.01,     // Estimated
    costPer1KOutputTokens: 0.01,
    notes: 'Kimi K2 Instruct model',
  },
  {
    provider: 'groq',
    model: 'gpt-oss-120b',
    costPer1KInputTokens: 0.015,
    costPer1KOutputTokens: 0.015,
    notes: 'OpenAI GPT-OSS 120B on Groq',
  },

  // OpenRouter - 100+ models
  // Source: https://openrouter.ai/docs#pricing
  {
    provider: 'openrouter',
    model: 'anthropic/claude-3-5-sonnet',
    costPer1KInputTokens: 0.003,    // $3 per 1M input
    costPer1KOutputTokens: 0.015,   // $15 per 1M output
    notes: 'Claude 3.5 Sonnet',
  },
  {
    provider: 'openrouter',
    model: 'anthropic/claude-3-haiku',
    costPer1KInputTokens: 0.00025,  // $0.25 per 1M input
    costPer1KOutputTokens: 0.00125, // $1.25 per 1M output
    notes: 'Fast, cost-effective',
  },
  {
    provider: 'openrouter',
    model: 'openai/gpt-4o',
    costPer1KInputTokens: 0.0025,   // $2.50 per 1M input
    costPer1KOutputTokens: 0.01,    // $10 per 1M output
    notes: 'GPT-4o',
  },
  {
    provider: 'openrouter',
    model: 'meta-llama/llama-3.1-405b',
    costPer1KInputTokens: 0.005,    // $5 per 1M input
    costPer1KOutputTokens: 0.015,   // $15 per 1M output
    notes: 'Meta Llama 3.1 405B',
  },
];

// =============================================================================
// COST CALCULATOR FUNCTIONS
// =============================================================================

/**
 * Calculate STT cost for a given provider and audio duration
 */
export function calculateSTTCost(
  provider: string,
  model: string,
  durationSeconds: number
): number {
  const costConfig = STT_COSTS.find(
    c => c.provider === provider && (c.model === model || !c.model)
  );

  if (!costConfig) {
    console.warn(`Unknown STT provider: ${provider}/${model}, using default rate`);
    return durationSeconds / 60 * 0.50;  // Default $0.50/min
  }

  return (durationSeconds / 60) * costConfig.costPerMinute;
}

/**
 * Calculate TTS cost for a given provider, voice, and text length
 */
export function calculateTTSCost(
  provider: string,
  voice: string,
  characterCount: number
): number {
  const costConfig = TTS_COSTS.find(
    c => c.provider === provider && (c.voice === voice || !c.voice)
  );

  if (!costConfig) {
    console.warn(`Unknown TTS provider: ${provider}/${voice}, using default rate`);
    return characterCount * 0.00003;  // Default $0.03/1K chars
  }

  return characterCount * costConfig.costPerCharacter;
}

/**
 * Calculate LLM cost for input and output tokens
 */
export function calculateLLMCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const costConfig = LLM_COSTS.find(
    c => c.provider === provider && c.model === model
  );

  if (!costConfig) {
    console.warn(`Unknown LLM provider: ${provider}/${model}, using default rate`);
    return (inputTokens + outputTokens) / 1000 * 0.01;  // Default $0.01/1K tokens
  }

  return (
    (inputTokens / 1000) * costConfig.costPer1KInputTokens +
    (outputTokens / 1000) * costConfig.costPer1KOutputTokens
  );
}

/**
 * Calculate total session cost
 */
export interface SessionCostBreakdown {
  stt: {
    provider: string;
    durationSeconds: number;
    cost: number;
  };
  tts: {
    provider: string;
    voice: string;
    characterCount: number;
    cost: number;
  };
  llm?: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
  totalCost: number;
}

export function calculateSessionCost(
  sttProvider: string,
  sttDurationSeconds: number,
  ttsProvider: string,
  ttsVoice: string,
  ttsCharacterCount: number,
  llmProvider?: string,
  llmModel?: string,
  inputTokens?: number,
  outputTokens?: number
): SessionCostBreakdown {
  const sttCost = calculateSTTCost(sttProvider, 'default', sttDurationSeconds);
  const ttsCost = calculateTTSCost(ttsProvider, ttsVoice, ttsCharacterCount);

  let llmCost = 0;
  let llmData;

  if (llmProvider && llmModel && inputTokens !== undefined && outputTokens !== undefined) {
    llmCost = calculateLLMCost(llmProvider, llmModel, inputTokens, outputTokens);
    llmData = {
      provider: llmProvider,
      model: llmModel,
      inputTokens,
      outputTokens,
      cost: llmCost,
    };
  }

  return {
    stt: {
      provider: sttProvider,
      durationSeconds: sttDurationSeconds,
      cost: sttCost,
    },
    tts: {
      provider: ttsProvider,
      voice: ttsVoice,
      characterCount: ttsCharacterCount,
      cost: ttsCost,
    },
    ...(llmData && { llm: llmData }),
    totalCost: sttCost + ttsCost + llmCost,
  };
}

// =============================================================================
// COST TRACKING TYPES FOR POSTHOG
// =============================================================================

export interface CostTrackingEvent {
  sessionId: string;
  sessionKey?: string;
  connectionParadigm: string;

  // STT Cost Data
  sttProvider: string;
  sttModel?: string;
  sttDurationSeconds: number;
  sttCostUSD: number;

  // TTS Cost Data
  ttsProvider: string;
  ttsVoice?: string;
  ttsCharacterCount: number;
  ttsCostUSD: number;
  ttsAudioDurationSeconds?: number;

  // LLM Cost Data
  llmProvider?: string;
  llmModel?: string;
  llmInputTokens?: number;
  llmOutputTokens?: number;
  llmCostUSD?: number;

  // Totals
  totalCostUSD: number;
  costCurrency: string;
}

/**
 * Get cost tracking event properties for PostHog
 */
export function getCostTrackingProperties(costData: CostTrackingEvent): Record<string, any> {
  return {
    // Correlation
    session_id: costData.sessionId,
    session_key: costData.sessionKey,
    connection_paradigm: costData.connectionParadigm,

    // STT
    stt_provider: costData.sttProvider,
    stt_model: costData.sttModel,
    stt_duration_seconds: costData.sttDurationSeconds,
    stt_cost_usd: roundToCents(costData.sttCostUSD),

    // TTS
    tts_provider: costData.ttsProvider,
    tts_voice: costData.ttsVoice,
    tts_character_count: costData.ttsCharacterCount,
    tts_cost_usd: roundToCents(costData.ttsCostUSD),
    tts_audio_duration_seconds: costData.ttsAudioDurationSeconds,

    // LLM
    llm_provider: costData.llmProvider,
    llm_model: costData.llmModel,
    llm_input_tokens: costData.llmInputTokens,
    llm_output_tokens: costData.llmOutputTokens,
    llm_cost_usd: costData.llmCostUSD ? roundToCents(costData.llmCostUSD) : undefined,

    // Totals
    total_cost_usd: roundToCents(costData.totalCostUSD),
    cost_currency: costData.costCurrency,
  };
}

/**
 * Round to cents (2 decimal places)
 */
function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

// =============================================================================
// PROVIDER COST LOOKUP
// =============================================================================

/**
 * Get STT cost configuration for a provider
 */
export function getSTTCost(provider: string, model?: string): STTCostConfig | undefined {
  return STT_COSTS.find(
    c => c.provider === provider && (c.model === model || !c.model)
  );
}

/**
 * Get TTS cost configuration for a provider/voice
 */
export function getTTSCost(provider: string, voice?: string): TTSCostConfig | undefined {
  return TTS_COSTS.find(
    c => c.provider === provider && (c.voice === voice || !c.voice)
  );
}

/**
 * Get LLM cost configuration for a provider/model
 */
export function getLLMCost(provider: string, model: string): LLMCostConfig | undefined {
  return LLM_COSTS.find(
    c => c.provider === provider && c.model === model
  );
}

// =============================================================================
// DEFAULT EXPORTS
// =============================================================================

export const DEFAULT_STT_PROVIDER = 'groq-whisper';
export const DEFAULT_TTS_PROVIDER = 'deepgram';
export const DEFAULT_TTS_VOICE = 'Aura-2-Thalia-en';
export const DEFAULT_LLM_PROVIDER = 'groq';
export const DEFAULT_LLM_MODEL = 'moonshotai/kimi-k2-instruct-0905';
