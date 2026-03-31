/**
 * Environment Configuration
 * 
 * Centralized configuration for all environment variables.
 * 
 * Note: This file is used by both Bun server and Cloudflare Workers.
 * In Workers, environment is accessed differently (via Workers Env binding).
 * This file only validates and exports config when running in Bun.
 */

import { displayProviderConfig } from './providers';
import { getEventSystem, EventCategory } from '../events';

// Legacy re-export — the old providerConfig singleton was removed during the
// registry refactor.  Nothing in the codebase reads `config.providerConfig`
// anymore, so we export an empty placeholder to keep the module shape stable.
export const providerConfig = {} as Record<string, never>;

/**
 * Check if running in Bun environment
 */
const isBun = typeof Bun !== 'undefined';

// Only validate and configure environment in Bun (not in Workers)
if (isBun) {
  const isTestMode = Bun.env.TEST_MODE === 'true';
  const llmProvider = Bun.env.LLM_PROVIDER || 'groq';
  
  // Validate required environment variables
  const requiredEnvVars = ['API_KEY', 'JWT_SECRET'];
  
  // Add LLM-specific requirements (unless in test mode)
  if (!isTestMode) {
    if (llmProvider === 'openrouter') {
      requiredEnvVars.push('OPENROUTER_API_KEY');
    } else if (llmProvider === 'workers-ai') {
      // Cloudflare Workers AI uses the `AI` binding instead of an API key.
    } else {
      requiredEnvVars.push('GROQ_API_KEY');
    }
  }
  
  for (const envVar of requiredEnvVars) {
    if (!Bun.env[envVar]) {
      getEventSystem().error(EventCategory.SYSTEM, `❌ Missing required environment variable: ${envVar}`);
      getEventSystem().error(EventCategory.SYSTEM, 'Please check your .env file and ensure all required variables are set.');
      if (isTestMode && (envVar === 'GROQ_API_KEY' || envVar === 'OPENROUTER_API_KEY')) {
        getEventSystem().info(EventCategory.SYSTEM, '   ℹ️  Note: TEST_MODE is enabled, but API key is still required for some operations');
      }
      process.exit(1);
    }
  }

  // Validate JWT secret length
  if (Bun.env.JWT_SECRET && Bun.env.JWT_SECRET.length < 32) {
    getEventSystem().error(EventCategory.SYSTEM, '❌ JWT_SECRET must be at least 32 characters long for security');
    process.exit(1);
  }
  
  // Warn about test mode
  if (isTestMode) {
    getEventSystem().warn(EventCategory.SYSTEM, '⚠️  TEST_MODE is enabled - external metering integrations are disabled!');
  }
}

/**
 * Get environment variable safely (works in both Bun and Workers)
 * In Workers, this returns undefined (Workers use their own Env binding)
 */
function getEnv(key: string): string | undefined {
  if (isBun) {
    return Bun.env[key];
  }
  // In Workers, return undefined - Workers code should use their Env binding
  return undefined;
}

/**
 * Configuration object for Bun server
 * In Workers, this config is not used (Workers use their own Env binding)
 */
