import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createContextSource, createAwakeSteward, journalReceipt } from './awake-context.mjs';
import { createConversationSession } from './conversation.mjs';
import { createJournal, makeJournalEvent, dispositionFor } from './recent-journal.mjs';
import { checkpointEligible, evolve, validateCheckpoint, validateOperation, safeReceipt, scopeAllowed } from './memory-bridge.mjs';
import { projectSkills } from './project-skills.mjs';
import { skillDescriptor } from './skill-registry.mjs';
import {emptyMind,validateMind} from './living-mind.mjs';
const folder='fixture-folder', conversationId='11111111-1111-4111-8111-111111111111';
const blank=()=>({long:[],short:[],recent:[],facts:[],insights:[]});
function fixture() {
  const files=new Map(), props={aidaContextInitialized:'1',ctxGlobalV1:'global',ctxProjectsV1:'projects',ctxCapabilitiesV1:'capabilities','ctxProject-atlas':'atlas','ctxReady-atlas':'1','ctxProject-beta':'beta','ctxReady-beta':'1'};
  for(const [id,name,record] of [
    ['global','aida-context-global.json',{schema_version:1,...blank()}],
    ['projects','aida-context-projects.json',{schema_version:1,projects:['atlas','beta'].map(id=>({id,name:id==='atlas'?'Atlas':'Beta',description:'Synthetic fictional project.',status:'active',routingSummary:'Synthetic story.',scope:'fictional'}))}],
    ['capabilities','aida-context-capabilities.json',{schema_version:1,capabilities:[]}],
    ['atlas','aida-context-project-atlas.json',{schema_version:1,projectId:'atlas',scope:'fictional',...blank(),evidence:[{source:'creation:1',text:'Synthetic original project authorization.'}]}],
    ['beta','aida-context-project-beta.json',{schema_version:1,projectId:'beta',scope:'fictional',...blank()}]
  ])files.set(id,{id,name,record,parents:[folder],appProperties:{aidaMemory:'context-v1'},version:1});
  let failure=null,race=null,serial=0;const writes=[],requests=[];
  const fetchRequest=async(input,options={})=>{
    const url=new URL(input), id=url.pathname.split('/').at(-1), method=options.method??'GET';requests.push({url:url.href,method});
    assert.equal(url.origin,'https://www.googleapis.com');
    if(id===folder)return Response.json({id:folder,name:'AIDA — ONE AIDA MANY ROOMS — DEV',mimeType:'application/vnd.google-apps.folder',trashed:false,appProperties:props});
    if(id==='generateIds')return Response.json({ids:['journal-'+(++serial)]});
    if(url.pathname==='/upload/drive/v3/files'){
      const boundary=options.headers['Content-Type'].split('boundary=')[1];
      const [meta,record]=options.body.split('--'+boundary).slice(1,3).map(p=>JSON.parse(p.split('\r\n\r\n')[1]));
      if(files.has(meta.id))return new Response(null,{status:409});
      if(failure?.(record,'journal-before'))throw Error('synthetic interrupted journal');
      files.set(meta.id,{...meta,record,version:1});writes.push({kind:'journal',id:meta.id});
      if(failure?.(record,'journal-after'))throw Error('synthetic lost journal response');
      return Response.json({id:meta.id});
    }
    if(url.searchParams.has('q')){
      const q=url.searchParams.get('q'),name=/name = '([^']+)'/.exec(q)?.[1],conv=/key='conversation' and value='([^']+)'/.exec(q)?.[1];
      let result=[...files.values()].filter(f=>name?f.name===name:['recent-v1','recent-project-v1'].includes(f.appProperties.aidaMemory)&&(!conv||f.appProperties.conversation===conv));
      if(!name&&!q.includes("value='recent-project-v1'"))result=result.filter(f=>f.appProperties.aidaMemory==='recent-v1');
      result.reverse();const size=+(url.searchParams.get('pageSize')??10),offset=+(url.searchParams.get('pageToken')??0);
      return Response.json({files:result.slice(offset,offset+size).map(f=>({id:f.id,appProperties:f.appProperties})),...(result.length>offset+size?{nextPageToken:String(offset+size)}:{})});
    }
    const file=files.get(id);if(!file)return new Response(null,{status:404});
    if(method==='PUT'){
      if(race){const fn=race;race=null;fn(file);}
      if(options.headers['If-Match']!==`"v${file.version}"`)return new Response(null,{status:412});
      if(failure?.(file.record,'context-before'))throw Error('synthetic interrupted context');
      file.record=JSON.parse(options.body);file.version++;writes.push({kind:'context',id});
      if(failure?.(file.record,'context-after'))throw Error('synthetic lost context response');
      return Response.json({id,etag:`"v${file.version}"`});
    }
    if(url.pathname.startsWith('/drive/v2/'))return Response.json({id,etag:file.tagOverride??`"v${file.version}"`,parents:[{id:folder}],mimeType:'application/json',labels:{trashed:false}});
    return Response.json(url.searchParams.get('alt')==='media'?file.record:{id,name:file.name,parents:file.parents,mimeType:'application/json',trashed:false,appProperties:file.appProperties});
  };
  const open=()=>({source:createContextSource(folder,()=> 'synthetic-token',fetchRequest),journal:createJournal(folder,()=> 'synthetic-token',fetchRequest)});
  return {files,props,writes,requests,open,fail:fn=>{failure=fn;},race:fn=>{race=fn;}};
}
const unit=(id,text,source,kind='interpretation',replaces=null)=>({id,kind,text,sources:[source],replaces});
const change=(e,scope,layer,text,operation,meaning)=>({scope,layer,text,operation,meaning,sources:[e.user.source],rationale:'A meaningful synthetic development.'});
function chat(source, propose=()=>({}), bindings=[],options={}) {
  let calls=0,last; const steward=createAwakeSteward(source,{skills:projectSkills(source,bindings),sessionId:options.sessionId??null});
  const session=createConversationSession({steward,memoryStore:{recall:async()=>null},recoverConversation:options.recoverConversation??true,provider:async e=>{
    calls++;last=e;const proposed=propose(e);
    if(proposed.skillRequest)return JSON.stringify(proposed);
    return JSON.stringify({version:'0.2',reply:'Synthetic conversational reply.',intent:'conversation',route:'reply',affect:e.affect,
      candidates:{facts:[],insights:[],short:[],long:[]},tools:[],awake:{action:{kind:'just_keep_talking',target:null,arguments:[],sources:[],uncertainty:null},rebuild:null,changes:[],candidates:[],contradictions:[],...proposed}});
  }});
  return {session,steward,get calls(){return calls;},get last(){return last;}};
}
async function stage(client,result,choice='auto') {
  const disposition=dispositionFor(result.turn.user.text,choice);
  if(!checkpointEligible(result,disposition))return null;
  const checkpoint=await client.source.prepareCheckpoint(result);result.receipt.bridge=checkpoint;
  const turn={...result.turn,conversationId};turn.awakeReceipt=journalReceipt(result);
  assert.ok(turn.awakeReceipt);
  return {checkpoint,event:makeJournalEvent(conversationId,turn,disposition==='provisional'?'provisional':'candidate')};
}
async function commit(client,pending){const saved=await client.journal.save(pending);return client.source.commitCheckpoint(pending.checkpoint,'drive:'+saved.fileId);}
test('normal awake updates checkpoint one current global LONG/SHORT/RECENT and survive outside the journal recovery window',async()=>{
  const f=fixture(),client=f.open();const c=chat(client.source,e=>e.user.text==='We approved the new plan.'?{rebuild:'meaningful_event',changes:['long','short','recent'].map(layer=>change(e,'global',layer,layer+' current plan','EXPAND',[unit(layer+'-plan','A synthetic approved plan.',e.user.source)]))}:{});
  const result=await c.session.send('We approved the new plan.');assert.equal(c.calls,1);
  const pending=await stage(client,result);assert.ok(pending);await commit(client,pending);
  for(let n=0;n<4;n++){const r=await c.session.send('A retained synthetic activity '+n);await client.journal.save({event:makeJournalEvent(conversationId,{...r.turn,conversationId},'candidate')});}
  const cold=f.open(), recovered=await cold.journal.recover(conversationId);assert.ok(recovered.turns.every(t=>t.turnId!==result.turn.turnId));
  const fresh=chat(cold.source);await fresh.session.send('Continue the plan.');
  for(const layer of ['long','short','recent']){assert.equal(fresh.last.context.global[layer].length,1);assert.equal(fresh.last.context.global[layer][0].text,layer+' current plan');}
  assert.equal(f.files.get('global').record.schema_version,1);
  assert.equal(fresh.last.context.activeProject,null);
  assert.equal(f.requests.filter(r=>r.url.includes('alt=media')&&r.url.includes('/atlas?')).length,0);
});
test('Vader revelation preserves enemy knowledge, adds an uncertain claim, and later revises only the claim with provenance',async()=>{
  const f=fixture(),client=f.open();let step=0;
  const c=chat(client.source,e=>{
    if(e.context.projectSelection)return {};
    if(step===0)return {rebuild:'meaningful_event',changes:[change(e,'project','long','Vader is Luke’s enemy.','EXPAND',[unit('enemy','Vader is Luke’s enemy.',e.user.source,'claim')]),change(e,'project','short','Luke faces an enemy.','EXPAND',[unit('encounter','Luke faces Vader.',e.user.source,'event')])]};
    if(step===1)return {rebuild:'meaningful_event',changes:[change(e,'project','long','His enemy claims to be his father; Luke remains uncertain.','UNCLEAR',[unit('father-claim','Vader claims to be Luke’s father.',e.user.source,'claim'),unit('doubt','Luke does not yet know whether the claim is true.',e.user.source,'uncertainty')])]};
    return {rebuild:'correction',changes:[change(e,'project','long','Luke’s father has also been his enemy. The relationship is now confirmed in the story.','REVISE',[unit('confirmed-parent','The story now confirms the father relationship.',e.user.source,'claim','father-claim'),unit('resolved-doubt','Luke now knows the relationship.',e.user.source,'belief','doubt')])]};
  });
  await c.session.send('Enter Atlas');
  let r=await c.session.send('Vader is Luke’s enemy.');await commit(client,await stage(client,r));step=1;
  r=await c.session.send('Vader claims to be his father, but Luke is uncertain.');const uncertain=await stage(client,r);await commit(client,uncertain);
  const cold=f.open(), project=await cold.source.project('atlas');
  assert.deepEqual(project.continuity.long[0].meaning.map(u=>[u.id,u.kind]),[['enemy','claim'],['father-claim','claim'],['doubt','uncertainty']]);
  assert.equal(project.continuity.short[0].text,'Luke faces an enemy.');
  step=2;r=await c.session.send('The story confirms the relationship; Luke now knows.');await commit(client,await stage(client,r));
  const current=f.files.get('atlas').record;
  assert.equal(current.long.length,1);assert.deepEqual(current.long[0].meaning.map(u=>u.id),['enemy','confirmed-parent','resolved-doubt']);
  assert.deepEqual(current.facts,[]);assert.deepEqual(current.insights,[]);
  const history=await f.open().source.projectEvidence('atlas',uncertain.checkpoint.plans[0].after.long[0].source);
  assert.ok(history.entries.some(e=>e.text.includes('Luke is uncertain')));
  assert.ok([...f.files.values()].some(file=>JSON.stringify(file.record).includes('father-claim')));
});
test('wrong-scope proposals do not escape active projects; approved synthetic receipts disclose only their public outcome',async()=>{
  const f=fixture(),client=f.open();
  const binding={descriptor:skillDescriptor('synthetic_outcome',1,'read','Synthetic approved outcome.',[]),validate:()=>true,authorize:()=>true,
    run:()=>({privateState:'SYNTHETIC_PRIVATE_SCENE',summary:'A synthetic feature is ready for review.'}),validateResult:r=>!!r.summary,
    receiptPolicy:{global:true},publicReceipt:r=>({id:'outcome-1',scope:'global',projectId:null,text:r.summary,reference:'fixture:outcome'})};
  const c=chat(client.source,e=>{
    if(e.context.projectSelection)return {};
    if(e.user.text==='Request the outcome'&&!e.context.retrievalComplete)return {skillRequest:{id:'synthetic_outcome',version:1,input:{}}};
    if(e.context.approvedReceipts){const receipt=e.context.approvedReceipts[0];assert.ok(!JSON.stringify(e).includes('SYNTHETIC_PRIVATE_SCENE'));return {rebuild:'meaningful_event',changes:[{...change(e,'global','short',receipt.text,'EXPAND',[unit('public-outcome',receipt.text,receipt.source)]),sources:[receipt.source]},change(e,'project','recent','A private synthetic handoff.','EXPAND',[unit('handoff','A private synthetic handoff.',e.user.source)])]};}
    return {rebuild:'meaningful_event',changes:[change(e,'global','long','A private story secret.','EXPAND',[unit('secret','A private story secret.',e.user.source)]),change(e,'project','short','A private development.','EXPAND',[unit('local','A private development.',e.user.source)])]};
  },[binding]);
  await c.session.send('Enter Atlas');const bad=await c.session.send('A private development.');
  assert.equal(bad.receipt.applied.length,1);assert.equal(bad.receipt.rejected[0].reason,'scope_transfer_denied');
  await commit(client,await stage(client,bad));assert.deepEqual(f.files.get('global').record.long,[]);
  const publicResult=await c.session.send('Request the outcome'),pending=await stage(client,publicResult);let fail=true;
  f.fail((record,phase)=>{if(record.projectId==='atlas'&&phase==='context-before'&&fail){fail=false;return true;}return false;});
  await assert.rejects(commit(client,pending));
  const globalWrites=f.writes.filter(w=>w.kind==='context'&&w.id==='global').length;
  f.fail(null);await commit(client,pending);
  assert.equal(f.writes.filter(w=>w.kind==='context'&&w.id==='global').length,globalWrites);
  assert.equal(f.files.get('global').record.short[0].text,'A synthetic feature is ready for review.');
  assert.ok(!JSON.stringify(f.files.get('global').record).includes('SYNTHETIC_PRIVATE_SCENE'));
});
test('quick questions, KEEP and explicit opt-out do not write; plural working candidates stay noncanonical',async()=>{
  const f=fixture(),client=f.open();const c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','A proposed incidental note.','EXPAND',[unit('incidental','An incidental claim.',e.user.source)])]}));
  const quick=await c.session.send('How do you spell rhythm?');assert.equal(await stage(client,quick),null);
  assert.deepEqual((await c.steward.assemble([], {source:'next',text:'Continue'})).global.short,[]);
  const excluded=await c.session.send('Do not save this.',{keepInContext:false});assert.equal(await stage(client,excluded),null);assert.equal(f.writes.length,0);
  assert.equal(evolve([], {operation:'KEEP',meaning:[]},'source'),null);
  const candidates=chat(client.source,e=>({rebuild:'meaningful_event',candidates:[{scope:'global',layer:'facts',text:'The user reports a synthetic preference.',sources:[e.user.source],rationale:'User statement.'},{scope:'global',layer:'insights',text:'A tentative synthetic interpretation.',sources:[e.user.source],rationale:'Uncertain interpretation.'}]}));
  const result=await candidates.session.send('Here is a meaningful synthetic observation.');await commit(client,await stage(client,result));
  const doc=f.files.get('global').record;assert.equal(doc.memoryBridge.review.candidates.length,2);assert.deepEqual(doc.facts,[]);assert.deepEqual(doc.insights,[]);
  assert.deepEqual(doc.short,[]); // An earlier incidental proposal cannot leak into a later checkpoint.
});

