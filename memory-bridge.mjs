// Pure interpretation/receipt validation. Storage remains in the existing context
// records and RECENT journal; this module has no transport or persistence.
import { validateMind } from './living-mind.mjs';
export const views = ['long', 'short', 'recent'];
export const incidentalConsultation = text => /^\s*(?:how\s+do\s+(?:you|i)\s+spell|spell\b|what\s+(?:is|are|does)\b)[^\n]*\?\s*$/i.test(text);
const text = (v, n) => typeof v === 'string' && !!v.trim() && v.length <= n;
const id = v => typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v);
const exact = (v, keys) => v && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const string = { type: 'string' };
export const meaningSchema = { type: 'object', additionalProperties: false, required: ['id','kind','text','sources','replaces'], properties: {
  id: string, kind: { type: 'string', enum: ['event','claim','belief','interpretation','uncertainty'] }, text: string,
  sources: { type: 'array', items: string }, replaces: { type: ['string','null'] }
} };
export const changeFields = {
  operation: { type: 'string', enum: ['KEEP','EXPAND','REVISE','UNCLEAR'] },
  meaning: { type: 'array', items: meaningSchema }
};
export function validMeaning(unit) {
  return exact(unit,['id','kind','text','sources','replaces']) && id(unit.id) &&
    ['event','claim','belief','interpretation','uncertainty'].includes(unit.kind) && text(unit.text,400) &&
    Array.isArray(unit.sources) && unit.sources.length > 0 && unit.sources.length <= 4 &&
    new Set(unit.sources).size === unit.sources.length && unit.sources.every(s=>text(s,150)) && (unit.replaces === null || id(unit.replaces));
}
export function validateOperation(change, known) {
  if (!['KEEP','EXPAND','REVISE','UNCLEAR'].includes(change.operation) || !Array.isArray(change.meaning) || change.meaning.length > 8 ||
      change.meaning.some(u=>!validMeaning(u)||u.sources.some(s=>!known.has(s)||!change.sources.includes(s))) || new Set(change.meaning.map(u=>u.id)).size !== change.meaning.length)
    throw Error('Invalid memory interpretation or evidence.');
  if (change.operation === 'KEEP' ? change.meaning.length : !change.meaning.length) throw Error('Invalid KEEP/update semantics.');
}
export function evolve(entries, change, source) {
  if (change.operation === 'KEEP') return null;
  const original = entries.flatMap((entry,index)=>entry.meaning ?? [{id:'legacy-'+index,kind:'interpretation',text:entry.text,sources:[entry.source],replaces:null}]);
  const next = structuredClone(original), targets = new Set();
  const reject=(code,message,unitIndex)=>{throw Object.assign(Error(message),{diagnostic:'memory_revision_'+code,diagnosticDetails:{scope:['global','project'].includes(change.scope)?change.scope:'unspecified',layer:views.includes(change.layer)?change.layer:'unspecified',unitIndex}});};
  for (const [unitIndex,unit] of change.meaning.entries()) {
    if (next.some(old=>old.id===unit.id)) reject('id_reused','Meaning IDs are immutable; use a new ID for a revision.',unitIndex);
    if (unit.replaces !== null) {
      const index=next.findIndex(old=>old.id===unit.replaces);
      if(change.operation!=='REVISE')reject('operation','A revision needs operation REVISE for a replacement.',unitIndex);
      if(targets.has(unit.replaces))reject('target_duplicate','A revision may replace each prior meaning only once.',unitIndex);
      if(index<0)reject('target_missing','A revision needs an explicit prior meaning in the selected scope and layer.',unitIndex);
      if(!unit.sources.some(s=>!next[index].sources.includes(s)))reject('new_evidence','A revision needs new evidence for the meaning being replaced; omit unchanged meanings from the delta.',unitIndex);
      targets.add(unit.replaces);next.splice(index,1);
    }
    next.push(structuredClone(unit));
  }
  if(change.operation==='REVISE'&&!targets.size)reject('target_required','REVISE must address an existing interpretation.',null);
  if(change.operation==='UNCLEAR'&&!change.meaning.some(u=>u.kind==='uncertainty'))throw Error('UNCLEAR must preserve an explicit uncertainty.');
  if(next.length>8)throw Error('Current interpretation is full; revise existing meaning explicitly.');
  return {source,text:change.text,meaning:next};
}
export function validateSnapshot(snapshot) {
  for(const layer of [...views,'facts','insights']) {
    if(!Array.isArray(snapshot?.[layer])||snapshot[layer].length>4)throw Error('Invalid current memory snapshot.');
    for(const entry of snapshot[layer]) {
      if(!text(entry.source,150)||!text(entry.text,400))throw Error('Invalid current memory entry.');
      if(entry.meaning!==undefined&&(!Array.isArray(entry.meaning)||entry.meaning.length>8||entry.meaning.some(u=>!validMeaning(u))||new Set(entry.meaning.map(u=>u.id)).size!==entry.meaning.length))
        throw Error('Invalid current meaning evidence.');
    }
  }
  return snapshot;
}
export function safeReceipt(value, descriptor, policy) {
  if(!exact(value,['id','scope','projectId','text','reference'])||!id(value.id)||!['global','project'].includes(value.scope)||
      !text(value.text,400)||!text(value.reference,150)||(value.scope==='global' ? value.projectId!==null||policy?.global!==true : !id(value.projectId)||policy?.project!==true))
    throw Error('Invalid or unauthorized public skill receipt.');
  return {...structuredClone(value),source:`receipt:${descriptor.id}:${descriptor.version}:${value.id}`,authority:`skill:${descriptor.id}@${descriptor.version}`};
}
export function scopeAllowed(item, envelope) {
  const receipts=envelope.context.approvedReceipts??[];
  if(receipts.some(r=>item.sources.includes(r.source)&&r.scope==='project'&&
      (item.scope!=='project'||r.projectId!==envelope.context.currentProjectId)))return false;
  if(item.scope==='project') return !!envelope.context.activeProject;
  if(!envelope.context.currentProjectId) return true;
  const approved=new Set(receipts.filter(r=>r.scope==='global').map(r=>r.source));
  return item.sources.length>0&&item.sources.every(ref=>approved.has(ref));
}
export function checkpointEligible(result, chosen) {
  if(result.receipt?.semanticStatus==='deferred')return false;
  if(['excluded','provisional'].includes(chosen)||result.receipt?.outcome?.status==='excluded'||result.envelope.visualEvidence) return false;
  if(!result.receipt||result.receipt.preview||result.envelope.context.lookupProject||result.envelope.context.projectEvidenceRead) return false;
  // Conservative fallback for known disposable consultations. A model cannot turn
  // an incidental spelling/definition answer into a retained personal profile.
  if(incidentalConsultation(result.turn.user.text)&&chosen==='ephemeral')return false;
  return chosen==='candidate'||!!(result.receipt.orientationApplied||result.receipt.applied.some(c=>c.operation&&c.operation!=='KEEP')||
    result.receipt.candidates?.length||result.receipt.contradictions?.length||result.receipt.rebuild&&result.receipt.rebuild!=='threshold');
}
export async function fingerprint(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function validStateReceipt(value){
  return exact(value,['version','id','authority','at','sources'])&&value.version===1&&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id)&&value.authority==='explicit-user-consent'&&
    typeof value.at==='string'&&/^\d{4}-\d\d-\d\dT/.test(value.at)&&Number.isFinite(Date.parse(value.at))&&
    Array.isArray(value.sources)&&value.sources.length>0&&value.sources.length<=64&&new Set(value.sources.map(s=>s?.source)).size===value.sources.length&&
    value.sources.every(s=>exact(s,['source','sha256'])&&text(s.source,150)&&/^[a-f0-9]{64}$/.test(s.sha256));
}
export function validateReview(review) {
  if(!exact(review,['candidates','questions'])||!Array.isArray(review.candidates)||!Array.isArray(review.questions)||review.candidates.length>12||review.questions.length>12)
    throw Error('Invalid working review collections.');
  for(const [group,entries] of Object.entries(review))for(const entry of entries) {
    if(!exact(entry,group==='candidates'?['scope','layer','text','sources','rationale']:['scope','text','sources','rationale'])||
      !['global','project'].includes(entry.scope)||(group==='candidates'&&!['facts','insights'].includes(entry.layer))||
      !text(entry.text,400)||!text(entry.rationale,240)||!Array.isArray(entry.sources)||!entry.sources.length||entry.sources.length>4||
      new Set(entry.sources).size!==entry.sources.length||entry.sources.some(s=>!text(s,150)))throw Error('Invalid working review evidence.');
  }
  return review;
}
export function validateCheckpoint(value) {
  if(!exact(value,['version','operationId','plans'])||value.version!==1||!text(value.operationId,64)||!Array.isArray(value.plans)||!value.plans.length||value.plans.length>2)throw Error('Invalid memory checkpoint.');
  const scopes=new Set();
  for(const plan of value.plans) {
    if(!exact(plan,['scope','projectId','fileId','baseHash','revision','before','after','review','evidence','previousJournalReference',...(Object.hasOwn(plan,'mind')?['mind']:[])])||
        !['global','project'].includes(plan.scope)||(plan.scope==='global'?plan.projectId!==null:!id(plan.projectId))||
        !/^[\w-]+$/.test(plan.fileId)||!/^[a-f0-9]{64}$/.test(plan.baseHash)||!Number.isInteger(plan.revision)||plan.revision<0||
        !(plan.previousJournalReference===null||/^drive:[\w-]+$/.test(plan.previousJournalReference))||
        !Array.isArray(plan.evidence)||plan.evidence.length>40||plan.evidence.some(e=>!exact(e,['source','text'])||!text(e.source,150)||!text(e.text,4000))||
        !plan.review)throw Error('Invalid scoped checkpoint.');
    const key=plan.scope+':'+plan.projectId;if(scopes.has(key))throw Error('Duplicate checkpoint scope.');scopes.add(key);
    validateSnapshot(plan.before);validateSnapshot(plan.after);
    if(views.some(layer=>plan.after[layer].length>1&&JSON.stringify(plan.after[layer])!==JSON.stringify(plan.before[layer])))throw Error('An updated current view must be a single interpretation.');
    if(plan.mind)validateMind(plan.mind,plan.projectId);
    if(['facts','insights'].some(layer=>JSON.stringify(plan.before[layer])!==JSON.stringify(plan.after[layer])))
      throw Error('Working checkpoints cannot promote canonical facts or insights.');
    validateReview(plan.review);
    if([...plan.review.candidates,...plan.review.questions].some(entry=>entry.scope!==plan.scope))throw Error('Review scope does not match its context.');
  }
  return value;
}
