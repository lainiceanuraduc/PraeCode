import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:430,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.sent=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.sent.push(m),getState:()=>({}),setState:()=>{}});});
 await page.route('http://radcode.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1)||'media/view.html';
  let body=await fs.readFile(path.resolve(name));
  if(name.endsWith('.html'))body=Buffer.from(body.toString().replaceAll('{{cspSource}}','http://radcode.test').replaceAll('{{nonce}}','testnonce').replaceAll('{{styleUri}}','http://radcode.test/media/style.css').replaceAll('{{scriptUri}}','http://radcode.test/dist/webview.js'));
  await route.fulfill({body,contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':name.endsWith('.ttf')?'font/ttf':'text/javascript'});
 });
 await page.goto('http://radcode.test/');
 await page.getByRole('button',{name:'Connect to Hermes',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.sent.at(-1).type),'new');
 await page.evaluate(()=>window.postMessage({type:'state',sessions:[{id:'s',title:'Test conversation',kind:'chat',status:'idle',messages:[{id:'m',role:'assistant',text:'Hello **world** <img src=x onerror="window.pwned=1">'}],info:{model:'test-model',provider:'test',effort:'high',capabilities:{values:['none','low','high','xhigh'],note:'Test capability fixture'}}}],activeId:'s',presets:[],recent:[],editor:{path:'/w/src/app.ts',name:'src/app.ts',line:12},appearance:{accent:'lime',fontFamily:'monospace',fontSize:13,lineHeight:0,compact:false}},'*'));
 await page.waitForTimeout(50);
 // Context-aware attachments: the active editor is offered, picking files sends only paths.
 assert.equal(await page.locator('#editor-chip').textContent(),'＋ src/app.ts:12');
 assert.equal(await page.locator('#editor-chip').isVisible(),true,'the active editor is offered as context');
 await page.locator('#editor-chip').click();
 assert.equal(await page.locator('#context-list .context-chip').count(),1);
 await page.getByRole('button',{name:'+ Context'}).click();
 await page.evaluate(()=>window.postMessage({type:'files',paths:[{path:'/w/src/b.ts',name:'src/b.ts'},{path:'/w/src/app.ts',name:'src/app.ts'}],query:''},'*'));
 await page.locator('#context-results li[role=option]').first().waitFor();
 assert.equal(await page.locator('#context-results li[role=option]').count(),1,'already attached files are filtered out');
 await page.locator('#context-results li[role=option]').click();
 assert.equal(await page.locator('#context-list .context-chip').count(),2);
 await page.locator('#context-list .context-chip').last().getByRole('button',{name:/Remove/}).click();
 assert.equal(await page.locator('#context-list .context-chip').count(),1);
 await page.getByLabel('Thinking effort').selectOption('none');
 assert.equal(await page.evaluate(()=>window.sent.at(-1).value),'none');
 assert.equal(await page.locator('#transcript strong').textContent(),'world');
 assert.equal(await page.evaluate(()=>window.pwned),undefined);
 assert.equal(await page.locator('#transcript img').count(),0);
 // Rename: inline input beside the picker, Enter commits, Escape cancels.
 await page.getByRole('button',{name:'Rename this conversation'}).click();
 assert.equal(await page.getByLabel('Conversation name').inputValue(),'Test conversation','prefilled with the current name');
 await page.getByLabel('Conversation name').fill('Escape me');
 await page.getByLabel('Conversation name').press('Escape');
 assert.equal(await page.evaluate(()=>window.sent.some(m=>m.type==='rename')),false,'Escape never sends');
 assert.equal(await page.locator('#sessions').isVisible(),true,'the picker comes back');
 await page.getByRole('button',{name:'Rename this conversation'}).click();
 await page.getByLabel('Conversation name').fill('Ladder debugging');
 await page.getByLabel('Conversation name').press('Enter');
 await page.waitForTimeout(50);
 assert.deepEqual(await page.evaluate(()=>{const m=window.sent.at(-1);return {type:m.type,title:m.title};}),{type:'rename',title:'Ladder debugging'});
 assert.equal(await page.locator('#sessions option:checked').textContent(),'Ladder debugging','the picker shows the new name immediately');
 // The approval-mode dropdown is a real control, populated from ACP modes.
 await page.evaluate(()=>window.postMessage({type:'state',sessions:[{id:'s',title:'Test conversation',kind:'chat',status:'idle',messages:[],info:{model:'test-model',provider:'test',effort:'high',capabilities:{values:['none','low','high','xhigh'],note:'n'}},modes:{current:'default',available:[{id:'default',name:'Default',description:'Ask before edits.'},{id:'accept_edits',name:'Accept Edits'},{id:'dont_ask',name:"Don't Ask"}]}}],activeId:'s',presets:[],recent:[],appearance:{accent:'lime',fontFamily:'monospace',fontSize:13,lineHeight:0,compact:false}},'*'));
 await page.locator('#mode:not([hidden])').waitFor();
 assert.equal(await page.getByLabel('Approval mode').inputValue(),'default','shows the current mode');
 await page.getByLabel('Approval mode').selectOption('accept_edits');
 assert.deepEqual(await page.evaluate(()=>{const m=window.sent.at(-1);return {type:m.type,value:m.value};}),{type:'mode',value:'accept_edits'});
 // Approval card lives in the chat view (buttons visible), with all four Hermes options.
 await page.evaluate(()=>window.postMessage({type:'permission',requestId:'r1',sessionId:'s',sessionTitle:'Test conversation',
  title:'Run: rm -rf build',summary:'rm -rf build\nKind: execute',tool:'execute',
  options:[{optionId:'allow_once',kind:'allow_once',label:'Allow once',role:'allow'},
           {optionId:'allow_session',kind:'allow_always',label:'Allow for session',role:'allow-all'},
           {optionId:'allow_always',kind:'allow_always',label:'Allow always',role:'allow-all'},
           {optionId:'deny',kind:'reject_once',label:'Deny',role:'deny'}]},'*'));
 await page.locator('.permission-card').waitFor();
 assert.equal(await page.getByRole('button',{name:'Allow once'}).isVisible(),true,'accept is in the view, not a modal');
 assert.equal(await page.getByRole('button',{name:'Allow for session'}).isVisible(),true,'accept-all is offered');
 assert.equal(await page.getByRole('button',{name:'Deny'}).isVisible(),true);
 await page.getByRole('button',{name:'Details…'}).click();
 assert.deepEqual(await page.evaluate(()=>{const m=window.sent.at(-1);return {type:m.type,requestId:m.requestId};}),{type:'permissionDetails',requestId:'r1'});
 await page.getByRole('button',{name:'Allow for session'}).click();
 assert.deepEqual(await page.evaluate(()=>{const m=window.sent.at(-1);return {type:m.type,optionId:m.optionId};}),{type:'permission',optionId:'allow_session'});
 await page.evaluate(()=>window.postMessage({type:'permissionSettled',requestId:'r1'},'*'));
 await page.waitForTimeout(50);
 assert.equal(await page.locator('.permission-card').count(),0,'the card disappears once settled');
 // Context meter renders real numbers, and degrades honestly when it has none.
 await page.evaluate(()=>window.postMessage({type:'state',sessions:[{id:'s',title:'Test conversation',kind:'chat',status:'idle',messages:[],info:{model:'m',provider:'p',effort:'high',capabilities:{values:['high'],note:'n'},messages:12,context:{used:50000,limit:200000,messages:12,compactions:1}},modes:{current:'default',available:[{id:'default',name:'Default',description:'Ask before edits.'},{id:'accept_edits',name:'Accept Edits'},{id:'dont_ask',name:"Don't Ask"}]}}],activeId:'s',presets:[],recent:[],appearance:{accent:'lime',fontFamily:'monospace',fontSize:13,lineHeight:0,compact:false}},'*'));
 await page.locator('#context-meter:not([hidden])').waitFor();
 assert.match(await page.locator('#context-text').textContent(),/25% of 200k · 12 msgs · 1× compacted/);
// Before the first turn Hermes publishes no occupancy, but the model catalog knows the window: the
// meter must still say something true instead of hiding.
await page.evaluate(()=>window.postMessage({type:'state',sessions:[{id:'s',title:'Test conversation',kind:'chat',status:'idle',
 messages:[],info:{model:'m',provider:'p',effort:'high',capabilities:{values:['high'],note:'n'},
 context:{used:null,limit:209000,messages:0,compactions:0,source:'catalog'}},
 modes:{current:'default',available:[{id:'default',name:'Default',description:'Ask before edits.'},{id:'accept_edits',name:'Accept Edits'},{id:'dont_ask',name:"Don't Ask"}]}}],
 activeId:'s',presets:[],recent:[],appearance:{accent:'lime',fontSize:10,lineHeight:0,compact:false}},'*'));
await page.locator('#context-meter:not([hidden])').waitFor();
assert.match(await page.locator('#context-text').textContent(),/209k window/,'the window shows before any turn');
assert.doesNotMatch(await page.locator('#context-text').textContent(),/%/,'no percentage is invented from a missing occupancy');
 await page.getByRole('tab',{name:'Subagents'}).click();
 await page.getByRole('button',{name:'New preset',exact:true}).click();
 await page.getByLabel('Agent name').fill('Reviewer');
 await page.getByLabel('Instructions').fill('Read only. Report bugs.');
 await page.getByRole('button',{name:'Save preset',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.sent.at(-1).type),'savePreset');
// The tab also reports what Hermes itself is delegating: policy, live children, finished runs.
const nowSec=Date.now()/1000;
await page.evaluate(now=>window.postMessage({type:'subagents',
 policy:{backend:'default',model:'zai-glm-5-3',provider:'mistral',maxConcurrent:10,maxDepth:1,
         childTimeoutSeconds:0,orchestrator:true,oneshotMaxChildren:2},
 running:[{id:'r1',title:'Subagent: fix clone navigation',parentTitle:'Wave Pulse',model:'gpt-6-astra',
           messages:12,tools:7,startedAt:now-90,lastActivityAt:now,endedAt:null,endReason:''}],
 recent:[{id:'r2',title:'Subagent: Blender textures',parentTitle:'Wave Pulse',model:'mistral-large-4',
          messages:62,tools:34,startedAt:now-900,lastActivityAt:now-400,endedAt:now-390,endReason:'agent_close'}]},'*'),nowSec);
await page.locator('#delegation-running .run-card').first().waitFor();
assert.match(await page.locator('#delegation-headline').textContent(),/1 child run active now · Hermes allows 10 at once/);
assert.ok(await page.locator('#delegation-policy .policy-chip').count()>=6,'policy chips describe the delegation limits');
assert.match(await page.locator('#delegation-running .run-card').first().textContent(),/running/);
assert.match(await page.locator('#delegation-running .run-card').first().textContent(),/12 msgs · 7 tools/);
assert.match(await page.locator('#delegation-recent .run-card').first().textContent(),/done/);
assert.match(await page.locator('#delegation-recent .run-card').first().textContent(),/62 msgs · 34 tools/);
await page.evaluate(()=>{document.getElementById('agents').scrollTop=0;});
await page.locator('#agents').screenshot({path:'docs/_subagents.png'});
await page.locator('#refresh-subagents').click();
assert.equal(await page.evaluate(()=>window.sent.at(-1).type),'subagents','Refresh asks Hermes again');
 await page.getByRole('tab',{name:'Chat',exact:true}).click();
 await page.getByLabel('Message Hermes').fill('Hello from keyboard');
 await page.getByLabel('Message Hermes').press('Control+Enter');
 assert.equal(await page.evaluate(()=>window.sent.at(-1).type),'send');
 assert.deepEqual(await page.evaluate(()=>window.sent.at(-1).attachments),[{path:'/w/src/app.ts',name:'src/app.ts',line:12}],'only paths travel; the host reads the files');
 assert.equal(await page.locator('#context-list .context-chip').count(),0,'attachments clear with the composer');
 // Composer clears on submit, and a rejected admission puts the same draft back.
 assert.equal(await page.getByLabel('Message Hermes').inputValue(),'');
 // The page dispatches message events asynchronously; wait for the view to react before asserting.
 // A rejected send carries the text back; an error without a draft (e.g. a command failure) never does.
 await page.evaluate(()=>window.postMessage({type:'error',message:'Session not found'},'*'));
 await page.locator('#error:not([hidden])').waitFor();
 assert.equal(await page.getByLabel('Message Hermes').inputValue(),'');
 await page.getByLabel('Dismiss error').click();
 await page.evaluate(()=>window.postMessage({type:'error',message:'Session not found',draft:'Hello from keyboard'},'*'));
 await page.locator('#error:not([hidden])').waitFor();
 assert.equal(await page.getByLabel('Message Hermes').inputValue(),'Hello from keyboard');
 assert.equal(await page.locator('#context-list .context-chip').count(),1,'a rejected send restores its attachments');
 await page.getByLabel('Message Hermes').fill('typed while failing');
 await page.evaluate(()=>window.postMessage({type:'error',message:'Session not found',draft:'stale draft'},'*'));
 await page.waitForTimeout(100);
 assert.equal(await page.getByLabel('Message Hermes').inputValue(),'typed while failing','a newer draft is never overwritten');
 // Accent is the yellow highlight, not the editor's light-blue focus/link colour.
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()),'#a8c93a','the settings accent is applied');
 // Three bundled faces, three roles. Every text element must resolve to one of them, and each
 // family file must actually load (a present @font-face rule proves nothing on its own).
 const FONTS={titles:'Anklepants',controls:'Not Jam Mono Clean 13',reading:'Kubasta'};
 const assertFonts=async()=>{
  await page.evaluate(()=>document.fonts.ready);
  const loaded=await page.evaluate(()=>[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family));
  for(const family of Object.values(FONTS))
   assert.ok(loaded.includes(family),`the bundled ${family} file loaded`);
  // Role check: titles, controls and reading text each use their own face.
  const roles=await page.evaluate(()=>({
   title:getComputedStyle(document.querySelector('.brand strong')).fontFamily,
   tab:getComputedStyle(document.querySelector('.tabs button')).fontFamily,
   send:getComputedStyle(document.getElementById('send')).fontFamily,
   body:getComputedStyle(document.querySelector('#transcript .message .body')??document.body).fontFamily,
   prompt:getComputedStyle(document.getElementById('message')).fontFamily,
  }));
  assert.match(roles.title,/Anklepants/,'titles use Anklepants');
  assert.match(roles.tab,/Not Jam Mono Clean 13/,'tabs use Not Jam Mono Clean 13');
  assert.match(roles.send,/Not Jam Mono Clean 13/,'buttons use Not Jam Mono Clean 13');
  assert.match(roles.body,/Kubasta/,'responses use Kubasta');
  assert.match(roles.prompt,/Kubasta/,'the prompt uses Kubasta');
  // Nothing may fall back to a generic family: every text element names a bundled face.
  const wrong=await page.evaluate(fonts=>[...document.querySelectorAll('body,body *')]
   .filter(el=>el.textContent?.trim()||el.matches('input,textarea,select'))
   .filter(el=>!fonts.some(f=>getComputedStyle(el).fontFamily.includes(f)))
   .map(el=>`${el.tagName}#${el.id}: ${getComputedStyle(el).fontFamily}`),Object.values(FONTS));
  assert.deepEqual(wrong,[],'every text element uses one of the three bundled faces');
 };
 await assertFonts();
 // The focus ring is the accent border on the composer shell (the textarea itself is borderless).
assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('composer')).borderTopColor),'rgb(168, 201, 58)','composer focus ring uses the chosen accent');
 await page.getByLabel('Message Hermes').fill('');
 // Regression guards: no text below the 13px floor, and a pasted image must actually decode
 // (the CSP used to block data: URLs, leaving a broken-image glyph after the bytes were fine).
 const weights=await page.evaluate(()=>({body:getComputedStyle(document.body).fontWeight,
 button:getComputedStyle(document.getElementById('send')).fontWeight}));
 assert.equal(weights.body,'400');assert.equal(weights.button,'700');
 // Primary actions stay clearly larger than body text (13px base -> ~22px); the menu tabs
 // are navigation and are asserted at the header ratio below instead.
 const actionSizes=await page.evaluate(()=>({
  model:parseFloat(getComputedStyle(document.getElementById('model')).fontSize),
  screenshot:parseFloat(getComputedStyle(document.getElementById('screenshot')).fontSize),
  send:parseFloat(getComputedStyle(document.getElementById('send')).fontSize),
  base:parseFloat(getComputedStyle(document.body).fontSize)
 }));
 for(const [name,px] of Object.entries(actionSizes)){
  if(name==='base')continue;
  assert.ok(Math.abs(px-(actionSizes.base))<1.6,`${name} matches the body size (slider+1)`);
 }
 // Compact is a utility in the status row: never larger than the actions, but bold and legible.
 const compact=await page.evaluate(()=>{const el=document.getElementById('compact');return {size:parseFloat(getComputedStyle(el).fontSize),weight:getComputedStyle(el).fontWeight};});
 // Compact is a status-cell utility: it tracks the meta size (slider), not the body (slider+1).
