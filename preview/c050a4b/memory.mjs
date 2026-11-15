const scope = "https://www.googleapis.com/auth/drive";
const folderName = "AIDA — ONE AIDA MANY ROOMS — DEV";
const folderMime = "application/vnd.google-apps.folder";
const fileName = "aida-first-memory.json";
const marker = { aidaMemory: "first-memory-v1" };
const api = "https://www.googleapis.com/drive/v3";
const upload = "https://www.googleapis.com/upload/drive/v3";
const isId = value => typeof value === "string" && /^[\w-]+$/.test(value);

export function validateConfig(config, origin) {
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(config?.google?.clientId ?? "") ||
      config.google.scopes?.length !== 1 || config.google.scopes[0] !== scope ||
      config.google.includeGrantedScopes !== true) {
    throw new Error("The Google OAuth configuration is invalid.");
  }
  if (origin !== config.google.javascriptOrigin) {
    throw new Error("Google authorization must run on " + config.google.javascriptOrigin + ".");
  }
  if (config.drive?.initialMemoryFolderName !== folderName || !isId(config.drive.initialMemoryFolderId)) {
    throw new Error("Set the verified development folder ID in oauth.config.json before authorizing.");
  }
  return config;
}

// Adapted from Aida Mobile's GIS token client. The token stays in this page's memory.
export function authorize(oauth, config) {
  return new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: config.clientId,
      scope: config.scopes.join(" "),
      include_granted_scopes: config.includeGrantedScopes,
      callback(response) {
        if (response.error || !response.access_token || !oauth.hasGrantedAllScopes(response, scope)) {
          reject(new Error("Google did not grant full Drive access. Choose Authorize Google Drive to retry."));
          return;
        }
        resolve(response.access_token);
      },
      error_callback(error) {
        reject(new Error(error.type === "popup_failed_to_open"
          ? "Allow the Google sign-in popup and try again."
          : "Google sign-in did not finish. Try again."));
      }
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
}

export function createRecord(text) {
  text = text.trim();
  if (!text || text.length > 4000) throw new Error("Enter a memory between 1 and 4,000 characters.");
  const savedAt = new Date().toISOString();
  return {
    schema_version: 1, id: crypto.randomUUID(), text,
    created_at: savedAt, updated_at: savedAt, source: "user-entered"
  };
}

function validateRecord(record) {
  const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  if (record?.schema_version !== 1 || !isId(record.id) || typeof record.text !== "string" ||
      !record.text.trim() || record.text.length > 4000 || record.source !== "user-entered" ||
      !timestamp(record.created_at) || !timestamp(record.updated_at)) {
    throw new Error("The Drive memory record is malformed or uses an unsupported schema.");
  }
  return record;
}

export class DriveError extends Error {
  constructor(status) {
    super({
      401: "Google authorization expired. Authorize Google Drive again.",
      403: "Google Drive refused access. Check the selected account and folder permissions.",
      404: "Google Drive could not find the configured folder or memory file."
    }[status] ?? `Google Drive request failed (HTTP ${status}).`);
    this.status = status;
  }
}

