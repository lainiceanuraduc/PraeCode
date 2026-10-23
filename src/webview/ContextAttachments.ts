import {element} from './dom';
import {MAX_ATTACHMENTS, attachmentLabel} from '../domain/Attachments';
import type {ActiveEditorContext} from '../domain/Attachments';
import type {AttachmentRef} from './types';

/**
 * Context attachments: chips for what will be sent, plus a lightweight workspace file picker.
 * The webview only ever handles paths; the extension host reads the files at send time, so a file
 * edited between attaching and sending is sent in its current state.
 */
export class ContextAttachments {
 private items:AttachmentRef[]=[];
 constructor(private post:(message:any)=>void){
  element('context-toggle').onclick=()=>this.toggle();
  element('context-search').addEventListener('input',()=>this.filter());
  element<HTMLInputElement>('context-search').addEventListener('keydown',e=>{
   if(e.key==='Escape'){e.preventDefault();this.close();return;}
   if(e.key==='Enter'){
    e.preventDefault();
    const first=element('context-results').querySelector<HTMLElement>('[role=option]');
    if(first)this.add({path:first.dataset.path!,name:first.dataset.name!,line:first.dataset.line?Number(first.dataset.line):undefined});
   }
  });
  // The button now lives in the composer action grid while the menu stays in the context row,
  // so "inside" has to cover both — otherwise the opening click closes the menu again.
  document.addEventListener('click',e=>{if(!this.owns(e.target as Node))this.close();});
 }
 private root():HTMLElement{return element('context-row');}
 /** Everything whose clicks must not dismiss the file picker. */
 private owns(node:Node):boolean{
  for(const id of ['context-row','context-toggle','context-menu'])if(element(id).contains(node))return true;
  return false;
 }
 list():AttachmentRef[]{return this.items.slice();}
 clear():void{this.items=[];this.render();}
 /** The active editor is offered as context; the user still decides to include it. */
 syncEditor(editor:ActiveEditorContext|undefined):void{
  const chip=element('editor-chip');
  chip.hidden=!editor;
  if(!editor)return;
  const added=this.items.some(i=>i.path===editor.path);
  chip.textContent=added?`✓ ${editor.name} in context`:`＋ ${editor.name}:${editor.line}`;
  chip.dataset.path=editor.path;chip.dataset.name=editor.name;chip.dataset.line=String(editor.line);
  // Explicit verb: the control's whole point is that it reflects the editor the user is looking at.
  chip.title=added?'Included in the next message — click to remove':`Add the file you are editing (${editor.name}, line ${editor.line}) as context`;
  chip.onclick=()=>added?this.remove(editor.path):this.add({path:editor.path,name:editor.name,line:editor.line});
 }
 private toggle():void{
  const menu=element('context-menu');
  if(!menu.hidden){this.close();return;}
  if(this.items.length>=MAX_ATTACHMENTS){this.post({type:'error',message:`Attach at most ${MAX_ATTACHMENTS} files`});return;}
  menu.hidden=false;element('context-toggle').setAttribute('aria-expanded','true');
  const search=element<HTMLInputElement>('context-search');search.value='';search.focus();
  this.filter();
 }
 private close():void{
  element('context-menu').hidden=true;element('context-toggle').setAttribute('aria-expanded','false');
 }
 /** The host cannot list the workspace here (no Node), so it answers a typed filter with matches. */
 private filter():void{this.post({type:'files',query:element<HTMLInputElement>('context-search').value});}
 files(paths:{path:string;name:string}[],query:string):void{
  if(element('context-menu').hidden)return;
  const list=element('context-results');list.replaceChildren();
  const shown=paths.filter(p=>!this.items.some(i=>i.path===p.path)).slice(0,60);
  if(!shown.length){
   const empty=document.createElement('li');empty.className='caption';
   empty.textContent=paths.length?'Every match is already attached.':'No matching files.';
   list.append(empty);return;
  }
  for(const file of shown){
   const option=document.createElement('li');option.setAttribute('role','option');option.tabIndex=0;
   option.dataset.path=file.path;option.dataset.name=file.name;
   option.textContent=file.name;option.title=file.path;
   option.onclick=()=>this.add({path:file.path,name:file.name});
   option.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.add({path:file.path,name:file.name});}};
   list.append(option);
  }
 }
 add(item:AttachmentRef):void{
  if(this.items.some(i=>i.path===item.path)){this.close();return;}
  if(this.items.length>=MAX_ATTACHMENTS){this.post({type:'error',message:`Attach at most ${MAX_ATTACHMENTS} files`});return;}
  this.items.push(item);this.render();this.close();
 }
 private remove(path:string):void{this.items=this.items.filter(i=>i.path!==path);this.render();this.syncEditor(undefined);}
 private render():void{
  const list=element('context-list');list.replaceChildren();
  for(const item of this.items){
   const chip=document.createElement('li');chip.className='context-chip';
   const name=document.createElement('button');name.type='button';name.className='quiet chip-name';
   name.textContent=attachmentLabel(item);name.title=`${item.name} — click to open`;
   name.onclick=()=>this.post({type:'open',path:item.path});
   const remove=document.createElement('button');remove.type='button';remove.className='quiet chip-remove';
   remove.setAttribute('aria-label',`Remove ${attachmentLabel(item)}`);remove.textContent='×';
   remove.onclick=()=>this.remove(item.path);
   chip.append(name,remove);list.append(chip);
  }
 }
}
