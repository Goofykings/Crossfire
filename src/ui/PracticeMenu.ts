import {MAPS} from '../maps/registry';
import {assetUrl} from '../core/assets';
import {DEFAULT_PRACTICE,PRACTICE_NOTICE,type PracticeSetup,type BotDifficulty} from '../practice/config';
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
export class PracticeMenu {
 onStart:(setup:PracticeSetup)=>void=()=>{};
 private setup:PracticeSetup={...DEFAULT_PRACTICE};private options:{key:'mapId'|'mode'|'difficulty';value:string;button:HTMLButtonElement}[]=[];private start!:HTMLButtonElement;
 constructor(screen:HTMLElement,private show:()=>void,back:()=>void){
  screen.classList.add('room-screen');const bg=node('img','room-background');bg.src=assetUrl('assets/ui/town-plaza.webp');bg.alt='';screen.append(bg);
  const form=node('form','room-shell practice-setup'),head=node('header','room-heading');head.append(node('h1','','PRACTICE'),this.button('Back',back));
  const maps=node('div','room-map-grid');for(const map of MAPS){const b=this.option('mapId',map.id,map.name);b.classList.add('room-map');b.dataset.map=map.id;const img=node('img');img.src=assetUrl(`assets/maps/${map.id}/thumb.jpg`);img.alt='';b.prepend(img);maps.append(b);}
  const modes=node('div','room-options');for(const value of ['ffa','teams'])modes.append(this.option('mode',value,value==='ffa'?'FFA':'TEAMS'));
  const count=node('label','room-limit','Bots '),input=node('input'),output=node('output','','3');input.type='range';input.min='0';input.max='5';input.step='1';input.value='3';input.setAttribute('aria-label','Number of bots');input.oninput=()=>{this.setup.bots=Number(input.value);output.textContent=input.value;};count.append(input,output);
  const difficulty=node('div','room-options');for(const value of ['beginner','advanced','absurd'] as BotDifficulty[])difficulty.append(this.option('difficulty',value,value.toUpperCase()));
  const notice=node('p','practice-notice',PRACTICE_NOTICE),start=this.start=node('button','btn primary','START PRACTICE');start.type='submit';form.onsubmit=e=>{e.preventDefault();if(start.disabled)return;start.disabled=true;this.onStart({...this.setup});};
  form.append(head,maps,modes,count,difficulty,notice,start);screen.append(form);this.sync();
 }
 private button(text:string,fn:()=>void){const b=node('button','btn',text);b.type='button';b.onclick=fn;return b;}
 private option(key:'mapId'|'mode'|'difficulty',value:string,text:string){const b=this.button(text,()=>{(this.setup[key] as string)=value;this.sync();});b.dataset[key]=value;this.options.push({key,value,button:b});return b;}
 private sync(){for(const o of this.options){const selected=this.setup[o.key]===o.value;o.button.classList.toggle('selected',selected);o.button.setAttribute('aria-pressed',String(selected));}}
 open(){this.start.disabled=false;this.sync();this.show();}
 inspect(){return{...this.setup};}
}