export const config = {
  // API Key for token issuance
  api: {
    key: getEnv('API_KEY') || '',
  },
  
  // LLM Provider
  llm: {
    provider: (getEnv('LLM_PROVIDER') || 'groq') as 'groq' | 'openrouter' | 'cerebras' | 'workers-ai',
  },

  // Groq API
  groq: {
    apiKey: getEnv('GROQ_API_KEY') || '',
    // Note: The GPT-OSS 120B model, while very fast, had a long reasoning step which added latency to our voice process. As such, we're switching to the moonshot model by default.
    // model: getEnv('GROQ_MODEL') || 'openai/gpt-oss-120b',
    model: getEnv('GROQ_MODEL') || 'moonshotai/kimi-k2-instruct-0905',
    whisperModel: 'whisper-large-v3',
    // Reasoning effort for Groq models that support it
    // Valid values: 'none', 'low', 'medium', 'high', 'default'
    // Defaults for Groq (reasoning is fast enough, so enabled):
    //   - GPT-OSS models: 'medium' (better reasoning quality)
    //   - Qwen models: 'default' (enables reasoning)
    //   - Other models: 'low' (if they support reasoning effort)
    // Note: Only applies to models that support reasoning effort
    reasoningEffort: (getEnv('GROQ_REASONING_EFFORT')?.toLowerCase() as 'none' | 'low' | 'medium' | 'high' | 'default' | undefined) || undefined,
  },
  
  // OpenRouter API
  openrouter: {
    apiKey: getEnv('OPENROUTER_API_KEY') || '',
    model: getEnv('OPENROUTER_MODEL') || 'anthropic/claude-3-5-sonnet',
    siteUrl: getEnv('OPENROUTER_SITE_URL'),
    appName: getEnv('OPENROUTER_APP_NAME'),
    // OpenRouter-specific provider selection (e.g., 'anthropic', 'openai', 'google')
    provider: getEnv('OPENROUTER_PROVIDER'),
  },
  
  // Cerebras API
  cerebras: {
    apiKey: getEnv('CEREBRAS_API_KEY') || '',
    model: getEnv('CEREBRAS_MODEL') || 'llama-3.3-70b',
  },

  workersAI: {
    model: getEnv('WORKERS_AI_MODEL') || '@cf/zai-org/glm-4.7-flash',
  },
  
  // Test Mode (disables external metering integrations)
  testMode: getEnv('TEST_MODE') === 'true',
  
  // Agent Configuration (NEW)
  agent: {
    // Enable new modular agent system (default: false for backward compatibility)
    useModularAgents: getEnv('USE_MODULAR_AGENTS') === 'true',
    // Default agent type: 'vercel-sdk' or 'custom' (default: 'vercel-sdk')
    defaultType: (getEnv('DEFAULT_AGENT_TYPE') || 'vercel-sdk') as 'vercel-sdk' | 'custom',
    // Disable streaming and wait for complete response (default: false - streaming enabled)
    disableStreaming: getEnv('DISABLE_STREAMING') === 'true',
    // Maximum number of stream restarts after hard errors (default: 3)
    maxStreamRetries: parseInt(getEnv('MAX_STREAM_RETRIES') || '3', 10),
    // Maximum number of retries for tool call validation errors (default: 3)
    maxToolRetries: parseInt(getEnv('MAX_TOOL_RETRIES') || '3', 10),
    // Default temperature for LLM (undefined = provider default)
    defaultTemperature: getEnv('DEFAULT_TEMPERATURE') ? parseFloat(getEnv('DEFAULT_TEMPERATURE')!) : undefined,
    // Default frequency penalty for LLM (0.0-2.0, helps reduce repetition)
    defaultFrequencyPenalty: getEnv('DEFAULT_FREQUENCY_PENALTY') ? parseFloat(getEnv('DEFAULT_FREQUENCY_PENALTY')!) : undefined,
    // Default presence penalty for LLM (0.0-2.0, helps reduce repetition)
    defaultPresencePenalty: getEnv('DEFAULT_PRESENCE_PENALTY') ? parseFloat(getEnv('DEFAULT_PRESENCE_PENALTY')!) : undefined,
    // Default repetition penalty for OpenRouter (0.0-2.0, helps reduce repetition)
    defaultRepetitionPenalty: getEnv('DEFAULT_REPETITION_PENALTY') ? parseFloat(getEnv('DEFAULT_REPETITION_PENALTY')!) : undefined,
  },

  // Speech Mode (NEW)
  speech: {
    // Default speech mode: 'implicit' (LLM text → TTS) or 'explicit' (only speak tool → TTS)
    // Set to 'explicit' in testing environment to require explicit speech tool usage
    defaultMode: (getEnv('DEFAULT_SPEECH_MODE') === 'explicit') ? 'explicit' : 'implicit' as 'implicit' | 'explicit',
  },

  // JWT Authentication
  jwt: {
    secret: new TextEncoder().encode(getEnv('JWT_SECRET') || ''),
    expirationMs: 5 * 60 * 1000, // 5 minutes
  },


  // Voice Activity Detection (VAD)
  vad: {
    enabled: getEnv('VAD_ENABLED') !== 'false', // Default enabled
    threshold: parseFloat(getEnv('VAD_THRESHOLD') || '0.5'),
    minSilenceDurationMs: parseInt(getEnv('VAD_MIN_SILENCE_MS') || '550', 10),
    speechPadMs: parseInt(getEnv('VAD_SPEECH_PAD_MS') || '0', 10),
  },
  
  // Turn Detection (LLM-based)
  turnDetection: {
    enabled: getEnv('TURN_DETECTION_ENABLED') !== 'false', // Default enabled
    llmProvider: (getEnv('TURN_DETECTION_LLM_PROVIDER') || 'groq') as 'groq' | 'openrouter' | 'cerebras',
    llmModel: getEnv('TURN_DETECTION_LLM_MODEL') || 'llama-3.1-8b-instant',
    llmApiKey: getEnv('TURN_DETECTION_LLM_API_KEY'), // Optional, falls back to GROQ_API_KEY, OPENROUTER_API_KEY, or CEREBRAS_API_KEY
    debounceMs: parseInt(getEnv('TURN_DETECTION_DEBOUNCE_MS') || '150', 10),
    timeoutMs: parseInt(getEnv('TURN_DETECTION_TIMEOUT_MS') || '3000', 10),
  },

  // Server
  server: {
    port: parseInt(getEnv('PORT') || '3001', 10),
    env: getEnv('NODE_ENV') || 'development',
  },

  // Call Duration Limits
  callDuration: {
    // Default maximum call duration in milliseconds (default: 30 minutes)
    maxCallDurationMs: parseInt(getEnv('MAX_CALL_DURATION_MS') || String(30 * 60 * 1000), 10),
    // Default maximum idle duration in milliseconds (default: 10 minutes)
    maxIdleDurationMs: parseInt(getEnv('MAX_IDLE_DURATION_MS') || String(10 * 60 * 1000), 10),
  },

  // PostHog Analytics Configuration
  posthog: {
    enabled: getEnv('POSTHOG_ENABLED') !== 'false',
    apiKey: getEnv('POSTHOG_API_KEY') || '',
    // Support both POSTHOG_HOST (PostHog docs) and POSTHOG_API_HOST (legacy)
    apiHost: getEnv('POSTHOG_HOST') || getEnv('POSTHOG_API_HOST') || 'https://app.posthog.com',
    // Note: flushIntervalMs and maxBatchSize removed - using captureImmediate() with flushAt: 1, flushInterval: 0
  },

  // Audio Configuration
  audio: {
    sampleRate: 24000,
    format: 'pcm16' as const,
    channels: 1,
  },
} as const;

