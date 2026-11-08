'use strict';
/**
 * Stability Guardian protocol compiler and audit, no network or external packages.
 * Read-only unless --write-report is specified. This is evidence inventory, not AI training.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.join(__dirname, '..');
const PROTOCOL_ROOT = path.join(ROOT, 'hapi_enterprise', 'guardian', 'protocols');
const files = {
  defects: 'historical-defects.json',
  releases: 'release-history.json',
  baseline: 'function-option-baseline.json',
  watch: 'watch-contracts.json',
  cache: 'cache-optimization.json',
  languages: 'language-sync.json',
};
function readProtocol(name) {
  return JSON.parse(fs.readFileSync(path.join(PROTOCOL_ROOT, files[name]), 'utf8'));
}
function sortedUnique(values) { return [...new Set(values)].sort(); }
function optionNames() {
  const source = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'config.yaml'), 'utf8');
  const match = /^schema:\s*\n([\s\S]*?)(?=^map:|^environment:|\s*$)/m.exec(source);
  if (!match) throw Error('Home Assistant schema section missing');
  return sortedUnique([...match[1].matchAll(/^  ([a-z][a-z0-9_]+):/gm)].map(m => m[1]));
}
function addonTranslatedOptions(lang) {
  const source = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'translations', lang + '.yaml'), 'utf8');
  return sortedUnique([...source.matchAll(/^  ([a-z][a-z0-9_]+):\s*\n    name:/gm)].map(m => m[1]));
}
function walkSource(dir, result = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) { walkSource(full, result); continue; }
    if (!/\.(?:js|cjs|mjs|py)$/.test(item.name)) continue;
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    const source = fs.readFileSync(full, 'utf8');
    // These are source-level named-symbol heuristics, NOT executed-function coverage.
    const jsFns = [...source.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]);
    const jsArrows = [...source.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)].map(m=>m[1]);
    const pyFns = [...source.matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/gm)].map(m=>m[1]);
    const symbols = sortedUnique([...jsFns,...jsArrows,...pyFns]);
    const digest=crypto.createHash('sha256').update(source).digest('hex').slice(0,16);
    result.push({ module:rel, sha256Prefix:digest, namedSymbols:symbols });
  }
  return result;
}
function flatten(obj, prefix = '', out = {}) {
  for (const [key,value] of Object.entries(obj || {})) {
    const name = prefix ? prefix + '.' + key : key;
    if (typeof value === 'string') out[name] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, name, out);
  }
  return out;
}
function placeholders(value) {
  return sortedUnique([...String(value).matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(m=>m[1]));
}
function diffLocale(base, value) {
  const baselineKeys=Object.keys(base);
  const others=Object.keys(value);
  const missing=baselineKeys.filter(k=>!(k in value));
  const extra=others.filter(k=>!(k in base));
  const placeholderMismatch=baselineKeys.filter(k=>k in value && placeholders(base[k]).join(',')!==placeholders(value[k]).join(','));
  return { missing, extra, placeholderMismatch };
}
function languageAudit() {
  const guardian=readProtocol('languages').locales;
  const admin=require(path.join(ROOT,'hapi_enterprise','ui','i18n.js')).DICT;
  const publicPortal=require(path.join(ROOT,'hapi_enterprise','portal','portal-i18n.js'));
  const portal=Object.fromEntries(['bg','en','de'].map(lang=>[lang, flatten(publicPortal.dictionary(lang))]));
  const ha=Object.fromEntries(['bg','en'].map(lang=>[lang, flatten(JSON.parse(fs.readFileSync(path.join(ROOT,'custom_components','hapi_enterprise','translations',lang+'.json'),'utf8')))]));
  const config=Object.fromEntries(['bg','en'].map(lang=>[lang,addonTranslatedOptions(lang)]));
  const options=optionNames();
  return {
    languages: ['bg','en','de'],
    guardian: { en:diffLocale(guardian.bg,guardian.en), de:diffLocale(guardian.bg,guardian.de), keyCount:Object.keys(guardian.bg).length },
    admin: { en:diffLocale(admin.bg,admin.en), de:diffLocale(admin.bg,admin.de), keyCount:Object.keys(admin.bg).length },
    portal: { en:diffLocale(portal.bg,portal.en), de:diffLocale(portal.bg,portal.de), keyCount:Object.keys(portal.bg).length },
    integration: { en:diffLocale(ha.bg,ha.en), keyCount:Object.keys(ha.bg).length },
    addon: Object.fromEntries(['bg','en'].map(lang=>[lang,{ missing:options.filter(x=>!config[lang].includes(x)), extra:config[lang].filter(x=>!options.includes(x)) }])),
  };
}
function protocolAudit() {
  const d=readProtocol('defects'),r=readProtocol('releases'),b=readProtocol('baseline'),w=readProtocol('watch'),c=readProtocol('cache'),languages=languageAudit();
  const actualModules=require(path.join(ROOT,'scripts','function-catalog.cjs')).collect();
  const baseKeys=new Set(b.modules.flatMap(m=>m.functions.map(f=>m.module+':'+f.name)));
  const currentKeys=new Set(actualModules.flatMap(m=>m.functions.map(f=>m.module+':'+f.name)));
  const sourceInventory=walkSource(path.join(ROOT,'hapi_enterprise')).concat(walkSource(path.join(ROOT,'custom_components','hapi_enterprise')));
  const watchSources=new Set(w.watchers.flatMap(x=>x.files||[]));
  const knownDefectIds=new Set(d.defects.map(x=>x.id));
  const unknownDefectRefs=w.watchers.flatMap(x=>(x.historical||[]).filter(id=>!knownDefectIds.has(id)).map(id=>x.id+':'+id));
  const currentOptions=optionNames();
  const baseOptions=new Set(b.options.map(o=>o.name));
  const newOptions=currentOptions.filter(o=>!baseOptions.has(o));
  const unassignedModules=sourceInventory.filter(m=>!watchSources.has(m.module) && !w.watchers.some(x=>x.id==='all-source-modules')).map(m=>m.module);
  const missingBaselineSymbols=[...baseKeys].filter(x=>!currentKeys.has(x));
  const releaseVersion=fs.readFileSync(path.join(ROOT,'hapi_enterprise','config.yaml'),'utf8').match(/^version:\s*["']?([^"'\s]+)/m)?.[1]||'unknown';
  const errors=[];
  if(d.defects.length<46 || r.releases.length<222) errors.push('Historical protocol incomplete');
  if(w.watchers.length<14 || c.candidates.length<7) errors.push('Watch/cache protocol incomplete');
  if(unknownDefectRefs.length) errors.push('Unknown defect references: '+unknownDefectRefs.join(','));
  if(unassignedModules.length) errors.push('Unassigned source modules: '+unassignedModules.slice(0,5).join(','));
  for(const [surface, langs] of Object.entries({guardian:languages.guardian,admin:languages.admin,portal:languages.portal,integration:languages.integration})){
    for(const [lang,result] of Object.entries(langs)) if(result && typeof result==='object'){
      for(const field of ['missing','extra','placeholderMismatch']){
        if(result[field]?.length) errors.push(surface+'.'+lang+'.'+field+': '+result[field].slice(0,8).join(','));
      }
    }
  }
  for(const lang of ['bg','en'])if(languages.addon[lang].missing.length) errors.push('addon '+lang+' missing: '+languages.addon[lang].missing.join(','));
  return {schemaVersion:1,currentVersion:releaseVersion,baselineVersion:b.baselineVersion,
    historic:{releaseNotes:r.releases.length,defects:d.defects.length,openDefects:d.defects.filter(x=>x.state==='open').map(x=>x.id)},
    functions:{baseline:b.functionCount,current:actualModules.reduce((n,m)=>n+m.functions.filter(f=>f.kind==='функция').length,0),
      newlyDiscovered:[...currentKeys].filter(x=>!baseKeys.has(x)),historicallyRemoved:missingBaselineSymbols},
    options:{current:currentOptions.length,baseline:b.optionCount,newOptions,removed:b.options.map(x=>x.name).filter(x=>!currentOptions.includes(x))},
    source:{modules:sourceInventory.length,namedSymbols:sourceInventory.reduce((n,m)=>n+m.namedSymbols.length,0),
      unassignedModules,newModuleNames:sourceInventory.filter(m=>!b.modules.some(x=>x.module===m.module)).map(m=>m.module)},
    cache:{candidates:c.candidates.length,measurementStatus:'not-measured; no cache auto-enabled'},
    languages,errors};
}
function main(){
  const report=protocolAudit();
  if(process.argv.includes('--write-report')){
    const out=path.join(ROOT,'reports','GUARDIAN-PROTOCOL-AUDIT.json');
    fs.mkdirSync(path.dirname(out),{recursive:true});
    fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
    console.log('Written '+out);
  }
  if(process.argv.includes('--json')) console.log(JSON.stringify(report,null,2));
  else console.log('Guardian: '+report.historic.releaseNotes+' release sections; '+report.historic.defects+
      ' defects; '+report.functions.current+' exported functions; '+report.source.modules+
      ' source modules; '+report.options.current+' options; '+report.cache.candidates+
      ' cache candidates; '+report.errors.length+' protocol errors');
  if(process.argv.includes('--check') && report.errors.length) {
    for(const error of report.errors) console.error('GUARDIAN_PROTOCOL_ERROR: '+error);
    process.exitCode=1;
  }
}
if(require.main===module)main();
module.exports={protocolAudit,languageAudit,optionNames,walkSource};
