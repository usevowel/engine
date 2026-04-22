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
});
