// Local-test entry only. Production Wrangler always bundles src/index.ts.
// Seed one real client's motion below the world to exercise the existing fall
// boundary without adding a cheat/kill command to the public protocol.
import { PublicRoom as ProductionRoom } from '../dist/index.js';
export { default } from '../dist/index.js';
export class PublicRoom extends ProductionRoom {
  async qualifyMatchGemsForTest(ids){
    const now=Date.now();this.ledger.rewardStartedAt=now-600000;
    for(const id of ids){const e=this.players.get(id);if(!e?.session.profileId||!e.session.participation||e.session.participation.abandoned)throw Error('Requires real participating profile');e.session.participation.firstSpawn=now-120000;}
    await this.persist();
  }
  async qualifyRoomRoundForTest(id){const e=this.players.get(id);if(!e?.session.participation||e.session.participation.abandoned)throw Error('Requires unabandoned spawned player');e.session.participation.firstSpawn=Date.now()-599000;await this.persist();}
  async expireRoomTicketForTest(ticket){const record=await this.ctx.storage.get('room-ticket:'+ticket);if(!record)throw Error('Requires issued ticket');record.until=0;await this.ctx.storage.put('room-ticket:'+ticket,record);}
  async ageRoomForTest(ms){if(!this.config)throw Error('Requires custom room');this.config.createdAt=Date.now()-ms;await this.persist();await this.scheduleCleanup();return this.roomStatus();}
  async ageEmptyRoomForTest(ms){if(!this.config||this.connected().length)throw Error('Requires empty room');this.config.emptySince=Date.now()-ms;await this.persist();await this.scheduleCleanup();}
  async ageActivityForTest(id,ms){const e=this.players.get(id);if(!e)throw Error('Requires joined session');e.session.activityAt=Date.now()-ms;await this.persist();await this.scheduleCleanup();return this.snapshot();}
  async loseRewardAckForTest(){this.loseRewardAck=true;}
  async applyRoomRewards(id,events){const result=await super.applyRoomRewards(id,events);if(this.loseRewardAck){this.loseRewardAck=false;throw Error('Test: acknowledgment lost after durable commit');}return result;}
  async flushRoomRewardsForTest(){await this.persist();await this.flushRewards();return this.ctx.storage.get('room-reward-ack');}
  async replayRoomRewardsForTest(){const state=await this.ctx.storage.get('room-rewards');return state?.events.length?this.authority.applyRoomRewards(this.roomId,state.events):null;}
  async prepareRoomChallengesForTest(credential){
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(credential)),id=[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
    const p=await this.careers.load(id);if(!p)throw Error('Requires real profile');
    p.daily.challenges=[{id:'daily:sniper:5',progress:4,completedAt:null},{id:'daily:headshots:3',progress:0,completedAt:null},{id:'daily:points:1000',progress:0,completedAt:null}];p.weekly.challenges=[{id:'weekly:sniper:40',progress:39,completedAt:null},{id:'weekly:headshots:20',progress:0,completedAt:null},{id:'weekly:points:10000',progress:0,completedAt:null}];p.revision++;this.careers.mark(id);await this.persist();return p.gems;
  }

