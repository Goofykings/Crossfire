import { challengeDefinition, type CareerView, type ChallengeCategory } from '../../shared/challenges';

/** Original faceted crystal, reused for balances and every challenge reward. */
export const GEM_ICON = '<svg class="gem-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10l5 6-10 13L2 9Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m7 3 5 19L17 3M2 9h20M7 3l5 6 5-6" fill="none" stroke="currentColor" stroke-width="1" opacity=".6"/></svg>';

export function resetCountdown(endsAt: number, serverNow: number): string {
  const seconds = Math.max(0, Math.ceil((endsAt - serverNow) / 1000));
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return `${days ? `${days}d ` : ''}${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
}

export class ChallengesPanel {
  readonly root = document.createElement('aside');
  readonly account = document.createElement('div');
  private readonly name = document.createElement('div');
  private readonly balance = document.createElement('span');
  private readonly body = document.createElement('div');
  private readonly countdown = document.createElement('small');
  private readonly status = document.createElement('small');
  private readonly retry = document.createElement('button');
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly cards: { root: HTMLElement; title: HTMLElement; fill: HTMLElement; fraction: HTMLElement; reward: HTMLElement; done: HTMLElement }[] = [];
  private category: ChallengeCategory = 'daily';
  private view: CareerView | null = null;
  private signature = '';
  private displayedGems: number | null = null;
  private startGems = 0;
  private targetGems = 0;
  private balanceAt = 0;
  private lastSecond = -1;
  onRetry: () => void = () => {};
  onReset: () => void = () => {};
  constructor(parent: HTMLElement) {
    this.root.className = 'challenges-panel'; this.root.setAttribute('aria-label','Challenges');
    const nav = document.createElement('div'); nav.className = 'challenge-tabs'; nav.setAttribute('role','tablist'); nav.setAttribute('aria-label','Challenge period');
    for (const category of ['daily','weekly'] as const) {
      const tab = document.createElement('button'); tab.type='button'; tab.textContent=category.toUpperCase(); tab.setAttribute('role','tab'); tab.id=`challenge-tab-${category}`;
      tab.setAttribute('aria-controls','challenge-list');
      tab.onclick=()=>this.select(category);
      tab.onkeydown=event=>{ if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();this.select(event.key==='Home'?'daily':event.key==='End'?'weekly':this.category==='daily'?'weekly':'daily');this.tabs[this.category==='daily'?0:1].focus();} };
      this.tabs.push(tab); nav.append(tab);
    }
    this.body.className='challenge-list'; this.body.id='challenge-list'; this.body.setAttribute('role','tabpanel'); this.body.tabIndex=0;
    for (let i=0;i<3;i++) {
      const root=document.createElement('article');root.className='challenge-card';
      const title=document.createElement('div'); title.className='challenge-description';
      const progress=document.createElement('div');progress.className='challenge-progress';
      const track=document.createElement('div');track.className='challenge-track';track.setAttribute('role','progressbar');
      const fill=document.createElement('i');track.append(fill);
      const fraction=document.createElement('span');fraction.className='challenge-fraction';progress.append(track,fraction);
      const footer=document.createElement('div');footer.className='challenge-card-foot';
      const reward=document.createElement('span');reward.className='challenge-reward';
      const done=document.createElement('small');done.className='challenge-completed';footer.append(reward,done);
      root.append(title,progress,footer);this.body.append(root);this.cards.push({root,title,fill,fraction,reward,done});
    }
    this.countdown.className='challenge-reset';this.status.className='challenge-status';
    this.retry.type='button';this.retry.className='challenge-retry';this.retry.textContent='Retry';this.retry.onclick=()=>this.onRetry();this.retry.hidden=true;
    this.root.append(nav,this.body,this.countdown,this.status,this.retry);
    this.account.className='home-account';this.account.setAttribute('aria-label','Guest gem balance');
    this.name.className='home-account-name';const gems=document.createElement('div');gems.className='home-gems';gems.innerHTML=GEM_ICON;gems.append(this.balance);
    this.balance.textContent='—';this.account.append(this.name,gems);parent.append(this.root,this.account);
    this.select('daily');this.set(null,'Loading challenges');
  }
  private select(category: ChallengeCategory): void {
    this.category=category;this.signature='';this.lastSecond=-1;
    this.tabs.forEach((tab,i)=>{const selected=i===(category==='daily'?0:1);tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});
    this.body.setAttribute('aria-labelledby',`challenge-tab-${category}`);this.body.dataset.category=category;this.root.dataset.category=category;
    this.body.classList.remove('challenge-switch');void this.body.offsetWidth;this.body.classList.add('challenge-switch');this.render();
  }
  set(view: CareerView | null, error='', temporary=false): void {
    const previous=this.view;this.view=view;this.root.dataset.available=String(!!view);
    this.status.textContent=error||(temporary?'Temporary guest · progress access ends when this page closes':'');this.retry.hidden=!error;
    if(view&&this.targetGems!==view.gems){this.startGems=this.displayedGems??view.gems;this.targetGems=view.gems;this.balanceAt=performance.now();}
    if(view&&previous&&view.gems>previous.gems){this.account.classList.remove('gem-earned');void this.account.offsetWidth;this.account.classList.add('gem-earned');}
    this.render();
  }
  private render(): void {
    const period=this.view?.[this.category],signature=JSON.stringify(period??null);
    if(signature===this.signature)return;this.signature=signature;
    this.cards.forEach((card,i)=>{
      const progress=period?.challenges[i],definition=progress?challengeDefinition(progress.id):null;
      card.root.hidden=!definition; if(!definition||!progress)return;
      card.root.dataset.challengeId=progress.id;
      const complete=progress.completedAt!==null;
      card.title.textContent=definition.description;
      card.fill.style.width=`${Math.min(100,progress.progress/definition.target*100)}%`;
      const track=card.fill.parentElement!;track.setAttribute('aria-label',definition.description);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax',String(definition.target));track.setAttribute('aria-valuenow',String(progress.progress));
      card.fraction.textContent=`${progress.progress.toLocaleString('en-US')}/${definition.target.toLocaleString('en-US')}`;
      card.reward.innerHTML=`${GEM_ICON}<span>${definition.reward}</span>`;
      card.done.textContent=complete?'✓ COMPLETED · RECEIVED':'';card.root.classList.toggle('completed',complete);
    });
  }
  update(name: string, serverNow: number | null): void {
    if(this.name.textContent!==name)this.name.textContent=name||'Guest';
    if(this.view){
      const t=Math.min(1,(performance.now()-this.balanceAt)/350),amount=Math.round(this.startGems+(this.targetGems-this.startGems)*(1-(1-t)**3));
      if(amount!==this.displayedGems){this.displayedGems=amount;this.balance.textContent=amount.toLocaleString('en-US');}
    }
    if(serverNow===null||!this.view){if(this.countdown.textContent)this.countdown.textContent='';return;}
    const second=Math.floor(serverNow/1000);if(second===this.lastSecond)return;this.lastSecond=second;
    const remaining=this.view[this.category].endsAt-serverNow;
    this.countdown.textContent=`Resets in ${resetCountdown(this.view[this.category].endsAt,serverNow)} · UTC`;
    if(remaining<=0)this.onReset();
  }
}
