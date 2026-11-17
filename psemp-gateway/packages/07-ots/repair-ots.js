#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.argv[2] || './OTS_blockcain_pdfgen.html';
const DRY_RUN = process.argv.includes('--dry-run');
const NO_BACKUP = process.argv.includes('--no-backup');

console.log('============================================================');
console.log('  OTS FORENSIC ENTERPRISE v15.1.0 - AUTO-REPAIR');
console.log('  Node.js Edition');
console.log('============================================================\n');

if (!fs.existsSync(FILE)) {
    console.error(`[FAIL] File not found: ${FILE}`);
    process.exit(1);
}

const fullPath = path.resolve(FILE);
const original = fs.readFileSync(fullPath, 'utf8');
const originalHash = crypto.createHash('sha256').update(original).digest('hex');

console.log(`[i] File: ${fullPath}`);
console.log(`[i] Size: ${(original.length / 1024).toFixed(2)} KB`);
console.log(`[i] SHA-256: ${originalHash}\n`);

// Backup
let backupPath = null;
if (!NO_BACKUP && !DRY_RUN) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    backupPath = `${fullPath}.backup-${ts}`;
    fs.copyFileSync(fullPath, backupPath);
    console.log(`[OK] Backup: ${backupPath}\n`);
}

// ================================================================
// PATCHES
// ================================================================
const patches = [];

// ---------- PATCH 1: printReport() ----------
patches.push({
    name: 'PATCH-1: printReport iframe',
    priority: 'P0',
    required: true,
    idempotent: 'PATCH-1-APPLIED',
    find: `function printReport(){
  const w=window.open('', '_blank'); if(!w) return;
  const payload=JSON.stringify(state.export||state,null,2);
  const cert=state.certificate?JSON.stringify(state.certificate,null,2):'';
  const html='<!doctype html><html><head><meta charset="utf-8"><title>OTS Forensic Report</title><style>body{font:12px Arial;margin:25px;color:#111}h1{border-bottom:3px double #111}h2{margin-top:22px;border-bottom:1px solid #999}pre{white-space:pre-wrap;font:9px monospace;background:#f5f5f5;padding:10px}</style></head><body><h1>OTS / BLOCKCHAIN FORENSIC REPORT</h1><p><b>Application:</b> OTS Verifier Pro v'+APP_VERSION+'</p><p><b>Operator:</b> '+esc(state.caseInfo.operator)+'</p><p><b>Case:</b> '+esc(state.caseInfo.caseNumber)+'</p><p><b>Report generated:</b> '+new Date().toISOString()+'</p>'+(cert?'<h2>Certificate</h2><pre>'+esc(cert)+'</pre>':'')+'<h2>Verification data</h2><pre>'+esc(payload)+'</pre></body></html>';
  w.document.open(); w.document.write(html); w.document.close(); w.focus();
}`,
    replace: `// PATCH-1-APPLIED: iframe-based print
function printReport(){
  try {
    const payload = JSON.stringify(state.export || state, null, 2);
    const cert = state.certificate ? JSON.stringify(state.certificate, null, 2) : '';
    const html = '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>OTS Forensic Report - ' + esc(state.caseInfo.caseNumber || 'N/A') + '</title>' +
      '<style>' +
      'body{font:12px Arial,sans-serif;margin:25px;color:#111;line-height:1.5}' +
      'h1{border-bottom:3px double #111;padding-bottom:8px;margin-bottom:4px}' +
      'h2{margin-top:22px;border-bottom:1px solid #999;padding-bottom:4px}' +
      'pre{white-space:pre-wrap;font:9px monospace;' +
      'background:#f5f5f5;padding:10px;border:1px solid #ddd;border-radius:4px;' +
      'page-break-inside:avoid;overflow-wrap:anywhere}' +
      '.meta{margin:8px 0;padding:8px;background:#f9f9f9;border-left:3px solid #2563eb}' +
      '.meta b{display:inline-block;min-width:140px}' +
      '@media print{' +
      'body{margin:10mm;font-size:10pt}' +
      'pre{background:#fff;border:1px solid #ccc;font-size:8pt}' +
      'h1{font-size:16pt}h2{font-size:12pt}' +
      '.no-print{display:none}' +
      '}' +
      '</style></head><body>' +
      '<h1>OTS / BLOCKCHAIN FORENSIC REPORT</h1>' +
      '<div class="meta">' +
      '<div><b>Application:</b> OTS Forensic Enterprise v' + APP_VERSION + '</div>' +
      '<div><b>Operator:</b> ' + esc(state.caseInfo.operator || 'N/A') + '</div>' +
      '<div><b>Case Number:</b> ' + esc(state.caseInfo.caseNumber || 'N/A') + '</div>' +
      '<div><b>Organization:</b> ' + esc(state.caseInfo.organization || 'N/A') + '</div>' +
      '<div><b>Report Generated:</b> ' + new Date().toISOString() + '</div>' +
      '<div><b>Evidence ID:</b> ' + esc(state.evidenceId || 'N/A') + '</div>' +
      '<div><b>Final Verdict:</b> ' + esc((state.forensicCore && state.forensicCore.finalVerdict) || 'N/A') + '</div>' +
      '</div>' +
      (cert ? '<h2>Certificate</h2><pre>' + esc(cert) + '</pre>' : '') +
      '<h2>Verification Data</h2><pre>' + esc(payload) + '</pre>' +
      '</body></html>';

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (printErr) {
        log('Print dialog failed: ' + printErr.message, 'WARN');
        const blob = new Blob([html], {type: 'text/html'});
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } finally {
        setTimeout(() => {
          try { iframe.remove(); } catch (_) {}
        }, 1500);
      }
    }, 350);

    log('Print report generated', 'OK');
    NotificationSystem.info('Print', 'Print dialog opened.');
  } catch (e) {
    log('Print report failed: ' + e.message, 'ERROR');
    NotificationSystem.error('Print', e.message);
  }
}`
});