test('provisional and explicit opt-out retain no permanent interpretation, even when a later turn checkpoints',async()=>{
  const f=fixture(),client=f.open(),c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','Temporary synthetic context.','EXPAND',[unit('temporary','Temporary context.',e.user.source)])]}));
  const temporary=await c.session.send('A developing idea.',{memoryDisposition:'provisional'});
  assert.equal(await stage(client,temporary,'provisional'),null);
  await client.journal.save({event:makeJournalEvent(conversationId,{...temporary.turn,conversationId},'provisional')});
  assert.deepEqual(f.files.get('global').record.short,[]);
  const remembered=chat(client.source,e=>({rebuild:'explicit_request',changes:[change(e,'global','short','Only this durable decision.','EXPAND',[unit('decision','Only this decision.',e.user.source)])]}));
  await commit(client,await stage(client,await remembered.session.send('Remember this: a synthetic decision.')));
  assert.ok(!JSON.stringify(f.files.get('global').record).includes('temporary'));
});

test('repeated project updates remain one current view; cold model requests retain uncertainty without loading every project',async()=>{
  const f=fixture(),client=f.open();let step=0;
  const c=chat(client.source,e=>e.context.projectSelection?{}:{rebuild:'meaningful_event',changes:[change(e,'project','short','Current step '+step,'EXPAND',[unit('step-'+step++,'A new synthetic step.',e.user.source,'uncertainty')])]});
  await c.session.send('Enter Atlas');
  for(let n=0;n<3;n++)await commit(client,await stage(client,await c.session.send('Synthetic step '+n)));
  assert.equal(f.files.get('atlas').record.short.length,1);
  assert.equal(f.files.get('atlas').record.short[0].meaning.length,3);
  const cold=chat(f.open().source);await cold.session.send('What is Atlas doing?');
  assert.equal(cold.last.context.currentProjectId,null);
  assert.equal(cold.last.context.lookupProject.continuity.short[0].meaning[2].kind,'uncertainty');
  assert.deepEqual(cold.last.context.global.short,[]);
});

