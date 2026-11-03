import {element} from './dom';
import type {ChangeSummary} from '../domain/Changes';

/** Metadata-only list. Host IDs select snapshots; no file paths or contents authorize a write. */
export class ChangesView {
 constructor(private post:(message:any)=>void){
  element('clear-reviewed').onclick=()=>this.post({type:'clearReviewed'});
  // Open by itself when there is something to review, but never reopen after the user closes it.
  const panel=element<HTMLDetailsElement>('changes-panel');
  panel.addEventListener('toggle',()=>{panel.dataset.closed=panel.open?'':'1';});
 }
 render(rows:ChangeSummary[],notice:string,busy:boolean):void{
  const pending=rows.filter(r=>r.state==='ready'||r.state==='pending'||r.state==='unavailable').length;
  element('changes-heading').textContent=`Changes (${pending} to review · ${rows.length} saved)`;
  element('changes-notice').textContent=notice;
  const panel=element<HTMLDetailsElement>('changes-panel');
  if(!rows.length)panel.open=false;
  else if(pending&&panel.dataset.closed!=='1')panel.open=true;
  const list=element('changes-list');list.replaceChildren();
  if(!rows.length){const p=document.createElement('p');p.className='caption';p.textContent='No captured edits yet. This list starts recording new edits while PraeCode is connected.';list.append(p);}
  for(const row of rows){
   const item=document.createElement('article');item.className='change-card';
   const title=document.createElement('strong');title.textContent=row.path;title.title=row.path;
   const note=document.createElement('p');note.className='caption';note.textContent=`${row.state} · ${row.sessionId} · ${new Date(row.at).toLocaleString()} — ${row.note}`;
   const actions=document.createElement('div');actions.className='actions';
   const button=(label:string,type:string,disabled:boolean)=>{
    const b=document.createElement('button');b.type='button';b.className='quiet';b.textContent=label;b.disabled=disabled;
    b.onclick=()=>this.post({type,changeId:row.id});actions.append(b);
   };
   button('Review diff','reviewChange',!row.canReview);
   button('Keep','keepChange',!['ready','unavailable'].includes(row.state));
   button('Revert','revertChange',busy||row.state!=='ready');
   item.append(title,note,actions);list.append(item);
  }
  (element('clear-reviewed') as HTMLButtonElement).disabled=!rows.some(r=>r.state==='kept'||r.state==='reverted');
 }
}
