import { POWERUPS, POWERUP_STYLE, type ActivePowerup } from '../../shared/powerups';

export function powerupRemaining(ability: ActivePowerup | null | undefined, now: number): number {
  return ability ? Math.max(0, Math.min(POWERUPS.duration, ability.expiresAt-now)) : 0;
}
/** Updated by the render loop using the multiplayer clock; no local ability timer. */
export class PowerupHud {
  readonly root = document.createElement('div');
  private readonly name = document.createElement('strong');
  private readonly time = document.createElement('span');
  private readonly fill = document.createElement('i');
  constructor(parent: HTMLElement) {
    this.root.className='powerup-hud';this.root.setAttribute('role','status');
    const bar=document.createElement('div');bar.className='powerup-duration';bar.append(this.fill);
    this.root.append(this.name,this.time,bar);parent.prepend(this.root);
  }
  update(ability: ActivePowerup | null | undefined, now: number): void {
    const remaining=powerupRemaining(ability,now);
    this.root.classList.toggle('active',remaining>0);
    this.root.setAttribute('aria-hidden',String(remaining===0));
    if(!ability || !remaining)return;
    const style=POWERUP_STYLE[ability.type];
    this.root.style.setProperty('--ability-color',style.color);
    this.root.dataset.ability=ability.type;
    this.name.textContent=`${style.icon} ${style.name}${ability.type==='shield'?` · ${Math.ceil(ability.shield)} HP`:''}`;
    this.time.textContent=`${(remaining/1000).toFixed(1)}s`;
    this.fill.style.transform=`scaleX(${remaining/POWERUPS.duration})`;
  }
}
