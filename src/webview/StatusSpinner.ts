/**
 * Spinner for the status line.
 *
 * One element, three states, driven entirely by `data-state` on the <span>:
 *   idle     — no spinner at all (the label reads "idle")
 *   running  — a dot that pulses between the accent colour and the muted foreground
 *   starting — a dot that slides left→right→left (a "busy" cue distinct from the pulse)
 * All animation lives in CSS; this class only owns the DOM.
 */
/** Webview-side: the status label's spinner lives next to the view that renders it. */
export class StatusSpinner {
 private el:HTMLSpanElement;
 constructor(parent:HTMLElement){
  this.el=document.createElement('span');
  this.el.className='status-spinner';
  this.el.setAttribute('data-state','idle');
  this.el.setAttribute('aria-live','polite');
  this.el.setAttribute('aria-label','Session status');
  // Three dots: the classic spinner, sized in CSS so themes can restyle it.
  for(let i=0;i<3;i++){
   const dot=document.createElement('i');
   dot.className='dot';
   this.el.append(dot);
  }
  parent.append(this.el);
 }
 /** "idle" | "running" | "starting" — styled purely in CSS via [data-state]. */
 set(state:'idle'|'running'|'starting'):void{
  this.el.dataset.state=state;
 }
}
