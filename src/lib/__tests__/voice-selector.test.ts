import { describe, expect, test } from 'bun:test';
import { selectVoiceForLanguageChange } from '../voice-selector';

describe('selectVoiceForLanguageChange', () => {
  test('keeps a remembered configured voice when returning to its language', () => {
    const result = selectVoiceForLanguageChange(
      'en',
      'Timothy',
      'Timothy',
      'Diego',
      undefined,
      {
        en: 'Timothy',
        es: 'Diego',
      }
    );

    expect(result).toBe('Timothy');
  });

  test('keeps the current voice when it is already valid for the detected language', () => {
    const result = selectVoiceForLanguageChange(
      'en',
      'Timothy',
      'Timothy',
      'Timothy'
    );

    expect(result).toBe('Timothy');
  });

  test('Grok TTS: keeps the current Grok voice when the locale changes (no Inworld mapping)', () => {
    const result = selectVoiceForLanguageChange(
      'es',
      'rex',
      'rex',
      'eve',
      undefined,
      undefined,
      'grok'
    );
    expect(result).toBe('eve');
  });

  test('Grok TTS: restores last Grok voice for a language from session memory', () => {
    const result = selectVoiceForLanguageChange(
      'en',
      'rex',
      'rex',
      'sal',
      undefined,
      { en: 'eve', es: 'leo' },
      'grok'
    );
    expect(result).toBe('eve');
  });

  test('Grok TTS: ignores non-Grok lastVoice entries and falls back to a valid Grok id', () => {
    const result = selectVoiceForLanguageChange(
      'en',
      'rex',
      'rex',
      'sal',
      undefined,
      { en: 'Ashley' },
      'grok'
    );
    // Memory has invalid id for Grok; prefer current then initial
    expect(result).toBe('sal');
  });
});