// ---------- PATCH 2: downloadCalendarsList() ----------
patches.push({
    name: 'PATCH-2: calendar JSON+TXT',
    priority: 'P0',
    required: true,
    idempotent: 'PATCH-2-APPLIED',
    find: `function downloadCalendarsList() {
  const urls = getGenerationCalendars();
  if (!urls.length) {
    NotificationSystem.info('ℹ️ Календари', 'Използват се официалните настройки на OpenTimestamps.');
    return;
  }
  downloadBytes(new TextEncoder().encode(urls.join('\\r\\n') + '\\r\\n'),
    'opentimestamps-calendars.txt', 'text/plain;charset=utf-8');
}`,
    replace: `// PATCH-2-APPLIED: JSON+TXT calendar export
function downloadCalendarsList() {
  const urls = getGenerationCalendars();
  if (!urls.length) {
    NotificationSystem.info('ℹ️ Календари', 'Използват се официалните настройки на OpenTimestamps.');
    return;
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const payload = {
    schema: 'OTS-CALENDARS-EXPORT-1',
    exportedAt: new Date().toISOString(),
    application: 'OTS Forensic Enterprise v' + APP_VERSION,
    operator: (state.caseInfo && state.caseInfo.operator) || 'N/A',
    caseNumber: (state.caseInfo && state.caseInfo.caseNumber) || 'N/A',
    organization: (state.caseInfo && state.caseInfo.organization) || 'N/A',
    calendarCount: urls.length,
    calendars: urls.map((url, i) => ({
      index: i + 1,
      url: String(url).trim(),
      protocol: url.indexOf('https://') === 0 ? 'HTTPS' :
                url.indexOf('http://') === 0 ? 'HTTP' : 'UNKNOWN',
      host: (function() {
        try { return new URL(url).host; } catch (_) { return 'invalid'; }
      })()
    })),
    rawText: urls.join('\\r\\n') + '\\r\\n'
  };

  downloadBytes(
    new TextEncoder().encode(JSON.stringify(payload, null, 2)),
    'opentimestamps-calendars-' + dateStr + '.json',
    'application/json;charset=utf-8'
  );

  setTimeout(() => {
    downloadBytes(
      new TextEncoder().encode(payload.rawText),
      'opentimestamps-calendars-' + dateStr + '.txt',
      'text/plain;charset=utf-8'
    );
  }, 250);

  NotificationSystem.success(
    '📥 Календари',
    'Изтеглени ' + urls.length + ' календара (JSON + TXT).'
  );
  log('Calendar list exported: ' + urls.length + ' URLs', 'OK');

  auditEvent('CALENDARS_EXPORTED', {
    result: 'Calendar list exported',
    count: urls.length,
    calendars: payload.calendars
  }).catch(console.error);
}`
});

