/**
 * Set Language Tool Tests
 * 
 * Tests for the setLanguage server-side tool.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { executeSetLanguageTool } from '../src/lib/server-tools/set-language';
import type { ServerToolContext } from '../src/lib/server-tool-registry';
import type { SessionData } from '../src/session/types';

// Mock WebSocket
const mockWs = {} as any;

// Create test context helper
function createTestContext(sessionData: Partial<SessionData> = {}): ServerToolContext {
  return {
    ws: mockWs,
    sessionData: {
      sessionId: 'test-session',
      model: 'test-model',
      config: {
        voice: 'Ashley', // Default English voice
        modalities: ['audio', 'text'],
        instructions: 'Test instructions',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
        tools: [],
        tool_choice: 'auto',
        temperature: 0.7,
        max_response_output_tokens: 4096,
      },
      audioBuffer: null,
      conversationHistory: [],
      currentResponseId: null,
      vadEnabled: false,
      audioBufferStartMs: 0,
      totalAudioMs: 0,
      language: {
        current: 'en',
        detected: null,
        configured: 'en',
        detectionEnabled: true,
      },
      ...sessionData,
    } as SessionData,
    responseId: 'test-response',
    itemId: 'test-item',
    voice: 'Ashley',
    speakingRate: 1.0,
    latency: {
      responseStart: 0,
      asrStart: 0,
      asrEnd: 0,
      llmStreamStart: 0,
      llmFirstToken: 0,
      llmStreamEnd: 0,
      llmTokenCount: 0,
      firstAudioSent: 0,
      ttsChunks: [],
      responseEnd: 0,
    },
  };
}

describe('setLanguage tool', () => {
  describe('basic functionality', () => {
    test('should switch language successfully', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'es' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newLanguage).toBe('es');
      expect(result.data?.previousLanguage).toBe('en');
      expect(context.sessionData.language?.current).toBe('es');
      expect(context.sessionData.language?.configured).toBe('es');
    });

    test('should normalize language code to lowercase 2-letter code', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'ES' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newLanguage).toBe('es');
      expect(context.sessionData.language?.current).toBe('es');
    });

    test('should handle missing language state gracefully', async () => {
      const context = createTestContext({ language: undefined });
      
      const result = await executeSetLanguageTool(
        { languageCode: 'fr' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newLanguage).toBe('fr');
      expect(context.sessionData.language?.current).toBe('fr');
      expect(context.sessionData.language?.configured).toBe('fr');
    });

    test('should report "none" when no previous language', async () => {
      const context = createTestContext({
        language: {
          current: null,
          detected: null,
          configured: null,
          detectionEnabled: false,
        },
      });
      
      const result = await executeSetLanguageTool(
        { languageCode: 'de' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.previousLanguage).toBe('none');
      expect(result.data?.newLanguage).toBe('de');
    });
  });

  describe('language detection service integration', () => {
    test('should update language detection service if available', async () => {
      const mockSetConfiguredLanguage = () => {};
      const context = createTestContext({
        languageDetectionService: {
          setConfiguredLanguage: mockSetConfiguredLanguage,
        },
      });
      
      const result = await executeSetLanguageTool(
        { languageCode: 'ja' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(context.sessionData.language?.current).toBe('ja');
    });

    test('should work without language detection service', async () => {
      const context = createTestContext({
        languageDetectionService: undefined,
      });
      
      const result = await executeSetLanguageTool(
        { languageCode: 'zh' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(context.sessionData.language?.current).toBe('zh');
    });
  });

  describe('error handling', () => {
    test('should fail with invalid language code (missing)', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        {},
        context
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid language code');
      expect(result.addToHistory).toBe(false);
    });

    test('should fail with invalid language code (non-string)', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 123 },
        context
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid language code');
    });

    test('should fail with empty language code', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: '' },
        context
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid language code');
    });

    test('should fail with unsupported language code', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'xx' },
        context
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported language code');
    });

    test('should fail with unknown language name', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'klingon' },
        context
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown language');
    });
  });

  describe('language names and aliases', () => {
    test('should accept full language name (english)', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'english' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newLanguage).toBe('en');
      expect(result.data?.languageName).toBe('english');
    });

    test('should accept full language name (spanish)', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'spanish' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newLanguage).toBe('es');
      expect(result.data?.languageName).toBe('spanish');
    });

    test('should accept language alias (mandarin)', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'mandarin' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newLanguage).toBe('zh');
    });

    test('should accept language alias (castilian)', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'castilian' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newLanguage).toBe('es');
    });

    test('should be case-insensitive', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'FRENCH' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newLanguage).toBe('fr');
      expect(result.data?.languageName).toBe('french');
    });
  });

  describe('supported languages', () => {
    // Sample of Whisper's 99+ supported languages
    const whisperLanguages = [
      'en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ru',
      'nl', 'pl', 'ar', 'hi', 'tr', 'vi', 'th', 'sv', 'no', 'da',
      'fi', 'el', 'he', 'cs', 'ro', 'hu', 'ca', 'id', 'uk', 'ms',
      'ta', 'ur', 'hr', 'bg', 'lt', 'la', 'mi', 'ml', 'cy', 'sk',
      'te', 'fa', 'lv', 'bn', 'sr', 'az', 'sl', 'kn', 'et', 'mk',
      'br', 'eu', 'is', 'hy', 'ne', 'mn', 'bs', 'kk', 'sq', 'sw',
      'gl', 'mr', 'pa', 'si', 'km', 'sn', 'yo', 'so', 'af', 'oc',
      'ka', 'be', 'tg', 'sd', 'gu', 'am', 'yi', 'lo', 'uz', 'fo',
      'ht', 'ps', 'tk', 'nn', 'mt', 'sa', 'lb', 'my', 'bo', 'tl',
      'mg', 'as', 'tt', 'haw', 'ln', 'ha', 'ba', 'jw', 'su', 'yue',
    ];

    whisperLanguages.forEach(lang => {
      test(`should switch to ${lang} successfully`, async () => {
        const context = createTestContext();
        
        const result = await executeSetLanguageTool(
          { languageCode: lang },
          context
        );
        
        expect(result.success).toBe(true);
        expect(result.data?.newLanguage).toBe(lang);
        expect(context.sessionData.language?.current).toBe(lang);
      });
    });
  });

  describe('history tracking', () => {
    test('should mark tool call for addition to history on success', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'es' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.addToHistory).toBe(true);
    });

    test('should not add to history on error', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: '' },
        context
      );
      
      expect(result.success).toBe(false);
      expect(result.addToHistory).toBe(false);
    });
  });

  describe('voice selection', () => {
    test('should switch voice for supported language (Spanish)', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'es' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newVoice).toBeDefined();
      expect(result.data?.voiceChanged).toBe(true);
      // Should select a Spanish voice (Diego, Miguel, Rafael, or Lupita)
      expect(['Diego', 'Miguel', 'Rafael', 'Lupita']).toContain(result.data?.newVoice);
      expect(context.sessionData.config?.voice).toBe(result.data?.newVoice);
    });

    test('should switch voice for supported language (French)', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'fr' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newVoice).toBeDefined();
      // Should select a French voice (Alain, Mathieu, Étienne, or Hélène)
      expect(['Alain', 'Mathieu', 'Étienne', 'Hélène']).toContain(result.data?.newVoice);
    });

    test('should maintain gender preference when switching languages', async () => {
      // Start with female voice (Ashley)
      const context = createTestContext({
        config: {
          voice: 'Ashley', // Female English voice
          modalities: ['audio', 'text'],
          instructions: 'Test',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
          tools: [],
          tool_choice: 'auto',
          temperature: 0.7,
          max_response_output_tokens: 4096,
        } as any,
      });
      
      const result = await executeSetLanguageTool(
        { languageCode: 'es' },
        context
      );
      
      expect(result.success).toBe(true);
      // Should prefer female Spanish voice (Lupita)
      expect(result.data?.newVoice).toBe('Lupita');
    });

    test('should fallback to English voice for unsupported language', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'sw' }, // Swahili - not supported by Inworld TTS
        context
      );
      
      expect(result.success).toBe(true);
      // Should fallback to Ashley (English voice)
      expect(result.data?.newVoice).toBe('Ashley');
    });

    test('should keep current voice if already appropriate for language', async () => {
      // Start with Spanish voice
      const context = createTestContext({
        config: {
          voice: 'Diego', // Spanish male voice
          modalities: ['audio', 'text'],
          instructions: 'Test',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
          tools: [],
          tool_choice: 'auto',
          temperature: 0.7,
          max_response_output_tokens: 4096,
        } as any,
        language: {
          current: 'en',
          detected: null,
          configured: 'en',
          detectionEnabled: true,
        },
      });
      
      const result = await executeSetLanguageTool(
        { languageCode: 'es' },
        context
      );
      
      expect(result.success).toBe(true);
      // Should keep Diego since it's already a Spanish voice
      expect(result.data?.newVoice).toBe('Diego');
      expect(result.data?.voiceChanged).toBe(false);
    });

    test('should update session config with new voice', async () => {
      const context = createTestContext();
      const originalVoice = context.sessionData.config?.voice;
      
      const result = await executeSetLanguageTool(
        { languageCode: 'ja' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(context.sessionData.config?.voice).not.toBe(originalVoice);
      expect(context.sessionData.config?.voice).toBe(result.data?.newVoice);
    });

    test('should include voice information in response', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'de' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.previousVoice).toBe('Ashley');
      expect(result.data?.newVoice).toBeDefined();
      expect(result.data?.voiceChanged).toBeDefined();
      expect(typeof result.data?.voiceChanged).toBe('boolean');
    });
  });

  describe('Language Voice Map (Token Config)', () => {
    test('should use preferred voice from token config languageVoiceMap', async () => {
      const context = createTestContext({
        languageVoiceMap: {
          'es': 'Miguel', // Prefer Miguel for Spanish
          'fr': 'Mathieu', // Prefer Mathieu for French
        },
      });
      
      const result = await executeSetLanguageTool(
        { languageCode: 'es' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newVoice).toBe('Miguel'); // Should use token config preference
      expect(context.sessionData.config?.voice).toBe('Miguel');
    });

    test('should prioritize token config over gender preference', async () => {
      const context = createTestContext({
        config: {
          voice: 'Ashley', // Female voice (gender preference)
        } as any,
        languageVoiceMap: {
          'es': 'Diego', // Male voice in token config
        },
      });
      
      const result = await executeSetLanguageTool(
        { languageCode: 'es' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newVoice).toBe('Diego'); // Token config wins over gender
    });

    test('should fall back to gender preference if language not in token config', async () => {
      const context = createTestContext({
        config: {
          voice: 'Ashley', // Female voice
        } as any,
        languageVoiceMap: {
          'es': 'Miguel', // Only Spanish configured
        },
      });
      
      const result = await executeSetLanguageTool(
        { languageCode: 'fr' }, // French not in token config
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newVoice).toBe('Hélène'); // Female French voice (gender preference)
    });
  });

  describe('Last Voice Per Language (Runtime Tracking)', () => {
    test('should track last used voice for a language', async () => {
      const context = createTestContext();
      
      const result = await executeSetLanguageTool(
        { languageCode: 'es' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(context.sessionData.lastVoicePerLanguage).toBeDefined();
      expect(context.sessionData.lastVoicePerLanguage?.['es']).toBe(result.data?.newVoice);
    });

    test('should reuse last voice when switching back to a language', async () => {
      const context = createTestContext({
        lastVoicePerLanguage: {
          'es': 'Rafael', // Previously used Rafael for Spanish
        },
      });
      
      const result = await executeSetLanguageTool(
        { languageCode: 'es' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newVoice).toBe('Rafael'); // Should reuse last voice
    });

    test('should prioritize last voice over token config', async () => {
      const context = createTestContext({
        languageVoiceMap: {
          'es': 'Diego', // Token config preference
        },
        lastVoicePerLanguage: {
          'es': 'Miguel', // Previously used Miguel (session memory)
        },
      });
      
      const result = await executeSetLanguageTool(
        { languageCode: 'es' },
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.newVoice).toBe('Miguel'); // Session memory wins
    });

    test('should track different voices for different languages', async () => {
      const context = createTestContext();
      
      // Switch to Spanish
      const result1 = await executeSetLanguageTool(
        { languageCode: 'es' },
        context
      );
      const spanishVoice = result1.data?.newVoice;
      
      // Switch to French
      const result2 = await executeSetLanguageTool(
        { languageCode: 'fr' },
        context
      );
      const frenchVoice = result2.data?.newVoice;
      
      // Verify both are tracked
      expect(context.sessionData.lastVoicePerLanguage?.['es']).toBe(spanishVoice);
      expect(context.sessionData.lastVoicePerLanguage?.['fr']).toBe(frenchVoice);
      expect(spanishVoice).not.toBe(frenchVoice);
    });

    test('should update last voice if voice changes for a language', async () => {
      const context = createTestContext({
        lastVoicePerLanguage: {
          'es': 'Lupita',
        },
      });
      
      // Manually change voice to Diego
      if (context.sessionData.config) {
        context.sessionData.config.voice = 'Diego';
      }
      
      // Switch to Spanish again
      const result = await executeSetLanguageTool(
        { languageCode: 'es' },
        context
      );
      
      expect(result.success).toBe(true);
      // Should still use Lupita (session memory)
      expect(result.data?.newVoice).toBe('Lupita');
      // And track it again
      expect(context.sessionData.lastVoicePerLanguage?.['es']).toBe('Lupita');
    });
  });

  describe('Voice Selection Priority Order', () => {
    test('should follow priority: session memory > token config > gender', async () => {
      // Test 1: No preferences - use gender
      const context1 = createTestContext({
        config: { voice: 'Ashley' } as any, // Female
      });
      
      const result1 = await executeSetLanguageTool(
        { languageCode: 'es' },
        context1
      );
      
      expect(result1.data?.newVoice).toBe('Lupita'); // Female Spanish voice (gender)
      
      // Test 2: Token config present - use token config
      const context2 = createTestContext({
        config: { voice: 'Ashley' } as any, // Female
        languageVoiceMap: { 'es': 'Diego' }, // Male in token config
      });
      
      const result2 = await executeSetLanguageTool(
        { languageCode: 'es' },
        context2
      );
      
      expect(result2.data?.newVoice).toBe('Diego'); // Token config wins
      
      // Test 3: Session memory present - use session memory
      const context3 = createTestContext({
        config: { voice: 'Ashley' } as any, // Female
        languageVoiceMap: { 'es': 'Diego' }, // Male in token config
        lastVoicePerLanguage: { 'es': 'Miguel' }, // Session memory
      });
      
      const result3 = await executeSetLanguageTool(
        { languageCode: 'es' },
        context3
      );
      
      expect(result3.data?.newVoice).toBe('Miguel'); // Session memory wins
    });
  });
});
