import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve,dirname,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const manifest=JSON.parse(await readFile(new URL('./publication.json',import.meta.url),'utf8'));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
test('12-file publication allowlist closes over every module, HTML asset and OAuth config dependency',async()=>{
  const selected=new Set(manifest.runtimeFiles);assert.equal(selected.size,12);
  for(const path of selected) {
    assert.ok(!path.includes('..')&&!path.includes('test.')&&!path.startsWith('theater/'));
    const source=await readFile(resolve(root,path),'utf8');
    const dependencies=[...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g),...source.matchAll(/(?:src|href)="([^"]+)"/g),...source.matchAll(/fetch\('([^']+\.json)'/g)].map(m=>m[1]);
    for(const dependency of dependencies) {
      if(/^https:\/\//.test(dependency)){assert.equal(dependency,'https://accounts.google.com/gsi/client');continue;}
      const resolved=relative(root,resolve(root,dirname(path),dependency)).replaceAll('\\','/');
      assert.ok(selected.has(resolved),`${path} missing dependency ${resolved}`);
    }
    // Compare Git blobs, respecting the checkout's CRLF filter. Publication
    // copies committed blobs, not platform-normalized working-tree bytes.
    if(!path.startsWith('acceptance/'))assert.equal(git('hash-object','--path='+path,path),git('rev-parse',manifest.memoryBridgeSource+':'+path));
  }
});
test('in-memory additive publication preserves every existing root/preview blob without changing any publishing ref',async()=>{
  const refs=git('for-each-ref','--format=%(refname) %(objectname)');
  const entries=git('ls-tree','-r',manifest.publishingBase).split('\n').map(line=>{const [info,path]=line.split('\t');return [path,info];});
  const original=new Map(entries),proposed=new Map(entries);
  assert.ok(!entries.some(([path])=>path.startsWith(manifest.proposedPrefix)));
  for(const path of manifest.runtimeFiles) {
    const hash=git('hash-object','--path='+path,path);
    proposed.set(manifest.proposedPrefix+path,'100644 blob '+hash);
  }
  for(const [path,blob] of original)assert.equal(proposed.get(path),blob,path);
  assert.equal(proposed.size-original.size,12);
  assert.equal(refs,git('for-each-ref','--format=%(refname) %(objectname)'));
});
