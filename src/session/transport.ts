/**
 * Runtime-agnostic transport contract for WebSocket session adapters.
 */

import type { RuntimeConfig } from '../config/RuntimeConfig';
import type { SessionData } from './types';

export interface ISessionTransport {
  readonly data: SessionData;
  readonly runtimeConfig: RuntimeConfig;
  readonly isOpen: boolean;
  send(data: string): void;
  sendBinary(data: ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export interface ISessionTransportFactory {
  create(ws: unknown, data: SessionData, runtimeConfig: RuntimeConfig): ISessionTransport;
}