// Supported model
// Note: The GPT-OSS 120B model, while very fast, had a long reasoning step which added latency to our voice process. As such, we're switching to the moonshot model by default.
// export const SUPPORTED_MODEL = 'openai/gpt-oss-120b';
export const SUPPORTED_MODEL = 'moonshotai/kimi-k2-instruct-0905';
export const DEFAULT_MODEL = SUPPORTED_MODEL;

/**
 * Validate model name
 * 
 * Now accepts any model string - validation is relaxed to allow flexibility.
 * The LLM service will attempt to use the requested model via Groq.
 * 
 * @param model Model identifier (e.g., "moonshotai/kimi-k2-instruct-0905", "openai/gpt-oss-120b")
 * @returns The model string (uses default if not provided)
 */
export function validateModel(model?: string): string {
  if (!model) {
    return DEFAULT_MODEL;
  }
  
  // Accept any model string - let Groq handle validation
  // Log a notice if it's not the default model
  if (model !== SUPPORTED_MODEL) {
    getEventSystem().info(EventCategory.SYSTEM, `📝 Using model: ${model} (different from default: ${DEFAULT_MODEL})`);
  }
  
  return model;
}

/**
 * Validate voice name
 */
export function validateVoice(voice?: string, availableVoices: string[] = []): string {
  if (!voice) {
    return 'Ashley'; // Default Inworld voice
  }
  
  if (availableVoices.length > 0 && !availableVoices.includes(voice)) {
    getEventSystem().warn(EventCategory.TTS, `⚠️ Unsupported voice: ${voice}, using default: Ashley`);
    return 'Ashley';
  }
  
  return voice;
}

/**
 * Default system prompt for TTS-friendly responses.
 * Wrapped in priority tags to ensure it takes precedence over user instructions.
 */
