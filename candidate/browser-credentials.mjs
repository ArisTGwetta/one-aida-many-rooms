const filesURL = "https://www.googleapis.com/drive/v3/files";
const filename = "aida-openai-fragments.json";

// Adapted from Phone's private Drive lookup and route-code segment ordering.
export async function loadOpenAIKey(folderId, routeCode, token, fetchRequest = fetch) {
  if (!/^\d{3}$/.test(routeCode)) throw new Error("Enter the three-digit OpenAI route code.");
  if (!/^[\w-]+$/.test(folderId) || !token) throw new Error("Authorize Google Drive before unlocking OpenAI.");

  async function read(url) {
    let response;
    try {
      response = await fetchRequest(url, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        redirect: "error", signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw new Error("Could not reach Drive to load the private OpenAI configuration.");
    }
    if (response.status === 401) {
      throw Object.assign(new Error("Google authorization expired. Authorize Google Drive again."), { status: 401 });
    }
    if (!response.ok) throw new Error("Drive refused the private OpenAI configuration request.");
    try {
      return await response.json();
    } catch {
      throw new Error("The private OpenAI configuration is unreadable.");
    }
  }

  const query = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false and name = '${filename}'`,
    fields: "files(id),nextPageToken,incompleteSearch", pageSize: "2"
  });
  const list = await read(`${filesURL}?${query}`);
  const id = list?.files?.[0]?.id;
  if (list?.incompleteSearch || list?.nextPageToken || list?.files?.length !== 1 ||
      typeof id !== "string" || !/^[\w-]+$/.test(id)) {
    throw new Error("Drive must contain exactly one private OpenAI configuration in the Aida development folder.");
  }
  const config = await read(`${filesURL}/${id}?alt=media`);
  const route = config?.routes?.[routeCode] ?? config?.openai;
  const parts = Array.from(routeCode, digit => route?.segments?.[digit]);
  if (!route || (route.provider && route.provider !== "openai") ||
      typeof route.prefix !== "string" || parts.some(part => typeof part !== "string" || !part)) {
    throw new Error("The OpenAI route code did not match the private configuration.");
  }
  const key = route.prefix + parts.join("");
  if (!/^sk-[A-Za-z0-9_-]{12,}$/.test(key)) throw new Error("The reconstructed OpenAI credential is invalid.");
  return key;
}

// Read the existing provider-neutral legacy format only within the owned development folder.
export async function loadProviderKey({ folderId, provider, routeCode, token }, fetchRequest = fetch) {
  if (provider === 'openai') return loadOpenAIKey(folderId, routeCode, token, fetchRequest);
  if (provider !== 'xai' || !/^\d{3}$/.test(routeCode) || !/^[\w-]+$/.test(folderId) || !token) throw Error('Invalid private provider route request.');
  async function read(url) {
    const response = await fetchRequest(url, { headers: { Authorization: 'Bearer ' + token }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('Private provider configuration unavailable.');
    return response.json();
  }
  const query = new URLSearchParams({ q: `'${folderId}' in parents and trashed = false and (name = 'llm_fragments.json' or name = 'aida-openai-fragments.json')`, fields: 'files(id),nextPageToken,incompleteSearch', pageSize: '10' });
  const listing = await read(filesURL + '?' + query);
  if (!Array.isArray(listing.files) || listing.nextPageToken || listing.incompleteSearch || listing.files.length > 2) throw Error('Private route listing is ambiguous.');
  const matches = [];
  for (const file of listing.files) {
    if (!/^[\w-]+$/.test(file.id)) throw Error('Invalid private route reference.');
    const config = await read(filesURL + '/' + file.id + '?alt=media');
    const route = config?.routes?.[routeCode];
    if (route && ['xai', 'grok'].includes(route.provider)) matches.push(route);
  }
  if (matches.length !== 1) throw Error('Exactly one existing Grok route is required in the owned folder.');
  const route = matches[0], parts = [...routeCode].map(digit => route.segments?.[digit]);
  if (typeof route.prefix !== 'string' || parts.some(part => typeof part !== 'string' || !part)) throw Error('Invalid private Grok route format.');
  const key = route.prefix + parts.join('');
  if (!/^xai-[A-Za-z0-9_-]{12,}$/.test(key)) throw Error('Invalid reconstructed Grok credential.');
  return key;
}
