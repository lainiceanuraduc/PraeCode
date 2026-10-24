/**
 * The Features tab shows the Hermes profile itself, not a brochure about it: SOUL.md and the two
 * memory files, each editable in place with an explicit Save. Content arrives from the host, which
 * reads it from the profile directory; the webview never invents a path.
 */
import {element} from './dom';
import type {ProfileFileView} from './types';

export class FeaturesPanel {
 private files:ProfileFileView[]=[];
 private dirty=new Set<string>();
 constructor(private post:(message:any)=>void){}

 /** Rebuild the panel from a fresh host read; unsaved edits are never silently discarded. */
 setFiles(files:ProfileFileView[]):void{
  const drafts=new Map<string,string>();
  for(const area of document.querySelectorAll<HTMLTextAreaElement>('#profile-files textarea'))
   if(this.dirty.has(area.dataset.fileId??''))drafts.set(area.dataset.fileId??'',area.value);
  this.files=Array.isArray(files)?files:[];
  this.render(drafts);
 }

 /** The host confirmed a write: only that file stops being dirty. */
 saved(id:string,savedAt:string):void{
  this.dirty.delete(id);
  const card=document.querySelector<HTMLElement>(`#profile-files [data-file-id="${cssEscape(id)}"]`);
  const status=card?.querySelector<HTMLElement>('.profile-status');
  if(status)status.textContent=`Saved ${savedAt}`;
  const save=card?.querySelector<HTMLButtonElement>('.profile-save');
  if(save)save.disabled=true;
 }

 render(drafts=new Map<string,string>()):void{
  const host=element('profile-files');host.replaceChildren();
  if(!this.files.length){
   const p=document.createElement('p');p.className='caption';
   p.textContent='Reading the Hermes profile…';host.append(p);return;
  }
  for(const file of this.files)host.append(this.card(file,drafts.get(file.id)??file.content));
 }

 private card(file:ProfileFileView,value:string):HTMLElement{
  const card=document.createElement('section');card.className='profile-card';card.dataset.fileId=file.id;
  const head=document.createElement('div');head.className='profile-head';
  const title=document.createElement('h2');title.textContent=file.title;
  const status=document.createElement('span');status.className='caption profile-status';
  status.textContent=file.exists?'':'Not created yet — saving will create it';
  head.append(title,status);
  const description=document.createElement('p');description.className='caption';description.textContent=file.description;
  const path=document.createElement('p');path.className='caption profile-path';path.textContent=file.path;
  const label=document.createElement('label');label.className='sr-only';
  label.htmlFor=`profile-${file.id}`;label.textContent=`${file.title} contents`;
  const area=document.createElement('textarea');
  area.id=`profile-${file.id}`;area.dataset.fileId=file.id;area.rows=10;area.value=value;
  area.spellcheck=false;
  const save=document.createElement('button');save.type='button';save.className='profile-save';save.textContent='Save';
  save.disabled=true;
  area.oninput=()=>{
   const changed=area.value!==file.content;
   if(changed)this.dirty.add(file.id);else this.dirty.delete(file.id);
   save.disabled=!changed;
   status.textContent=changed?'Unsaved changes':(file.exists?'':'Not created yet — saving will create it');
  };
  save.onclick=()=>{
   save.disabled=true;status.textContent='Saving…';
   // The reply carries the file id, so a save that lands after the panel re-rendered still clears
   // the right card instead of whichever one is on screen.
   this.post({type:'saveProfile',id:file.id,text:area.value});
  };
  const actions=document.createElement('div');actions.className='actions';actions.append(save);
  card.append(head,description,path,label,area,actions);
  return card;
 }
}

/** `id` comes from the host's allowlist, but a selector still needs quoting. */
function cssEscape(value:string):string{
 return typeof CSS!=='undefined'&&CSS.escape?CSS.escape(value):value.replace(/[^\w-]/g,'\\$&');
}
