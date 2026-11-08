'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { protocolAudit, languageAudit, optionNames, walkSource } = require('../scripts/guardian-protocols.cjs');
const root=path.join(__dirname,'..');
const p=path.join(root,'hapi_enterprise','guardian','protocols');
const load=name=>JSON.parse(fs.readFileSync(path.join(p,name+'.json'),'utf8'));
const history=load('release-history');
const defects=load('historical-defects');
const baseline=load('function-option-baseline');
const watchers=load('watch-contracts');
const cache=load('cache-optimization');
const lang=load('language-sync');

assert.equal(history.releaseSections,history.releases.length);
assert.ok(history.releases.length>=222,'historical release coverage');
assert.equal(defects.count,defects.defects.length);
assert.equal(defects.defects.length,46,'historical defects from curated source');
assert.deepEqual(defects.defects.filter(x=>x.state==='open').map(x=>x.id),['DEF-06','DEF-38']);
assert.equal(baseline.moduleCount,baseline.modules.length);
assert.equal(baseline.optionCount,baseline.options.length);
assert.ok(baseline.functionCount>=350);
assert.ok(watchers.watchers.some(x=>x.id==='all-source-modules'));
assert.ok(watchers.watchers.some(x=>x.id==='locale'));
assert.ok(watchers.watchers.some(x=>x.id==='configuration'));
assert.ok(watchers.watchers.some(x=>x.id==='cryptography'));
assert.ok(cache.candidates.length>=7);
assert.ok(cache.candidates.every(x=>x.status==='candidate-unmeasured'));
assert.ok(cache.rules.some(x=>/cache/i.test(x)));
assert.deepEqual(Object.keys(lang.locales).sort(),['bg','de','en']);
assert.deepEqual(Object.keys(lang.locales.bg).sort(),Object.keys(lang.locales.en).sort());
assert.deepEqual(Object.keys(lang.locales.bg).sort(),Object.keys(lang.locales.de).sort());

const report=protocolAudit();
assert.equal(report.errors.length,0,'guardian protocol drift: '+report.errors.join('; '));
assert.ok(report.options.current>baseline.optionCount,'guardian opt-in flag must be included');
assert.ok(optionNames().includes('stability_guardian_enabled'));
assert.ok(report.source.modules>100,'nested UI/routes and Python integration are inventoried');
assert.ok(walkSource(path.join(root,'hapi_enterprise')).some(m=>m.module==='hapi_enterprise/guardian/monitor.js'));
const languages=languageAudit();
assert.equal(languages.addon.bg.missing.length,0);
assert.equal(languages.addon.en.missing.length,0);
console.log('guardian protocols: OK, '+report.historic.releaseNotes+' historical release sections; '+
  report.historic.defects+' defects; '+report.functions.current+' functions; '+report.source.modules+
  ' source files; '+report.options.current+' options; '+report.cache.candidates+' cache candidates');
