/**
 * Shared WebSocket message helpers used across runtime adapters.
 */

const INPUT_AUDIO_BUFFER_APPEND = 'input_audio_buffer.append';

export function isAudioChunkMessage(message: ArrayBuffer | string): boolean {
  try {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const parsed = JSON.parse(text);
    return parsed.type === INPUT_AUDIO_BUFFER_APPEND;
  } catch {
    return false;
  }
}