// ---------- PATCH 3.1: bg translations ----------
patches.push({
    name: 'PATCH-3.1: bg translations',
    priority: 'P1',
    required: false,
    idempotent: "fullyVerified: '✅ ПЪЛНО",
    find: `        timestamp: 'Времеви печат'
      },
      de: {`,
    replace: `        timestamp: 'Времеви печат',
        fullyVerified: '✅ ПЪЛНО ПОТВЪРДЕН',
        partiallyVerified: '⚠️ ЧАСТИЧНО ПОТВЪРДЕН',
        notVerified: '❌ НЕПОТВЪРДЕН',
        unknown: '⏳ НЕИЗВЕСТЕН',
        ofBlocks: 'от {total} блока потвърдени',
        captured: 'записани',
        statistics: '📊 Статистически преглед',
        chartError: 'Диаграмата не може да бъде генерирана.',
        noSignature: 'НЕ Е ПРИЛОЖЕН КРИПТОГРАФСКИ ПОДПИС',
        ofPages: 'от',
        confirmed: '✅ ПОТВЪРДЕН',
        notConfirmed: '❌ НЕПОТВЪРДЕН',
        date: 'Дата:',
        reportType: 'Тип доклад:',
        documentId: 'Документ-ID:',
        format: 'Формат:',
        event: 'Събитие',
        result: 'Резултат',
        timePoint: 'Момент',
        unavailable: 'Няма',
        signatureNote: 'Забележка: OTS proof-ът е отделен криптографски артефакт; този PDF не го заменя.',
        statusLabel: 'Статус:',
        reasonLabel: 'Причина:',
        identifierLabel: 'Идентификатор:'
      },
      de: {`
});

// ---------- PATCH 3.2: de translations ----------
patches.push({
    name: 'PATCH-3.2: de translations',
    priority: 'P1',
    required: false,
    idempotent: "fullyVerified: '✅ VOLLST",
    find: `        timestamp: 'Zeitstempel'
      },
      en: {`,
    replace: `        timestamp: 'Zeitstempel',
        fullyVerified: '✅ VOLLSTÄNDIG BESTÄTIGT',
        partiallyVerified: '⚠️ TEILWEISE BESTÄTIGT',
        notVerified: '❌ NICHT BESTÄTIGT',
        unknown: '⏳ UNBEKANNT',
        ofBlocks: 'von {total} Blöcken bestätigt',
        captured: 'erfasst',
        statistics: '📊 Statistische Übersicht',
        chartError: 'Diagramm konnte nicht generiert werden.',
        noSignature: 'KEINE KRYPTOGRAFISCHE SIGNATUR ANGEWENDET',
        ofPages: 'von',
        confirmed: '✅ BESTÄTIGT',
        notConfirmed: '❌ NICHT BESTÄTIGT',
        date: 'Datum:',
        reportType: 'Berichtstyp:',
        documentId: 'Dokument-ID:',
        format: 'Format:',
        event: 'Ereignis',
        result: 'Ergebnis',
        timePoint: 'Zeitpunkt',
        unavailable: 'N/A',
        signatureNote: 'Anmerkung: Der OTS-Proof ist ein separates kryptografisches Artefakt; dieses PDF ersetzt ihn nicht.',
        statusLabel: 'Status:',
        reasonLabel: 'Grund:',
        identifierLabel: 'Bezeichner:'
      },
      en: {`
});

