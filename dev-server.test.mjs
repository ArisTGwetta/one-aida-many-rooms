import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "./dev-server.mjs";

test('canonical local server serves the complete owned UI module graph without exposing source-control or credential files', async()=>{
  async function get(url) {
    const result={};await handleRequest({url,method:'GET',headers:{host:'127.0.0.1:8787'}},{
      writeHead(status,headers){Object.assign(result,{status,headers});},end(body){result.body=body;}
    });return result;
  }
  const pending=['/'],seen=new Set();
  while(pending.length) {
    const path=pending.shift();if(seen.has(path))continue;seen.add(path);
    const response=await get(path);assert.equal(response.status,200,path);
    const source=String(response.body),links=path==='/'?[...source.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)]:[...source.matchAll(/(?:from\s*|import\s*\(\s*)["'](\.[^"']+\.mjs)["']/g)];
    for(const match of links)pending.push(new URL(match[1],'http://127.0.0.1:8787'+path).pathname);
  }
  for(const asset of ['/memory-bridge.mjs','/browser-credentials.mjs','/providers.mjs','/theater/turns.mjs','/theater/theater.css'])assert.ok(seen.has(asset),asset);
  assert.ok(seen.size>30);
  for(const path of ['/.git/config','/.env','/credentials.local.json','/../AGENTS.md','/theater/turns.test.mjs'])assert.equal((await get(path)).status,404,path);
});

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
  const portrait = await request("/portraits/neutral1.png");
  assert.equal(portrait.status, 200);
  assert.equal(portrait.headers["Content-Type"], "image/png");
  assert.equal(portrait.body.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(home.status, 200);
  assert.match(home.headers["Content-Type"], /^text\/html/);
  assert.deepEqual(await request("/?utm_source=chatgpt.com"), home);
  assert.equal((await request("/?utm_source=chatgpt.com", "GET", { host: "other.example" })).status, 403);
  assert.equal((await request("/dev-chat?utm_source=chatgpt.com", "POST", {
    origin: "https://other.example", "content-type": "application/json"
  })).status, 403);
});
