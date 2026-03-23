/**
 * Audio Utilities
 * 
 * Format conversion and audio processing utilities.
 */

/**
 * Convert Float32 PCM to Int16 PCM
 */
export function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    // Clamp to [-1, 1] range and convert to int16
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = Math.floor(sample * 0x7FFF);
  }
  return int16Array;
}

/**
 * Convert Int16 PCM to base64 string for WebSocket transmission
 */
export function int16ToBase64(int16Array: Int16Array): string {
  const uint8Array = new Uint8Array(int16Array.buffer);
  return Buffer.from(uint8Array).toString('base64');
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const buffer = Buffer.from(base64, 'base64');
  return new Uint8Array(buffer);
}

/**
 * Chunk PCM audio for streaming
 * 
 * @param pcm Float32 PCM data
 * @param chunkMs Chunk size in milliseconds
 * @param sampleRate Sample rate in Hz
 * @returns Array of Float32 PCM chunks
 */
export function chunkPcm(
  pcm: Float32Array,
  chunkMs: number,
  sampleRate: number
): Float32Array[] {
  const chunkSize = Math.floor((sampleRate * chunkMs) / 1000);
  const chunks: Float32Array[] = [];
  
  for (let i = 0; i < pcm.length; i += chunkSize) {
    chunks.push(pcm.slice(i, i + chunkSize));
  }
  
  return chunks;
}

/**
 * Convert Float32 PCM to base64 PCM16 for WebSocket
 * 
 * @param float32Array Float32 PCM data
 * @returns Base64 encoded PCM16
 */
export function float32ToBase64Pcm16(float32Array: Float32Array): string {
  const int16Array = float32ToInt16(float32Array);
  return int16ToBase64(int16Array);
}

/**
 * Concatenate multiple Uint8Arrays
 */
export function concatenateAudio(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  
  return result;
}

/**
 * Create a WAV file header for PCM16 audio
 * (Useful for saving/debugging, not used in WebSocket streaming)
 */
export function createWavHeader(
  dataLength: number,
  sampleRate: number = 24000,
  numChannels: number = 1,
  bitsPerSample: number = 16
): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  
  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  
  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // byte rate
  view.setUint16(32, numChannels * (bitsPerSample / 8), true); // block align
  view.setUint16(34, bitsPerSample, true);
  
  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);
  
  return new Uint8Array(header);
}

/**
 * Create a complete WAV file from PCM16 audio data
 * 
 * @param pcmData PCM16 audio data
 * @param sampleRate Sample rate in Hz (default: 24000)
 * @param numChannels Number of channels (default: 1)
 * @param bitsPerSample Bits per sample (default: 16)
 * @returns Complete WAV file as Uint8Array
 */
export function createWavFile(
  pcmData: Uint8Array,
  sampleRate: number = 24000,
  numChannels: number = 1,
  bitsPerSample: number = 16
): Uint8Array {
  const header = createWavHeader(pcmData.length, sampleRate, numChannels, bitsPerSample);
  const wavFile = new Uint8Array(header.length + pcmData.length);
  wavFile.set(header, 0);
  wavFile.set(pcmData, header.length);
  return wavFile;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

