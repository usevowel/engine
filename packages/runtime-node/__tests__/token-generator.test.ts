/**
 * Token Generator Tests
 * 
 * Tests for JWT token generation and verification.
 * 
 * @module __tests__
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { generateEphemeralToken, verifyToken, type TokenPayload } from '../src/auth/token-generator';

describe('Token Generator', () => {
  beforeAll(() => {
    // Ensure JWT_SECRET is set for tests
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-unit-tests';
  });

  describe('generateEphemeralToken', () => {
    test('should generate token with payload', async () => {
      const payload: TokenPayload = {
        model: 'test-model',
        voice: 'Ashley',
      };
      
      const token = await generateEphemeralToken(payload);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.startsWith('ek_')).toBe(true);
    });
    
    test('should generate tokens with ek_ prefix', async () => {
      const payload: TokenPayload = { model: 'test' };
      
      const token1 = await generateEphemeralToken(payload);
      const token2 = await generateEphemeralToken(payload);
      
      // Both should have ek_ prefix (JWT tokens may be identical if generated in same second)
      expect(token1.startsWith('ek_')).toBe(true);
      expect(token2.startsWith('ek_')).toBe(true);
    });
    
    test('should handle empty payload', async () => {
      const token = await generateEphemeralToken({});
      
      expect(token).toBeDefined();
      expect(token.startsWith('ek_')).toBe(true);
    });
    
    test('should handle complex payload', async () => {
      const payload: TokenPayload = {
        model: 'test-model',
        voice: 'Ashley',
        speakingRate: 1.2,
        customField: 'custom-value',
      };
      
      const token = await generateEphemeralToken(payload);
      
      expect(token).toBeDefined();
    });
  });

  describe('verifyToken', () => {
    test('should verify valid token', async () => {
      const payload: TokenPayload = {
        model: 'test-model',
        voice: 'Ashley',
      };
      
      const token = await generateEphemeralToken(payload);
      const verified = await verifyToken(token);
      
      expect(verified.model).toBe('test-model');
      expect(verified.voice).toBe('Ashley');
    });
    
    test('should verify token without ek_ prefix', async () => {
      const payload: TokenPayload = { model: 'test' };
      
      const token = await generateEphemeralToken(payload);
      const tokenWithoutPrefix = token.replace('ek_', '');
      const verified = await verifyToken(tokenWithoutPrefix);
      
      expect(verified.model).toBe('test');
    });
    
    test('should throw error for invalid token', async () => {
      await expect(verifyToken('invalid-token')).rejects.toThrow();
    });
    
    test('should throw error for malformed token', async () => {
      await expect(verifyToken('ek_invalid')).rejects.toThrow();
    });
    
    test('should throw error for empty token', async () => {
      await expect(verifyToken('')).rejects.toThrow();
    });
  });

  describe('round-trip', () => {
    test('should generate and verify token', async () => {
      const originalPayload: TokenPayload = {
        model: 'moonshotai/kimi-k2-instruct-0905',
        voice: 'Ashley',
        speakingRate: 1.5,
      };
      
      const token = await generateEphemeralToken(originalPayload);
      const verified = await verifyToken(token);
      
      expect(verified.model).toBe(originalPayload.model);
      expect(verified.voice).toBe(originalPayload.voice);
      expect(verified.speakingRate).toBe(originalPayload.speakingRate);
    });
  });
});
