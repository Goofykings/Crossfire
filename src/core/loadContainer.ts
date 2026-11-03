import { texturesReady } from './assetReadiness';
import { LoadAssetContainerAsync, type AssetContainer, type Scene } from '@babylonjs/core';
import { splitUrl } from './assets';
import { abortable } from './cancellation';

/** Our GLBs embed geometry and use the shared material library, so their transfer can be aborted. */
export async function loadContainer(url: string, scene: Scene, signal?: AbortSignal): Promise<AssetContainer> {
  if (!signal) {
    const container = await LoadAssetContainerAsync(url, scene);
    try { await texturesReady(container.textures); return container; } catch (error) { container.dispose(); throw error; }
  }
  signal.throwIfAborted();
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  const { root, file } = splitUrl(url);
  const container = await abortable(LoadAssetContainerAsync(bytes, scene, { pluginExtension: '.glb', rootUrl: root, name: file }), signal, c => c.dispose());
  try { await texturesReady(container.textures, signal); return container; } catch (error) { container.dispose(); throw error; }
}
