import fs from 'node:fs';
const root='test-results/frame-time',rows=['| Run | Map | Scenario | FPS (window) | 1% low | P50 / P95 / P99 ms | >50 / >100 / >250 | Draws | Triangles | Shot max ms | Heap range MB |','|---|---|---|---:|---:|---|---|---:|---:|---:|---|'];
for(const run of ['cycle0','cycle1','cycle2'])for(const map of ['farmstead','industrial-complex']){
 const file=`${root}/${run}-${map}.json`;if(!fs.existsSync(file)){rows.push(`Missing: ${file}`);continue;}
 const report=JSON.parse(fs.readFileSync(file,'utf8'));if(report.failure||report.errors.length)rows.push(`FAILED ${run}/${map}: ${report.failure??report.errors.join(', ')}`);
 if(report.cleanupForced)rows.push(`Browser cleanup timeout: ${run}/${map} (workload data retained).`);
 for(const s of report.scenarios){const f=s.frames.frames,heap=s.heaps.filter(Number.isFinite).map(n=>n/1048576),n=x=>Number(x??0).toFixed(1);
  rows.push(`| ${run} | ${map} | ${s.scenario} | ${n(f.fps)} | ${n(f.low1Fps)} | ${n(f.p50)} / ${n(f.p95)} / ${n(f.p99)} | ${f.stalls.over50} / ${f.stalls.over100} / ${f.stalls.over250} | ${s.stats.drawCalls} | ${Math.round(s.frames.resources.triangles)} | ${n(f.sections.shot?.max)} | ${n(Math.min(...heap))}–${n(Math.max(...heap))} |`);
 }
}
fs.writeFileSync(`${root}/summary.md`,rows.join('\n')+'\n');console.log(rows.join('\n'));
