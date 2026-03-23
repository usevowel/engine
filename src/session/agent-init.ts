/**
 * Shared agent initialization helper for runtime adapters and session handlers.
 */

import type { SessionData } from './types';
import type { RuntimeConfig } from '../config/RuntimeConfig';
import { AgentFactory } from '../services/agents';
import { SoundbirdAgent } from '../services/agent-provider';
import { config, buildSystemPrompt, isSubagentModeEnabled } from '../config/env';
import { getEventSystem, EventCategory } from '../events';

export function initializeAgent(sessionData: SessionData, runtimeConfig: RuntimeConfig): void {
  if (sessionData.agent || sessionData.newAgent) {
    getEventSystem().info(EventCategory.LLM, 'Agent already exists, skipping initialization');
    return;
  }

  getEventSystem().info(EventCategory.LLM, '🤖 Initializing Agent Mode...');

  const provider = runtimeConfig?.llm.provider || (sessionData.model.includes('/') ? 'openrouter' : 'groq');

  if (runtimeConfig?.llm.provider) {
    getEventSystem().info(EventCategory.LLM, `   ✅ Using LLM provider from token/config: ${provider}`);
  } else {
    getEventSystem().warn(EventCategory.LLM, `   ⚠️  Using heuristic LLM provider (no token override): ${provider}`);
  }

  const subagentMode = isSubagentModeEnabled(runtimeConfig);
  const maxSteps = subagentMode ? 2 : (sessionData.agentConfig?.maxSteps || 6);
  const maxContextMessages = sessionData.agentConfig?.maxContextMessages || 15;

  if (subagentMode) {
    getEventSystem().info(
      EventCategory.LLM,
      `🤖 [Subagent Mode] Limiting main agent to ${maxSteps} steps to prevent repeated askSubagent calls`
    );
  }

  const useModularAgents = runtimeConfig?.agent?.useModularAgents ?? config.agent.useModularAgents;

  if (useModularAgents) {
    const agentType = sessionData.agentType || runtimeConfig?.agent?.defaultType || config.agent.defaultType;

    getEventSystem().info(EventCategory.LLM, `🏭 Using new modular agent system (type: ${agentType})`);

    const apiKey = runtimeConfig.llm.apiKey;
    const keyPreview = apiKey
      ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`
      : 'MISSING';
    getEventSystem().info(
      EventCategory.SESSION,
      `🔑 Agent Init: Creating agent with provider=${provider}, apiKey=${keyPreview}`
    );

    const posthogSessionId = sessionData.sessionKey || sessionData.sessionId;
    const systemPromptGenerator = (context?: {
      targetLanguage?: string | null;
      userInstructions?: string;
      agentType?: string;
      speechMode?: 'implicit' | 'explicit';
    }) => {
      const targetLanguage = context?.targetLanguage ?? sessionData.language?.current ?? sessionData.language?.detected ?? null;
      const userInstructions = context?.userInstructions ?? sessionData.config.instructions;
      const agentTypeForPrompt = context?.agentType ?? agentType;
      const speechMode = context?.speechMode;
      return buildSystemPrompt(userInstructions, agentTypeForPrompt, speechMode, targetLanguage);
    };

    sessionData.newAgent = AgentFactory.create({
      agentType,
      provider,
      apiKey,
      model: sessionData.model,
      systemPrompt: systemPromptGenerator,
      maxSteps,
      maxContextMessages,
      openrouterSiteUrl: runtimeConfig.llm.openrouterSiteUrl,
      openrouterAppName: runtimeConfig.llm.openrouterAppName,
      contextStrategy: 'message-count',
      maxStreamRetries: runtimeConfig?.agent?.maxStreamRetries ?? config.agent.maxStreamRetries,
      sessionId: posthogSessionId,
      groqReasoningEffort: sessionData.groqReasoningEffort,
    });

    getEventSystem().info(EventCategory.LLM, '✅ Modular Agent initialized');
    getEventSystem().info(EventCategory.LLM, `   Type: ${agentType}`);
  } else {
    getEventSystem().info(EventCategory.LLM, '🔧 Using legacy agent system (SoundbirdAgent)');

    const posthogSessionId = sessionData.sessionKey || sessionData.sessionId;

    sessionData.agent = new SoundbirdAgent({
      provider,
      apiKey: runtimeConfig.llm.apiKey,
      model: sessionData.model,
      systemPrompt: buildSystemPrompt(
        sessionData.config.instructions,
        undefined,
        undefined,
        sessionData.language?.current || sessionData.language?.detected || null
      ),
      maxSteps,
      maxContextMessages,
      openrouterSiteUrl: runtimeConfig.llm.openrouterSiteUrl,
      openrouterAppName: runtimeConfig.llm.openrouterAppName,
      sessionId: posthogSessionId,
    });

    getEventSystem().info(EventCategory.LLM, '✅ Legacy Agent initialized');
  }

  sessionData.useAgentMode = true;

  getEventSystem().info(EventCategory.PROVIDER, `   Provider: ${provider}`);
}
