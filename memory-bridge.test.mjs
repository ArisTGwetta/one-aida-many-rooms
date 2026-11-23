import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createContextSource, createAwakeSteward, journalReceipt } from './awake-context.mjs';
import { createConversationSession, parseConversationResponse } from './conversation.mjs';
import { createJournal, makeJournalEvent, dispositionFor } from './recent-journal.mjs';
import { checkpointEligible, evolve, validateCheckpoint, validateOperation, safeReceipt, scopeAllowed } from './memory-bridge.mjs';
import { projectSkills } from './project-skills.mjs';
import { skillDescriptor } from './skill-registry.mjs';
import {emptyMind,validateMind} from './living-mind.mjs';
import {createProviders} from './providers.mjs';
import {tokenCount,promptBudget} from './prompt-budget.mjs';
import {validateConsolidation} from './recent-plus.mjs';
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
function semanticFields(e,proposed={}){
  if(!e.context?.memoryReview)return proposed;
  const orientation=proposed.orientation??{focus:null,unfinished:[]},changed=proposed.changes?.some(c=>c.operation!=='KEEP')||proposed.candidates?.length||proposed.contradictions?.length||orientation.focus||orientation.unfinished.length;
  return{...proposed,orientation,evaluation:proposed.evaluation??{version:1,reviewId:e.context.memoryReview.id,scopeId:e.context.memoryReview.scopeId,decision:changed?'change':'no_change',domain:'everyday',outcome:changed?'updated_understanding':'reviewed_discarded',reason:changed?'The supplied synthetic evidence supports this working update.':'Reviewed the supplied evidence; no further useful interpretation is supported.',sources:[e.context.memoryReview.sources.at(-1)],assessed:['short','long','orientation','unfinished','contradictions'],coveredSources:e.context.memoryReview.sources,observations:[]}};
}
function chat(source, propose=()=>({}), bindings=[],options={}) {
  let calls=0,last; const steward=createAwakeSteward(source,{skills:projectSkills(source,bindings),sessionId:options.sessionId??null});
  const session=createConversationSession({steward,memoryStore:{recall:async()=>null},recoverConversation:options.recoverConversation??true,mode:options.mode??'legacy',stateStore:source,archiveTurns:options.archiveTurns,provider:async e=>{
    calls++;last=e;const proposed=e.context?.memoryReview?.reviewOnly?(options.reviewPropose?.(e)??{}):propose(e);
    if(proposed.skillRequest)return JSON.stringify(proposed);
    return JSON.stringify({version:'0.2',reply:'Synthetic conversational reply.',intent:'conversation',route:'reply',affect:e.affect,
      candidates:{facts:[],insights:[],short:[],long:[]},tools:[],awake:{action:{kind:'just_keep_talking',target:null,arguments:[],sources:[],uncertainty:null},rebuild:null,changes:[],candidates:[],contradictions:[],...semanticFields(e,proposed)}});
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

async function ordinaryChat(f,propose,{mode='temporary',mutateResponse,consolidation=false,canonicalFacts=async()=>[]}={}){
  const app=await readFile(new URL('./app.mjs',import.meta.url),'utf8'),client=f.open(),requests=[],exchanges=[],budgets=[],nodes=new Map();let completed;
  const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,disabled:false,hidden:false,textContent:'',handlers:{},addEventListener(name,action){this.handlers[name]=action;},dispatchEvent(){},setAttribute(){}});return nodes.get(id);};
  const sandbox={byId:get,conversationId,conversationMode:mode,providerCalls:[],selection:{provider:'openai',model:'gpt-6-luna'},pending:undefined,preceding:undefined,sources:[],disposition:'ephemeral',support:get('journal-support'),retention:get('retention'),message:get('message'),send:get('send'),transcript:get('transcript'),details:get('conversation-details'),journalStatus:get('journal-status'),chatStatus:get('chat-status'),projectData:get('project-preview-data'),projectStatus:get('project-save-status'),projectPanel:get('project-preview'),palace:{conversationEvidence:()=>undefined},glasses:{snapshot:()=>undefined},chatt:{offer(){}},localDevelopment:false,select:{value:'openai'},appendExchange:t=>exchanges.push(t),showBudget(){},showJournalContext(){},clearProjectPreview(){},prepareSelection:async()=>({provider:'openai',model:'gpt-6-luna'}),run:(_label,action)=>{completed=Promise.resolve().then(action);return completed;},CustomEvent:class{},Date,JSON,Error,dispositionFor,availableSupport:()=>undefined,visualReceipt:()=>undefined,checkpointEligible,journalReceipt,makeJournalEvent,contextSource:client.source,journal:client.journal};
  const invoke=createProviders({apiKey:'synthetic-key',fetchRequest:async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body),e=JSON.parse(body.input);requests.push(body);const proposed=propose(e);
    const reply={version:'0.2',reply:'Synthetic ordinary Chat reply.',intent:'conversation',route:'reply',affect:e.affect,candidates:{facts:[],insights:[],short:[],long:[]},tools:[],awake:{action:{kind:'just_keep_talking',target:null,arguments:[],sources:[],uncertainty:null},rebuild:null,changes:[],candidates:[],contradictions:[],...semanticFields(e,proposed)}};
    return Response.json({status:'completed',model:'gpt-6-luna',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({result:mutateResponse?mutateResponse(reply,e):reply})}]}],usage:{input_tokens:10,output_tokens:10}});
  }});
  sandbox.session=createConversationSession({steward:createAwakeSteward(client.source,{sessionId:'ordinary-chat'}),stateStore:client.source,mode,consolidation,loadCanonicalFacts:canonicalFacts,sessionId:'ordinary-chat',conversationId,memoryStore:{recall:async()=>null},provider:async e=>{const r=await invoke({provider:'openai',model:'gpt-6-luna',envelope:e});budgets.push(r.promptBudget);sandbox.providerCalls.push({purpose:'offline_ordinary_chat',provider:'openai',model:r.model,usage:r.usage,promptBudget:r.promptBudget});return r.raw;}});
  const inspect=app.slice(app.indexOf('  function refreshMindInspector(){'),app.indexOf('  function mindTrace('));
  const trace=app.slice(app.indexOf('  function mindTrace('),app.indexOf('  function mindContext('));
  const save=app.slice(app.indexOf('  async function savePending() {'),app.indexOf('\n  byId("journal-resume")'));
  const handler=app.slice(app.indexOf('  byId("chat-form").addEventListener("submit"'),app.indexOf('\n  return async () => {'));
  runInNewContext(`let mindEvidence={};${inspect}${trace}${save}${handler}`,sandbox);
  return{client,session:sandbox.session,requests,exchanges,budgets,get,async send(text){get('message').value=text;get('chat-form').handlers.submit({preventDefault(){}});return completed;}};
}
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
    journalReceipt,makeJournalEvent,conversationId,journalStatus,session:c.session,byId:id=>id==='context-status'?status:{textContent:''},mindTrace:()=>{},Date,JSON,Error
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

test('JUST CHATTING uses the same evolving working package without checkout, journal, or context writes; Sleep discard is private',async()=>{
  const f=fixture(),client=f.open();let n=0;
  const c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','A session-local evolving plan.','EXPAND',[unit('temporary-'+(++n),'A synthetic plan step '+n,e.user.source)])],candidates:[{scope:'global',layer:'insights',text:'A tentative session-local insight.',sources:[e.user.source],rationale:'Synthetic evidence.'}]}),[],{sessionId:'temporary-device',mode:'temporary'});
  await c.session.checkout();const before=JSON.stringify([...f.files]);
  await c.session.send('RAW_TEMPORARY_EXCHANGE_ONE');await c.session.send('RAW_TEMPORARY_EXCHANGE_TWO');
  assert.equal(c.last.context.memoryMode,'temporary');assert.equal(c.last.context.currentState.short[0].text,'A session-local evolving plan.');assert.equal(c.last.context.currentState.review.candidates.length,1);
  assert.equal(c.session.memoryStatus.meaningfulChanges,true);assert.equal(c.session.memoryStatus.current.meaningRevision,2);assert.equal(f.writes.length,0);
  assert.equal((await c.session.endSession()).needsDecision,true);assert.equal(f.writes.length,0);
  await c.session.endSession('discard');assert.equal(JSON.stringify([...f.files]),before);assert.equal(c.session.memoryStatus.meaningfulChanges,false);
  const cold=chat(f.open().source,()=>({}),[],{sessionId:'cold',mode:'temporary'});await cold.session.send('Continue.');assert.deepEqual(cold.last.context.currentState.short,[]);assert.ok(!JSON.stringify(cold.last).includes('RAW_TEMPORARY'));
});