test('invalid semantics, fabricated nested sources and duplicate views fail before working state changes',async()=>{
  const f=fixture(),client=f.open();
  const old=[{source:'old',text:'Existing relationship.',meaning:[unit('relationship','Existing relationship.','old')]}];
  assert.throws(()=>evolve(old,{operation:'EXPAND',text:'Bad',meaning:[unit('replacement','Erased relationship.','new','claim','relationship')]},'next'),/revision/);
  assert.throws(()=>evolve(old,{operation:'REVISE',text:'Bad',meaning:[unit('replacement','No new evidence.','old','claim','relationship')]},'next'),/new evidence/);
  assert.throws(()=>evolve(old,{operation:'UNCLEAR',text:'Bad',meaning:[unit('claim','No uncertainty.','new','claim')]},'next'),/uncertainty/);
  assert.throws(()=>validateOperation({operation:'EXPAND',sources:['public'],meaning:[unit('private','Private claim.','private')]},new Set(['public','private'])),/evidence/);
  const c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','One','EXPAND',[unit('one','One',e.user.source)]),change(e,'global','short','Two','EXPAND',[unit('two','Two',e.user.source)])]}));
  await assert.rejects(c.session.send('A synthetic decision.'),e=>e.diagnostic==='awake_duplicate_view');
  assert.deepEqual((await c.steward.assemble([],{source:'next',text:'Next'})).global.short,[]);
  assert.equal(f.writes.length,0);
  assert.throws(()=>safeReceipt({id:'secret',scope:'global',projectId:null,text:'Not authorized.',reference:'fixture'}, {id:'fixture',version:1},{}),/unauthorized/);
  const context={currentProjectId:'atlas',activeProject:{},approvedReceipts:[{source:'private:other',scope:'project',projectId:'other'}]};
  assert.equal(scopeAllowed({scope:'global',sources:['private:other']},{context}),false);
  assert.equal(scopeAllowed({scope:'project',sources:['private:other']},{context}),false);
});

