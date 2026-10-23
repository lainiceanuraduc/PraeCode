import DOMPurify from 'dompurify';
import {marked} from 'marked';
import {element} from './dom';
import {attachmentLabel} from '../domain/Attachments';
import type {ConversationSession, Message} from '../application/SessionController';

export class TranscriptView {
 private signatures=new Map<string,string>();
 private sessionId='';
 render(session:ConversationSession|undefined,thinking:boolean):void {
  const container=element('transcript');
  const sticky=container.scrollHeight-container.scrollTop-container.clientHeight<70;
  if(this.sessionId!==session?.id){container.replaceChildren();this.signatures.clear();this.sessionId=session?.id??'';}
  const messages=(session?.messages??[]).filter(m=>thinking||m.role!=='thinking');
  const visible=new Set(messages.map(m=>m.id));
  for(const child of Array.from(container.children))if(!visible.has((child as HTMLElement).dataset.id??'')){this.signatures.delete((child as HTMLElement).dataset.id??'');child.remove();}
  // Rebuild in the order the messages actually arrived, inserting each entry at its true position
  // in the DOM. Hermes replays history as individual chunks — a thinking block, then a tool call,
  // then another thinking block — and appending in that arrival order is what threw the reasoning
  // entries to the bottom of the transcript. `messages` is the session's truth; the DOM mirrors it.
  for(const message of messages){
   const signature=JSON.stringify(message);
   if(this.signatures.get(message.id)===signature)continue;
   const existing=Array.from(container.children).find(c=>(c as HTMLElement).dataset.id===message.id) as HTMLElement|undefined;
   const node=this.message(message,existing?.querySelector('details')?.open??false);
   if(existing)existing.replaceWith(node);
   else{
    // Insert before the next already-present message, so a late-arriving entry lands between its
    // real neighbours rather than at the end.
    const nextSibling=messages.slice(messages.indexOf(message)+1)
     .map(m=>Array.from(container.children).find(c=>(c as HTMLElement).dataset.id===m.id))
     .find(Boolean);
    container.insertBefore(node,nextSibling??null);
   }
   this.signatures.set(message.id,signature);
  }
  if(sticky)container.scrollTop=container.scrollHeight;
 }
 private message(m:Message,open:boolean):HTMLElement {
  const article=document.createElement('article');article.className=`message ${m.role}`;article.dataset.id=m.id;
  const label=document.createElement('div');label.className='message-label';
  label.textContent={user:'You',assistant:'Hermes',thinking:'Provider reasoning',tool:'Tool activity',notice:'Notice'}[m.role];
  // A time label on every entry: reasoning, tool activity, notices and replies keep their real
  // chronology visible even when a streaming turn interleaves them.
  const time=document.createElement('span');time.className='message-time';
  time.textContent=formatTime(m.at);
  time.title=new Date(m.at).toLocaleString();  // full date+time on hover
  label.append(time);
  label.title=new Date(m.at).toLocaleString();
  article.append(label);
  if(m.role==='thinking'||m.role==='tool'){
   const details=document.createElement('details');details.open=open;
   const summary=document.createElement('summary');summary.textContent=m.role==='thinking'?'Reasoning':`${m.title??'Tool'} · ${m.status??'pending'}`;
   const pre=document.createElement('pre');pre.textContent=m.text;details.append(summary,pre);article.append(details);
  }else{
   const body=document.createElement('div');body.className='body';
   if(m.role==='assistant')body.innerHTML=DOMPurify.sanitize(marked.parse(m.text,{async:false}) as string,{FORBID_TAGS:['img','svg','math','style','form','input','button','iframe','video','audio'],FORBID_ATTR:['style'],ALLOW_DATA_ATTR:false});
   else body.textContent=m.text;
   article.append(body);
   if(m.attachments?.length){
    const files=document.createElement('ul');files.className='message-files';
    for(const f of m.attachments){
     const item=document.createElement('li');item.textContent=attachmentLabel(f);
     item.title=`${f.name} · ${Math.max(1,Math.round(f.size/1024))} KB`;files.append(item);
    }
    article.append(files);
   }
  }
  return article;
 }
}

/** Clock time for a message stamp; `--:--` when the host did not send one (older builds). */
function formatTime(at?:number):string{
 if(!at)return '--:--';
 const date=new Date(at);
 return Number.isFinite(date.getTime())
  ?date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
  :'--:--';
}
