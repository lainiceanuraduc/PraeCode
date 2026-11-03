/** Review metadata only. File snapshots never enter the webview state. */
export type ChangeState='pending'|'ready'|'kept'|'reverted'|'unavailable';
export interface ChangeSummary {
 id:string;sessionId:string;path:string;at:number;state:ChangeState;note:string;canReview:boolean;
}
export interface ChangeRecord extends ChangeSummary {
 profile:string;cwd:string;toolCallId:string; before:string|null;after:string|null;
 verified:boolean;observed?:boolean;mode?:number;
}
