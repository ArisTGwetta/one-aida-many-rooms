import { validateAwake } from "./awake-context.mjs";
import { incidentalConsultation } from './memory-bridge.mjs';
import {aidaIdentity,restingAffect,scopeId,nextMind,emptyMind,currentPackage} from './living-mind.mjs';
import { projectPrompt } from './prompt-budget.mjs';
import { validateConsolidation } from './recent-plus.mjs';

export const conversationVersion = "0.2";
export class ConversationTransportError extends Error {}
export class ConversationValidationError extends Error {}
const recentLimit = 6;
const identity = aidaIdentity;
const memoryKinds = ["facts", "insights", "short", "long"];
const intents = ["conversation", "recall", "memory_update", "tool_request"];
const routes = ["reply", "memory_review", "tool_review"];
const initialAffect = restingAffect;

function hasFields(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function text(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function inRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function validateAffect(affect) {
  return hasFields(affect, ["valence", "arousal", "label", "expression"]) &&
    inRange(affect.valence, -1, 1) && inRange(affect.arousal, 0, 1) &&
    text(affect.label, 80) && (affect.expression === null || text(affect.expression, 240));
}

export function parseConversationResponse(raw, envelope) {
  try {
    return validateConversationResponse(raw, envelope);
  } catch (error) {
    const reason = error.constructor === Error ? error.message : "The response could not be validated.";
    throw Object.assign(new ConversationValidationError(`Conversation response validation failed. ${reason}`),
      { diagnostic: error.diagnostic, ...(error.diagnosticDetails ? { diagnosticDetails: error.diagnosticDetails } : {}) });
  }
}

function validateConversationResponse(raw, envelope) {
  let output;
  try {
    output = JSON.parse(raw);
  } catch {
    throw new Error("The conversation provider did not return valid JSON.");
  }
  if (hasFields(output, ["result"])) output = output.result;
  if (hasFields(output, ["skillRequest"])) {
    const request = output.skillRequest;
    if (!hasFields(request, ["id", "version", "input"]) || envelope.context?.retrievalComplete ||
        !envelope.context?.capabilities.some(skill => ["read", "preview"].includes(skill.phase) && skill.id === request.id && skill.version === request.version)) {
      throw new Error("Invalid skill request.");
    }
    return output;
  }
  const fields = ["version", "reply", "intent", "route", "affect", "candidates", "tools"];
  if (envelope.context) fields.push("awake");
  if(envelope.context?.consolidation)fields.push('consolidation');
  if (!hasFields(output, fields) ||
      output.version !== conversationVersion || !text(output.reply, 4000) ||
      !intents.includes(output.intent) || !routes.includes(output.route) || !validateAffect(output.affect)) {
    throw new Error("The response does not match conversation envelope v0.2.");
  }

  const { memory, user } = envelope;
  const sources = new Map([[user.source, "user"]]);
  for (const kind of memoryKinds) {
    for (const item of memory[kind]) sources.set(item.source, kind);
  }
  for (const event of memory.recent) sources.set(event.source, event.role);
  if (!hasFields(output.candidates, memoryKinds)) throw new Error("Invalid memory candidate collections.");
  for (const kind of memoryKinds) {
    const candidates = output.candidates[kind];
    if (!Array.isArray(candidates) || candidates.length > 8) throw new Error("Invalid memory candidate collection.");
    for (const candidate of candidates) {
      if (!hasFields(candidate, ["text", "sources", "supersedes"]) || !text(candidate.text, 2000) ||
          !Array.isArray(candidate.sources) || !candidate.sources.length ||
          candidate.sources.some(ref => !sources.has(ref)) ||
          (candidate.supersedes !== null && sources.get(candidate.supersedes) !== kind)) {
        throw new Error("Memory candidate has invalid text, evidence, or correction target.");
      }
      if (kind === "facts" && !candidate.sources.some(ref => ["user", "facts"].includes(sources.get(ref)))) {
        throw new Error("A FACTS candidate requires user or fact evidence.");
      }
      if (candidate.supersedes !== null && !candidate.sources.some(ref => ref !== candidate.supersedes &&
          (kind !== "facts" || ["user", "facts"].includes(sources.get(ref))))) {
        throw new Error("A correction requires new evidence alongside the superseded item.");
      }
    }
  }

  const available = new Set(envelope.environment.tools);
  if (!Array.isArray(output.tools) || output.tools.length > 8 || output.tools.some(proposal =>
    !hasFields(proposal, ["tool", "purpose"]) || !available.has(proposal.tool) || !text(proposal.purpose, 500)
  )) throw new Error("Invalid tool proposal.");
  if (envelope.context) validateAwake(output.awake, envelope);
  if(envelope.context?.consolidation)validateConsolidation(output.consolidation,envelope.context.consolidation);
  if(envelope.context?.memoryReview&&Object.values(output.candidates).some(items=>items.length))throw Object.assign(Error('Use the authoritative awake semantic proposal path; compatibility candidates must be empty.'),{diagnostic:'memory_legacy_candidates'});
  return output;
}

export function parseLibrarySuggestion(raw) {
  let suggestion;
  try { suggestion = JSON.parse(raw); } catch {}
  if (!hasFields(suggestion, ["query"]) || (suggestion.query !== null && !text(suggestion.query, 180))) {
    throw new ConversationValidationError("Aida returned an invalid Library suggestion.");
  }
  return suggestion.query?.trim() ?? null;
}

// The provider boundary accepts one envelope and returns JSON text.
export function createConversationSession({ memoryStore, provider, recoveredTurns = [], loadCanonicalFacts = async () => [], steward,recoverConversation=true,mode='legacy',stateStore,archiveTurns=async()=>{throw Error('Archiving is unavailable.');},sessionId=crypto.randomUUID(),conversationId=null,resetReason='session_created',consolidation=false }) {
  let recent = recoverConversation?recoveredTurns.flatMap(turn => [turn.user, turn.aida]).slice(-recentLimit):[];
  let lastOrder = recoveredTurns.reduce((latest, turn) => Math.max(latest, turn.order), 0);
  let affect = { ...initialAffect };
  let inFlight = false;
  const histories=new Map(),affects=new Map();let currentScope='everyday';
  let memoryMode=mode,lastContext,temporaryBase,temporaryResults=[],preservation;
  const temporaryStates=new Map();
  const stateLayers=['long','short','recent','facts','insights'];
  const semantic=mode!=='legacy';
  let sequence=0,turnsSinceCheckpoint=0,intervalTurns=0,pendingEvidence=[],pendingAttempt,lastEvaluation=null,lastCheckpoint=-1,reviewCheckpoint,pendingReviewCommit=null;
  const sessionResults=[];
  const observations=new Map(),artifacts=[];
  const consolidated=new Map();
  const consolidationOrigins=new Map(); // latest summary aliases -> original turn IDs; never sent or persisted
  function consolidationPlan(response,context){
    if(!context?.consolidation)return null;
    const request=context.consolidation,next=validateConsolidation(response.consolidation,request),old=consolidationOrigins.get(request.scopeId)??new Map(),origins=new Map();
    for(const entry of next.entries){
      const refs=[...new Set(entry.sources.flatMap(source=>old.get(source)??[source]))];
      if(refs.length>512)throw Object.assign(new ConversationValidationError('RECENT+ provenance capacity reached; context and evidence retained.'),{diagnostic:'recent_plus_provenance_capacity'});
      origins.set(entry.source,refs);
    }
    return{next,origins};
  }
  const diagnostic={sessionId,conversationId,resetReason,resetSequence:0};
  const meaning=value=>JSON.stringify([stateLayers.map(k=>value?.[k]??[]),value?.review??{},value?.orientation??{}]);
  function clearTemporary(reason='explicit_reset'){
    if(semantic&&(pendingEvidence.length||pendingReviewCommit))throw Error('Review and verify pending understanding before discarding its evidence.');
    steward?.discardWorking?.();temporaryStates.clear();temporaryResults=[];temporaryBase=undefined;preservation=undefined;histories.delete(currentScope);affects.delete(currentScope);recent=[];pendingAttempt=undefined;lastCheckpoint=-1;
    observations.delete(currentScope);consolidated.clear();consolidationOrigins.clear();sessionResults.length=0;turnsSinceCheckpoint=0;intervalTurns=0;diagnostic.resetReason=reason;diagnostic.resetSequence++;diagnostic.previousTurnSequence=sequence;
  }
  function status(){return{mode:memoryMode,scopeId:currentScope,committedRevision:temporaryBase?.revision??lastContext?.currentState.revision??null,
    meaningfulChanges:!!temporaryBase&&meaning(temporaryBase)!==meaning(lastContext?.currentState),temporaryExchanges:temporaryResults.length,
    current:structuredClone(lastContext?.currentState),committed:structuredClone(temporaryBase),recentPlus:structuredClone(consolidated.get(currentScope)??null),recentPlusSourceReferences:[...(consolidationOrigins.get(currentScope)??new Map())].map(([source,originalSources])=>({source,originalSources:[...originalSources]})),persistence:memoryMode==='temporary'?'session-local; not saved':'durable mode; see verified commit receipt',
    diagnostics:{...diagnostic,turnSequence:sequence,recentMessages:recent.length,turnsSinceCheckpoint,turnsSinceInterval:intervalTurns},review:{unreviewedSources:pendingEvidence.length,pendingSources:pendingEvidence.map(e=>e.source),pendingCommit:pendingReviewCommit,last:structuredClone(artifacts.filter(a=>a.scopeId===currentScope).at(-1)??null),artifacts:structuredClone(artifacts.filter(a=>a.scopeId===currentScope).slice(-20)),observations:structuredClone(observations.get(currentScope)??[])}};}
  const addEvidence=items=>{pendingEvidence=[...new Map([...pendingEvidence,...items].map(e=>[e.source,structuredClone(e)])).values()];};
  function reviewRequest(context,user,triggers,reviewOnly=false){
    if(!semantic)return context;
    const lookup=!!(context.lookupProject||context.projectEvidenceRead),key=context.currentState.scopeId;
    const checkpoint=triggers.some(t=>t!=='per_turn');
    const checkpointEvidence=checkpoint&&!consolidation?sessionResults.filter(r=>r.turn.scopeId===key).slice(-20).flatMap(r=>[r.turn.user,r.turn.aida]):[];
    const evidence=lookup?[user]:[...new Map([...checkpointEvidence,...recent,...pendingEvidence,...(reviewOnly?[]:[user])].map(e=>[e.source,structuredClone(e)])).values()];
    if(evidence.length>64||JSON.stringify(evidence).length>28000)throw Object.assign(Error('Pending review evidence is at its bounded limit. Retry the review before continuing; evidence is retained.'),{diagnostic:'memory_review_capacity'});
    const previous=consolidated.get(key)??{scopeId:key,revision:0,entries:[]};
    const retiring=consolidation&&!lookup?recent.slice(0,-(reviewOnly?recentLimit:recentLimit-2)):[];
    return{...context,...(consolidation?{promptPolicy:{version:1},recentPlus:structuredClone(previous),...(retiring.length?{consolidation:{id:crypto.randomUUID(),scopeId:key,baseRevision:previous.revision,previous:structuredClone(previous),retiring:structuredClone(retiring)}}:{})}:{}),memoryReview:{version:1,id:crypto.randomUUID(),scopeId:key,triggers,reviewOnly,evidence,sources:evidence.map(e=>e.source),priorObservations:structuredClone(observations.get(key)??[]).slice(-12)},sessionDiagnostics:{...diagnostic,turnSequence:sequence+(reviewOnly?0:1),recentMessages:recent.length,turnsSinceCheckpoint}};
  }
  function acceptArtifact(response,context,receipt,{lookup=false,checkpoint=false}={}){
    if(!semantic)return;
    const evaluation=response.awake.evaluation,key=context.currentState.scopeId;
    const artifact={...structuredClone(evaluation),at:new Date().toISOString(),status:receipt.semanticStatus,temporary:memoryMode==='temporary',durable:false,turnSequence:sequence,understandingPersistence:memoryMode==='durable'&&evaluation.decision==='change'?'pending':'not_requested'};
    artifacts.push(artifact);lastEvaluation=artifact;
    diagnostic.lastAttempt={scopeId:key,status:receipt.semanticStatus,phase:context.memoryReview.reviewOnly?'checkpoint':'ordinary_turn'};
    if(evaluation.decision==='deferred'||lookup)return;
    if(context.consolidation){const plan=consolidationPlan(response,context);consolidated.set(key,plan.next);consolidationOrigins.set(key,plan.origins);}
    if(receipt.semanticStatus==='not_permitted'){pendingEvidence=[];return;}
    const previous=observations.get(key)??[],next=[...previous];
    for(const item of evaluation.observations){
      for(const prior of next)if(item.relatesTo.includes(prior.id))prior.status=item.disposition==='discard'?'discarded':'superseded';
      next.push({...structuredClone(item),source:`review:${evaluation.reviewId}:${item.id}`,status:item.disposition==='carry'?'provisional':'discarded'});
    }
    observations.set(key,next.slice(-20));pendingEvidence=[];
    if(checkpoint){lastCheckpoint=sequence;turnsSinceCheckpoint=0;if(context.memoryReview.triggers.some(t=>t==='interval_20'||t==='sleep'))intervalTurns=0;}
  }
  function failedArtifact(error,context,phase){
    const scope=context?.currentState?.scopeId??currentScope;
    lastEvaluation={version:1,reviewId:context?.memoryReview?.id,scopeId:scope,decision:'deferred',outcome:'deferred',status:'failed',reason:error.message,diagnostic:error.diagnostic??'memory_review_failed',...(error.diagnosticDetails?{diagnosticDetails:structuredClone(error.diagnosticDetails)}:{}),evidenceRetained:true,durable:false,at:new Date().toISOString()};
    artifacts.push(lastEvaluation);diagnostic.lastAttempt={scopeId:scope,status:'failed',phase,diagnostic:lastEvaluation.diagnostic};
  }
  function applyWorking(envelope,response,receipt,result){
    const working=steward.workingContext(envelope.context),state=working.currentState,own=envelope.context.currentProjectId?'project':'global';
    const merge=(old,next)=>[...new Map([...old,...next].map(e=>[JSON.stringify([e.text,e.sources,e.layer]),e])).values()];
    const review={candidates:merge(lastContext.currentState.review?.candidates??[],receipt.candidates.filter(c=>c.scope===own)),questions:merge(lastContext.currentState.review?.questions??[],receipt.contradictions.filter(c=>c.scope===own))};
    const beforeMind=Object.fromEntries(Object.keys(emptyMind()).map(k=>[k,lastContext.currentState[k]]));
    const mind=nextMind(beforeMind,state,review,result,envelope.context.currentProjectId??null);
    working.currentState={...state,...mind,review};lastContext=structuredClone(working);
    if(memoryMode==='temporary')temporaryStates.set(currentScope,structuredClone(working.currentState));
  }
  for(const turn of recoverConversation?recoveredTurns:[]){if(!turn.scopeId&&!Object.hasOwn(turn.awakeReceipt??{},'projectId'))continue;const key=turn.scopeId??scopeId(turn.awakeReceipt?.projectId??turn.visualReceipt?.projectId??null);histories.set(key,[...(histories.get(key)??[]),turn.user,turn.aida].slice(-recentLimit));}
  function selectContext(context){
    if(!context?.currentState)return;
    currentScope=context.currentState.scopeId;
    const lookup=!!(context.lookupProject||context.projectEvidenceRead);
    if(memoryMode==='temporary'&&!lookup){
      if(temporaryResults.length&&temporaryBase?.scopeId!==currentScope)throw Error('Resolve or discard temporary work before entering a different room. Your temporary understanding is retained.');
      temporaryBase??=structuredClone(context.currentState);
      const local=temporaryStates.get(currentScope);
      if(local){context.currentState=structuredClone(local);const continuity={...Object.fromEntries(stateLayers.map(k=>[k,structuredClone(local[k])])),memoryVersion:local.revision};
        if(context.currentProjectId)context.activeProject.continuity={...context.activeProject.continuity,...continuity};else{context.global={...context.global,...continuity};context.globalState=structuredClone(local);}}
    }
    const selectedHistory=structuredClone(histories.get(currentScope)??(recoverConversation?context.currentState.conversation:[])??[]);
    recent=semantic&&pendingEvidence.length?selectedHistory:selectedHistory.slice(-recentLimit);
    affect=structuredClone(affects.get(currentScope)??context.currentState.affect??initialAffect);
    if(!lookup)lastContext=structuredClone(context);
  }
  const handoffRecent=()=>steward?histories.get(scopeId(steward.activeProjectId))??[]:recent;

  return {
    get memoryStatus(){return status();},
    reauthorized(){diagnostic.authorizationRefreshes=(diagnostic.authorizationRefreshes??0)+1;return status();},
    acceptCommit(verified){
      if(verified?.status!=='verified')throw Error('Only readback-verified state may be marked committed.');
      const selected=verified.records.find(r=>(r.projectId?'project:'+r.projectId:'everyday')===currentScope);
      if(selected){lastContext.currentState=currentPackage(selected.recovered,selected.projectId);steward.discardWorking();}
      if(lastEvaluation?.understandingPersistence==='pending')lastEvaluation.understandingPersistence='verified';
      pendingReviewCommit=null;
      return status();
    },
    async review(trigger='explicit_review'){
      if(!semantic)return{status:'legacy',changed:false};
      if(inFlight)throw Error('Wait for the active turn.');
      if(pendingReviewCommit)return{status:'awaiting_commit',artifact:lastEvaluation,reused:true};
      if(lastCheckpoint===sequence&&!pendingEvidence.length)return{status:'reviewed',artifact:lastEvaluation,reused:true};
      inFlight=true;let reviewId,reviewEvidence=[];
      try{
        const user={source:'review-control:'+crypto.randomUUID(),role:'user',text:'Review supplied conversation evidence and current understanding. This control message supplies no personal or fictional facts.'};
        let context=await steward.assemble(recent,user);context=await steward.checkoutContext(context,{readOnly:memoryMode==='temporary',preserveWorking:true});selectContext(context);
        context=reviewRequest({...context,capabilities:[],memoryMode},user,[trigger],true);
        reviewId=context.memoryReview.id;
        reviewEvidence=context.memoryReview.evidence;
        if(!context.memoryReview.sources.length){
          const artifact={version:1,reviewId:context.memoryReview.id,scopeId:currentScope,decision:'no_change',domain:'uncertain',outcome:'reviewed_discarded',reason:'No new eligible conversation evidence; no interpretation was added or removed.',sources:[],coveredSources:[],assessed:['short','long','orientation','unfinished','contradictions'],observations:[],at:new Date().toISOString(),status:'reviewed_discarded',durable:false,mechanism:'deterministic_empty_evidence_check'};
          artifacts.push(artifact);lastEvaluation=artifact;lastCheckpoint=sequence;turnsSinceCheckpoint=0;return{status:'reviewed',artifact};
        }
        const envelope={version:conversationVersion,identity:{...identity},memory:{long:[],short:[],facts:[],insights:[],recent:[]},affect:{...affect},environment:{tools:[],recentStorage:'session-local-review-evidence'},user,context};
        // Raw evidence has one channel; do not duplicate it in the current package.
        const request=structuredClone(envelope);request.context.currentState.conversation=[];if(request.context.globalState)request.context.globalState.conversation=[];
        const projected=projectPrompt(request);
        const response=parseConversationResponse(await provider(projected),projected);
        if(!response.skillRequest)consolidationPlan(response,context);
        if(memoryMode==='durable'&&!sessionResults.length&&response.awake.evaluation.decision==='change')throw Object.assign(Error('A changed review requires an eligible completed exchange before durable persistence; evidence retained.'),{diagnostic:'memory_review_source'});
        const receipt=await steward.apply(envelope,response.awake,true);
        const now=new Date().toISOString(),result={envelope,response,receipt,reviewOnly:true,turn:{turnId:context.memoryReview.id,completedAt:now,user,aida:{source:'review-output:'+context.memoryReview.id,role:'aida',text:response.reply}}};
        if(response.awake.evaluation.decision!=='deferred')applyWorking(envelope,response,receipt,result);
        acceptArtifact(response,context,receipt,{checkpoint:true});
        if(response.awake.evaluation.decision==='deferred')throw Object.assign(Error('Memory review deferred; all source evidence is retained for retry.'),{diagnostic:'memory_review_deferred'});
        if(memoryMode==='durable'&&response.awake.evaluation.decision==='change')pendingReviewCommit=response.awake.evaluation.reviewId;
        recent=recent.slice(-recentLimit);histories.set(currentScope,structuredClone(recent));reviewCheckpoint=undefined;pendingAttempt=undefined;
        return{status:'reviewed',artifact:lastEvaluation,changed:response.awake.evaluation.decision==='change',requestContext:request.context};
      }catch(error){
        addEvidence(reviewEvidence);
        if(error.diagnostic!=='memory_review_deferred')failedArtifact(error,{currentState:{scopeId:currentScope},memoryReview:{id:reviewId}},'memory_review');
        throw Object.assign(error,{callPhase:'memory_review',reviewEvidenceRetained:true});
      }finally{inFlight=false;}
    },
    async commitReview(){
      if(memoryMode!=='durable'||!pendingReviewCommit)return null;
      if(!sessionResults.length)throw Error('Reviewed understanding remains uncommitted: no eligible completed exchange is available. Working state is retained; continue the conversation before handoff.');
      reviewCheckpoint??=await stateStore.prepareUnderstanding(sessionResults,{...lastContext,commitOperationId:pendingReviewCommit});
      const result=await stateStore.commitUnderstanding(reviewCheckpoint);reviewCheckpoint=undefined;this.acceptCommit(result);return result;
    },
    async inspect(){
      const base=await stateStore.load(),id=steward.activeProjectId,project=id?await stateStore.project(id):null;
      return{...base,currentProjectId:id,currentState:currentPackage(project?.continuity??base.global,id),globalState:currentPackage(base.global),inspectionOnly:true};
    },
    async checkout(options={}){if(pendingReviewCommit)throw Error('Verify or explicitly discard the reviewed local update before replacing its working context.');const user={source:'session:checkout',role:'user',text:'Check current scope.'};let context=await steward.assemble([],user);context=await steward.checkoutContext(context,{...options,readOnly:memoryMode==='temporary'});selectContext(context);return context;},
    async discardReviewedUpdate(){
      if(!pendingReviewCommit||pendingEvidence.length)throw Error('Only a completed but uncommitted review may be explicitly discarded.');
      pendingReviewCommit=null;reviewCheckpoint=undefined;if(lastEvaluation)lastEvaluation.understandingPersistence='discarded_by_user';return this.discardTemporary();
    },
    async enterScope(id){if(inFlight)throw Error('Wait for the active turn.');if(temporaryResults.length)throw Error('Resolve or discard temporary work before changing scope.');await this.review('scope_change');await steward.releaseScope();clearTemporary('scope_change');await steward.enterScope(id);histories.delete(scopeId(id));affects.delete(scopeId(id));return this.checkout();},
    async discardTemporary(){if(inFlight)throw Error('Wait for the active turn.');await this.review('resume_committed');clearTemporary('resume_committed');const context=await steward.assemble([],{source:'session:resume',role:'user',text:'Resume latest committed understanding.'});selectContext(await steward.checkoutContext(context,{readOnly:true}));return lastContext;},
    async setMode(next,choice){
      if(!['temporary','durable'].includes(next)||inFlight)throw Error('Wait for the active turn and choose a valid conversation mode.');
      if(next===memoryMode)return status();
      await this.review('mode_change');
      if(next==='temporary'){await this.commitReview();await steward.releaseScope();clearTemporary('durable_to_temporary');memoryMode=next;await this.checkout();return status();}
      if(temporaryResults.length&&!['understanding','exchanges','both','neither'].includes(choice))return{...status(),needsChoice:true};
      if(preservation&&choice!==preservation.choice)throw Error('Retry the same preservation choice or explicitly discard pending work.');
      const preserveState=['understanding','both'].includes(choice)&&status().meaningfulChanges;
      const preserveExchanges=['exchanges','both'].includes(choice);
      preservation??={choice,archived:false,verified:false};
      if(preserveState&&!preservation.verified){
        if(!stateStore)throw Error('The current-state persistence route is unavailable.');
        if(!preservation.checkpoint){await steward.checkoutContext(lastContext,{preserveWorking:true});preservation.checkpoint=await stateStore.prepareUnderstanding(temporaryResults,lastContext);}
        preservation.receipt=await stateStore.commitUnderstanding(preservation.checkpoint);preservation.verified=true;
      }
      if(preserveExchanges&&!preservation.archived){await archiveTurns(temporaryResults);preservation.archived=true;}
      const acquired=await steward.checkoutContext(await steward.assemble([],{source:'session:durable-mode',role:'user',text:'Explicitly begin durable conversation.'}),{preserveWorking:true});
      const verified=preservation.receipt;clearTemporary('temporary_to_durable');memoryMode='durable';selectContext(steward.workingContext(acquired,{canonical:true}));return{...status(),verified};
    },
    async endSession(choice){
      await this.review('sleep');
      if(memoryMode==='temporary'&&status().meaningfulChanges&&!choice)return{...status(),needsDecision:true};
      if(memoryMode==='temporary'&&choice==='understanding'){
        const result=await this.setMode('durable','understanding');await steward.releaseScope();clearTemporary();memoryMode='temporary';await this.checkout();return{...status(),verified:result.verified,ended:true};
      }
      const verified=await this.commitReview();await steward.releaseScope();clearTemporary('session_ended');
      const context=await steward.assemble([],{source:'session:ended',role:'user',text:'Read latest committed understanding.'});
      selectContext(await steward.checkoutContext(context,{readOnly:true}));return{...status(),verified,ended:true};
    },
    async handoff(){if(inFlight)throw Error('Wait for the active turn.');await this.review('handoff');const verified=await this.commitReview();await steward.releaseScope();return {status:'released',scopeId:currentScope,verified};},
    recentForHandoff() { return structuredClone(handoffRecent().slice(-4)); },
    get recentTurnCount() { return recent.length / 2; },
    omitTurn(turn) {
      recent = recent.filter(entry => entry.source !== turn.user.source && entry.source !== turn.aida.source);
      histories.set(currentScope,recent);
    },
    async suggestLibrarySearch(workspace) {
      if (inFlight) throw new Error("A conversation turn is already in progress.");
      inFlight = true;
      try {
        const librarySuggestion = structuredClone({ identity, recent:handoffRecent(), affect, workspace });
        return parseLibrarySuggestion(await provider({ librarySuggestion }));
      } finally {
        inFlight = false;
      }
    },
    async send(message, { keepInContext = true, libraryEvidence, visual, memoryDisposition = 'auto' } = {}) {
      if (!text(message, 4000)) throw new Error("Enter a message between 1 and 4,000 characters.");
      if (inFlight) throw new Error("A conversation turn is already in progress.");
      inFlight = true;
      try {
        if(semantic&&JSON.stringify(sessionResults).length>2*1024*1024)throw Error('Session evidence capacity reached. Review and finish this session before continuing; no evidence was discarded.');
        if(pendingReviewCommit)throw Error('Verify the pending reviewed understanding before another Send. Retry the review commit without another provider call.');
        if(pendingAttempt&&pendingAttempt.text!==message.trim())throw Error('Retry the failed message or explicitly review its pending evidence before sending different text.');
        const workspaceEvidence = libraryEvidence ? structuredClone(libraryEvidence) : undefined;
        const turnId = pendingAttempt?.turnId??crypto.randomUUID();
        const startedAt = new Date().toISOString();
        const order = Math.max(Date.parse(startedAt), lastOrder + 1);
        const [saved, canonical] = await Promise.all([memoryStore.recall(), loadCanonicalFacts()]);
        const user = { source: `turn:${turnId}:user`, role: "user", text: message.trim() };
        let context = steward ? await steward.assemble(recent, user, visual ? visual.evidence.projectId ?? null : undefined) : undefined;
        if(context&&steward.checkoutContext){context=await steward.checkoutContext(context,{readOnly:memoryMode==='temporary'});selectContext(context);}
        if(context)context.memoryMode=memoryMode;
        if (context && workspaceEvidence) {
          context = { ...context, capabilities: context.capabilities.filter(skill => skill.id !== "search_remember") };
        }
        const triggers=['per_turn'];
        if(intervalTurns+1>=20)triggers.push('interval_20');
        if(recent.length+2>recentLimit||recent.reduce((sum,e)=>sum+e.text.length,0)+message.length>6000)triggers.push('before_compaction');
        if(context)context=reviewRequest(context,user,triggers);
        if(semantic&&keepInContext){addEvidence([user]);pendingAttempt={turnId,text:message.trim()};}
        const envelope = {
          version: conversationVersion,
          identity: { ...identity },
          memory: {
            long: [], short: [], insights: [],
            facts: [...(saved ? [{
              source: `drive:${saved.fileId}`,
              recordId: saved.record.id,
              savedAt: saved.record.updated_at,
              text: saved.record.text
            }] : []), ...canonical],
            recent: structuredClone(recent)
          },
          affect: { ...affect },
          environment: { recentStorage: recoveredTurns.length ? "drive-and-browser-session" : "browser-session", tools: [] },
          user,
          ...(workspaceEvidence ? { workspaceEvidence } : {}),
          ...(visual ? { visualEvidence: structuredClone(visual.evidence) } : {}),
          ...(context ? { context } : {})
        };
        let requestContext;
        async function requestReply() {
          let raw;
          try {
            const request=structuredClone(envelope);
            if(request.context?.globalState&&!consolidation){
              request.context.globalState.facts=[...request.context.globalState.facts,...request.memory.facts];
              if(request.context.currentState.scopeId==='everyday')request.context.currentState.facts=structuredClone(request.context.globalState.facts);
              for(const continuity of [request.context.global,request.context.activeProject?.continuity,request.context.lookupProject?.continuity])if(continuity){delete continuity.livingMind;delete continuity.review;}
              if(request.context.currentState.scopeId==='everyday')delete request.context.globalState;
              else request.context.globalState.conversation=[];
            }
            if(!recoverConversation){
              const strip=value=>{if(!value||typeof value!=='object')return;for(const key of Object.keys(value))if(key==='conversation')value[key]=[];else strip(value[key]);};strip(request.context);
            }
            if(request.context?.memoryReview){request.memory.recent=[];request.context.currentState.conversation=[];if(request.context.globalState)request.context.globalState.conversation=[];}
            const projected=projectPrompt(request);
            requestContext=structuredClone(projected.context);
            raw = await provider(projected, visual?.image);
            const parsed=parseConversationResponse(raw,projected);
            if(!parsed.skillRequest)consolidationPlan(parsed,context);
            return parsed;
          } catch (error) {
            if (error instanceof ConversationTransportError || error instanceof ConversationValidationError || error.diagnostic==='prompt_budget') throw error;
            throw new Error("The conversation provider failed. Try again.");
          }
        }
        let response;
        try {
          response = await requestReply();
        } catch (error) {
          if(semantic&&keepInContext){addEvidence(context.memoryReview.evidence);failedArtifact(error,context,'initial');}
          throw Object.assign(error, { projectRead: context?.projectRead, callPhase: "initial" });
        }
        if (response.skillRequest) {
          context = await steward.resolveSkill(context, user, response.skillRequest, envelope, keepInContext);
          if(steward.checkoutContext){context=await steward.checkoutContext(context,{readOnly:memoryMode==='temporary'});selectContext(context);envelope.memory.recent=structuredClone(recent);envelope.affect=structuredClone(affect);}
          context=reviewRequest(context,user,triggers);
          envelope.context = context;
          try {
            response = await requestReply();
          } catch (error) {
            if(semantic&&keepInContext){addEvidence(context.memoryReview.evidence);failedArtifact(error,context,'after_skill');}
            throw Object.assign(error, { callPhase: "after_skill", projectRead: context.projectRead,
              skillFailure: { id: response.skillRequest.id, version: response.skillRequest.version } });
          }
        }
        // Provisional continuity stays in its expiring journal, never in a
        // permanent snapshot or a working interpretation later checkpointed.
        const permitted = keepInContext && !visual && memoryDisposition !== 'provisional' && (memoryMode==='temporary'||!incidentalConsultation(message) || memoryDisposition === 'candidate');
        let receipt;
        try{receipt=steward?await steward.apply(envelope,response.awake,permitted):undefined;}
        catch(error){
          if(semantic&&keepInContext){addEvidence(context.memoryReview.evidence);failedArtifact(error,context,'memory_apply');}
          throw Object.assign(error,{callPhase:'memory_apply',projectRead:context?.projectRead});
        }
        const aida = { source: `turn:${turnId}:aida`, role: "aida", text: response.reply };
        const deferred=semantic&&response.awake.evaluation.decision==='deferred';
        if(deferred)addEvidence(context.memoryReview.evidence);
        if (keepInContext) recent = [...recent, user, aida];
        sequence++;turnsSinceCheckpoint++;intervalTurns++;
        if(semantic&&keepInContext)acceptArtifact(response,context,receipt,{lookup:!!(context.lookupProject||context.projectEvidenceRead),checkpoint:triggers.some(t=>t!=='per_turn')&&!deferred});
        if(!deferred)recent=recent.slice(-recentLimit);
        if(semantic&&keepInContext){if(deferred)addEvidence([aida]);else if(!context.lookupProject&&!context.projectEvidenceRead)addEvidence([aida]);pendingAttempt=undefined;}
        histories.set(currentScope,structuredClone(recent));
        lastOrder = order;
        affect = { ...response.affect };
        affects.set(currentScope,{...affect});
        const result={ envelope, response, receipt, requestContext,turn: { turnId, order, startedAt, completedAt: new Date().toISOString(), user, aida,...(context?{scopeId:currentScope}:{}) } };
        if(semantic&&permitted&&!receipt.preview&&!context.lookupProject&&!context.projectEvidenceRead){
          if(!deferred)applyWorking(envelope,response,receipt,result);
          // Retain original exchanges/receipts for explicitly authorized preservation,
          // not a quadratic archive of every frozen prompt and its earlier evidence.
          const retained=consolidation?{turn:result.turn,receipt:result.receipt,response:{affect:result.response.affect},envelope:{user:result.envelope.user,memory:{...result.envelope.memory,recent:[]},context:{currentProjectId:result.envelope.context.currentProjectId}}}:result;
          if(memoryMode==='temporary')temporaryResults.push(retained);
          sessionResults.push(retained);
        }
        if(context?.lookupProject||context?.projectEvidenceRead)currentScope=scopeId(steward.activeProjectId);
        result.memoryStatus=status();return result;
      } finally {
        inFlight = false;
      }
    }
  };
}
