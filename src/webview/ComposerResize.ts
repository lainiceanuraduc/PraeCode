/**
 * The grab bar above the prompt: drag (or arrow-key) to resize the textarea, within the window.
 *
 * The height is remembered through the webview state so a reload does not snap the composer back;
 * it is a view preference, never a setting the host has to validate.
 */
import {element} from './dom';

const MIN_HEIGHT = 36;

export class ComposerResize {
 private height=0;
 private dragging=false;
 private startY=0;
 private startHeight=0;

 constructor(private state:{read():number|undefined;write(height:number):void}){
  const handle=element('composer-resize');
  const area=element<HTMLTextAreaElement>('message');
  const saved=state.read();
  if(typeof saved==='number'&&Number.isFinite(saved))this.apply(Math.round(saved));
  const move=(event:PointerEvent):void=>{
   if(!this.dragging)return;
   // Dragging up grows the prompt: the bar sits above the textarea.
   this.apply(this.startHeight-(event.clientY-this.startY));
   event.preventDefault();
  };
  const stop=():void=>{
   if(!this.dragging)return;
   this.dragging=false;handle.classList.remove('dragging');
   state.write(this.height);
  };
  handle.addEventListener('pointerdown',(event:PointerEvent)=>{
   this.dragging=true;this.startY=event.clientY;this.startHeight=area.getBoundingClientRect().height;
   handle.classList.add('dragging');
   handle.setPointerCapture?.(event.pointerId);
   event.preventDefault();
  });
  handle.addEventListener('pointermove',move);
  handle.addEventListener('pointerup',stop);
  handle.addEventListener('pointercancel',stop);
  handle.addEventListener('lostpointercapture',stop);
  handle.addEventListener('keydown',(event:KeyboardEvent)=>{
   const step=event.shiftKey?48:16;
   const current=area.getBoundingClientRect().height;
   if(event.key==='ArrowUp'||event.key==='ArrowDown'){
    event.preventDefault();
    this.apply(current+(event.key==='ArrowUp'?step:-step));
    state.write(this.height);
   }else if(event.key==='Home'){
    event.preventDefault();this.apply(MIN_HEIGHT);state.write(this.height);
   }
  });
 }

 /** Clamp into the window, then size the textarea; the CSS max-height stays as the outer guard. */
 private apply(px:number):void{
  const max=Math.max(120,Math.round(window.innerHeight*0.6));
  const height=Math.min(max,Math.max(MIN_HEIGHT,Math.round(px)));
  this.height=height;
  element<HTMLTextAreaElement>('message').style.height=`${height}px`;
  element('composer-resize').setAttribute('aria-valuenow',String(height));
 }
}