// ---------- PATCH 3.3: en translations ----------
patches.push({
    name: 'PATCH-3.3: en translations',
    priority: 'P1',
    required: false,
    idempotent: "fullyVerified: '✅ FULLY",
    find: `        timestamp: 'Timestamp'
      }
    };
  }`,
    replace: `        timestamp: 'Timestamp',
        fullyVerified: '✅ FULLY VERIFIED',
        partiallyVerified: '⚠️ PARTIALLY VERIFIED',
        notVerified: '❌ NOT VERIFIED',
        unknown: '⏳ UNKNOWN',
        ofBlocks: 'of {total} blocks confirmed',
        captured: 'captured',
        statistics: '📊 Statistical Overview',
        chartError: 'Chart could not be generated.',
        noSignature: 'NO CRYPTOGRAPHIC SIGNATURE APPLIED',
        ofPages: 'of',
        confirmed: '✅ CONFIRMED',
        notConfirmed: '❌ NOT CONFIRMED',
        date: 'Date:',
        reportType: 'Report Type:',
        documentId: 'Document-ID:',
        format: 'Format:',
        event: 'Event',
        result: 'Result',
        timePoint: 'Time Point',
        unavailable: 'N/A',
        signatureNote: 'Note: The OTS proof is a separate cryptographic artifact; this PDF does not replace it.',
        statusLabel: 'Status:',
        reasonLabel: 'Reason:',
        identifierLabel: 'Identifier:'
      }
    };
  }`
});

// ---------- PATCH 4.1: addHeader localization ----------
patches.push({
    name: 'PATCH-4.1: addHeader localization',
    priority: 'P1',
    required: false,
    idempotent: "this.t('date')",
    find: `    const date = new Date(this.options.reportDate);
    this.doc.text(\`Datum: \${date.toLocaleString('de-DE')}\`, this.margin, this.y);
    this.doc.text(\`Berichtstyp: \${this.options.reportType.toUpperCase()}\`, this.pageWidth - this.margin - 55, this.y);
    this.y += 6;
    this.doc.text(\`Dokument-ID: FOR-\${Date.now().toString(36).toUpperCase()}\`, this.margin, this.y);
    this.doc.text(\`Format: \${this.options.format.toUpperCase()}\`, this.pageWidth - this.margin - 45, this.y);`,
    replace: `    const date = new Date(this.options.reportDate);
    const localeMap = { bg: 'bg-BG', de: 'de-DE', en: 'en-US' };
    const locale = localeMap[this.options.language] || 'de-DE';
    this.doc.text(\`\${this.t('date')} \${date.toLocaleString(locale)}\`, this.margin, this.y);
    this.doc.text(\`\${this.t('reportType')} \${this.options.reportType.toUpperCase()}\`, this.pageWidth - this.margin - 55, this.y);
    this.y += 6;
    this.doc.text(\`\${this.t('documentId')} FOR-\${Date.now().toString(36).toUpperCase()}\`, this.margin, this.y);
    this.doc.text(\`\${this.t('format')} \${this.options.format.toUpperCase()}\`, this.pageWidth - this.margin - 45, this.y);`
});

// ---------- PATCH 4.2: addSummary status localization ----------
patches.push({
    name: 'PATCH-4.2: addSummary status localization',
    priority: 'P1',
    required: false,
    idempotent: "this.t('fullyVerified')",
    find: `    let status = '⏳ UNBEKANNT';
    let statusColor = [100, 116, 139];
    if (verified > 0 && verified === total) {
      status = '✅ VOLLSTÄNDIG BESTÄTIGT';
      statusColor = [5, 150, 105];
    } else if (verified > 0) {
      status = \`⚠️ TEILWEISE BESTÄTIGT (\${verified}/\${total})\`;
      statusColor = [217, 119, 6];
    } else if (total > 0) {
      status = '❌ NICHT BESTÄTIGT';
      statusColor = [220, 38, 38];
    }`,
    replace: `    let status = '⏳ ' + this.t('unknown');
    let statusColor = [100, 116, 139];
    if (verified > 0 && verified === total) {
      status = this.t('fullyVerified');
      statusColor = [5, 150, 105];
    } else if (verified > 0) {
      status = this.t('partiallyVerified') + ' (' + verified + '/' + total + ')';
      statusColor = [217, 119, 6];
    } else if (total > 0) {
      status = this.t('notVerified');
      statusColor = [220, 38, 38];
    }`
});

