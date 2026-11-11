import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "./dev-server.mjs";

test("homepage accepts tracking parameters and chat still requires the local origin", async () => {
  async function request(url, method = "GET", headers = {}) {
    const result = {};
    await handleRequest({ url, method, headers: { host: "127.0.0.1:8787", ...headers } }, {
      writeHead(status, headers) { Object.assign(result, { status, headers }); },
      end(body) { result.body = body; }
    });
    return result;
  }

  const home = await request("/");
  assert.equal(home.status, 200);
  assert.match(home.headers["Content-Type"], /^text\/html/);
  assert.deepEqual(await request("/?utm_source=chatgpt.com"), home);
  assert.equal((await request("/?utm_source=chatgpt.com", "GET", { host: "other.example" })).status, 403);
  assert.equal((await request("/dev-chat?utm_source=chatgpt.com", "POST", {
    origin: "https://other.example", "content-type": "application/json"
  })).status, 403);
});
