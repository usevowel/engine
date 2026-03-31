/**
 * Provider Registry
 * 
 * Dynamic registration system for STT, TTS, and VAD providers.
 * Allows runtime registration so hosted-only providers don't need
 * to be enumerated in the OSS release.
 */

import { z } from 'zod';
import { ISTTProvider, ITTSProvider, IVADProvider, ProviderCapabilities } from '../../types/providers';
import { RuntimeProviderConfig } from '../../config/RuntimeConfig';

/**
 * Registration descriptor for a single provider
 */
export interface ProviderRegistration<P, C> {
  name: string;
  category: 'stt' | 'tts' | 'vad';
  capabilities: ProviderCapabilities;
  configSchema: z.ZodSchema<C>;
  factory: (config: C, fullRuntimeConfig?: RuntimeProviderConfig) => P | Promise<P>;
  /** Optional cost metadata for analytics and usage tracking */
  costConfig?: {
    costPerMinute?: number;
    costPerCharacter?: number;
    costPer1KInputTokens?: number;
    costPer1KOutputTokens?: number;
    unit?: 'minute' | 'character' | 'token' | 'request';
    notes?: string;
  };
}

/**
 * Central registry for all provider types.
 * 
 * OSS runtimes call `registerOSSProviders()` at startup.
 * Hosted runtimes additionally call `registerHostedProviders()`.
 * Node runtimes register Silero VAD on top of the OSS set.
 */
export class ProviderRegistry {
  private static sttProviders = new Map<string, ProviderRegistration<ISTTProvider, unknown>>();
  private static ttsProviders = new Map<string, ProviderRegistration<ITTSProvider, unknown>>();
  private static vadProviders = new Map<string, ProviderRegistration<IVADProvider, unknown>>();

  // ── Registration ──────────────────────────────────────────────────────────

  static registerSTT<C>(registration: ProviderRegistration<ISTTProvider, C>): void {
    if (this.sttProviders.has(registration.name)) {
      throw new Error(`STT provider '${registration.name}' already registered`);
    }
    this.sttProviders.set(registration.name, registration as ProviderRegistration<ISTTProvider, unknown>);
  }

  static registerTTS<C>(registration: ProviderRegistration<ITTSProvider, C>): void {
    if (this.ttsProviders.has(registration.name)) {
      throw new Error(`TTS provider '${registration.name}' already registered`);
    }
    this.ttsProviders.set(registration.name, registration as ProviderRegistration<ITTSProvider, unknown>);
  }

  static registerVAD<C>(registration: ProviderRegistration<IVADProvider, C>): void {
    if (this.vadProviders.has(registration.name)) {
      throw new Error(`VAD provider '${registration.name}' already registered`);
    }
    this.vadProviders.set(registration.name, registration as ProviderRegistration<IVADProvider, unknown>);
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  static getSTTProvider(name: string): ProviderRegistration<ISTTProvider, unknown> | undefined {
    return this.sttProviders.get(name);
  }

  static getTTSProvider(name: string): ProviderRegistration<ITTSProvider, unknown> | undefined {
    return this.ttsProviders.get(name);
  }

  static getVADProvider(name: string): ProviderRegistration<IVADProvider, unknown> | undefined {
    return this.vadProviders.get(name);
  }

  // ── Enumeration ───────────────────────────────────────────────────────────

  static getAvailableSTTProviders(): string[] {
    return Array.from(this.sttProviders.keys());
  }

  static getAvailableTTSProviders(): string[] {
    return Array.from(this.ttsProviders.keys());
  }

  static getAvailableVADProviders(): string[] {
    return Array.from(this.vadProviders.keys());
  }

  // ── Testing ───────────────────────────────────────────────────────────────

  static clear(): void {
    this.sttProviders.clear();
    this.ttsProviders.clear();
    this.vadProviders.clear();
  }
}
