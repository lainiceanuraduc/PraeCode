import {element} from './dom';
import type {PermissionRequest} from './types';

/**
 * Approvals live in the chat view, never in a modal: a tool request can carry a diff far larger than
 * an editor window, and a modal that big is unusable. The card shows a bounded summary with every
 * option Hermes offered (Allow / Allow for session / Allow always / Deny); "Details" opens the full
 * payload as a scrollable read-only document in the editor.
 */
export class ApprovalCards {
 private requests:PermissionRequest[]=[];
 constructor(private post:(message:any)=>void){}
 add(request:PermissionRequest):void{
  if(this.requests.some(r=>r.requestId===request.requestId))return;
  this.requests.push(request);this.render();
 }
 settle(requestId:string):void{this.requests=this.requests.filter(r=>r.requestId!==requestId);this.render();}
 private render():void{
  const host=element('permissions');host.replaceChildren();
  host.hidden=!this.requests.length;
  for(const request of this.requests)host.append(this.card(request));
 }
 private card(request:PermissionRequest):HTMLElement{
  const card=document.createElement('article');card.className='permission-card';card.dataset.requestId=request.requestId;
  const head=document.createElement('div');head.className='permission-head';
  const label=document.createElement('span');label.className='message-label';label.textContent='Approval needed';
  const session=document.createElement('span');session.className='caption';session.textContent=request.sessionTitle;
  head.append(label,session);
  const title=document.createElement('h2');title.textContent=request.title;
  const summary=document.createElement('pre');summary.className='permission-summary';summary.textContent=request.summary;
  const actions=document.createElement('div');actions.className='actions';
  const details=document.createElement('button');details.type='button';details.className='quiet';
  details.textContent='Details…';details.title='Open the full request in an editor tab';
  details.onclick=()=>this.post({type:'permissionDetails',requestId:request.requestId});
  actions.append(details);
  // Group the positive options so "allow" and "allow all" are distinguishable at a glance.
  const allowAll=request.options.filter(o=>o.role==='allow-all');
  const allow=request.options.filter(o=>o.role==='allow');
  const deny=request.options.filter(o=>o.role==='deny');
  for(const option of allowAll)actions.append(this.button(option.label,option,'secondary'));
  for(const option of allow)actions.append(this.button(option.label,option,''));
  for(const option of deny)actions.append(this.button(option.label,option,'secondary danger'));
  card.append(head,title,summary,actions);
  if(request.tool){const meta=document.createElement('p');meta.className='caption';meta.textContent=`Tool: ${request.tool}`;card.append(meta);}
  return card;
 }
 private button(text:string,option:{optionId:string},className:string):HTMLButtonElement{
  const b=document.createElement('button');b.type='button';b.className=className;b.textContent=text;
  b.onclick=()=>this.post({type:'permission',requestId:(b.closest('.permission-card') as HTMLElement).dataset.requestId,optionId:option.optionId});
  return b;
 }
}