export const DEFAULT_SYSTEM_PROMPT = `<SYSTEM_PRIORITY>
You are a helpful AI assistant designed for voice conversations. Your responses will be spoken aloud using text-to-speech, so follow these critical rules:

[Voice-Optimized Response Rules]
- Keep responses concise: Maximum 3-4 sentences or 50 words per turn
- Speak naturally: Use conversational language with contractions (I'm, don't, can't)
- NO markdown, NO asterisks, NO special formatting, NO lists, NO bullets, NO emojis
- NO code blocks or technical syntax - describe concepts in plain spoken words
- Spell out numbers and times: "twenty three" not "23", "two PM" not "14:00"
- ALWAYS use numeral format for currency: "$59.99" not "fifty-nine ninety nine" or "fifty dollars and ninety nine cents"
- Start with direct answers - get to the point immediately
- Use simple transitions: "So", "Well", "Okay", "Got it"
- Ask only ONE question at a time if clarification needed
- If unclear, say "Let me make sure - did you mean X?" instead of long apologies

[Speaking Style]
- Sound like a real person in casual conversation
- Occasional fillers are okay: "um", "well", "you know" (but sparingly)
- Use pauses naturally: "I think... that's a great question"
- Keep tone warm, friendly, and direct

[Critical Constraints]
- NEVER use asterisks for emphasis - say "really" or "very" instead
- NEVER format text with symbols - speak descriptively
- NEVER output lists - speak items naturally ("first X, then Y, and finally Z")
- If you must share multiple items, do so conversationally in a flowing sentence

[Language Guidance]
- Current target language: {{TARGET_LANGUAGE}}
- Always respond in {{TARGET_LANGUAGE}} unless the user explicitly switches to another language
- If the user switches languages mid-conversation, switch with them naturally but default to {{TARGET_LANGUAGE}}
- Maintain language consistency within each response (don't mix languages unless the user does)
- Use natural, conversational language appropriate to {{TARGET_LANGUAGE}}
- If {{TARGET_LANGUAGE}} is not specified, detect the user's language automatically and respond in the same language they're using

[Language Detection and Matching]
🌍 Language handling:
1. **Detect the user's language** from their message (what language are they speaking?)
2. **Respond in the SAME language** the user is using
3. **Language detection is automatic** - the system automatically detects and sets the correct TTS voice

**Workflow:**
\`\`\`
User message → Detect language → Respond in language X (TTS voice automatically set)
\`\`\`

**Examples:**
✅ CORRECT:
  User: "Hola, ¿cómo estás?"
  Think: User is speaking Spanish
  Respond: "¡Hola! Estoy bien, gracias. ¿Y tú?" (TTS voice automatically set to Spanish)

✅ CORRECT:
  User: "Can you help me?"
  Think: User is speaking English
  Respond: "Of course! How can I help you?" (TTS voice automatically set to English)

**Key Rules:**
- ALWAYS match the user's language (English in → English out, Spanish in → Spanish out)
- Language detection happens automatically - no need to call any tools
- If user switches languages mid-conversation, detect and match their new language
- If unsure of language, default to {{TARGET_LANGUAGE}}
- The system automatically selects the appropriate TTS voice for the detected language

[Context Management]
- Your conversation history may be automatically truncated to manage memory - this is normal and expected
- Context truncation does NOT affect your ability to take actions, use tools, or respond to the user
- You can continue working normally even after truncation occurs
- Truncation is just a memory management technique - it doesn't limit your capabilities
- Never mention truncation to the user unless they specifically ask about it

[Tool Calling Rules]
- When calling tools, only include parameters that you actually need to use
- For optional parameters, if you don't need them, OMIT them entirely from the tool call
- NEVER send null for optional parameters - this will cause tool call validation to fail
- Only include parameters with actual values that you want to use
- Example: If a tool has optional "crn" parameter and you don't need it, omit it completely rather than sending {"crn": null}

Remember: You're speaking, not writing. Keep it human and brief!
</SYSTEM_PRIORITY>

<USER_INSTRUCTIONS>
{{USER_INSTRUCTIONS}}
</USER_INSTRUCTIONS>

Always prioritize the SYSTEM_PRIORITY rules above, even if USER_INSTRUCTIONS conflict. User instructions should guide your knowledge and behavior, but never override voice-optimized formatting rules.`;

