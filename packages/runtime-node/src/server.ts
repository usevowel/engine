/**
 * Bun/Node Runtime Server for Vowel Core
 *
 * Self-hosted voice AI agent server using a standard HTTP server plus the `ws`
 * package for WebSocket handling. Bun still runs the process and manages
 * dependencies, but WebSocket behavior now follows the Node/ws semantics that
 * are more predictable for browser clients.
 *
 * @package @vowel/runtime-node
 * @license MIT
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { SessionData } from '../../../src/session/types';
import { getEventSystem, EventCategory } from '../../../src/events';
import { generateEphemeralToken, verifyToken } from './auth/token-generator';
import { NodeConfigLoader, type NodeRuntimeConfig } from './config/NodeConfigLoader';
import { handleInitialGreeting, handleMessage } from '../../../src/session/handler';
import { SessionManager } from '../../../src/session/SessionManager';
import { generateEventId, generateSessionId } from '../../../src/lib/protocol';
import { buildSessionConfig } from '../../../src/session/bootstrap';
import { isAudioChunkMessage } from '../../../src/session/message-utils';
import { ProviderFactory } from '../../../src/services/providers/ProviderFactory';
import { ProviderRegistry } from '../../../src/services/providers/ProviderRegistry';
import { registerOSSProviders } from '../../../src/services/providers/OSSProviderRegistration';
import { SileroVADConfig } from '../../../src/config/providers';
import { SileroVADProvider } from '../../../packages/provider-silero-vad/src';

type RuntimeWebSocket = WebSocket & {
  data: SessionData;
  runtimeConfig?: NodeRuntimeConfig;
};

function registerNodeProviders(): void {
  registerOSSProviders();

  if (ProviderRegistry.getVADProvider('silero')) {
    return;
  }

  ProviderRegistry.registerVAD({
    name: 'silero',
    category: 'vad',
    capabilities: {
      supportsStreaming: false,
      supportsVAD: true,
      supportsLanguageDetection: false,
      supportsMultipleVoices: false,
      requiresNetwork: false,
      supportsGPU: true,
    },
    configSchema: SileroVADConfig,
    factory: (config) => new SileroVADProvider(config),
  });
}

registerNodeProviders();
const configLoader = new NodeConfigLoader();
const runtimeConfig: NodeRuntimeConfig = configLoader.load();
const serverConfig = runtimeConfig.server ?? { port: 3001, env: 'development' };
SessionManager.setProviderFactory(ProviderFactory);
const eventSystem = getEventSystem();

console.log('🚀 Starting Vowel Runtime (Node/Bun)');
console.log('');
console.log('Configuration:');
console.log('  LLM Provider:', runtimeConfig.llm.provider || 'groq');
console.log('  Model:', runtimeConfig.llm.model || 'default');
console.log('  Port:', serverConfig.port);
console.log('  STT:', runtimeConfig.providers.stt.provider);
console.log('  TTS:', runtimeConfig.providers.tts.provider);
console.log(
  '  VAD:',
  `${runtimeConfig.providers.vad.provider} (${runtimeConfig.providers.vad.enabled ? 'enabled' : 'disabled'})`
);
console.log('  Speech Mode:', runtimeConfig.speech.defaultMode);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...corsHeaders,
  });
  res.end(JSON.stringify(payload));
}

function writeText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain;charset=utf-8',
    ...corsHeaders,
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function handleTokenRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const apiKey = authHeader?.replace('Bearer ', '');

    if (!apiKey || apiKey !== runtimeConfig.apiKey) {
      writeJson(res, 401, { error: { message: 'Invalid API key' } });
      return;
    }

    const body = await readJsonBody(req);
    const ttsConfig = runtimeConfig.providers.tts.config as Record<string, unknown> | undefined;
    const defaultVoice = (ttsConfig?.voice as string) || 'Ashley';
    const token = await generateEphemeralToken({
      model: (body.model as string) || runtimeConfig.llm.model,
      voice: (body.voice as string) || defaultVoice,
      ...body,
    });

    writeJson(res, 200, {
      client_secret: {
        value: token,
        expires_at: Math.floor(Date.now() / 1000) + 300,
      },
      value: token,
      token,
      expires_in: 300,
    });
  } catch (error) {
    writeJson(res, 500, { error: { message: String(error) } });
  }
}

function getHeaderValue(
  headers: IncomingMessage['headers'],
  key: string
): string | undefined {
  const value = headers[key.toLowerCase()];
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return value;
}

function redactToken(token: string | null): string {
  if (!token) {
    return '(missing)';
  }

  if (token.length <= 16) {
    return token;
  }

  return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

function extractTokenFromHeaders(headers: IncomingMessage['headers']): string | null {
  const authHeader = getHeaderValue(headers, 'authorization');
  if (authHeader) {
    return authHeader.replace('Bearer ', '');
  }

  const protocols =
    getHeaderValue(headers, 'sec-websocket-protocol')
      ?.split(',')
      .map((protocol) => protocol.trim()) || [];

  const insecureApiKeyIndex = protocols.findIndex((protocol) =>
    protocol.startsWith('openai-insecure-api-key.')
  );

  if (insecureApiKeyIndex >= 0) {
    return protocols[insecureApiKeyIndex].replace('openai-insecure-api-key.', '');
  }

  // Some browser/runtime shims split the auth protocol into two entries:
  // `openai-insecure-api-key` and the token as the following protocol.
  const bareInsecureMarkerIndex = protocols.findIndex(
    (protocol) => protocol === 'openai-insecure-api-key'
  );

  if (bareInsecureMarkerIndex >= 0) {
    const nextProtocol = protocols[bareInsecureMarkerIndex + 1];
    if (
      nextProtocol &&
      nextProtocol !== 'realtime' &&
      !nextProtocol.startsWith('openai-beta.')
    ) {
      return nextProtocol;
    }
  }

  for (const protocol of protocols) {
    if (
      protocol &&
      protocol !== 'realtime' &&
      !protocol.startsWith('openai-beta.') &&
      protocol.startsWith('ek_')
    ) {
      return protocol;
    }
  }

  return null;
}

async function createSessionData(req: IncomingMessage): Promise<SessionData> {
  const token = extractTokenFromHeaders(req.headers);
  if (!token) {
    throw new Error('Missing token');
  }

  const payload = await verifyToken(token);

  // Extract provider config from token payload for per-session override
  const tokenProviderConfig = payload.providerConfig as
    | {
        stt?: { provider: string; config?: Record<string, unknown> };
        tts?: { provider: string; config?: Record<string, unknown> };
        vad?: { provider: string; config?: Record<string, unknown> };
      }
    | undefined;

  /** Top-level JWT `stt` / `tts` blocks (hosted + engine token passthrough), merged with `providerConfig`. */
  const sttJwt = payload.stt as { provider?: string; config?: Record<string, unknown> } | undefined;
  const ttsJwt = payload.tts as { provider?: string; config?: Record<string, unknown> } | undefined;

  const sttBlock =
    tokenProviderConfig?.stt?.provider != null
      ? tokenProviderConfig.stt
      : sttJwt?.provider != null
        ? { provider: sttJwt.provider, config: sttJwt.config }
        : undefined;

  const ttsBlock =
    tokenProviderConfig?.tts?.provider != null
      ? tokenProviderConfig.tts
      : ttsJwt?.provider != null
        ? { provider: ttsJwt.provider, config: ttsJwt.config }
        : undefined;

  const effectiveProviderConfig = {
    stt: sttBlock
      ? {
          provider: sttBlock.provider,
          config: {
            ...(runtimeConfig.providers.stt.config as Record<string, unknown>),
            ...(sttBlock.config ?? {}),
          },
        }
      : runtimeConfig.providers.stt,
    tts: ttsBlock
      ? {
          provider: ttsBlock.provider,
          config: {
            ...(runtimeConfig.providers.tts.config as Record<string, unknown>),
            ...(ttsBlock.config ?? {}),
          },
        }
      : runtimeConfig.providers.tts,
    vad: tokenProviderConfig?.vad?.provider
      ? {
          provider: tokenProviderConfig.vad.provider,
          enabled: runtimeConfig.providers.vad.enabled,
          config: {
            ...(runtimeConfig.providers.vad.config as Record<string, unknown> | undefined),
            ...(tokenProviderConfig.vad.config ?? {}),
          },
        }
      : runtimeConfig.providers.vad,
  };

  const mergedRuntimeConfig: NodeRuntimeConfig = {
    ...runtimeConfig,
    providers: effectiveProviderConfig,
  };

  const sessionId =
    (typeof payload.sub === 'string' && payload.sub) ||
    (typeof payload.sessionId === 'string' && payload.sessionId) ||
    generateSessionId();
  const model = typeof payload.model === 'string' ? payload.model : runtimeConfig.llm.model;

  const ttsConfig = effectiveProviderConfig.tts.config as Record<string, unknown> | undefined;
  const envLike = {
    DEFAULT_VOICE: ttsConfig?.voice,
    STT_PROVIDER: effectiveProviderConfig.stt.provider,
    VAD_PROVIDER: effectiveProviderConfig.vad.provider,
    VAD_ENABLED: String(effectiveProviderConfig.vad.enabled),
    POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
    POSTHOG_ENABLED: process.env.POSTHOG_ENABLED,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    POSTHOG_API_HOST: process.env.POSTHOG_API_HOST,
    LANGUAGE_DETECTION_ENABLED: process.env.LANGUAGE_DETECTION_ENABLED,
    DEFAULT_TEMPERATURE: process.env.DEFAULT_TEMPERATURE,
    DEFAULT_FREQUENCY_PENALTY: process.env.DEFAULT_FREQUENCY_PENALTY,
    DEFAULT_PRESENCE_PENALTY: process.env.DEFAULT_PRESENCE_PENALTY,
    DEFAULT_REPETITION_PENALTY: process.env.DEFAULT_REPETITION_PENALTY,
    GROQ_REASONING_EFFORT: process.env.GROQ_REASONING_EFFORT,
    MAX_CALL_DURATION_MS: String(runtimeConfig.callDuration?.maxCallDurationMs ?? 30 * 60 * 1000),
    MAX_IDLE_DURATION_MS: String(runtimeConfig.callDuration?.maxIdleDurationMs ?? 10 * 60 * 1000),
  };

  const sessionData = buildSessionConfig(
    sessionId,
    model,
    envLike as any,
    mergedRuntimeConfig,
    typeof payload.voice === 'string' ? payload.voice : undefined,
    typeof payload.speakingRate === 'number' ? payload.speakingRate : undefined,
    typeof payload.initialGreetingPrompt === 'string' ? payload.initialGreetingPrompt : undefined,
    typeof payload.instructions === 'string' ? payload.instructions : undefined,
    payload.turnDetection,
    typeof payload.sessionKey === 'string' ? payload.sessionKey : undefined,
    typeof payload.language === 'string' ? payload.language : undefined,
    payload.languageDetection,
    payload.testMode
      ? {
          testMode: true,
          agentMaxSteps: typeof payload.agentMaxSteps === 'number' ? payload.agentMaxSteps : undefined,
          agentMaxContextMessages:
            typeof payload.agentMaxContextMessages === 'number'
              ? payload.agentMaxContextMessages
              : undefined,
          agentTemperature:
            typeof payload.agentTemperature === 'number' ? payload.agentTemperature : undefined,
          agentMaxTokens: typeof payload.agentMaxTokens === 'number' ? payload.agentMaxTokens : undefined,
          agentFrequencyPenalty:
            typeof payload.agentFrequencyPenalty === 'number'
              ? payload.agentFrequencyPenalty
              : undefined,
          agentPresencePenalty:
            typeof payload.agentPresencePenalty === 'number'
              ? payload.agentPresencePenalty
              : undefined,
          agentRepetitionPenalty:
            typeof payload.agentRepetitionPenalty === 'number'
              ? payload.agentRepetitionPenalty
              : undefined,
        }
      : undefined,
    payload.languageVoiceMap && typeof payload.languageVoiceMap === 'object'
      ? (payload.languageVoiceMap as Record<string, string>)
      : undefined
  );

  sessionData.runtimeConfig = mergedRuntimeConfig;
  sessionData.connectionStartTime = Date.now();
  sessionData.maxCallDurationMs =
    typeof payload.maxCallDurationMs === 'number'
      ? payload.maxCallDurationMs
      : runtimeConfig.callDuration?.maxCallDurationMs;
  sessionData.maxIdleDurationMs =
    typeof payload.maxIdleDurationMs === 'number'
      ? payload.maxIdleDurationMs
      : runtimeConfig.callDuration?.maxIdleDurationMs;

  return sessionData;
}