// Adapted from Aida Mobile's Drive v3 list, media fetch, and multipart upload.
export function createDriveClient(folderId, token, fetchRequest = fetch) {
  if (!isId(folderId)) throw new Error("The development folder ID is invalid.");

  async function request(url, options = {}) {
    let response;
    try {
      response = await fetchRequest(url, {
        ...options, cache: "no-store", signal: AbortSignal.timeout(15000),
        headers: { ...options.headers, Authorization: `Bearer ${token()}` }
      });
    } catch {
      throw new Error("Could not reach Google Drive. Try again.");
    }
    if (!response.ok) throw new DriveError(response.status);
    try {
      return await response.json();
    } catch {
      throw new Error("Google Drive returned malformed JSON.");
    }
  }

  async function verifyFolder() {
    const folder = await request(`${api}/files/${folderId}?fields=id,name,mimeType,trashed`);
    if (folder.id !== folderId || folder.name !== folderName || folder.mimeType !== folderMime || folder.trashed !== false) {
      throw new Error("The configured Drive folder does not match the development folder.");
    }
  }

  return {
    verifyFolder,
    async folderProperties() {
      const folder = await request(`${api}/files/${folderId}?fields=id,appProperties`);
      if (folder.id !== folderId) throw new Error("Drive context folder identity mismatch.");
      return folder.appProperties ?? {};
    },
    async setFolderProperties(appProperties) {
      await request(`${api}/files/${folderId}?fields=id,appProperties`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appProperties })
      });
      const saved = await this.folderProperties();
      if (Object.entries(appProperties).some(([key, value]) => saved[key] !== value)) {
        throw new Error("Context initialization metadata could not be verified in Drive.");
      }
      return saved;
    },
    list: query => request(`${api}/files?${query}`),
    async generateId() {
      const { ids } = await request(`${api}/files/generateIds?count=1&space=drive`);
      if (!isId(ids?.[0])) throw new Error("Google Drive did not provide a file ID.");
      return ids[0];
    },
    readJson(fileId) {
      if (!isId(fileId)) throw new Error("Google Drive returned an invalid file ID.");
      return request(`${api}/files/${fileId}?alt=media`);
    },
    replaceJson(fileId, record) {
      if (!isId(fileId)) throw new Error("Google Drive returned an invalid file ID.");
      return request(`${upload}/files/${fileId}?uploadType=media&fields=id`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record)
      });
    },
    async uploadJson(fileId, name, appProperties, record) {
      const boundary = `aida-${crypto.randomUUID()}`;
      const metadata = { id: fileId, name, mimeType: "application/json", parents: [folderId], appProperties };
      const body = [
        `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(metadata),
        `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(record, null, 2),
        `--${boundary}--`, ""
      ].join("\r\n");
      try {
        await request(`${upload}/files?uploadType=multipart&fields=id`, {
          method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body
        });
      } catch (error) {
        // A retry after an ambiguous successful upload returns 409 for the same ID.
        if (error.status !== 409) throw error;
      }
    },
    trash(fileId) {
      if (!isId(fileId)) throw new Error("Google Drive returned an invalid file ID.");
      return request(`${api}/files/${fileId}?fields=id,trashed`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: '{"trashed":true}'
      });
    }
  };
}

export function createMemoryStore(folderId, token, fetchRequest = fetch) {
  const drive = createDriveClient(folderId, token, fetchRequest);
  let pending;

  async function read(fileId) {
    const record = validateRecord(await drive.readJson(fileId));
    return { fileId, record };
  }

  async function find() {
    const query = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and name = '${fileName}' and mimeType = 'application/json' and appProperties has { key='aidaMemory' and value='first-memory-v1' }`,
      fields: "nextPageToken,incompleteSearch,files(id)"
    });
    let fileId;
    do {
      const page = await drive.list(query);
      if (page.incompleteSearch || !Array.isArray(page.files)) throw new Error("Google Drive returned an incomplete memory search.");
      for (const file of page.files) {
        if (fileId) throw new Error("More than one Aida memory file was found. Resolve the duplicate in Drive.");
        if (!isId(file.id)) throw new Error("Google Drive returned an invalid file ID.");
        fileId = file.id;
      }
      if (!page.nextPageToken) break;
      query.set("pageToken", page.nextPageToken);
    } while (true);
    return fileId ? read(fileId) : null;
  }

  return {
    verifyFolder: drive.verifyFolder,
    async recall() {
      await drive.verifyFolder();
      return find();
    },
    async remember(text) {
      const record = createRecord(text);
      await drive.verifyFolder();
      const existing = await find();
      if (existing) {
        if (existing.record.text !== record.text) throw new Error("Aida already has a memory. Use Recall to see it.");
        pending = undefined;
        return existing;
      }
      if (pending && pending.record.text !== record.text) {
        throw new Error("The previous save could not be confirmed. Retry it with the original text.");
      }
      if (!pending) {
        pending = { fileId: await drive.generateId(), record };
      }

      const { fileId } = pending;
      await drive.uploadJson(fileId, fileName, marker, pending.record);
      const stored = await read(fileId);
      if (stored.record.id !== pending.record.id || stored.record.text !== pending.record.text) {
        throw new Error("The record read back from Drive did not match the save.");
      }
      pending = undefined;
      return stored;
    }
  };
}
