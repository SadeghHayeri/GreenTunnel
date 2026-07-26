/// <reference types="vite/client" />

import type { GreenTunnelApi } from '../../shared/ipc.js';

declare global {
  interface Window {
    /** Injected by the preload script. */
    readonly greenTunnel: GreenTunnelApi;
  }
}

export {};
