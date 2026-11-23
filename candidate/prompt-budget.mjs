import { Tiktoken } from './vendor/tokenizer/core.mjs';
import ranks from './vendor/tokenizer/o200k_base.mjs';

// Reference BPE counts, not a claim about an unverified remote/local tokenizer.
const encoder = new Tiktoken(ranks);
export const tokenCount = value => encoder.encode(typeof value === 'string' ? value : JSON.stringify(value), [], []).length;
export function promptBudget({provider,model,content,instructions,schema,outputTokens,enforce=false}) {
  const reference={instructions:tokenCount(instructions),schema:tokenCount(schema),context:tokenCount(content)};
  const profile=provider==='openai'?{total:20000,margin:1.2}:{total:16384,margin:1.35};
  const input=Object.values(reference).reduce((a,b)=>a+b,0),reserved=Math.ceil((input+64)*profile.margin)+outputTokens;
  const result={provider,model,encoding:'o200k_base reference; provider tokenizer unverified',referenceTokens:reference,inputTokens:input,outputReserved:outputTokens,safetyFactor:profile.margin,accountedTokens:reserved,limit:profile.total,withinBudget:reserved<=profile.total};
  if(enforce&&!result.withinBudget)throw Object.assign(Error('Prompt budget exceeded; evidence retained. Reduce authorized context or review before retrying.'),{diagnostic:'prompt_budget',promptBudget:result});
  return result;
}

// Only the transport copy is projected. Trusted stewardship keeps complete state.
export function projectPrompt(envelope) {
  const e=structuredClone(envelope),c=e.context;
  if(!c?.promptPolicy)return e;
  const selected=c.lookupProject??c.activeProject;
  if(selected&&c.currentState.scopeId==='project:'+selected.id)selected.continuity={stateRef:'context.currentState'};
  c.global={stateRef:c.currentState.scopeId==='everyday'?'context.currentState':'context.globalState'};
  if(c.currentState.scopeId==='everyday')delete c.globalState;
  for(const state of [c.currentState,c.globalState])if(state)state.conversation=[];
  e.memory.recent=[];
  if(c.consolidation)delete c.recentPlus; // previous already lives in the consolidation packet
  return e;
}