test('temporary Sleep preservation commits understanding only through the real conditional writer; fresh recovery excludes raw conversation',async()=>{
  const f=fixture(),client=f.open();const c=chat(client.source,e=>({rebuild:'meaningful_event',changes:['short','long'].map(layer=>change(e,'global',layer,'A synthetic durable goal.','EXPAND',[unit('goal-'+layer,'A synthetic durable goal.',e.user.source)]))}),[],{mode:'temporary',sessionId:'sleep-device'});
  await c.session.send('RAW_PRIVATE_SLEEP_CONVERSATION');assert.equal(f.writes.length,0);
  assert.equal((await c.session.setMode('durable')).needsChoice,true);assert.equal(f.writes.length,0);
  const preserved=await c.session.endSession('understanding');assert.equal(preserved.verified.status,'verified');assert.equal(c.session.memoryStatus.mode,'temporary');
  assert.equal(f.writes.filter(w=>w.kind==='journal').length,0);
  const doc=f.files.get('global').record;assert.equal(doc.memoryBridge.journalReference,null);assert.equal(doc.memoryBridge.stateReceipt.authority,'explicit-user-consent');assert.deepEqual(doc.livingMind.conversation,[]);assert.equal(doc.livingMind.checkout,null);
  assert.ok(!JSON.stringify(doc).includes('RAW_PRIVATE_SLEEP_CONVERSATION'));assert.equal(doc.memoryBridge.stateReceipt.sources.length,4);
  const fresh=chat(f.open().source,()=>({}),[],{mode:'temporary',sessionId:'later',recoverConversation:false});await fresh.session.send('What is our goal?');assert.equal(fresh.last.context.currentState.short[0].text,'A synthetic durable goal.');assert.equal(fresh.last.context.currentState.long[0].text,'A synthetic durable goal.');assert.deepEqual(fresh.last.memory.recent,[]);assert.ok(!JSON.stringify(fresh.last).includes('RAW_PRIVATE_SLEEP_CONVERSATION'));
  const fake={version:1,operationId:'forged',plans:[]};await assert.rejects(client.source.commitUnderstanding(fake),/explicitly approved/);
});

test('temporary-to-durable choices separately authorize raw exchanges, understanding, both, or neither',async()=>{
  for(const choice of ['exchanges','understanding','both','neither']){
    const f=fixture(),client=f.open();const archive=async results=>{for(const r of results)await client.journal.save({event:makeJournalEvent(conversationId,{...r.turn,conversationId},'candidate')});};
    const c=chat(client.source,e=>e.user.text==='RAW_SELECTED_TEMPORARY_PORTION'?({rebuild:'meaningful_event',changes:[change(e,'global','short','A synthetic selected understanding.','EXPAND',[unit('selected','Selected understanding.',e.user.source)])]}):{},[],{mode:'temporary',sessionId:'chooser',archiveTurns:archive});
    await c.session.send('RAW_SELECTED_TEMPORARY_PORTION');await c.session.setMode('durable',choice);
    const doc=f.files.get('global').record;assert.equal(doc.short.length,['understanding','both'].includes(choice)?1:0);
    assert.equal(f.writes.filter(w=>w.kind==='journal').length,['exchanges','both'].includes(choice)?1:0);
    await c.session.send('A new durable conversation.');assert.ok(!JSON.stringify(c.last).includes('RAW_SELECTED_TEMPORARY_PORTION'));
  }
});

test('understanding-only failures preserve local work and retry without another model call or duplicate revision',async()=>{
  const f=fixture(),client=f.open(),c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','Retry the synthetic plan.','EXPAND',[unit('retry','Retry plan.',e.user.source)])]}),[],{mode:'temporary',sessionId:'retry-device'});
  await c.session.send('A temporary plan to preserve.');let fails=true;
  f.fail((doc,phase)=>doc.memoryBridge&&phase==='context-after'&&fails&&(fails=false,true));
  await assert.rejects(c.session.setMode('durable','understanding'));assert.equal(c.session.memoryStatus.mode,'temporary');assert.equal(c.session.memoryStatus.meaningfulChanges,true);
  const afterReviewCalls=c.calls;f.fail(null);const saved=await c.session.setMode('durable','understanding');assert.equal(saved.verified.status,'verified');assert.equal(c.calls,afterReviewCalls);assert.equal(f.files.get('global').record.memoryBridge.revision,1);
});

test('a temporary stale writer cannot preserve over a newer committed understanding',async()=>{
  const f=fixture(),left=f.open(),right=f.open();
  const a=chat(left.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','A stale temporary plan.','EXPAND',[unit('stale','Stale plan.',e.user.source)])]}),[],{mode:'temporary',sessionId:'left'});
  await a.session.send('First temporary plan.');
  const b=chat(right.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','The newer committed plan.','EXPAND',[unit('newest','Newest plan.',e.user.source)])]}),[],{sessionId:'right'});
  const result=await b.session.send('Newer durable plan.');await commit(right,await stage(right,result));await b.session.handoff();
  await assert.rejects(a.session.setMode('durable','understanding'),/changed during temporary conversation/);
  assert.equal(f.files.get('global').record.short[0].text,'The newer committed plan.');assert.equal(a.session.memoryStatus.meaningfulChanges,true);
});

test('the same temporary-to-durable engine recovers a private project without RECENT and keeps Everyday and a second project clean',async()=>{
  const f=fixture(),client=f.open(),c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'project','short','A private synthetic project goal.','EXPAND',[unit('private','A private synthetic project goal.',e.user.source)])]}),[],{mode:'temporary',sessionId:'project-device'});
  await c.session.enterScope('atlas');await c.session.send('RAW_PRIVATE_PROJECT_PORTION');await assert.rejects(c.session.enterScope(null),/Resolve or discard/);
  await c.session.setMode('durable','understanding');await c.session.handoff();
  const cold=chat(f.open().source,()=>({}),[],{mode:'temporary',sessionId:'project-later',recoverConversation:false});await cold.session.enterScope('atlas');await cold.session.send('Resume this project.');
  assert.equal(cold.last.context.currentState.short[0].text,'A private synthetic project goal.');assert.deepEqual(cold.last.memory.recent,[]);assert.ok(!JSON.stringify(cold.last).includes('RAW_PRIVATE_PROJECT_PORTION'));
  await cold.session.discardTemporary();await cold.session.enterScope(null);await cold.session.send('Everyday conversation.');assert.ok(!JSON.stringify(cold.last).includes('private synthetic project goal'));
  await cold.session.discardTemporary();await cold.session.enterScope('beta');await cold.session.send('Different project.');assert.ok(!JSON.stringify(cold.last).includes('private synthetic project goal'));
});

test('a no-change temporary Sleep needs no approval and writes nothing; quick questions stay private',async()=>{
  const f=fixture(),c=chat(f.open().source,()=>({}),[],{mode:'temporary',sessionId:'incidental'});
  await c.session.send('How do you spell rhythm?');assert.equal(c.session.memoryStatus.meaningfulChanges,false);const ended=await c.session.endSession();assert.equal(ended.ended,true);assert.equal(ended.needsDecision,undefined);assert.equal(f.writes.length,0);
});

