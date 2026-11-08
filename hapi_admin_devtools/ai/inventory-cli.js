'use strict';
/**
 * CI-only automatic project-development inventory.
 * Reads known protocol baselines and changed filenames; produces deterministic
 * classifications. This action never calls an AI API or edits a repository.
 */
const fs=require('node:fs');
const {classify,fingerprintTask}=require('./director');
const {inventory}=require('./workload');
function inspectChangedPaths(paths){
  if(!Array.isArray(paths)||paths.length>5000)throw Error('CHANGED_FILE_LIMIT');
  const byOwner=new Map();
  for(const original of paths){
    if(typeof original!=='string'||original.length>400||original.includes('\0'))continue;
    const file=original.replace(/\\/g,'/').trim();
    if(!file||file.startsWith('/')||file.includes('..'))continue;
    const target=file.startsWith('hapi_enterprise/')?'enterprise':
      file.startsWith('hapi_admin_devtools/')?'devtools':
      file.startsWith('custom_components/')?'integration':
      file.startsWith('.github/')?'ci':
      'unknown';
    const item=classify({title:'Review changed module '+file,files:[file],target});
    const key=item.category+':'+item.owner+':'+item.target;
    if(!byOwner.has(key))byOwner.set(key,{category:item.category,owner:item.owner,
      target:item.target,risk:item.risk,files:[]});
    byOwner.get(key).files.push(file);
  }
  return [...byOwner.values()].sort((a,b)=>a.category.localeCompare(b.category))
    .map(g=>({...g,files:g.files.sort(),taskFingerprint:fingerprintTask({
      title:'Review changed '+g.category+' modules',files:g.files,target:g.target}),
      status:'categorized',automation:'analysis-only'}));
}
function buildReport(changed=[]){
  const baseline=inventory();
  return {
    schemaVersion:1,
    reportType:'hapi-devtools-director-ci-inventory',
    authority:'hAPI-DEV AI Development Director',
    generatedAt:new Date().toISOString(),
    historicalTasks:baseline.total,
    categories:baseline.categories,
    changedModules:inspectChangedPaths(changed),
    changedModuleCount:changed.length,
    permissions:{analyse:true,plan:true,writeRepository:false,release:false,deploy:false},
    sdkExecution:'not-triggered-from-ci',
    provenance:'Deterministic path and protocol categorization, not AI-generated findings'
  };
}
if(require.main===module){
  const i=process.argv.indexOf('--changed-files');
  let paths=[];
  if(i>=0){
    const arg=process.argv[i+1];
    if(!arg)throw Error('MISSING_CHANGED_FILES_PATH');
    paths=fs.readFileSync(arg,'utf8').split(/\r?\n/).filter(Boolean);
  }
  process.stdout.write(JSON.stringify(buildReport(paths),null,2)+'\n');
}
module.exports={inspectChangedPaths,buildReport};