// ---------- PATCH 4.3: addSummary counts localization ----------
patches.push({
    name: 'PATCH-4.3: addSummary counts localization',
    priority: 'P1',
    required: false,
    idempotent: "this.t('ofBlocks')",
    find: `    this.doc.text(\`\${verified} von \${total} Blöcken bestätigt\`, this.margin + 75, this.y);
    this.y += 6;

    this.doc.setFont('helvetica', 'bold');
    this.doc.text(this.t('transactions'), this.margin + 5, this.y);
    this.doc.setFont('helvetica', 'normal');
    this.doc.text(\`\${txs.length} erfasst\`, this.margin + 75, this.y);`,
    replace: `    const ofBlocksText = this.t('ofBlocks').replace('{total}', total);
    this.doc.text(\`\${verified} \${ofBlocksText}\`, this.margin + 75, this.y);
    this.y += 6;

    this.doc.setFont('helvetica', 'bold');
    this.doc.text(this.t('transactions'), this.margin + 5, this.y);
    this.doc.setFont('helvetica', 'normal');
    this.doc.text(\`\${txs.length} \${this.t('captured')}\`, this.margin + 75, this.y);`
});

// ---------- PATCH 4.4: addCharts title ----------
patches.push({
    name: 'PATCH-4.4: addCharts title',
    priority: 'P1',
    required: false,
    idempotent: "this.t('statistics')",
    find: `    this.doc.text('📊 Statistische Übersicht', this.margin, this.y);`,
    replace: `    this.doc.text(this.t('statistics'), this.margin, this.y);`
});

// ---------- PATCH 4.5: addCharts error ----------
patches.push({
    name: 'PATCH-4.5: addCharts error',
    priority: 'P1',
    required: false,
    idempotent: "this.t('chartError')",
    find: `      this.doc.text('Diagramm konnte nicht generiert werden.', this.margin + 5, this.y);`,
    replace: `      this.doc.text(this.t('chartError'), this.margin + 5, this.y);`
});

// ---------- PATCH 4.6: addAsciiChart labels ----------
patches.push({
    name: 'PATCH-4.6: addAsciiChart labels',
    priority: 'P1',
    required: false,
    idempotent: 'labels.total',
    find: `    drawBar('Gesamt', total, [37, 99, 235]);
    drawBar('Bestätigt', verified, [5, 150, 105]);
    drawBar('Bitcoin', btcBlocks, [247, 147, 30]);
    drawBar('Litecoin', ltcBlocks, [108, 92, 231]);
    drawBar('Ausstehend', pendingBlocks, [251, 191, 36]);`,
    replace: `    const l = this.options.language || 'de';
    const labels = {
      bg: { total: 'Общо', verified: 'Потвърдени', bitcoin: 'Bitcoin', litecoin: 'Litecoin', pending: 'Изчакващи' },
      de: { total: 'Gesamt', verified: 'Bestätigt', bitcoin: 'Bitcoin', litecoin: 'Litecoin', pending: 'Ausstehend' },
      en: { total: 'Total', verified: 'Verified', bitcoin: 'Bitcoin', litecoin: 'Litecoin', pending: 'Pending' }
    }[l] || { total: 'Gesamt', verified: 'Bestätigt', bitcoin: 'Bitcoin', litecoin: 'Litecoin', pending: 'Ausstehend' };

    drawBar(labels.total, total, [37, 99, 235]);
    drawBar(labels.verified, verified, [5, 150, 105]);
    drawBar(labels.bitcoin, btcBlocks, [247, 147, 30]);
    drawBar(labels.litecoin, ltcBlocks, [108, 92, 231]);
    drawBar(labels.pending, pendingBlocks, [251, 191, 36]);`
});