test('failed durable-mode acquisition keeps the temporary privacy label and pending working state; inspection is read-only',async()=>{
  const f=fixture(),a=chat(f.open().source,()=>({}),[],{sessionId:'owner'});await a.session.checkout();
  const b=chat(f.open().source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','An unsaved temporary idea.','EXPAND',[unit('idea','An unsaved temporary idea.',e.user.source)])]}),[],{mode:'temporary',sessionId:'visitor'});
  await b.session.send('A temporary idea.');const count=f.writes.length;
  const inspected=await b.session.inspect();assert.equal(inspected.inspectionOnly,true);assert.deepEqual(inspected.currentState.short,[]);assert.equal(f.writes.length,count);
  await assert.rejects(b.session.setMode('durable','understanding'),e=>e.diagnostic==='mind_checkout_conflict');assert.equal(b.session.memoryStatus.mode,'temporary');assert.equal(b.session.memoryStatus.meaningfulChanges,true);assert.equal(f.writes.length,count);
  await b.session.endSession('discard');assert.equal(f.writes.length,count);
});

test('switching durable to temporary stops future writes without erasing committed understanding; durable Sleep releases ownership',async()=>{
  const f=fixture(),client=f.open();let n=0;
  const c=chat(client.source,e=>({rebuild:'meaningful_event',changes:[change(e,'global','short','Goal step '+(++n),'EXPAND',[unit('step-'+n,'Synthetic goal step '+n,e.user.source)])]}),[],{mode:'durable',sessionId:'durable'});
  const first=await c.session.send('First durable goal.');await commit(client,await stage(client,first));await c.session.endSession();assert.equal(f.files.get('global').record.livingMind.checkout,null);
  await c.session.setMode('temporary');const count=f.writes.length,previous=structuredClone(f.files.get('global').record);
  await c.session.send('Second temporary goal.');assert.equal(c.session.memoryStatus.current.short[0].text,'Goal step 2');await c.session.endSession('discard');assert.equal(f.writes.length,count);assert.deepEqual(f.files.get('global').record,previous);
});

test('temporary corrections preserve unrelated meanings when explicitly saved and recovered without supplied journal turns',async()=>{
  const f=fixture(),client=f.open();let corrected=false;
  const c=chat(client.source,e=>({rebuild:corrected?'correction':'meaningful_event',changes:[change(e,'global','short',corrected?'The goal remains; code two replaces code one.':'The goal and code one.',corrected?'REVISE':'EXPAND',corrected?[unit('code-two','Synthetic new code.',e.user.source,'claim','code-one')]:[unit('goal','Preserve the synthetic goal.',e.user.source),unit('code-one','Synthetic old code.',e.user.source,'claim')])]}),[],{mode:'temporary',sessionId:'correction'});
  const old=await c.session.send('RAW_OLD_CODE');corrected=true;await c.session.send('RAW_NEW_CODE');await c.session.endSession('understanding');
  const doc=f.files.get('global').record;assert.deepEqual(doc.short[0].meaning.map(u=>u.id),['goal','code-two']);assert.ok(!JSON.stringify(doc).includes('RAW_OLD_CODE'));assert.ok(!JSON.stringify(doc).includes('RAW_NEW_CODE'));
  const coldClient=f.open(),steward=createAwakeSteward(coldClient.source,{skills:projectSkills(coldClient.source),sessionId:'cold'});let sent;
  const fresh=createConversationSession({steward,stateStore:coldClient.source,mode:'temporary',recoverConversation:false,recoveredTurns:[old.turn],memoryStore:{recall:async()=>null},provider:async envelope=>{sent=envelope;return JSON.stringify({version:'0.2',reply:'The current plan.',intent:'conversation',route:'reply',affect:envelope.affect,candidates:{facts:[],insights:[],short:[],long:[]},tools:[],awake:{action:{kind:'just_keep_talking',target:null,arguments:[],sources:[],uncertainty:null},rebuild:null,changes:[],candidates:[],contradictions:[],...semanticFields(envelope)}});}});
  await fresh.send('What is our current plan?');assert.deepEqual(sent.memory.recent,[]);assert.equal(sent.context.currentState.short[0].text,'The goal remains; code two replaces code one.');assert.ok(!JSON.stringify(sent).includes('RAW_OLD_CODE'));
});

test('project lookup does not absorb private project knowledge into an existing temporary Everyday package',async()=>{
  const f=fixture();f.files.get('atlas').record.short=[{source:'creation:1',text:'PRIVATE_ATLAS_KNOWLEDGE'}];
  const c=chat(f.open().source,e=>e.user.text==='Our temporary goal.'?{rebuild:'meaningful_event',changes:[change(e,'global','short','A temporary global goal.','EXPAND',[unit('goal','A temporary global goal.',e.user.source)])]}:{},[],{mode:'temporary',sessionId:'reader'});
  await c.session.send('Our temporary goal.');const lookup=await c.session.send('What is the Atlas situation?');assert.equal(lookup.receipt.outcome.status,'project_looked_up');assert.equal(c.steward.activeProjectId,null);assert.equal(c.session.memoryStatus.scopeId,'everyday');assert.ok(!JSON.stringify(c.session.memoryStatus.current).includes('PRIVATE_ATLAS_KNOWLEDGE'));
  await c.session.send('Continue our global goal.');assert.ok(!JSON.stringify(c.last).includes('PRIVATE_ATLAS_KNOWLEDGE'));assert.equal(f.writes.length,0);
});

test('cancelling the ordinary Sleep handoff prevents reflective provider calls and all storage access',async()=>{
  const {setupSleepPanel}=await import('./sleep-panel.mjs');const original=globalThis.document,nodes=new Map();let accesses=0;
  const node=()=>({handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},replaceChildren(){},querySelector(){return{focus(){}};}});
  const byId=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};globalThis.document={getElementById:byId};
  try{
    setupSleepPanel({store:{},journal:{async sleepEvidence(){accesses++;throw Error('Must not read.');}},provider(){accesses++;throw Error('Must not call.');},beforeRun:async()=>false,run:(_label,action)=>action()});
    assert.match(await byId('sleep-run').handlers.click(),/Sleep cancelled/);assert.equal(accesses,0);
  }finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});

test('ordinary Chat Send immediately evolves fictional SHORT, grounded commitments and focus; a consultation can be reviewed and discarded',async()=>{
  const f=fixture();
  const ui=await ordinaryChat(f,e=>{
    if(e.context.memoryReview.reviewOnly)return{};
    const text=e.user.text,scope='global',base={};
    if(text.startsWith('Adventure:'))Object.assign(base,{changes:[change(e,scope,'short','Fictional activity: take the Ring toward Rivendell while Gandalf is missing.','EXPAND',[unit('ring-goal','Fictional mission: destroy the Ring.',e.user.source),unit('active-focus','Proceed to Rivendell for help.',e.user.source)])],orientation:{focus:{text:'Fictional adventure toward Rivendell.',sources:[e.user.source]},unfinished:[]}});
    if(text.startsWith('Promise:'))base.orientation={focus:null,unfinished:[{operation:'add',text:'Continue the fictional adventure tomorrow.',sources:[e.user.source]}]};
    if(text.startsWith('Switch:'))Object.assign(base,{changes:[change(e,scope,'short','Current fictional activity: Moon bakery; a dragon pays with seashells. The earlier adventure is not declared permanently abandoned.','REVISE',[unit('earlier-goal','An earlier fictional Ring mission; no permanent abandonment established.',e.user.source,'interpretation','ring-goal'),unit('bakery-focus','Run a fictional Moon bakery with a dragon customer.',e.user.source,'interpretation','active-focus')])],orientation:{focus:{text:'Fictional Moon bakery.',sources:[e.user.source]},unfinished:[]}});
    const fields=semanticFields(e,base);fields.evaluation.domain=text.startsWith('How')?'consultation':'fictional';return fields;
  });
  await ui.send('Adventure: take the Ring toward Rivendell; Gandalf has disappeared.');
  assert.equal(ui.session.memoryStatus.current.short.length,1);assert.equal(ui.session.memoryStatus.current.meaningRevision,1);
  await ui.send('Promise: we will continue this adventure tomorrow.');assert.deepEqual(ui.session.memoryStatus.current.orientation.unfinished,['Continue the fictional adventure tomorrow.']);
  await ui.send('Switch: open a bakery on the Moon; a dragon pays in seashells.');
  let state=ui.session.memoryStatus;assert.equal(state.current.orientation.focus[0],'Fictional Moon bakery.');assert.equal(state.current.orientation.unfinished.length,1);assert.match(state.current.short[0].text,/not declared permanently abandoned/);assert.equal(state.current.facts.length,0);
  const meaningRevision=state.current.meaningRevision;await ui.send('How do you spell rhythm?');state=ui.session.memoryStatus;
  assert.equal(state.current.meaningRevision,meaningRevision);assert.equal(state.review.last.outcome,'reviewed_discarded');assert.match(state.review.last.reason,/Reviewed/);assert.equal(ui.exchanges.length,4);assert.equal(ui.requests.length,4);assert.equal(f.writes.length,0);
  const inspector=JSON.parse(ui.get('mind-inspector-state').textContent);assert.equal(inspector.lastMemoryEvaluation.outcome,'reviewed_discarded');assert.equal(inspector.mode,'temporary');assert.equal(inspector.orientation.unfinished.length,1);assert.equal(inspector.diagnostics.turnSequence,4);
  assert.ok(JSON.parse(ui.requests[3].input).context.memoryReview.triggers.includes('before_compaction'));
  assert.match(ui.requests[0].instructions,/mandatory reflection, not mandatory retention/);assert.equal(ui.requests[0].text.format.schema.properties.result.anyOf[0].properties.awake.required.includes('evaluation'),true);
});

test('deferred pre-compaction review preserves the exact packet and ordinary Chat reply for retry before Sleep or discard',async()=>{
  const f=fixture();let defer=true;const c=chat(f.open().source,e=>{
    if(!e.context.memoryReview.triggers.includes('before_compaction'))return{};
    if(defer){const fields=semanticFields(e);fields.evaluation={...fields.evaluation,decision:'deferred',outcome:'deferred',reason:'The meaning cannot yet be reviewed safely.'};return fields;}return{};
  },[],{mode:'temporary',reviewPropose:e=>{if(defer){const fields=semanticFields(e);fields.evaluation={...fields.evaluation,decision:'deferred',outcome:'deferred',reason:'Review remains deferred.'};return fields;}return{};}});
  for(let n=0;n<4;n++)await c.session.send('Synthetic developing turn '+n);
  const failedPacket=c.last.context.memoryReview.sources;assert.equal(c.session.memoryStatus.diagnostics.recentMessages,8);assert.equal(c.session.memoryStatus.review.last.status,'deferred');assert.ok(failedPacket.every(ref=>c.session.memoryStatus.review.pendingSources.includes(ref)));
  await assert.rejects(c.session.endSession(),e=>e.diagnostic==='memory_review_deferred');assert.equal(c.session.memoryStatus.diagnostics.recentMessages,8);assert.ok(failedPacket.every(ref=>c.session.memoryStatus.review.pendingSources.includes(ref)));
  defer=false;await c.session.review('retry');assert.ok(failedPacket.every(ref=>c.last.context.memoryReview.sources.includes(ref)));assert.equal(c.session.memoryStatus.review.unreviewedSources,0);assert.equal(c.session.memoryStatus.review.last.outcome,'reviewed_discarded');assert.equal(f.writes.length,0);
});

