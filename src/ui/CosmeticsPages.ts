import { COSMETICS, COLLECTIONS, CATEGORY_NAMES, WEAPON_CATEGORIES, RARITIES, CRATE, cosmetic, crateItems, collectionCosmetic, type CosmeticDefinition, type InventoryView } from '../../shared/cosmetics';
import { CrateReveal } from './CrateReveal';
import type { WeaponId } from '../weapons/Weapon';
import type { CosmeticsClient } from '../network/CosmeticsClient';
import { assetUrl } from '../core/assets';
import { CosmeticPreview } from './CosmeticPreview';
import { cosmeticThumbnails } from './WeaponPreviews';
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
export class CosmeticsPages {
  client:CosmeticsClient|null=null;
  onRefreshAccount:()=>void=()=>{};
  private readonly grid=node('div','cosmetic-grid');private readonly equipped=node('aside','cosmetic-equipped');
  private readonly status=node('p','cosmetic-status');private readonly balance=node('strong','shop-balance','— GEMS');
  private readonly previewHost=node('div','cosmetic-model');private readonly previewTitle=node('h1');private readonly previewCategory=node('p');
  private readonly equipButton=node('button','btn primary','EQUIP');private readonly previewStatus=node('p','cosmetic-status');
  private readonly preview=new CosmeticPreview();private request:AbortController|null=null;private thumbnails:AbortController|null=null;private thumbnailIds=new Set<string>();
  private category:WeaponId|'all'='all';private inventory:InventoryView|null=null;private item:CosmeticDefinition|null=null;
  private images=new Map<string,string>();private selected='';private pending=false;private buttons:HTMLButtonElement[]=[];
  private previewScreen:HTMLElement;
  private readonly openButton=node('button','btn primary shop-open');private readonly shopStatus=node('p','cosmetic-status');
  private readonly contents=node('section','crate-contents');private readonly reveal=new CrateReveal();private gems:number|null=null;
  constructor(screen:(id:'shop'|'locker'|'cosmetic-preview')=>HTMLElement,navigate:(id:'menu'|'locker')=>void){
    const shop=screen('shop'),locker=screen('locker');this.previewScreen=screen('cosmetic-preview');
    for(const page of [shop,locker]){page.classList.add('cosmetic-page');const bg=node('img','cosmetic-background');bg.src=assetUrl('assets/ui/town-plaza.webp');bg.alt='';page.append(bg);}
    const heading=node('header','cosmetic-heading');heading.append(node('h1','','LOCKER'),this.button('Back',()=>navigate('menu')));
    const layout=node('div','locker-layout'),categories=node('nav','cosmetic-categories');categories.setAttribute('aria-label','Weapon categories');
    for(const category of ['all',...['smg','rifle','sniper','shotgun'] as WeaponId[]] as const){const b=this.button(category==='all'?'ALL':CATEGORY_NAMES[category],()=>{this.category=category;this.render();});b.dataset.category=category;this.buttons.push(b);categories.append(b);}
    const inventory=node('section','cosmetic-inventory');this.status.setAttribute('role','status');const retry=this.button('Refresh',()=>this.load());retry.classList.add('cosmetic-refresh');inventory.append(this.status,this.grid,retry);layout.append(categories,inventory,this.equipped);locker.append(heading,layout);
    const shopHeading=node('header','cosmetic-heading');shopHeading.append(node('h1','','SHOP'),this.balance,this.button('Back',()=>navigate('menu')));
    const content=node('div','shop-content'),stage=node('div','shop-crate-stage'),crate=node('img','shop-crate');crate.src=assetUrl('assets/cosmetics/crate/reward-crate/thumbnail.png');crate.alt='Crossfire reward crate';stage.append(crate);
    const offer=node('section','shop-offer');this.openButton.type='button';this.openButton.onclick=()=>this.openCrate();this.shopStatus.setAttribute('role','status');
    offer.append(node('h2','','REWARD CRATE'),node('p','shop-offer-copy','One weapon skin per crate. You never get a duplicate.'),this.openButton,this.shopStatus);
    const distribution=node('section','crate-distribution');distribution.setAttribute('aria-label','Crate odds');distribution.append(node('p','','ODDS'));
    for(const entry of CRATE.distribution){const label=node('span','',`${RARITIES[entry.rarity].name.toUpperCase()} — ${entry.percent}%`);label.style.color=RARITIES[entry.rarity].color;distribution.append(label);}
    this.contents.setAttribute('aria-label','Crate contents');offer.append(distribution);content.append(stage,offer,this.contents);shop.append(shopHeading,content);
    this.previewScreen.classList.add('cosmetic-item-preview');this.previewTitle.id='cosmetic-name';this.previewScreen.setAttribute('aria-labelledby','cosmetic-name');
    const title=node('header');title.append(this.previewTitle,this.previewCategory);const controls=node('footer');this.equipButton.type='button';this.equipButton.onclick=()=>void this.equip();controls.append(this.equipButton,this.button('Back',()=>navigate('locker')));this.previewStatus.setAttribute('role','status');this.previewScreen.append(title,this.previewHost,this.previewStatus,controls);
    this.previewScreen.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();navigate('locker');}});
  }
  private button(text:string,click:()=>void){const b=node('button','btn',text);b.type='button';b.onclick=click;return b;}
  setBalance(gems:number|null){this.gems=gems;this.balance.textContent=gems===null?'— GEMS':`${gems.toLocaleString()} GEMS`;this.renderShop();}
  private canOpen(){return !!this.client&&this.gems!==null&&this.gems>=CRATE.price&&!!this.inventory&&crateItems().some(c=>!this.inventory!.owned.includes(c.id));}
  private renderShop(){
    const left=this.inventory?crateItems().filter(c=>!this.inventory!.owned.includes(c.id)).length:null;
    this.openButton.textContent=left===0?'ALL SKINS OWNED':`OPEN — ${CRATE.price} GEMS`;this.openButton.disabled=!this.canOpen();
    this.openButton.title=this.openButton.disabled&&left!==0?'Earn gems from daily and weekly challenges.':'';
    this.contents.replaceChildren(node('h3','','CRATE CONTENTS'));
    for(const c of COLLECTIONS){
      const owned=WEAPON_CATEGORIES.filter(w=>this.inventory?.owned.includes(collectionCosmetic(c.id,w))).length;
      const row=node('div','crate-collection');row.dataset.collection=c.id;row.style.setProperty('--rarity',RARITIES[c.rarity].color);
      row.append(node('strong','',c.name),node('small','',RARITIES[c.rarity].name.toUpperCase()),node('span','',this.inventory?`${owned}/4`:'AR · SMG · SNIPER · SHOTGUN'));this.contents.append(row);
    }
  }
  private openCrate(){
    if(!this.canOpen()||!this.client)return;const client=this.client;
    void this.reveal.start({
      open:async signal=>{const result=await client.openCrate(signal);this.inventory=result.inventory;this.setBalance(result.gems);this.onRefreshAccount();return cosmetic(result.item)!;},
      equip:async item=>{this.inventory=await client.equip(item.id,new AbortController().signal);},
      isEquipped:item=>this.inventory?.equipped[item.weapon]===item.id,
      canOpenAgain:()=>this.canOpen(),
      onClose:()=>{this.renderShop();this.openButton.focus();},
    });
  }
  show(page:'shop'|'locker'|'cosmetic-preview'){
    this.request?.abort();this.thumbnails?.abort();this.thumbnails=null;
    if(page==='cosmetic-preview')return;
    this.onRefreshAccount();
    this.preview.close();this.item=null;this.selected=page;this.inventory=this.client?.view??this.inventory;if(page==='locker')this.render();this.renderShop();this.load();
  }
  hide(){this.reveal.close();this.selected='';this.request?.abort();this.request=null;this.thumbnails?.abort();this.thumbnails=null;this.preview.close();this.item=null;}
  private load(){
    this.request?.abort();const request=new AbortController();this.request=request;this.status.textContent='Loading inventory...';
    void (async()=>{if(!this.client)throw Error('Inventory unavailable: check multiplayer configuration.');const view=await this.client.load(request.signal);if(request.signal.aborted||!this.selected)return;this.inventory=view;this.status.textContent='';this.shopStatus.textContent='';if(this.selected==='locker')this.render();this.renderShop();})().catch(error=>{if(!request.signal.aborted)this.status.textContent=this.shopStatus.textContent=(error as Error).message;});
  }
  private thumbnail(item:CosmeticDefinition){const img=node('img','cosmetic-thumbnail');img.alt=`${CATEGORY_NAMES[item.weapon]} ${item.name}`;img.dataset.cosmetic=item.id;const url=item.preview?assetUrl(item.preview):this.images.get(item.id);if(url)img.src=url;else img.hidden=true;return img;}
  private render(){
    for(const b of this.buttons){const active=b.dataset.category===this.category;b.setAttribute('aria-pressed',String(active));}
    this.grid.replaceChildren();this.equipped.replaceChildren(node('h2','','EQUIPPED'));
    if(!this.inventory)return;
    const owned=COSMETICS.filter(c=>this.inventory!.owned.includes(c.id));
    for(const item of owned.filter(c=>this.category==='all'||c.weapon===this.category)){
      const card=this.button('',()=>void this.open(item));card.classList.add('cosmetic-card');card.dataset.cosmetic=item.id;card.style.setProperty('--rarity',RARITIES[item.rarity].color);card.append(this.thumbnail(item),node('strong','',item.name),node('span','',CATEGORY_NAMES[item.weapon]),node('small','',RARITIES[item.rarity].name));
      if(this.inventory.equipped[item.weapon]===item.id)card.append(node('small','cosmetic-is-equipped','EQUIPPED'));this.grid.append(card);
    }
    for(const weapon of WEAPON_CATEGORIES){const item=cosmetic(this.inventory.equipped[weapon])!;const row=this.button('',()=>void this.open(item));row.classList.add('equipped-item');row.dataset.weapon=weapon;row.append(this.thumbnail(item),node('span','',`${CATEGORY_NAMES[weapon]} — ${item.name}`));this.equipped.append(row);}
    // A running job keeps going unless the inventory gained items it does not cover (for
    // example a grant from another tab); cached snapshots make a restart cheap.
    const wanted=owned.filter(c=>!c.preview);
    if(this.thumbnails&&!this.thumbnails.signal.aborted&&wanted.every(c=>this.thumbnailIds.has(c.id)))return;
    this.thumbnails?.abort();const request=new AbortController();this.thumbnails=request;this.thumbnailIds=new Set(wanted.map(c=>c.id));
    void cosmeticThumbnails(wanted,async(item,url)=>{
      this.images.set(item.id,url);if(request.signal.aborted)return;
      for(const root of [this.grid,this.equipped])for(const img of root.querySelectorAll<HTMLImageElement>('img'))if(img.dataset.cosmetic===item.id){img.src=url;img.hidden=false;}
    },request.signal).catch(error=>{if(!request.signal.aborted)this.status.textContent='Weapon thumbnails unavailable. Open an item to retry its model. '+(error as Error).message;}).finally(()=>{if(this.thumbnails===request)this.thumbnails=null;});
  }
  private async open(item:CosmeticDefinition){
    if(!this.inventory?.owned.includes(item.id))return;this.item=item;this.selected='cosmetic-preview';
    // Navigation is delegated by UI so all other screens, requests and home previews close.
    this.onPreview();this.previewTitle.textContent=item.name;this.previewTitle.style.color=RARITIES[item.rarity].color;this.previewCategory.textContent=`${CATEGORY_NAMES[item.weapon]} · ${RARITIES[item.rarity].name}`;this.previewScreen.style.setProperty('--rarity-background',RARITIES[item.rarity].background);
    this.previewStatus.textContent='Loading model...';this.updateEquip();
    try{await this.preview.open(this.previewHost,item);if(this.item===item)this.previewStatus.textContent='';}catch(error){if(this.item===item)this.previewStatus.textContent=(error as Error).message;}
  }
  onPreview:()=>void=()=>{};
  private updateEquip(){const equipped=!!this.item&&this.inventory?.equipped[this.item.weapon]===this.item.id;this.equipButton.textContent=this.pending?'SAVING...':equipped?'EQUIPPED':'EQUIP';this.equipButton.disabled=this.pending||equipped||!this.item||!this.inventory?.owned.includes(this.item.id);}
  private async equip(){
    const item=this.item;if(!item||!this.inventory?.owned.includes(item.id)||!this.client||this.pending)return;
    this.pending=true;this.updateEquip();this.request?.abort();const request=new AbortController();this.request=request;
    try{this.inventory=await this.client.equip(item.id,request.signal);if(!request.signal.aborted)this.previewStatus.textContent='';}catch(error){if(!request.signal.aborted)this.previewStatus.textContent=(error as Error).message;}finally{this.pending=false;this.updateEquip();}
  }
  inspect(){return {inventory:this.inventory,preview:this.preview.inspect(),reveal:this.reveal.inspect()};}
  revealDebug(paused:boolean,seek?:number){this.reveal.debug(paused,seek);}
}
