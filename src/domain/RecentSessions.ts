export interface RecentSession {id:string;title:string;cwd:string;profile:string;}

/** Never discard another profile's history while publishing the current view. */
export function mergeRecent(previous:RecentSession[],current:RecentSession[]):RecentSession[]{
 const merged=new Map(previous.map(s=>[`${s.profile}\0${s.id}`,s]));
 for(const s of current)merged.set(`${s.profile}\0${s.id}`,s);
 return [...merged.values()];
}