test('missing strong ETags and malformed stored checkpoint metadata fail closed without replacing memory',async()=>{
  const f=fixture(),client=f.open(),c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','Decision.','EXPAND',[unit('decision','Decision.',e.user.source)])]}));
  const pending=await stage(client,await c.session.send('A meaningful decision.'));
  for(const tag of ['','W/"weak"']){f.files.get('global').tagOverride=tag;await assert.rejects(commit(client,pending),/strong/);}
  assert.equal(f.writes.filter(w=>w.kind==='context').length,0);
  const malformed=structuredClone(pending.checkpoint);malformed.plans[0].review={candidates:null,questions:[]};
  assert.throws(()=>validateCheckpoint(malformed),/review/);
  const promotion=structuredClone(pending.checkpoint);promotion.plans[0].after.facts=[{source:'invented',text:'Unauthorized promotion.'}];
  assert.throws(()=>validateCheckpoint(promotion),/promote canonical/);
  delete f.files.get('global').tagOverride;await commit(client,pending);
  f.files.get('global').record.memoryBridge.review={candidates:'bad',questions:[]};
  await assert.rejects(f.open().source.load(),/review/);
});

test('the actual chat persistence handler retains pending work and verifies retry without another provider call',async()=>{
  const app=await readFile(new URL('./app.mjs',import.meta.url),'utf8');
  const start=app.indexOf('  async function savePending() {'),end=app.indexOf('\n  byId("journal-resume")',start);
  assert.ok(start>0&&end>start);
  const f=fixture(),client=f.open(),c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','A real handler handoff.','EXPAND',[unit('handoff','Handler handoff.',e.user.source)])]}));
  const result=await c.session.send('A meaningful handler test.');
  const status={textContent:''},journalStatus={textContent:''};
  const harness=runInNewContext(`let pending=initial;${app.slice(start,end)};({savePending,get pending(){return pending;}})`,{
    initial:{result,turn:{...result.turn,conversationId},disposition:'candidate'},contextSource:client.source,journal:client.journal,
    journalReceipt,makeJournalEvent,conversationId,journalStatus,byId:id=>id==='context-status'?status:{textContent:''},mindTrace:()=>{},Date,JSON,Error
  });
  let fail=true;f.fail((_record,phase)=>{if(phase==='context-before'&&fail){fail=false;return true;}return false;});
  await assert.rejects(harness.savePending());assert.ok(harness.pending.journalVerified);
  assert.match(journalStatus.textContent,/unconfirmed/);assert.equal(c.calls,1);
  f.fail(null);assert.match(await harness.savePending(),/Saved and verified/);
  assert.equal(harness.pending,undefined);assert.match(status.textContent,/Memory checkpoint verified/);
  assert.equal(c.calls,1);assert.equal(f.writes.filter(w=>w.kind==='journal').length,1);
});

