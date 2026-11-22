import { validateAwake } from "./awake-context.mjs";
import { incidentalConsultation } from './memory-bridge.mjs';
import {aidaIdentity,restingAffect,scopeId,nextMind,emptyMind,currentPackage} from './living-mind.mjs';

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
      { diagnostic: error.diagnostic });
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
export function createConversationSession({ memoryStore, provider, recoveredTurns = [], loadCanonicalFacts = async () => [], steward,recoverConversation=true,mode='legacy',stateStore,archiveTurns=async()=>{throw Error('Archiving is unavailable.');} }) {
  let recent = recoverConversation?recoveredTurns.flatMap(turn => [turn.user, turn.aida]).slice(-recentLimit):[];
  let lastOrder = recoveredTurns.reduce((latest, turn) => Math.max(latest, turn.order), 0);
  let affect = { ...initialAffect };
  let inFlight = false;
  const histories=new Map(),affects=new Map();let currentScope='everyday';
  let memoryMode=mode,lastContext,temporaryBase,temporaryResults=[],preservation;
  const temporaryStates=new Map();
  const stateLayers=['long','short','recent','facts','insights'];
  const meaning=value=>JSON.stringify([stateLayers.map(k=>value?.[k]??[]),value?.review??{}]);
  function clearTemporary(){steward?.discardWorking?.();temporaryStates.clear();temporaryResults=[];temporaryBase=undefined;preservation=undefined;histories.delete(currentScope);affects.delete(currentScope);recent=[];}
  function status(){return{mode:memoryMode,scopeId:currentScope,committedRevision:temporaryBase?.revision??lastContext?.currentState.revision??null,
    meaningfulChanges:!!temporaryBase&&meaning(temporaryBase)!==meaning(lastContext?.currentState),temporaryExchanges:temporaryResults.length,
    current:structuredClone(lastContext?.currentState),committed:structuredClone(temporaryBase),persistence:memoryMode==='temporary'?'session-local; not saved':'durable mode; see verified commit receipt'};}
  for(const turn of recoverConversation?recoveredTurns:[]){if(!turn.scopeId&&!Object.hasOwn(turn.awakeReceipt??{},'projectId'))continue;const key=turn.scopeId??scopeId(turn.awakeReceipt?.projectId??turn.visualReceipt?.projectId??null);histories.set(key,[...(histories.get(key)??[]),turn.user,turn.aida].slice(-recentLimit));}
  function selectContext(context){
    if(!context?.currentState)return;
    currentScope=context.currentState.scopeId;
    const lookup=!!(context.lookupProject||context.projectEvidenceRead);
    if(memoryMode==='temporary'&&!lookup){
      if(temporaryResults.length&&temporaryBase?.scopeId!==currentScope)throw Error('Resolve or discard temporary work before entering a different room. Your temporary understanding is retained.');
      temporaryBase??=structuredClone(context.currentState);
      const local=temporaryStates.get(currentScope);
      if(local){context.currentState=structuredClone(local);const continuity=Object.fromEntries(stateLayers.map(k=>[k,structuredClone(local[k])]));
        if(context.currentProjectId)context.activeProject.continuity={...context.activeProject.continuity,...continuity};else{context.global={...context.global,...continuity};context.globalState=structuredClone(local);}}
    }
    recent=structuredClone(histories.get(currentScope)??(recoverConversation?context.currentState.conversation:[])??[]).slice(-recentLimit);
    affect=structuredClone(affects.get(currentScope)??context.currentState.affect??initialAffect);
    if(!lookup)lastContext=structuredClone(context);
  }
  const handoffRecent=()=>steward?histories.get(scopeId(steward.activeProjectId))??[]:recent;

  return {
    get memoryStatus(){return status();},
    async inspect(){
      const base=await stateStore.load(),id=steward.activeProjectId,project=id?await stateStore.project(id):null;
      return{...base,currentProjectId:id,currentState:currentPackage(project?.continuity??base.global,id),globalState:currentPackage(base.global),inspectionOnly:true};
    },
    async checkout(options={}){const user={source:'session:checkout',role:'user',text:'Check current scope.'};let context=await steward.assemble([],user);context=await steward.checkoutContext(context,{...options,readOnly:memoryMode==='temporary'});selectContext(context);return context;},
    async enterScope(id){if(inFlight)throw Error('Wait for the active turn.');if(temporaryResults.length)throw Error('Resolve or discard temporary work before changing scope.');await steward.releaseScope();clearTemporary();await steward.enterScope(id);histories.delete(scopeId(id));affects.delete(scopeId(id));return this.checkout();},
    async discardTemporary(){if(inFlight)throw Error('Wait for the active turn.');clearTemporary();const context=await steward.assemble([],{source:'session:resume',role:'user',text:'Resume latest committed understanding.'});selectContext(await steward.checkoutContext(context,{readOnly:true}));return lastContext;},
    async setMode(next,choice){
      if(!['temporary','durable'].includes(next)||inFlight)throw Error('Wait for the active turn and choose a valid conversation mode.');
      if(next===memoryMode)return status();
      if(next==='temporary'){await steward.releaseScope();clearTemporary();memoryMode=next;await this.checkout();return status();}
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
      const verified=preservation.receipt;clearTemporary();memoryMode='durable';selectContext(steward.workingContext(acquired));return{...status(),verified};
    },
    async endSession(choice){
      if(memoryMode==='temporary'&&status().meaningfulChanges&&!choice)return{...status(),needsDecision:true};
      if(memoryMode==='temporary'&&choice==='understanding'){
        const result=await this.setMode('durable','understanding');await steward.releaseScope();clearTemporary();memoryMode='temporary';await this.checkout();return{...status(),verified:result.verified,ended:true};
      }
      await steward.releaseScope();clearTemporary();
      const context=await steward.assemble([],{source:'session:ended',role:'user',text:'Read latest committed understanding.'});
      selectContext(await steward.checkoutContext(context,{readOnly:true}));return{...status(),ended:true};
    },
    async handoff(){if(inFlight)throw Error('Wait for the active turn.');await steward.releaseScope();return {status:'released',scopeId:currentScope};},
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
        if(memoryMode==='temporary'&&temporaryResults.length>=12)throw Error('Resolve this temporary conversation before continuing: preserve its understanding, archive it, or let it go.');
        const workspaceEvidence = libraryEvidence ? structuredClone(libraryEvidence) : undefined;
        const turnId = crypto.randomUUID();
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
            if(request.context?.globalState){
              request.context.globalState.facts=[...request.context.globalState.facts,...request.memory.facts];
              if(request.context.currentState.scopeId==='everyday')request.context.currentState.facts=structuredClone(request.context.globalState.facts);
              for(const continuity of [request.context.global,request.context.activeProject?.continuity,request.context.lookupProject?.continuity])if(continuity){delete continuity.livingMind;delete continuity.review;}
              if(request.context.currentState.scopeId==='everyday')delete request.context.globalState;
              else request.context.globalState.conversation=[];
            }
            if(!recoverConversation){
              const strip=value=>{if(!value||typeof value!=='object')return;for(const key of Object.keys(value))if(key==='conversation')value[key]=[];else strip(value[key]);};strip(request.context);
            }
            requestContext=structuredClone(request.context);
            raw = await provider(request, visual?.image);
            return parseConversationResponse(raw,request);
          } catch (error) {
            if (error instanceof ConversationTransportError || error instanceof ConversationValidationError) throw error;
            throw new Error("The conversation provider failed. Try again.");
          }
        }
        let response;
        try {
          response = await requestReply();
        } catch (error) {
          throw Object.assign(error, { projectRead: context?.projectRead, callPhase: "initial" });
        }
        if (response.skillRequest) {
          context = await steward.resolveSkill(context, user, response.skillRequest, envelope, keepInContext);
          if(steward.checkoutContext){context=await steward.checkoutContext(context,{readOnly:memoryMode==='temporary'});selectContext(context);envelope.memory.recent=structuredClone(recent);envelope.affect=structuredClone(affect);}
          envelope.context = context;
          try {
            response = await requestReply();
          } catch (error) {
            throw Object.assign(error, { callPhase: "after_skill", projectRead: context.projectRead,
              skillFailure: { id: response.skillRequest.id, version: response.skillRequest.version } });
          }
        }
        // Provisional continuity stays in its expiring journal, never in a
        // permanent snapshot or a working interpretation later checkpointed.
        const permitted = keepInContext && !visual && memoryDisposition !== 'provisional' && (memoryMode==='temporary'||!incidentalConsultation(message) || memoryDisposition === 'candidate');
        const receipt = steward ? await steward.apply(envelope, response.awake, permitted) : undefined;
        const aida = { source: `turn:${turnId}:aida`, role: "aida", text: response.reply };
        if (keepInContext) recent = [...recent, user, aida].slice(-recentLimit);
        histories.set(currentScope,structuredClone(recent));
        lastOrder = order;
        affect = { ...response.affect };
        affects.set(currentScope,{...affect});
        const result={ envelope, response, receipt, requestContext,turn: { turnId, order, startedAt, completedAt: new Date().toISOString(), user, aida,...(context?{scopeId:currentScope}:{}) } };
        if(memoryMode==='temporary'&&permitted&&!receipt.preview&&!context.lookupProject&&!context.projectEvidenceRead){
          const working=steward.workingContext(context),state=working.currentState;
          const own=context.currentProjectId?'project':'global';
          const review={candidates:[...(lastContext.currentState.review?.candidates??[]),...receipt.candidates.filter(c=>c.scope===own)],questions:[...(lastContext.currentState.review?.questions??[]),...receipt.contradictions.filter(c=>c.scope===own)]};
          const beforeMind=Object.fromEntries(Object.keys(emptyMind()).map(k=>[k,lastContext.currentState[k]]));
          const mind=nextMind(beforeMind,state,review,result,context.currentProjectId??null);
          working.currentState={...state,...mind,review};temporaryStates.set(currentScope,structuredClone(working.currentState));lastContext=structuredClone(working);temporaryResults.push(result);
        }else if(memoryMode==='durable'&&permitted&&!receipt.preview&&!context.lookupProject&&!context.projectEvidenceRead){
          lastContext=steward.workingContext(context);
        }
        if(context?.lookupProject||context?.projectEvidenceRead)currentScope=scopeId(steward.activeProjectId);
        result.memoryStatus=status();return result;
      } finally {
        inFlight = false;
      }
    }
  };
}
