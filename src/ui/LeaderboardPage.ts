import { assetUrl } from '../core/assets';
import { PERIODS, METRICS, statRatios, type StatsPeriod, type StatsMetric, type LeaderboardView, type PersonalStats } from '../../shared/statistics';
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
const number=new Intl.NumberFormat('en-US');
export class LeaderboardPage {
  request:(period:StatsPeriod,metric:StatsMetric,signal:AbortSignal)=>Promise<{board:LeaderboardView;personal:PersonalStats|null}>=async()=>{throw new Error('Leaderboards unavailable: check multiplayer configuration.');};
  private period:StatsPeriod='all';private metric:StatsMetric='kills';
  private readonly rows=node('tbody');private readonly status=node('p','leaderboard-status');
  private readonly own=node('p','leaderboard-own');private readonly panel=node('div','personal-stats');
  private readonly statsButton=node('button','btn stats-button','MY STATS');
  private readonly buttons:HTMLButtonElement[]=[];private controller:AbortController|null=null;
  private timer:ReturnType<typeof setInterval>|null=null;private opened=false;
  private personal:PersonalStats|null=null; private selection='';
  constructor(readonly root:HTMLElement,back:()=>void){
    root.classList.add('leaderboard-page');root.setAttribute('aria-label','Global leaderboards');
    const background=node('img','home-backdrop leaderboard-backdrop');background.src=assetUrl('assets/ui/town-plaza.webp');background.alt='';
    const header=node('div','leaderboard-heading'),backButton=node('button','btn','Back');backButton.addEventListener('click',back);
    const stats=node('div','stats-dropdown');this.panel.hidden=true;this.panel.id='personal-statistics';
    this.panel.setAttribute('role','region');this.panel.setAttribute('aria-label','My lifetime statistics');
    this.statsButton.setAttribute('aria-expanded','false');this.statsButton.setAttribute('aria-controls',this.panel.id);
    this.statsButton.addEventListener('click',()=>this.toggleStats(!!this.panel.hidden));
    stats.append(this.statsButton,this.panel);header.append(backButton,node('h2','','LEADERBOARD'),stats);
    const content=node('div','leaderboard-content');
    for(const [kind,items]of [['period',PERIODS],['metric',METRICS]] as const){
      const group=node('div','leaderboard-tabs');group.setAttribute('role','group');group.setAttribute('aria-label',kind==='period'?'Time period':'Statistic');
      for(const item of items){const b=node('button','btn',item.toUpperCase());b.dataset[kind]=item;
        b.addEventListener('click',()=>{if(kind==='period')this.period=item as StatsPeriod;else this.metric=item as StatsMetric;this.refreshSelection();void this.load();});
        group.append(b);this.buttons.push(b);}
      content.append(group);
    }
    const table=node('table','global-rankings'),head=node('thead'),tr=node('tr');
    for(const label of ['Rank','Player','Total']){const th=node('th','',label);th.scope='col';tr.append(th);}head.append(tr);table.append(head,this.rows);
    this.status.setAttribute('role','status');
    const retry=node('button','btn leaderboard-retry','Refresh');retry.addEventListener('click',()=>void this.load());
    content.append(table,this.own,this.status,retry);root.append(background,header,content);
    document.addEventListener('pointerdown',event=>{if(this.opened&&!stats.contains(event.target as Node))this.toggleStats(false);});
    root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();if(!this.panel.hidden){this.toggleStats(false);this.statsButton.focus();}else back();}});
    this.refreshSelection();
  }
  private toggleStats(open:boolean):void{this.panel.hidden=!open;this.statsButton.setAttribute('aria-expanded',String(open));this.renderPersonal();}
  private refreshSelection():void{for(const b of this.buttons)b.setAttribute('aria-pressed',String(b.dataset.period?b.dataset.period===this.period:b.dataset.metric===this.metric));}
  show():void{if(this.opened)return;this.opened=true;void this.load();this.timer=setInterval(()=>{if(!this.controller)void this.load();},5000);}
  hide():void{this.opened=false;this.controller?.abort();this.controller=null;if(this.timer)clearInterval(this.timer);this.timer=null;this.toggleStats(false);}
  private async load():Promise<void>{
    this.controller?.abort();const controller=new AbortController();this.controller=controller;
    const timeout=setTimeout(()=>controller.abort(),10000);
    const selection=`${this.period}:${this.metric}`;
    if(selection!==this.selection){this.rows.replaceChildren();this.own.textContent='';this.status.textContent='Loading rankings...';this.selection=selection;}
    try{
      const {board,personal}=await this.request(this.period,this.metric,controller.signal);
      if(!this.opened||this.controller!==controller||controller.signal.aborted)return;
      this.personal=personal;this.renderPersonal();this.rows.replaceChildren();
      for(const row of board.rows){const tr=node('tr',row.local?'local':'');
        tr.append(node('td','',`#${row.rank}`),node('td','player-name',row.name),node('td','',number.format(row.value)));this.rows.append(tr);}
      if(board.own&&board.own.rank>10)this.own.textContent=`Your rank: #${number.format(board.own.rank)}  ${number.format(board.own.value)}`;
      this.status.textContent=board.rows.length?'':'No statistics yet for this selection.';
    }catch(error){if(this.opened&&this.controller===controller)this.status.textContent=controller.signal.aborted?'Request timed out. Select Refresh to retry.':(error as Error).message;}
    finally{clearTimeout(timeout);if(this.controller===controller)this.controller=null;}
  }
  private renderPersonal():void{
    this.panel.replaceChildren();
    if(!this.personal){this.panel.append(node('p','','Statistics are loading or unavailable.'));return;}
    const t=this.personal.totals,r=statRatios(t),list=node('dl');
    for(const [label,value]of [['Games Played',number.format(t.games)],['Total Wins',number.format(t.wins)],['Win Ratio',r.win],
      ['Total Kills',number.format(t.kills)],['Total Deaths',number.format(t.deaths)],['K/D Ratio',r.kd],['Total Gems Collected',number.format(t.gems)]])
      list.append(node('dt','',label),node('dd','',value));
    this.panel.append(list,node('small','','Lifetime totals. K/D is unavailable until the first death.'));
  }
}