// ---------- PATCH 4.7: addCharts labels ----------
patches.push({
    name: 'PATCH-4.7: addCharts labels',
    priority: 'P1',
    required: false,
    idempotent: 'labels: (() =>',
    find: `              labels: ['Gesamt', 'Bestätigt', 'Bitcoin', 'Litecoin', 'Ausstehend'],`,
    replace: `              labels: (() => {
                const l = this.options.language || 'de';
                return {
                  bg: ['Общо', 'Потвърдени', 'Bitcoin', 'Litecoin', 'Изчакващи'],
                  de: ['Gesamt', 'Bestätigt', 'Bitcoin', 'Litecoin', 'Ausstehend'],
                  en: ['Total', 'Verified', 'Bitcoin', 'Litecoin', 'Pending']
                }[l] || ['Gesamt', 'Bestätigt', 'Bitcoin', 'Litecoin', 'Ausstehend'];
              })(),`
});

// ---------- PATCH 4.8: addCertificate UNBEKANNT ----------
patches.push({
    name: 'PATCH-4.8: addCertificate unknown',
    priority: 'P1',
    required: false,
    idempotent: "cert.statusText || this.t('unknown')",
    find: `      [this.t('status'), cert.statusText || 'UNBEKANNT'],`,
    replace: `      [this.t('status'), cert.statusText || this.t('unknown')],`
});

// ---------- PATCH 4.9: addBlocks status ----------
patches.push({
    name: 'PATCH-4.9: addBlocks status',
    priority: 'P1',
    required: false,
    idempotent: "this.t('statusLabel')",
    find: `        this.doc.text(\`Status: \${b.merkleMatch ? '✅ BESTÄTIGT' : '❌ NICHT BESTÄTIGT'}\`, this.margin + 10, this.y);`,
    replace: `        this.doc.text(\`\${this.t('statusLabel')} \${b.merkleMatch ? this.t('confirmed') : this.t('notConfirmed')}\`, this.margin + 10, this.y);`
});

// ---------- PATCH 4.10: addSignature rows ----------
patches.push({
    name: 'PATCH-4.10: addSignature rows',
    priority: 'P1',
    required: false,
    idempotent: "this.t('noSignature')",
    find: `    const rows = [
      ['Статус:', 'НЕ Е ПРИЛОЖЕН КРИПТОГРАФСКИ ПОДПИС'],
      ['Причина:', 'Този отчет не създава и не представя симулиран ECDSA/цифров подпис.'],
      ['Идентификатор:', 'Не е наличен — подписване не е извършено'],
      ['Оператор:', this.options.operator || 'N/A'],
      ['Организация:', this.options.organization || 'N/A']
    ];`,
    replace: `    const rows = [
      [this.t('statusLabel'), this.t('noSignature')],
      [this.t('reasonLabel'), this.options.language === 'bg' 
        ? 'Този отчет не създава и не представя симулиран ECDSA/цифров подпис.'
        : this.options.language === 'en'
        ? 'This report does not create or represent a simulated ECDSA/digital signature.'
        : 'Dieser Bericht erstellt oder repräsentiert keine simulierte ECDSA/digitale Signatur.'],
      [this.t('identifierLabel'), this.t('unavailable')],
      [this.t('operator'), this.options.operator || 'N/A'],
      [this.t('organization'), this.options.organization || 'N/A']
    ];`
});

// ---------- PATCH 4.11: addSignature note ----------
patches.push({
    name: 'PATCH-4.11: addSignature note',
    priority: 'P1',
    required: false,
    idempotent: "this.t('signatureNote')",
    find: `    this.doc.text('Забележка: OTS proof-ът е отделен криптографски артефакт; този PDF не го заменя.', this.margin + 5, this.y + 3);`,
    replace: `    this.doc.text(this.t('signatureNote'), this.margin + 5, this.y + 3);`
});