test('a failed ordinary provider review preserves evidence and does not regenerate the conversational turn on explicit review retry',async()=>{
  const f=fixture();let failed=true;
  const c=chat(f.open().source,e=>{if(failed)throw Error('Synthetic provider outage.');return{};},[],{mode:'temporary'});
  await assert.rejects(c.session.send('A meaningful pending user message.'));
  const source=c.session.memoryStatus.review.pendingSources[0];assert.ok(source);assert.equal(c.session.memoryStatus.diagnostics.turnSequence,0);
  failed=false;await c.session.review('retry');assert.ok(c.last.context.memoryReview.sources.includes(source));assert.equal(c.session.memoryStatus.review.unreviewedSources,0);assert.equal(c.session.memoryStatus.diagnostics.turnSequence,0);assert.equal(f.writes.length,0);
});

test('checkpoint reviews recurring letters as an observation, and a later explanation revises provenance without hindsight',async()=>{
  const f=fixture();const c=chat(f.open().source,e=>{
    const fields=semanticFields(e),packet=e.context.memoryReview;
    if(packet.triggers.includes('interval_20')){
      fields.evaluation={...fields.evaluation,domain:'uncertain',outcome:'provisional_observation',reason:'The evidence shows a sequence of letters; its purpose is unknown.',observations:[{id:'letters',kind:'observation',text:'Successive alphabet letters were sent; the purpose is unknown.',sources:[packet.evidence[0].source,e.user.source],relatesTo:[],disposition:'carry'}]};
    }else if(e.user.text.includes('imaginary niece')){
      fields.evaluation={...fields.evaluation,outcome:'provisional_observation',reason:'A new user explanation contextualizes the earlier observation.',observations:[{id:'explanation',kind:'observation',text:'The user later explained that an imaginary niece had borrowed the phone. That explanation was not known during the letter sequence.',sources:[e.user.source,packet.priorObservations.find(o=>o.id==='letters').source],relatesTo:['letters'],disposition:'carry'}]};
    }return fields;
  },[],{mode:'temporary'});
  for(let n=0;n<20;n++)await c.session.send(String.fromCharCode(65+n));
  const packet=c.last.context.memoryReview;assert.ok(packet.triggers.includes('interval_20'));assert.equal(packet.evidence.filter(e=>e.role==='user').length,20);assert.equal(c.session.memoryStatus.review.last.outcome,'provisional_observation');assert.equal(c.session.memoryStatus.current.short.length,0);assert.equal(c.session.memoryStatus.current.facts.length,0);
  await c.session.send('My imaginary niece borrowed the phone.');const history=c.session.memoryStatus.review.observations;
  assert.equal(history.find(o=>o.id==='letters').status,'superseded');assert.equal(history.find(o=>o.id==='explanation').relatesTo[0],'letters');assert.match(history.find(o=>o.id==='explanation').text,/not known/);assert.equal(f.writes.length,0);
});

test('twenty routine spelling consultations produce accountable discard receipts rather than a personal trait',async()=>{
  const f=fixture(),c=chat(f.open().source,e=>{const fields=semanticFields(e);fields.evaluation.domain='consultation';fields.evaluation.reason='Reviewed routine spelling consultations. No personal preference, trait or useful continuing observation is supported.';return fields;},[],{mode:'temporary'});
  for(let n=0;n<20;n++)await c.session.send('How do you spell syntheticword'+n+'?');
  assert.ok(c.last.context.memoryReview.triggers.includes('interval_20'));const state=c.session.memoryStatus;assert.equal(state.review.last.outcome,'reviewed_discarded');assert.equal(state.review.last.observations.length,0);assert.deepEqual(state.current.short,[]);assert.deepEqual(state.current.facts,[]);assert.equal(f.writes.length,0);
});

test('recurring sensitive topics support tentative connections only, never personal health or travel facts',async()=>{
  const f=fixture(),c=chat(f.open().source,e=>{
    const fields=semanticFields(e);fields.evaluation.domain='consultation';
    if(e.context.memoryReview.triggers.includes('before_compaction'))fields.evaluation={...fields.evaluation,outcome:'provisional_observation',reason:'Topics recur, but no personal circumstances or purpose were stated.',observations:[{id:'topics',kind:'observation',text:'French spelling, Paris and a medical topic recur in these questions.',sources:[e.context.memoryReview.sources[0],e.user.source],relatesTo:[],disposition:'carry'},{id:'connection',kind:'hypothesis',text:'The topics might be related; the connection and the user circumstances are unknown.',sources:[e.context.memoryReview.sources[0],e.user.source],relatesTo:[],disposition:'carry'}]};return fields;
  },[],{mode:'temporary'});
  for(const text of ['French spelling question.','A question about Paris.','A general question about a medical condition.','Another French spelling question.'])await c.session.send(text);
  const state=c.session.memoryStatus;assert.equal(state.review.observations.find(o=>o.id==='connection').kind,'hypothesis');assert.deepEqual(state.current.facts,[]);assert.deepEqual(state.current.short,[]);assert.equal(f.writes.length,0);
});

test('ordinary Chat durable path verifies a real adapter checkpoint in synthetic Drive and cold recovery excludes original RECENT',async()=>{
  const f=fixture(),ui=await ordinaryChat(f,e=>e.context.memoryReview.reviewOnly?{}:{changes:[change(e,'global','short','A durable synthetic plan.','EXPAND',[unit('plan','A durable synthetic plan.',e.user.source)])]},{mode:'durable'});
  await ui.send('Please keep our synthetic plan for tomorrow.');assert.equal(f.files.get('global').record.short[0].text,'A durable synthetic plan.');assert.match(ui.get('journal-status').textContent,/Saved and verified/);assert.equal(ui.session.memoryStatus.current.revision,1);assert.ok(!JSON.stringify(f.files.get('global').record).includes('reviewed_discarded'));
  await ui.session.handoff();const cold=chat(f.open().source,()=>({}),[],{mode:'temporary',recoverConversation:false,sessionId:'fresh'});await cold.session.send('What is our plan?');assert.equal(cold.last.context.currentState.short[0].text,'A durable synthetic plan.');assert.deepEqual(cold.last.memory.recent,[]);assert.ok(!JSON.stringify(cold.last).includes('Please keep our synthetic plan for tomorrow.'));assert.notEqual(cold.session.memoryStatus.diagnostics.sessionId,ui.session.memoryStatus.diagnostics.sessionId);
});

test('Sleep must reflect on unreviewed evidence even if ordinary turns previously proposed no change',async()=>{
  const f=fixture(),c=chat(f.open().source,()=>({}),[],{mode:'temporary',reviewPropose:e=>({changes:[change({...e,user:e.context.memoryReview.evidence[0]},'global','short','Fictional next step identified during Sleep review.','EXPAND',[unit('sleep-step','A fictional next step.',e.context.memoryReview.evidence[0].source)])],orientation:{focus:null,unfinished:[{operation:'add',text:'Continue this fictional activity tomorrow.',sources:[e.context.memoryReview.evidence[0].source]}]}})});
  await c.session.send('A synthetic fictional activity with a next step.');assert.deepEqual(c.session.memoryStatus.current.short,[]);
  const ended=await c.session.endSession();assert.equal(ended.needsDecision,true);assert.equal(c.session.memoryStatus.current.short.length,1);assert.equal(c.session.memoryStatus.review.last.outcome,'updated_understanding');assert.ok(c.last.context.memoryReview.triggers.includes('sleep'));
  const calls=c.calls;await c.session.endSession('discard');assert.equal(c.calls,calls);assert.equal(f.writes.length,0);
});

