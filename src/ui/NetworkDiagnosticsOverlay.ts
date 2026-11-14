/** Explicit ?netDiagnostics=1 developer UI. No repeating timers or payload logging. */
export class NetworkDiagnosticsOverlay {
  private root: HTMLElement | null = null;
  private text: HTMLElement | null = null;
  private updated = -Infinity;
  constructor(enabled: boolean, private readonly report: () => unknown) {
    if (!enabled) return;
    this.root=document.createElement('aside');this.root.className='network-diagnostics';
    this.root.setAttribute('aria-label','Developer network diagnostics');
    this.text=document.createElement('pre');
    const download=document.createElement('button');download.type='button';download.textContent='Download report';
    download.addEventListener('click',()=>this.download());
    this.root.append(this.text,download);document.body.append(this.root);
  }
  update(now: number): void {
    if (!this.text || now-this.updated<500) return;
    this.updated=now;
    const data=this.report() as {network?:{state?:string;pending?:number;inFlight?:number;bufferedBytes?:number;ackAgeMs?:number;
      appliedSnapshotAgeMs?:number|null;corrections?:{significant:number;max:number};
      telemetry?:{rates?:{snapshots:number;inputs:number};metrics?:Record<string,{min:number;median:number;p95:number;max:number}>}};
      frames?:{p95?:number;longFrames?:number}};
    const n=data.network,t=n?.telemetry,m=t?.metrics;
    const fmt=(v:number|undefined|null)=>typeof v==='number'?v.toFixed(1):'n/a';
    const rtt=m?.rttMs;
    this.text.textContent=[`NETWORK · ${n?.state??'no online session'}`,
      `App RTT min/median/P95/max: ${rtt?[rtt.min,rtt.median,rtt.p95,rtt.max].map(fmt).join('/'):'n/a'} ms`,
      `RTT jitter: ${fmt(m?.rttJitterMs?.median)} ms`,
      `Server handler/tick: ${fmt(m?.serverHandlerMs?.median)}/${fmt(m?.serverTickMs?.p95)} ms`,
      `Client handler/dispatch age P95: ${fmt(m?.handlerMs?.p95)}/${fmt(m?.dispatchAgeMs?.p95)} ms`,
      `Snapshots/inputs: ${fmt(t?.rates?.snapshots)}/${fmt(t?.rates?.inputs)} per s`,
      `Snapshot bytes P95: ${fmt(m?.snapshotBytes?.p95)}`,
      `Applied snapshot/ack age: ${fmt(n?.appliedSnapshotAgeMs)}/${fmt(n?.ackAgeMs)} ms`,
      `Pending/in flight: ${n?.pending??0}/${n?.inFlight??0} · outbound: ${n?.bufferedBytes??0} B`,
      `Position corrections >1 cm: ${n?.corrections?.significant??0} · max ${fmt((n?.corrections?.max??0)*100)} cm`,
      `Camera correction P95: ${fmt(m?.cameraCorrectionRad?.p95)} rad`,
      `Frame P95: ${fmt(data.frames?.p95)} ms · stalls: ${data.frames?.longFrames??0}`,
      'App RTT includes scheduling; outbound bytes ≠ incoming backlog.',
      'Server clocks may be frozen; 0 ms does not prove zero CPU cost.',
      'Escape unlocks the mouse to download.'].join('\n');
  }
  download(): void {
    const blob=new Blob([JSON.stringify(this.report(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download='crossfire-network-report.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  dispose(): void {this.root?.remove();this.root=this.text=null;}
}