// ---------- PATCH 4.12: addChainOfCustody table ----------
patches.push({
    name: 'PATCH-4.12: addChainOfCustody table',
    priority: 'P1',
    required: false,
    idempotent: "this.t('timePoint')",
    find: `      const tableData = cert.chainOfCustody.map(entry => [
        entry.time ? new Date(entry.time).toLocaleString('de-DE') : 'N/A',
        entry.event || 'N/A',
        entry.result || 'N/A'
      ]);

      this.doc.autoTable({
        startY: this.y,
        head: [['Zeitpunkt', 'Ereignis', 'Ergebnis']],`,
    replace: `      const localeMap = { bg: 'bg-BG', de: 'de-DE', en: 'en-US' };
      const locale = localeMap[this.options.language] || 'de-DE';
      const tableData = cert.chainOfCustody.map(entry => [
        entry.time ? new Date(entry.time).toLocaleString(locale) : this.t('unavailable'),
        entry.event || this.t('unavailable'),
        entry.result || this.t('unavailable')
      ]);

      this.doc.autoTable({
        startY: this.y,
        head: [[this.t('timePoint'), this.t('event'), this.t('result')]],`
});

// ---------- PATCH 4.13: addChainOfCustody fallback ----------
patches.push({
    name: 'PATCH-4.13: addChainOfCustody fallback',
    priority: 'P1',
    required: false,
    idempotent: 'const localeMap2',
    find: `      for (const entry of cert.chainOfCustody) {
        const time = entry.time ? new Date(entry.time).toLocaleString('de-DE') : 'N/A';
        this.doc.text(\`[\${time}] \${entry.event} → \${entry.result || 'N/A'}\`, this.margin + 5, this.y);`,
    replace: `      const localeMap2 = { bg: 'bg-BG', de: 'de-DE', en: 'en-US' };
      const locale2 = localeMap2[this.options.language] || 'de-DE';
      for (const entry of cert.chainOfCustody) {
        const time = entry.time ? new Date(entry.time).toLocaleString(locale2) : this.t('unavailable');
        this.doc.text(\`[\${time}] \${entry.event} → \${entry.result || this.t('unavailable')}\`, this.margin + 5, this.y);`
});

// ---------- PATCH 4.14: addFooter ----------
patches.push({
    name: 'PATCH-4.14: addFooter localization',
    priority: 'P1',
    required: false,
    idempotent: "this.t('ofPages')",
    find: `      this.doc.text(\`\${this.t('page')} \${i} von \${pages}\`, this.pageWidth - this.margin - 25, this.pageHeight - 8);`,
    replace: `      this.doc.text(\`\${this.t('page')} \${i} \${this.t('ofPages')} \${pages}\`, this.pageWidth - this.margin - 25, this.pageHeight - 8);`
});

// ---------- PATCH 5: XSS renderCertificate ----------
patches.push({
    name: 'PATCH-5: XSS renderCertificate',
    priority: 'P1',
    required: false,
    idempotent: 'PATCH-5-APPLIED',
    find: `<span>🔐 Сертификат: \${cert.id}</span>
        <span class="pill \${cert.statusClass}">\${cert.statusText}</span>`,
    replace: `PATCH-5-APPLIED
        <span>🔐 Сертификат: \${esc(cert.id)}</span>
        <span class="pill \${esc(cert.statusClass)}">\${esc(cert.statusText)}</span>`
});

// ---------- PATCH 6.1: acceptOriginal evidenceId ----------
patches.push({
    name: 'PATCH-6.1: acceptOriginal evidenceId',
    priority: 'P1',
    required: false,
    idempotent: 'P1: reset evidence ID on new file',
    find: `function acceptOriginal(f) {
  if (!f) return;
  clearVerificationOnly('Original file changed — previous verification state cleared');
  state.original = f; state.relationshipStatus='NOT_VERIFIED';`,
    replace: `function acceptOriginal(f) {
  if (!f) return;
  clearVerificationOnly('Original file changed — previous verification state cleared');
  state.original = f;
  state.evidenceId = null; // P1: reset evidence ID on new file
  state.relationshipStatus='NOT_VERIFIED';`
});

