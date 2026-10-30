/**
 * Adding a provider to Hermes from the editor.
 *
 * Hermes stores providers under the `providers:` block of `config.yaml`; an entry needs at least an
 * id and a base URL, and everything else is optional. The editor never writes that file itself — the
 * bridge does, through Hermes' own `save_config`, so schema defaults and unknown-key notices behave
 * exactly as `hermes config set` would. This module owns the *validation*, so a bad id or URL is
 * rejected before anything touches the user's configuration.
 */

/** A provider the user is adding; `apiKey` is a secret and is never echoed back. */
export interface ProviderDraft {
 id:string; label:string; baseUrl:string; apiKey:string; defaultModel:string;
}

/** What the bridge reports after writing the entry. */
export interface ProviderSaveResult {
 id:string; label:string; baseUrl:string; defaultModel:string; hasKey:boolean;
 /** Models the endpoint advertised when it was saved (empty when it could not be reached). */
 models:string[]; warning?:string;
}

/** Hermes' own provider-id shape: lowercase, no spaces, no path separators. */
const ID_PATTERN=/^[a-z0-9][a-z0-9._-]{0,39}$/;

/** Ids Hermes already uses for something else; reusing one would silently reconfigure it. */
const RESERVED=new Set(['custom','model','providers','default','openai','anthropic','mistral','openrouter']);

export interface ProviderDraftError { field:'id'|'label'|'baseUrl'|'apiKey'|'defaultModel'; message:string; }

/** Every problem with a draft, in field order; an empty list means it can be saved. */
export function providerDraftErrors(draft:ProviderDraft):ProviderDraftError[]{
 const errors:ProviderDraftError[]=[];
 const id=(draft.id||'').trim();
 if(!id)errors.push({field:'id',message:'Enter a provider id'});
 else if(!ID_PATTERN.test(id))errors.push({field:'id',message:'Use lowercase letters, digits, dots or hyphens (max 40)'});
 else if(RESERVED.has(id))errors.push({field:'id',message:`"${id}" is reserved by Hermes; pick another id`});

 const label=(draft.label||'').trim();
 if(label.length>60)errors.push({field:'label',message:'Keep the display name under 60 characters'});

 const url=(draft.baseUrl||'').trim();
 if(!url)errors.push({field:'baseUrl',message:'Enter the endpoint base URL'});
 else{
  let parsed:URL|undefined;
  try{parsed=new URL(url);}catch{parsed=undefined;}
  if(!parsed)errors.push({field:'baseUrl',message:'Enter a full URL, including http:// or https://'});
  // `new URL('localhost:11434')` parses with a `localhost:` protocol, so the scheme check covers both
  // "no scheme" and "wrong scheme" with one message instead of two confusing ones.
  else if(!['http:','https:'].includes(parsed.protocol))errors.push({field:'baseUrl',message:'Enter a full URL, including http:// or https://'});
  // A base URL is the API root, not a specific route: Hermes appends /chat/completions itself.
  else if(/\/(chat\/completions|completions|models)\/?$/.test(parsed.pathname))errors.push({field:'baseUrl',message:'Use the API root (…/v1), not a specific endpoint path'});
 }

 if((draft.apiKey||'').length>300)errors.push({field:'apiKey',message:'That key is too long'});
 if((draft.defaultModel||'').trim().length>200)errors.push({field:'defaultModel',message:'Keep the model id under 200 characters'});
 return errors;
}

/** The id as Hermes will store it: trimmed and lowercased, so the picker and config agree. */
export function normalizeProviderId(id:string):string{
 return (id||'').trim().toLowerCase();
}

/** A one-line summary for the picker note, never including the key. */
export function describeProvider(result:ProviderSaveResult):string{
 const models=result.models.length?` · ${result.models.length} model${result.models.length===1?'':'s'}`:'';
 const key=result.hasKey?' · key stored':' · no key';
 return `${result.label||result.id} → ${result.baseUrl}${key}${models}`;
}