assert.ok(compact.size>=10,'Compact stays legible');
 assert.equal(compact.weight,'700','Compact is bold like the other controls');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,
  'the larger control type must not overflow horizontally');
 // Header-level text (wordmark, logo mark, menu tabs, text-size control, session title, h1/h2)
 // sits exactly 20% above message text.
 const titleRatio=await page.evaluate(()=>{
  const px=s=>{const e=document.querySelector(s);return e?parseFloat(getComputedStyle(e).fontSize):null;};
  // Message text inherits the body size; fall back to it when the transcript is empty.
  const body=px('.message .body')??px('#transcript .message .body')??parseFloat(getComputedStyle(document.body).fontSize);
  const titles=['.brand strong','.text-size-row label','.text-size-row output',
                '#features h1','#features h2','#features h3'].map(px).filter(v=>v);
  return {body,titles,ratio:titles.length?+(titles[0]/body).toFixed(3):null,
          uniform:new Set(titles).size===1};
 });
 assert.equal(titleRatio.uniform,true,'every header/title uses one size');
 // Tabs are their own size: one third each, sized to still show 'Subagents' in a sidebar.
 const tabGeometry=await page.evaluate(()=>{const nav=document.querySelector('.tabs'); const cells=[...nav.querySelectorAll('button')].map(b=>b.getBoundingClientRect().width);
  return {nav:nav.getBoundingClientRect().width,cells,size:parseFloat(getComputedStyle(nav.querySelector('button')).fontSize),
   weight:getComputedStyle(nav.querySelector('button')).fontWeight};});
 assert.equal(tabGeometry.cells.length,3);
 for(const cell of tabGeometry.cells)assert.ok(Math.abs(cell-tabGeometry.nav/3)<1.5,`tab cell ${cell}px is not a third of ${tabGeometry.nav}px`);
 assert.equal(tabGeometry.weight,'700','tabs are bold like the other controls');
 assert.ok(titleRatio.ratio>1.2,`header text is ${titleRatio.ratio}x the message text, expected above 1.2x`);

 // Default typography stays proportional across the slider range.
 for(const base of [1,10,16,30]){
  const measured=await page.evaluate(base=>{
   document.documentElement.style.setProperty('--ui-size',`${base}px`);
   const px=s=>parseFloat(getComputedStyle(document.querySelector(s)).fontSize);
   return {tab:px('.tabs button'),mark:px('.brand .mark'),session:px('#new'),settings:px('#settings'),send:px('#send'),family:getComputedStyle(document.querySelector('.brand strong')).fontFamily};
  },base);
    // Tabs target slider x1.5, capped by a third of the row and floored at 9px.
  assert.ok(measured.tab>=8.9&&measured.tab<=Math.max(base*1.5,9.1)+1.2,`tabs are slider x1.5, capped or floored (${measured.tab} vs ${base})`);
  assert.ok(measured.mark>base);
  assert.ok(measured.session>=base+4,`session actions are slider+5 (${measured.session} vs ${base})`);
  assert.ok(measured.settings>=base+6,`settings is slider+7 (${measured.settings} vs ${base})`);
  // Actions target the body size but are capped by the cell width, so they never clip.
  // Target is the body size, capped by the cell width and floored at 9px so a tiny slider stays legible.
  assert.ok(measured.send>=8.9&&measured.send<=Math.max(base+1.6,9.1),`actions fit their quarter (${measured.send} at slider ${base})`);
  assert.match(measured.family,/Anklepants/,'the wordmark keeps the bundled CC0 titles face');
 }
 // The 13px floor is enforced in CSS, not only by the slider: a stale 10 setting must not shrink text.
