import { sha256Bytes } from '../core/utils.js';
export function rawTextHash(text){return sha256Bytes(Buffer.from(String(text??''),'utf8'));}
export function recordRawTextHash(manifest,{selection_id,text}){const m=structuredClone(manifest);m.hashes.raw_text??={};m.hashes.raw_text[selection_id]={algorithm:'SHA-256',value:rawTextHash(text),byte_length:Buffer.byteLength(String(text??''),'utf8')};return m;}
