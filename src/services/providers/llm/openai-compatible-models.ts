import { getEventSystem, EventCategory } from '../../../events';

interface CachedModels {
  fetchedAt: number;
  models: string[];
}

const modelCache = new Map<string, CachedModels>();
const CACHE_TTL_MS = 30_000;

export async function resolveOpenAICompatibleModel(
  baseUrl: string | undefined,
  apiKey: string,
  preferredModel: string,
): Promise<string> {
  if (!baseUrl) {
    return preferredModel;
  }

  const models = await getOpenAICompatibleModels(baseUrl, apiKey);
  if (models.length === 0) {
    return preferredModel;
  }

  if (models.includes(preferredModel)) {
    return preferredModel;
  }

  const fallbackModel = models[0];
  getEventSystem().warn(
    EventCategory.PROVIDER,
    `⚠️  Preferred openai-compatible model \"${preferredModel}\" not found at ${baseUrl}; falling back to \"${fallbackModel}\"`
  );
  return fallbackModel;
}

async function getOpenAICompatibleModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const cached = modelCache.get(normalizedBaseUrl);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.models;
  }

  try {
    const response = await fetch(`${normalizedBaseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      getEventSystem().warn(
        EventCategory.PROVIDER,
        `⚠️  Failed to fetch openai-compatible models from ${normalizedBaseUrl}/models (${response.status})`
      );
      return [];
    }

    const payload = await response.json() as { data?: Array<{ id?: string }> };
    const models = (payload.data || [])
      .map((entry) => entry.id)
      .filter((id): id is string => Boolean(id));

    modelCache.set(normalizedBaseUrl, {
      fetchedAt: Date.now(),
      models,
    });

    getEventSystem().info(
      EventCategory.PROVIDER,
      `📚 OpenAI-compatible models discovered from ${normalizedBaseUrl}: ${models.join(', ') || '(none)'}`
    );

    return models;
  } catch (error) {
    getEventSystem().warn(
      EventCategory.PROVIDER,
      `⚠️  Error fetching openai-compatible models from ${normalizedBaseUrl}/models: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}