test('journal interruption and readback mismatch preserve retry information and never repeat the provider',async()=>{
  const f=fixture(),client=f.open(),c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','recent','Handoff.','EXPAND',[unit('handoff','Handoff.',e.user.source)])]}));
  const pending=await stage(client,await c.session.send('A meaningful handoff.'));let fail=true;
  f.fail((_record,phase)=>{if(phase==='journal-after'&&fail){fail=false;return true;}return false;});
  await assert.rejects(commit(client,pending));assert.equal(c.calls,1);
  f.fail(null);await commit(client,pending);
  assert.equal(f.writes.filter(w=>w.kind==='journal').length,1);assert.equal(f.writes.filter(w=>w.kind==='context').length,1);
  const next=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','Next handoff.','EXPAND',[unit('next','Next handoff.',e.user.source)])]}));
  const later=await stage(client,await next.session.send('The next meaningful handoff.'));
  f.fail((record,phase)=>{if(phase==='context-after'){record.short[0].text='Unexpected readback';}return false;});
  await assert.rejects(commit(client,later),/readback failed/);assert.equal(next.calls,1);
  f.fail(null);await assert.rejects(commit(client,later),/retry content changed/);assert.equal(next.calls,1);
});
test('journal/context failures retry the same reply idempotently; atomic ETag rejects a racing client',async()=>{
  const f=fixture(),client=f.open(),c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','The synthetic decision.','EXPAND',[unit('decision','A synthetic decision.',e.user.source)])]}));
  const result=await c.session.send('A meaningful decision.'),pending=await stage(client,result);let fail=true;
  f.fail((_record,phase)=>{if(phase==='context-after'&&fail){fail=false;return true;}return false;});
  await assert.rejects(commit(client,pending));assert.equal(c.calls,1);
  const before=f.writes.filter(w=>w.kind==='context').length;f.fail(null);await commit(client,pending);assert.equal(f.writes.filter(w=>w.kind==='context').length,before);assert.equal(c.calls,1);
  const left=f.open(),right=f.open();const build=source=>chat(source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','recent','A new handoff.','EXPAND',[unit('handoff-'+e.user.source.slice(5,9),'A new handoff.',e.user.source)])]}));
  const a=build(left.source),b=build(right.source);const pa=await stage(left,await a.session.send('Left decision')),pb=await stage(right,await b.session.send('Right decision'));
  await commit(left,pa);await assert.rejects(commit(right,pb),/Stale checkpoint/);
  const racing=f.open(),r=build(racing.source),pr=await stage(racing,await r.session.send('Racing decision'));
  f.race(file=>{file.version++;file.record.concurrentMarker='preserve me';});
  await assert.rejects(commit(racing,pr),/412/);assert.equal(f.files.get('global').record.concurrentMarker,'preserve me');
});
test('fresh clients identify journal-first pending work and scoped evidence retrieval rejects foreign references',async()=>{
  const f=fixture(),client=f.open(),c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','recent','A retained handoff.','EXPAND',[unit('handoff','A retained handoff.',e.user.source)])]}));
  const result=await c.session.send('A meaningful handoff.'),pending=await stage(client,result);
  const saved=await client.journal.save(pending);
  const fresh=f.open();assert.equal(await fresh.source.checkpointStatus(pending.checkpoint),'unconfirmed');
  await fresh.source.commitCheckpoint(pending.checkpoint,'drive:'+saved.fileId);assert.equal(await fresh.source.checkpointStatus(pending.checkpoint),'verified');
  assert.equal(c.calls,1);
  await assert.rejects(fresh.source.projectEvidence('unregistered',null),/not registered/);
  await assert.rejects(fresh.journal.readReference('drive:global'),/outside the owned/);
  const registry=projectSkills(fresh.source),context=await fresh.source.load();
  const evidence=await registry.dispatch({id:'find_project',version:2,input:{projectId:'atlas',operation:'evidence',evidence:'Atlas',source:'creation:1'}},{user:{text:'Show Atlas evidence'},context},'read');
  assert.equal(evidence.evidence.entries[0].text,'Synthetic original project authorization.');
});

test('one Living Mind engine commits Everyday and project packages, handoffs and cold recovery without raw RECENT',async()=>{
  const f=fixture(),client=f.open();
  const c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,e.context.currentProjectId?'project':'global','short',e.context.currentProjectId?'Private project next step.':'Everyday next step.','EXPAND',[unit(e.context.currentProjectId?'project-step':'global-step',e.context.currentProjectId?'Private plan.':'General plan.',e.user.source)])]}),[],{sessionId:'desktop'});
  await c.session.checkout();
  const g=await c.session.send('SYNTHETIC_RAW_GLOBAL: agree on our general plan.');await commit(client,await stage(client,g));
  assert.equal(f.files.get('global').record.livingMind.meaningRevision,1);
  await c.session.enterScope('atlas');const p=await c.session.send('SYNTHETIC_RAW_PRIVATE: agree on the project plan.');const pending=await stage(client,p);await commit(client,pending);
  const project=f.files.get('atlas').record;assert.equal(project.livingMind.scopeId,'project:atlas');assert.equal(project.short.length,1);
  assert.equal(f.files.get('global').record.livingMind.checkout,null);
  assert.equal(f.files.get(pending.fileId).appProperties.aidaMemory,'recent-project-v1');
  assert.ok((await client.journal.sleepEvidence()).entries.every(entry=>entry.event.turns.every(turn=>turn.scopeId==='everyday')));
  assert.equal(project.livingMind.affect.label,p.response.affect.label);
  assert.ok(!JSON.stringify(f.files.get('global').record).includes('SYNTHETIC_RAW_PRIVATE'));
  await c.session.enterScope('beta');await c.session.send('What is our situation here?');
  assert.ok(!JSON.stringify(c.last).includes('SYNTHETIC_RAW_PRIVATE'));assert.equal(c.last.context.currentState.scopeId,'project:beta');
  await c.session.handoff();
  const fresh=f.open(),cold=chat(fresh.source,()=>({}),[],{sessionId:'phone',recoverConversation:false});
  await cold.session.enterScope('atlas');await cold.session.send('Resume our work.');
  assert.equal(cold.last.context.currentState.short[0].text,'Private project next step.');
  assert.equal(cold.last.context.currentState.orientation.focus[0],'Private project next step.');
  assert.equal(cold.last.context.globalState.short[0].text,'Everyday next step.');
  assert.equal(cold.last.context.currentState.identity.name,cold.last.identity.name);
  assert.deepEqual(cold.last.memory.recent,[]);assert.deepEqual(cold.last.context.currentState.conversation,[]);
  assert.ok(!JSON.stringify(cold.last).includes('SYNTHETIC_RAW_PRIVATE'));
  assert.equal(await fresh.source.checkpointStatus(pending.checkpoint),'verified');
});

