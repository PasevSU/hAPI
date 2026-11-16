/* =====================================================================
 * PasevSU PGP Toolbox v2.1.1 — Advanced OpenPGP Core
 * Identity lifecycle, deep validation, strict policy and session inspector.
 * Uses documented OpenPGP.js v6 public APIs where available.
 * ===================================================================== */
(() => {
  'use strict';

  const enc = new TextEncoder();
  let lastArmorBinary = null;
  let lastArmorType = null;

  function el(id) { return document.getElementById(id); }
  function value(id) { return el(id)?.value ?? ''; }
  function checked(id) { return Boolean(el(id)?.checked); }
  function isoDateOrNow(id) {
    const raw = value(id);
    if (!raw) return new Date();
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new Error('Invalid date/time.');
    return d;
  }
  function hex(bytes) { return Array.from(bytes || [], b => b.toString(16).padStart(2, '0')).join('').toUpperCase(); }

  function strictConfig() {
    const minRSA = Number(value('advMinRsaBits') || 3072);
    const maxMB = Number(value('advMaxDecompressedMB') || 512);
    const rejectHashes = new Set(openpgp.config.rejectHashAlgorithms || []);
    const rejectMessageHashes = new Set(openpgp.config.rejectMessageHashAlgorithms || []);
    if (checked('advRejectSha1')) {
      rejectHashes.add(openpgp.enums.hash.sha1);
      rejectMessageHashes.add(openpgp.enums.hash.sha1);
    }
    rejectHashes.add(openpgp.enums.hash.md5);
    rejectMessageHashes.add(openpgp.enums.hash.md5);
    return {
      minRSABits: minRSA,
      enforceGrammar: checked('advEnforceGrammar'),
      allowUnauthenticatedMessages: false,
      allowUnauthenticatedStream: false,
      allowInsecureDecryptionWithSigningKeys: false,
      constantTimePKCS1Decryption: checked('advConstantTimeRSA'),
      maxDecompressedMessageSize: Math.max(1, maxMB) * 1024 * 1024,
      rejectHashAlgorithms: rejectHashes,
      rejectMessageHashAlgorithms: rejectMessageHashes,
      s2kType: openpgp.enums.s2k.argon2,
      s2kArgon2Params: { passes:3, parallelism:4, memoryExponent:17 },
      maxArgon2MemoryExponent: 18
    };
  }

  function activeConfig(strictRequested) {
    return strictRequested ? strictConfig() : undefined;
  }

  async function unlockPrivateRecord(index, passphrase) {
    const stored = keys[Number(index)];
    if (!stored?.privateKey) throw new Error('Selected key has no private material.');
    const parsed = await openpgp.readPrivateKey({ armoredKey: stored.privateKey });
    const wasEncrypted = !parsed.isDecrypted();
    if (!wasEncrypted) {
      if (!passphrase || passphrase.length < 16) throw new Error('This private key is currently unprotected. Enter a new passphrase of at least 16 characters; lifecycle changes will re-protect it before storage.');
      return { key: parsed, wasEncrypted: false };
    }
    if (!passphrase) throw new Error('Passphrase required.');
    const key = await openpgp.decryptKey({ privateKey: parsed, passphrase });
    return { key, wasEncrypted: true };
  }

  async function persistPrivateRecord(index, unlockedKey, passphrase, wasEncrypted, eventName, eventData = {}) {
    let storedKey = unlockedKey;
    if (wasEncrypted || passphrase) {
      if (!passphrase || passphrase.length < 16) throw new Error('A passphrase of at least 16 characters is required to protect the modified private key.');
      storedKey = await openpgp.encryptKey({ privateKey: unlockedKey, passphrase, config: strictConfig() });
    }
    const armored = storedKey.armor();
    // Round-trip parse before touching IndexedDB. This catches serialization damage.
    const roundTrip = await openpgp.readPrivateKey({ armoredKey: armored });
    const publicArmored = roundTrip.toPublic().armor();
    const i = Number(index);
    // Preserve a local rollback point before any persistent lifecycle mutation.
    if (typeof dbCreateSnapshot === 'function') {
      await dbCreateSnapshot(`lifecycle-before-${eventName}`);
      if (typeof dbPruneSnapshots === 'function') await dbPruneSnapshots(20);
    }
    keys[i].privateKey = armored;
    keys[i].publicKey = publicArmored;
    keys[i].fingerprint = roundTrip.getFingerprint().toUpperCase();
    keys[i].meta = keys[i].meta || {};
    keys[i].meta.lifecycle = keys[i].meta.lifecycle || [];
    keys[i].meta.lifecycle.push({ event: eventName, at: new Date().toISOString(), ...eventData });
    await saveKeysToLocalStorage();
    refreshKeyList();
    await refreshLifecycleTargets();
  }

  function reasonObject(kind, text) {
    const map = openpgp.enums.reasonForRevocation;
    const flag = map[kind] ?? map.noReason;
    return { flag, string: String(text || '').trim() };
  }

  async function deepValidateKey() {
    const idx = value('advValidationKey');
    if (idx === '') { toast('Select a key.', 'error'); return; }
    const stored = keys[Number(idx)];
    const date = isoDateOrNow('advValidationDate');
    const strict = checked('advValidationStrict');
    const config = activeConfig(strict);
    const report = {
      schema: 'PASEVSU-OPENPGP-HEALTH-1',
      generatedAt: new Date().toISOString(),
      validationDate: date.toISOString(),
      strictPolicy: strict,
      fingerprint: stored.fingerprint || null,
      primary: { valid: false }, users: [], subkeys: [], privateMaterial: null,
      overall: 'FAIL'
    };
    try {
      const parsed = stored.privateKey
        ? await openpgp.readPrivateKey({ armoredKey: stored.privateKey })
        : await openpgp.readKey({ armoredKey: stored.publicKey });
      const pub = parsed.isPrivate?.() ? parsed.toPublic() : parsed;
      report.fingerprint = pub.getFingerprint().toUpperCase();
      report.keyID = pub.getKeyID().toHex().toUpperCase();
      report.algorithm = pub.getAlgorithmInfo?.() || {};
      report.userIDs = pub.getUserIDs();

      try {
        await pub.verifyPrimaryKey(date, undefined, config);
        report.primary = { valid: true, status: 'PASS' };
      } catch (e) {
        report.primary = { valid: false, status: 'FAIL', error: e.message };
      }

      try {
        const users = await pub.verifyAllUsers(undefined, date, config);
        report.users = users.map(x => ({
          userID: x.userID || null,
          signerKeyID: x.keyID?.toHex?.().toUpperCase?.() || null,
          valid: x.valid,
          status: x.valid === true ? 'PASS' : x.valid === false ? 'FAIL' : 'UNKNOWN'
        }));
      } catch (e) {
        report.users = [{ status: 'FAIL', error: e.message }];
      }

      for (const sub of pub.getSubkeys()) {
        const item = {
          keyID: sub.getKeyID().toHex().toUpperCase(),
          fingerprint: sub.getFingerprint?.()?.toUpperCase?.() || null,
          algorithm: sub.getAlgorithmInfo?.() || {},
          signing: false, encryption: false, valid: false
        };
        try { await pub.getSigningKey(sub.getKeyID(), date, undefined, config); item.signing = true; } catch {}
        try { await pub.getEncryptionKey(sub.getKeyID(), date, undefined, config); item.encryption = true; } catch {}
        try { await sub.verify(date, config); item.valid = true; item.status = 'PASS'; }
        catch (e) { item.status = 'FAIL'; item.error = e.message; }
        report.subkeys.push(item);
      }

      if (stored.privateKey && checked('advValidatePrivate')) {
        try {
          const { key } = await unlockPrivateRecord(idx, value('advValidationPassphrase'));
          await key.validate(config);
          report.privateMaterial = { status: 'PASS', publicPrivateParameters: 'MATCH' };
        } catch (e) {
          report.privateMaterial = { status: 'FAIL', error: e.message };
        }
      }

      const usersOK = report.users.every(x => x.valid !== false && x.status !== 'FAIL');
      const subkeysOK = report.subkeys.every(x => x.valid);
      const privateOK = !report.privateMaterial || report.privateMaterial.status === 'PASS';
      report.overall = report.primary.valid && usersOK && subkeysOK && privateOK ? 'PASS' : 'FAIL';
      el('advValidationOutput').value = JSON.stringify(report, null, 2);
      toast(`Deep key validation: ${report.overall}.`, report.overall === 'PASS' ? 'neutral' : 'error');
    } catch (e) {
      report.fatal = e.message;
      el('advValidationOutput').value = JSON.stringify(report, null, 2);
      toast(`Validation failed: ${e.message}`, 'error');
    }
  }

  function lifecycleSubkeyOptions() {
    const choice = value('advNewSubkeyProfile');
    const expirationRaw = value('advNewSubkeyExpiration');
    let keyExpirationTime = 0;
    if (expirationRaw) {
      const exp = new Date(expirationRaw + 'T23:59:59');
      const delta = Math.floor((exp.getTime() - Date.now()) / 1000);
      if (delta <= 0) throw new Error('Subkey expiration must be in the future.');
      keyExpirationTime = delta;
    }
    const common = { keyExpirationTime };
    const profiles = {
      'brainpool-sign': { type:'ecc', curve:'brainpoolP512r1', sign:true },
      'brainpool-encrypt': { type:'ecc', curve:'brainpoolP512r1', sign:false },
      'p521-sign': { type:'ecc', curve:'nistP521', sign:true },
      'p521-encrypt': { type:'ecc', curve:'nistP521', sign:false },
      'rsa8192-sign': { type:'rsa', rsaBits:8192, sign:true },
      'rsa8192-encrypt': { type:'rsa', rsaBits:8192, sign:false },
      'rsa4096-sign': { type:'rsa', rsaBits:4096, sign:true },
      'rsa4096-encrypt': { type:'rsa', rsaBits:4096, sign:false },
      'curve25519-encrypt': { type:'curve25519', sign:false }
    };
    if (!profiles[choice]) throw new Error('Unknown subkey profile.');
    return { ...profiles[choice], ...common };
  }

  async function addLifecycleSubkey() {
    const idx = value('advLifecycleKey');
    if (idx === '') { toast('Select a private key.', 'error'); return; }
    try {
      const passphrase = value('advLifecyclePassphrase');
      const { key, wasEncrypted } = await unlockPrivateRecord(idx, passphrase);
      const options = lifecycleSubkeyOptions();
      const updated = await key.addSubkey(options);
      await updated.validate();
      const newSub = updated.getSubkeys().at(-1);
      await persistPrivateRecord(idx, updated, passphrase, wasEncrypted, 'add-subkey', {
        profile: value('advNewSubkeyProfile'),
        keyID: newSub?.getKeyID?.().toHex?.().toUpperCase?.() || null
      });
      toast('New subkey added to the existing OpenPGP identity.');
    } catch (e) { toast(`Subkey generation failed: ${e.message}`, 'error'); }
  }

  async function refreshLifecycleTargets() {
    const idx = value('advLifecycleKey');
    const subSel = el('advLifecycleSubkey');
    const uidSel = el('advLifecycleUID');
    if (!subSel || !uidSel) return;
    subSel.innerHTML = '<option value="">— Select subkey —</option>';
    uidSel.innerHTML = '<option value="">— Select User ID —</option>';
    if (idx === '' || !keys[Number(idx)]?.publicKey) return;
    try {
      const pub = await openpgp.readKey({ armoredKey: keys[Number(idx)].publicKey });
      pub.getSubkeys().forEach((sub, i) => {
        const info = sub.getAlgorithmInfo?.() || {};
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `${sub.getKeyID().toHex().toUpperCase()} · ${info.algorithm || 'OpenPGP'}${info.bits ? '-' + info.bits : ''}${info.curve ? ' · ' + info.curve : ''}`;
        subSel.appendChild(o);
      });
      (pub.users || []).forEach((user, i) => {
        if (!user?.userID) return;
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = user.userID.userID || user.userID.email || `User ${i + 1}`;
        uidSel.appendChild(o);
      });
    } catch (e) { console.warn('Lifecycle target refresh failed', e); }
  }

  async function revokeLifecycleSubkey() {
    const idx = value('advLifecycleKey');
    const subIndex = value('advLifecycleSubkey');
    if (idx === '' || subIndex === '') { toast('Select a private key and subkey.', 'error'); return; }
    if (!confirm(uiText('Revoke this subkey? The primary identity and other subkeys will remain usable.'))) return;
    try {
      const passphrase = value('advLifecyclePassphrase');
      const { key, wasEncrypted } = await unlockPrivateRecord(idx, passphrase);
      const i = Number(subIndex);
      const sub = key.subkeys?.[i];
      if (!sub) throw new Error('Subkey not found.');
      const reason = reasonObject(value('advRevocationReason'), value('advRevocationText'));
      const revoked = await sub.revoke(key.keyPacket, reason, new Date(), strictConfig());
      key.subkeys[i] = revoked;
      await persistPrivateRecord(idx, key, passphrase, wasEncrypted, 'revoke-subkey', {
        keyID: revoked.getKeyID().toHex().toUpperCase(), reason: value('advRevocationReason'), text: value('advRevocationText')
      });
      toast('Subkey revoked; the primary identity remains intact.');
    } catch (e) { toast(`Subkey revocation failed: ${e.message}`, 'error'); }
  }

  async function revokeLifecycleUID() {
    const idx = value('advLifecycleKey');
    const userIndex = value('advLifecycleUID');
    if (idx === '' || userIndex === '') { toast('Select a private key and User ID.', 'error'); return; }
    if (!confirm(uiText('Revoke this User ID? Other identities on the key remain available.'))) return;
    try {
      const passphrase = value('advLifecyclePassphrase');
      const { key, wasEncrypted } = await unlockPrivateRecord(idx, passphrase);
      const i = Number(userIndex);
      const user = key.users?.[i];
      if (!user?.userID) throw new Error('User ID not found.');
      const label = user.userID.userID || user.userID.email || `User ${i + 1}`;
      const reason = reasonObject('userIDInvalid', value('advRevocationText'));
      const revoked = await user.revoke(key.keyPacket, reason, new Date(), strictConfig());
      key.users[i] = revoked;
      await persistPrivateRecord(idx, key, passphrase, wasEncrypted, 'revoke-user-id', { userID: label, text: value('advRevocationText') });
      toast('User ID revoked; the primary fingerprint is unchanged.');
    } catch (e) { toast(`User ID revocation failed: ${e.message}`, 'error'); }
  }

  async function revokeLifecycleKey() {
    const idx = value('advLifecycleKey');
    if (idx === '') { toast('Select a private key.', 'error'); return; }
    if (!confirm(uiText('Permanently revoke the complete OpenPGP identity? This is not reversible.'))) return;
    try {
      const passphrase = value('advLifecyclePassphrase');
      const { key, wasEncrypted } = await unlockPrivateRecord(idx, passphrase);
      const reason = reasonObject(value('advRevocationReason'), value('advRevocationText'));
      const revoked = await key.revoke(reason, new Date(), strictConfig());
      await persistPrivateRecord(idx, revoked, passphrase, wasEncrypted, 'revoke-primary-key', {
        reason: value('advRevocationReason'), text: value('advRevocationText')
      });
      keys[Number(idx)].revoked = true;
      keys[Number(idx)].revokedAt = new Date().toISOString();
      await saveKeysToLocalStorage();
      refreshKeyList();
      toast('Complete OpenPGP identity revoked.', 'error');
    } catch (e) { toast(`Key revocation failed: ${e.message}`, 'error'); }
  }

  async function inspectSessionKeys() {
    const armored = value('advSessionMessage').trim();
    const idx = value('advSessionPrivateKey');
    if (!armored) { toast('Paste an encrypted OpenPGP message.', 'error'); return; }
    if (idx === '') { toast('Select a private key.', 'error'); return; }
    try {
      const message = await openpgp.readMessage({ armoredMessage: armored, config: activeConfig(checked('advSessionStrict')) });
      const recipientIDs = message.getEncryptionKeyIDs().map(k => k.toHex().toUpperCase());
      const signerIDs = message.getSigningKeyIDs().map(k => k.toHex().toUpperCase());
      const { key } = await unlockPrivateRecord(idx, value('advSessionPassphrase'));
      const date = isoDateOrNow('advSessionDate');
      const sessionKeys = await openpgp.decryptSessionKeys({
        message, decryptionKeys: key, date, config: activeConfig(checked('advSessionStrict'))
      });
      const reveal = checked('advRevealSessionKey');
      const report = {
        schema: 'PASEVSU-SESSION-INSPECTOR-1',
        inspectedAt: new Date().toISOString(),
        verificationDate: date.toISOString(),
        recipientKeyIDs: recipientIDs,
        signingKeyIDs: signerIDs,
        filename: message.getFilename?.() || null,
        sessionKeys: sessionKeys.map((sk, i) => ({
          index: i + 1,
          algorithm: sk.algorithm,
          bytes: sk.data.length,
          keyMaterial: reveal ? hex(sk.data) : '[hidden — enable expert reveal to display]'
        }))
      };
      el('advSessionOutput').value = JSON.stringify(report, null, 2);
      toast(`Session key inspection completed: ${sessionKeys.length} usable key(s).`);
    } catch (e) { toast(`Session-key inspection failed: ${e.message}`, 'error'); }
  }

  async function collectBinary(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data?.getReader) {
      const reader = data.getReader(); const chunks = []; let total = 0;
      while (true) { const {value, done} = await reader.read(); if (done) break; const b = value instanceof Uint8Array ? value : new Uint8Array(value); chunks.push(b); total += b.length; }
      const out = new Uint8Array(total); let off = 0; for (const b of chunks) { out.set(b, off); off += b.length; } return out;
    }
    throw new Error('Unsupported dearmored binary representation.');
  }

  async function digestHex(name, bytes) {
    return hex(new Uint8Array(await crypto.subtle.digest(name, bytes)));
  }

  async function inspectArmor() {
    const input = value('advArmorInput').trim();
    if (!input) { toast('Paste an ASCII-armored OpenPGP block.', 'error'); return; }
    try {
      const parsed = await openpgp.unarmor(input);
      const bytes = await collectBinary(parsed.data);
      lastArmorBinary = bytes; lastArmorType = parsed.type;
      const armorName = Object.entries(openpgp.enums.armor).find(([,v]) => v === parsed.type)?.[0] || String(parsed.type);
      const report = {
        schema: 'PASEVSU-ARMOR-INSPECTOR-1',
        inspectedAt: new Date().toISOString(),
        armorType: armorName,
        armorParseAndChecksum: 'PASS',
        binaryBytes: bytes.length,
        sha256: await digestHex('SHA-256', bytes),
        sha512: await digestHex('SHA-512', bytes)
      };
      if (parsed.type === openpgp.enums.armor.message) {
        try {
          const msg = await openpgp.readMessage({ binaryMessage: bytes });
          report.recipientKeyIDs = msg.getEncryptionKeyIDs().map(k => k.toHex().toUpperCase());
          report.signingKeyIDs = msg.getSigningKeyIDs().map(k => k.toHex().toUpperCase());
          report.filename = msg.getFilename?.() || null;
        } catch (e) { report.messageParse = { status:'FAIL', error:e.message }; }
      }
      el('advArmorOutput').value = JSON.stringify(report, null, 2);
      el('advArmorDownloadButton').disabled = false;
      toast('ASCII armor parsed and binary packet block inspected.');
    } catch (e) {
      lastArmorBinary = null; lastArmorType = null; el('advArmorDownloadButton').disabled = true;
      el('advArmorOutput').value = JSON.stringify({ schema:'PASEVSU-ARMOR-INSPECTOR-1', status:'FAIL', error:e.message }, null, 2);
      toast(`Armor inspection failed: ${e.message}`, 'error');
    }
  }

  function downloadArmorBinary() {
    if (!lastArmorBinary) { toast('Inspect an armored block first.', 'error'); return; }
    const blob = new Blob([lastArmorBinary], {type:'application/pgp'}); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `pasevsu-openpgp-${String(lastArmorType ?? 'packet')}.pgp`; a.click(); URL.revokeObjectURL(url);
  }

  function downloadAdvancedReport() {
    const parse = id => { const raw=value(id).trim(); if(!raw) return null; try{return JSON.parse(raw);}catch{return {parseError:true,raw};} };
    const report = {
      schema:'pasevsu-advanced-report/2.1', generatedAt:new Date().toISOString(),
      keyHealth:parse('advValidationOutput'), sessionInspector:parse('advSessionOutput'), armorInspector:parse('advArmorOutput')
    };
    if (!report.keyHealth && !report.sessionInspector && !report.armorInspector) { toast('No advanced report available.', 'error'); return; }
    const blob = new Blob([JSON.stringify(report,null,2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pasevsu-openpgp-advanced-${report.generatedAt.replace(/[:.]/g,'-')}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  function updateSigningOptions() {
    const on = checked('encryptSignEnabled');
    el('encryptSigningPanel')?.classList.toggle('hidden', !on);
    el('encryptNotationPanel')?.classList.toggle('hidden', !on);
  }

  function bind() {
    el('encryptSignEnabled')?.addEventListener('change', updateSigningOptions);
    updateSigningOptions();
    el('advValidateButton')?.addEventListener('click', deepValidateKey);
    el('advLifecycleKey')?.addEventListener('change', refreshLifecycleTargets);
    el('advAddSubkeyButton')?.addEventListener('click', addLifecycleSubkey);
    el('advRevokeSubkeyButton')?.addEventListener('click', revokeLifecycleSubkey);
    el('advRevokeUIDButton')?.addEventListener('click', revokeLifecycleUID);
    el('advRevokeKeyButton')?.addEventListener('click', revokeLifecycleKey);
    el('advInspectSessionButton')?.addEventListener('click', inspectSessionKeys);
    el('advArmorInspectButton')?.addEventListener('click', inspectArmor);
    el('advArmorDownloadButton')?.addEventListener('click', downloadArmorBinary);
    el('advDownloadReportButton')?.addEventListener('click', downloadAdvancedReport);
    window.addEventListener('pasevsu-language-changed', refreshLifecycleTargets);
  }

  window.PasevSUAdvanced = {
    config: strictConfig,
    activeConfig,
    deepValidateKey,
    inspectSessionKeys,
    inspectArmor,
    refreshLifecycleTargets
  };

  document.addEventListener('DOMContentLoaded', bind);
})();
