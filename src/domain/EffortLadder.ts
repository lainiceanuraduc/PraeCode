/** Canonical Hermes effort ladder and the same nearest-weaker clamp Hermes applies on the wire. */
export const EFFORT_LADDER = ['none','minimal','low','medium','high','xhigh','max'] as const;
export type Effort = typeof EFFORT_LADDER[number];

/** ``supported`` empty means "unknown": pass the request through rather than inventing a level. */
export function clampEffort(requested:string, supported:string[]):string {
 if(!requested||requested==='default'||!supported.length||supported.includes(requested))return requested;
 const candidates=supported.filter(v=>v!=='none');
 if(!candidates.length)return requested;
 const index=(v:string)=>EFFORT_LADDER.indexOf(v as Effort);
 const target=index(requested);
 if(target<0)return requested;
 const weaker=candidates.filter(v=>index(v)>=0&&index(v)<target);
 if(weaker.length)return weaker.sort((a,b)=>index(b)-index(a))[0];
 return candidates.sort((a,b)=>index(a)-index(b))[0];
}
