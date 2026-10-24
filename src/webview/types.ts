import type {AgentPreset} from '../domain/PresetRepository';
import type {ConversationSession} from '../application/SessionController';
import type {ActiveEditorContext} from '../domain/Attachments';

/** A file the composer will send; only the path crosses to the host. */
export interface AttachmentRef {path:string;name:string;line?:number;}

/** An image held in the webview until send time (base64, MIME sniffed again by the host). */
export interface PastedImage {id:string;name:string;mime:string;data:string;size:number;}

/** One approval request, mirroring what the host received from Hermes over ACP. */
export interface PermissionRequest {
 requestId:string;sessionId:string;sessionTitle:string;title:string;summary:string;tool:string;
 options:{optionId:string;kind:string;label:string;role:'allow'|'allow-all'|'deny'}[];
}

/** Context telemetry the host derives from the live `usage_update` stream or `session.info`. */
export interface ContextUsage {used:number|null;limit:number|null;messages:number;compactions:number;}

/** Everything `radcode.accent` / font settings resolve to. */
export interface Appearance {accent:string;fontSize:number;lineHeight:number;compact:boolean;}

/** Model facts the picker shows for the row currently selected there (read from Hermes by the host). */
export interface ModelDetailsView {
 provider:string;providerLabel:string;model:string;baseUrl:string;lab:string;
 context:number|null;contextSource:''|'provider'|'catalog';catalogName:string;
 capabilities:{values:string[];note:string};
}

/** One editable Hermes profile document in the Features tab. */
export interface ProfileFileView {id:string;title:string;description:string;path:string;content:string;exists:boolean;}

/** The state the host pushes on every change; the webview is a pure projection of it. */
export interface ViewState {
 sessions:ConversationSession[];activeId:string;presets:AgentPreset[];recent:any[];
 maxWorkers?:number;editor?:ActiveEditorContext;appearance?:Appearance;
}
