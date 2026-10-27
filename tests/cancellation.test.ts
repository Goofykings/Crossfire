import { describe, expect, it, vi } from 'vitest';
import { abortable } from '../src/core/cancellation';

describe('cancellable asset work', () => {
  it('rejects immediately on cancellation and disposes a late result exactly once', async () => {
    const controller = new AbortController();
    let finish!: (value: string) => void;
    const dispose = vi.fn();
    const work = abortable(new Promise<string>((resolve) => { finish = resolve; }), controller.signal, dispose);
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    finish('late container');
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledExactlyOnceWith('late container');
  });
  it('does not dispose successful resources on a later cancellation', async () => {
    const controller = new AbortController(); const dispose = vi.fn();
    expect(await abortable(Promise.resolve('ready'), controller.signal, dispose)).toBe('ready');
    controller.abort();
    expect(dispose).not.toHaveBeenCalled();
  });
  it('handles already cancelled operations and consumes late errors', async () => {
    const controller = new AbortController(); controller.abort();
    let fail!: (reason: Error) => void;
    const work = abortable(new Promise((_, reject) => { fail = reject; }), controller.signal);
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    fail(new Error('late parser error'));
    await Promise.resolve();
  });
});
