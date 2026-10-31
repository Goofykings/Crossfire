import { BINDABLE_ACTIONS, defaultBindings, isTextInput, type BindableAction, type KeyBindings } from '../config/keybindings';
/**
 * Keyboard/mouse state with pointer-lock handling. Keys use `KeyboardEvent.code` so bindings work on
 * any keyboard layout (WASD stays in the same physical place on AZERTY, etc.).
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'leanLeft'
  | 'leanRight'
  | 'slide'
  | 'jump'
  | 'reload'
  | 'fire'
  | 'aim'
  | 'toggleFps'
  | 'debugCollision'
  | 'leaderboard'
  | 'chat'
  | 'weapon1'
  | 'weapon2'
  | 'weapon3'
  | 'weapon4'
  | 'pause'
  | 'lastWeapon'
  | 'nextWeapon'
  | 'prevWeapon';

export class Input {
  private readonly down = new Set<Action>();
  private readonly heldControls = new Set<string>();
  private bindings: KeyBindings = defaultBindings();
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
      if (e.defaultPrevented || isTextInput(e.target)) return;
      const action = this.actionFor(e.code) ?? (e.code === 'F3' ? 'toggleFps' : e.code === 'F2' ? 'debugCollision' : undefined);
      if (!action) return;
      if (this.enabled || action === 'toggleFps') {
        // keep the browser from scrolling / triggering shortcuts while playing
        if (this.enabled) e.preventDefault();
        if (!e.repeat && !this.down.has(action)) this.pressedEdges.add(action);
        this.heldControls.add(e.code);
        this.down.add(action);
      }
    });
    on(window, 'keyup', (e) => {
      this.releaseControl(e.code);
    });
    on(window, 'blur', () => this.clearState());
    on(canvas, 'mousedown', (e) => {
      const code = `Mouse${e.button}`;
      const action = this.actionFor(code);
      if (!action || !this.enabled) return;
      e.preventDefault();
      if (!this.down.has(action)) this.pressedEdges.add(action);
      this.heldControls.add(code);
      this.down.add(action);
    });
    on(window, 'mouseup', (e) => {
      this.releaseControl(`Mouse${e.button}`);
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
      if (!this.locked) this.clearState();
      for (const l of this.lockListeners) l(this.locked);
    });
  }

  get pointerLocked(): boolean {
    return this.locked;
  }

  setBindings(bindings: KeyBindings): void { this.bindings = bindings; this.clearState(); }
  matches(action: BindableAction, code: string): boolean { return this.bindings[action].includes(code); }
  private actionFor(code: string): BindableAction | undefined { return BINDABLE_ACTIONS.find((a) => this.bindings[a].includes(code)); }
  private releaseControl(code: string): void {
    const action = this.actionFor(code);
    this.heldControls.delete(code);
    if (action && !this.bindings[action].some((key) => this.heldControls.has(key))) this.down.delete(action);
    if (code === 'F3') this.down.delete('toggleFps');
    if (code === 'F2') this.down.delete('debugCollision');
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
    this.heldControls.clear();
    this.pressedEdges.clear();
    this.mouseDX = this.mouseDY = 0;
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}
