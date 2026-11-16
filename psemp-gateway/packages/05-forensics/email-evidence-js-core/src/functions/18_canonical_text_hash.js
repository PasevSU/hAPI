import { normalizeTextConservative, sha256Bytes } from '../core/utils.js';
export function canonicalTextHash(text){const canonical=normalizeTextConservative(text);return {canonical,sha256:sha256Bytes(Buffer.from(canonical,'utf8'))};}
export function recordCanonicalTextHash(manifest,{selection_id,text}){const m=structuredClone(manifest);const r=canonicalTextHash(text);m.hashes.canonical_text??={};m.hashes.canonical_text[selection_id]={algorithm:'SHA-256',value:r.sha256,normalization:'UTF-8 + Unicode NFC + CRLF->LF + terminal form-feed removal'};return m;}
