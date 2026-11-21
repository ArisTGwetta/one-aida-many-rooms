// Disposable acceptance runner. No production entry point imports this module.
import { createDriveClient, createMemoryStore } from '../../memory.mjs';
import { createContextSource, createAwakeSteward, journalReceipt } from '../../awake-context.mjs';
import { createJournal, makeJournalEvent } from '../../recent-journal.mjs';
import { createConversationSession } from '../../conversation.mjs';
import { checkpointEligible, fingerprint } from '../../memory-bridge.mjs';

const api='https://www.googleapis.com/drive/v3/files';
const devName='AIDA — ONE AIDA MANY ROOMS — DEV';
const folderMime='application/vnd.google-apps.folder';
const idOK=id=>typeof id==='string'&&/^[\w-]+$/.test(id);
const check=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{assertion:true});};
const blank=()=>({long:[],short:[],recent:[],facts:[],insights:[]});
const unit=(id,text,source,kind='interpretation',replaces=null)=>({id,kind,text,sources:[source],replaces});
export const testNames=['namespace and isolated initialization','initial project readback','compatible expansion and current views','uncertainty and source history','correction with provenance','fresh-context recovery beyond RECENT','stale checkpoint and real conditional write','project/global isolation','disposable consultation','ownership manifest'];

export function createRehearsal({config,token,fetchRequest=fetch,notify=()=>{}}) {
  const runId=crypto.randomUUID(),projectId='mb-test-'+runId,conversationId=crypto.randomUUID();
  const turnIds=Array.from({length:8},()=>crypto.randomUUID());
  const artifacts=[],results=testNames.map(name=>({name,status:'BLOCKED',detail:'Not run.'})),audit=[];
  let prepared=false,started=false,mode='plan',rootBefore;
  const root=config.drive.initialMemoryFolderId;
  const report=()=>structuredClone({runId,projectId,conversationId,target:{id:root,name:devName},mode,prepared,started,results,artifacts,audit,credentials:'Browser memory only; excluded from report.',paidProviderCalls:0});
  const emit=()=>notify(report());
  async function raw(url,options={}) {
    check(new URL(url).origin==='https://www.googleapis.com','Only Google Drive is permitted.');
    return fetchRequest(url,{...options,cache:'no-store',signal:AbortSignal.timeout(15000),headers:{...options.headers,Authorization:`Bearer ${token()}`}});
  }
  async function json(url,options) {
    const response=await raw(url,options);
    if(!response.ok)throw Object.assign(Error(`Drive HTTP ${response.status}.`),{status:response.status});
    return response.json();
  }
  const metadata=id=>json(`${api}/${id}?fields=id,name,mimeType,parents,trashed,version,appProperties`);
  const owned=(meta,item)=>meta.id===item.id&&meta.name===item.name&&meta.mimeType===item.mimeType&&meta.parents?.length===1&&meta.parents[0]===item.parent;
  async function prepare() {
    check(!prepared&&!started,'A plan has already been prepared.');
    check(idOK(root)&&config.drive.initialMemoryFolderName===devName,'Unexpected configured target.');
    const parent=await metadata(root);
    check(parent.id===root&&parent.name===devName&&parent.mimeType===folderMime&&parent.trashed===false,'Development folder identity mismatch.');
    rootBefore=await fingerprint(parent.appProperties??{});
    const reserved=await json(`${api}/generateIds?count=14&space=drive`);
    check(Array.isArray(reserved.ids)&&reserved.ids.length===14&&new Set(reserved.ids).size===14&&reserved.ids.every(id=>idOK(id)&&id!==root),'Invalid reserved artifact IDs.');
    const ids=reserved.ids;
    const names=['AIDA-MEMORY-BRIDGE-TEST-'+runId,devName,'aida-context-global.json','aida-context-projects.json','aida-context-capabilities.json',`aida-context-project-${projectId}.json`,...[0,1,2,4,5,6,7,3].map(n=>`aida-recent-${turnIds[n]}.json`)];
    for(let n=0;n<ids.length;n++) {
      // An allocation is not proof of ownership. Every reserved ID must be absent.
      const absent=await raw(`${api}/${ids[n]}?fields=id`);check(absent.status===404,'A reserved ID already exists or absence cannot be verified.');
      const plannedOperations=n===0?'create synthetic container; verified trash':n===1?'create isolated store; reserve/initialize context and project pointers; verified trash':n===2?'create empty global record only; verified trash':n===3?'create isolated catalog; register the one synthetic project; verified trash':n===4?'create empty capability catalog; verified trash':n===5?'create initial project; conditional expansion/uncertainty/correction; rejected stale attempts; verified trash':'create synthetic journal and receipt; verified trash';
      artifacts.push({id:ids[n],name:names[n],parent:n===0?root:n===1?ids[0]:ids[1],mimeType:n<2?folderMime:'application/json',plannedOperations,created:false,version:null,status:'planned',writes:0});
    }
    prepared=true;emit();return report();
  }

  async function guardedFetch(input,options={}) {
    const url=new URL(input),method=options.method??'GET',id=url.pathname.split('/').at(-1);
    check(url.origin==='https://www.googleapis.com'&&!url.hash,'Unexpected transport destination.');
    if(method==='GET'&&id==='generateIds') {
      throw Error('Unplanned ID allocation: use the real IDs already reserved in the manifest.');
    }
    if(method==='GET'&&id==='files') {
      check(url.pathname==='/drive/v3/files'&&url.searchParams.get('q')?.includes(`'${artifacts[1]?.id}' in parents`),'Read escaped the synthetic store.');
      return raw(url.href,options);
    }
    let item=artifacts.find(a=>a.id===id);
    let creation;
    if(method==='POST') {
      if(url.pathname==='/drive/v3/files')creation=JSON.parse(options.body);
      else if(url.pathname==='/upload/drive/v3/files') {
        const type=new Headers(options.headers).get('Content-Type'),boundary=type?.split('boundary=')[1];
        check(boundary,'Missing multipart boundary.');
        creation=JSON.parse(options.body.split('--'+boundary)[1].split('\r\n\r\n')[1]);
      }
      item=artifacts.find(a=>a.id===creation?.id);
      check(mode==='run'&&item&&!item.created&&creation.name===item.name&&creation.mimeType===item.mimeType&&creation.parents?.length===1&&creation.parents[0]===item.parent,'Creation escaped the approved manifest.');
      if(item.mimeType===folderMime)check(creation.appProperties?.memoryBridgeTestRun===runId,'Missing synthetic folder ownership marker.');
    } else {
      check(item?.created,'Access requires a verified artifact created by this run.');
      check(['/drive/v3/files/','/drive/v2/files/','/upload/drive/v2/files/','/upload/drive/v3/files/'].some(prefix=>url.pathname===prefix+item.id),'Unexpected Drive operation.');
      if(method!=='GET') {
        const body=JSON.parse(options.body);
        check(['PATCH','PUT'].includes(method),'Unexpected write method.');
        if(mode==='cleanup')check(method==='PATCH'&&JSON.stringify(body)==='{"trashed":true}','Cleanup may only trash a verified exact ID.');
        else {
          check(mode==='run'&&body.trashed===undefined,'Writes require execution confirmation.');
          if(item.mimeType===folderMime)check(method==='PATCH'&&Object.keys(body).join()==='appProperties','Only isolated folder pointers may change.');
          if(item.id===artifacts[2].id)throw Error('Global context updates are forbidden in this rehearsal.');
        }
      }
    }
    let response;
    try{response=await raw(url.href,options);}catch(error){
      if(method!=='GET'){item.status='uncertain';audit.push({method,id:item.id,status:'uncertain',phase:mode});emit();}
      throw error;
    }
    if(method!=='GET') {
      const entry={method,id:item.id,status:response.status,phase:mode};audit.push(entry);
      if(response.ok) {
        item.status='verification-pending';
        const meta=await metadata(item.id);
        check(owned(meta,item)&&typeof meta.version==='string','Written artifact ownership/version could not be verified.');
        item.created=true;item.version=meta.version;item.writes++;item.status=meta.trashed?'trashed':'verified';entry.version=meta.version;
      }
      emit();
    }
    return response;
  }
  const open=()=>({source:createContextSource(artifacts[1].id,token,guardedFetch),journal:createJournal(artifacts[1].id,token,guardedFetch),drive:createDriveClient(artifacts[1].id,token,guardedFetch)});
  async function createFolder(item) {
    const response=await guardedFetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,name:item.name,mimeType:folderMime,parents:[item.parent],appProperties:{memoryBridgeTestRun:runId}})});
    if(!response.ok)throw Object.assign(Error(`Folder creation HTTP ${response.status}.`),{status:response.status});
  }
  async function step(name,fn) {
    const result=results.find(r=>r.name===name);
    try {const detail=await fn();result.status='PASS';result.detail=detail??'Verified against the configured Drive transport.';}
    catch(error){result.status=error.assertion?'FAIL':'BLOCKED';result.detail=error.status?`Drive HTTP ${error.status}; no success claimed.`:error.message;throw error;}
    finally{emit();}
  }
  async function execute(confirmation) {
    check(prepared&&!started&&confirmation===runId,'Explicit confirmation of this exact run is required.');
    // Recheck the real parent before the first mutation.
    const parent=await metadata(root);check(parent.id===root&&parent.name===devName&&parent.mimeType===folderMime&&parent.trashed===false&&await fingerprint(parent.appProperties??{})===rootBefore,'Development folder changed since planning. Prepare a fresh run.');
    started=true;mode='run';emit();
    let client,steward,lastSource,oldTag,stalePending;
    const synthetic=(scope,layer,text,operation,meaning,source)=>({scope,layer,text,operation,meaning,sources:[source],rationale:'Explicit disposable synthetic rehearsal.'});
    async function propose(index,text,makeChanges,rebuild='meaningful_event',using=client) {
      const turnId=turnIds[index],at=new Date(Date.now()+index).toISOString(),user={source:`turn:${turnId}:user`,role:'user',text};
      const owner=using===client?steward:createAwakeSteward(using.source);
      const context=await owner.assemble([],user,projectId);
      const envelope={context,user,memory:{recent:[],facts:[]}};
      const awake={action:{kind:'just_keep_talking',target:null,arguments:[],sources:[],uncertainty:null},rebuild,changes:makeChanges(user.source),candidates:[],contradictions:[]};
      const receipt=await owner.apply(envelope,awake);
      const turn={turnId,order:Date.parse(at),startedAt:at,completedAt:at,conversationId,user,aida:{source:`turn:${turnId}:aida`,role:'aida',text:'Synthetic proposal fixture; no LLM call.'}};
      return {receipt,envelope,turn};
    }
    async function stage(result,using=client,conversation=conversationId) {
      check(checkpointEligible(result,'candidate'),'Synthetic meaningful proposal was not eligible.');
      const checkpoint=await using.source.prepareCheckpoint(result);result.receipt.bridge=checkpoint;
      const turn={...result.turn,conversationId:conversation};turn.awakeReceipt=journalReceipt(result);
      check(!!turn.awakeReceipt,'Journal receipt is missing.');
      return {checkpoint,event:makeJournalEvent(conversation,turn,'candidate'),fileId:artifacts.find(a=>a.name===`aida-recent-${turn.turnId}.json`).id};
    }
    async function persist(result) {
      const pending=await stage(result),saved=await client.journal.save(pending);
      await client.source.commitCheckpoint(pending.checkpoint,'drive:'+saved.fileId);
      return pending;
    }
    try {
      await step(testNames[0],async()=>{
        await createFolder(artifacts[0]);await createFolder(artifacts[1]);client=open();
        // The existing initializer already supports reserved pointers. Reserve
        // only inside the new test folder; never change real Aida pointers.
        await client.drive.setFolderProperties({ctxGlobalV1:artifacts[2].id,ctxProjectsV1:artifacts[3].id,ctxCapabilitiesV1:artifacts[4].id,[`ctxProject-${projectId}`]:artifacts[5].id});
        await client.source.initialize();const writes=audit.length;await client.source.initialize();
        check(audit.length===writes,'Repeated initialization wrote again.');
        steward=createAwakeSteward(client.source);
      });
      await step(testNames[1],async()=>{
        const seed='seed:'+runId;
        await client.source.createProject({entry:{id:projectId,name:'Synthetic Harbor '+runId,description:'Disposable fictional acceptance fixture.',status:'active',routingSummary:'Synthetic memory test only.',scope:'fictional'},continuity:{...blank(),long:[{source:seed,text:'The rival vessel is a competitor.',meaning:[unit('rival','The vessel is a competitor.',seed,'claim')]}],short:[{source:seed,text:'Approaching the harbor.',meaning:[unit('arrival','Approaching the harbor.',seed,'event')]}]},evidence:[{source:seed,text:'Synthetic initial relationship and harbor approach.'}],authorizationSource:seed});
        const p=await client.source.project(projectId);check(p.continuity.long.length===1&&p.continuity.short.length===1,'Initial snapshots missing.');
      });
      await step(testNames[2],async()=>{
        const pending=await persist(await propose(0,'The rival captain claims kinship; verify it.',s=>[
          synthetic('project','long','A rival captain claims kinship.','EXPAND',[unit('kinship','The captain claims kinship.',s,'claim')],s),
          synthetic('project','short','Approaching the harbor; verify the claim.','EXPAND',[unit('verify','Verify the claim.',s)],s)]));
        lastSource=pending.checkpoint.plans[0].after.long[0].source;
        const p=await client.source.project(projectId);check(p.continuity.long.length===1&&p.continuity.short.length===1&&p.continuity.long[0].meaning.some(m=>m.id==='rival'),'Expansion erased prior meaning or appended snapshots.');
        oldTag=await client.drive.readVersioned(artifacts[5].id);
      });
      await step(testNames[3],async()=>{
        await persist(await propose(1,'The claim remains unverified.',s=>[synthetic('project','long','The rival claims kinship; this remains uncertain.','UNCLEAR',[unit('doubt','Kinship remains uncertain.',s,'uncertainty')],s)]));
        const fresh=open(),p=await fresh.source.project(projectId);
        check(p.continuity.long[0].meaning.some(m=>m.id==='doubt'&&m.kind==='uncertainty'),'Uncertainty did not survive fresh reading.');
        const history=await fresh.source.projectEvidence(projectId,lastSource);check(history.entries.some(e=>e.text.includes('claims kinship')),'Historical expansion evidence missing.');
        stalePending=await stage(await propose(3,'A stale client proposes a different next step.',s=>[synthetic('project','short','A stale handoff.','EXPAND',[unit('stale','A stale handoff.',s)],s)],'meaningful_event',fresh),fresh,crypto.randomUUID());
      });
      await step(testNames[4],async()=>{
        await persist(await propose(2,'The synthetic story confirms kinship; continue cautiously.',s=>[
          synthetic('project','long','The captain is both rival and confirmed kin.','REVISE',[unit('confirmed','Kinship is confirmed in this fictional fixture.',s,'claim','kinship'),unit('resolved','Uncertainty is resolved in the fixture.',s,'belief','doubt')],s),
          synthetic('project','short','Approaching the harbor; continue cautiously.','REVISE',[unit('caution','Continue cautiously.',s,'interpretation','verify')],s)],'correction'));
        const p=await client.source.project(projectId),meaning=p.continuity.long[0].meaning;
        check(meaning.some(m=>m.id==='rival')&&meaning.some(m=>m.replaces==='kinship')&&!meaning.some(m=>m.id==='doubt'),'Correction or retained meaning is wrong.');
        check((await client.source.projectEvidence(projectId,lastSource)).entries.length>0,'Correction lost historical evidence.');
      });
      await step(testNames[5],async()=>{
        for(let n=4;n<8;n++) {
          const result=await propose(n,'Synthetic later retained activity '+n,()=>[],null);
          await client.journal.save({fileId:artifacts.find(a=>a.name===`aida-recent-${result.turn.turnId}.json`).id,event:makeJournalEvent(conversationId,result.turn,'candidate')});
        }
        const fresh=open(),recent=await fresh.journal.recover(conversationId);
        check(recent.turns.every(t=>!turnIds.slice(0,3).includes(t.turnId)),'Original checkpoint remains in RECENT; cold recovery not established.');
        const recovered=await createAwakeSteward(fresh.source).assemble([],{source:'cold:request',text:'Resume synthetic project.'},projectId);
        check(recovered.activeProject.continuity.long[0].meaning.some(m=>m.id==='confirmed')&&recovered.activeProject.continuity.short[0].meaning.some(m=>m.id==='caution'),'Fresh context missed current memory.');
        check(!JSON.stringify(recovered.global).includes('captain'),'Project data entered global context.');
      });
      await step(testNames[6],async()=>{
        const before=await fingerprint((await client.drive.readVersioned(artifacts[5].id)).record);
        let staleRejected=false;const saved=await client.journal.save(stalePending);
        try{await client.source.commitCheckpoint(stalePending.checkpoint,'drive:'+saved.fileId);}catch(e){staleRejected=/Stale checkpoint/.test(e.message);if(!staleRejected)throw e;}
        check(staleRejected,'Stale checkpoint was not rejected.');
        let conditionalRejected=false;
        try{await client.drive.replaceVersioned(artifacts[5].id,oldTag.record,oldTag.etag);}catch(e){conditionalRejected=e.status===412;if(!conditionalRejected)throw e;}
        check(conditionalRejected,'Drive accepted the deliberately stale If-Match write.');
        check(before===await fingerprint((await client.drive.readVersioned(artifacts[5].id)).record),'A stale writer overwrote current memory.');
        return 'Real stale If-Match rejected with HTTP 412; current content unchanged.';
      });
      await step(testNames[7],async()=>{
        const before=await fingerprint(await client.source.load()),writes=audit.length;
        const wrong=await propose(7,'Private project detail must stay private.',s=>[synthetic('global','long','Private synthetic project claim.','EXPAND',[unit('private','Private claim.',s,'claim')],s)]);
        check(wrong.receipt.applied.length===0&&wrong.receipt.rejected?.[0]?.reason==='scope_transfer_denied'&&!checkpointEligible(wrong,'ephemeral'),'Wrong scope was not rejected.');
        check(audit.length===writes&&before===await fingerprint(await client.source.load()),'Scope rejection changed Drive.');
      });
      await step(testNames[8],async()=>{
        const writes=audit.length;
        const session=createConversationSession({memoryStore:createMemoryStore(artifacts[1].id,token,guardedFetch),steward:createAwakeSteward(open().source),provider:async e=>JSON.stringify({version:'0.2',reply:'Synthetic answer: rhythm.',intent:'conversation',route:'reply',affect:e.affect,candidates:{facts:[],insights:[],short:[],long:[]},tools:[],awake:{action:{kind:'just_keep_talking',target:null,arguments:[],sources:[],uncertainty:null},rebuild:'meaningful_event',changes:[synthetic('global','short','Unwanted spelling note.','EXPAND',[unit('spelling','Unwanted note.',e.user.source)],e.user.source)],candidates:[],contradictions:[]}})});
        const result=await session.send('How do you spell rhythm?',{memoryDisposition:'ephemeral'});
        check(!checkpointEligible(result,'ephemeral')&&result.receipt.applied.length===0&&audit.length===writes,'Consultation wrote or applied unwanted memory.');
      });
      await step(testNames[9],async()=>{
        check(artifacts.every(a=>a.created&&a.version&&a.status==='verified'),'Artifact ownership verification is incomplete.');
        check(await fingerprint((await metadata(root)).appProperties??{})===rootBefore,'Real development folder pointers changed.');
        check(artifacts.length===14,'Unexpected artifact count.');
      });
      mode='complete';
    } catch {mode='stopped';} // Detailed failure belongs to its test; never manufacture later successes.
    emit();return report();
  }
  async function cleanup(confirmation) {
    check(started&&['complete','stopped','cleanup-stopped'].includes(mode)&&confirmation===runId,'Explicit cleanup confirmation is required.');
    mode='cleanup';emit();
    try {
      for(const item of [...artifacts].reverse()) {
        if(['uncertain','verification-pending'].includes(item.status))throw Error('Artifact ownership or last write is uncertain; retained for manual review.');
        if(!item.created||item.status==='trashed')continue;
        const meta=await metadata(item.id);
        check(owned(meta,item)&&meta.trashed===false&&meta.version===item.version,'Cleanup ownership/version changed; remaining artifacts retained.');
        if(item.mimeType===folderMime) {
          const children=await json(`${api}?`+new URLSearchParams({q:`'${item.id}' in parents and trashed = false`,pageSize:'1',fields:'files(id),nextPageToken,incompleteSearch'}));
          check(Array.isArray(children.files)&&!children.files.length&&!children.nextPageToken&&!children.incompleteSearch,'Folder is not demonstrably empty; retained, without deleting discovered children.');
        }
        const response=await createDriveClient(artifacts[1].id,token,guardedFetch).trash(item.id);
        check(response.id===item.id&&response.trashed===true,'Trash verification failed.');
      }
      mode='cleaned';
    } catch(error) {mode='cleanup-stopped';audit.push({phase:'cleanup',status:'BLOCKED',detail:error.status?`HTTP ${error.status}`:error.message});}
    emit();return report();
  }
  return {prepare,execute,cleanup,report};
}