test('scope-owned affect and pending reflections survive the shared current-state commit; malformed identity or scope metadata fails closed',async()=>{
  const f=fixture();const mind=emptyMind('atlas');mind.affect={valence:-0.2,arousal:0.4,label:'concerned',expression:null};mind.pendingReflections=[{id:'reflection-1',text:'Consider the unresolved synthetic question.',sources:['creation:1']}];
  f.files.get('atlas').record.livingMind=mind;
  const client=f.open(),c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'project','short','A current project concern.','EXPAND',[unit('concern','A project concern.',e.user.source,'uncertainty')])]}),[],{sessionId:'reader'});
  await c.session.enterScope('atlas');const result=await c.session.send('A meaningful project concern.');await commit(client,await stage(client,result));
  assert.equal(c.last.affect.label,'concerned');assert.equal(f.files.get('atlas').record.livingMind.pendingReflections[0].id,'reflection-1');
  assert.ok(!JSON.stringify(f.files.get('global').record).includes('reflection-1'));
  assert.throws(()=>validateMind({...mind,identity:{name:'Another identity'}},'atlas'),/Invalid Living Mind/);
  assert.throws(()=>validateMind(mind,'beta'),/Invalid Living Mind/);
  const bad=f.open();f.files.get('atlas').record.livingMind={...mind,scopeId:'project:beta'};
  await assert.rejects(bad.source.project('atlas'),/Invalid Living Mind/);
});