test('review-only durable changes use the existing conditional writer and retry a lost save without repeating model calls',async()=>{
  const f=fixture(),client=f.open(),c=chat(client.source,()=>({}),[],{mode:'durable',sessionId:'review-writer',reviewPropose:e=>({changes:[change({...e,user:e.context.memoryReview.evidence[0]},'global','short','A reviewed durable synthetic goal.','EXPAND',[unit('review-goal','Reviewed goal.',e.context.memoryReview.evidence[0].source)])]})});
  await c.session.send('A durable conversation with a synthetic goal.');await c.session.review('sleep');assert.ok(c.session.memoryStatus.review.pendingCommit);
  const calls=c.calls;let failed=true;f.fail((doc,phase)=>doc.memoryBridge&&phase==='context-after'&&failed&&(failed=false,true));
  await assert.rejects(c.session.commitReview());assert.ok(c.session.memoryStatus.review.pendingCommit);await assert.rejects(c.session.send('Another turn.'),/Verify the pending/);
  f.fail(null);assert.equal((await c.session.review('retry')).reused,true);const saved=await c.session.commitReview();assert.equal(saved.status,'verified');assert.equal(c.calls,calls);assert.equal(f.files.get('global').record.memoryBridge.revision,1);assert.equal(c.session.memoryStatus.review.pendingCommit,null);
  const raw=JSON.stringify([...f.files.values()]);assert.ok(!raw.includes('reviewed_discarded'));assert.equal(f.writes.filter(w=>w.kind==='journal').length,0);
});

test('ordinary Chat rejects unjustified no-change, fabricated citations, wrong coverage, competing proposal paths and fictional personal facts',async()=>{
  const mutations=[
    [reply=>{delete reply.awake.evaluation;},'awake_shape'],
    [reply=>{reply.awake.evaluation.reason='';},'memory_evaluation_reason'],
    [reply=>{reply.awake.evaluation.coveredSources=[];},'memory_evaluation_coverage'],
    [reply=>{reply.awake.evaluation.sources=['invented:source'];},'memory_evaluation_sources'],
    [(reply,e)=>{reply.candidates.short=[{text:'A second proposal route.',sources:[e.user.source],supersedes:null}];},'memory_legacy_candidates'],
    [(reply,e)=>{reply.awake.orientation.unfinished=[{operation:'resolve',text:'An invented commitment.',sources:[e.user.source]}];reply.awake.evaluation.decision='change';reply.awake.evaluation.outcome='updated_understanding';},'memory_commitment'],
    [(reply,e)=>{reply.awake.evaluation.domain='fictional';reply.awake.evaluation.decision='change';reply.awake.evaluation.outcome='updated_understanding';reply.awake.candidates=[{scope:'global',layer:'facts',text:'An unsupported real-world personal fact.',sources:[e.user.source],rationale:'Invented from fiction.'}];},'memory_domain_fact']
  ];
  for(const [mutate,diagnostic] of mutations){
    const f=fixture(),ui=await ordinaryChat(f,()=>({}),{mutateResponse:(reply,e)=>{mutate(reply,e);return reply;}});
    await assert.rejects(ui.send('A synthetic meaningful message.'),e=>e.diagnostic===diagnostic,diagnostic);assert.deepEqual(ui.session.memoryStatus.current.short,[]);assert.ok(ui.session.memoryStatus.review.pendingSources.length);assert.equal(f.writes.length,0);
  }
});

test('the advertised semantic schema agrees with the runtime path and contains no unsupported maxLength constraints',async()=>{
  const ui=await ordinaryChat(fixture(),()=>({}));await ui.send('An ordinary synthetic consultation.');
  const schema=ui.requests[0].text.format.schema,final=schema.properties.result.anyOf[0];assert.equal(final.properties.candidates.properties.short.maxItems,0);assert.ok(final.properties.awake.required.includes('evaluation'));assert.ok(final.properties.awake.required.includes('orientation'));
  const visit=value=>{if(!value||typeof value!=='object')return;assert.equal(Object.hasOwn(value,'maxLength'),false);if(value.type==='object'){assert.equal(value.additionalProperties,false);assert.deepEqual([...value.required].sort(),Object.keys(value.properties).sort());}for(const child of Object.values(value))if(typeof child==='object')visit(child);};visit(schema);
});

test('fresh sessions and other rooms do not inherit temporary interpretations or provisional review artifacts',async()=>{
  const f=fixture(),client=f.open(),c=chat(client.source,e=>{const fields=semanticFields(e);fields.evaluation={...fields.evaluation,outcome:'provisional_observation',reason:'A source-grounded but tentative observation.',observations:[{id:'private-observation',kind:'hypothesis',text:'PRIVATE_SYNTHETIC_ROOM_OBSERVATION: purpose uncertain.',sources:[e.user.source],relatesTo:[],disposition:'carry'}]};return fields;},[],{mode:'temporary'});
  await c.session.enterScope('atlas');await c.session.send('A synthetic project activity.');assert.equal(c.session.memoryStatus.review.observations.length,1);
  const cold=chat(f.open().source,()=>({}),[],{mode:'temporary'});await cold.session.send('Everyday conversation.');assert.ok(!JSON.stringify(cold.last).includes('PRIVATE_SYNTHETIC_ROOM_OBSERVATION'));assert.equal(cold.session.memoryStatus.review.observations.length,0);assert.equal(cold.session.memoryStatus.diagnostics.turnSequence,1);
  await c.session.endSession('discard');await c.session.enterScope(null);await c.session.send('A new everyday activity.');assert.ok(!JSON.stringify(c.last).includes('PRIVATE_SYNTHETIC_ROOM_OBSERVATION'));assert.equal(f.writes.length,0);
});

test('ordinary model instructions and strict validator agree on every decision/outcome pairing',async()=>{
  const outcomes=['updated_understanding','provisional_observation','reviewed_discarded','deferred'];
  const cases=[{decision:'change',expected:'updated_understanding',carry:false},{decision:'change',expected:'updated_understanding',carry:true},{decision:'no_change',expected:'provisional_observation',carry:true},{decision:'no_change',expected:'reviewed_discarded',carry:false},{decision:'deferred',expected:'deferred',carry:false}];
  for(const row of cases)for(const outcome of outcomes){
    const f=fixture();
    const ui=await ordinaryChat(f,e=>row.decision==='change'?{changes:[change(e,'global','short','A synthetic working goal.','EXPAND',[unit('goal','Synthetic goal.',e.user.source)])]}:{},{mutateResponse:(reply,e)=>{
      Object.assign(reply.awake.evaluation,{decision:row.decision,outcome});
      if(row.carry)reply.awake.evaluation.observations=[{id:'pattern',kind:'observation',text:'A synthetic pattern with unknown purpose.',sources:[e.user.source],relatesTo:[],disposition:'carry'}];
      return reply;
    }});
    if(outcome===row.expected){await ui.send('Synthetic evidence.');assert.equal(ui.session.memoryStatus.review.last.outcome,outcome);}
    else await assert.rejects(ui.send('Synthetic evidence.'),error=>{
      assert.equal(error.diagnostic,'memory_outcome');assert.deepEqual(error.diagnosticDetails.received,{decision:row.decision,outcome});assert.equal(error.diagnosticDetails.expected.outcome,row.expected);assert.equal(error.diagnosticDetails.carriedObservation,row.carry);assert.equal(ui.session.memoryStatus.review.last.status,'failed');assert.deepEqual(ui.session.memoryStatus.current.short,[]);assert.ok(ui.session.memoryStatus.review.pendingSources.length);return true;
    });
    const instructions=ui.requests[0].instructions;
    for(const rule of ['change -> updated_understanding','deferred -> deferred','no_change with at least one observation whose disposition is carry -> provisional_observation','no_change without any carried observation -> reviewed_discarded'])assert.ok(instructions.includes(rule),rule);
    assert.equal(f.writes.length,0);
  }
});

test('outcome rejection preserves turn/revision divergence, pending sources and last valid state for same-turn retry',async()=>{
  const f=fixture();let reject=true;
  const ui=await ordinaryChat(f,e=>e.user.text==='Routine spelling consultation.'?{}:{changes:[change(e,'global','short','Synthetic fictional stage '+e.context.sessionDiagnostics.turnSequence,'EXPAND',[unit('stage-'+e.context.sessionDiagnostics.turnSequence,'Fictional progress.',e.user.source)])]},{mutateResponse:(reply,e)=>{
    if(e.context.sessionDiagnostics.turnSequence===4&&reject)reply.awake.evaluation.outcome='reviewed_discarded';return reply;
  }});
  await ui.send('First fictional activity.');await ui.send('Second fictional activity.');await ui.send('Routine spelling consultation.');
  const before=structuredClone(ui.session.memoryStatus.current);assert.equal(before.meaningRevision,2);
  let failedSource;
  await assert.rejects(ui.send('Synthetic fourth-turn refinement.'),error=>{assert.equal(error.diagnostic,'memory_outcome');assert.equal(error.callPhase,'initial');assert.equal(error.diagnosticDetails.expected.outcome,'updated_understanding');return true;});
  assert.deepEqual(ui.session.memoryStatus.current,before);assert.equal(ui.session.memoryStatus.diagnostics.turnSequence,3);
  failedSource=JSON.parse(ui.requests.at(-1).input).user.source;assert.ok(ui.session.memoryStatus.review.pendingSources.includes(failedSource));
  assert.equal(ui.session.memoryStatus.review.last.diagnosticDetails.received.outcome,'reviewed_discarded');
  reject=false;await ui.send('Synthetic fourth-turn refinement.');assert.equal(JSON.parse(ui.requests.at(-1).input).user.source,failedSource);assert.equal(ui.session.memoryStatus.current.meaningRevision,3);assert.equal(ui.session.memoryStatus.diagnostics.turnSequence,4);assert.equal(f.writes.length,0);
});

