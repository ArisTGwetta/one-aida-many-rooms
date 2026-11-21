import { authorize, validateConfig } from '../../memory.mjs';
import { createRehearsal } from './harness.mjs';
const el=id=>document.getElementById(id);
let config,token,runner,busy=false,current;
function render(report) {
  current=report;
  el('report').textContent=JSON.stringify(report,null,2);
  el('plan').textContent=JSON.stringify({runId:report.runId,target:report.target,artifacts:report.artifacts.map(({id,name,parent,mimeType,plannedOperations})=>({id,name,parent,mimeType,plannedOperations}))},null,2);
  const list=document.createElement('ul');
  for(const result of report.results){const li=document.createElement('li');li.textContent=`${result.status}: ${result.name} — ${result.detail}`;list.append(li);}
  el('results').replaceChildren(list);
  controls();
}
function controls() {
  el('authorize').disabled=busy||!config;
  el('confirm').disabled=busy||!current?.prepared||current.started;
  el('execute').disabled=busy||!current?.prepared||current.started||!el('confirm').checked;
  const canClean=current?.started&&['complete','stopped','cleanup-stopped'].includes(current.mode);
  el('cleanup-confirm').disabled=busy||!canClean;
  el('cleanup').disabled=busy||!canClean||!el('cleanup-confirm').checked;
  el('download').disabled=!current;
}
async function action(fn) {
  busy=true;controls();
  try{await fn();}catch(error){el('status').textContent=error.status?`BLOCKED: Drive HTTP ${error.status}.`:`BLOCKED: ${error.message}`;}
  finally{busy=false;controls();}
}
el('authorize').addEventListener('click',()=>action(async()=>{
  validateConfig(config,location.origin);
  if(!globalThis.google?.accounts?.oauth2)throw Error('Google sign-in did not load. Retry after checking network access.');
  token=await authorize(google.accounts.oauth2,config.google);
  if(runner&&current?.prepared){el('status').textContent='Authorization renewed for the same run. Existing artifacts and confirmations remain inspectable.';return;}
  runner=createRehearsal({config,token:()=>token,notify:render});
  await runner.prepare();el('status').textContent='Plan verified. Review the exact target and IDs, then explicitly confirm writes.';
}));
el('confirm').addEventListener('change',controls);
el('cleanup-confirm').addEventListener('change',controls);
el('execute').addEventListener('click',()=>action(async()=>{
  if(!el('confirm').checked)throw Error('Write confirmation is required.');
  const report=await runner.execute(current.runId);render(report);
  el('status').textContent=report.mode==='complete'?'Rehearsal completed. Inspect results, download the report, then confirm cleanup.':'Rehearsal stopped. No later test is claimed to pass. Inspect artifacts before cleanup.';
}));
el('cleanup').addEventListener('click',()=>action(async()=>{
  if(!el('cleanup-confirm').checked)throw Error('Cleanup confirmation is required.');
  const report=await runner.cleanup(current.runId);render(report);
  el('status').textContent=report.mode==='cleaned'?'Synthetic artifacts verified in Trash. Download the final report.':'Cleanup stopped safely. Retained artifact IDs are in the report.';
}));
el('download').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=`memory-bridge-test-${current.runId}.json`;link.click();URL.revokeObjectURL(url);
});
try {
  const response=await fetch('../../oauth.config.json',{cache:'no-store'});if(!response.ok)throw Error('Could not load OAuth configuration.');
  config=await response.json();validateConfig(config,location.origin);
  el('status').textContent='Ready for normal Google sign-in. No credentials will be displayed or exported.';controls();
}catch(error){config=undefined;el('status').textContent=`BLOCKED: ${error.message} Live sign-in requires the existing approved origin; localhost is not assumed authorized.`;controls();}
