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
