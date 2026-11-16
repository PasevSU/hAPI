import { sha256Stable } from '../core/utils.js';
export function finalizeDocumentProfile(profile){const p=structuredClone(profile);delete p.profile_sha256;p.profile_sha256=sha256Stable(p);return p;}
export function recordDocumentProfile(manifest,profile){const m=structuredClone(manifest);m.profiles.document.push(finalizeDocumentProfile(profile));return m;}
