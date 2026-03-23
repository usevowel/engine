/**
 * Connection Paradigm Detection
 * 
 * Utilities for detecting and tracking connection paradigms used by clients.
 * Used for analytics and understanding usage patterns.
 */

export type ConnectionParadigm = 
  | 'direct'
  | 'fixed_api_key'
  | 'developer_managed'
  | 'sidecar'
  | 'openai_compatible';

export interface ConnectionParadigmInfo {
  paradigm: ConnectionParadigm;
  apiKeyId?: string;
  sessionKey?: string;
  clientCount?: number;
  backendService?: string;
}

/**
 * Detect connection paradigm from request and token payload
 */
export function detectConnectionParadigm(
  request: Request,
  tokenPayload: Record<string, any>
): ConnectionParadigmInfo {
  const url = new URL(request.url);

  // Check for call_id query param (OpenAI compatible)
  if (url.searchParams.has('call_id')) {
    return {
      paradigm: 'openai_compatible',
    };
  }

  // Check for sessionKey in token (sidecar/developer-managed)
  if (tokenPayload.sessionKey) {
    return {
      paradigm: tokenPayload.sidecar ? 'sidecar' : 'developer_managed',
      sessionKey: tokenPayload.sessionKey,
      backendService: tokenPayload.backendService,
    };
  }

  // Check API key prefix (fixed API key)
  const authHeader = request.headers.get('Authorization');
  const apiKey = authHeader?.split(' ')[1];
  if (apiKey?.startsWith('vkey_')) {
    return {
      paradigm: 'fixed_api_key',
      apiKeyId: maskApiKey(apiKey),
    };
  }

  // Default: direct client connection
  return {
    paradigm: 'direct',
  };
}

/**
 * Mask API key for logging/tracking
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 12) {
    return '***';
  }
  return `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}`;
}
