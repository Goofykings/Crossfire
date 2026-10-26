/**
 * Keyboard/mouse state with pointer-lock handling. Keys use `KeyboardEvent.code` so bindings work on
 * any keyboard layout (WASD stays in the same physical place on AZERTY, etc.).
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'jump'
  | 'crouch'
  | 'reload'
  | 'fire'
  | 'aim'
  | 'toggleFps'
  | 'debugCollision'
  | 'map'
  | 'weapon1'
  | 'weapon2'
  | 'weapon3'
  | 'lastWeapon'
  | 'nextWeapon'
  | 'prevWeapon';

const KEY_BINDINGS: Record<string, Action> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Space: 'jump',
  ControlLeft: 'crouch',
  ControlRight: 'crouch',
  KeyC: 'crouch',
  KeyR: 'reload',
  Digit1: 'weapon1',
  Digit2: 'weapon2',
  Digit3: 'weapon3',
  Numpad1: 'weapon1',
  Numpad2: 'weapon2',
  Numpad3: 'weapon3',
  KeyQ: 'lastWeapon',
  // held: shows the tactical map (keydown is prevented while playing, so focus never moves)
  Tab: 'map',
  F3: 'toggleFps',
  F2: 'debugCollision',
};

const MOUSE_BINDINGS: Record<number, Action> = { 0: 'fire', 2: 'aim' };

export class Input {
  private readonly down = new Set<Action>();
  private readonly pressedEdges = new Set<Action>();
  private mouseDX = 0;
  private mouseDY = 0;
  private locked = false;
  /** When false (menus open) game actions are ignored. */
  enabled = false;
  readonly lockListeners = new Set<(locked: boolean) => void>();
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const on = <K extends keyof DocumentEventMap>(
      target: Document | HTMLElement | Window,
      type: K,
      fn: (e: DocumentEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    on(window, 'keydown', (e) => {
      const action = KEY_BINDINGS[e.code];
      if (!action) return;
      if (this.enabled || action === 'toggleFps') {
        // keep the browser from scrolling / triggering shortcuts while playing
        if (this.enabled) e.preventDefault();
        if (!e.repeat && !this.down.has(action)) this.pressedEdges.add(action);
        this.down.add(action);
      }
    });
    on(window, 'keyup', (e) => {
      const action = KEY_BINDINGS[e.code];
      if (action) this.down.delete(action);
    });
    on(window, 'blur', () => this.down.clear());
    on(canvas, 'mousedown', (e) => {
      const action = MOUSE_BINDINGS[e.button];
      if (!action || !this.enabled) return;
      e.preventDefault();
      if (!this.down.has(action)) this.pressedEdges.add(action);
      this.down.add(action);
    });
    on(window, 'mouseup', (e) => {
      const action = MOUSE_BINDINGS[e.button];
      if (action) this.down.delete(action);
    });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    // mouse wheel cycles weapons (one step per notch, however large the browser's delta)
    on(
      canvas,
      'wheel',
      (e) => {
        if (!this.enabled || e.deltaY === 0) return;
        e.preventDefault();
        this.pressedEdges.add(e.deltaY > 0 ? 'nextWeapon' : 'prevWeapon');
      },
      { passive: false },
    );
    on(document, 'mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      // some browsers report a huge spurious delta right after locking
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.down.clear();
      for (const l of this.lockListeners) l(this.locked);
    });
  }

  get pointerLocked(): boolean {
    return this.locked;
  }

  async requestLock(): Promise<void> {
    if (this.locked) return;
    try {
      // unadjustedMovement gives raw mouse input where supported (Chrome/Edge)
      const req = this.canvas.requestPointerLock as unknown as (o?: object) => Promise<void> | void;
      await req.call(this.canvas, { unadjustedMovement: true });
    } catch {
      try {
        await (this.canvas.requestPointerLock() as unknown as Promise<void>);
      } catch {
        /* user dismissed or browser refused; menus remain usable */
      }
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(a: Action): boolean {
    return this.enabled && this.down.has(a);
  }

  /** True once per physical press; cleared by `endFrame`. */
  wasPressed(a: Action): boolean {
    return this.pressedEdges.has(a);
  }

  /** Consume an edge so later readers in the same frame don't see it. */
  consume(a: Action): boolean {
    const had = this.pressedEdges.has(a);
    this.pressedEdges.delete(a);
    return had;
  }

  takeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  /** Inject a held action (automation/tests). */
  simulate(a: Action, held: boolean): void {
    if (held) {
      if (!this.down.has(a)) this.pressedEdges.add(a);
      this.down.add(a);
    } else {
      this.down.delete(a);
    }
  }

  injectMouse(dx: number, dy: number): void {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  endFrame(): void {
    this.pressedEdges.clear();
  }

  clearState(): void {
    this.down.clear();
    this.pressedEdges.clear();
    this.mouseDX = this.mouseDY = 0;
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}
