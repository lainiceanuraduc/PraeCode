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
  await route.fulfill({body,contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'});
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
 await page.getByRole('button',{name:'＋ Context'}).click();
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
 await page.getByRole('tab',{name:'Subagents'}).click();
 await page.getByRole('button',{name:'New preset',exact:true}).click();
 await page.getByLabel('Agent name').fill('Reviewer');
 await page.getByLabel('Instructions').fill('Read only. Report bugs.');
 await page.getByRole('button',{name:'Save preset',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.sent.at(-1).type),'savePreset');
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
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body).fontFamily.toLowerCase().includes('mono')),true,'the font family setting is applied');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('composer')).borderTopColor),'rgb(168, 201, 58)','composer focus ring uses the chosen accent');
 await page.getByLabel('Message Hermes').fill('');
 // Regression guards: no text below the 13px floor, and a pasted image must actually decode
 // (the CSP used to block data: URLs, leaving a broken-image glyph after the bytes were fine).
 const smallest=await page.evaluate(()=>{
  const sizes=[];
  for(const el of document.querySelectorAll('body *')){
   if(!el.textContent?.trim())continue;
   const px=parseFloat(getComputedStyle(el).fontSize);
   if(px)sizes.push(px);
  }
  return Math.min(...sizes);
 });
 assert.ok(smallest>=13,`smallest rendered text is ${smallest}px, floor is 13px`);
 // Primary actions and navigation stay clearly larger than body text (13px base -> ~22px),
 const actionSizes=await page.evaluate(()=>({
  tab:parseFloat(getComputedStyle(document.querySelector('.tabs button')).fontSize),
  model:parseFloat(getComputedStyle(document.getElementById('model')).fontSize),
  screenshot:parseFloat(getComputedStyle(document.getElementById('screenshot')).fontSize),
  send:parseFloat(getComputedStyle(document.getElementById('send')).fontSize),
  compact:parseFloat(getComputedStyle(document.getElementById('compact')).fontSize),
  base:parseFloat(getComputedStyle(document.body).fontSize)
 }));
 for(const [name,px] of Object.entries(actionSizes)){
  if(name==='base')continue;
  assert.ok(px>=actionSizes.base*1.5-1,`${name} is ${px}px, expected >= 1.5x the ${actionSizes.base}px base`);
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,
  'the 3x action type must not overflow horizontally');
 // Compact sits with the context meter; Stop is always on screen but only enabled mid-turn.
 assert.equal(await page.evaluate(()=>document.getElementById('compact').parentElement.id),'context-meter',
  'Compact belongs beside the context meter');
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
 await page.screenshot({path:'docs/ui-dark.png',fullPage:true});
 await page.route('http://radcode.test/theme.css',route=>route.fulfill({contentType:'text/css',body:':root{--vscode-sideBar-background:#fafafa;--vscode-editor-background:#fff;--vscode-foreground:#242424;--vscode-input-background:#fff;--vscode-input-foreground:#242424;--vscode-descriptionForeground:#545454;--vscode-widget-border:#c8c8c8;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;}'}));
 await page.addStyleTag({url:'http://radcode.test/theme.css'});
 await page.screenshot({path:'docs/ui-light.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Webview smoke passed: connect, capability-aware effort, sanitized Markdown, agent form, keyboard send, approval mode select, approval cards, context meter, context attachments, composer clearing, accent + font settings, image thumbnails decode, 13px text floor, dark/light rendering.');
}finally{await browser.close();}
