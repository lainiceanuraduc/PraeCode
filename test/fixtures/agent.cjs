const readline=require('node:readline');
const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(m.id===undefined)return;
 let result={};
 if(m.method==='initialize')result={protocolVersion:1,agentCapabilities:{loadSession:true},agentInfo:{name:'explicit-test-fixture',version:'1'}};
 if(m.method==='session/new')result={sessionId:'test-session'};
 if(m.method==='session/prompt'){
  send({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello'}}}});
  result={stopReason:'end_turn'};
 }
 send({id:m.id,result});
});
