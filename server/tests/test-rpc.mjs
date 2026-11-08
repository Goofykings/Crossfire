/** Test-only JSON transport to the real Worker -> Durable Object RPC bridge.
 * Each call owns/disposes its RPC result inside workerd. No native Node proxies
 * survive a call or a runtime restart. This is never a production endpoint. */
export function testRoom(mf, room = 'public-main') {
  let disposed = false;
  return new Proxy({}, {
    get(_target, method) {
      if (method === Symbol.dispose) return () => { disposed = true; };
      if (typeof method !== 'string' || method === 'then') return undefined;
      return async (...args) => {
        if (disposed) throw new Error(`Test RPC ${room}.${method}: handle disposed`);
        const response = await mf.dispatchFetch('http://test.invalid/__crossfire_test_rpc', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, method, args }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) {
          const error = new Error(`Test RPC ${room}.${method}: ${result.error?.message ?? response.status}`);
          error.name = result.error?.name ?? 'Error';
          if (result.error?.stack) error.cause = result.error.stack;
          throw error;
        }
        return result.value;
      };
    },
  });
}
