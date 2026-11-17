import { sha256Stable } from '../core/utils.js';
export function finalizeIdentityProfile(profile){const p=structuredClone(profile);delete p.profile_sha256;p.profile_sha256=sha256Stable(p);return p;}
export function recordIdentityProfile(manifest,profile){const m=structuredClone(manifest);m.profiles.identity.push(finalizeIdentityProfile(profile));return m;}
