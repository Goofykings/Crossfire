/** Stop waiting immediately, and safely handle work an underlying API cannot interrupt. */
export function abortable<T>(work: Promise<T>, signal?: AbortSignal, disposeLate?: (value: T) => void): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    let cancelled = signal.aborted;
    const abort = () => { cancelled = true; reject(signal.reason ?? new DOMException('Cancelled', 'AbortError')); };
    if (cancelled) abort();
    else signal.addEventListener('abort', abort, { once: true });
    work.then((value) => {
      signal.removeEventListener('abort', abort);
      if (cancelled) disposeLate?.(value);
      else resolve(value);
    }, (error) => { signal.removeEventListener('abort', abort); if (!cancelled) reject(error); });
  });
}