test('review diagnostics sanitize invalid outcomes and explain decision conflicts without leaking response content',async()=>{
  for(const wrongDecision of [false,true]){
    const f=fixture(),secret='PRIVATE_SYNTHETIC_CONTENT_NOT_FOR_DIAGNOSTICS';
    const ui=await ordinaryChat(f,e=>({changes:[change(e,'global','short',secret,'EXPAND',[unit('private-unit',secret,e.user.source)])]}),{mutateResponse:reply=>{reply.awake.evaluation.outcome=secret;if(wrongDecision)reply.awake.evaluation.decision='no_change';return reply;}});
    await assert.rejects(ui.send(secret),error=>{assert.equal(error.diagnostic,wrongDecision?'memory_decision':'memory_outcome');assert.equal(error.diagnosticDetails.received.outcome,'invalid');assert.deepEqual(error.diagnosticDetails.expected.decisions,['change']);assert.ok(!JSON.stringify(error.diagnosticDetails).includes(secret));assert.ok(!JSON.stringify(error.diagnosticDetails).includes('turn:'));return true;});
    assert.equal(f.writes.length,0);assert.deepEqual(ui.session.memoryStatus.current.short,[]);
  }
  const app=await readFile(new URL('./app.mjs',import.meta.url),'utf8');assert.match(app,/diagnosticDetails: error\.diagnosticDetails/);
});

test('evaluation rejection diagnostics identify every failed field without private values',async()=>{
  const secret='PRIVATE_SYNTHETIC_VALUE';
  const variants=[
    ['shape',v=>{delete v.reason;}],['version',v=>{v.version=2;}],['review_id',v=>{v.reviewId=secret;}],['scope_id',v=>{v.scopeId=secret;}],['domain',v=>{v.domain=secret;}],['decision',v=>{v.decision=secret;}],
    ['reason',v=>{v.reason=' ';}],['reason',v=>{v.reason='x'.repeat(501);}],['sources',v=>{v.sources=[];}],['sources',v=>{v.sources=[secret];}],['sources',v=>{v.sources=Array(5).fill(v.sources[0]);}],['assessed',v=>{v.assessed=['short','short','orientation','unfinished','contradictions'];}],['coverage',v=>{v.coveredSources=[];}],['coverage',v=>{v.coveredSources=[secret];}]
  ];
  for(const [field,mutate] of variants){
    const f=fixture(),ui=await ordinaryChat(f,()=>({}),{mutateResponse:r=>{mutate(r.awake.evaluation);return r;}});
    await assert.rejects(ui.send(secret),error=>{assert.equal(error.diagnostic,'memory_evaluation_'+field);const details=JSON.stringify(error.diagnosticDetails??{});assert.ok(!details.includes(secret));assert.ok(!details.includes('turn:'));assert.equal(ui.session.memoryStatus.review.last.diagnostic,error.diagnostic);return true;});
    assert.ok(ui.session.memoryStatus.review.pendingSources.length);assert.deepEqual(ui.session.memoryStatus.current.short,[]);assert.equal(f.writes.length,0);
  }
});

test('eight-turn corrected understanding survives checkpoint coverage failure and deduplicated same-turn retry',async()=>{
  const f=fixture();let fail=true;
  const ui=await ordinaryChat(f,e=>{
    const n=e.context.sessionDiagnostics.turnSequence,orientation={focus:{text:'Synthetic planning stage '+n,sources:[e.user.source]},unfinished:[]};
    if(n===1)return{orientation,changes:[change(e,'global','short','Synthetic initial layout.','EXPAND',[unit('initial-layout','Synthetic initial layout.',e.user.source)])]};
    if(n===4)return{orientation,changes:[change(e,'global','short','Synthetic corrected layout.','REVISE',[unit('corrected-layout','Synthetic corrected layout.',e.user.source,'interpretation','initial-layout')])]};
    return{orientation};
  },{mutateResponse:(r,e)=>{if(e.context.sessionDiagnostics.turnSequence===8&&fail)r.awake.evaluation.coveredSources=r.awake.evaluation.coveredSources.slice(1);return r;}});
  for(let n=1;n<=7;n++)await ui.send('Synthetic planning turn '+n);
  const before=structuredClone(ui.session.memoryStatus.current);assert.equal(before.meaningRevision,7);assert.equal(ui.session.memoryStatus.diagnostics.turnsSinceCheckpoint,0);
  await assert.rejects(ui.send('Synthetic confirmation and unresolved planning question.'),error=>{assert.equal(error.diagnostic,'memory_evaluation_coverage');assert.deepEqual(error.diagnosticDetails,{field:'coveredSources',expectedCount:15,receivedCount:14,unique:true,missingCount:1,unexpectedCount:0});return true;});
  const packet=JSON.parse(ui.requests.at(-1).input).context.memoryReview;
  assert.deepEqual(ui.session.memoryStatus.current,before);assert.equal(ui.session.memoryStatus.diagnostics.turnsSinceCheckpoint,0);assert.equal(ui.session.memoryStatus.diagnostics.turnSequence,7);assert.equal(ui.session.memoryStatus.review.pendingSources.length,15);assert.equal(new Set(ui.session.memoryStatus.review.pendingSources).size,15);
  fail=false;await ui.send('Synthetic confirmation and unresolved planning question.');const retry=JSON.parse(ui.requests.at(-1).input).context.memoryReview;
  assert.deepEqual(retry.sources,packet.sources);assert.equal(ui.session.memoryStatus.current.meaningRevision,8);assert.equal(ui.session.memoryStatus.current.short[0].text,'Synthetic corrected layout.');assert.equal(ui.session.memoryStatus.review.pendingSources.length,1);assert.equal(f.writes.length,0);
});

function assertCheckpointContract(body,packet){
  const advertised=body.text.format.schema,final=advertised.properties.result?.anyOf[0]??advertised,evaluation=final.properties.awake.properties.evaluation.properties;
  assert.deepEqual(evaluation.reviewId.enum,[packet.id]);assert.deepEqual(evaluation.scopeId.enum,[packet.scopeId]);assert.deepEqual(evaluation.coveredSources.items.enum,packet.sources);assert.equal(evaluation.coveredSources.minItems,packet.sources.length);assert.equal(evaluation.coveredSources.maxItems,packet.sources.length);
  assert.equal(evaluation.sources.minItems,1);assert.equal(evaluation.sources.maxItems,4);assert.equal(evaluation.assessed.minItems,5);assert.equal(evaluation.assessed.maxItems,5);assert.ok(new RegExp(evaluation.reason.pattern).test('A grounded reason.'));assert.ok(!new RegExp(evaluation.reason.pattern).test('x'.repeat(501)));
  for(const text of ['1 to 4 distinct supporting citations','ALL IDs from context.memoryReview.sources exactly once','All five assessed sections'])assert.ok(body.instructions.includes(text));
  assert.equal(body.max_output_tokens,3000);assert.ok(Buffer.byteLength(body.input)<=48*1024);
}

test('20-turn ordinary Chat checkpoint advertises full 39-source coverage, supports four citations, and rejects duplicate coverage',async()=>{
  const f=fixture();let fail=true;
  const ui=await ordinaryChat(f,()=>({}),{mutateResponse:(r,e)=>{
    if(e.context.memoryReview.triggers.includes('interval_20')){r.awake.evaluation.sources=e.context.memoryReview.sources.slice(0,4);if(fail)r.awake.evaluation.coveredSources[1]=r.awake.evaluation.coveredSources[0];}return r;
  }});
  for(let n=1;n<20;n++)await ui.send(('Synthetic consultation '+n+' ').padEnd(500,'x'));
  const before=structuredClone(ui.session.memoryStatus.current);
  await assert.rejects(ui.send('Synthetic twentieth consultation.'),error=>{assert.equal(error.diagnostic,'memory_evaluation_coverage');assert.equal(error.diagnosticDetails.expectedCount,39);assert.equal(error.diagnosticDetails.receivedCount,39);assert.equal(error.diagnosticDetails.unique,false);assert.equal(error.diagnosticDetails.missingCount,1);return true;});
  const body=ui.requests.at(-1),packet=JSON.parse(body.input).context.memoryReview;assert.ok(packet.triggers.includes('interval_20'));assertCheckpointContract(body,packet);assert.deepEqual(ui.session.memoryStatus.current,before);
  fail=false;await ui.send('Synthetic twentieth consultation.');assert.equal(ui.session.memoryStatus.diagnostics.turnsSinceInterval,0);assert.equal(ui.session.memoryStatus.review.last.outcome,'reviewed_discarded');assert.equal(f.writes.length,0);
});

