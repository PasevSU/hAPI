'use strict';
const assert=require('node:assert/strict');
const {retrieve,tokens}=require('../tools/stability-guardian/knowledge.cjs');
const keyWords=tokens('PGP key mismatch Ed25519 NO_ENCRYPTION_KEY');
assert.ok(keyWords.has('ed25519'));
const result=retrieve({source:'pgp-keyring.js',code:'NO_ENCRYPTION_KEY',
  message:'PGP encrypted paths were enabled but key is Ed25519 only; storageKeyId missing'});
assert.ok(result.matchedDefects.some(x=>x.id==='DEF-46'),
  'AI diagnosis should retrieve historical key-capability regression DEF-46');
assert.ok(result.matchedDefects.every(x=>/historical/i.test(x.warning)));
assert.ok(result.matchedWatches.some(x=>x.domain==='security'));
assert.equal(result.matchedReleases.length<=5,true);
assert.deepEqual(retrieve({},{}).matchedDefects,[],'no query does not fabricate historical matches');
console.log('guardian historical retrieval: OK');
