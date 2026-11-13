# One Aida, Many Rooms

Aida's First Memory saves one fact as a JSON file in Google Drive and reads it back with its Drive file ID and UTC timestamp. Once saved, the fact is read-only in this prototype. Repeating the same save returns the stored record. Recall always reads Drive.

## Local checks

Run `node --test` with Node.js 22 or newer. The tests simulate Google sign-in and Drive responses.

## Local conversation test

Set `OPENAI_API_KEY` in the server process environment through your usual secret setup. Run `node dev-server.mjs` and open `http://127.0.0.1:8787/`. The server listens on loopback and accepts chat requests only from that page's origin. The browser never receives the OpenAI key.

Authorize the intended Google account and ask “Hello Aida. Do you remember what I told you when we first met?” The existing OAuth client must already allow `http://127.0.0.1:8787` as a JavaScript origin. A local config response tells the app which origin it is on, but only Google can approve the origin. If Google rejects it, stop and record the error.

The development evidence panel shows the Drive source and timestamp, the structured reply, the provider and model, and an estimated OpenAI cost based on reported token usage at standard input, cached input, and output rates. OpenAI uses `gpt-6-luna` with a 900-output-token limit. The server caps the envelope at 48 KiB and makes one provider request per turn.

To enable Ollama, set `AIDA_OLLAMA_ENDPOINT` to a trusted HTTP(S) server origin or its `/api/chat` URL and optionally set `AIDA_OLLAMA_MODEL` before starting the server. Select Ollama in the page and enter an installed model. A network endpoint receives the conversation context. Selection is stored as a browser preference and changing it preserves the current chat. Reloading clears the chat.

See [the intended memory lifecycle](memory-lifecycle.md) for durable context plans.

## RECENT journal

Authorize Drive to resume the most recently saved eligible conversation. The app loads at most three exchanges into context. Open **RECENT journal** to inspect saved files, page through older entries, start a separate conversation, or resume by conversation ID on another device.

**Keep this exchange** defaults to page-only context. Use `Remember this: …` or select **Save to the Drive journal** for a candidate exchange. Select **Temporarily in Drive** for a provisional exchange. Provisional entries expire after 24 hours. The app excludes them from recovery at expiry and moves up to ten expired files to Drive Trash when a new authorization recovers the journal. Normal Drive Trash retention applies.

When a turn becomes meaningful, optionally include the preceding eligible exchange from this page. A provisional exchange can support a candidate before expiry. Each record carries both sides of the exchange, stable source references, timestamps, and its conversation ID. An explicit opt-out or **Leave out of future context** takes precedence. It excludes the current exchange and withdraws the preceding eligible supporting exchange from active context. Previously saved files remain in Drive under their original disposition. The journal performs no reconciliation into FACTS, INSIGHTS, SHORT, or LONG.

Devices append separate Drive files. A save is confirmed after readback. Retry on the same page reuses the reserved Drive ID. If a page closes during a save, recovery can find a file Drive accepted. An exchange that never reached Drive cannot be recovered after closing the page. Simultaneous devices may each answer from their last loaded context. Resume refreshes that context from Drive.

## Manual sleep and proposal review

Authorize Drive, select the provider, and open **Sleep and memory proposals**. **Run sleep cycle** reads up to 12 eligible Drive journal files, including files outside the active conversation. **Run on older evidence** continues through the journal. The selected provider receives the eligible source text. A narrow filter skips plain definition and spelling questions. Larger pages are split into bounded model requests.

The report lists examined sources, excluded incidental turns, provider usage, categories with no update, and proposal IDs. A run saves up to eight new proposals together in one Drive file. FACT proposals are atomic user-reported claims. The first extractor recognizes explicit introductions, first-meeting dates, and electronic-cat descriptions. The model selects from those source-derived options, and the proposal preserves the original wording as evidence. Explicitly synthetic evidence marks its proposals as synthetic. Provisional records are eligible while unexpired.

**Load review queue** recovers proposals independently of chat after authorization. **Correct** saves a revision. **Accept** uses the effective text, including the latest correction. For a non-synthetic `aida/fact`, acceptance and the canonical FACT share one Drive record. The app verifies it by reading it back before showing **committed to Drive**. An older acceptance that needs this step shows **awaiting FACT commit**. Select **Accept** again to commit its effective text without editing the history. Other destinations record review decisions only.

Each conversation reads up to six current canonical FACTs from Drive alongside the original first memory. A newer correction, rejection, or deferral removes a prior acceptance from recall until it is accepted again. The queue can remain pending while Aida chats, journals, or runs sleep again.

Reopening the same evidence batch reuses a saved run. A same-page retry of an unconfirmed write reuses its reserved Drive ID and skips the provider call. If the page closes before Drive receives the run, retrying can require another model call. Overlapping runs from different devices can race before Drive lists the new file. Stable proposal IDs keep duplicate proposals out of the displayed queue.

## Awake context