test('large deferred window reaches existing capacity without evidence loss and remains reviewable',async()=>{
  const f=fixture();let deferred=true;
  const ui=await ordinaryChat(f,e=>{
    const fields=semanticFields(e);if(deferred)fields.evaluation={...fields.evaluation,decision:'deferred',outcome:'deferred',reason:'Synthetic deferred review retaining all source evidence.'};return fields;
  });
  let retained,stopped=false;
  for(let n=1;n<=33;n++){
    retained=structuredClone(ui.session.memoryStatus);
    try{await ui.send(('Synthetic retained exchange '+n+' ').padEnd(600,'x'));}
    catch(error){assert.match(error.message,/capacity|bounded limit/);assert.deepEqual(ui.session.memoryStatus.current,retained.current);assert.deepEqual(ui.session.memoryStatus.review.pendingSources,retained.review.pendingSources);stopped=true;break;}
  }
  assert.equal(stopped,true);assert.ok(retained.review.pendingSources.length>=40);assert.equal(new Set(retained.review.pendingSources).size,retained.review.pendingSources.length);
  deferred=false;await ui.session.review('sleep');
  const body=ui.requests.at(-1),packet=JSON.parse(body.input).context.memoryReview;assertCheckpointContract(body,packet);assert.equal(packet.sources.length,retained.review.pendingSources.length);assert.equal(ui.session.memoryStatus.review.unreviewedSources,0);assert.equal(f.writes.length,0);
});

test('maximum 64-source 28000-character packet passes actual provider schema and runtime validation without relaxing coverage',async()=>{
  const f=fixture(),c=chat(f.open().source,()=>({}),[],{mode:'temporary'});await c.session.send('Synthetic seed.');
  const e=structuredClone(c.last),evidence=[];
  for(let n=0;n<32;n++)for(const role of ['user','aida'])evidence.push({source:'turn:'+crypto.randomUUID()+':'+role,role,text:'Synthetic bounded evidence.'.padEnd(300,'x')});
  evidence.at(-1).text+='x'.repeat(28000-JSON.stringify(evidence).length);assert.equal(JSON.stringify(evidence).length,28000);
  e.user=structuredClone(evidence.at(-2));e.memory.recent=[];e.context.currentState.conversation=[];
  e.context.memoryReview={...e.context.memoryReview,triggers:['sleep'],reviewOnly:true,evidence,sources:evidence.map(v=>v.source),priorObservations:[]};
  let body,response;
  const invoke=createProviders({apiKey:'synthetic-key',fetchRequest:async(url,options)=>{
    body=JSON.parse(options.body);const packet=JSON.parse(body.input);const fields=semanticFields(packet);fields.evaluation.sources=packet.context.memoryReview.sources.slice(0,4);
    response={version:'0.2',reply:'Synthetic completed review.',intent:'conversation',route:'reply',affect:packet.affect,candidates:{facts:[],insights:[],short:[],long:[]},tools:[],awake:{action:{kind:'just_keep_talking',target:null,arguments:[],sources:[],uncertainty:null},rebuild:null,changes:[],candidates:[],contradictions:[],...fields}};
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({result:response})}]}]});
  }});
  const reply=await invoke({provider:'openai',model:'gpt-6-luna',envelope:e});assertCheckpointContract(body,e.context.memoryReview);assert.equal(parseConversationResponse(reply.raw,e).awake.evaluation.coveredSources.length,64);
  const bad=structuredClone(response);bad.awake.evaluation.coveredSources[1]=bad.awake.evaluation.coveredSources[0];assert.throws(()=>parseConversationResponse(JSON.stringify(bad),e),error=>error.diagnostic==='memory_evaluation_coverage');
  // Measured bytes are not a model-token estimate or a live compliance claim.
  console.log('checkpoint-boundary-metrics '+JSON.stringify({sources:64,evidenceCharacters:28000,inputBytes:Buffer.byteLength(body.input),schemaBytes:Buffer.byteLength(JSON.stringify(body.text.format.schema)),coverageEchoBytes:Buffer.byteLength(JSON.stringify(response.awake.evaluation.coveredSources)),responseBytes:Buffer.byteLength(JSON.stringify(response)),outputTokenCeiling:body.max_output_tokens}));
});


// Scripted semantic interpretation exercises the real ordinary Chat/provider/
// parser/steward path. This is not a claim of live model summarization quality.
function scriptedConsolidation(request){
  const old=request.previous.entries,retiring=request.retiring;
  const revised=retiring.find(e=>e.text.includes('CORRECTION_BLUE'));
  const previous=old.find(e=>e.kind==='reference'||e.kind==='correction');
  const reference=revised?{kind:'correction',text:'The earlier red marker was corrected to blue; do not revive red.',sources:[revised.source]}:
    previous?{kind:previous.kind,text:previous.text,sources:[previous.source]}:
    {kind:'reference',text:'An early fictional marker provides the reference for this conversation.',sources:[retiring[0].source]};
  const thread=old.find(e=>e.kind==='thread');
  return{id:request.id,scopeId:request.scopeId,baseRevision:request.baseRevision,entries:[reference,{kind:'thread',text:'The sunlight question remains unresolved; no conclusion was established.',sources:[thread?.source??retiring.at(-1).source]}]};
}

test('30 ordinary turns repeatedly consolidate Everyday and project RECENT+ atomically with stable measured prompt budgets',async()=>{
  const measurements=[];
  for(const project of [null,'atlas']){
    const f=fixture();let fail=false;
    const ui=await ordinaryChat(f,e=>e.user.text.includes('EARLY_REFERENCE')?{changes:[change(e,project?'project':'global','short','A synthetic current-stage question.','EXPAND',[unit('current-stage','A current-stage question, not a transcript.',e.user.source)])]}:{},{consolidation:true,mutateResponse:(r,e)=>{
      r.reply='This is a fictional planning exchange. The current-stage question remains open. We have not established the answer or changed the overall purpose. We can return to the earlier reference when it becomes relevant.';
      if(e.context.consolidation){r.consolidation=scriptedConsolidation(e.context.consolidation);if(fail)r.consolidation.entries[0].sources=['invented:secret'];}return r;
    }});
    if(project)await ui.session.enterScope(project);
    for(let n=1;n<=30;n++){
      const message=(n===1?'EARLY_REFERENCE synthetic red marker.':n===20?'CORRECTION_BLUE replace red with blue.':'Synthetic current conversation turn '+n+'.').padEnd(180,'x');
      if(n===11){
        const before=structuredClone(ui.session.memoryStatus),calls=ui.requests.length;fail=true;
        await assert.rejects(ui.send(message),error=>error.diagnostic==='recent_plus_evidence');assert.deepEqual(ui.session.memoryStatus.current,before.current);assert.deepEqual(ui.session.memoryStatus.recentPlus,before.recentPlus);assert.equal(ui.session.memoryStatus.diagnostics.recentMessages,before.diagnostics.recentMessages);assert.ok(ui.session.memoryStatus.review.pendingSources.length);
        const failed=JSON.parse(ui.requests.at(-1).input);fail=false;await ui.send(message);const retry=JSON.parse(ui.requests.at(-1).input);assert.equal(failed.user.source,retry.user.source);assert.deepEqual(failed.context.consolidation.retiring,retry.context.consolidation.retiring);assert.equal(ui.requests.length,calls+2);
      }else await ui.send(message);
      const state=ui.session.memoryStatus,budget=ui.budgets.at(-1),e=JSON.parse(ui.requests.at(-1).input);
      assert.equal(state.scopeId,project?'project:atlas':'everyday');assert.ok(budget.withinBudget);assert.ok(e.context.memoryReview.sources.length<=7);assert.equal(e.context.global.stateRef,project?'context.globalState':'context.currentState');
      assert.equal(e.context.currentState.conversation.length,0);assert.deepEqual(state.current.long,[]);assert.equal(state.current.short[0].text,'A synthetic current-stage question.');
      if(n===20){assert.ok(e.context.memoryReview.triggers.includes('interval_20'));assert.equal(state.diagnostics.turnsSinceInterval,0);}
      if(n>=4){assert.ok(tokenCount(state.recentPlus)<=800);assert.equal(e.context.consolidation.retiring.length,2);assert.ok(e.context.consolidation.retiring.every(v=>!v.text.includes('turn '+n+'.')));}
      if(n>=8){assert.ok(!e.context.memoryReview.evidence.some(v=>v.text.includes('EARLY_REFERENCE')));assert.ok(JSON.stringify(e.context.consolidation.previous.entries).includes(n<=23?'early fictional marker':'corrected to blue'));}
      if(n>=23)assert.ok(state.recentPlus.entries.some(v=>v.kind==='correction'&&v.text.includes('corrected to blue')));
      if(n>=24)measurements.push({scope:state.scopeId,turn:n,inputReferenceTokens:budget.inputTokens,accounted:budget.accountedTokens,envelopeBytes:Buffer.byteLength(ui.requests.at(-1).input),summaryTokens:tokenCount(state.recentPlus),components:budget.referenceTokens});
    }
    const stable=measurements.filter(v=>v.scope===(project?'project:atlas':'everyday'));assert.ok(Math.max(...stable.map(v=>v.inputReferenceTokens))-Math.min(...stable.map(v=>v.inputReferenceTokens))<150);
    assert.ok(ui.session.memoryStatus.recentPlus.revision>=27);assert.equal(ui.session.memoryStatus.diagnostics.turnSequence,30);assert.equal(f.writes.length,0);
    await ui.session.endSession('discard');assert.equal(ui.session.memoryStatus.recentPlus,null);assert.equal(f.writes.length,0);
    const fresh=await ordinaryChat(f,()=>({}),{consolidation:true});await fresh.send('A fresh everyday session.');assert.equal(fresh.session.memoryStatus.recentPlus,null);assert.ok(!JSON.stringify(fresh.requests[0]).includes('corrected to blue'));
  }
  console.log('recent-plus-30-turn-measurements '+JSON.stringify(measurements));
});

