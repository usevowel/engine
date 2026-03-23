/**
 * BunWebSocketAdapter
 * 
 * Adapts Bun's ServerWebSocket to ISessionTransport interface.
 * 
 * @module adapters
 */

import type { ServerWebSocket } from 'bun';
import type { RuntimeConfig } from '../../../../src/config/RuntimeConfig';
import type { SessionData } from '../../../../src/session/types';
import type { ISessionTransport } from '../../../../src/session/transport';
import type { NodeRuntimeConfig } from '../config/NodeConfigLoader';

/**
 * Adapter that wraps Bun's ServerWebSocket to implement ISessionTransport
 */
export class BunWebSocketAdapter implements ISessionTransport {
  constructor(private ws: ServerWebSocket<SessionData>) {}

  get data(): SessionData {
    return this.ws.data;
  }

  get runtimeConfig(): RuntimeConfig {
    return this.ws.data.runtimeConfig as NodeRuntimeConfig;
  }

  get isOpen(): boolean {
    // Bun WebSocket doesn't have a direct isOpen property, 
    // but we can infer from the readyState if available
    return true; // Assume open if we have the instance
  }

  send(data: string | ArrayBuffer | Uint8Array): void {
    this.ws.send(data);
  }

  sendBinary(data: ArrayBuffer | Uint8Array): void {
    this.ws.send(data);
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }
}