Use **Drive context records → Check context records** after authorizing Drive. **Initialize empty context records** creates the three base files below. Each uses `schema_version: 1`. It records their Drive file IDs and initialization state in the dedicated folder's app properties. Existing valid files are adopted in place. A first-time missing file is expected. After initialization, missing files, changed IDs, duplicates, malformed content, and access errors surface explicitly. Authorization and refresh only read context. Start initialization from one device at a time.

| File | Contents |
| --- | --- |
| `aida-context-global.json` | Arrays named `long`, `short`, `recent`, `facts`, and `insights`. Each starts empty. Each later entry has `source` and `text`. |
| `aida-context-projects.json` | A `projects` array with `id`, `name`, `description`, `status`, and `routingSummary`. Optional `likelyProjectId` is a hint. |
| `aida-context-project-<id>.json` | The same continuity arrays and a matching `projectId`. |
| `aida-context-capabilities.json` | A `capabilities` array with `id`, `purpose`, `route`, `availability`, `authorization`, and an `arguments` array of `name`, `description`, and `required`. |

Use a direct request such as “Switch to Atlas” to select a registered project. The conversation always supports continuing and asking for help. Catalog routes are named handoffs for review or confirmation. Execution of external capabilities and automatic discovery remain future work.

To keep a fictional story as a project, ask Aida to create a named fictional project and preserve the selected story context. Aida can cite the current request and exchanges in the active six-message context. Review the proposed project, continuity, and exact source excerpts before selecting **Confirm and save project**. LONG captures enduring purpose, SHORT captures the current situation, and RECENT captures meaningful developments. Unsupported sections stay empty.

The steward verifies the project continuity in Drive before adding its catalog entry, then reads both records back. Retry an interrupted save from the same preview to reuse its project ID. Make catalog edits and project creation from one device at a time. The catalog update uses a read followed by a write, so overlapping edits from separate devices can race.

When registering a new project in the Drive catalog, enter its stable ID under **Drive context records** and select **Initialize project continuity**. This creates the corresponding version 1 file with that ID and five empty arrays. Initialization verifies writes by reading the files and folder metadata back from Drive.

The same conversational model call can update working LONG, SHORT, and RECENT. The steward accepts changes on a meaningful rebuild or when the configurable threshold is due. The defaults are four completed turns or growth past 12,000 characters of active continuity and RECENT. **Development evidence** shows the steward receipt. Retained exchanges can store eligible receipts in the journal. A fresh session restores receipts within the recovered window.

## Online conversation

The same application runs at `https://aristgwetta.github.io/one-aida-many-rooms/` once this update is published. Authorize the existing Google account and enter the existing three-digit Phone OpenAI route code on the first OpenAI turn. The app reads the private `aida-openai-fragments.json` from the existing Aida development Drive folder and assembles the key in page memory. Use a fresh authorization or reload to clear it. The Pages files contain the loader and provider adapter. The Drive file holds the original OpenAI route structure and segments. Keep that file unshared.

Scrambling is not encryption. Browser code, extensions, and developer tools can access the reconstructed key during use. This direct-call prototype accepts that tradeoff. OpenAI recommends keeping secret keys on a server. A protected hosted intermediary would reduce browser exposure and would need caller authentication and usage limits. The loopback transport remains available for development.

OpenAI is the default. To use Ollama online, select it and enter a trusted HTTPS endpoint or a local HTTP loopback endpoint and installed model. The browser must be able to reach the endpoint, and Ollama must allow the Pages origin through CORS. Browser network policies can also restrict local endpoints. Ollama receives the selected turn's context using the same envelope as OpenAI. The OpenAI key is sent only to OpenAI.

## Supervised live test

1. Confirm the intended Google account and parent location for **AIDA — ONE AIDA MANY ROOMS — DEV**. Verify the folder by ID in Drive. If it is absent, create it only after confirming the account and parent. Set its ID in `oauth.config.json`. Aida checks the folder name, type, and ID before use.
2. Approve publishing these static files to a separate GitHub Pages path on the previously documented origin, `https://aristgwetta.github.io`. One option is a new Pages project under the same account. Serve `index.html`, `style.css`, `app.mjs`, `memory.mjs`, and `oauth.config.json` together. Localhost uses a different origin.
3. Open that URL in a browser, choose **Authorize Google Drive**, select the intended account, enter a meaningful fact, and choose **Remember**. Check the JSON, Drive file ID, and timestamp.
4. Close the browser session. Reopen the URL, authorize the same account, and choose **Recall**. Repeat from a second device and compare the fact, file ID, and timestamp.

The committed client ID is a public OAuth identifier. The popup requests full Drive access and includes previously granted scopes. The folder is the initial memory destination. Access tokens live only in page memory. The app uses its own files and Google's browser and Drive APIs.

An upload retry in the same page reuses the Drive-generated file ID. A fresh session searches Drive for the existing record before writing. Run the first save on one device at a time. If multiple records are found, Aida reports the conflict.
