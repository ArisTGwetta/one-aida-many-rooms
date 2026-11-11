export const conversationVersion = "0.2";
export class ConversationTransportError extends Error {}
const recentLimit = 6;
const memoryKinds = ["facts", "insights", "short", "long"];
const intents = ["conversation", "recall", "memory_update", "tool_request"];
const routes = ["reply", "memory_review", "tool_review"];
const initialAffect = { valence: 0, arousal: 0.2, label: "calm", expression: null };

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
  let output;
  try {
    output = JSON.parse(raw);
  } catch {
    throw new Error("The conversation provider did not return valid JSON.");
  }
  if (!hasFields(output, ["version", "reply", "intent", "route", "affect", "candidates", "tools"]) ||
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
  return output;
}

// The provider boundary accepts one envelope and returns JSON text. All state here is session-only.
export function createConversationSession({ memoryStore, provider }) {
  let recent = [];
  let affect = { ...initialAffect };
  let inFlight = false;

  return {
    async send(message) {
      if (!text(message, 4000)) throw new Error("Enter a message between 1 and 4,000 characters.");
      if (inFlight) throw new Error("A conversation turn is already in progress.");
      inFlight = true;
      try {
        const saved = await memoryStore.recall();
        const user = { source: `session:${crypto.randomUUID()}`, role: "user", text: message.trim() };
        const envelope = {
          version: conversationVersion,
          identity: { name: "Aida", relationship: "The user's ongoing conversational companion." },
          memory: {
            long: [], short: [], insights: [],
            facts: saved ? [{
              source: `drive:${saved.fileId}`,
              recordId: saved.record.id,
              savedAt: saved.record.updated_at,
              text: saved.record.text
            }] : [],
            recent: structuredClone(recent)
          },
          affect: { ...affect },
          environment: { recentStorage: "browser-session", tools: [] },
          user
        };
        let raw;
        try {
          raw = await provider(structuredClone(envelope));
        } catch (error) {
          if (error instanceof ConversationTransportError) throw error;
          throw new Error("The conversation provider failed. Try again.");
        }
        const response = parseConversationResponse(raw, envelope);
        recent = [...recent, user, {
          source: `session:${crypto.randomUUID()}`, role: "aida", text: response.reply
        }].slice(-recentLimit);
        affect = { ...response.affect };
        return { envelope, response };
      } finally {
        inFlight = false;
      }
    }
  };
}
