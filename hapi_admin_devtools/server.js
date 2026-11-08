'use strict';
// Separate privileged HA Ingress add-on. No API that applies repairs, installs builds,
// changes hAPI, or restarts Home Assistant is exposed by this first release.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const identity=require('./identity');
const DATA=process.env.HAPI_DEVTOOLS_DATA||'/data';
const OPTIONS=process.env.HAPI_DEVTOOLS_OPTIONS||path.join(DATA,'options.json');
const ENROLLMENT=path.join(DATA,'enrollment.json');
const PORT=Number(process.env.PORT||8099);
const pending=new Map();
const MAX_POST_BYTES=20000;
function readOptions(){try{return JSON.parse(fs.readFileSync(OPTIONS,'utf8'))}catch{return {}}}
function safeLoadEnrollment(){
  if(!identity.validateOptions(readOptions()))return false;
  try {
    const stat=fs.statSync(ENROLLMENT);
    if(stat.size>20000)return false;
    const record=JSON.parse(fs.readFileSync(ENROLLMENT,'utf8'));
    return record.fingerprint===identity.EXPECTED_FINGERPRINT &&
      record.username===identity.GITHUB_USER &&
      record.challenge.endsWith('fp='+identity.EXPECTED_FINGERPRINT+'\n') &&
      identity.verifySignature(record.challenge,record.signature);
  }catch{return false}
}
let unlocked=safeLoadEnrollment();
function ingressPeer(req) {
  const remote=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
  return remote==='172.30.32.2' ||
    (process.env.NODE_ENV==='test' && (remote==='127.0.0.1'||remote==='::1'));
}
function answer(res,status,obj,extra={}){
  const body=JSON.stringify(obj);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra});
  res.end(body);
}
function html(res,name,type){
  const source=fs.readFileSync(path.join(__dirname,name));
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN',
    'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'self'"});
  res.end(source);
}
async function readBody(req){
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0;
    req.on('data',chunk=>{
      size+=chunk.length;
      if(size>MAX_POST_BYTES){reject(Error('BODY_TOO_LARGE'));req.destroy();return}
      chunks.push(chunk);
    });
    req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(Error('INVALID_JSON'))}});
    req.on('error',reject);
  });
}
function records(){
  const out={};
  for(const name of ['historical-defects','release-history','release-risk-index','watch-contracts','cache-optimization','standards','recovery-lifecycle','language-sync','function-option-baseline']){
    try{
      const body=JSON.parse(fs.readFileSync(path.join(__dirname,'protocols',name+'.json'),'utf8'));
      out[name]={available:true,items:body.count??body.releaseSections??body.moduleCount??body.watchers?.length??body.candidates?.length??body.standards?.length??null};
    }catch{out[name]={available:false,items:null}}
  }
  return out;
}
async function hapiReadiness(){
  return new Promise(resolve=>{
    const req=http.get({host:'hapi_enterprise',port:8099,path:'/ready',timeout:2500,agent:false},
      res=>{
        let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>2000)req.destroy()});
        res.on('end',()=>resolve({reachable:true,httpStatus:res.statusCode,ready:res.statusCode===200}));
      });
    req.on('timeout',()=>req.destroy());
    req.on('error',()=>resolve({reachable:false,httpStatus:null,ready:null}));
  });
}
function createServer() {
  return http.createServer(async(req,res)=>{
    try {
      if(!ingressPeer(req))return answer(res,403,{error:'INGRESS_ONLY'});
      const url=new URL(req.url,'http://localhost');
      const route=url.pathname.replace(/\/+$/,'')||'/';
      if(req.method==='GET'&&route==='/health')
        return answer(res,200,{running:true,activated:unlocked&&identity.validateOptions(readOptions())});
      if(req.method==='GET'&&route==='/')return html(res,'dashboard.html','text/html; charset=utf-8');
      if(req.method==='GET'&&route==='/dashboard.js')return html(res,'dashboard.js','text/javascript; charset=utf-8');
      if(req.method==='GET'&&route==='/dashboard.css')return html(res,'dashboard.css','text/css; charset=utf-8');
      const eligible=identity.validateOptions(readOptions());
      if(req.method==='GET'&&route==='/api/status')
        return answer(res,200,{configured:eligible,activated:eligible&&unlocked,
          mode:eligible&&unlocked?'verified':'locked',fingerprint:identity.EXPECTED_FINGERPRINT,
          username:identity.GITHUB_USER});
      if(!eligible)return answer(res,423,{error:'SSH_FINGERPRINT_NOT_CONFIGURED'});
      if(req.method==='POST'&&route==='/api/challenge'){
        // Proof requires GitHub to publish the exact pinned public key now.
        if(!await identity.githubKeys())return answer(res,403,{error:'PUBLIC_KEY_NOT_REGISTERED_ON_GITHUB'});
        const challenge=identity.newChallenge(),id=crypto.randomBytes(16).toString('hex');
        pending.clear();pending.set(id,{challenge,until:Date.now()+300000});
        return answer(res,200,{id,challenge,expiresSeconds:300});
      }
      if(req.method==='POST'&&route==='/api/enroll'){
        const body=await readBody(req);
        const pendingChallenge=pending.get(body.id);
        if(!pendingChallenge||Date.now()>pendingChallenge.until)
          return answer(res,403,{error:'CHALLENGE_EXPIRED'});
        pending.delete(body.id);
        if(!await identity.githubKeys())return answer(res,403,{error:'PUBLIC_KEY_NOT_REGISTERED_ON_GITHUB'});
        if(!identity.verifySignature(pendingChallenge.challenge,body.signature))
          return answer(res,403,{error:'SSH_SIGNATURE_INVALID'});
        fs.mkdirSync(DATA,{recursive:true,mode:0o700});
        const record={username:identity.GITHUB_USER,fingerprint:identity.EXPECTED_FINGERPRINT,
          challenge:pendingChallenge.challenge,signature:body.signature,verifiedAt:new Date().toISOString()};
        const tmp=ENROLLMENT+'.tmp';
        fs.writeFileSync(tmp,JSON.stringify(record),{mode:0o600});
        fs.renameSync(tmp,ENROLLMENT);
        unlocked=true;
        return answer(res,200,{activated:true});
      }
      if(!unlocked)return answer(res,423,{error:'SSH_SIGNED_ENROLLMENT_REQUIRED'});
      if(req.method==='GET'&&route==='/api/overview')
        return answer(res,200,{identity:{githubUsername:identity.GITHUB_USER,
          fingerprint:identity.EXPECTED_FINGERPRINT,verified:true},
          modules:records(),hapi:await hapiReadiness(),
          mode:'read-only',automaticRepairsEnabled:false,applyEnabled:false});
      return answer(res,404,{error:'NOT_FOUND'});
    }catch(error){
      const cause=String(error.message||'').startsWith('GITHUB_')?'GITHUB_IDENTITY_CHECK_UNAVAILABLE':'REQUEST_FAILED';
      return answer(res,503,{error:cause});
    }
  });
}
if(require.main===module)createServer().listen(PORT,'0.0.0.0',
  ()=>console.log('hAPI Admin DevTools ingress ready; activation '+(unlocked?'verified':'locked')));
module.exports={createServer,records};
