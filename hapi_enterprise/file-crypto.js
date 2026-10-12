'use strict';
const crypto=require('node:crypto');
// Opt-in whole-file encryption at rest (AES-256-GCM). The logical file SHA-256 and
// size remain those of the plaintext; only the bytes written to disk are encrypted.
// On-disk layout: [magic 'hapiE1' (6)] [iv (12)] [authTag (16)] [ciphertext ...].
const MAGIC=Buffer.from('hapiE1','ascii');
function deriveKey(secret){if(!secret)return null;return crypto.createHash('sha256').update('hapi-file:'+secret).digest()}
function encrypt(data,secret){
 const key=deriveKey(secret);if(!key)throw Object.assign(new Error('Encryption secret unavailable'),{status:500});
 const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);
 const ct=Buffer.concat([c.update(data),c.final()]);const tag=c.getAuthTag();
 return Buffer.concat([MAGIC,iv,tag,ct]);
}
function decrypt(buf,secret){
 const key=deriveKey(secret);if(!key)throw Object.assign(new Error('Encryption secret unavailable'),{status:500});
 if(!Buffer.isBuffer(buf)||buf.length<34||!buf.subarray(0,6).equals(MAGIC))throw Object.assign(new Error('Not an encrypted file'),{status:500});
 const iv=buf.subarray(6,18),tag=buf.subarray(18,34),ct=buf.subarray(34);
 const d=crypto.createDecipheriv('aes-256-gcm',key,iv);d.setAuthTag(tag);
 return Buffer.concat([d.update(ct),d.final()]);
}
function isEncrypted(buf){return Buffer.isBuffer(buf)&&buf.length>=34&&buf.subarray(0,6).equals(MAGIC)}
module.exports={encrypt,decrypt,isEncrypted};
