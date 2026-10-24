/**
 * @module ModelCatalog
 * Pure helpers behind the model-picker modal: ACP choice ids, provider grouping and favorites.
 *
 * ACP hands us one flat list of `provider:model` ids (see Hermes' `encode_model_choice`), so the two
 * lists the picker shows are derived here rather than requested again: grouping by provider must
 * agree with the id the session will accept, and a favorite is just an id that survived a reload.
 */

/** One row of ACP `availableModels`, as the session replies with it. */
export interface AcpModelRow {modelId:string;name?:string;description?:string;}
/** One model inside a provider group; `label` is the model alone, without its provider prefix. */
export interface ModelRow {id:string;label:string;provider:string;providerLabel:string;}
export interface ProviderGroup {slug:string;label:string;models:ModelRow[];}

/**
 * Split an ACP choice id into the provider Hermes will route to and the model it will send.
 *
 * Named endpoints use the `custom:<name>:<model>` shape, and an Ollama model id may carry its own
 * colon (`ollama-cloud:deepseek-v4.1-flash:1017`), so only the leading provider segment is removed.
 */
export function providerOf(modelId:string):{provider:string;model:string}{
 const id=String(modelId??'');
 const parts=id.split(':');
 if(parts.length<2)return {provider:'',model:id};
 if(parts[0]==='custom')return {provider:parts[1]?`custom:${parts[1]}`:'custom',model:parts.slice(2).join(':')};
 return {provider:parts[0],model:parts.slice(1).join(':')};
}

/** Provider label as Hermes described it on the row (`"Provider: Mistral"`), else the raw id. */
function labelOf(row:AcpModelRow,provider:string):string{
 const described=String(row?.description??'').match(/Provider:\s*([^\u2022]+)/i)?.[1]?.trim();
 if(described)return described;
 const name=String(row?.name??'');
 const head=name.split('\u00b7')[0].trim();
 if(head&&head!==name)return head;
 return provider||'Other';
}

/** Group the flat ACP list by provider; the active provider sorts first so it opens where you are. */
export function groupModels(models:AcpModelRow[],currentProvider=''):ProviderGroup[]{
 const byProvider=new Map<string,ProviderGroup>();
 for(const row of models??[]){
  const id=String(row?.modelId??'');
  if(!id)continue;
  const {provider,model}=providerOf(id);
  if(!model)continue;
  let group=byProvider.get(provider);
  if(!group){group={slug:provider,label:labelOf(row,provider),models:[]};byProvider.set(provider,group);}
  else if(group.label===provider)group.label=labelOf(row,provider);
  group.models.push({id,label:model,provider,providerLabel:group.label});
 }
 const groups=[...byProvider.values()];
 const at=currentProvider?groups.findIndex(g=>g.slug===currentProvider):-1;
 if(at>0)groups.unshift(...groups.splice(at,1));
 return groups;
}

/** Star in either list: add when absent, remove when present. Order is stable, duplicates collapse. */
export function toggleFavorite(favorites:string[],id:string):string[]{
 const clean=[...new Set((favorites??[]).filter(value=>typeof value==='string'&&value))];
 const at=clean.indexOf(id);
 if(at>=0)clean.splice(at,1);
 else clean.push(id);
 return clean;
}
