/**
 * Delegation facts shown in the Subagents tab.
 *
 * These describe what *Hermes* is doing with `delegate_task`, not what this extension's own worker
 * presets do: the policy that governs child runs (limits, model) plus every child run Hermes
 * persisted for this workspace. Formatting lives here as pure functions so the webview stays a
 * projection and the wording can be tested without a DOM.
 */

/** `delegation:` block of Hermes' config, limited to non-secret policy fields. */
export interface DelegationConfig {
 backend:string; model:string; provider:string;
 maxConcurrent:number; maxDepth:number; childTimeoutSeconds:number;
 orchestrator:boolean; oneshotMaxChildren:number;
}

/** One persisted child run (`source='subagent'`); times are epoch seconds as Hermes stores them. */
export interface DelegationRun {
 id:string; title:string; parentTitle:string; model:string;
 messages:number; tools:number;
 startedAt:number|null; lastActivityAt:number|null; endedAt:number|null;
 endReason:string;
}

export interface DelegationSnapshot {policy?:DelegationConfig; running:DelegationRun[]; recent:DelegationRun[];}

export type DelegationState='running'|'done'|'failed'|'cancelled';

/** Hermes ends a child normally with `agent_close`; anything else is worth surfacing as abnormal. */
export function runState(run:DelegationRun):DelegationState{
 if(!run.endedAt)return 'running';
 const reason=(run.endReason||'').toLowerCase();
 if(reason.includes('cancel'))return 'cancelled';
 if(reason.includes('error')||reason.includes('fail')||reason.includes('timeout'))return 'failed';
 return 'done';
}

/** `4m 12s`, `38s`, `2h 05m` — coarse on purpose: a run's exact length is not the point. */
export function describeDuration(seconds:number):string{
 if(!Number.isFinite(seconds)||seconds<0)return '';
 const total=Math.round(seconds);
 if(total<60)return `${total}s`;
 const minutes=Math.floor(total/60),s=total%60;
 if(minutes<60)return s?`${minutes}m ${String(s).padStart(2,'0')}s`:`${minutes}m`;
 const hours=Math.floor(minutes/60),m=minutes%60;
 return m?`${hours}h ${String(m).padStart(2,'0')}m`:`${hours}h`;
}

/** `just now`, `3m ago`, `2h ago` — relative to a clock the caller supplies, so tests are stable. */
export function describeAge(now:number,at:number|null):string{
 if(!at)return '';
 const elapsed=Math.max(0,Math.round(now-at));
 if(elapsed<5)return 'just now';
 if(elapsed<60)return `${elapsed}s ago`;
 const minutes=Math.round(elapsed/60);
 if(minutes<60)return `${minutes}m ago`;
 const hours=Math.round(minutes/60);
 if(hours<24)return `${hours}h ago`;
 return `${Math.round(hours/24)}d ago`;
}

/** Facts worth a chip: only what the policy actually sets, never an invented default. */
export function policyChips(policy:DelegationConfig|undefined):{label:string;value:string}[]{
 if(!policy)return [];
 const chips:{label:string;value:string}[]=[];
 if(policy.maxConcurrent>0)chips.push({label:'Concurrent children',value:String(policy.maxConcurrent)});
 if(policy.maxDepth>0)chips.push({label:'Spawn depth',value:String(policy.maxDepth)});
 chips.push({label:'Child timeout',value:policy.childTimeoutSeconds>0?describeDuration(policy.childTimeoutSeconds):'none'});
 chips.push({label:'Orchestrator',value:policy.orchestrator?'on':'off'});
 if(policy.oneshotMaxChildren>0)chips.push({label:'One-shot children',value:String(policy.oneshotMaxChildren)});
 const model=policy.model?(policy.provider?`${policy.provider} / ${policy.model}`:policy.model):'profile default';
 chips.push({label:'Child model',value:model});
 if(policy.backend)chips.push({label:'Backend',value:policy.backend});
 return chips;
}

/** One line above the lists: what is live right now, then the standing allowance. */
export function delegationHeadline(snapshot:DelegationSnapshot|undefined):string{
 if(!snapshot)return 'Delegation status unavailable';
 const running=snapshot.running.length;
 const limit=snapshot.policy?.maxConcurrent??0;
 const live=running===0?'No child run is active right now':`${running} child run${running===1?'':'s'} active now`;
 return limit>0?`${live} · Hermes allows ${limit} at once`:live;
}
