import { NO_INTENT, type MoveIntent } from '../src/player/PlayerController';

/** Short application/input gaps are not a release of a held movement key.
 * Only previously validated continuous intent is reused. Edges never repeat,
 * neutral commands take effect immediately, and a silent peer stops after 350 ms. */
export const MOVEMENT_HOLD_MS = 350;
export class MovementHold {
  private until = -Infinity;
  private held: MoveIntent = { ...NO_INTENT };
  private stopped: MoveIntent = { ...NO_INTENT };
  sample(input: MoveIntent | undefined, now: number): MoveIntent {
    if (input) {
      this.until=now+MOVEMENT_HOLD_MS;
      this.held={...input,jumpPressed:false};
      this.stopped={...NO_INTENT,slide:input.slide,crouch:!!input.crouch,lean:input.lean??0};
      return input;
    }
    return now<this.until?this.held:this.stopped;
  }
  reset(stance: Partial<Pick<MoveIntent,'slide'|'lean'|'crouch'>> = {}): void {
    this.until=-Infinity;this.held={...NO_INTENT,...stance};this.stopped={...this.held};
  }
}
