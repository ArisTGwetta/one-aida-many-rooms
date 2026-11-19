import { createDriveClient } from '../memory.mjs';
import { validatePlay } from './continuity.mjs';
const namespace = 'theater-snapshots-v1';
const id = x => typeof x === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(x);
export function createTheaterStorage(folderId, token, fetchRequest = fetch) {
  const drive = createDriveClient(folderId, token, fetchRequest);
  return theaterStorage({ ...drive, async list(query) {
    query.set('q', "'" + folderId + "' in parents and (" + query.get('q') + ")");
    const result = await drive.list(query);
    if (!Array.isArray(result.files) || result.files.some(file => !file.parents?.includes(folderId)))
      throw Error('Foreign Theater snapshot location; recovery stopped.');
    return result;
  } });
}
export function theaterStorage(drive) {
  const pending = new Map();
  let busy = false;
  async function list(playId) {
    if (!id(playId)) throw Error('Invalid Theater play ID.');
    await drive.verifyFolder();
    const query = new URLSearchParams({ q: `trashed = false and appProperties has { key='theaterNamespace' and value='${namespace}' } and appProperties has { key='playId' and value='${playId}' }`,
      fields: 'files(id,name,parents,appProperties),nextPageToken', pageSize: '1000' });
    const response = await drive.list(query);
    if (response.nextPageToken) throw Error('Theater snapshot listing exceeds this version’s limit.');
    return response.files ?? [];
  }
  async function recover(playId) {
    const files = await list(playId);
    let latest = null;
    const revisions = new Set();
    for (const file of files) {
      const record = await drive.readJson(file.id);
      if (!record || Object.keys(record).sort().join() !== 'operationId,playId,previousRevision,revision,schema,snapshot' ||
          record.schema !== namespace || record.playId !== playId || !id(record.operationId) ||
          !Number.isInteger(record.revision) || record.revision < 1 || record.previousRevision !== record.revision - 1 ||
          file.name !== `theater-${playId}-${record.operationId}.json` ||
          file.appProperties?.theaterNamespace !== namespace || file.appProperties?.playId !== playId ||
          record.snapshot?.playId !== playId) throw Error('Invalid Theater snapshot; recovery stopped.');
      validatePlay(record.snapshot);
      if (revisions.has(record.revision)) throw Error('Conflicting Theater revisions; no snapshot selected.');
      revisions.add(record.revision);
      if (!latest || record.revision > latest.revision) latest = record;
    }
    if (latest && revisions.size !== latest.revision) throw Error('Missing Theater revision; recovery stopped.');
    return latest ? structuredClone(latest) : null;
  }
  return Object.freeze({
    loadPlay: recover,
    async savePlay(playId, expectedRevision, snapshot, operationId) {
      if (busy) throw Error('Wait for the current Theater save.');
      busy = true;
      try {
        validatePlay(snapshot);
        if (snapshot.playId !== playId || !id(operationId) || !Number.isInteger(expectedRevision) || expectedRevision < 0) throw Error('Invalid Theater save.');
        const record = { schema: namespace, playId, revision: expectedRevision + 1, previousRevision: expectedRevision, operationId, snapshot: structuredClone(snapshot) };
        const key = playId + ':' + operationId;
        const text = JSON.stringify(record);
        const existing = pending.get(key);
        if (existing && existing.text !== text) throw Error('Retry payload changed; recover or retry the original save.');
        const latest = await recover(playId);
        if (latest?.operationId === operationId) {
          if (JSON.stringify(latest) !== text) throw Error('Operation identity conflicts with saved content.');
          pending.delete(key);
          return latest;
        }
        if ((latest?.revision ?? 0) !== expectedRevision) throw Error('Theater changed on another device; recover before saving.');
        const fileId = existing?.fileId ?? await drive.generateId();
        pending.set(key, { fileId, text });
        await drive.uploadJson(fileId, `theater-${playId}-${operationId}.json`, { theaterNamespace: namespace, playId }, record);
        const readback = await drive.readJson(fileId);
        validatePlay(readback?.snapshot);
        if (JSON.stringify(readback) !== text) throw Error('Theater save readback failed; original snapshot retained. Retry the same save.');
        const verified = await recover(playId);
        if (JSON.stringify(verified) !== text) throw Error('Theater save could not be verified.');
        pending.delete(key);
        return verified;
      } finally { busy = false; }
    }
  });
}
