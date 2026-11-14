/** Fixed navigation is deliberately independent of rebindable gameplay controls. */
export class ControllerMenu {
  private held=new Set<string>();private nextRepeat=0;private time=0;private screen='';
  onPreview:(x:number,y:number,dt:number)=>void=()=>{};
  reset(){this.held.clear();this.nextRepeat=0;}
  update(pad:Gamepad,dt:number){
    this.time+=Math.min(.1,dt);
    const screen=document.body.dataset.screen??'';
    if(this.screen!==screen){this.screen=screen;this.focusFirst();}
    const press=(i:number)=>!!pad.buttons[i]?.pressed||((pad.buttons[i]?.value??0)>.55);
    const inputs=new Set<string>();
    if(press(12)||(pad.axes[1]??0)<-.55)inputs.add('up');if(press(13)||(pad.axes[1]??0)>.55)inputs.add('down');
    if(press(14)||(pad.axes[0]??0)<-.55)inputs.add('left');if(press(15)||(pad.axes[0]??0)>.55)inputs.add('right');
    if(press(0))inputs.add('confirm');if(press(1)||press(9))inputs.add('back');if(press(4))inputs.add('tabLeft');if(press(5))inputs.add('tabRight');
    for(const key of inputs){const fresh=!this.held.has(key),repeat=['up','down','left','right'].includes(key)&&this.time>=this.nextRepeat;
      if(fresh||repeat){this.handle(key);this.nextRepeat=this.time+(fresh?.35:.13);break;}}
    this.held=inputs;
    const x=pad.axes[2]??0,y=pad.axes[3]??0;if(Math.hypot(x,y)>.2)this.onPreview(x,y,Math.min(.1,dt));
  }
  private candidates():HTMLElement[]{const modal=Array.from(document.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"][aria-modal="true"]')).find(e=>!e.closest('[hidden],[inert]')&&e.getClientRects().length>0);return Array.from(document.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[role="slider"],[tabindex="0"]')).filter(e=>(!modal||modal.contains(e))&&!e.closest('[inert],[hidden],[aria-hidden="true"]')&&!e.matches(':disabled,[aria-disabled="true"]')&&e.getClientRects().length>0);}
  private focusFirst(){const all=this.candidates(),root=document.getElementById(this.screen);(all.find(e=>root?.contains(e))??all[0])?.focus();}
  private handle(key:string){
    const all=this.candidates();let active=document.activeElement as HTMLElement;
    if(!all.includes(active)){this.focusFirst();active=document.activeElement as HTMLElement;}
    if(active?.matches('[role="combobox"]')&&(['confirm','left','right'].includes(key)||active.getAttribute('aria-expanded')==='true')){
      active.dispatchEvent(new KeyboardEvent('keydown',{key:({confirm:'Enter',up:'ArrowUp',down:'ArrowDown',left:'ArrowUp',right:'ArrowDown',back:'Escape'} as Record<string,string>)[key]??'Escape',bubbles:true,cancelable:true}));return;
    }
    if(key==='confirm'){active?.click();return;}
    if(key==='back'){
      if(active?.matches('textarea,input:not([type="range"]):not([type="checkbox"]):not([type="radio"])')){active.blur();return;}
      const root=document.getElementById(this.screen);
      // Prefer page navigation over inline controls such as "Cancel binding".
      const local=all.filter(e=>root?.contains(e));
      const back=local.find(e=>/^(back|resume|return home|return to (menu|lobby))$/i.test(e.textContent?.trim()??''))
        ??local.find(e=>/^(cancel|close)$/i.test(e.textContent?.trim()??''))
        ??all.find(e=>e.matches('.home-nav .nav-button')&&e.textContent?.trim().toLowerCase()==='play');
      if(back)back.click();else active?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));return;
    }
    if(key==='tabLeft'||key==='tabRight'){
      const localTabs=all.filter(e=>document.getElementById(this.screen)?.contains(e)&&e.matches('[role="tab"]'));
      const tabs=localTabs.length?localTabs:all.filter(e=>e.matches('.nav-button,.cosmetic-category'));
      const index=Math.max(0,tabs.findIndex(e=>e===active||e.matches('[aria-selected="true"],[aria-current="page"]')));
      const tab=tabs[(index+(key==='tabRight'?1:tabs.length-1))%tabs.length];tab?.focus();tab?.click();return;
    }
    if((key==='left'||key==='right')&&active?.matches('input[type="range"],[role="slider"],select')){
      if(active instanceof HTMLInputElement){if(key==='left')active.stepDown();else active.stepUp();active.dispatchEvent(new Event('input',{bubbles:true}));}
      else if(active instanceof HTMLSelectElement){active.selectedIndex=Math.max(0,Math.min(active.options.length-1,active.selectedIndex+(key==='left'?-1:1)));active.dispatchEvent(new Event('change',{bubbles:true}));}
      else active.dispatchEvent(new KeyboardEvent('keydown',{key:key==='left'?'ArrowLeft':'ArrowRight',bubbles:true,cancelable:true}));return;
    }
    const index=all.indexOf(active),next=all[(index+(['up','left'].includes(key)?all.length-1:1))%all.length];next?.focus();next?.scrollIntoView({block:'nearest',inline:'nearest'});
  }
}