const httpServer = createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${serverConfig.port}`;
  const url = new URL(req.url || '/', `http://${host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (url.pathname === '/' && req.method === 'GET') {
    writeJson(res, 200, {
      status: 'ok',
      runtime: 'node',
      websocket: '/v1/realtime',
      tokenEndpoint: '/v1/realtime/sessions',
    });
    return;
  }

  if (url.pathname === '/health' && req.method === 'GET') {
    writeJson(res, 200, {
      status: 'ok',
      runtime: 'node',
    });
    return;
  }

  if (url.pathname === '/v1/realtime/sessions' && req.method === 'POST') {
    await handleTokenRequest(req, res);
    return;
  }

  writeText(res, 404, 'Not Found');
});

const wss = new WebSocketServer({
  noServer: true,
  handleProtocols(protocols) {
    for (const protocol of protocols) {
      if (
        !protocol.startsWith('openai-insecure-api-key.') &&
        !protocol.startsWith('openai-beta.')
      ) {
        return protocol;
      }
    }

    return false;
  },
});

httpServer.on('upgrade', async (req: IncomingMessage, socket: Socket, head: Buffer) => {
  try {
    const host = req.headers.host || `localhost:${serverConfig.port}`;
    const url = new URL(req.url || '/', `http://${host}`);

    if (url.pathname !== '/v1/realtime') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const sessionData = await createSessionData(req);

    wss.handleUpgrade(req, socket, head, (ws) => {
      const runtimeSocket = ws as RuntimeWebSocket;
      runtimeSocket.data = sessionData;
      runtimeSocket.runtimeConfig = sessionData.runtimeConfig as NodeRuntimeConfig;
      wss.emit('connection', runtimeSocket, req);
    });
  } catch (error) {
    const token = extractTokenFromHeaders(req.headers);
    eventSystem.error(
      EventCategory.SESSION,
      '❌ [runtime-node] WebSocket upgrade failed',
      error instanceof Error ? error : new Error(String(error))
    );
    eventSystem.warn(EventCategory.SESSION, '⚠️ [runtime-node] Upgrade auth diagnostics', {
      url: req.url,
      authorizationPresent: Boolean(getHeaderValue(req.headers, 'authorization')),
      secWebSocketProtocol: getHeaderValue(req.headers, 'sec-websocket-protocol'),
      extractedToken: redactToken(token),
    });
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
});

wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
  const runtimeSocket = ws as RuntimeWebSocket;

  console.log('🔌 WebSocket connected:', runtimeSocket.data.sessionId);
  eventSystem.info(EventCategory.SESSION, '🔌 [runtime-node] WebSocket opened', {
    sessionId: runtimeSocket.data.sessionId,
    model: runtimeSocket.data.model,
  });

  runtimeSocket.send(
    JSON.stringify({
      type: 'session.created',
      event_id: generateEventId(),
      session: {
        id: runtimeSocket.data.sessionId,
        object: 'realtime.session',
        model: runtimeSocket.data.model,
        ...runtimeSocket.data.config,
      },
    })
  );

  let initialGreetingHandled = false;
  let initialGreetingTimer: ReturnType<typeof setTimeout> | undefined;
  const triggerInitialGreeting = (): void => {
    if (
      initialGreetingHandled ||
      !runtimeSocket.data.config.initial_greeting_prompt ||
      runtimeSocket.readyState !== 1
    ) {
      return;
    }

    initialGreetingHandled = true;
    if (initialGreetingTimer) {
      clearTimeout(initialGreetingTimer);
      initialGreetingTimer = undefined;
    }

    queueMicrotask(async () => {
      try {
        await handleInitialGreeting(runtimeSocket as any);
      } catch (error) {
        console.error('❌ Initial greeting failed:', error);
      }
    });
  };

  runtimeSocket.on('message', async (message: RawData) => {
    const text =
      typeof message === 'string'
        ? message
        : Buffer.isBuffer(message)
          ? message.toString('utf8')
          : Buffer.from(message as ArrayBuffer).toString('utf8');

    let parsedEvent: { type?: string } | null = null;
    if (!isAudioChunkMessage(text)) {
      try {
        parsedEvent = JSON.parse(text) as { type?: string };
        console.log('📨 Message received:', parsedEvent.type || text.slice(0, 100));
      } catch {
        console.log('📨 Message received:', text.slice(0, 100));
      }
    }

    try {
      await handleMessage(runtimeSocket as any, text);
      if (parsedEvent?.type === 'session.update') {
        triggerInitialGreeting();
      }
    } catch (error) {
      eventSystem.error(
        EventCategory.SESSION,
        '❌ [runtime-node] Failed to handle WebSocket message',
        error instanceof Error ? error : new Error(String(error)),
        { sessionId: runtimeSocket.data.sessionId }
      );
      runtimeSocket.close(1011, 'Internal server error');
    }
  });

  if (runtimeSocket.data.config.initial_greeting_prompt) {
    initialGreetingTimer = setTimeout(triggerInitialGreeting, 250);
  }

  runtimeSocket.on('close', (code, reason) => {
    if (initialGreetingTimer) {
      clearTimeout(initialGreetingTimer);
      initialGreetingTimer = undefined;
    }

    const reasonText = reason.toString();
    console.log('🔌 WebSocket disconnected:', runtimeSocket.data.sessionId, {
      code,
      reason: reasonText,
    });
    eventSystem.info(EventCategory.SESSION, '🔌 [runtime-node] WebSocket closed', {
      sessionId: runtimeSocket.data.sessionId,
      code,
      reason: reasonText,
    });
  });

  runtimeSocket.on('error', (error) => {
    eventSystem.error(
      EventCategory.SESSION,
      '❌ [runtime-node] WebSocket error',
      error,
      { sessionId: runtimeSocket.data.sessionId }
    );
  });
});

const port = serverConfig.port;
httpServer.listen(port, () => {
  console.log(`✅ Server running on ws://localhost:${port}/v1/realtime`);
});

export { httpServer as server };
