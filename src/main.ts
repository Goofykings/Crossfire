import '@babylonjs/loaders/glTF';
import './styles.css';
import { Game, type GameOptions } from './game/Game';

function parseOptions(): GameOptions {
  const q = new URLSearchParams(location.search);
  const cam = q.get('cam');
  const quality = q.get('quality');
  const shadows = q.get('shadows');
  const scale = q.get('scale');
  return {
    autoplay: q.has('autoplay'),
    cam: cam ? cam.split(',').map(Number) : null,
    hideHud: q.has('nohud'),
    quality: quality === 'low' || quality === 'medium' || quality === 'high' ? quality : undefined,
    shadows: shadows === 'off' || shadows === 'low' || shadows === 'medium' || shadows === 'high' ? shadows : undefined,
    scale: scale ? Number(scale) : undefined,
  };
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

if (!hasWebGL2()) {
  uiRoot.innerHTML =
    '<div class="screen visible" style="align-items:center;justify-content:center"><div class="card"><h2>WebGL 2 required</h2><p>Crossfire needs a browser with WebGL 2 (current Chrome, Edge, Firefox or Safari) and hardware acceleration enabled.</p></div></div>';
} else {
  const game = new Game(canvas, uiRoot, parseOptions());
  (window as unknown as { __crossfire: unknown }).__crossfire = game.debugApi();
  game.init().catch((err) => {
    console.error(err);
    game.ui.showError(`Failed to start: ${(err as Error).message}`);
  });
}
