import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRehearsal } from './harness.mjs';
import { validateConfig } from '../../memory.mjs';

function fakeDrive({ignoreIfMatch=false,missingEtag=false,wrongRoot=false}={}) {
  const config={google:{clientId:'synthetic.apps.googleusercontent.com',scopes:['https://www.googleapis.com/auth/drive'],includeGrantedScopes:true,javascriptOrigin:'https://aristgwetta.github.io'},drive:{initialMemoryFolderId:'real-development',initialMemoryFolderName:'AIDA — ONE AIDA MANY ROOMS — DEV'}};
  const files=new Map([['real-development',{id:'real-development',name:wrongRoot?'Wrong folder':config.drive.initialMemoryFolderName,mimeType:'application/vnd.google-apps.folder',parents:['my-drive'],trashed:false,version:'1',appProperties:{privatePointer:'must-not-change'},created:0}]]);
  const requests=[];let counter=0,loseResponse=false,deny=false;
  const fetchRequest=async(input,options={})=>{
    const url=new URL(input),method=options.method??'GET',id=url.pathname.split('/').at(-1);
    assert.equal(url.origin,'https://www.googleapis.com');
    assert.equal(new Headers(options.headers).get('Authorization'),'Bearer synthetic-token');
    requests.push({method,url:url.href});
    if(deny)return new Response(null,{status:401});
    if(id==='generateIds')return Response.json({ids:Array.from({length:+url.searchParams.get('count')},(_,n)=>'reserved-'+(n+1))});
    if(method==='POST'){
      let meta,record;
      if(url.pathname==='/upload/drive/v3/files') {
        const boundary=new Headers(options.headers).get('Content-Type').split('boundary=')[1];
        [meta,record]=options.body.split('--'+boundary).slice(1,3).map(part=>JSON.parse(part.split('\r\n\r\n')[1]));
      } else meta=JSON.parse(options.body);
      if(files.has(meta.id))return new Response(null,{status:409});
      files.set(meta.id,{...meta,record,trashed:false,version:'1',created:++counter});
      if(loseResponse){loseResponse=false;throw Error('Synthetic lost response after creation.');}
      return Response.json({id:meta.id});
    }
    if(id==='files') {
      const q=url.searchParams.get('q'),parent=/'([^']+)' in parents/.exec(q)?.[1],name=/name = '([^']+)'/.exec(q)?.[1],conversation=/key='conversation' and value='([^']+)'/.exec(q)?.[1];
      let result=[...files.values()].filter(f=>f.parents?.includes(parent)&&!f.trashed&&(!name||f.name===name)&&(!q.includes("key='aidaMemory' and value='recent-v1'")||f.appProperties?.aidaMemory==='recent-v1')&&(!conversation||f.appProperties?.conversation===conversation));
      result.sort((a,b)=>b.created-a.created);const count=+(url.searchParams.get('pageSize')??100),offset=+(url.searchParams.get('pageToken')??0);
      return Response.json({files:result.slice(offset,offset+count).map(({record,created,...meta})=>meta),...(result.length>offset+count?{nextPageToken:String(offset+count)}:{})});
    }
    const f=files.get(id);if(!f)return new Response(null,{status:404});
    if(method==='PUT'||method==='PATCH') {
      if(method==='PUT'&&!ignoreIfMatch&&new Headers(options.headers).get('If-Match')!==`"v${f.version}"`)return new Response(null,{status:412});
      const body=JSON.parse(options.body);
      if(url.pathname.startsWith('/upload/'))f.record=body;
      else if(body.appProperties)f.appProperties={...f.appProperties,...body.appProperties};
      else Object.assign(f,body);
      f.version=String(+f.version+1);return Response.json({id:f.id,trashed:f.trashed,etag:`"v${f.version}"`});
    }
    if(url.pathname.startsWith('/drive/v2/'))return Response.json({id,etag:missingEtag?undefined:`"v${f.version}"`,parents:f.parents.map(id=>({id})),mimeType:f.mimeType,labels:{trashed:f.trashed}});
    if(url.searchParams.get('alt')==='media')return Response.json(f.record);
    const {record,created,...meta}=f;return Response.json(meta);
  };
  const runner=createRehearsal({config,token:()=> 'synthetic-token',fetchRequest});
  return {runner,files,requests,config,fetchRequest,deny:()=>{deny=true;},loseNext:()=>{loseResponse=true;}};
}

test('disposable harness completes actual adapter paths against synthetic HTTP and cleans only exact owned IDs',async()=>{
  const f=fakeDrive(),original=structuredClone(f.files.get('real-development'));
  const plan=await f.runner.prepare();assert.equal(plan.artifacts.length,14);assert.ok(f.requests.every(r=>r.method==='GET'));
  await assert.rejects(f.runner.execute('wrong-confirmation'),/confirmation/);
  const run=await f.runner.execute(plan.runId);
  assert.equal(run.mode,'complete',JSON.stringify(run.results));assert.ok(run.results.every(r=>r.status==='PASS'));
  assert.ok(run.audit.some(a=>a.status===412));assert.equal(run.artifacts.filter(a=>a.created).length,14);
  assert.deepEqual(f.files.get('real-development'),original);
  assert.ok(!JSON.stringify(run).includes('synthetic-token'));
  assert.ok(f.requests.every(r=>new URL(r.url).origin==='https://www.googleapis.com'));
  await assert.rejects(f.runner.cleanup('wrong-confirmation'),/confirmation/);
  const cleaned=await f.runner.cleanup(plan.runId);assert.equal(cleaned.mode,'cleaned',JSON.stringify(cleaned.audit));
  assert.ok(cleaned.artifacts.every(a=>a.status==='trashed'));
  assert.deepEqual(f.files.get('real-development'),original);
});