test('no-change commits interaction/affect without advancing meaning; natural correction preserves other understanding after restart',async()=>{
  const f=fixture(),client=f.open();let action='initial';
  const c=chat(client.source,e=>action==='keep'?{}:{rebuild:action==='initial'?'meaningful_event':'correction',changes:[change(e,'global','short',action==='initial'?'Keep the goal; the code is the old one.':'Keep the goal; the code is the new one.',action==='initial'?'EXPAND':'REVISE',action==='initial'?[unit('goal','Keep the shared goal.',e.user.source),unit('old-code','Synthetic old code.',e.user.source,'claim')]:[unit('new-code','Synthetic corrected code.',e.user.source,'claim','old-code')])]} ,[],{sessionId:'session-a'});
  const first=await c.session.send('A meaningful synthetic goal and code.');await commit(client,await stage(client,first));
  action='keep';const keep=await c.session.send('Keep this conversation handoff.',{memoryDisposition:'candidate'});
  await commit(client,await stage(client,keep,'candidate'));
  let doc=f.files.get('global').record;assert.equal(doc.memoryBridge.revision,2);assert.equal(doc.livingMind.meaningRevision,1);assert.equal(doc.livingMind.lastInteractionAt,keep.turn.completedAt);assert.equal(doc.livingMind.lastMeaningfulAt,first.turn.completedAt);
  action='correct';const corrected=await c.session.send('Correction: the synthetic code changed; the goal stays.');await commit(client,await stage(client,corrected));
  doc=f.files.get('global').record;assert.deepEqual(doc.short[0].meaning.map(m=>m.id),['goal','new-code']);
  await c.session.handoff();
  const fresh=chat(f.open().source,()=>({}),[],{sessionId:'session-b',recoverConversation:false});await fresh.session.send('Continue.');
  assert.equal(fresh.last.context.currentState.short[0].text,'Keep the goal; the code is the new one.');
  assert.equal(fresh.last.context.currentState.meaningRevision,2);assert.equal(fresh.last.memory.recent.length,0);
});