test('RECENT+ validates binding, authorized evidence, bounds and stale replacements without persistence',()=>{
  const req={id:'request-one',scopeId:'everyday',baseRevision:2,previous:{entries:[{source:'summary:old',text:'Earlier reference.'}]},retiring:[{source:'turn:one:user',text:'New evidence.'}]};
  const valid={id:req.id,scopeId:req.scopeId,baseRevision:2,entries:[{kind:'uncertainty',text:'Purpose remains uncertain.',sources:['summary:old','turn:one:user']}]};
  assert.equal(validateConsolidation(valid,req).revision,3);
  for(const mutate of [v=>v.scopeId='project:other',v=>v.baseRevision=1,v=>v.id='old-attempt',v=>v.entries[0].sources=['META:secret'],v=>v.entries[0].text='x'.repeat(1201),v=>v.entries=Array(9).fill(v.entries[0])]){const v=structuredClone(valid);mutate(v);assert.throws(()=>validateConsolidation(v,req));}
  const over=structuredClone(valid);over.entries=Array.from({length:8},(_,i)=>({kind:'reference',text:('Dense unrelated words '+i+' ').repeat(35),sources:['turn:one:user']}));assert.throws(()=>validateConsolidation(over,req),e=>e.diagnostic==='recent_plus_budget');
  assert.equal(tokenCount('hello world'),2);assert.ok(tokenCount('é日本語')>0);
});

test('unified provider-aware budget includes instructions, schema, context and reserved output before transport',()=>{
  const args={provider:'openai',model:'configured-model',content:'Context',instructions:'Instructions',schema:{type:'object'},outputTokens:3000,enforce:true};
  const open=promptBudget(args),local=promptBudget({...args,provider:'ollama'});assert.notEqual(open.limit,local.limit);assert.notEqual(open.safetyFactor,local.safetyFactor);assert.equal(open.inputTokens,Object.values(open.referenceTokens).reduce((a,b)=>a+b,0));assert.equal(open.outputReserved,3000);
  assert.throws(()=>promptBudget({...args,instructions:'many '.repeat(25000)}),e=>e.diagnostic==='prompt_budget'&&e.promptBudget.accountedTokens>e.promptBudget.limit);
});

test('RECENT+ provenance resolves original sources without durable summary leakage or cross-room inheritance',async()=>{
  const f=fixture(),ui=await ordinaryChat(f,()=>({}),{consolidation:true,mutateResponse:(r,e)=>{if(e.context.consolidation)r.consolidation=scriptedConsolidation(e.context.consolidation);return r;}});
  let first;
  for(let n=1;n<=9;n++){await ui.send('Synthetic ephemeral evidence '+n);if(n===1)first=JSON.parse(ui.requests[0].input).user.source;}
  assert.ok(ui.session.memoryStatus.recentPlusSourceReferences.some(v=>v.originalSources.includes(first)));assert.ok(ui.session.memoryStatus.recentPlusSourceReferences.every(v=>v.originalSources.every(s=>s.startsWith('turn:'))));
  assert.equal(ui.session.memoryStatus.meaningfulChanges,false);assert.equal(f.writes.length,0);await ui.session.endSession('discard');assert.deepEqual(ui.session.memoryStatus.recentPlusSourceReferences,[]);
  await ui.session.enterScope('beta');await ui.send('Unrelated room.');assert.equal(ui.session.memoryStatus.recentPlus,null);assert.ok(!JSON.stringify(ui.requests.at(-1)).includes('earlier fictional marker'));assert.equal(f.writes.length,0);
});

test('explicit understanding-only preservation does not serialize RECENT+ or provenance into Everyday or project Drive records',async()=>{
  for(const project of [null,'atlas']){
    const f=fixture(),ui=await ordinaryChat(f,e=>e.user.text.startsWith('Keep')?{changes:[change(e,project?'project':'global','short','An explicitly authorized synthetic goal.','EXPAND',[unit('goal','An explicitly authorized synthetic goal.',e.user.source)])]}:{},{consolidation:true,mutateResponse:(r,e)=>{if(e.context.consolidation)r.consolidation=scriptedConsolidation(e.context.consolidation);return r;}});
    if(project)await ui.session.enterScope(project);
    await ui.send('Keep a meaningful synthetic goal.');for(let n=0;n<8;n++)await ui.send('Temporary incidental exchange '+n);
    const source=ui.session.memoryStatus.recentPlus.entries[0].source;assert.equal(f.writes.length,0);await ui.session.endSession('understanding');
    const stored=JSON.stringify([...f.files.values()]);assert.ok(!stored.includes('recent-plus:'));assert.ok(!stored.includes(source));assert.ok(!stored.includes('Temporary incidental exchange'));assert.equal(f.files.get(project??'global').record.short[0].text,'An explicitly authorized synthetic goal.');assert.equal(ui.session.memoryStatus.recentPlus,null);if(project)assert.deepEqual(f.files.get('global').record.short,[]);
  }
});

test('full semantic projection is sent once per scope and budgets retain global identity and directory-only other projects',async()=>{
  const f=fixture();f.files.get('global').record.long=[{source:'fixture:global',text:'AUTHORIZED_GLOBAL_CHARTER'}];f.files.get('atlas').record.long=[{source:'fixture:atlas',text:'PRIVATE_ATLAS_CHARTER'}];f.files.get('beta').record.long=[{source:'fixture:beta',text:'PRIVATE_BETA_CHARTER'}];
  const ui=await ordinaryChat(f,()=>({}),{consolidation:true});await ui.session.enterScope('atlas');await ui.send('Continue the current project.');
  const request=ui.requests[0],e=JSON.parse(request.input);assert.equal(e.identity.name,'Aida');assert.equal(e.context.currentState.scopeId,'project:atlas');assert.equal(e.context.activeProject.continuity.stateRef,'context.currentState');assert.equal(e.context.global.stateRef,'context.globalState');
  assert.equal(request.input.split('PRIVATE_ATLAS_CHARTER').length-1,1);assert.equal(request.input.split('AUTHORIZED_GLOBAL_CHARTER').length-1,1);assert.ok(!request.input.includes('PRIVATE_BETA_CHARTER'));assert.ok(e.context.projects.some(v=>v.id==='beta'));
  for(const wording of ['living charter and overall status','current-stage progress','distinct functions, not successive summaries','without imposing formal projects'])assert.ok(request.instructions.includes(wording));assert.equal(f.writes.length,0);
});

test('budget rejection before transport preserves RECENT+ and pending turn for a safe retry',async()=>{
  const f=fixture();let overload=false;
  const ui=await ordinaryChat(f,()=>({}),{consolidation:true,canonicalFacts:async()=>overload?Array.from({length:70},(_,n)=>({source:'fixture:fact:'+n,text:'a b c d '.repeat(50)})):[],mutateResponse:(r,e)=>{if(e.context.consolidation)r.consolidation=scriptedConsolidation(e.context.consolidation);return r;}});
  for(let n=0;n<5;n++)await ui.send('Synthetic bounded context '+n);
  const before=structuredClone(ui.session.memoryStatus),calls=ui.requests.length;
  overload=true;
  await assert.rejects(ui.send('Retry after reducing authorized external context.'),error=>{assert.equal(error.diagnostic,'prompt_budget');assert.ok(error.promptBudget.accountedTokens>error.promptBudget.limit);return true;});
  assert.equal(ui.requests.length,calls);assert.deepEqual(ui.session.memoryStatus.current,before.current);assert.deepEqual(ui.session.memoryStatus.recentPlus,before.recentPlus);const pending=ui.session.memoryStatus.review.pendingSources;
  overload=false;await ui.send('Retry after reducing authorized external context.');assert.ok(pending.includes(JSON.parse(ui.requests.at(-1).input).user.source));assert.equal(f.writes.length,0);
});