await page.evaluate(()=>document.documentElement.style.setProperty('--ui-size','10px'));
assert.equal(await page.evaluate(()=>parseFloat(getComputedStyle(document.body).fontSize)),11,'body text is the slider plus one point');
await page.evaluate(()=>document.documentElement.style.setProperty('--ui-size','13px'));

 // Compact sits with the context meter; Stop is always on screen but only enabled mid-turn.
 // The status bar is four equal cells: spinner+state, approval mode, context meter, Compact.
 const statusCells=await page.evaluate(()=>{
  const row=document.querySelector('.status-line');
  const total=row.getBoundingClientRect().width;
  const cells=[...row.children].filter(el=>getComputedStyle(el).position!=='absolute'&&!el.hidden);
  return {count:cells.length,widths:cells.map(el=>+(el.getBoundingClientRect().width/total*100).toFixed(1))};
 });
 assert.equal(statusCells.count,4,'four status cells');
 for(const pct of statusCells.widths)assert.ok(Math.abs(pct-25)<2.5,`status cell is ${pct}% wide, expected ~25%`);
 const stopIdle=await page.evaluate(()=>({visible:document.getElementById('stop').getBoundingClientRect().width>0,
  disabled:document.getElementById('stop').disabled,text:document.getElementById('stop').textContent.trim(),
  send:document.getElementById('send').textContent.trim()}));
 assert.equal(stopIdle.visible,true,'Stop stays visible when idle');
 assert.equal(stopIdle.disabled,true,'Stop is disabled when there is nothing to cancel');
 assert.match(stopIdle.text,/^■ Stop$/);
 assert.match(stopIdle.send,/^▶ Send$/);
 await page.evaluate(()=>window.postMessage({type:'image',name:'probe.png',mime:'image/png',
  data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='},'*'));
 await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>{const img=document.querySelector('#image-list img');return !!img&&img.naturalWidth>0;}),
  true,'a pasted image must decode: check the webview CSP img-src');
 await page.evaluate(()=>{document.querySelectorAll('#image-list .chip-remove').forEach(b=>b.click());});
 // ---- Model picker modal, resizable prompt, profile editor (0.1.22) ----------------
await page.evaluate(()=>window.postMessage({type:'state',sessions:[{id:'s',title:'Test conversation',kind:'chat',status:'idle',messages:[],
 models:[{modelId:'mistral:mistral-large-4',name:'Mistral \u00b7 mistral-large-4',description:'Provider: Mistral'},
         {modelId:'mistral:codestral',name:'Mistral \u00b7 codestral',description:'Provider: Mistral'},
         {modelId:'mistral:labs-leanstral-1-5',name:'Mistral \u00b7 labs-leanstral-1-5',description:'Provider: Mistral'},
         {modelId:'ollama-cloud:qwen3:32b',name:'Ollama Cloud \u00b7 qwen3:32b',description:'Provider: Ollama Cloud'}],
 info:{model:'codestral',provider:'mistral',effort:'high',capabilities:{values:['none','high'],note:'n'}}}],
 activeId:'s',presets:[],recent:[],appearance:{accent:'lime',fontFamily:'monospace',fontSize:13,lineHeight:0,compact:false}},'*'));
await page.waitForTimeout(50);
await page.locator('#model').click();
await page.locator('#model-picker[open]').waitFor();
assert.equal(await page.locator('#favorite-list .model-row').count(),0,'no favorites yet');
assert.equal(await page.locator('#picker-provider option').count(),2,'one row per provider, from the ACP model ids');
assert.equal(await page.locator('#model-list .model-row').count(),3,'the selected provider lists its own models');
// Starring under All models adds; starring again in Favorites removes.
await page.locator('#model-list li[data-model-id="mistral:mistral-large-4"] .star').click();
assert.deepEqual(await page.evaluate(()=>{const m=window.sent.at(-1);return {type:m.type,id:m.id,on:m.on};}),
 {type:'favorite',id:'mistral:mistral-large-4',on:true});
await page.evaluate(()=>window.postMessage({type:'favorites',ids:['mistral:mistral-large-4']},'*'));
await page.waitForTimeout(50);
assert.equal(await page.locator('#favorite-list .model-row').count(),1,'the star lands in Favorites');
await page.locator('#favorite-list .star').click();
assert.equal(await page.evaluate(()=>window.sent.at(-1).on),false,'the same star removes it');
await page.evaluate(()=>window.postMessage({type:'favorites',ids:[]},'*'));
await page.waitForTimeout(50);
assert.equal(await page.locator('#favorite-list .model-row').count(),0);
// Selecting a row asks the host for that model's real details and renders them.
// Provider facts: context, capability chips, the exact ladder, and a blocked Labs row.
await page.evaluate(()=>window.postMessage({type:'modelFacts',models:[
 {id:'mistral-large-4',name:'mistral-large-4',description:'Mistral Large 4.0',lab:'mistralai',context:1048576,
  aliases:['mistral-large-4-0'],capabilities:{reasoning:true,vision:true,function_calling:true,completion_fim:false},
  labsGated:false,efforts:['low','medium','high'],effortsSource:'discovered'},
 {id:'codestral',name:'codestral',description:'Coding model',lab:'mistralai',context:256000,aliases:[],
  capabilities:{reasoning:false,vision:false,function_calling:true,completion_fim:true},
  labsGated:false,efforts:[],effortsSource:'seed'},
 {id:'labs-leanstral-1-5',name:'labs-leanstral-1-5',description:'Labs',lab:'mistralai',context:262144,aliases:[],
  capabilities:{reasoning:true,vision:true,function_calling:true,completion_fim:false},
  labsGated:true,efforts:null,effortsSource:'unknown'}]},'*'));
await page.waitForTimeout(50);
const largeRow=page.locator('#model-list li[data-model-id="mistral:mistral-large-4"]');
assert.match(await largeRow.textContent(),/1049k ctx/,'the context window comes from the provider');
assert.match(await largeRow.textContent(),/reasoning/,'capability chips are shown');
assert.match(await largeRow.textContent(),/effort: low\/medium\/high/,'the verified ladder is shown');

assert.match(await largeRow.textContent(),/verified/,'a discovered ladder is marked as verified');
const labsRow=page.locator('#model-list li[data-model-id="mistral:labs-leanstral-1-5"]');
assert.equal(await labsRow.evaluate(el=>el.classList.contains('blocked')),true,'a Labs model is marked blocked');
assert.equal(await labsRow.locator('.model-row').isDisabled(),true,'a Labs model cannot be selected');
assert.match(await labsRow.locator('.model-row').getAttribute('title'),/403/,'the reason names the 403');
await page.locator('#model-list li[data-model-id="mistral:codestral"] .model-row').click();
assert.deepEqual(await page.evaluate(()=>{const m=window.sent.at(-1);return {type:m.type,provider:m.provider,model:m.model};}),
 {type:'modelInfo',provider:'mistral',model:'codestral'});
await page.evaluate(()=>window.postMessage({type:'modelDetails',details:{provider:'mistral',providerLabel:'Mistral',model:'codestral',
 baseUrl:'https://api.mistral.ai/v1',lab:'Mistral AI',context:131072,contextSource:'provider',catalogName:'Codestral',
 capabilities:{values:['none','high'],note:'Mistral API ladder'}}},'*'));
await page.waitForTimeout(50);
const details=await page.locator('#model-details').textContent();
assert.match(details,/Mistral AI/,'the lab name is shown');
assert.match(details,/131,072 tokens/,'the context window is shown');
assert.match(details,/none, high/,'the thinking/effort ladder is shown');
// The details pane must read as sentences, not one character per line: the value column needs width.
const detailWidth=await page.evaluate(()=>{const dd=document.querySelector('#model-details dd');return dd?dd.clientWidth:0;});
assert.ok(detailWidth>=200,`details values get ${detailWidth}px, expected at least 200px`);
await assertFonts();
// "+ Provider": the picker can add an endpoint Hermes does not list yet (Ollama on this machine).
await page.locator('#picker-add-provider').click();
await page.locator('#provider-dialog[open]').waitFor();
assert.equal(await page.locator('#provider-url').inputValue(),'http://localhost:11434/v1','the local Ollama address is prefilled');
// Validation is local and specific: a bad id never reaches the host.
await page.locator('#provider-id').fill('Ollama Local');
await page.locator('#provider-save').click();
assert.match(await page.locator('#provider-note').textContent(),/lowercase/,'the id rule is explained');
assert.equal(await page.evaluate(()=>window.sent.some(m=>m.type==='providerSave')),false,'an invalid draft is not sent');
await page.locator('#provider-id').fill('ollama-local');
await page.locator('#provider-label').fill('Ollama Local');
await page.locator('#provider-model').fill('lfm3:latest');
await page.locator('#provider-test').click();
assert.deepEqual(await page.evaluate(()=>{const m=window.sent.at(-1);return {type:m.type,baseUrl:m.baseUrl};}),
 {type:'providerTest',baseUrl:'http://localhost:11434/v1'},'Test probes without saving');
await page.evaluate(()=>window.postMessage({type:'providerTest',result:{ok:true,models:['lfm3:latest','smollm2:360m'],count:2}},'*'));
await page.waitForTimeout(50);
assert.match(await page.locator('#provider-note').textContent(),/Endpoint answered: 2 models/);
await page.locator('#provider-save').click();
assert.deepEqual(await page.evaluate(()=>{const m=window.sent.at(-1);return {type:m.type,id:m.id,baseUrl:m.baseUrl,model:m.defaultModel};}),
 {type:'providerSave',id:'ollama-local',baseUrl:'http://localhost:11434/v1',model:'lfm3:latest'},'a valid draft is sent');
await page.evaluate(()=>window.postMessage({type:'providerSaved',result:{id:'ollama-local',label:'Ollama Local',
 baseUrl:'http://localhost:11434/v1',defaultModel:'lfm3:latest',hasKey:false,models:['lfm3:latest']}},'*'));
await page.waitForTimeout(80);
assert.equal(await page.locator('#provider-dialog[open]').count(),0,'the form closes once saved');
await page.locator('#picker-use').click();
assert.deepEqual(await page.evaluate(()=>{const m=window.sent.at(-1);return {type:m.type,id:m.id,value:m.value};}),
 {type:'useModel',id:'s',value:'mistral:codestral'});
assert.equal(await page.locator('#model-picker[open]').count(),0,'the modal closes on use');

// A grab bar above the prompt resizes it (keyboard path: the drag path uses the same clamp).
const beforeHeight=await page.locator('#message').evaluate(el=>el.getBoundingClientRect().height);
await page.locator('#composer-resize').focus();
await page.locator('#composer-resize').press('ArrowUp');
const afterHeight=await page.locator('#message').evaluate(el=>el.getBoundingClientRect().height);
assert.ok(afterHeight>beforeHeight,`arrow-up grows the prompt (${beforeHeight} -> ${afterHeight})`);

// Features shows the real profile, editable with an explicit Save.
await page.getByRole('tab',{name:'Features'}).click();
assert.equal(await page.evaluate(()=>window.sent.at(-1).type),'profile','opening Features reads the profile');
await page.evaluate(()=>window.postMessage({type:'profile',home:'/home/me/.hermes',files:[
 {id:'soul',title:'SOUL.md',description:'Persona.',path:'/home/me/.hermes/SOUL.md',content:'Be terse.',exists:true},
 {id:'user',title:'User memory',description:'About you.',path:'/home/me/.hermes/memories/USER.md',content:'Likes tests.',exists:true},
 {id:'memory',title:'Agent memory',description:'Notes.',path:'/home/me/.hermes/memories/MEMORY.md',content:'',exists:false}]},'*'));
await page.locator('#profile-files .profile-card').first().waitFor();
assert.equal(await page.locator('#profile-files .profile-card').count(),3,'SOUL.md and both memory files');
await assertFonts();
assert.equal(await page.getByLabel('SOUL.md contents').inputValue(),'Be terse.');
assert.equal(await page.locator('#profile-files .profile-save').first().isDisabled(),true,'Save waits for an edit');
await page.getByLabel('SOUL.md contents').fill('Be terse and kind.');
await page.locator('#profile-files .profile-save').first().click();
assert.deepEqual(await page.evaluate(()=>{const m=window.sent.at(-1);return {type:m.type,id:m.id,text:m.text};}),
 {type:'saveProfile',id:'soul',text:'Be terse and kind.'});
await page.evaluate(()=>window.postMessage({type:'profileSaved',id:'soul',savedAt:'12:00'},'*'));
await page.waitForTimeout(50);
assert.match(await page.locator('#profile-files .profile-status').first().textContent(),/Saved 12:00/);
// An approval raised while another tab is open stays on screen: no more silent denials.
await page.evaluate(()=>window.postMessage({type:'permission',requestId:'r2',sessionId:'s',sessionTitle:'Test conversation',
 title:'Edit src/app.ts',summary:'Edit src/app.ts',tool:'edit',
 options:[{optionId:'allow_once',kind:'allow_once',label:'Allow once',role:'allow'},
          {optionId:'deny',kind:'reject_once',label:'Deny',role:'deny'}]},'*'));
await page.locator('.permission-card').waitFor();
assert.equal(await page.getByRole('button',{name:'Allow once'}).isVisible(),true,'visible from the Features tab too');
await page.evaluate(()=>window.postMessage({type:'permissionSettled',requestId:'r2'},'*'));
await page.waitForTimeout(50);
await page.getByRole('tab',{name:'Chat',exact:true}).click();

// Exercise rich text and code, not just the shell's inherited family.
await page.getByLabel('Dismiss error').click();
await page.evaluate(()=>window.postMessage({type:'state',sessions:[{id:'s',title:'Pixel typography',kind:'chat',status:'idle',
 messages:[{id:'u',role:'user',text:'Three faces, three roles.'},
 {id:'r',role:'thinking',text:'Checking typography.'},
 {id:'a',role:'assistant',text:'One family: **bold**, *italic*, and `inline code`.\n\n```ts\nconst font = "Kubasta";\n```'}],
 info:{model:'codestral',provider:'mistral',effort:'high',capabilities:{values:['none','high'],note:''}}}],
 activeId:'s',presets:[],recent:[],appearance:{accent:'yellow',fontSize:16,lineHeight:0,compact:false}},'*'));
await page.locator('#transcript pre code').waitFor();
await assertFonts();
assert.equal(await page.locator('#transcript em').evaluate(el=>getComputedStyle(el).fontStyle),'italic');
assert.ok(await page.locator('#transcript strong').evaluate(el=>Number(getComputedStyle(el).fontWeight)===400));
// Wide windows: the pixel face is wide, so text lives in a centred column instead of spanning 1900px.
for(const width of [320,430,1440]){
 await page.setViewportSize({width,height:900});
 for(const size of [13,16,20]){
  await page.evaluate(size=>document.documentElement.style.setProperty('--ui-size',`${size}px`),size);
  const overflow=await page.evaluate(()=>[...document.querySelectorAll('.composer-actions button')]
   .filter(el=>el.scrollWidth>el.clientWidth).map(el=>el.id));
  assert.deepEqual(overflow,[],`action labels fit at ${width}px / ${size}px`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 if(width===1440){
  const column=await page.evaluate(()=>({composer:document.getElementById('composer').getBoundingClientRect().width,
   body:document.querySelector('#transcript .message .body')?.getBoundingClientRect().width??0}));
  assert.ok(column.composer<=1000,`the composer stays in a ${column.composer}px column, expected <=1000`);
  assert.ok(column.body<=1000,`message text stays in a ${column.body}px column, expected <=1000`);
 }
}
await page.setViewportSize({width:430,height:900});
// Screenshots show the shipped default size (10), which is what a new install renders.
await page.evaluate(()=>window.postMessage({type:'state',sessions:[{id:'s',title:'Pixel typography',kind:'chat',status:'idle',
 messages:[{id:'u',role:'user',text:'Three faces, three roles.'},
 {id:'a',role:'assistant',text:'One family: **bold**, *italic*, and `inline code`.\n\n```ts\nconst font = "Kubasta";\n```'}],
 info:{model:'codestral',provider:'mistral',effort:'high',capabilities:{values:['none','high'],note:''},
  messages:12,context:{used:52000,limit:200000,messages:12,compactions:0,source:'stream'}},
 modes:{current:'dont_ask',available:[{id:'default',name:'Ask'},{id:'accept_edits',name:'Accept Edits'},{id:'dont_ask',name:"Don't Ask"}]},
 warning:''}],
 activeId:'s',presets:[],recent:[],appearance:{accent:'yellow',fontSize:10,lineHeight:0,compact:false}},'*'));
await page.waitForTimeout(80);
// ---- Screenshots ---------------------------------------------------------------
await page.screenshot({path:'docs/ui-dark.png',fullPage:true});
 await page.route('http://radcode.test/theme.css',route=>route.fulfill({contentType:'text/css',body:':root{--vscode-sideBar-background:#fafafa;--vscode-editor-background:#fff;--vscode-foreground:#242424;--vscode-input-background:#fff;--vscode-input-foreground:#242424;--vscode-descriptionForeground:#545454;--vscode-widget-border:#c8c8c8;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;}'}));
 await page.addStyleTag({url:'http://radcode.test/theme.css'});
 await page.screenshot({path:'docs/ui-light.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Webview smoke passed: connect, capability-aware effort, sanitized Markdown, agent form, keyboard send, approval mode select, approval cards, context meter, context attachments, composer clearing, accent + font settings, bold control/regular message hierarchy, Hermes delegation panel, Mistral provider facts, add-provider form, image thumbnails decode, dark/light rendering.');
}finally{await browser.close();}
