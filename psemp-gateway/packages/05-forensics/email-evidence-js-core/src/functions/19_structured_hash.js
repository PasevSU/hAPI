import { sha256Stable, stableSortObject } from '../core/utils.js';
export function structuredHash(data){const canonical=stableSortObject(data);return {canonical,sha256:sha256Stable(canonical)};}
export function recordStructuredHash(manifest,{scope_id,data}){const m=structuredClone(manifest);const r=structuredHash(data);m.hashes.structured??={};m.hashes.structured[scope_id]={algorithm:'SHA-256',value:r.sha256,canonical:r.canonical};return m;}
