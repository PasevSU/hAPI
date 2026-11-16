/* =====================================================================
 * PasevSU PGP Toolbox v2.1 — Runtime / _crypto capability detector
 * Reports what is actually present. It never enables a crypto feature
 * merely because source files exist; runtime exposure and tests are separate.
 * ===================================================================== */
(() => {
  'use strict';

  let lastReport = null;
  const $ = id => document.getElementById(id);
  const tr = value => window.PasevSUI18n?.translateRuntime?.(value) || value;

  function semverAtLeast(version, minimum) {
    const a = String(version || '').replace(/^v/, '').split(/[.-]/).slice(0,3).map(x => Number(x) || 0);
    const b = String(minimum).split('.').map(Number);
    for (let i=0;i<3;i++) { if ((a[i]||0) > b[i]) return true; if ((a[i]||0) < b[i]) return false; }
    return true;
  }

  function browserProbe(versionStamp) {
    const pgp = window.openpgp;
    const publicKeyEnums = pgp?.enums?.publicKey || {};
    const enumNames = Object.keys(publicKeyEnums);
    const pqNames = enumNames.filter(name => /(?:ml[-_]?kem|ml[-_]?dsa|slh[-_]?dsa|post[-_]?quantum)/i.test(name));
    return {
      openpgpLoaded: Boolean(pgp),
      pinnedVersionStamp: versionStamp || null,
      securityBaseline611OrNewer: semverAtLeast(versionStamp, '6.1.1'),
      webCrypto: Boolean(globalThis.crypto?.subtle),
      webStreams: typeof ReadableStream !== 'undefined' && typeof TransformStream !== 'undefined' && typeof WritableStream !== 'undefined',
      fileSystemAccess: typeof window.showSaveFilePicker === 'function',
      argon2Enum: Boolean(pgp?.enums?.s2k && Object.prototype.hasOwnProperty.call(pgp.enums.s2k, 'argon2')),
      rfc9580V6Config: Boolean(pgp?.config && Object.prototype.hasOwnProperty.call(pgp.config, 'v6Keys')),
      grammarValidation: Boolean(pgp?.config && Object.prototype.hasOwnProperty.call(pgp.config, 'enforceGrammar')),
      decompressionLimit: Boolean(pgp?.config && Object.prototype.hasOwnProperty.call(pgp.config, 'maxDecompressedMessageSize')),
      pqRuntimeEnumNames: pqNames,
      pqRuntimeExposed: pqNames.length > 0,
      jsPDFLoaded: Boolean(window.jspdf?.jsPDF || window.jsPDF),
      jsPDFVersion: window.jspdf?.jsPDF?.version || window.jsPDF?.version || null
    };
  }

  async function readVersionStamp() {
    try {
      const r = await fetch('scripts/openpgp.version', {cache:'no-store'});
      return r.ok ? (await r.text()).trim() : null;
    } catch { return null; }
  }

  function badge(ok, trueText='AVAILABLE', falseText='UNAVAILABLE') {
    const span = document.createElement('span');
    span.className = `cap-badge ${ok ? 'cap-ok' : 'cap-off'}`;
    span.textContent = tr(ok ? trueText : falseText);
    return span;
  }

  function addRow(body, label, statusNode, detail='') {
    const row = document.createElement('div'); row.className='cap-row';
    const name = document.createElement('div'); name.className='cap-name'; name.textContent=tr(label);
    const status = document.createElement('div'); status.className='cap-status'; status.append(statusNode);
    const info = document.createElement('div'); info.className='cap-detail'; info.textContent=detail;
    row.append(name,status,info); body.append(row);
  }

  function render(report) {
    const body=$('runtimeCapabilityMatrix');
    const raw=$('runtimeCapabilityJson');
    if (!body) return;
    body.textContent='';
    const s=report.server || {};
    const b=report.browser || {};
    addRow(body,'_crypto backend',badge(Boolean(s.cryptoRoot?.present)), s.cryptoRoot?.present ? (s.cryptoRoot.relative || '_crypto') : tr('Expected at sibling PROJECT/_crypto, project-local _crypto, or PASEVSU_CRYPTO_HOME.'));
    addRow(body,'OpenPGP.js source tree',badge(Boolean(s.openpgp?.sourcePresent)), s.openpgp?.sourceVersion ? `v${s.openpgp.sourceVersion}` : '');
    addRow(body,'Pinned browser OpenPGP.js',badge(Boolean(b.openpgpLoaded && s.openpgp?.browserBundlePresent && s.openpgp?.browserBundleHashPinned)), b.pinnedVersionStamp ? `v${b.pinnedVersionStamp}${s.openpgp?.browserBundleHashPinned ? ' · SHA-256 PINNED' : ' · HASH NOT PINNED'}` : 'version stamp unavailable');
    addRow(body,'QR runtime provider',badge(Boolean(s.vendorRuntime?.qr?.bundlePresent && s.vendorRuntime?.qr?.bundleHashPinned)), s.vendorRuntime?.qr?.provider ? `${s.vendorRuntime.qr.provider}${s.vendorRuntime.qr.hashMatchesLocal ? ' · SOURCE MATCH' : ''}${s.vendorRuntime.qr.bundleHashPinned ? ' · HASH PINNED' : ''}` : 'provider stamp unavailable');
    addRow(body,'jsPDF report provider',badge(Boolean(b.jsPDFLoaded && s.vendorRuntime?.jsPDF?.runtimeBundlePresent && s.vendorRuntime?.jsPDF?.runtimeBundleHashPinned)), s.vendorRuntime?.jsPDF?.provider ? `${s.vendorRuntime.jsPDF.provider} · v${s.vendorRuntime.jsPDF.runtimeVersion || b.jsPDFVersion || '?'}${s.vendorRuntime.jsPDF.hashMatchesLocal ? ' · SOURCE MATCH' : ''}${s.vendorRuntime.jsPDF.runtimeBundleHashPinned ? ' · HASH PINNED' : ''}` : 'provider stamp unavailable');
    addRow(body,'Signature-spoofing security baseline',badge(Boolean(b.securityBaseline611OrNewer),'PATCHED BASELINE','CHECK VERSION'), b.pinnedVersionStamp ? `OpenPGP.js ${b.pinnedVersionStamp}` : 'requires >= 6.1.1');
    addRow(body,'RFC 9580 / v6 capability',badge(Boolean(b.rfc9580V6Config)), b.rfc9580V6Config ? 'OpenPGP.js v6 configuration detected' : 'not exposed by loaded bundle');
    addRow(body,'Argon2 S2K',badge(Boolean(b.argon2Enum)), b.argon2Enum ? 'runtime enum detected' : 'not exposed by loaded bundle');
    addRow(body,'RFC 9980 / PQ source',badge(Boolean(s.openpgp?.postQuantumSource?.present),'SOURCE PRESENT','SOURCE ABSENT'), s.openpgp?.postQuantumSource?.present ? 'ML-KEM + ML-DSA source files detected; this is not runtime proof.' : '');
    addRow(body,'RFC 9980 / PQ browser runtime',badge(Boolean(b.pqRuntimeExposed),'RUNTIME EXPOSED','NOT VERIFIED'), b.pqRuntimeEnumNames?.length ? b.pqRuntimeEnumNames.join(', ') : 'No PQ public-key enum exposed by the loaded browser bundle.');
    addRow(body,'WKD exact-email discovery',badge(Boolean(s.discovery?.wkd)), s.discovery?.order?.join(' → ') || '');
    addRow(body,'Web Streams',badge(Boolean(b.webStreams)), b.webStreams ? 'ReadableStream + TransformStream + WritableStream' : '');
    addRow(body,'Direct-to-disk File System Access',badge(Boolean(b.fileSystemAccess)), b.fileSystemAccess ? 'showSaveFilePicker available' : 'browser does not expose showSaveFilePicker');
    addRow(body,'Persistent Symmetric Keys',badge(Boolean(s.experimental?.persistentSymmetricKeys?.enabled),'ENABLED','EXPERIMENTAL / OFF'), s.experimental?.persistentSymmetricKeys?.reason || '');
    if (raw) raw.value=JSON.stringify(report,null,2);
    const summary=$('runtimeCapabilitySummary');
    if (summary) {
      const pq = s.openpgp?.postQuantumSource?.present ? (b.pqRuntimeExposed ? 'PQ runtime exposed' : 'PQ source detected / runtime unverified') : 'PQ source absent';
      summary.textContent=`${tr('Capability scan completed.')} ${pq}. WKD=${s.discovery?.wkd ? 'ON':'OFF'}.`;
    }
  }

  async function refresh() {
    const btn=$('refreshRuntimeCapabilities'); if (btn) btn.disabled=true;
    const summary=$('runtimeCapabilitySummary'); if(summary) summary.textContent=tr('Scanning central _crypto and browser cryptographic capabilities…');
    try {
      const [serverResponse, versionStamp] = await Promise.all([
        fetch('/api/crypto-capabilities',{cache:'no-store'}), readVersionStamp()
      ]);
      if (!serverResponse.ok) throw new Error(`HTTP ${serverResponse.status}`);
      const server=await serverResponse.json();
      lastReport={generatedAt:new Date().toISOString(),server,browser:browserProbe(versionStamp)};
      render(lastReport);
      return lastReport;
    } catch(error) {
      if(summary) summary.textContent=`${tr('Capability scan failed')}: ${error.message}`;
      return lastReport;
    } finally { if(btn) btn.disabled=false; }
  }

  function download() {
    if(!lastReport) return;
    const blob=new Blob([JSON.stringify(lastReport,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download=`pasevsu-crypto-capabilities-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; a.click(); URL.revokeObjectURL(url);
  }

  function init(){
    $('refreshRuntimeCapabilities')?.addEventListener('click',refresh);
    $('downloadRuntimeCapabilities')?.addEventListener('click',download);
    window.addEventListener('pasevsu-language-changed',()=>{ if(lastReport) render(lastReport); });
    refresh();
  }
  document.addEventListener('DOMContentLoaded',init,{once:true});
  window.PasevSURuntimeCapabilities={refresh,get report(){return lastReport;}};
})();
