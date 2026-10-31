import { multiplayerEndpoint } from './endpoint';

export const DEFAULT_CLOUDFLARE_URL = 'wss://crossfire-multiplayer.maxwellmaahs.workers.dev/ws';
export type MultiplayerProvider = 'cloudflare' | 'custom';
export type MultiplayerBackend =
  | { ok: true; provider: MultiplayerProvider; url: string }
  | { ok: false; error: string };

/** Vite variables are public build-time configuration, never credentials. */
export function resolveMultiplayerBackend(env: {
  VITE_MULTIPLAYER_PROVIDER?: string;
  VITE_MULTIPLAYER_URL?: string;
  VITE_CUSTOM_MULTIPLAYER_URL?: string;
}): MultiplayerBackend {
  const provider = (env.VITE_MULTIPLAYER_PROVIDER ?? '').trim() || 'cloudflare';
  if (provider !== 'cloudflare' && provider !== 'custom') {
    return { ok: false, error: 'Invalid VITE_MULTIPLAYER_PROVIDER. Choose cloudflare or custom.' };
  }
  const configured = provider === 'custom' ? env.VITE_CUSTOM_MULTIPLAYER_URL?.trim() : env.VITE_MULTIPLAYER_URL?.trim();
  if (provider === 'custom' && !configured) {
    return { ok: false, error: 'Custom multiplayer requires VITE_CUSTOM_MULTIPLAYER_URL.' };
  }
  try {
    return { ok: true, provider, url: multiplayerEndpoint(configured || DEFAULT_CLOUDFLARE_URL).href };
  } catch (error) {
    const setting = provider === 'custom' ? 'VITE_CUSTOM_MULTIPLAYER_URL' : 'VITE_MULTIPLAYER_URL';
    return { ok: false, error: `Invalid ${setting}: ${(error as Error).message}` };
  }
}