test('checkout warns before provider calls; explicit takeover invalidates an old client and preserves authoritative packages',async()=>{
  const f=fixture(),left=f.open(),right=f.open(),a=chat(left.source,()=>({}),[],{sessionId:'left'}),b=chat(right.source,()=>({}),[],{sessionId:'right'});
  await a.session.checkout();
  await assert.rejects(b.session.send('Continue.'),e=>e.diagnostic==='mind_checkout_conflict');assert.equal(b.calls,0);
  await b.session.checkout({takeover:true});
  await assert.rejects(a.session.send('An old client tries again.'),e=>e.diagnostic==='mind_checkout_conflict');assert.equal(a.calls,0);
  await b.session.handoff();const c=chat(f.open().source,()=>({}),[],{sessionId:'later'});await c.session.send('Continue.');assert.equal(c.calls,1);
});

test('a response completed before takeover cannot overwrite a newer package; its saved evidence remains a non-current draft',async()=>{
  const f=fixture(),left=f.open(),right=f.open();
  const a=chat(left.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','An old uncommitted draft.','EXPAND',[unit('old-draft','An old draft.',e.user.source)])]}),[],{sessionId:'old-device'});
  const old=await stage(left,await a.session.send('A synthetic draft from the first device.'));
  const b=chat(right.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','The latest verified understanding.','EXPAND',[unit('current','The latest verified understanding.',e.user.source)])]}),[],{sessionId:'new-device'});
  await b.session.checkout({takeover:true});const latest=await stage(right,await b.session.send('A newer synthetic decision.'));await commit(right,latest);
  await assert.rejects(commit(left,old),/Checkout changed/);
  assert.equal(f.files.get('global').record.short[0].text,'The latest verified understanding.');assert.equal(a.calls,1);
  assert.equal(await left.source.checkpointStatus(old.checkpoint),'newer_state');
  assert.ok(old.fileId&&f.files.has(old.fileId));
});

test('room source support cannot be copied into a different journal scope',async()=>{
  const f=fixture(),client=f.open(),c=chat(client.source,()=>({}));
  await c.session.enterScope('atlas');const project=await c.session.send('Private synthetic room context.');
  await c.session.enterScope(null);const general=await c.session.send('Everyday conversation.');
  assert.throws(()=>makeJournalEvent(conversationId,{...general.turn,conversationId},'candidate',{...project.turn,conversationId}),/cannot cross room scopes/);
  assert.ok(!JSON.stringify(c.last).includes('Private synthetic room context.'));
});

test('a quick question under a real checkout changes no personal state, despite an over-eager proposal',async()=>{
  const f=fixture(),client=f.open(),c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','Unwanted incidental note.','EXPAND',[unit('incidental','Incidental note.',e.user.source)])]}),[],{sessionId:'ordinary-session'});
  const result=await c.session.send('How do you spell rhythm?',{memoryDisposition:'ephemeral'});
  assert.equal(checkpointEligible(result,'ephemeral'),false);
  const doc=f.files.get('global').record;assert.deepEqual(doc.short,[]);assert.equal(doc.livingMind.meaningRevision,0);assert.deepEqual(doc.livingMind.conversation,[]);
  assert.equal(f.writes.filter(w=>w.kind==='journal').length,0);assert.equal(doc.livingMind.lastInteractionAt,null);
});
