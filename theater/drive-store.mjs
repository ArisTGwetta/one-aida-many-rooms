import { createDriveClient } from '../memory.mjs';
import { validatePlay } from './continuity.mjs';
import { validateLedger } from './ledger.mjs';
import { validateWork } from './turns.mjs';
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
  const privateWrites = new Map();
  let busy = false;
  async function readPrivate(playId, space, validate) {
    if (!id(playId)) throw Error('Invalid private Theater record scope.');
    await drive.verifyFolder();
    const files = await drive.list(new URLSearchParams({ q: `trashed = false and appProperties has { key='theaterNamespace' and value='${space}' } and appProperties has { key='playId' and value='${playId}' }`,
      fields: 'files(id,name,parents,appProperties),nextPageToken,incompleteSearch', pageSize: '1000' }));
    if (files.nextPageToken || files.incompleteSearch || !Array.isArray(files.files)) throw Error('Private Theater listing is incomplete.');
    const seen = new Set(), records = [];
    for (const file of files.files) {
      const row = validate(await drive.readJson(file.id));
      const key = space === 'theater-turn-work@1' ? row.id + '-' + row.sequence : row.id;
      if (row.playId !== playId || file.appProperties?.theaterNamespace !== space || file.appProperties?.playId !== playId ||
          file.name !== `${space}-${playId}-${key}.json` || seen.has(key)) throw Error('Conflicting or foreign private Theater record.');
      seen.add(key); records.push(row);
    }
    return records;
  }
  async function appendPrivate(record, space, validate) {
    validate(record);
    const key = space === 'theater-turn-work@1' ? record.id + '-' + record.sequence : record.id;
    const writeKey = space + ':' + record.playId + ':' + key;
    const text = JSON.stringify(record);
    const old = privateWrites.get(writeKey);
    if (old && old.text !== text) throw Error('Private retry payload changed.');
    const rows = await readPrivate(record.playId, space, validate);
    const match = rows.find(row => row.id === record.id && (space !== 'theater-turn-work@1' || row.sequence === record.sequence));
    if (match) {
      if (JSON.stringify(match) !== text) throw Error('Private record identity conflict.');
      privateWrites.delete(writeKey); return structuredClone(match);
    }
    const fileId = old?.fileId ?? await drive.generateId();
    privateWrites.set(writeKey, { fileId, text });
    await drive.uploadJson(fileId, `${space}-${record.playId}-${key}.json`, { theaterNamespace: space, playId: record.playId }, record);
    const readback = validate(await drive.readJson(fileId));
    if (JSON.stringify(readback) !== text) throw Error('Private Theater write readback failed; retry retained.');
    const verified = await readPrivate(record.playId, space, validate);
    if (!verified.some(row => JSON.stringify(row) === text)) throw Error('Private Theater write not discoverable.');
    privateWrites.delete(writeKey); return structuredClone(readback);
  }
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
    loadLedger: playId => readPrivate(playId, 'theater-execution-ledger@1', validateLedger),
    appendLedger: record => appendPrivate(record, 'theater-execution-ledger@1', validateLedger),
    saveWork: record => appendPrivate(record, 'theater-turn-work@1', validateWork),
    async loadWork(playId) {
      const rows = await readPrivate(playId, 'theater-turn-work@1', validateWork);
      const latest = new Map();
      for (const row of rows) if (!latest.has(row.id) || latest.get(row.id).sequence < row.sequence) latest.set(row.id, row);
      for (const row of latest.values()) if (rows.filter(item => item.id === row.id).length !== row.sequence)
        throw Error('Missing pending-turn revision.');
      const active = [...latest.values()].filter(row => row.status === 'pending');
      if (active.length > 1) throw Error('Conflicting pending turns; automatic recovery stopped.');
      return active[0] ? structuredClone(active[0]) : null;
    },
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
