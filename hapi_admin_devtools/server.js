'use strict';
// OpenPGP-gated, independent Home Assistant administrator add-on.
// Existing HA SSH access is NOT a factor in OpenPGP verification.
// No repository mutation or deployment until a separately authorized, tested workflow exists.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {DEFINITIONS,getRuntimeConfig}=require('./definitions');
const CONFIG=getRuntimeConfig();
const identity=require('./identity');
const githubVerification=require('./github-verification');
const releaseGate=require('./release-gate');
const ciEvidence=require('./github-actions-evidence');
const {createMonitor}=require('./monitor');
const director=require('./ai/director');
const {inventory:developmentInventory}=require('./ai/workload');
const operatingModes=require('./ai/operating-modes');
const dynamicAnalysis=require('./ai/dynamic-analysis');
const functionCoverage=require('./ai/function-coverage');
const DATA=CONFIG.dataDir;
const OPTIONS=CONFIG.optionsPath;
const ENROLLMENT=CONFIG.enrollmentPath;
const PORT=CONFIG.ingressPort;
const MAX_POST_BYTES=DEFINITIONS.limits.requestBodyBytes;
const pending=new Map();
function readOptions(){try{return JSON.parse(fs.readFileSync(OPTIONS,'utf8'))}catch{return {}}}
function enrolledRecord(options){
  const expected=identity.normalizeFingerprint(options.openpgp_fingerprint);
  if(!identity.validateOptions(options))return null;
  try{
    if(fs.statSync(ENROLLMENT).size>DEFINITIONS.limits.enrollmentBytes)return null;
    const rec=JSON.parse(fs.readFileSync(ENROLLMENT,'utf8'));
    if(rec.username!==identity.GITHUB_USER||rec.fingerprint!==expected ||
       rec.challenge?.endsWith('fp='+expected+'\n')!==true ||
       typeof rec.publicKey!=='string')return null;
    if(!identity.verifyDetached({challenge:rec.challenge,signature:rec.signature,
      expectedFingerprint:expected,publicKey:Buffer.from(rec.publicKey,'base64')}))return null;
    return rec;
  }catch{return null;}
}
let unlocked=!!enrolledRecord(readOptions());
let dynamicAnalyzer=null;
try {
  const options=readOptions();
  if(options.dynamic_monitor_enabled!==false) {
    const intervalMinutes=operatingModes.parseInterval(
      options.dynamic_analysis_interval_minutes??operatingModes.DYNAMIC.defaultAnalysisIntervalMinutes);
    dynamicAnalyzer=dynamicAnalysis.createDynamicAnalyzer(
      path.join(DATA,'dynamic'),{intervalMinutes});
  }
} catch(error){
  // Wrong configuration fails closed for dynamic analysis without stopping
  // the protected admin ingress and original monitor.
  console.error('DEVTOOLS_DYNAMIC_CONFIG_INVALID:',error.code||error.message);
}
const monitor=createMonitor(path.join(DATA,'monitor'),{
  onSample:observation=>{
    if(unlocked&&dynamicAnalyzer)dynamicAnalyzer.sample(observation);
  }
});
if(unlocked){
  monitor.start();
  dynamicAnalyzer?.start();
}
function ingressPeer(req){
  const remote=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
  return remote===DEFINITIONS.transport.ingressProxyAddress ||
    (process.env.NODE_ENV==='test'&&(remote==='127.0.0.1'||remote==='::1'));
}
function answer(res,status,obj){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  res.end(JSON.stringify(obj));
}
function asset(res,name,type){
  const source=fs.readFileSync(path.join(__dirname,name));
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN',
    'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'self'"});
  res.end(source);
}
function readBody(req){
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0;
    req.on('data',chunk=>{
      size+=chunk.length;
      if(size>MAX_POST_BYTES){reject(Error('BODY_TOO_LARGE'));req.destroy();return;}
      chunks.push(chunk);
    });
    req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(Error('INVALID_JSON'));}});
    req.on('error',reject);
  });
}
function records(){
  const out={};
  for(const name of ['historical-defects','release-history','release-risk-index','watch-contracts',
    'cache-optimization','standards','recovery-lifecycle','language-sync','function-option-baseline']){
    try{
      const body=JSON.parse(fs.readFileSync(path.join(__dirname,'protocols',name+'.json'),'utf8'));
      out[name]={available:true,items:body.count??body.releaseSections??body.moduleCount??
        body.watchers?.length??body.candidates?.length??body.standards?.length??null};
    }catch{out[name]={available:false,items:null};}
  }
  return out;
}
async function hapiReadiness(){
  return new Promise(resolve=>{
    const req=http.get({host:DEFINITIONS.transport.enterpriseHostname,port:DEFINITIONS.transport.enterprisePort,path:DEFINITIONS.enterprise.healthPath,timeout:DEFINITIONS.limits.hapiProbeTimeoutMs,agent:false},res=>{
      let count=0;
      res.on('data',chunk=>{count+=chunk.length;if(count>2000)req.destroy();});
      res.on('end',()=>resolve({reachable:true,httpStatus:res.statusCode,ready:res.statusCode===200}));
    });
    req.on('timeout',()=>req.destroy());
    req.on('error',()=>resolve({reachable:false,httpStatus:null,ready:null}));
  });
}
function createServer(){
  return http.createServer(async(req,res)=>{
    try{
      if(!ingressPeer(req))return answer(res,403,{error:'INGRESS_ONLY'});
      const route=(new URL(req.url,'http://localhost').pathname.replace(/\/+$/,'')||'/');
      if(req.method==='GET'&&route==='/health')
        return answer(res,200,{running:true,activated:unlocked&&identity.validateOptions(readOptions())});
      if(req.method==='GET'&&route==='/')return asset(res,'dashboard.html','text/html; charset=utf-8');
      if(req.method==='GET'&&route==='/dashboard.js')return asset(res,'dashboard.js','text/javascript; charset=utf-8');
      if(req.method==='GET'&&route==='/dashboard.css')return asset(res,'dashboard.css','text/css; charset=utf-8');
      const options=readOptions(),eligible=identity.validateOptions(options);
      const expected=identity.normalizeFingerprint(options.openpgp_fingerprint);
      if(req.method==='GET'&&route==='/api/status')
        return answer(res,200,{configured:eligible,activated:eligible&&unlocked,
          mode:eligible&&unlocked?'verified':'locked',fingerprint:expected,
          keyId:identity.REGISTERED_GPG_KEY_ID,username:identity.GITHUB_USER,
          authentication:'OpenPGP detached signature'});
      if(!eligible)return answer(res,423,{error:'OPENPGP_FINGERPRINT_NOT_CONFIGURED'});
      if(req.method==='POST'&&route==='/api/challenge'){
        const publicKey=await identity.fetchGithubPublicKey();
        // Check the public certificate against the selected full primary fingerprint,
        // not only its short GitHub key ID or an SSH fingerprint.
        if(!identity.verifyPublicCertificate(publicKey,expected))
          return answer(res,403,{error:'GITHUB_OPENPGP_KEY_MISMATCH'});
        const challenge=identity.newChallenge(expected);
        const id=crypto.randomBytes(16).toString('hex');
        pending.clear();
        pending.set(id,{challenge,publicKey:publicKey.toString('base64'),fingerprint:expected,
          until:Date.now()+DEFINITIONS.limits.challengeExpiryMs});
        return answer(res,200,{id,challenge,expiresSeconds:DEFINITIONS.limits.challengeExpiryMs/1000});
      }
      if(req.method==='POST'&&route==='/api/enroll'){
        const body=await readBody(req),entry=pending.get(body.id);
        if(!entry||Date.now()>entry.until||entry.fingerprint!==expected)
          return answer(res,403,{error:'CHALLENGE_EXPIRED'});
        pending.delete(body.id);
        // Recheck GitHub's current published public key before granting privilege.
        const currentPublicKey=await identity.fetchGithubPublicKey();
        if(!identity.verifyPublicCertificate(currentPublicKey,expected))
          return answer(res,403,{error:'GITHUB_OPENPGP_KEY_MISMATCH'});
        if(!identity.verifyDetached({challenge:entry.challenge,signature:body.signature,
          expectedFingerprint:expected,publicKey:currentPublicKey}))
          return answer(res,403,{error:'OPENPGP_SIGNATURE_INVALID'});
        fs.mkdirSync(DATA,{recursive:true,mode:0o700});
        const rec={username:identity.GITHUB_USER,fingerprint:expected,
          challenge:entry.challenge,signature:body.signature,
          publicKey:currentPublicKey.toString('base64'),verifiedAt:new Date().toISOString()};
        const tmp=ENROLLMENT+'.tmp';
        fs.writeFileSync(tmp,JSON.stringify(rec),{mode:0o600});
        fs.renameSync(tmp,ENROLLMENT);
        unlocked=true;
        monitor.start();
        dynamicAnalyzer?.start();
        return answer(res,200,{activated:true});
      }
      if(!unlocked)return answer(res,423,{error:'OPENPGP_SIGNED_ENROLLMENT_REQUIRED'});
      if(req.method==='GET'&&route==='/api/verify-commit'){
        const sha=new URL(req.url,'http://localhost').searchParams.get('sha');
        if(!/^[0-9a-f]{40}$/.test(sha||''))return answer(res,400,{error:'INVALID_COMMIT_SHA'});
        return answer(res,200,await githubVerification.auditCommit(sha,expected));
      }
      if(req.method==='GET'&&route==='/api/ci-evidence'){
        const query=new URL(req.url,'http://localhost').searchParams;
        const sha=query.get('sha');
        const firstId=Number(query.get('first'));
        const secondId=Number(query.get('second'));
        if(!/^[a-f0-9]{40}$/.test(sha||'')||!Number.isSafeInteger(firstId)||firstId<=0||
           !Number.isSafeInteger(secondId)||secondId<=0||firstId===secondId)
          return answer(res,400,{error:'INVALID_CI_RUN_INPUT'});
        return answer(res,200,await ciEvidence.inspectTwoRuns({sha,firstId,secondId}));
      }
      if(req.method==='GET'&&route==='/api/work-modes')
        return answer(res,200,{static:operatingModes.STATIC,dynamic:operatingModes.DYNAMIC,
          improvementCategories:operatingModes.IMPROVEMENTS,
          dynamicStatus:dynamicAnalyzer?.status()||{mode:'dynamic',analysisEnabled:false}});
      if(req.method==='GET'&&route==='/api/dynamic/status')
        return answer(res,200,dynamicAnalyzer?.status()||
          {mode:'dynamic',analysisEnabled:false,reason:'DYNAMIC_MONITOR_DISABLED'});
      if(req.method==='GET'&&route==='/api/dynamic/findings')
        return answer(res,200,{mode:'dynamic',
          analyses:dynamicAnalyzer?.readRecent()||[],
          findingsAreProposals:true,automaticFixes:false});
      if(req.method==='GET'&&route==='/api/dynamic/coverage'){
        const catalog=functionCoverage.inventory();
        return answer(res,200,{schemaVersion:catalog.schemaVersion,baselineVersion:catalog.baselineVersion,
          listedFunctions:catalog.listed,liveInstrumented:catalog.liveInstrumented,
          unobserved:catalog.unobserved,
          note:'Static historic catalog, not proof of function runtime monitoring. Only /ready is currently probed.',
          functions:catalog.functions.map(x=>({id:x.id,module:x.module,name:x.name,
            domain:x.domain,coverage:x.coverage}))});
      }
      if(req.method==='GET'&&route==='/api/director/hierarchy')
        return answer(res,200,{...director.hierarchy,mode:'director-led',aiRuntime:'optional-not-activated',
          deploymentAuthority:'external-controller-required'});
      if(req.method==='GET'&&route==='/api/director/backlog'){
        const backlog=developmentInventory();
        return answer(res,200,{...backlog,tasks:backlog.tasks.map(({id,title,category,owner,
          risk,status,source,evidenceLevel})=>({id,title,category,owner,risk,status,source,evidenceLevel}))});
      }
      if(req.method==='POST'&&route==='/api/director/plan'){
        const input=await readBody(req);
        if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.title!=='string'||
           input.title.trim().length===0||input.title.length>240)
           return answer(res,400,{error:'INVALID_DEVELOPMENT_TASK'});
        return answer(res,200,{...director.buildPlan(input),aiStatus:'not-run',
          executionStatus:'analysis-only',releaseAuthorized:false});
      }
      if(req.method==='POST'&&route==='/api/director/analyze'){
        // No AI credentials or model calls until the worker has its own installed,
        // tested SDK dependency and opt-in secret management.
        return answer(res,423,{error:'AI_WORKER_NOT_CONFIGURED',
          required:['tested-sdk-runtime','explicit-ai-opt-in','credential-vault','cost-budget']});
      }
      if(req.method==='GET'&&route==='/api/release-policy')
        return answer(res,200,{repository:releaseGate.REPO,
          requiredPhases:['unit','integration','regression','integrity','rollback'],
          dualIndependentCI:true,openpgpSignedIntent:true,
          protectedEnvironment:true,scopedGitHubAppPermission:true,
          backupAndExternalRollback:true,applyAvailable:false,
          publishAvailable:false,releaseWorkflowStatus:'not-connected'});
      if(req.method==='GET'&&route==='/api/overview')
        return answer(res,200,{identity:{githubUsername:identity.GITHUB_USER,
          fingerprint:expected,verified:true,method:'OpenPGP'},
          modules:records(),hapi:await hapiReadiness(),monitor:monitor.snapshot(),
          mode:'read-only',automaticRepairsEnabled:false,applyEnabled:false,
          githubReleaseActions:'not-enabled-until-separate-approved-workflow'});
      return answer(res,404,{error:'NOT_FOUND'});
    }catch(error){
      const msg=String(error.message||'');
      return answer(res,503,{error:msg.startsWith('GITHUB_')?'GITHUB_IDENTITY_CHECK_UNAVAILABLE':'REQUEST_FAILED'});
    }
  });
}
if(require.main===module)createServer().listen(PORT,'0.0.0.0',
  ()=>console.log('hAPI Admin DevTools ingress ready; OpenPGP activation '+(unlocked?'verified':'locked')));
module.exports={createServer,records};
