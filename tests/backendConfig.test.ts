import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOUDFLARE_URL, resolveMultiplayerBackend } from '../src/network/backendConfig';

describe('multiplayer provider configuration', () => {
  it('defaults to the current public Worker and respects the existing local override', () => {
    expect(resolveMultiplayerBackend({})).toEqual({ ok: true, provider: 'cloudflare', url: DEFAULT_CLOUDFLARE_URL });
    expect(resolveMultiplayerBackend({ VITE_MULTIPLAYER_PROVIDER: '', VITE_MULTIPLAYER_URL: 'ws://127.0.0.1:8787/ws' }))
      .toEqual({ ok: true, provider: 'cloudflare', url: 'ws://127.0.0.1:8787/ws' });
  });
  it('requires an explicit valid custom URL even when a Cloudflare URL exists', () => {
    for (const custom of [undefined, '', 'ws://public.example/ws', 'wss://u:p@example.com/ws', 'not-a-url']) {
      const config = resolveMultiplayerBackend({ VITE_MULTIPLAYER_PROVIDER: 'custom',
        VITE_MULTIPLAYER_URL: DEFAULT_CLOUDFLARE_URL, VITE_CUSTOM_MULTIPLAYER_URL: custom });
      expect(config.ok).toBe(false);
      if (!config.ok) expect(config.error).toContain('VITE_CUSTOM_MULTIPLAYER_URL');
    }
    expect(resolveMultiplayerBackend({ VITE_MULTIPLAYER_PROVIDER: 'custom', VITE_CUSTOM_MULTIPLAYER_URL: 'wss://game.example/ws' }))
      .toEqual({ ok: true, provider: 'custom', url: 'wss://game.example/ws' });
    expect(resolveMultiplayerBackend({ VITE_MULTIPLAYER_PROVIDER: 'custom', VITE_CUSTOM_MULTIPLAYER_URL: 'ws://localhost:8788/ws' }).ok).toBe(true);
  });
  it('rejects invalid providers and configured Cloudflare URLs instead of silently substituting another backend', () => {
    expect(resolveMultiplayerBackend({ VITE_MULTIPLAYER_PROVIDER: 'typo' }).ok).toBe(false);
    expect(resolveMultiplayerBackend({ VITE_MULTIPLAYER_URL: 'http://example.com/ws' }).ok).toBe(false);
  });
});
