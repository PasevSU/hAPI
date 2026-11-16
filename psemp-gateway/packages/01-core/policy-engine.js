/* PasevSU PGP Toolbox v2.1.1 — Provider / Policy Engine */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let lastReport = null;

  const PROFILES = Object.freeze({
    'rfc9580-strict': { id:'rfc9580-strict', label:'RFC 9580 v6 Strict', purpose:'Modern v6-only OpenPGP operations.', requireV6:true, minRsaBits:3072, requireEncryption:true, requirePq:false, allowExpired:false, allowRevoked:false },
    'modern-compatible': { id:'modern-compatible', label:'Modern Compatible', purpose:'Strong v4/v6 interoperability without silent weak-key acceptance.', requireV6:false, minRsaBits:3072, requireEncryption:true, requirePq:false, allowExpired:false, allowRevoked:false },
    'legacy-interop': { id:'legacy-interop', label:'Legacy Interoperability', purpose:'Explicit compatibility profile for older OpenPGP certificates.', requireV6:false, minRsaBits:2048, requireEncryption:true, requirePq:false, allowExpired:false, allowRevoked:false },
    'forensic-readonly': { id:'forensic-readonly', label:'Forensic Read-Only', purpose:'Inspection/verification only. It does not authorize new encryption.', requireV6:false, minRsaBits:0, requireEncryption:false, requirePq:false, allowExpired:true, allowRevoked:true, readOnly:true },
    'rfc9980-pqt': { id:'rfc9980-pqt', label:'RFC 9980 PQ/T', purpose:'Post-quantum/traditional composite profile. Requires a verified runtime provider.', requireV6:true, minRsaBits:0, requireEncryption:true, requirePq:true, allowExpired:false, allowRevoked:false }
  });

  function hexId(key) { try { return key.getKeyID().toHex().toUpperCase(); } catch { return null; } }
  function iso(value) { return value instanceof Date ? value.toISOString() : (value === Infinity ? null : value || null); }
  function algoInfo(obj) { try { return obj.getAlgorithmInfo?.() || {}; } catch { return {}; } }
  function isRsa(info) { return /rsa/i.test(String(info?.algorithm || '')); }
  function looksPq(info) { return /(?:ml[-_ ]?kem|ml[-_ ]?dsa|slh[-_ ]?dsa|post[-_ ]?quantum)/i.test(`${info?.algorithm || ''} ${info?.curve || ''}`); }

  async function analyzeArmored(record, profile, now) {
    const config = window.PasevSUAdvanced?.config?.() || undefined;
    const key = await openpgp.readKey({ armoredKey:record.publicKey, config });
    const primary = algoInfo(key); const version=Number(key.keyPacket?.version || 0) || null;
    let expiration=null, encryptionKey=null, signingKey=null, primaryValid=true, primaryError=null;
    try { expiration=await key.getExpirationTime(undefined, config); } catch (e) { primaryValid=false; primaryError=e.message; }
    if (!profile.readOnly) {
      try { await key.verifyPrimaryKey(now, undefined, config); } catch (e) { primaryValid=false; primaryError=e.message; }
    }
    try { encryptionKey=await key.getEncryptionKey(undefined, now, undefined, config); } catch {}
    try { signingKey=await key.getSigningKey(undefined, now, undefined, config); } catch {}
    const encryptionInfo=encryptionKey ? algoInfo(encryptionKey) : null;
    const signingInfo=signingKey ? algoInfo(signingKey) : null;
    const reasons=[];
    if (profile.requireV6 && version !== 6) reasons.push(`Policy requires a v6 certificate; detected v${version || 'unknown'}.`);
    if (!profile.readOnly && !primaryValid) reasons.push(`Primary certificate validation failed${primaryError ? `: ${primaryError}` : '.'}`);
    if (!profile.allowExpired && expiration instanceof Date && expiration <= now) reasons.push(`Certificate expired at ${expiration.toISOString()}.`);
    if (!profile.allowRevoked && expiration === null) reasons.push('Certificate is revoked or otherwise invalid at the evaluation time.');
    if (profile.requireEncryption && !encryptionKey) reasons.push('No valid encryption key is available at the evaluation time.');
    for (const [role,info] of [['primary',primary],['encryption',encryptionInfo]]) if (info && isRsa(info) && profile.minRsaBits && Number(info.bits || 0) < profile.minRsaBits) reasons.push(`${role} RSA strength ${info.bits || 'unknown'} is below policy minimum ${profile.minRsaBits}.`);
    if (profile.requirePq && ![primary,encryptionInfo,signingInfo].some(looksPq)) reasons.push('Selected certificate does not expose an RFC 9980 PQ/T algorithm through the loaded runtime.');
    return { fingerprint:key.getFingerprint().toUpperCase(), keyID:hexId(key), version, email:record.email || null, label:record.userLabel || record.comment || null, primaryValid, primaryValidationError:primaryError, createdAt:iso(key.getCreationTime?.()), expiresAt:iso(expiration), primaryAlgorithm:primary, encryptionAlgorithm:encryptionInfo, signingAlgorithm:signingInfo, encryptionKeyID:encryptionKey ? hexId(encryptionKey) : null, signingKeyID:signingKey ? hexId(signingKey) : null, decision:reasons.length ? 'BLOCKED':'ACCEPT', reasons };
  }

  async function evaluateRecords(records, profileId, { source='policy-ui' } = {}) {
    if (!window.openpgp) throw new Error('OpenPGP.js runtime is not loaded.');
    const profile=PROFILES[profileId] || PROFILES['modern-compatible'];
    if (!profile.readOnly && !records.length) throw new Error('Select at least one recipient certificate.');
    let runtime=window.PasevSURuntimeCapabilities?.report || null;
    if (!runtime && window.PasevSURuntimeCapabilities?.refresh) runtime = await window.PasevSURuntimeCapabilities.refresh();
    const runtimeReasons=[];
    if (!runtime) runtimeReasons.push('Runtime capability report is unavailable; policy evaluation fails closed.');
    if (runtime && !runtime.server?.openpgp?.browserBundleHashPinned) runtimeReasons.push('OpenPGP.js runtime bundle SHA-256 pin is missing or does not match.');
    if (profile.requirePq && !runtime?.browser?.pqRuntimeExposed) runtimeReasons.push('RFC 9980 PQ/T browser runtime is not verified/exposed.');
    if (profile.requireV6 && !runtime?.browser?.rfc9580V6Config) runtimeReasons.push('Loaded OpenPGP.js runtime does not expose the expected v6 configuration capability.');
    const now=new Date(); const recipientAnalyses=[];
    for (const record of records) recipientAnalyses.push(await analyzeArmored(record,profile,now));
    const blocked=runtimeReasons.length>0 || recipientAnalyses.some(x=>x.decision==='BLOCKED');
    return { schema:'pasevsu-policy-report/2.1', generatedAt:now.toISOString(), source, profile:{...profile}, decision:blocked?'BLOCKED':(profile.readOnly?'READ_ONLY':'READY'), noSilentDowngrade:true, runtimeReasons, recipients:recipientAnalyses, negotiatedOperation:profile.readOnly?'inspection-verification-only':'OpenPGP.js recipient-preference negotiation', note:profile.readOnly?'This profile evaluates material but does not authorize new encryption.':'This report is an enforced eligibility gate when called from Encrypt Message; OpenPGP.js performs recipient preference negotiation only after READY.' };
  }

  async function authorizeEncryption(records, profileId='modern-compatible') {
    const report=await evaluateRecords(records,profileId,{source:'encrypt-operation'});
    lastReport=report;
    window.dispatchEvent(new CustomEvent('pasevsu-policy-report',{detail:report}));
    return report;
  }

  async function evaluate() {
    const output=$('policyOutput'), status=$('policyStatus'), button=$('policyEvaluateButton'); if(button)button.disabled=true;
    try {
      const profile=PROFILES[$('policyProfile')?.value] || PROFILES['modern-compatible'];
      const records=window.PasevSUApp?.getPublicKeyRecords?.() || [];
      const selected=Array.from($('policyRecipients')?.selectedOptions || []).map(o=>records[Number(o.value)]).filter(Boolean);
      lastReport=await evaluateRecords(selected,profile.id,{source:'policy-ui'});
      if(output)output.value=JSON.stringify(lastReport,null,2);
      if(status)status.textContent=`Policy ${profile.label}: ${lastReport.decision}${lastReport.runtimeReasons.length ? ` · ${lastReport.runtimeReasons.join(' ')}`:''}`;
      window.dispatchEvent(new CustomEvent('pasevsu-policy-report',{detail:lastReport}));
    } catch(error) { if(status)status.textContent=`Policy evaluation failed: ${error.message}`; if(output)output.value=''; }
    finally { if(button)button.disabled=false; }
  }

  function refreshRecipients() {
    const select=$('policyRecipients'); if(!select)return;
    const previous=new Set(Array.from(select.selectedOptions || []).map(o=>o.value)); const records=window.PasevSUApp?.getPublicKeyRecords?.() || [];
    select.textContent=''; records.forEach((record,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`${record.email || record.userLabel || 'PGP key'} · ${record.fingerprint || ''}`;if(previous.has(option.value))option.selected=true;select.append(option);});
  }
  function download(){if(!lastReport)return;const blob=new Blob([JSON.stringify(lastReport,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`pasevsu-policy-${lastReport.profile.id}-${lastReport.generatedAt.replace(/[:.]/g,'-')}.json`;a.click();URL.revokeObjectURL(url);}
  function init(){refreshRecipients();$('policyEvaluateButton')?.addEventListener('click',evaluate);$('policyDownloadButton')?.addEventListener('click',download);window.addEventListener('pasevsu-keys-changed',refreshRecipients);}
  document.addEventListener('DOMContentLoaded',init,{once:true});
  window.PasevSUPolicy={profiles:PROFILES,evaluate,evaluateRecords,authorizeEncryption,refreshRecipients,get report(){return lastReport;}};
})();