// ---------- PATCH 6.2: acceptOts evidenceId ----------
patches.push({
    name: 'PATCH-6.2: acceptOts evidenceId',
    priority: 'P1',
    required: false,
    idempotent: 'P1: reset evidence ID on new proof',
    find: `  clearVerificationOnly('OTS proof changed — previous verification state cleared');
  state.ots = f; state.relationshipStatus='NOT_VERIFIED';`,
    replace: `  clearVerificationOnly('OTS proof changed — previous verification state cleared');
  state.ots = f;
  state.evidenceId = null; // P1: reset evidence ID on new proof
  state.relationshipStatus='NOT_VERIFIED';`
});

// ================================================================
// APPLY PATCHES
// ================================================================
let content = original;
const applied = [];
const skipped = [];
const failed = [];

console.log('  === APPLYING PATCHES ===\n');

patches.forEach((patch, idx) => {
    const label = `[${idx + 1}/${patches.length}] [${patch.priority}] ${patch.name}`;
    process.stdout.write(`  ${label}\n`);

    if (content.includes(patch.idempotent)) {
        console.log('      [SKIP] Already applied');
        skipped.push(patch.name);
        return;
    }
    if (!content.includes(patch.find)) {
        if (patch.required) {
            console.log('      [FAIL] NOT FOUND (required!)');
            failed.push(patch.name);
        } else {
            console.log('      [WARN] NOT FOUND (optional)');
            skipped.push(patch.name);
        }
        return;
    }
    content = content.replace(patch.find, patch.replace);
    console.log('      [OK] APPLIED');
    applied.push(patch.name);
});

// ================================================================
// VALIDATION
// ================================================================
console.log('\n  === VALIDATION ===\n');

if (failed.length > 0) {
    console.error(`  [FAIL] Required patches failed: ${failed.join(', ')}`);
    if (backupPath) {
        fs.copyFileSync(backupPath, fullPath);
        console.error(`  [RESTORED] from ${backupPath}`);
    }
    process.exit(1);
}

// Check script tags
const openScripts = (content.match(/<script[\s>]/g) || []).length;
const closeScripts = (content.match(/<\/script>/g) || []).length;
if (openScripts !== closeScripts) {
    console.error(`  [FAIL] Script tag mismatch: ${openScripts} vs ${closeScripts}`);
    if (backupPath) {
        fs.copyFileSync(backupPath, fullPath);
        console.error(`  [RESTORED] from ${backupPath}`);
    }
    process.exit(1);
}
console.log(`  [OK] Script tags balanced (${openScripts} pairs)`);

const openStyles = (content.match(/<style[\s>]/g) || []).length;
const closeStyles = (content.match(/<\/style>/g) || []).length;
if (openStyles !== closeStyles) {
    console.error(`  [FAIL] Style tag mismatch: ${openStyles} vs ${closeStyles}`);
    process.exit(1);
}
console.log(`  [OK] Style tags balanced (${openStyles} pairs)`);

// ================================================================
// WRITE
// ================================================================
if (DRY_RUN) {
    console.log('\n  [DRY-RUN] No changes written.');
} else {
    fs.writeFileSync(fullPath, content, 'utf8');
    const newHash = crypto.createHash('sha256').update(content).digest('hex');
    console.log(`\n  [OK] Written: ${fullPath}`);
    console.log(`  [i] Original SHA-256: ${originalHash}`);
    console.log(`  [i] New SHA-256:      ${newHash}`);
}

// ================================================================
// SUMMARY
// ================================================================
console.log('\n  === SUMMARY ===\n');
console.log(`  Applied: ${applied.length}`);
console.log(`  Skipped: ${skipped.length}`);
console.log(`  Failed:  ${failed.length}\n`);

if (applied.length > 0) {
    console.log('  Applied patches:');
    applied.forEach(p => console.log(`    + ${p}`));
}
if (skipped.length > 0) {
    console.log('\n  Skipped patches:');
    skipped.forEach(p => console.log(`    - ${p}`));
}

if (backupPath) console.log(`\n  [i] Backup: ${backupPath}`);
console.log('\n  DONE!\n');