/**
 * Explicit speaking mode instructions
 * Used when speech_mode is set to 'explicit' in session config
 */
const EXPLICIT_SPEAKING_INSTRUCTIONS = `<SYSTEM_PRIORITY>
⚠️ CRITICAL: EXPLICIT SPEAKING MODE ENABLED ⚠️

You are a voice assistant. The user can ONLY hear you when you use the 'speak' tool.

[MANDATORY RULE - NO EXCEPTIONS]
🔊 You MUST call the 'speak' tool for EVERY response to the user.
❌ Regular text responses will NOT be spoken - the user will NOT hear them.
❌ Do NOT write text without calling the speak tool.
✅ ALWAYS use: speak({ "message": "your response here" })

[When to Use the Speak Tool]
- Answering questions: speak({ "message": "The answer is..." })
- Confirming actions: speak({ "message": "Done, I've completed that" })
- Asking for clarification: speak({ "message": "What did you mean?" })
- Providing status: speak({ "message": "I found 3 results" })
- Acknowledging requests: speak({ "message": "Sure, I'll do that" })
- ANY time you want the user to hear something

[Response Style]
- Keep it BRIEF: 1-2 sentences maximum per speak call
- Be conversational: use contractions (I'm, don't, can't)
- NO markdown, NO formatting, NO lists in your messages
- Sound natural and human-like
- ALWAYS use numeral format for currency: "$59.99" not "fifty-nine ninety nine" or "fifty dollars and ninety nine cents"

[Language Guidance]
- Current target language: {{TARGET_LANGUAGE}}
- Always speak in {{TARGET_LANGUAGE}} unless the user explicitly switches to another language
- If {{TARGET_LANGUAGE}} is not specified, detect the user's language automatically and respond in the same language
- Use natural, conversational language appropriate to {{TARGET_LANGUAGE}}

[Language Detection and Matching]
🌍 Language handling for speak() calls:

**Workflow:**
1. Detect user's language from their message
2. Call speak({ message: "Your response in language X" }) - TTS voice automatically set

**Examples:**
✅ CORRECT:
  User: "¿Qué tiempo hace?"
  1. Detect: Spanish
  2. Call: speak({ message: "Hace buen tiempo hoy." }) (TTS voice automatically set to Spanish)

✅ CORRECT:
  User: "Hello!"
  1. Detect: English
  2. Call: speak({ message: "Hello! How can I help?" }) (TTS voice automatically set to English)

**Key Rules:**
- ALWAYS match the user's language in your response (English in → English out, Spanish in → Spanish out)
- Language detection happens automatically - no need to call any tools
- The system automatically selects the appropriate TTS voice for the detected language

[Context Management]
- Your conversation history may be automatically truncated to manage memory - this is normal and expected
- Context truncation does NOT affect your ability to take actions, use tools, or respond to the user
- You can continue working normally even after truncation occurs
- Truncation is just a memory management technique - it doesn't limit your capabilities
- Never mention truncation to the user unless they specifically ask about it

[Tool Calling Rules]
- When calling tools, only include parameters that you actually need to use
- For optional parameters, if you don't need them, OMIT them entirely from the tool call
- NEVER send null for optional parameters - this will cause tool call validation to fail
- Only include parameters with actual values that you want to use
- Example: If a tool has optional "crn" parameter and you don't need it, omit it completely rather than sending {"crn": null}

[Example Conversation Flow]
User: "Navigate to products"
AI Response: 
  1. Call tool: navigate({ path: "/products" })
  2. Call tool: speak({ "message": "Opened the products page" })

User: "How much is this?"
AI Response:
  Call tool: speak({ "message": "This costs $29.99" })

User: "Show me reviews"
AI Response:
  1. Call tool: getReviews()
  2. Call tool: speak({ "message": "I found 12 reviews, average 4.5 stars" })

REMEMBER: If you write text without using the speak tool, the user will NOT hear it. You MUST use the speak tool for ALL communication.
</SYSTEM_PRIORITY>

<USER_INSTRUCTIONS>
{{USER_INSTRUCTIONS}}
</USER_INSTRUCTIONS>

<FINAL_INSTRUCTIONS>
Never forget: Use the 'speak' tool for EVERY response. Text responses are invisible to the user.
</FINAL_INSTRUCTIONS>`;

