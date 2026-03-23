/**
 * Speech-to-Text Transcription Service
 * 
 * Integrates with Groq Whisper API for audio transcription.
 */

import { config } from '../config/env';

import { getEventSystem, EventCategory } from '../events';
export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

/**
 * Create a WAV file header for PCM16 audio data
 * 
 * @param pcmData PCM16 audio data
 * @param sampleRate Sample rate in Hz (default: 24000)
 * @param numChannels Number of channels (default: 1 for mono)
 * @returns WAV file as Uint8Array
 */
function createWavFile(pcmData: Uint8Array, sampleRate: number = 24000, numChannels: number = 1): Uint8Array {
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const fileSize = 44 + dataSize;
  
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);
  
  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileSize - 8, true); // File size - 8
  writeString(view, 8, 'WAVE');
  
  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample
  
  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true); // Subchunk2Size
  
  // Combine header and audio data
  const wavFile = new Uint8Array(fileSize);
  wavFile.set(new Uint8Array(wavHeader), 0);
  wavFile.set(pcmData, 44);
  
  return wavFile;
}

/**
 * Write a string to a DataView
 */
function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Transcribe audio using Groq Whisper API
 * 
 * @param audioBuffer PCM16 audio data
 * @param language Optional language code (e.g., 'en')
 * @param apiKey Groq API key (optional, falls back to global config for Bun)
 * @param whisperModel Whisper model name (optional, defaults to 'whisper-large-v3')
 * @returns Transcription result
 */
export async function transcribeAudio(
  audioBuffer: Uint8Array,
  language?: string,
  apiKey?: string,
  whisperModel?: string
): Promise<TranscriptionResult> {
  try {
    // Get API key and model - use provided values or fall back to global config (Bun only)
    let groqApiKey = apiKey;
    let groqWhisperModel = whisperModel || 'whisper-large-v3';
    
    if (!groqApiKey) {
      // Fallback to global config for Bun environments
      try {
        const { config: globalConfig } = require('../config/env');
        groqApiKey = globalConfig?.groq?.apiKey;
        if (!groqWhisperModel && globalConfig?.groq?.whisperModel) {
          groqWhisperModel = globalConfig.groq.whisperModel;
        }
      } catch {
        // Workers environment - API key must be provided
      }
    }
    
    if (!groqApiKey) {
      throw new Error('Groq API key not provided and not found in global config');
    }
    
    // Convert PCM16 to proper WAV file with header
    getEventSystem().info(EventCategory.AUDIO, `📝 Creating WAV file from ${audioBuffer.length} bytes of PCM16 data (${(audioBuffer.length / 2 / 24000).toFixed(2)}s at 24kHz)`);
    const wavFile = createWavFile(audioBuffer, 24000, 1);
    getEventSystem().info(EventCategory.LLM, `📝 WAV file created: ${wavFile.length} bytes total`);
    
    // Create form data with audio file
    const formData = new FormData();
    
    // Convert to blob (Groq expects a file)
    const blob = new Blob([wavFile], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', groqWhisperModel);
    
    if (language) {
      formData.append('language', language);
    }
    
    // Call Groq Whisper API
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
      },
      body: formData,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq Whisper API error: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    
    getEventSystem().info(EventCategory.STT, `✅ Transcription: "${result.text}"`);
    
    // Log language information if available
    if (result.language) {
      getEventSystem().info(EventCategory.STT, `🌍 [STT] Language detected by Groq Whisper: ${result.language}`, {
        operation: 'stt_language_detection',
        languageCode: result.language,
        transcriptPreview: result.text?.substring(0, 50) || '',
      });
    }
    
    return {
      text: result.text || '',
      language: result.language,
      duration: result.duration,
    };
  } catch (error) {
    getEventSystem().error(EventCategory.STT, '❌ Transcription error:', error);
    throw new Error(
      `Failed to transcribe audio: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Check if audio buffer is valid for transcription
 * 
 * @param audioBuffer Audio data
 * @returns True if valid, false otherwise
 */
export function isValidAudioBuffer(audioBuffer: Uint8Array | null): boolean {
  if (!audioBuffer || audioBuffer.length === 0) {
    return false;
  }
  
  // Minimum audio length (e.g., 100ms at 24kHz PCM16 = 4800 bytes)
  const minBytes = 4800;
  return audioBuffer.length >= minBytes;
}

