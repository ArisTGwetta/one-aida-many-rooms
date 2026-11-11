import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createProviders, maxEnvelopeBytes, openAIModel, ProviderError } from "./providers.mjs";

const host = "127.0.0.1";
const port = 8787;
const authority = `${host}:${port}`;
const origin = `http://${authority}`;
const routes = new Map([
  ["/", ["index.html", "text/html"]],
  ["/style.css", ["style.css", "text/css"]],
  ...["app.mjs", "memory.mjs", "conversation.mjs", "recent-journal.mjs", "sleep.mjs", "sleep-contract.mjs", "sleep-panel.mjs", "awake-context.mjs"]
    .map(name => [`/${name}`, [name, "text/javascript"]])
]);
const provider = createProviders({
  apiKey: process.env.OPENAI_API_KEY,
  ollamaEndpoint: process.env.AIDA_OLLAMA_ENDPOINT
});
const config = JSON.parse(await readFile(new URL("./oauth.config.json", import.meta.url), "utf8"));
// The development origin still requires an existing Google client registration.
config.google.javascriptOrigin = origin;
let busy = false;

function send(response, status, body, type = "application/json") {
  response.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"
  });
  response.end(type === "application/json" ? JSON.stringify(body) : body);
}

export async function handleRequest(request, response) {
  if (request.headers.host !== authority) return send(response, 403, { error: "Use the loopback URL." });
  let path;
  try {
    path = new URL(request.url, origin).pathname;
  } catch {
    return send(response, 400, { error: "Invalid request URL." });
  }
  if (request.method === "GET") {
    if (path === "/oauth.config.json") return send(response, 200, config);
    if (path === "/dev-config") return send(response, 200, {
      openAIModel,
      ollamaConfigured: Boolean(process.env.AIDA_OLLAMA_ENDPOINT),
      ollamaModel: process.env.AIDA_OLLAMA_MODEL ?? ""
    });
    const asset = routes.get(path);
    if (asset) {
      try {
        return send(response, 200, await readFile(new URL(asset[0], import.meta.url), "utf8"), asset[1]);
      } catch {
        return send(response, 500, { error: "Could not load the application asset." });
      }
    }
  }
  if (request.method !== "POST" || path !== "/dev-chat") return send(response, 404, { error: "Unknown route." });
  if (request.headers.origin !== origin || request.headers["content-type"] !== "application/json") {
    return send(response, 403, { error: "Use the local Aida page to send a conversation turn." });
  }
  if (busy) return send(response, 429, { error: "A conversation turn is already in progress." });
  busy = true;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxEnvelopeBytes + 1024) {
        send(response, 413, { error: "The conversation request is too large." });
        return;
      }
      chunks.push(chunk);
    }
    let input;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(response, 400, { error: "Invalid conversation request JSON." });
    }
    if (!input || typeof input !== "object") return send(response, 400, { error: "Invalid conversation request." });
    send(response, 200, await provider(input));
  } catch (error) {
    send(response, 502, { error: error instanceof ProviderError
      ? error.message : "The provider reply did not match the requested contract." });
  } finally {
    busy = false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer({ requestTimeout: 15000 }, handleRequest);
  server.listen(port, host, () => console.log(`Aida development server: ${origin}/`));
}
