import { validatePlay, upgradePlay, appendEvent, portfolioView } from './continuity.mjs';
export function playerAction(play, text, actionId = crypto.randomUUID(), checkpointId = crypto.randomUUID()) {
  const base = upgradePlay(play);
  const game = portfolioView(base, 'game');
  const next = appendEvent(base, 'game', text, actionId);
  next.checkpoints = [...base.checkpoints, { id: checkpointId, playId: base.playId, branchId: base.branchId,
    beforeActionId: actionId, events: game.events, game: game.portfolio }].slice(-2);
  return validatePlay(next);
}
export function proposeRestore(play, checkpointId, expectedRevision, operationId = crypto.randomUUID()) {
  const base = upgradePlay(play);
  const index = base.checkpoints.findIndex(cp => cp.id === checkpointId);
  if (index < 0 || !Number.isInteger(expectedRevision) || expectedRevision < 0) throw Error('Restore point unavailable or stale.');
  const cp = base.checkpoints[index];
  const next = structuredClone(base);
  next.activeGameIds = cp.events.map(e => e.id);
  next.game = structuredClone(cp.game);
  next.checkpoints = base.checkpoints.slice(0, index);
  next.branchId = operationId;
  validatePlay(next);
  return { kind: 'restore', checkpointId, operationId, revision: expectedRevision, snapshot: next };
}
export async function commitRestore(storage, playId, pending) {
  validatePlay(pending.snapshot);
  if (pending.kind !== 'restore' || pending.snapshot.playId !== playId) throw Error('Invalid pending restore.');
  return storage.savePlay(playId, pending.revision, pending.snapshot, pending.operationId);
}
