import {element} from './dom';
import {IMAGE_MIME, MAX_IMAGES, base64Bytes} from '../domain/Images';
import type {PastedImage} from './types';

/**
 * Pasted clipboard images. Only images the agent advertises image prompts for are accepted; the host
 * re-derives the real MIME type from the bytes and enforces size/count limits.
 */
export class PastedImages {
 private items:PastedImage[]=[];
 private seq=0;
 constructor(private post:(message:any)=>void,private allowed:()=>boolean){}
 list():PastedImage[]{return this.items.slice();}
 clear():void{this.items=[];this.render();}
 restore(items:PastedImage[]):void{this.items=items.slice();this.render();}
 /** Files from a clipboard paste or a drop, filtered to what a model can actually read. */
 addFiles(files:FileList|File[]):void{
  for(const file of Array.from(files)){
   if(!IMAGE_MIME[file.type]){this.post({type:'error',message:`${file.name||'That file'} is not a PNG, JPEG, WebP or GIF`});continue;}
   if(!this.allowed()){this.post({type:'error',message:'This session\'s agent does not accept images'});continue;}
   const reader=new FileReader();
   reader.onload=()=>this.add(String(reader.result??'').replace(/^data:[^,]*,/,''),file.type,file.name);
   reader.readAsDataURL(file);
  }
 }
 add(data:string,mime:string,name:string):void{
  if(this.items.length>=MAX_IMAGES){this.post({type:'error',message:`Attach at most ${MAX_IMAGES} images`});return;}
  this.seq++;
  this.items.push({id:`img-${this.seq}`,name:name||`pasted-${this.seq}.${IMAGE_MIME[mime]??'png'}`,mime,data,size:base64Bytes(data)});
  this.render();
 }
 private remove(id:string):void{this.items=this.items.filter(i=>i.id!==id);this.render();}
 private render():void{
  const list=element('image-list');list.replaceChildren();
  for(const image of this.items){
   const chip=document.createElement('li');chip.className='context-chip image-chip';
   const thumb=document.createElement('img');thumb.src=`data:${image.mime};base64,${image.data}`;
   thumb.alt='';thumb.className='image-thumb';
   const name=document.createElement('span');name.className='chip-label';
   name.textContent=`${image.name} · ${Math.max(1,Math.round(image.size/1024))} KB`;
   const remove=document.createElement('button');remove.type='button';remove.className='quiet chip-remove';
   remove.setAttribute('aria-label',`Remove ${image.name}`);remove.textContent='×';
   remove.onclick=()=>this.remove(image.id);
   chip.append(thumb,name,remove);list.append(chip);
  }
 }
}
