/**
 * Token Generator
 * 
 * JWT token generation and verification for ephemeral sessions.
 * 
 * @module auth
 */

import { SignJWT, jwtVerify } from 'jose';

const TOKEN_EXPIRATION = '5m';

export interface TokenPayload {
  model?: string;
  voice?: string;
  [key: string]: unknown;
}

/**
 * Generate ephemeral token
 */
export async function generateEphemeralToken(payload: TokenPayload): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'default-secret');
  
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(TOKEN_EXPIRATION)
    .setIssuedAt()
    .sign(secret);
  
  return `ek_${token}`;
}

/**
 * Verify ephemeral token
 */
export async function verifyToken(token: string): Promise<TokenPayload> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'default-secret');
  
  // Remove ek_ prefix if present
  const jwt = token.startsWith('ek_') ? token.slice(3) : token;
  
  const { payload } = await jwtVerify(jwt, secret);
  
  return payload as TokenPayload;
}
