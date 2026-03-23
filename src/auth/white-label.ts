/**
 * White-label API Key Authentication
 * 
 * Supports fixed API keys for trusted partner backends.
 * Verifies keys against vowel Convex verification endpoint.
 */

import { config } from '../config/env';

import { getEventSystem, EventCategory } from '../events';
export interface WhiteLabelVerificationResult {
  valid: boolean;
  error?: string;
  appId?: string;
  platformId?: string;
  usageSink?: {
    mirrorToVowel: boolean;
    partnerWebhook?: string;
    partnerAuthHeader?: string;
    polarCustomerId: string;
  };
  limits?: {
    sessionsPerMinute: number;
  };
  features?: {
    allowEphemeralMint: boolean;
    allowDirectWebSocket: boolean;
  };
}

/**
 * Verify a white-label API key against Convex endpoint
 * 
 * @param apiKey Fixed API key (starts with vwl_wl_)
 * @param purpose Connection purpose (direct_ws or mint_ephemeral)
 * @returns Verification result with app metadata
 */
export async function verifyWhiteLabelKey(
  apiKey: string,
  purpose?: 'direct_ws' | 'mint_ephemeral'
): Promise<WhiteLabelVerificationResult> {
  try {
    const verifyUrl = config.whiteLabelVerifyUrl || process.env.VOWEL_VERIFY_API_URL;
    
    if (!verifyUrl) {
      getEventSystem().error(EventCategory.AUTH, '❌ White-label verify URL not configured');
      return {
        valid: false,
        error: 'Verification endpoint not configured',
      };
    }

    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ purpose }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      getEventSystem().error(EventCategory.AUTH, `❌ White-label verification failed (${response.status}):`, errorData);
      return {
        valid: false,
        error: errorData.error || `Verification failed: ${response.status}`,
      };
    }

    const result = await response.json();
    getEventSystem().info(EventCategory.AUTH, `✅ White-label key verified: ${result.platformId}/${result.appId}`);
    
    return result;
  } catch (error) {
    getEventSystem().error(EventCategory.AUTH, '❌ White-label verification error:', error);
    return {
      valid: false,
      error: 'Verification request failed',
    };
  }
}

/**
 * Check if a token is a white-label API key
 * 
 * @param token Token string
 * @returns True if token is a white-label key
 */
export function isWhiteLabelKey(token: string): boolean {
  return token.startsWith('vwl_wl_');
}

/**
 * Report usage to vowel mirror endpoint
 * 
 * @param eventId Unique event ID
 * @param appId App ID
 * @param sessionId Session ID
 * @param audioMinutes Audio duration in minutes
 * @param metadata Additional metadata
 */
export async function mirrorUsageToVowel(
  eventId: string,
  appId: string,
  sessionId: string,
  audioMinutes: number,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const mirrorUrl = config.whiteLabelUsageMirrorUrl || process.env.VOWEL_USAGE_MIRROR_URL;
    const internalToken = config.whiteLabelInternalToken || process.env.INTERNAL_USAGE_TOKEN;

    if (!mirrorUrl || !internalToken) {
      getEventSystem().error(EventCategory.AUTH, '❌ Usage mirror URL or token not configured');
      return;
    }

    const response = await fetch(mirrorUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${internalToken}`,
      },
      body: JSON.stringify({
        eventId,
        appId,
        sessionId,
        audioMinutes,
        metadata,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      getEventSystem().error(EventCategory.AUTH, `❌ Usage mirroring failed (${response.status}):`, errorData);
      return;
    }

    const result = await response.json();
    getEventSystem().info(EventCategory.AUDIO, `✅ Usage mirrored to vowel: ${audioMinutes} min (${result.costCents}¢)`);
  } catch (error) {
    getEventSystem().error(EventCategory.AUTH, '❌ Usage mirroring error:', error);
  }
}

/**
 * Generate event ID from session ID and timestamp
 * 
 * @param sessionId Session ID
 * @param timestamp Timestamp in milliseconds
 * @returns Event ID hash
 */
export async function generateEventId(sessionId: string, timestamp: number): Promise<string> {
  const data = `${sessionId}:${timestamp}`;
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

