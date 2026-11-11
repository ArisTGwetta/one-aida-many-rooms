# One Aida, Many Rooms

Aida's First Memory saves one fact as a JSON file in Google Drive and reads it back with its Drive file ID and UTC timestamp. Once saved, the fact is read-only in this prototype. Repeating the same save returns the stored record. Recall always reads Drive.

## Local checks

Run `node --test` with Node.js 22 or newer. The tests simulate Google sign-in and Drive responses.

## Local conversation test

Set `OPENAI_API_KEY` in the server process environment through your usual secret setup. Run `node dev-server.mjs` and open `http://127.0.0.1:8787/`. The server listens on loopback and accepts chat requests only from that page's origin. The browser never receives the OpenAI key.

Authorize the intended Google account and ask “Hello Aida. Do you remember what I told you when we first met?” The existing OAuth client must already allow `http://127.0.0.1:8787` as a JavaScript origin. A local config response tells the app which origin it is on, but only Google can approve the origin. If Google rejects it, stop and record the error.

The development evidence panel shows the Drive source and timestamp, the structured reply, the provider and model, and an estimated OpenAI cost based on reported token usage at standard input, cached input, and output rates. OpenAI uses `gpt-6-luna` with a 900-output-token limit. The server caps the envelope at 48 KiB and makes one provider request per turn.

To enable Ollama, set `AIDA_OLLAMA_ENDPOINT` to a trusted HTTP(S) server origin or its `/api/chat` URL and optionally set `AIDA_OLLAMA_MODEL` before starting the server. Select Ollama in the page and enter an installed model. A network endpoint receives the conversation context. Selection is stored as a browser preference and changing it preserves the current chat. Reloading clears the chat.

For online operation, the legacy Phone fragment flow kept the provider key out of static source, but assembled it in the browser. A protected hosted intermediary can keep that key server-side and work without the local machine. It would need caller authentication and usage limits. The loopback transport is for development. See [the intended memory lifecycle](memory-lifecycle.md) for durable context plans.

## Supervised live test

1. Confirm the intended Google account and parent location for **AIDA — ONE AIDA MANY ROOMS — DEV**. Verify the folder by ID in Drive. If it is absent, create it only after confirming the account and parent. Set its ID in `oauth.config.json`. Aida checks the folder name, type, and ID before use.
2. Approve publishing these static files to a separate GitHub Pages path on the previously documented origin, `https://aristgwetta.github.io`. One option is a new Pages project under the same account. Serve `index.html`, `style.css`, `app.mjs`, `memory.mjs`, and `oauth.config.json` together. Localhost uses a different origin.
3. Open that URL in a browser, choose **Authorize Google Drive**, select the intended account, enter a meaningful fact, and choose **Remember**. Check the JSON, Drive file ID, and timestamp.
4. Close the browser session. Reopen the URL, authorize the same account, and choose **Recall**. Repeat from a second device and compare the fact, file ID, and timestamp.

The committed client ID is a public OAuth identifier. The popup requests full Drive access and includes previously granted scopes. The folder is the initial memory destination. Access tokens live only in page memory. The app uses its own files and Google's browser and Drive APIs.

An upload retry in the same page reuses the Drive-generated file ID. A fresh session searches Drive for the existing record before writing. Run the first save on one device at a time. If multiple records are found, Aida reports the conflict.
