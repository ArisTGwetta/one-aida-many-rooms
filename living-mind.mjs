// Shared current-state projection, not another store. Both scopes live in the
// existing context records; their source history remains in RECENT journals.
export const aidaIdentity=Object.freeze({name:'Aida',relationship:"The user's ongoing conversational companion."});
export const aidaPrinciples=Object.freeze(['Ground memory in evidence.','Respect scope and disclosure authority.','Preserve uncertainty and corrections.']);
export const restingAffect=Object.freeze({valence:0,arousal:0.2,label:'calm',expression:null});
const bounded=(s,n)=>typeof s==='string'&&s.length<=n;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const timestamp=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(s)&&Number.isFinite(Date.parse(s));
export const scopeId=projectId=>projectId?'project:'+projectId:'everyday';
export const mindContents=value=>{const {checkout,...content}=value;return content;};
function conversationWindow(messages){let size=0;const result=[];for(let n=messages.length-2;n>=0;n-=2){const pair=messages.slice(n,n+2),length=pair.reduce((count,m)=>count+m.text.length,0);if(size+length>6000&&result.length)break;result.unshift(...pair);size+=length;if(result.length===6)break;}return result;}
export function evolveOrientation(before,proposal){
  if(!proposal.focus&&!proposal.unfinished.length)return structuredClone(before);
  const next=structuredClone(before),evidence=[...(before.evidence??[])];
  if(proposal.focus){next.focus=[proposal.focus.text];for(let n=evidence.length-1;n>=0;n--)if(evidence[n].kind==='focus')evidence.splice(n,1);evidence.push({kind:'focus',...structuredClone(proposal.focus)});}
  for(const update of proposal.unfinished){
    if(update.operation==='add'){if(!next.unfinished.includes(update.text))next.unfinished.push(update.text);evidence.push({kind:'unfinished',text:update.text,sources:[...update.sources]});}
    else{if(!next.unfinished.includes(update.text))throw Error('Resolve only an existing unfinished commitment.');next.unfinished=next.unfinished.filter(text=>text!==update.text);for(let n=evidence.length-1;n>=0;n--)if(evidence[n].kind==='unfinished'&&evidence[n].text===update.text)evidence.splice(n,1);}
  }
  if(next.unfinished.length>12)throw Error('Unfinished orientation is full; resolve supported commitments explicitly.');
  next.evidence=[...new Map(evidence.map(e=>[e.kind+':'+e.text,e])).values()];return next;
}
export function emptyMind(projectId=null){return {version:1,scopeId:scopeId(projectId),meaningRevision:0,lastInteractionAt:null,lastMeaningfulAt:null,affect:{...restingAffect},conversation:[],orientation:{focus:[],unfinished:[]},retrieval:[],pendingReflections:[],checkout:null};}
export function initialMind(continuity,projectId=null){return {...emptyMind(projectId),orientation:{focus:(continuity.short??[]).map(e=>e.text),unfinished:[]}};}
export function validateMind(value,projectId=null){
  if(!exact(value,['version','scopeId','meaningRevision','lastInteractionAt','lastMeaningfulAt','affect','conversation','orientation','retrieval','pendingReflections','checkout'])||value.version!==1||value.scopeId!==scopeId(projectId)||!Number.isSafeInteger(value.meaningRevision)||value.meaningRevision<0||
    !(value.lastMeaningfulAt===null||timestamp(value.lastMeaningfulAt))||
    !(value.lastInteractionAt===null||timestamp(value.lastInteractionAt))||!exact(value.affect,['valence','arousal','label','expression'])||
    !Number.isFinite(value.affect?.valence)||Math.abs(value.affect.valence)>1||!Number.isFinite(value.affect?.arousal)||value.affect.arousal<0||value.affect.arousal>1||
    !bounded(value.affect.label,80)||!(value.affect.expression===null||bounded(value.affect.expression,240))||
    !Array.isArray(value.conversation)||value.conversation.length>6||value.conversation.some(m=>!exact(m,['source','role','text'])||!['user','aida'].includes(m.role)||!bounded(m.source,150)||!bounded(m.text,4000))||
    !exact(value.orientation,['focus','unfinished',...(Object.hasOwn(value.orientation??{},'evidence')?['evidence']:[])])||!Array.isArray(value.orientation.focus)||value.orientation.focus.length>4||value.orientation.focus.some(s=>!bounded(s,400))||
    !Array.isArray(value.orientation.unfinished)||value.orientation.unfinished.length>12||value.orientation.unfinished.some(s=>!bounded(s,400))||
    value.orientation.evidence!==undefined&&(!Array.isArray(value.orientation.evidence)||value.orientation.evidence.length>16||value.orientation.evidence.some(e=>!exact(e,['kind','text','sources'])||!['focus','unfinished'].includes(e.kind)||!value.orientation[e.kind==='focus'?'focus':'unfinished'].includes(e.text)||!Array.isArray(e.sources)||!e.sources.length||e.sources.length>4||e.sources.some(s=>!bounded(s,150))))||
    !Array.isArray(value.retrieval)||value.retrieval.length>8||value.retrieval.some(s=>!/^drive:[\w-]+$/.test(s))||
    !Array.isArray(value.pendingReflections)||value.pendingReflections.length>8||value.pendingReflections.some(r=>!exact(r,['id','text','sources'])||!bounded(r.id,100)||!bounded(r.text,600)||!Array.isArray(r.sources)||r.sources.length>4||r.sources.some(s=>!bounded(s,150))))throw Error('Invalid Living Mind current state.');
  if(value.checkout!==null&&(!exact(value.checkout,['sessionId','expiresAt'])||!value.checkout.sessionId||!bounded(value.checkout.sessionId,64)||!timestamp(value.checkout.expiresAt)))throw Error('Invalid Living Mind checkout.');
  return value;
}
export function currentPackage(continuity,projectId=null){
  const mind=validateMind(continuity.livingMind??initialMind(continuity,projectId),projectId);
  return structuredClone({schema:'aida-current-state@1',scopeId:mind.scopeId,identity:aidaIdentity,principles:aidaPrinciples,
    revision:continuity.memoryVersion??0,...Object.fromEntries(['long','short','recent','facts','insights'].map(k=>[k,continuity[k]??[]])),
    review:continuity.review??{candidates:[],questions:[]},...mind});
}
export function nextMind(before,after,review,result,projectId=null){
  const old=validateMind(before??emptyMind(projectId),projectId);
  const ownScope=projectId?'project':'global';
  const semantic=result.receipt.applied.some(c=>c.scope===ownScope&&c.operation&&c.operation!=='KEEP')||projectId===(result.envelope.context.currentProjectId??null)&&result.receipt.orientationApplied||[...result.receipt.candidates,...result.receipt.contradictions].some(c=>c.scope===ownScope);
  if(projectId!==(result.envelope.context.currentProjectId??null))return validateMind({...structuredClone(old),meaningRevision:old.meaningRevision+(semantic?1:0),lastMeaningfulAt:semantic?result.turn.completedAt:old.lastMeaningfulAt,orientation:{...old.orientation,focus:after.short.map(e=>e.text)}},projectId);
  const turn=result.turn;
  return validateMind({...structuredClone(old),meaningRevision:old.meaningRevision+(semantic?1:0),
    lastInteractionAt:result.reviewOnly?old.lastInteractionAt:turn.completedAt,lastMeaningfulAt:semantic?turn.completedAt:old.lastMeaningfulAt,affect:structuredClone(result.response?.affect??old.affect),
    conversation:result.reviewOnly?old.conversation:conversationWindow([...old.conversation,turn.user,turn.aida]),
    orientation:result.receipt.orientation??{...old.orientation,focus:after.short.map(e=>e.text)},
    retrieval:[...new Set(old.retrieval)].slice(-7),
    checkout:old.checkout?{...old.checkout,expiresAt:new Date(Date.parse(turn.completedAt)+20*60*1000).toISOString()}:null},projectId);
}