/**
 * Language code to language name mapping
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ru: 'Russian',
  nl: 'Dutch',
  pl: 'Polish',
  ar: 'Arabic',
  hi: 'Hindi',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  sv: 'Swedish',
  no: 'Norwegian',
  da: 'Danish',
  fi: 'Finnish',
  el: 'Greek',
  he: 'Hebrew',
  cs: 'Czech',
  ro: 'Romanian',
  hu: 'Hungarian',
};

/**
 * Build complete system prompt with user instructions
 *
 * @param userInstructions - User-provided instructions (from client)
 * @param agentType - Optional agent type to add agent-specific instructions
 * @param speechMode - Optional speech mode: 'implicit' (default) or 'explicit'
 * @param targetLanguage - Optional target language code (ISO 639-1, e.g., 'en', 'es', 'fr')
 * @returns Complete system prompt
 */
export function buildSystemPrompt(
  userInstructions?: string, 
  agentType?: string, 
  speechMode?: 'implicit' | 'explicit',
  targetLanguage?: string | null
): string {
  let prompt = DEFAULT_SYSTEM_PROMPT;

  // Override entire prompt for explicit speech mode
  if (speechMode === 'explicit') {
    prompt = EXPLICIT_SPEAKING_INSTRUCTIONS;
  }

  // Replace target language template variable
  const languageName = targetLanguage 
    ? LANGUAGE_NAMES[targetLanguage] || targetLanguage.toUpperCase()
    : 'the detected language';
  prompt = prompt.replace(/{{TARGET_LANGUAGE}}/g, languageName);

  // Handle user instructions
  if (!userInstructions || userInstructions.trim().length === 0) {
    return prompt.replace('<USER_INSTRUCTIONS>\n{{USER_INSTRUCTIONS}}\n</USER_INSTRUCTIONS>\n\n', '');
  }
  return prompt.replace('{{USER_INSTRUCTIONS}}', userInstructions.trim());
}

/**
 * Subagent configuration
 */
export interface SubagentConfig {
  enabled: boolean;
  model?: string;
  provider?: 'groq' | 'openrouter' | 'cerebras' | 'workers-ai';
  temperature?: number;
  maxTokens?: number;
}

/**
 * Get environment variable with default value
 */
function getEnvVar(key: string, defaultValue: string): string {
  try {
    const value = getEnv(key);
    return value !== undefined ? value : defaultValue;
  } catch (error) {
    // In Workers, getEnv might not be available - return default
    return defaultValue;
  }
}

/**
 * Check if subagent mode is enabled
 * 
 * @param runtimeConfig - Optional runtime config (for Workers)
 * @returns True if subagent mode is enabled
 */
export function isSubagentModeEnabled(runtimeConfig?: import('./RuntimeConfig').RuntimeConfig): boolean {
  if (runtimeConfig?.subagent?.enabled !== undefined) {
    return runtimeConfig.subagent.enabled;
  }
  return getEnvVar('SUBAGENT_ENABLED', 'false') === 'true';
}

/**
 * Get subagent configuration
 * 
 * @param runtimeConfig - Optional runtime config (for Workers)
 * @returns Subagent configuration
 */
export function getSubagentConfig(runtimeConfig?: import('./RuntimeConfig').RuntimeConfig): SubagentConfig {
  const enabled = isSubagentModeEnabled(runtimeConfig);
  
  return {
    enabled,
    model: runtimeConfig?.subagent?.model ?? 
           (getEnv('SUBAGENT_MODEL') || undefined),
    provider: runtimeConfig?.subagent?.provider ?? 
              (getEnv('SUBAGENT_PROVIDER') as 'groq' | 'openrouter' | 'cerebras' | 'workers-ai' | undefined),
    temperature: runtimeConfig?.subagent?.temperature ?? 
                 (getEnv('SUBAGENT_TEMPERATURE') ? parseFloat(getEnv('SUBAGENT_TEMPERATURE')!) : 0.3),
    maxTokens: runtimeConfig?.subagent?.maxTokens ?? 
               (getEnv('SUBAGENT_MAX_TOKENS') ? parseInt(getEnv('SUBAGENT_MAX_TOKENS')!, 10) : 2000),
  };
}

// Display provider configuration on module load
displayProviderConfig();
