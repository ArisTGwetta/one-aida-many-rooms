// Pure interpretation/receipt validation. Storage remains in the existing context
// records and RECENT journal; this module has no transport or persistence.
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
  for (const unit of change.meaning) {
    if (next.some(old=>old.id===unit.id)) throw Error('Meaning IDs are immutable; use a new ID for a revision.');
    if (unit.replaces !== null) {
      const index=next.findIndex(old=>old.id===unit.replaces);
      if(change.operation!=='REVISE'||index<0||targets.has(unit.replaces)||!unit.sources.some(s=>!next[index].sources.includes(s)))
        throw Error('A revision needs an explicit prior meaning and new evidence.');
      targets.add(unit.replaces);next.splice(index,1);
    }
    next.push(structuredClone(unit));
  }
  if(change.operation==='REVISE'&&!targets.size)throw Error('REVISE must address an existing interpretation.');
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
  if(['excluded','provisional'].includes(chosen)||result.receipt?.outcome?.status==='excluded'||result.envelope.visualEvidence) return false;
  if(!result.receipt||result.receipt.preview||result.envelope.context.lookupProject||result.envelope.context.projectEvidenceRead) return false;
  // Conservative fallback for known disposable consultations. A model cannot turn
  // an incidental spelling/definition answer into a retained personal profile.
  if(incidentalConsultation(result.turn.user.text)&&chosen==='ephemeral')return false;
  return !!(result.receipt.applied.some(c=>c.operation&&c.operation!=='KEEP')||
    result.receipt.rebuild&&result.receipt.rebuild!=='threshold'&&(result.receipt.candidates.length||result.receipt.contradictions.length));
}
export async function fingerprint(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
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
    if(!exact(plan,['scope','projectId','fileId','baseHash','revision','before','after','review','evidence','previousJournalReference'])||
        !['global','project'].includes(plan.scope)||(plan.scope==='global'?plan.projectId!==null:!id(plan.projectId))||
        !/^[\w-]+$/.test(plan.fileId)||!/^[a-f0-9]{64}$/.test(plan.baseHash)||!Number.isInteger(plan.revision)||plan.revision<0||
        !(plan.previousJournalReference===null||/^drive:[\w-]+$/.test(plan.previousJournalReference))||
        !Array.isArray(plan.evidence)||plan.evidence.length>40||plan.evidence.some(e=>!exact(e,['source','text'])||!text(e.source,150)||!text(e.text,4000))||
        !plan.review)throw Error('Invalid scoped checkpoint.');
    const key=plan.scope+':'+plan.projectId;if(scopes.has(key))throw Error('Duplicate checkpoint scope.');scopes.add(key);
    validateSnapshot(plan.before);validateSnapshot(plan.after);
    if(views.some(layer=>plan.after[layer].length>1))throw Error('A current view must be a single interpretation.');
    if(['facts','insights'].some(layer=>JSON.stringify(plan.before[layer])!==JSON.stringify(plan.after[layer])))
      throw Error('Working checkpoints cannot promote canonical facts or insights.');
    validateReview(plan.review);
    if([...plan.review.candidates,...plan.review.questions].some(entry=>entry.scope!==plan.scope))throw Error('Review scope does not match its context.');
  }
  return value;
}