test('ignored conditional preconditions produce FAIL, not a manufactured success; missing versions stop execution',async()=>{
  const unsafe=fakeDrive({ignoreIfMatch:true}),plan=await unsafe.runner.prepare();
  const run=await unsafe.runner.execute(plan.runId);assert.equal(run.mode,'stopped');
  assert.equal(run.results.find(r=>r.name==='stale checkpoint and real conditional write').status,'FAIL');
  assert.ok(run.results.slice(7).every(r=>r.status==='BLOCKED'));
  const absent=fakeDrive({missingEtag:true}),p=await absent.runner.prepare();
  const missing=await absent.runner.execute(p.runId);assert.equal(missing.mode,'stopped');
  assert.equal(missing.results.find(r=>r.name==='compatible expansion and current views').status,'BLOCKED');
});

test('changed versions, uncertain creation and unknown children retain artifacts rather than deleting by discovery',async()=>{
  const f=fakeDrive(),p=await f.runner.prepare();await f.runner.execute(p.runId);
  const last=f.files.get(p.artifacts.at(-1).id);last.version='999';
  const stopped=await f.runner.cleanup(p.runId);assert.equal(stopped.mode,'cleanup-stopped');
  assert.ok(stopped.artifacts.every(a=>a.status!=='trashed'));
  const unknown=fakeDrive(),q=await unknown.runner.prepare();await unknown.runner.execute(q.runId);
  unknown.files.set('foreign-child',{id:'foreign-child',name:'Not ours',mimeType:'text/plain',parents:[q.artifacts[1].id],trashed:false,version:'1',created:999});
  const retained=await unknown.runner.cleanup(q.runId);assert.equal(retained.mode,'cleanup-stopped');
  assert.equal(unknown.files.get('foreign-child').trashed,false);assert.equal(unknown.files.get(q.artifacts[1].id).trashed,false);
  assert.ok(!unknown.requests.some(r=>r.method!=='GET'&&r.url.includes('foreign-child')));
  const lost=fakeDrive(),r=await lost.runner.prepare();lost.loseNext();
  const uncertain=await lost.runner.execute(r.runId);assert.equal(uncertain.mode,'stopped');assert.equal(uncertain.artifacts[0].status,'uncertain');
  const cleanup=await lost.runner.cleanup(r.runId);assert.equal(cleanup.mode,'cleanup-stopped');assert.ok(cleanup.artifacts[0].status==='uncertain');
  assert.equal(lost.files.get(r.artifacts[0].id).trashed,false);
});

test('wrong target, missing authorization and a new controller cannot authorize or discover an old run',async()=>{
  const wrong=fakeDrive({wrongRoot:true});await assert.rejects(wrong.runner.prepare(),/identity mismatch/);assert.ok(wrong.requests.every(r=>r.method==='GET'));
  const expired=fakeDrive();expired.deny();await assert.rejects(expired.runner.prepare(),e=>e.status===401);
  const fresh=fakeDrive();await assert.rejects(fresh.runner.execute('old-run'),/confirmation/);await assert.rejects(fresh.runner.cleanup('old-run'),/confirmation/);
});

test('browser entry keeps OAuth in memory and requires separate write and cleanup confirmations',async()=>{
  const browser=await readFile(new URL('./browser.mjs',import.meta.url),'utf8'),html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  assert.match(browser,/authorize\(google\.accounts\.oauth2,config\.google\)/);
  assert.match(browser,/validateConfig\(config,location\.origin\)/);
  assert.match(browser,/if\(!el\('confirm'\)\.checked\)/);assert.match(browser,/if\(!el\('cleanup-confirm'\)\.checked\)/);
  assert.ok(!/localStorage|sessionStorage|indexedDB|console\./.test(browser));
  assert.match(html,/No LLM calls/);assert.match(html,/id="execute" disabled/);
});

test('actual browser controller runs through separate human gates in a synthetic DOM with no live authorization',async()=>{
  const f=fakeDrive(),nodes=new Map();
  const node=()=>({disabled:true,checked:false,textContent:'',handlers:{},children:[],addEventListener(name,fn){this.handlers[name]=fn;},append(item){this.children.push(item);},replaceChildren(...items){this.children=items;}});
  const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node};
  const source=(await readFile(new URL('./browser.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  await runInNewContext(`(async()=>{${source}})()`,{document,location:{origin:'https://aristgwetta.github.io'},google:{accounts:{oauth2:{}}},
    fetch:async()=>Response.json(f.config),validateConfig,authorize:async()=> 'synthetic-token',
    createRehearsal:options=>createRehearsal({...options,fetchRequest:f.fetchRequest}),JSON,Error});
  assert.equal(nodes.get('authorize').disabled,false);
  await nodes.get('authorize').handlers.click();
  assert.match(nodes.get('plan').textContent,/reserved-14/);assert.ok(f.requests.every(r=>r.method==='GET'));
  assert.equal(nodes.get('execute').disabled,true);
  nodes.get('confirm').checked=true;nodes.get('confirm').handlers.change();assert.equal(nodes.get('execute').disabled,false);
  await nodes.get('execute').handlers.click();
  assert.match(nodes.get('status').textContent,/Rehearsal completed/);assert.equal(nodes.get('execute').disabled,true);
  assert.equal(nodes.get('cleanup').disabled,true);
  nodes.get('cleanup-confirm').checked=true;nodes.get('cleanup-confirm').handlers.change();
  await nodes.get('cleanup').handlers.click();assert.match(nodes.get('status').textContent,/verified in Trash/);
  assert.ok(!nodes.get('report').textContent.includes('synthetic-token'));
});
