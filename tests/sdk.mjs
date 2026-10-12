import assert from 'node:assert/strict';
import {PortalClient} from '../sdk/client.mjs';
const calls=[];
const client=new PortalClient({baseUrl:'https://example.test/',slug:'sample',apiKey:'test-secret',fetchImpl:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({ok:true}),arrayBuffer:async()=>new ArrayBuffer(3)}}});
await client.info();await client.files({q:'report & draft',limit:10});await client.file('a/b');await client.manifest();await client.openapi();await client.download('abc');
assert.equal(calls.length,6);assert.equal(calls[0].opts.headers.Authorization,'Bearer test-secret');assert.match(calls[1].url,/q=report\+%26\+draft/);assert.match(calls[2].url,/a%2Fb/);assert.match(calls[5].url,/download$/);
const anon=new PortalClient({baseUrl:'http://localhost:8099',slug:'public',fetchImpl:async(url,opts)=>{assert.deepEqual(opts.headers,{});return {ok:true,json:async()=>({})}}});await anon.info();
assert.throws(()=>new PortalClient({baseUrl:'file:///tmp',slug:'x'}),TypeError);
console.log('PASS SDK: auth, anonymous, URL encoding, manifest, OpenAPI, download');
