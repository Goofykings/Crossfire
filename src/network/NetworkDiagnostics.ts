/** Opt-in, bounded numeric telemetry. Never stores messages, URLs, player data or credentials. */
export type NetworkMetric = 'rttMs' | 'rttJitterMs' | 'serverHandlerMs' | 'serverTickMs' | 'serverDebtMs'
  | 'serverQueuedInputs' | 'handlerMs' | 'dispatchAgeMs' | 'snapshotBytes' | 'snapshotGapMs'
  | 'ackLatencyMs' | 'reconcileMs' | 'correctionM' | 'cameraCorrectionRad' | 'frameDebtMs';
export interface CorrectionTrace {atMs:number;metres:number;ack:number;replayed:number;snapshotAgeMs:number;groundedBefore:boolean;groundedAfter:boolean}

export class NetworkDiagnostics {
  private readonly samples = new Map<NetworkMetric, number[]>();
  private readonly counters: Record<string, number> = {};
  private readonly started = performance.now();
  private readonly rateEvents = {snapshots:[] as {at:number;count:number}[],inputs:[] as {at:number;count:number}[],inputPackets:[] as {at:number;count:number}[]};
  private previousRtt: number | null = null;
  private previousSnapshot: number | null = null;
  private readonly correctionTrace:CorrectionTrace[]=[];
  constructor(readonly enabled = false) {}
  count(name: 'messages' | 'snapshots' | 'inputs' | 'inputPackets' | 'appliedSnapshots' | 'duplicateReconciliations'
    | 'staleReconciliations' | 'fastReconciliations' | 'coalescedSnapshots' | 'frameBudgetHits', amount = 1): void {
    if (!this.enabled) return;
    this.counters[name] = (this.counters[name] ?? 0) + amount;
    if(name==='snapshots'||name==='inputs'||name==='inputPackets'){
      const events=this.rateEvents[name];events.push({at:performance.now(),count:amount});if(events.length>256)events.shift();
    }
  }
  record(name: NetworkMetric, value: number): void {
    if (!this.enabled || !Number.isFinite(value) || value < 0) return;
    let ring = this.samples.get(name);
    if (!ring) this.samples.set(name, ring = []);
    ring.push(value); if (ring.length > 128) ring.shift();
  }
  rtt(value: number): void {
    if (!this.enabled) return;
    this.record('rttMs', value);
    if (this.previousRtt !== null) this.record('rttJitterMs', Math.abs(value - this.previousRtt));
    this.previousRtt = value;
  }
  snapshot(bytes: number, now = performance.now()): void {
    if (!this.enabled) return;
    this.count('snapshots'); this.record('snapshotBytes', bytes);
    if (this.previousSnapshot !== null) this.record('snapshotGapMs', Math.max(0, now - this.previousSnapshot));
    this.previousSnapshot = now;
  }
  correction(sample:CorrectionTrace):void {
    if(!this.enabled||sample.metres<=.0001)return;
    this.correctionTrace.push({...sample});if(this.correctionTrace.length>128)this.correctionTrace.shift();
  }
  report() {
    if (!this.enabled) return { enabled: false as const };
    const seconds = Math.max(.001, (performance.now() - this.started) / 1000);
    const cutoff=performance.now()-1000;
    const rate=(name:keyof typeof this.rateEvents)=>this.rateEvents[name].reduce((sum,e)=>sum+(e.at>=cutoff?e.count:0),0)/Math.min(1,seconds);
    return { enabled: true as const, capacityPerMetric: 128, seconds, counters: { ...this.counters },recentCorrections:this.correctionTrace.map(s=>({...s})),
      rates: { windowMs:1000,snapshots:rate('snapshots'),inputs:rate('inputs'),inputPackets:rate('inputPackets') },
      metrics: Object.fromEntries([...this.samples].map(([key, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
        return [key, { count: values.length, min: at(0), median: at(.5), p95: at(.95), max: at(1),
          mean: values.reduce((a, b) => a + b, 0) / values.length, recent: [...values] }];
      })) };
  }
}
