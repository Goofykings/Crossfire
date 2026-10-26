/** Shared endpoint rules for the transport and read-only home presence poll. */
export function multiplayerEndpoint(value: string): URL {
  if (!value) throw new Error('Set VITE_MULTIPLAYER_URL to the local or public WebSocket endpoint.');
  const url = new URL(value);
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Multiplayer requires wss://, or ws:// on localhost for development.');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('Use a WebSocket endpoint without credentials or query parameters.');
  return url;
}

export function presenceEndpoint(value: string): URL {
  const url = multiplayerEndpoint(value);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/presence';
  return url;
}
