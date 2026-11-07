import { ROOM_LIMITS, roomCode, roomName, type RoomAdmission, type RoomSetup } from '../../shared/rooms';
import type { RoomClient } from '../network/RoomClient';
import { assetUrl } from '../core/assets';
import {MagneticSlider} from './MagneticSlider';
import { MAPS } from '../maps/registry';
import type { Snapshot } from '../../shared/protocol';
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text=''):HTMLElementTagNameMap[K]=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
/** Independent menu requests are cancelled on navigation; no map or gameplay socket is loaded here. */
export class RoomMenus {
 client:RoomClient|null=null;
 onAdmission:(admission:RoomAdmission)=>void=()=>{};
 onPractice:()=>void=()=>{};
 onOnline:()=>void=()=>{};
 private request:AbortController|null=null;
 private mode:HTMLElement;
 private create:HTMLElement;
 private list=node('div','room-list');
 private status=node('p','room-status');
 private creationError=node('p','room-status');
 private privateDialog=node('dialog','room-private');
 private code=node('input');
 private privateError=node('p','room-status');
 private name=node('input');
 private limit:MagneticSlider;
 private setup:RoomSetup={name:'',privacy:'public',mapId:'european-town',mode:'ffa',maxPlayers:6};
 private options:{button:HTMLButtonElement;key:'privacy'|'mapId'|'mode';value:string}[]=[];
 private roomBadge=node('details','room-badge');
 private roomText=node('div');
 private roomCode=node('button','room-copy');
 private warning=node('div','room-warning');
 private lastCode='';
 private refresh:HTMLButtonElement;
 constructor(screen:(name:'modes'|'create-room')=>HTMLElement,private show:(name:'menu'|'modes'|'create-room')=>void,private username:()=>string,root:HTMLElement){
  this.mode=screen('modes');this.create=screen('create-room');
  for(const screen of [this.mode,this.create]){screen.classList.add('room-screen');const bg=node('img','room-background');bg.src=assetUrl('assets/ui/town-plaza.webp');bg.alt='';screen.append(bg);}
  const frame=node('div','room-shell');const header=node('header','room-heading');header.append(node('h1','','MODE SELECT'),this.button('Back',()=>{this.cancel();this.show('menu');}));
  const columns=node('div','room-columns'),publicArea=node('section','room-public'),publicHead=node('div','room-list-heading');
  this.refresh=this.button('Refresh',()=>void this.load());this.refresh.className='btn room-refresh';this.refresh.setAttribute('aria-label','Refresh public rooms');
  const publicOpen=this.button('Public Servers',()=>void this.load());publicOpen.classList.add('room-public-open');publicHead.append(publicOpen,this.refresh);this.status.setAttribute('role','status');publicArea.append(publicHead,this.list,this.status);
  const actions=node('aside','room-actions');actions.append(this.button('Join Private Server',()=>{this.privateError.textContent='';this.code.value='';this.privateDialog.showModal();this.code.focus();}),this.button('Create Server',()=>this.openCreate()),this.button('Practice',()=>{this.cancel();this.onPractice();}));
  columns.append(publicArea,actions);frame.append(header,columns);this.mode.append(frame);
  const form=node('form','room-setup room-shell');const createHead=node('header','room-heading');createHead.append(node('h1','','CREATE SERVER'),this.button('Back',()=>this.open()));
  this.name.maxLength=48;this.name.required=true;this.name.setAttribute('aria-label','Server name');this.name.className='room-name';
  const privacy=node('div','room-options');for(const value of ['public','private'])privacy.append(this.option('privacy',value,value.toUpperCase()));
  const maps=node('div','room-map-grid');for(const map of MAPS){const b=this.option('mapId',map.id,map.name);b.classList.add('room-map');const img=node('img');img.src=assetUrl(`assets/maps/${map.id}/thumb.jpg`);img.alt='';b.prepend(img);maps.append(b);}
  const modes=node('div','room-options');for(const value of ['ffa','teams'])modes.append(this.option('mode',value,value.toUpperCase()));
  this.limit=new MagneticSlider({min:ROOM_LIMITS.playersMin,max:ROOM_LIMITS.playersMax,step:1,value:ROOM_LIMITS.defaultPlayers,label:'MAXIMUM PLAYERS',ariaLabel:'Maximum players',onChange:value=>{this.setup.maxPlayers=value;}});
  const submit=node('button','btn primary','CREATE');submit.type='submit';this.creationError.setAttribute('role','status');
  form.append(createHead,this.name,privacy,maps,modes,this.limit.root,this.creationError,submit);this.create.append(form);
  form.onsubmit=e=>{e.preventDefault();this.setup.name=roomName(this.name.value);void this.admit(signal=>this.needClient().create({...this.setup},signal),this.creationError);};
  this.code.type='text';this.code.inputMode='numeric';this.code.pattern='[0-9]{6}';this.code.maxLength=6;this.code.autocomplete='off';this.code.setAttribute('aria-label','Six-digit private room code');this.code.oninput=()=>{this.code.value=this.code.value.replace(/[^0-9]/g,'').slice(0,6);};
  const privateForm=node('form');privateForm.append(node('h2','','JOIN PRIVATE SERVER'),this.code,this.privateError,this.button('Cancel',()=>{this.cancel();this.privateDialog.close();}));const join=node('button','btn primary','Join');join.type='submit';privateForm.append(join);
  privateForm.onsubmit=e=>{e.preventDefault();if(!roomCode(this.code.value)){this.privateError.textContent='Enter exactly six digits.';return;}void this.admit(signal=>this.needClient().join({code:this.code.value},signal),this.privateError);};this.privateDialog.append(privateForm);this.mode.append(this.privateDialog);
  this.privateDialog.addEventListener('cancel',()=>this.cancel());
  this.roomBadge.append(node('summary','','ROOM'),this.roomText,this.roomCode);this.roomCode.type='button';this.roomCode.setAttribute('aria-live','polite');this.roomCode.onclick=()=>void navigator.clipboard?.writeText(this.lastCode).then(()=>{this.roomCode.textContent='Copied';this.roomCode.dataset.copied='true';}).catch(()=>{this.roomCode.textContent=this.lastCode;this.roomCode.dataset.copied='false';});
  this.roomBadge.hidden=true;this.warning.hidden=true;this.warning.setAttribute('role','status');root.append(this.roomBadge,this.warning);
 }
 private button(label:string,action:()=>void){const b=node('button','btn',label);b.type='button';b.onclick=action;return b;}
 private option(key:'privacy'|'mapId'|'mode',value:string,label:string){const b=this.button(label,()=>{(this.setup[key] as string)=value;this.sync();});this.options.push({button:b,key,value});return b;}
 private sync(){for(const o of this.options){const selected=this.setup[o.key]===o.value;o.button.classList.toggle('selected',selected);o.button.setAttribute('aria-pressed',String(selected));}}
 private needClient(){if(!this.client)throw Error('Multiplayer configuration is unavailable.');return this.client;}
 cancel(){this.limit.cancel();this.request?.abort();this.request=null;this.refresh.disabled=false;this.mode.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);this.create.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);}
 open(message=''){this.cancel();this.privateDialog.close();this.show('modes');this.list.replaceChildren();this.status.textContent=message||'Select Public Servers to connect, or Practice to play offline.';}
 private openCreate(){this.cancel();this.setup={name:roomName(this.username()+"'s Server"),privacy:'public',mapId:'european-town',mode:'ffa',maxPlayers:6};this.name.value=this.setup.name;this.limit.setValue(ROOM_LIMITS.defaultPlayers);this.creationError.textContent='';this.sync();this.show('create-room');}
 private async load(message=''){
  this.cancel();const request=new AbortController();this.request=request;this.refresh.disabled=true;this.status.textContent=message||'Loading rooms...';this.list.replaceChildren();
  try{this.onOnline();const rooms=await this.needClient().list(request.signal);if(request.signal.aborted)return;this.status.textContent=message||(rooms.length?'':'None');
   for(const room of rooms){const b=this.button('',()=>void this.admit(signal=>this.needClient().join({roomId:room.id},signal),this.status));b.classList.add('room-row');b.append(node('span','',room.name),node('span','room-count',`${room.players}/${room.maxPlayers} players`));this.list.append(b);}
  }catch(error){if(!request.signal.aborted)this.status.textContent=(error as Error).message;}finally{if(this.request===request)this.refresh.disabled=false;}
 }
 private async admit(action:(signal:AbortSignal)=>Promise<RoomAdmission>,error:HTMLElement){
  this.cancel();const request=new AbortController();this.request=request;error.textContent='Connecting...';
  for(const page of [this.mode,this.create])page.querySelectorAll<HTMLButtonElement>('button').forEach(b=>{if(!['Back','Cancel','Practice'].includes(b.textContent??''))b.disabled=true;});
  try{this.onOnline();const admission=await action(request.signal);if(request.signal.aborted)return;this.privateDialog.close();this.onAdmission(admission);}catch(e){if(!request.signal.aborted)error.textContent=(e as Error).message;}finally{if(this.request===request){this.request=null;for(const page of [this.mode,this.create])page.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);}}
 }
 update(snapshot:Snapshot|null,selfId:string,now:number,visible:boolean){
  const room=snapshot?.roomInfo;this.roomBadge.hidden=!visible||!room;this.warning.hidden=true;
  if(!visible)return;
  if(room){this.roomText.textContent=`${room.name} \u00b7 ${MAPS.find(m=>m.id===room.mapId)?.name??room.mapId} \u00b7 ${room.mode.toUpperCase()} \u00b7 ${room.players}/${room.maxPlayers}${room.hostId===selfId?' \u00b7 HOST':''}`;
   if(this.lastCode!==(room.code??'')){this.lastCode=room.code??'';this.roomCode.textContent=room.code?`Copy Code: ${room.code}`:'';this.roomCode.dataset.copied='false';}this.roomCode.hidden=!room.code;
   if(room.warningAt!==null&&now>=room.warningAt&&room.closesAt!==null){this.warning.hidden=false;this.warning.textContent=`No other player has joined. This room closes in ${Math.max(0,Math.ceil((room.closesAt-now)/1000))}s unless someone joins.`;}
  }
  const player=snapshot?.players.find(p=>p.id===selfId),remaining=(player?.afkDeadline??Infinity)-now;
  if(player?.alive&&remaining<=ROOM_LIMITS.afkKickMs-ROOM_LIMITS.afkWarnMs){this.warning.hidden=false;this.warning.textContent=`You are inactive. Move or interact within ${Math.max(0,Math.ceil(remaining/1000))} seconds to avoid being kicked.`;}
 }
}
