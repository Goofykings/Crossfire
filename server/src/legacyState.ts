import { MOVEMENT, PLAYER_MAX_HEALTH } from '../../src/config/constants';
/** One-time storage normalization only; none of these fields are accepted on the v18 wire. */
export function migrateSession<T extends { motion: unknown; health: number }>(session:T):void {
  const raw=session as T & Record<string,unknown>, motion=raw.motion as Record<string,unknown>;
  const ability=raw.powerup as {type?:string}|undefined;
  if(ability?.type==='giant')raw.health=Math.min(PLAYER_MAX_HEALTH,raw.health/1.5);
  else raw.health=Math.min(PLAYER_MAX_HEALTH,raw.health);
  delete raw.powerup;delete raw.burn;
  if(motion&&typeof motion==='object'){
    const retired=['scale','eyeScale','doubleJump','extraJumpUsed','extraJumpCount'];
    if(retired.some(k=>k in motion)){
      for(const key of retired)delete motion[key];
      const v=motion.velocity as {x:number;y:number;z:number};
      if(v&&[v.x,v.y,v.z].every(Number.isFinite)){
      const speed=Math.hypot(v.x,v.z);if(speed>MOVEMENT.slideSpeed){v.x*=MOVEMENT.slideSpeed/speed;v.z*=MOVEMENT.slideSpeed/speed;}
      v.y=Math.min(v.y,MOVEMENT.jumpSpeed);
      }
    }
  }
  const death=raw.death as Record<string,unknown>|undefined;
  if(death){if(death.weapon==='burn')death.weapon=null;death.assists??=[];}
  (raw as Record<string,unknown>).assists??=0;
}
export function migrateResult<T>(value:T):T {
  if(!value)return value;
  const p=value as Record<string,unknown>;
  if(p.mode==='powerups')p.mode='ffa';
  const standings=p.players;
  const all=[...(Array.isArray(standings)?standings:standings&&typeof standings==='object'?Object.values(standings):[]),p.winner,p.mvp];
  for(const s of all)if(s&&typeof s==='object')(s as Record<string,unknown>).assists??=0;
  return value;
}