  async legacyStatisticsSchemaForTest(credential) {
    await this.persist();await this.statistics.project();
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(credential));
    const id=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
    const p=await this.ctx.storage.get('statistics:'+id);if(!p)throw new Error('Requires persisted real profile');
    delete p.totals.assists;await this.ctx.storage.put('statistics:'+id,p);
  }
  /** Test-only inventory fixture (forces which crate rarities remain). Never in production code. */
  async inventoryForTest(credential,owned) {
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(credential));
    const id=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
    const current=await this.inventory.get(id);await this.ctx.storage.put('inventory:'+id,{revision:current.revision+1,owned:[...new Set([...current.owned.filter(id=>id.startsWith('default-')),...owned])],equipped:current.equipped});
  }
  async legacyWalletForStatisticsTest(credential,gems) {
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(credential));
    const id=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
    const p=await this.careers.load(id);if(!p)throw new Error('Requires a real issued wallet');
    p.gems=gems;p.revision++;this.careers.mark(id);await this.persist();
  }
  async statisticsFixtureForTest(credential,name,events) {
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(credential));
    const id=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(!await this.careers.load(id))throw new Error('Requires a real server-issued profile');
    await this.statistics.load(id,name);
    for(const event of events)this.statistics.event(id,event);
    await this.persist();
  }
  async statisticsProjectionRecoveryForTest(credential, remove = true) {
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(credential));
    const identity=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
    await this.statistics.project();
    const record=await this.ctx.storage.get('statistics:'+identity);
    if(!record)throw new Error('Requires persisted statistics');
    // Emulate interruption after the authoritative KV save, before projection.
    if(remove)this.ctx.storage.sql.exec('DELETE FROM statistics_rankings WHERE id=?',record.id);
    await this.ctx.storage.put(`statistics-index:${identity}:${String(record.revision).padStart(16,'0')}`,record);
  }
  async seedCareerForTest(id, mode='kills', eligibility='eligible') {
    const e=this.players.get(id),p=e?.session.profileId?this.careers.profiles.get(e.session.profileId):null;
    if(!e||!p)throw new Error('Requires a real credential-authorized joined session');
    const ids=mode==='kills'?[['daily:sniper:5','daily:headshots:3','daily:points:1000'],['weekly:sniper:40','weekly:headshots:20','weekly:points:10000']]
      :[['daily:wins:1','daily:mvp:1','daily:matches:2'],['weekly:wins:5','weekly:mvp:3','weekly:matches:15']];
    for(const [index,category] of ['daily','weekly'].entries())p[category].challenges=ids[index].map(id=>({id,progress:Number(id.split(':')[2])-(id.includes(':points:')?50:1),completedAt:null}));
    if(mode==='round')e.session.participation.firstSpawn=eligibility==='late'?Date.now():Date.now()-600000+1000;
    p.revision++;this.careers.mark(e.session.profileId);await this.persist();return JSON.parse(JSON.stringify(p));
  }
  async ageCareerForTest(id) {
    const e=this.players.get(id),p=this.careers.profiles.get(e.session.profileId);
    for(const [category,days] of [['daily',1],['weekly',7]]){const offset=days*86400000;p[category].start-=offset;p[category].endsAt-=offset;
      for(const card of p[category].challenges)if(card.completedAt!==null)card.completedAt-=offset;}
    await this.ctx.storage.put('career:'+e.session.profileId,p);
  }
  async environmentForTest(){return {definition:this.activeMap.environment,states:this.environment.capture(),active:this.environment.active};}
  async saveEnvironmentForTest(stale=false){
    await this.persist();
    if(stale){const saved=await this.ctx.storage.get('environment');saved.mapVersion='pre-polish';await this.ctx.storage.put('environment',saved);}
  }
  async environmentTargetForTest(id,oblique=false){
    const def=this.activeMap.environment,b=def.bodies.find(b=>b.id===id),light=def.lights?.find(b=>b.id===id),sign=def.signs.find(b=>b.id===id)??light;
    if(!b&&!sign)throw new Error('Unknown authored prop');
    const s=this.environment.capture().find(s=>s.id===id),p=s.position;
    const offset=sign?(light?.36:.29):0;
    const target=[p.x+Math.sin(s.angle)*offset*Math.cos(s.yaw),p.y-Math.cos(s.angle)*offset,p.z-Math.sin(s.angle)*offset*Math.sin(s.yaw)],w=this.activeMap.world;
    for(const approachRadius of [2.2,1.15])for(let i=0;i<16;i++){
      const angle=i*Math.PI/8,x=p.x+Math.sin(angle)*approachRadius,z=p.z+Math.cos(angle)*approachRadius,y=w.groundHeight(x,z,.34,3);
      if(!Number.isFinite(y)||w.overlapsCylinder(x,z,.34,y+.42,y+1.8))continue;
      const delta=[target[0]-x,target[1]-y-1.64,target[2]-z],distance=Math.hypot(...delta),d=delta.map(v=>v/distance);
      if(w.raycast(x,y+1.64,z,...d,distance-.05))continue;
      // Shoot signs across their actual board normal, not a thin edge.
      if(sign&&!light&&Math.abs(d[0]*Math.cos(sign.yaw)-d[2]*Math.sin(sign.yaw))<.5)continue;
      if(oblique&&sign&&!light&&Math.abs(d[0]*Math.cos(sign.yaw)-d[2]*Math.sin(sign.yaw))>.85)continue;
      return {position:[x,y,z],target,yaw:Math.atan2(-d[0],-d[2]),pitch:Math.asin(d[1])};
    }
    throw new Error('No clear real-player firing position for '+id);
  }
  async seedRetiredStateForTest(id) {
    await this.persist();
    const sessions=await this.ctx.storage.get('sessions'),s=sessions.find(s=>s.id===id);
    if(!s)throw new Error('Requires a real session');
    s.powerup={type:'giant',expiresAt:Date.now()+15000,shield:0};s.burn={ownerId:id,expiresAt:Date.now()+5000,updatedAt:Date.now()};
    s.health=120;s.motion.scale=s.motion.eyeScale=1.5;s.motion.doubleJump=true;s.motion.extraJumpUsed=false;s.motion.extraJumpCount=0;
    const ledger=await this.ctx.storage.get('round-ledger');ledger.mode='powerups';
    await this.ctx.storage.put({sessions,'round-ledger':ledger,powerups:{retired:true}});
  }
  async retiredStorageForTest(){return {pickups:await this.ctx.storage.get('powerups'),sessions:await this.ctx.storage.get('sessions')};}
  async snapshotForTest() { return this.snapshot(); }
  async setRemainingForTest(ms) {
    if (!Number.isFinite(ms) || ms < 1 || ms > 600000) throw new Error('Invalid test deadline');
    const endsAt = Date.now() + ms;
    this.schedule.epoch = endsAt - (this.round.id + 1) * 600000;
    this.round.endsAt = this.ledger.endsAt = endsAt;
    await this.ctx.storage.put('map-schedule', this.schedule);
    this.broadcast();
    return endsAt;
  }
  async alarmForTest() { await this.alarm(); return this.snapshot(); }
  async replayDeadTransitionForTest(victimId, killerId) {
    const victim = this.players.get(victimId), killer = this.players.get(killerId);
    if (!victim || victim.session.alive || !killer) throw new Error('Requires an already dead real victim');
    this.eliminate(victim, killer, true);
    return this.snapshot();
  }
  async healthForTest(id) {
    const e = this.players.get(id);
    if (!e) throw new Error('Requires a real joined session');
    return { health: e.session.health, regenAt: e.session.regenAt, now: Date.now() };
  }
  async dropSocketForTest(id) {
    const e = this.players.get(id);
    if (!e?.socket) throw new Error('Requires a connected real session');
    e.socket.close(1012, 'test_transport_drop');
  }
  async directionalArenaForTest() {
    const w = this.activeMap.world;
    // Every participant stands on level ground at the victim's height (not over a stairwell,
    // terrace edge or step), so placed players neither fall nor aim from the wrong eye height.
    const clear = ([x, y, z]) => Number.isFinite(y) && Math.abs(w.groundHeight(x, z, .34, y + .3) - y) < .02
      && !w.overlapsCylinder(x, z, .34, y + .42, y + 1.8);
    for (let x = -12; x <= 12; x += 2) for (let z = -12; z <= 12; z += 2) {
      const y = w.groundHeight(x, z, .24, 3), center = [x, y, z];
      const sources = { front: [x, y, z - 2.2], left: [x - 2.2, y, z], right: [x + 2.2, y, z], behind: [x, y, z + 2.2] };
      const observer = [x + 1.8, y, z + 1.8];
      if (![center, observer, ...Object.values(sources)].every(clear)) continue;
      // The tests aim from the eye at the victim's chest and head: check those exact rays, so a
      // low well ring, bench or stall counter between them cannot absorb a shot.
      if ([observer, ...Object.values(sources)].some((p) => [.9, 1.4].some((h) => {
        const delta = [x - p[0], y + h - p[1] - 1.64, z - p[2]], length = Math.hypot(...delta);
        return w.raycast(p[0], p[1] + 1.64, p[2], ...delta.map((v) => v / length), length - .3);
      }))) continue;
      return { center, sources, observer };
    }
    throw new Error('No clear four-direction sightline in actual map geometry');
  }
  async meleeArenaForTest() {
    const w=this.activeMap.world;
    for(let x=-15;x<=15;x+=1)for(let z=-15;z<=15;z+=1){
      const y=w.groundHeight(x,z,.34,3),a=[x,y,z],b=[x,w.groundHeight(x,z-1.4,.34,3),z-1.4];
      if(![a,b].every(([px,py,pz])=>Number.isFinite(py)&&Math.abs(py-y)<.02&&!w.overlapsCylinder(px,pz,.34,py+.42,py+1.8)))continue;
      if(!w.raycast(x,y+1.3,z,0,0,-1,1.4))return {attacker:a,victim:b};
    }
    throw Error('No actual-map melee test arena');
  }
  async meleeWallForTest() {
    const world=this.activeMap.world;
    for(const c of [...world.colliders.values()].filter(c=>c.solid&&c.shootable&&c.hy>.55)){
      const alongX=c.hx<c.hz,nx=alongX?c.cos:c.sin,nz=alongX?-c.sin:c.cos,gap=(alongX?c.hx:c.hz)+.42;
      if(gap*2>1.8)continue;
      const tx=alongX?c.sin:c.cos,tz=alongX?c.cos:-c.sin,length=alongX?c.hz:c.hx;
      for(const offset of [0,.25,-.25,.6,-.6])for(const limit of [.4,1.2,3]){
        const pair=[-1,1].map(s=>{const x=c.cx+tx*length*offset+nx*gap*s,z=c.cz+tz*length*offset+nz*gap*s;return[x,world.groundHeight(x,z,.34,limit),z];});
        if(pair.every(([x,y,z])=>Number.isFinite(y)&&c.minY<=y+.4&&c.maxY>=y+1.4&&!world.overlapsCylinder(x,z,.34,y+.42,y+1.8))&&Math.abs(pair[0][1]-pair[1][1])<.02)return {pair};
      }
    }
    throw Error('No close real wall melee arena');
  }
  async leanArenaForTest() {
    const w = this.activeMap.world;
    for (let x = -20; x <= 20; x += 2) for (let z = -20; z <= 18; z += 2) {
      const y = w.groundHeight(x, z, .24, 2);
      const otherY = w.groundHeight(x + .4, z + 3.5, .24, 2);
      if (!Number.isFinite(y) || Math.abs(otherY - y) > .01) continue;
      if (w.overlapsCylinder(x, z, .65, y + .42, y + 1.85)
        || w.overlapsCylinder(x + .4, z + 3.5, .34, y + .42, y + 1.8)) continue;
      if (w.raycast(x + .4, y + 1.64, z + 3.5, 0, 0, -1, 3.5)) continue;
      return { victim: [x, y, z], shooter: [x + .4, y, z + 3.5] };
    }
    throw new Error('No clear arena for actual leaned-head hit testing');
  }
  async shotWallForTest(id) {
    const e = this.players.get(id);
    if (!e?.session.alive) throw new Error('Requires a real spawned session');
    const p = e.controller, o = p.leanEye(), d = p.lookDirection();
    const hit = this.activeMap.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, e.gun.stats.range);
    return hit ? { tag: hit.collider.tag, distance: hit.distance, origin: o, lean: p.lean } : null;
  }
  /** Real architecture that blocks players and bullets: freestanding wall lots first, then
   * interior/underground walls, then building masses (the overhauled Town and City have no
   * freestanding wall lots). */
  architectureForTest(world) {
    const rank = (c) => c.tag.startsWith('wall:') ? 0 : /^(circulation|underground):.*:wall$/.test(c.tag) ? 1 : c.tag.startsWith('building:') ? 2 : 3;
    return [...world.colliders.values()].filter((c) => rank(c) < 3 && c.hy >= 1).sort((a, b) => rank(a) - rank(b));
  }
  /** True when collider `c` stands across a player's whole height on ground at `y` (a passage
   * wall below the street, or a lintel above it, does not separate two players). */
  coversStandingForTest(c, y) {
    return c.minY <= y + .3 && c.maxY >= y + 1.9;
  }
  async leanWallForTest() {
    const w = this.activeMap.world;
    for (const c of this.architectureForTest(w)) {
      const shortX = c.hx < c.hz, nx = shortX ? c.cos : c.sin, nz = shortX ? -c.sin : c.cos;
      const gap = (shortX ? c.hx : c.hz) + .37;
      for (const side of [-1, 1]) {
        const x = c.cx + nx * gap * side, z = c.cz + nz * gap * side;
        const y = w.groundHeight(x, z, .24, 2);
        if (!Number.isFinite(y) || !this.coversStandingForTest(c, y) || w.overlapsCylinder(x, z, .34, y + .42, y + 1.8)) continue;
        const dx = -nx * side, dz = -nz * side;
        if (w.raycast(x, y + 1.64, z, dx, 0, dz, .5)?.collider !== c) continue;
        const heading = Math.atan2(dx, -dz) * 180 / Math.PI;
        return { position: [x, y, z], heading, wall: c.tag };
      }
    }
    throw new Error('No clear position beside a real map wall');
  }
  async placeForCombatTest(id, pos, heading = 0) {
    const e = this.players.get(id);
    if (!e?.session.alive) throw new Error('Requires a real, server-spawned WebSocket session');
    const [x, y, z] = pos;
    if (this.activeMap.world.overlapsCylinder(x, z, .34, y + .42, y + 1.8)) throw new Error('Arena position intersects map solids');
    e.controller.teleport({ x, y, z }, heading);
    this.start();
    await this.persist();for(const p of this.players.values())this.attach(p);
    this.attach(e);
    this.broadcast();
    return this.snapshot();
  }
  async placeManyForCombatTest(placements) {
    for(const {id,pos}of placements){const e=this.players.get(id),[x,y,z]=pos;if(!e?.session.alive||this.activeMap.world.overlapsCylinder(x,z,.34,y+.42,y+1.8))throw Error('Requires clear positions and actual spawned sessions');}
    for(const {id,pos,heading=0}of placements){const e=this.players.get(id);e.controller.teleport({x:pos[0],y:pos[1],z:pos[2]},heading);}
    this.start();await this.persist();for(const e of this.players.values())this.attach(e);this.broadcast();return this.snapshot();
  }
  async smokeObservationForTest(position) {
    const w=this.activeMap.world;
    for(let distance=6;distance<=10;distance+=2)for(let i=0;i<16;i++){
      const x=position.x+Math.cos(i*Math.PI/8)*distance,z=position.z+Math.sin(i*Math.PI/8)*distance,y=w.groundHeight(x,z,.34,3);
      if(!Number.isFinite(y)||w.overlapsCylinder(x,z,.34,y+.42,y+1.8))continue;
      const delta=[position.x-x,position.y+1-y-1.64,position.z-z],length=Math.hypot(...delta);
      if(!w.raycast(x,y+1.64,z,...delta.map(v=>v/length),length-.2))return [x,y,z];
    }
    throw new Error('No clear external smoke observation point');
  }
  async mediumBlastPositionForTest(origin){
    const w=this.activeMap.world;
    for(let i=0;i<32;i++){const a=i*Math.PI/16,x=origin.x+Math.cos(a)*3.4,z=origin.z+Math.sin(a)*3.4,y=w.groundHeight(x,z,.34,origin.y+1);
      if(!Number.isFinite(y)||Math.abs(y-origin.y)>.2||[0,.5,1].some(t=>w.overlapsCylinder(x+Math.cos(a)*t,z+Math.sin(a)*t,.5,y+.01,y+1.8)))continue;
      const d=[x-origin.x,y+.25-origin.y,z-origin.z],n=Math.hypot(...d);
      if(!w.raycast(origin.x,origin.y,origin.z,...d.map(v=>v/n),n-.001,c=>c.solid))return[x,y,z];
    }throw Error('No unobstructed medium-distance blast position in actual map');
  }
  async wallArenaForTest() {
    const world = this.activeMap.world;
    let fallback = null;
    for (const c of this.architectureForTest(world)) {
      const alongX = c.hx < c.hz;
      const nx = alongX ? c.cos : c.sin, nz = alongX ? -c.sin : c.cos;
      const gap = (alongX ? c.hx : c.hz) + 1.2;
      const pair = [-1, 1].map((s) => {
        const x = c.cx + nx * gap * s, z = c.cz + nz * gap * s;
        return [x, world.groundHeight(x, z, .24, 3), z];
      });
      const eyeRay = () => {
        const [a, b] = pair, d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], length = Math.hypot(...d);
        return world.raycast(a[0], a[1] + 1.64, a[2], ...d.map((v) => v / length), length)?.collider === c;
      };
      if (pair.every(([x, y, z]) => Number.isFinite(y) && this.coversStandingForTest(c, y) && !world.overlapsCylinder(x, z, .34, y + .42, y + 1.8)) && eyeRay()) {
        const tangent = alongX ? [c.sin, c.cos] : [c.cos, -c.sin];
        const shift = (alongX ? c.hz : c.hx) - .08;
        const edgePair = pair.map(([x, , z]) => {
          x += tangent[0] * shift; z += tangent[1] * shift;
          return [x, world.groundHeight(x, z, .24, 3), z];
        });
        const result = { pair, wall: c.tag, edgePair: null };
        if (edgePair.every(([x, y, z]) => Number.isFinite(y) && !world.overlapsCylinder(x, z, .34, y + .42, y + 1.8))) {
          result.edgePair = edgePair;
          return result;
        }
        fallback ??= result;
      }
    }
    if (fallback) return fallback;
    throw new Error('No clear opposite sides of a real map wall');
  }
  async distantArenaForTest() {
    const world = this.activeMap.world;
    for (const a of this.activeMap.layout.spawns) for (const b of this.activeMap.layout.spawns) {
      const delta = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]];
      const distance = Math.hypot(...delta);
      if (distance < 20 || distance > 45) continue;
      if (!world.raycast(a.pos[0], a.pos[1] + 1.64, a.pos[2], delta[0] / distance, delta[1] / distance, delta[2] / distance, distance - .4)) {
        return { pair: [a.pos, b.pos], distance };
      }
    }
    throw new Error('No distant clear sightline between actual map spawns');
  }
  async advanceMapForTest() {
    this.ledger.endsAt = Date.now();
    this.schedule.epoch -= 600000;
    await this.ctx.storage.put('map-schedule', this.schedule);
    this.ensureRound();
    await this.persist();
    return this.snapshot();
  }
  async outsideForTest(id, nonFinite = false) {
    const entry = this.players.get(id);
    if (!entry?.session.alive) throw new Error('Test requires a spawned real session');
    entry.controller.position.x = nonFinite ? NaN : this.activeMap.layout.outerLimit + 1;
    this.start();
  }
  async fallForTest(id) {
    const entry = this.players.get(id);
    if (!entry?.session.alive) throw new Error('Test requires a spawned real session');
    entry.controller.position.y = -30;
    entry.controller.grounded = false;
    this.start();
  }
}
