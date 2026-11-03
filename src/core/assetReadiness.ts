import type { AbstractMesh, BaseTexture } from '@babylonjs/core';

/** Explicitly includes disabled weapon rigs and off-scene character containers. */
export function texturesReady(textures: readonly BaseTexture[], signal?: AbortSignal, timeoutMs = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const end = Date.now() + timeoutMs;
    const finish = (error?: unknown) => { clearInterval(timer); signal?.removeEventListener('abort', cancel); error !== undefined ? reject(error) : resolve(); };
    const cancel = () => finish(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
    const check = () => {
      if (signal?.aborted) { cancel(); return; }
      const failed = textures.find(t => t.loadingError);
      if (failed) { finish(new Error(`Required texture failed to load: ${failed.name || "unnamed texture"}`)); return; }
      const pending = textures.find(t => !t.isReady());
      if (!pending) { finish(); return; }
      if (Date.now() >= end) finish(new Error(`Required texture timed out: ${pending.name || "unnamed texture"}`));
    };
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setInterval(check, 25); check();
  });
}
export async function meshesReady(meshes: readonly AbstractMesh[], signal?: AbortSignal): Promise<void> {
  const textures = [...new Set(meshes.flatMap(m => m.material?.getActiveTextures() ?? []))];
  await texturesReady(textures, signal);
  const variants = new Set<string>();
  const pending: Promise<void>[] = [];
  for (const mesh of meshes) {
    if (!mesh.material || !mesh.getTotalVertices()) continue;
    const key = `${mesh.material.uniqueId}:${!!mesh.skeleton}:${mesh.hasVertexAlpha}:${mesh.isVerticesDataPresent('color')}:${mesh.isVerticesDataPresent('uv')}`;
    if (variants.has(key)) continue;
    variants.add(key);
    pending.push(mesh.material.forceCompilationAsync(mesh));
  }
  await readinessDeadline(Promise.all(pending), signal, 'Required shaders failed to become ready');
}
export function readinessDeadline<T>(work: Promise<T>, signal: AbortSignal | undefined, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => finish(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error(message)), 60000);
    function finish(error?: unknown, value?: T) { clearTimeout(timer); signal?.removeEventListener('abort', cancel); error !== undefined ? reject(error) : resolve(value!); }
    signal?.addEventListener('abort', cancel, { once:true });
    if (signal?.aborted) { cancel(); return; }
    work.then(value => finish(undefined, value), error => finish(error ?? new Error(message)));
  });
}
