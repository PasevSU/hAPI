'use strict';
const http=require('node:http'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(process.env.DATA_DIR||'/data'),port=Number(process.env.PORT||8099),adminToken=process.env.ADMIN_TOKEN;
const ingressMode=process.env.INGRESS_MODE==='true',adminPort=Number(process.env.ADMIN_PORT||8098),adminBindHost=process.env.ADMIN_BIND_HOST||'0.0.0.0';
const runtime=require('./runtime-config').create(root);const eff=runtime.effective();const requirePortalToken=eff.requirePortalToken;
const publicHost=process.env.PUBLIC_BIND_HOST||'127.0.0.1';
const corsOrigin=eff.corsOrigin;
if(!adminToken||adminToken.length<24||adminToken==='CHANGE_TO_RANDOM_SECRET_AT_LEAST_24_CHARACTERS'||/^(.{1,8})\1{3,}$/.test(adminToken)) {console.error('ADMIN_TOKEN must be a unique random secret (at least 24 characters), not the default placeholder');process.exit(1)}
const jobManager=require('./job-manager').create({dir:path.join(root,'jobs'),concurrency:eff.maxJobs,resolveHandler:(type,params)=>{
 if(type!=='integrity-scan')throw Error('Unknown job type');
 const portalId=params&&params.portalId;
 return async ctx=>{const current=db.portals.find(x=>x.id===portalId);if(!current)throw Object.assign(new Error('Portal removed'),{status:404});const out=await verifyPortalFiles(current,ctx);if(!ctx.signal.aborted)void audit('integrity.verify',{portalId,summary:out.summary,job:true});return out};
}});
const operatorToken=process.env.OPERATOR_TOKEN||null,viewerToken=process.env.VIEWER_TOKEN||null;
const parseRoles=v=>{if(!v)return{};if(typeof v==='object'&&!Array.isArray(v))return v;try{const o=JSON.parse(v);if(!o||typeof o!=='object'||Array.isArray(o))return{};return o}catch{return{}}};
// Роли за Ingress потребители: env (USER_ROLES) или опции на add-on-а (user_roles).
const addonOptions=(()=>{try{return JSON.parse(fs.readFileSync(process.env.OPTIONS_PATH||'/data/options.json','utf8'))||{}}catch{return{}}})();
const rbac=require('./rbac').create({adminToken,operatorToken,viewerToken,userRoles:parseRoles(process.env.USER_ROLES||addonOptions.user_roles),groupRoles:parseRoles(process.env.GROUP_ROLES||addonOptions.group_roles)});
const errorLog=require('./error-log').create(root);
const configProfiles=require('./config-profiles').create(root);
const storageCheck=require('./storage-check');
const apiVersion=require('./api-version');
const signer=require('./signer');
const pgp=require('./pgp');
const packager=require('./packager').create({root});
const fileCrypto=require('./file-crypto');
const preview=require('./preview').create();
const versioning=require('./versioning').create();
const notify=require('./notify').create();
async function verifyPortalFiles(p,ctx){
 const results=[];ctx.setTotal(p.files.length);
 for(const f of [...p.files]){
  if(ctx.signal.aborted)break;
  if(ctx.throwIfPaused)ctx.throwIfPaused();
  const filePath=path.join(filesRoot,p.id,f.id);let actual=null,status='MISSING';
  try{const stat=await fsp.lstat(filePath);if(stat.isFile()){
   if(f.encrypted){const plain=fileCrypto.decrypt(fs.readFileSync(filePath),adminToken);actual=crypto.createHash('sha256').update(plain).digest('hex');status=actual===f.sha256&&plain.length===f.size?'VERIFIED':'MISMATCH';}
   else{const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(filePath)){if(ctx.signal.aborted)break;hash.update(chunk)}
   if(ctx.signal.aborted)break;
   actual=hash.digest('hex');status=actual===f.sha256&&stat.size===f.size?'VERIFIED':'MISMATCH';}
  }else status='INVALID_TYPE';}catch(e){if(e.code!=='ENOENT')status='ERROR'}
  results.push({fileId:f.id,name:f.name,expectedSha256:f.sha256,actualSha256:actual,status});ctx.advance();
 }
 const summary={VERIFIED:0,MISMATCH:0,MISSING:0,INVALID_TYPE:0,ERROR:0};for(const r of results)summary[r.status]++;
 return {portalId:p.id,summary,files:results,verified:summary.VERIFIED===results.length&&results.length===p.files.length};
}
const dbPath=runtime.databasePath,filesRoot=path.join(root,'files'),internalRoot=path.join(root,'internal');let db={portals:[],qrArtifacts:[]};let queue=Promise.resolve();const metadataStore=require('./sqlite-store').open(dbPath);
const id=()=>crypto.randomBytes(12).toString('hex');
// --- DOCFLOW core (Phase 1): hierarchical variable store, additive to legacy metadata ---
const coreDbId=(()=>{const v=String(process.env.DB_ID||'1').trim();return /^[A-Za-z0-9_-]{1,32}$/.test(v)?v:'1'})();
const profilesConfig=(()=>{const s=String(process.env.PROFILES||'').trim();if(!s)return null;try{const o=JSON.parse(s);return o&&typeof o==='object'&&!Array.isArray(o)?o:null}catch{return null}})();
let docflowRegistry=null,coreStore=null;
try{docflowRegistry=require('./registry').create(profilesConfig);coreStore=require('./core-store').create({path:path.join(root,'core.sqlite'),dbId:coreDbId,secret:adminToken});}catch(e){console.error('DOCFLOW CORE INIT FAILED',e.message)}
const coreReady=()=>{if(!docflowRegistry||!coreStore)throw Object.assign(new Error('Core unavailable'),{status:503});return {registry:docflowRegistry,store:coreStore}};
const backupsDir=(()=>{const v=String(process.env.BACKUP_DIR||'').trim();if(!v)return path.join(root,'backups');const abs=path.isAbsolute(v)?path.resolve(v):path.resolve('/share',v);if(!['/share','/media','/backup','/config','/addon_config','/data'].some(p=>abs===p||abs.startsWith(p+'/'))&&!process.env.BACKUP_DIR_ANY)throw Error('backup_folder must be inside /share, /media, /backup or /config');return abs})();
const auditChain=require('./audit-chain').createAuditChain(root);
const scopesAllowed=['read','download'];
const htmlProjectsRoot=path.join(root,'html-projects');
const accessModes=['FREE','KEY_REQUIRED','DISABLED'];
const fileMode=f=>f.accessMode||'FREE';
const validExpiry=v=>v===null||typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)>Date.now();
const tokenMatch=(items,secret)=>{if(!secret)return false;const digest=keyDigest(secret);return (items||[]).some(k=>safeEqual(k.hash,digest)&&(!k.expiresAt||Date.parse(k.expiresAt)>Date.now()));};
const auditPath=path.join(root,'audit.jsonl');
const retention=require('./retention').create({filesRoot,auditPath,getSettings:()=>runtime.settings});
const audit=(event,details={})=>{void auditChain.append(event,details).catch(e=>console.error('AUDIT CHAIN FAILURE',e));return fsp.appendFile(auditPath,JSON.stringify({at:new Date().toISOString(),event,...details})+'\n',{mode:0o600}).catch(e=>console.error('AUDIT FAILURE',e))};
const counters={requests:0,errors:0,downloads:0};
const telemetryFile=path.join(root,'telemetry.jsonl');
const telemetry={visits:0,downloads:0,byPortal:{},byFile:{},byToken:{},ratings:{},recent:[]};
const rawIpEnabled=eff.storeRawIp;
const visitorIp=req=>{const raw=req.socket.remoteAddress||'unknown';return rawIpEnabled?raw:crypto.createHash('sha256').update(adminToken+':'+raw).digest('hex').slice(0,20)};
const tokenId=(req,url)=>{const secret=(req.headers.authorization||'').replace(/^Bearer /i,'')||(url&&url.searchParams.get('portal_token'))||'';return secret?keyDigest(secret).slice(0,16):'anonymous'};
let telemetryQueue=Promise.resolve();
function recordTelemetry(event,req,p,f,url,extra={}){
 const entry={at:new Date().toISOString(),event,portalId:p.id,fileId:f?.id||null,tokenId:tokenId(req,url),visitor:visitorIp(req),...extra};
 telemetryQueue=telemetryQueue.then(()=>fsp.appendFile(telemetryFile,JSON.stringify(entry)+'\n',{mode:0o600})).catch(e=>console.error('TELEMETRY WRITE FAILED',e.code||e.message));
 applyTelemetry(entry);return telemetryQueue;
}
function applyTelemetry(e){
 if(e.event==='visit')telemetry.visits++;
 if(e.event==='download')telemetry.downloads++;
 const portal=telemetry.byPortal[e.portalId]??={visits:0,downloads:0};
 if(e.event==='visit')portal.visits++;
 if(e.event==='download')portal.downloads++;
 const token=telemetry.byToken[e.tokenId]??={visits:0,downloads:0};
 if(e.event==='visit')token.visits++;
 if(e.event==='download')token.downloads++;
 if(e.fileId){const file=telemetry.byFile[e.fileId]??={downloads:0};if(e.event==='download')file.downloads++;
 if(e.event==='rating'){const rating=telemetry.ratings[e.fileId]??={count:0,sum:0};rating.count++;rating.sum+=e.stars;}}
 telemetry.recent.push(e);if(telemetry.recent.length>100)telemetry.recent.shift();
}

// A bounded number of active file streams prevents slow clients from exhausting
// file descriptors and memory. Streams use Node's native backpressure.
const maxDownloadStreams=eff.maxDownloadStreams;
const loadControl=require('./load-control').create({base:maxDownloadStreams,min:Math.max(1,Math.min(maxDownloadStreams,2))});
let activeDownloadStreams=0;
function streamDownload(req,res,fp,stat,name,onStart){
 loadControl.recalc(counters.requests);
 if(activeDownloadStreams>=loadControl.effective){res.setHeader('Retry-After','3');return fail(res,503,'Download capacity reached')}
 activeDownloadStreams++;
 let released=false;
 const release=()=>{if(!released){released=true;activeDownloadStreams--}};
 let start=0,end=stat.size-1,status=200;
 const rm=/^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range||''));
 if(rm&&(rm[1]||rm[2])&&stat.size>0){
  if(rm[1]===''){start=Math.max(0,stat.size-Number(rm[2]))}else{start=Number(rm[1]);if(rm[2]!=='')end=Math.min(end,Number(rm[2]))}
  if(start>end||start>=stat.size){release();res.writeHead(416,{'Content-Range':'bytes */'+stat.size});return res.end()}
  status=206;
 }
 const stream=fs.createReadStream(fp,stat.size?{highWaterMark:64*1024,start,end}:{highWaterMark:64*1024});
 stream.once('error',e=>{release();loadControl.recordError();void errorLog.append('error','download-stream',e.code||e.message);console.error('Download stream failed:',e.code||e.message);if(!res.headersSent)fail(res,500,'Download failed');else res.destroy(e)});
 stream.once('close',release);
 res.once('close',()=>{if(!stream.destroyed)stream.destroy();release()});
 const rh=status===206?{'Content-Range':'bytes '+start+'-'+end+'/'+stat.size}:{};
 res.writeHead(status,{...rh,'Accept-Ranges':'bytes','Content-Type':'application/octet-stream','Content-Length':end-start+1,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name.replace(/[\r\n]/g,'')),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 if(onStart)onStart();
 stream.pipe(res);
}
// Encrypted files cannot support byte-range requests (AES-GCM is not seekable), so the
// plaintext is decrypted into memory and served whole. Opt-in and intended for documents,
// not large media.
function serveEncryptedFile(req,res,fp,f,onStart){
 let buf;try{buf=fs.readFileSync(fp)}catch{return fail(res,404,'File unavailable')}
 let plain;try{plain=fileCrypto.decrypt(buf,adminToken)}catch(e){console.error('Encrypted file decrypt failed:',e.message);return fail(res,500,'Decryption failed')}
 res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':plain.length,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(f.name.replace(/[\r\n]/g,'')),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 if(onStart)onStart();
 res.end(plain);
}
// Reads a file's plaintext into memory (decrypting when stored encrypted).
// Returns null when the physical file is missing or undecryptable.
function readPlainBuffer(p,f){
 const fp=path.join(filesRoot,p.id,f.id);
 let buf;try{buf=fs.readFileSync(fp)}catch{return null}
 if(f.encrypted){try{return fileCrypto.decrypt(buf,adminToken)}catch{return null}}
 return buf;
}
const keyDigest=v=>crypto.createHash('sha256').update(v).digest('hex');
const safeEqual=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const SCRYPT={N:16384,r:8,p:1,maxmem:64*1024*1024};
const hashPassword=pw=>{const salt=crypto.randomBytes(16);const hash=crypto.scryptSync(pw,salt,64,SCRYPT);return 'scrypt$'+salt.toString('hex')+'$'+hash.toString('hex')};
const verifyPassword=(pw,stored)=>{const parts=String(stored||'').split('$');if(parts.length!==3||parts[0]!=='scrypt')return false;const salt=Buffer.from(parts[1],'hex'),expected=Buffer.from(parts[2],'hex');if(!salt.length||!expected.length)return false;return safeEqual(crypto.scryptSync(pw,salt,expected.length,SCRYPT),expected)};
const newSessionToken=()=>'pu_'+crypto.randomBytes(32).toString('base64url');
const normalizeScopes=scopes=>{if(scopes===undefined)return ['read','download'];if(!Array.isArray(scopes)||!scopes.length||scopes.some(s=>!scopesAllowed.includes(s)))throw Object.assign(new Error('Invalid scopes'),{status:400});return [...new Set(scopes)]};

// Backups are generated inside a fixed, private application directory.
// Never accept a user-supplied destination or expose its absolute path.
let backupQueue=Promise.resolve();
function updateBackup(){
 const job=backupQueue.then(async()=>{
  const dir=backupsDir;await fsp.mkdir(dir,{recursive:true,mode:0o700});
  if((await fsp.lstat(dir)).isSymbolicLink())throw Error('Unsafe backup directory');
  const name='metadata-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex')+'.sqlite';
  const destination=path.join(dir,name);
  try{
   const info=metadataStore.backup(destination);
   const digest=crypto.createHash('sha256');
   for await(const chunk of fs.createReadStream(destination))digest.update(chunk);
   return {name,bytes:info.bytes,sha256:digest.digest('hex'),createdAt:new Date().toISOString()};
  }catch(e){await fsp.rm(destination,{force:true}).catch(()=>{});throw e}
 });backupQueue=job.catch(()=>{});return job;
}
const DEFAULT_BACKUP_SCHEDULE={enabled:false,intervalMinutes:1440,maxBackups:10};
let backupScheduleTimer=null,backupScheduleNext=null;
async function listBackupFiles(){
 const dir=backupsDir;let entries=[];
 try{entries=(await fsp.readdir(dir)).filter(n=>n.endsWith('.sqlite'))}catch(e){if(e.code!=='ENOENT')throw e}
 const out=[];for(const name of entries){try{const st=await fsp.stat(path.join(dir,name));out.push({name,mtime:st.mtimeMs})}catch{}}
 out.sort((a,b)=>a.mtime-b.mtime);return out;
}
async function pruneBackups(maxKeep){
 if(!Number.isInteger(maxKeep)||maxKeep<1)return;
 const files=await listBackupFiles();if(files.length<=maxKeep)return;
 for(const f of files.slice(0,files.length-maxKeep))await fsp.rm(path.join(backupsDir,f.name),{force:true}).catch(()=>{});
}
function applyBackupSchedule(){
 if(backupScheduleTimer){clearInterval(backupScheduleTimer);backupScheduleTimer=null}
 backupScheduleNext=null;
 const s=runtime.settings.backupSchedule||DEFAULT_BACKUP_SCHEDULE;
 if(s&&s.enabled&&Number.isInteger(s.intervalMinutes)&&s.intervalMinutes>0){
  backupScheduleNext=Date.now()+s.intervalMinutes*60000;
  backupScheduleTimer=setInterval(()=>{void (async()=>{
   backupScheduleNext=Date.now()+s.intervalMinutes*60000;
   try{await updateBackup();await pruneBackups(s.maxBackups);void audit('backup.schedule.run',{maxBackups:s.maxBackups})}
   catch(e){void errorLog.append('error','backup-schedule',e&&e.message||'Scheduled backup failed')}
  })()},s.intervalMinutes*60000);
 }
}
const json=(res,status,obj,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(obj))};
const fail=(res,status,message)=>json(res,status,{error:message});
// Bounded authentication failures per peer. Never trust forwarded IP headers.
// The limit applies only to administrative API routes and does not lock out
// legitimate public downloads or the Home Assistant ingress UI.
const authFailures=new Map();
const AUTH_WINDOW_MS=60_000, AUTH_MAX_FAILURES=12;
function adminGate(req,res,capability,method){
 const peer=req.socket.remoteAddress||'unknown', now=Date.now();
 let state=authFailures.get(peer);
 if(state&&now-state.since>=AUTH_WINDOW_MS){authFailures.delete(peer);state=null}
 if(state&&state.count>=AUTH_MAX_FAILURES){
  res.setHeader('Retry-After',String(Math.max(1,Math.ceil((AUTH_WINDOW_MS-(now-state.since))/1000))));
  return fail(res,429,'Too many authentication attempts');
 }
 const role=rbac.resolve(req);
 if(role){
  authFailures.delete(peer);
  if(!rbac.allowed(role,capability||'*',method||req.method))return fail(res,403,'Insufficient role');
  return true;
 }
 if(!state){state={since:now,count:0};authFailures.set(peer,state)}
 state.count++;
 if(authFailures.size>4096){for(const [ip,v] of authFailures){if(now-v.since>=AUTH_WINDOW_MS)authFailures.delete(ip)}
  if(authFailures.size>4096)authFailures.delete(authFailures.keys().next().value)}
 fail(res,401,'Unauthorized');return false;
}
const loginFailures=new Map();
const LOGIN_WINDOW_MS=60_000, LOGIN_MAX_FAILURES=10;
function loginGate(req,res){
 const peer=req.socket.remoteAddress||'unknown', now=Date.now();
 let s=loginFailures.get(peer);
 if(s&&now-s.since>=LOGIN_WINDOW_MS){loginFailures.delete(peer);s=null}
 if(s&&s.count>=LOGIN_MAX_FAILURES){res.setHeader('Retry-After',String(Math.max(1,Math.ceil((LOGIN_WINDOW_MS-(now-s.since))/1000))));fail(res,429,'Too many login attempts');return false}
 return true;
}
function registerLoginFailure(req){const peer=req.socket.remoteAddress||'unknown',now=Date.now();let s=loginFailures.get(peer);if(!s||now-s.since>=LOGIN_WINDOW_MS){s={since:now,count:0};loginFailures.set(peer,s)}s.count++;if(loginFailures.size>4096)loginFailures.delete(loginFailures.keys().next().value)}
function clearLoginFailures(req){loginFailures.delete(req.socket.remoteAddress||'unknown')}
const clean=x=>typeof x==='string'?x.trim():'';
const htmlEsc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validSlug=x=>/^[a-z0-9][a-z0-9-]{0,62}$/.test(x);
const body=async(req,limit=65536)=>{let parts=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('Payload too large'),{status:413});parts.push(chunk)}return Buffer.concat(parts)};
const parse=async req=>{try{return JSON.parse((await body(req)).toString('utf8'))}catch(e){if(e.status)throw e;throw Object.assign(new Error('Invalid JSON'),{status:400})}};
const update=(fn,onFailure)=>{const run=queue.then(async()=>{
 const previous=structuredClone(db);let result;
 try{result=await fn();metadataStore.save(db);return result}
 catch(e){db=previous;if(result!==undefined&&onFailure){try{await onFailure(result)}catch(cleanupError){console.error('ROLLBACK CLEANUP FAILED',cleanupError)}}throw e}
 });queue=run.catch(()=>{});return run};
// Публичен контакт на издателя: само имена/канали за връзка (без вътрешни id и extras).
const publicContact=id=>{const c=contactById(db,id);if(!c)return null;const out={name:c.name,organization:c.organization,department:c.department,email:c.email,phone:c.phone,city:c.city,country:c.country};return Object.values(out).some(Boolean)?out:null};
// Публичният изглед на портала: това, което вижда landing страницата (QR кодът води там).
const publicPortal=p=>({id:p.id,slug:p.slug,title:p.title,description:p.description,notes:p.notesText||'',category:p.category||'',subject:p.subject||'',flag:p.flag||'none',storage_root:p.storage_root||'/share',visibility:p.visibility,branding:p.branding||{},createdAt:p.createdAt,
 // Броят е само на видимите файлове — скритите не се броят в публичния изглед.
 fileCount:p.files.filter(f=>f.listed!==false).length,
 contact:publicContact(p.contactId),
 urls:{landing:portalLandingUrl(p,''),api:portalApiUrl(p,''),manifest:portalApiUrl(p,'')+'/manifest',openapi:portalApiUrl(p,'')+'/openapi.json',qr:portalApiUrl(p,'')+'/qr.svg',
  // Какво точно кодира QR кодът — публичната страница, не JSON API-то.
  qrTarget:portalLandingUrl(p,'')}});
// Флаг на портала: само от фиксиран списък (иначе 'none').
const PORTAL_FLAGS=['none','info','important','urgent','archive'];
const portalFlag=v=>(PORTAL_FLAGS.includes(String(v||''))?String(v):'none');
// Папка с файлове: само под разрешените корени, без „..“ и контролни знаци.
const portalRoot=v=>{const s=String(v==null?'':v).trim();if(!s)return '/share';if(!/^\/(share|media)(\/[^\\\r\n\0]*)?$/.test(s)||s.includes('..'))throw Object.assign(new Error('Invalid storage_root'),{status:400});return s.replace(/\/+$/,'')||'/share'};
// Контакт към портала: трябва да съществува в контактите (или празно).
const portalContact=(db,v)=>{const s=String(v==null?'':v).trim();if(!s)return '';if(!db.directory||!(db.directory.contacts||[]).some(c=>c.id===s))throw Object.assign(new Error('Unknown contact'),{status:400});return s};
const contactById=(db,id)=>{const c=id&&db.directory&&(db.directory.contacts||[]).find(x=>x.id===id);return c?{id:c.id,email:c.email,name:(c.fields&&c.fields.name)||'',organization:(c.fields&&c.fields.organization)||'',department:(c.fields&&c.fields.department)||'',phone:(c.fields&&c.fields.phone)||'',city:(c.fields&&c.fields.city)||'',country:(c.fields&&c.fields.country)||'',extras:Array.isArray(c.extras)?c.extras.map(x=>({key:x.key,value:x.value})):[]}:null};
// Дело към портала: трябва да съществува в делата (или празно).
const portalCase=(db,v)=>{const s=String(v==null?'':v).trim();if(!s)return '';if(!require('./cases').caseById(db,s))throw Object.assign(new Error('Unknown case'),{status:400});return s};
const taxonomyFields=['topic','category','group'];
const normalizeTaxonomy=(input,base={})=>{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('Invalid metadata'),{status:400});
 const out={topic:base.topic||'',category:base.category||'',group:base.group||'',tags:[...(base.tags||[])]};
 for(const key of taxonomyFields)if(Object.hasOwn(input,key)){
  if(typeof input[key]!=='string'||input[key].length>120)throw Object.assign(new Error('Invalid '+key),{status:400});out[key]=input[key].trim();
  if(runtime.settings.data.strictTaxonomy&&out[key]&&key!=='topic'&&out[key]!==base[key]){const lst=((db.taxonomy||{})[key==='category'?'categories':'groups']||[]);if(!lst.some(x=>x.toLowerCase()===out[key].toLowerCase()))throw Object.assign(new Error('Unknown '+key+' (select from the list)'),{status:400})}
 }
 if(Object.hasOwn(input,'tags')){
  if(!Array.isArray(input.tags)||input.tags.length>runtime.settings.data.maxTags||input.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>80))throw Object.assign(new Error('Invalid tags'),{status:400});
  out.tags=[...new Set(input.tags.map(t=>t.trim()))];
 }
 return out;
};
const publicFile=f=>({id:f.id,name:f.name,size:f.size,sha256:f.sha256,version:Number(f.version)||1,uploadedAt:f.uploadedAt,createdAt:f.createdAt||f.uploadedAt||'',modifiedAt:f.modifiedAt||f.uploadedAt||'',locked:!!f.locked,lockedBy:f.lockedBy||'',accessMode:fileMode(f),listed:f.listed!==false,encrypted:!!f.encrypted,notes:f.notes||'',...normalizeTaxonomy({},f)});
const filePage=(files,url)=>{
 const q=(url.searchParams.get('q')||'').trim().toLocaleLowerCase();
 const rawLimit=url.searchParams.get('limit')||'50',rawOffset=url.searchParams.get('offset')||'0';
 if(q.length>200||!/^[0-9]{1,4}$/.test(rawLimit)||!/^[0-9]{1,9}$/.test(rawOffset)||Number(rawLimit)<1||Number(rawLimit)>500)throw Object.assign(new Error('Invalid pagination or search'),{status:400});
 const order=url.searchParams.get('order')||'name';
 if(!['name','uploadedAt','size'].includes(order))throw Object.assign(new Error('Invalid sort'),{status:400});
 const direction=url.searchParams.get('direction')||'asc';
 if(!['asc','desc'].includes(direction))throw Object.assign(new Error('Invalid direction'),{status:400});
 const filters=Object.fromEntries(['topic','category','group','tag'].map(k=>[k,(url.searchParams.get(k)||'').trim().toLocaleLowerCase()]));
 if(Object.values(filters).some(v=>v.length>120))throw Object.assign(new Error('Invalid taxonomy filter'),{status:400});
 const filtered=files.filter(f=>f.name.toLocaleLowerCase().includes(q)&&
  ['topic','category','group'].every(k=>!filters[k]||(f[k]||'').toLocaleLowerCase()===filters[k])&&
  (!filters.tag||(f.tags||[]).some(t=>t.toLocaleLowerCase()===filters.tag)));
 filtered.sort((a,b)=>{const v=order==='name'?a.name.localeCompare(b.name):order==='size'?a.size-b.size:a.uploadedAt.localeCompare(b.uploadedAt);return (v||a.id.localeCompare(b.id))*(direction==='desc'?-1:1)});
 const offset=Number(rawOffset),limit=Number(rawLimit);
 return {files:filtered.slice(offset,offset+limit).map(publicFile),total:filtered.length,limit,offset,hasMore:offset+limit<filtered.length};
};
const getPortal=s=>db.portals.find(p=>p.slug===s);
// Публичните адреси приемат и slug, и id: `/p/<id>` е каноничният адрес на QR кода,
// а `/p/<slug>` остава валиден (стари връзки и познаваеми адреси).
const resolvePortal=key=>{const k=String(key||'');if(!k)return null;return db.portals.find(p=>p.slug===k)||db.portals.find(p=>p.id===k)||null};
const adminPortal=p=>({...publicPortal(p),contactId:p.contactId||'',contact:contactById(db,p.contactId),caseId:p.caseId||'',case:require('./cases').caseView(db,p.caseId),htmlProjects:(p.htmlProjects||[]).map(x=>({...x})),files:p.files.map(f=>({...publicFile(f),accessKeys:(f.accessKeys||[]).map(k=>({id:k.id,createdAt:k.createdAt,expiresAt:k.expiresAt||null}))}))});
const bearerToken=req=>((req.headers.authorization||'').replace(/^Bearer\s+/i,'')).trim();
const resolveSession=(req,url)=>{const token=bearerToken(req)||((url&&url.searchParams.get('portal_token'))||'');if(!token)return null;return metadataStore.getSession(keyDigest(token))};
const portalAuthorized=(req,p,scope='read',url)=>{const s=resolveSession(req,url);return !!(s&&(s.scopes||[]).includes(scope))};
const signedValid=(url,p,f)=>{const expires=Number(url.searchParams.get('expires')),sig=url.searchParams.get('sig')||'';if(!Number.isSafeInteger(expires)||expires<=Math.floor(Date.now()/1000)||expires>Math.floor(Date.now()/1000)+86400||!/^[a-f0-9]{64}$/.test(sig))return false;const expected=crypto.createHmac('sha256',p.signingSecret||adminToken).update(`${p.id}:${f.id}:${expires}`).digest('hex');return safeEqual(sig,expected)};

const apiRoot=path.join(root,'api');const cabinet=require('./cabinet').create({root,maxBytes:()=>runtime.effective().maxUploadBytes,localOpen:process.env.HAPI_LOCAL_OPEN==='1'});const isLoopback=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);const fileNameHeader=req=>{const v=String(req.headers['x-file-name']||'');try{return clean(decodeURIComponent(v))}catch{return clean(v)}};
function baseUrl(req){const env=runtime.effective().publicBaseUrl;if(env)return env;const h=req&&(req.headers['x-forwarded-host']||req.headers.host);if(!h||!/^[A-Za-z0-9.\-:\[\]]{1,255}$/.test(String(h).split(',')[0].trim()))return '';const proto=String(req.headers['x-forwarded-proto']||'http').split(',')[0].trim();return (proto==='https'?'https':'http')+'://'+String(h).split(',')[0].trim()}
function portalApiUrl(p,base){return (base||'')+'/api/v1/p/'+encodeURIComponent(p.slug)}
// Публичната страница се адресира с ИДЕНТИФИКАТОРА на портала (не с името/slug):
// QR кодът не издава „говорещото“ име, а и връзката остава валидна при смяна на slug.
function portalLandingUrl(p,base){return (base||'')+'/p/'+encodeURIComponent(p.id||p.slug)}
function fileDownloadUrl(p,f,base){return portalApiUrl(p,base)+'/files/'+encodeURIComponent(f.id)+'/download'}
function qrSvg(text){const q=require('./qrcode')(0,'M');q.addData(text);q.make();return q.createSvgTag({cellSize:8,margin:4,scalable:true})}
async function writeApiDir(p,base){try{const dir=path.join(apiRoot,p.slug),apiUrl=portalApiUrl(p,base);await fsp.mkdir(dir,{recursive:true,mode:0o700});const w=(n,c)=>fsp.writeFile(path.join(dir,n),c,{mode:0o600});await w('api.json',JSON.stringify({slug:p.slug,id:p.id,title:p.title,landing:portalLandingUrl(p,base),apiUrl,openapi:apiUrl+'/openapi.json',manifest:apiUrl+'/manifest',files:apiUrl+'/files',qr:apiUrl+'/qr.svg',updatedAt:new Date().toISOString()},null,2));await w('openapi.json',JSON.stringify(spec(p),null,2));await w('qr.svg',qrSvg(portalLandingUrl(p,base)))}catch(e){console.error('API directory failed for '+p.slug+': '+e.message)}}
function spec(p){const prefix='/api/v1/p/'+p.slug;return {openapi:'3.1.0',info:{title:p.title+' Public API',version:'1.0.0'},paths:{[prefix]:{get:{responses:{200:{description:'Portal metadata'}}}},[prefix+'/files']:{get:{responses:{200:{description:'Files'}}}},[prefix+'/files/{fileId}']:{get:{parameters:[{name:'fileId',in:'path',required:true,schema:{type:'string'}}],responses:{200:{description:'File metadata'}}}},[prefix+'/files/{fileId}/download']:{get:{responses:{200:{description:'File download'}}}}}}}
let lastStorageCheck=null,lastStorageCheckTime=0;
const storageCheckIntervalMs=eff.storageCheckIntervalMs;
async function runStorageCheck(reason){
 const result=await storageCheck.check([root,filesRoot,internalRoot,htmlProjectsRoot]);
 lastStorageCheck=result;lastStorageCheckTime=Date.now();
 for(const loc of result.locations){if(!loc.available||!loc.writable)void errorLog.append('error','storage-check',loc.error||'UNAVAILABLE',{location:loc.name})}
 if(!result.healthy)void audit('storage.check.failed',{reason,locations:result.locations});
 return result;
}
async function handler(req,res){try{if(req.url.startsWith('//'))req.url=req.url.replace(/^\/{2,}/,'/');const url=new URL(req.url,'http://localhost');
const isAdminListener=ingressMode&&req.socket.localPort===adminPort;req.ingress=isAdminListener;
let hasIngressPath=false;
if(isAdminListener){
 let ingressPath=req.headers['x-ingress-path'];
 if(typeof ingressPath!=='string'){
  const match=/^(\/api\/hassio_ingress\/[A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname);
  if(match)ingressPath=match[1];
 }
 if(typeof ingressPath==='string'&&/^\/api\/hassio_ingress\/[A-Za-z0-9_-]+\/?$/.test(ingressPath)){
  hasIngressPath=true;
  const prefix=ingressPath.replace(/\/+$/,'');
  if(url.pathname===prefix||url.pathname.startsWith(prefix+'/')){
  const remainder=url.pathname.slice(prefix.length);
  url.pathname=remainder?'/'+remainder.replace(/^\/+/,''):'/';
  req.url=url.pathname+url.search;
 }
 }
}
if(isAdminListener&&corsOrigin){res.setHeader('Access-Control-Allow-Origin',corsOrigin);res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type,X-File-Name');res.setHeader('Access-Control-Max-Age','600');res.setHeader('Vary','Origin')}
if(ingressMode){const adminPath=url.pathname==='/admin'||url.pathname==='/admin.js'||url.pathname.startsWith('/admin/')||url.pathname==='/'||(hasIngressPath&&url.pathname.startsWith('/site/'));if(isAdminListener&&!adminPath)return fail(res,404,'Not found');if(!isAdminListener&&adminPath)return fail(res,404,'Not found');if(isAdminListener&&url.pathname==='/'){url.pathname='/admin';req.url=url.pathname+url.search;}}
if(isAdminListener&&url.pathname==='/admin/api/ingress-login'&&req.method==='GET'){
 const peer=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
 const fromSupervisor=peer==='172.30.32.2'&&typeof req.headers['x-ingress-path']==='string';
 const localOnly=['127.0.0.1','::1'].includes(peer)&&['127.0.0.1','::1','localhost'].includes(adminBindHost);
 if(!fromSupervisor&&!localOnly)return fail(res,403,'Forbidden');
 res.setHeader('Cache-Control','no-store');
 return json(res,200,{token:adminToken});
}
if(req.method==='OPTIONS'){res.writeHead(isAdminListener&&corsOrigin?204:404,{'Content-Length':'0'});return res.end()}
const parts=url.pathname.split('/').filter(Boolean);const method=req.method;counters.requests++;if(req.hapiPublicOnly&&(parts[0]==='admin'||parts[0]==='ui'))return fail(res,404,'Not found');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');if(!isAdminListener)res.setHeader('X-Frame-Options','DENY');
for(const [k,v] of Object.entries(apiVersion.headers(url)))res.setHeader(k,v);
if(url.pathname==='/api/v1/auth/login'&&method==='POST'){
 if(!loginGate(req,res))return;
 const b=await parse(req);const username=clean(b.username),password=String(b.password||'');
 if(!/^[A-Za-z0-9_.@-]{1,64}$/.test(username)||!password||password.length>200)return fail(res,400,'Username or password required');
 const user=metadataStore.getUser(username);
 if(!user||!user.active||!verifyPassword(password,user.passwordHash)){registerLoginFailure(req);void audit('auth.login_failed',{username});return fail(res,401,'Invalid credentials')}
 let expiresAt=null;const ttl=Number(b.ttlSeconds);if(Number.isFinite(ttl)&&ttl>0){if(ttl>31536000)return fail(res,400,'TTL exceeds maximum');expiresAt=new Date(Date.now()+ttl*1000).toISOString()}
 const token=newSessionToken();metadataStore.createSession(keyDigest(token),username,expiresAt);clearLoginFailures(req);
 void audit('auth.login',{username});
 return json(res,200,{token,username,scopes:user.scopes,expiresAt});
}
if(url.pathname==='/api/v1/auth/logout'&&method==='POST'){
 const token=bearerToken(req);if(!token)return fail(res,401,'Token required');
 metadataStore.deleteSession(keyDigest(token));
 return json(res,200,{loggedOut:true});
}
if(url.pathname==='/api/v1/auth/me'&&method==='GET'){
 const s=resolveSession(req,url);if(!s)return fail(res,401,'Token required');
 return json(res,200,{username:s.username,scopes:s.scopes,expiresAt:s.expiresAt});
}
if(url.pathname==='/admin/api/users'&&method==='GET'){
 if(!adminGate(req,res,'users',method))return;
 return json(res,200,{users:metadataStore.listUsers()});
}
if(url.pathname==='/admin/api/users'&&method==='POST'){
 if(!adminGate(req,res,'users',method))return;
 const b=await parse(req);const username=clean(b.username),password=String(b.password||'');
 if(!/^[A-Za-z0-9_.@-]{1,64}$/.test(username))return fail(res,400,'Invalid username');
 if(password.length<8||password.length>200)return fail(res,400,'Password must be 8-200 characters');
 let scopes;try{scopes=normalizeScopes(b.scopes)}catch(e){return fail(res,e.status,e.message)}
 if(metadataStore.getUser(username))return fail(res,409,'Username exists');
 metadataStore.createUser(username,hashPassword(password),scopes);
 void audit('user.create',{username});
 return json(res,201,{user:metadataStore.getUser(username)});
}
const userMatch=url.pathname.match(/^\/admin\/api\/users\/([^\/]+)$/);
if(userMatch){
 let username;try{username=decodeURIComponent(userMatch[1])}catch{return fail(res,400,'Invalid username')}
 if(method==='PATCH'){
  if(!adminGate(req,res,'users',method))return;
  const cur=metadataStore.getUser(username);if(!cur)return fail(res,404,'User not found');
  const b=await parse(req);const patch={};
  if(b.password!==undefined){const pw=String(b.password||'');if(pw.length<8||pw.length>200)return fail(res,400,'Password must be 8-200 characters');patch.passwordHash=hashPassword(pw)}
  if(b.scopes!==undefined){try{patch.scopes=normalizeScopes(b.scopes)}catch(e){return fail(res,e.status,e.message)}}
  if(b.active!==undefined){if(typeof b.active!=='boolean')return fail(res,400,'active must be boolean');patch.active=b.active}
  metadataStore.updateUser(username,patch);
  void audit('user.update',{username});
  return json(res,200,{user:metadataStore.getUser(username)});
 }
 if(method==='DELETE'){
  if(!adminGate(req,res,'users',method))return;
  if(!metadataStore.deleteUser(username))return fail(res,404,'User not found');
  void audit('user.delete',{username});
  return json(res,200,{deleted:username});
 }
}
if(url.pathname==='/admin/api/settings'&&method==='GET'){
 if(!adminGate(req,res,'settings',method))return;
 return json(res,200,{settings:runtime.settings,effective:runtime.effective(),databasePath:runtime.databaseRelative,requiresRestartForDatabaseChange:true});
}
if(url.pathname==='/admin/api/settings'&&method==='PATCH'){
 if(!adminGate(req,res,'settings',method))return;
 const data=await parse(req);let saved;try{saved=await runtime.save(data)}catch(e){return fail(res,400,String(e.message||'Invalid settings').slice(0,160))}
 applyBackupSchedule();
 await audit('settings_changed',{keys:Object.keys(data)});
 const now=runtime.effective(),startupKeys=['maxDownloadStreams','maxJobs','storageCheckIntervalMs','corsOrigin','requirePortalToken','storeRawIp'];return json(res,200,{settings:saved,effective:now,restartRequired:path.join(saved.databaseDirectory,saved.databaseFile)!==runtime.databaseRelative||startupKeys.some(k=>now[k]!==eff[k])});
}
if(url.pathname==='/admin/api/qr-artifacts'&&method==='POST'){
 if(!adminGate(req,res,'qr',method))return;
 const data=await parse(req);
 // Serialize artifact creation and DB persistence as one application operation.
 // On metadata write failure remove only the directory created by this request.
 const artifact=await update(async()=>{
  if((db.qrArtifacts||[]).some(a=>a.qrId===data.qrId))throw Object.assign(new Error('QR ID already registered'),{status:409});
  const created=await runtime.createArtifacts(data);
  db.qrArtifacts??=[];db.qrArtifacts.push(created);
  return created;
 },async created=>{await runtime.removeArtifacts(created)});
 await audit('qr_artifact_created',{qrId:artifact.qrId});return json(res,201,{artifact});
}
if(url.pathname==='/admin/api/qr-artifacts'&&method==='GET'){
 if(!adminGate(req,res,'qr',method))return;return json(res,200,{artifacts:db.qrArtifacts||[]});
}
{const m=/^\/admin\/api\/qr-artifacts\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
 if(m&&method==='DELETE'){
  if(!adminGate(req,res,'qr',method))return;
  const qrId=m[1];
  const existing=(db.qrArtifacts||[]).find(a=>a.qrId===qrId);
  if(!existing)return fail(res,404,'Artifact not found');
  // Serialize removal with rollback: if the metadata write fails, restore the record.
  await update(async()=>{
   await runtime.removeArtifacts(existing);
   db.qrArtifacts=(db.qrArtifacts||[]).filter(a=>a.qrId!==qrId);
  });
  await audit('qr_artifact_revoked',{qrId});
  return json(res,200,{revoked:true,qrId});
 }}
if(url.pathname==='/admin/api/notify/dispatch'&&method==='POST'){
 if(!adminGate(req,res,'qr',method))return;
 if(!notify.enabled())return fail(res,503,'Notify dispatch disabled (SUPERVISOR_TOKEN not configured)');
 const b=await parse(req);
 const service=String(b.service||'');
 let link='';
 if(typeof b.link==='string'&&b.link.trim())link=b.link.trim();
 else if(b.portalId){
  const p=db.portals.find(x=>x.id===b.portalId);
  if(!p)return fail(res,404,'Portal not found');
  if(b.fileId){const f=p.files.find(x=>x.id===b.fileId);if(!f)return fail(res,404,'File not found');link=fileDownloadUrl(p,f,baseUrl(req));}
  else link=portalLandingUrl(p,baseUrl(req));
 } else return fail(res,400,'link or portalId required');
 if(link.length>2048)return fail(res,400,'Link too long');
 const title=String(b.title||'').slice(0,200);
 const message=String(b.message||'').slice(0,2000);
 try{
  const status=await notify.send(service,b.target,{title,message:(message?message+'\n':'')+link});
  void audit('notify.dispatch',{service,portalId:b.portalId||null,fileId:b.fileId||null,status});
  return json(res,200,{sent:true,status});
 }catch(e){return fail(res,e.status||502,e.message||'Notify failed')}
}
if(url.pathname==='/admin/api/sensors'&&method==='GET'){
 if(!adminGate(req,res,'sensors',method))return;
 const database=await fsp.stat(dbPath).catch(()=>({size:0}));
 const telemetryStat=await fsp.stat(telemetryFile).catch(()=>({size:0}));
 const portals=db.portals.map(p=>({id:p.id,slug:p.slug,files:p.files.length,bytes:p.files.reduce((n,f)=>n+f.size,0),...telemetry.byPortal[p.id]}));
 return json(res,200,{generatedAt:new Date().toISOString(),databaseBytes:database.size,telemetryBytes:telemetryStat.size,files:portals.reduce((n,p)=>n+p.files,0),fileBytes:portals.reduce((n,p)=>n+p.bytes,0),visits:telemetry.visits,downloads:telemetry.downloads,portals,tokenActivity:telemetry.byToken,fileDownloads:telemetry.byFile,ratings:Object.fromEntries(Object.entries(telemetry.ratings).map(([k,v])=>[k,{count:v.count,average:v.sum/v.count}])),recent:telemetry.recent,ipMode:rawIpEnabled?'raw':'hashed'});
}
if(url.pathname==='/admin/api/database/backup'&&method==='POST'){
 if(!adminGate(req,res,'backup',method))return;
 const result=await updateBackup();
 await audit('database_backup_created',{name:result.name,bytes:result.bytes,sha256:result.sha256});
 return json(res,201,{backup:result});
}
if(url.pathname==='/admin/api/jobs'&&method==='GET'){if(!adminGate(req,res,'jobs',method))return;return json(res,200,{jobs:jobManager.list(),...jobManager.stats()})}
{const m=/^\/admin\/api\/jobs\/([0-9a-f-]{36})\/(cancel|pause|resume)$/.exec(url.pathname);
 if(m&&method==='POST'){
  if(!adminGate(req,res,'jobs',method))return;
  const job=m[2]==='cancel'?jobManager.cancel(m[1]):m[2]==='pause'?jobManager.pause(m[1]):jobManager.resume(m[1]);
  return job?json(res,200,job):fail(res,404,'Job not found');
 }}
{const m=/^\/admin\/api\/jobs\/([0-9a-f-]{36})$/.exec(url.pathname);
 if(m&&method==='GET'){
  if(!adminGate(req,res,'jobs',method))return;
  const job=jobManager.get(m[1]);
  return job?json(res,200,job):fail(res,404,'Job not found');
 }}
if(url.pathname==='/admin/api/diagnostics'&&method==='GET'){
 if(!adminGate(req,res,'diagnostics',method))return;
 const mem=process.memoryUsage();
 const storage=await Promise.all([root,filesRoot,internalRoot].map(async location=>{
  try{const st=await fsp.stat(location);return {name:path.basename(location),available:st.isDirectory(),writable:!!(await fsp.access(location,fs.constants.W_OK).then(()=>true).catch(()=>false))}}
  catch(e){return {name:path.basename(location),available:false,writable:false,error:e.code||'UNAVAILABLE'}}
 }));
 return json(res,200,{generatedAt:new Date().toISOString(),uptimeSeconds:Math.floor(process.uptime()),runtime:{node:process.version,pid:process.pid,rssBytes:mem.rss,heapUsedBytes:mem.heapUsed,heapTotalBytes:mem.heapTotal},traffic:{...counters,activeDownloadStreams,maxDownloadStreams,effectiveDownloadStreams:loadControl.effective,load:loadControl.snapshot(counters.requests)},catalog:{portals:db.portals.length,files:db.portals.reduce((n,p)=>n+p.files.length,0)},storage});
}
if(url.pathname==='/admin/api/load'&&method==='GET'){if(!adminGate(req,res,'load',method))return;return json(res,200,loadControl.snapshot(counters.requests))}
if(url.pathname==='/admin/api/errors'&&method==='GET'){
 if(!adminGate(req,res,'errors',method))return;
 const limitRaw=url.searchParams.get('limit')||'100';
 if(!/^[0-9]{1,4}$/.test(limitRaw)||Number(limitRaw)<1||Number(limitRaw)>500)return fail(res,400,'Invalid limit');
 const level=url.searchParams.get('level'),source=url.searchParams.get('source');
 if(level&&!['error','warn','info'].includes(level))return fail(res,400,'Invalid level');
 const events=await errorLog.list({limit:Number(limitRaw),level:level||undefined,source:source||undefined});
 return json(res,200,{events,count:events.length,order:'newest-first'});
}
if(url.pathname==='/admin/api/config-profiles'&&method==='GET'){if(!adminGate(req,res,'profiles',method))return;return json(res,200,{profiles:await configProfiles.list()})}
if(url.pathname==='/admin/api/config-profiles'&&method==='POST'){
 if(!adminGate(req,res,'profiles',method))return;
 const data=await parse(req);const name=clean(data.name);
 const settings=data&&data.settings&&typeof data.settings==='object'&&!Array.isArray(data.settings)?data.settings:runtime.settings;
 const profile=await configProfiles.save(name,settings);
 await audit('config.profile.saved',{profile:name});
 return json(res,201,{profile});
}
{const m=/^\/admin\/api\/config-profiles\/([a-z0-9][a-z0-9_-]{0,63})\/apply$/.exec(url.pathname);
 if(m&&method==='POST'){
  if(!adminGate(req,res,'profiles',method))return;
  const profile=await configProfiles.get(m[1]);if(!profile)return fail(res,404,'Profile not found');
  const saved=await runtime.save(profile.settings);
  const restartRequired=path.join(saved.databaseDirectory,saved.databaseFile)!==runtime.databaseRelative;
  await audit('config.profile.applied',{profile:m[1],restartRequired});
  return json(res,200,{profile:m[1],settings:saved,restartRequired});
 }}
{const m=/^\/admin\/api\/config-profiles\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(url.pathname);
 if(m&&method==='DELETE'){
  if(!adminGate(req,res,'profiles',method))return;
  const removed=await configProfiles.remove(m[1]);if(!removed)return fail(res,404,'Profile not found');
  await audit('config.profile.deleted',{profile:m[1]});
  return json(res,200,{deleted:m[1]});
 }}
if(url.pathname==='/admin/api/database/backups'&&method==='GET'){
 if(!adminGate(req,res,'backup',method))return;
 const dir=backupsDir;let entries=[];
 try{entries=(await fsp.readdir(dir)).filter(n=>n.endsWith('.sqlite'))}catch(e){if(e.code!=='ENOENT')throw e}
 const backups=[];
 for(const name of entries){try{const st=await fsp.stat(path.join(dir,name));backups.push({name,bytes:st.size,createdAt:st.mtime.toISOString()})}catch{}}
 backups.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 return json(res,200,{backups});
}
if(url.pathname==='/admin/api/database/backup-schedule'&&method==='GET'){
 if(!adminGate(req,res,'backup',method))return;
 return json(res,200,{schedule:runtime.settings.backupSchedule||DEFAULT_BACKUP_SCHEDULE,nextRunAt:backupScheduleNext?new Date(backupScheduleNext).toISOString():null});
}
if(url.pathname==='/admin/api/database/backup-schedule'&&method==='PUT'){
 if(!adminGate(req,res,'backup',method))return;
 const data=await parse(req);
 const current=runtime.settings.backupSchedule||DEFAULT_BACKUP_SCHEDULE;
 const next={enabled:data.enabled!==undefined?!!data.enabled:current.enabled,intervalMinutes:data.intervalMinutes!==undefined?Number(data.intervalMinutes):current.intervalMinutes,maxBackups:data.maxBackups!==undefined?Number(data.maxBackups):current.maxBackups};
 const saved=await runtime.save({backupSchedule:next});
 applyBackupSchedule();
 await audit('backup.schedule.updated',{...saved.backupSchedule});
 return json(res,200,{schedule:saved.backupSchedule,nextRunAt:backupScheduleNext?new Date(backupScheduleNext).toISOString():null});
}
{const m=/^\/admin\/api\/database\/backups\/([a-zA-Z0-9._-]+\.sqlite)\/restore$/.exec(url.pathname);
 if(m&&method==='POST'){
  if(!adminGate(req,res,'backup',method))return;
  const name=m[1];if(name!==path.basename(name))return fail(res,400,'Invalid backup name');
  const source=path.join(backupsDir,name);
  let stat;try{stat=await fsp.stat(source)}catch{return fail(res,404,'Backup not found')}
  if(!stat.isFile())return fail(res,404,'Backup not found');
  // Restore runs on the same metadata queue as updates so it cannot interleave
  // with a partial write; validation happens before any commit.
  let result;
  try{
   result=await new Promise((resolve,reject)=>{const run=queue.then(()=>{try{const r=metadataStore.restoreFrom(source);db=metadataStore.load();resolve(r)}catch(e){reject(e)}});queue=run.catch(()=>{})});
  }catch(e){
   void errorLog.append('error','backup-restore',e&&e.message||'Restore failed',{name});
   return fail(res,422,'Restore failed: invalid or incompatible backup');
  }
  await audit('database_restored',{name,portals:result.portals,qrArtifacts:result.qrArtifacts,revision:result.revision});
  return json(res,200,{restored:result});
 }}
if(url.pathname==='/admin/api/storage/status'&&method==='GET'){
 if(!adminGate(req,res,'storage',method))return;
 return json(res,200,{locations:[root,filesRoot,internalRoot,htmlProjectsRoot].map(l=>path.basename(l)),lastCheck:lastStorageCheck,intervalMs:storageCheckIntervalMs,nextCheckAt:storageCheckIntervalMs&&lastStorageCheckTime?new Date(lastStorageCheckTime+storageCheckIntervalMs).toISOString():null});
}
if(url.pathname==='/admin/api/storage/check'&&method==='POST'){
 if(!adminGate(req,res,'storage',method))return;
 return json(res,200,await runStorageCheck('manual'));
}
if(url.pathname==='/admin/api/whoami'&&method==='GET'){if(!adminGate(req,res,'whoami',method))return;return json(res,200,{role:rbac.role(req),ingress:req.ingress===true})}
// Връзка за GUI-я: роля, режим и публичен адрес за API/QR (без секрети).
if(url.pathname==='/admin/api/connection'&&method==='GET'){
 if(!adminGate(req,res,'whoami',method))return;
 return json(res,200,{role:rbac.role(req),ingress:req.ingress===true,publicBaseUrl:runtime.effective().publicBaseUrl||'',requestBase:baseUrl(req),apiVersion:apiVersion.VERSION.CURRENT});
}
if(url.pathname==='/health'&&method==='GET')return json(res,200,{status:'ok'});if(url.pathname==='/admin/api/metrics'&&method==='GET'){if(!adminGate(req,res,'metrics',method))return;return json(res,200,{...counters,portals:db.portals.length})}
if(url.pathname==='/admin/api/audit/verify'&&method==='GET'){if(!adminGate(req,res,'audit',method))return;const result=await auditChain.verify();return json(res,result.valid?200:409,{...result,integrity:result.valid?'HASH_CHAIN_VALID':'FAILED',note:'Hash chaining detects changes but is not externally anchored or tamper-proof against an administrator who can rewrite the entire chain.'})}
if(url.pathname==='/admin/api/audit'&&method==='GET'){
 if(!adminGate(req,res,'audit',method))return;
 const limitRaw=url.searchParams.get('limit')||'100';
 if(!/^[0-9]{1,4}$/.test(limitRaw)||Number(limitRaw)<1||Number(limitRaw)>500)return fail(res,400,'Invalid limit');
 const portalId=url.searchParams.get('portalId');
 if(portalId&&!/^[a-f0-9]{24}$/.test(portalId))return fail(res,400,'Invalid portalId');
 let lines=[];
 try{lines=(await fsp.readFile(auditPath,'utf8')).split('\n').filter(Boolean)}catch(e){if(e.code!=='ENOENT')throw e}
 const events=[];
 for(let i=lines.length-1;i>=0&&events.length<Number(limitRaw);i--){let event;try{event=JSON.parse(lines[i])}catch{continue}if(!portalId||event.portalId===portalId)events.push(event)}
 return json(res,200,{events,count:events.length,integrity:'UNVERIFIED',order:'newest-first'});
}
if(url.pathname==='/admin/api/audit/export'&&method==='GET'){
 if(!adminGate(req,res,'audit',method))return;
 const format=(url.searchParams.get('format')||'json').toLowerCase();
 if(!['json','csv'].includes(format))return fail(res,400,'Invalid format');
 const portalId=url.searchParams.get('portalId');
 if(portalId&&!/^[a-f0-9]{24}$/.test(portalId))return fail(res,400,'Invalid portalId');
 const since=url.searchParams.get('since'),until=url.searchParams.get('until');
 if(since&&!Number.isFinite(Date.parse(since)))return fail(res,400,'Invalid since');
 if(until&&!Number.isFinite(Date.parse(until)))return fail(res,400,'Invalid until');
 const inRange=t=>{const d=Date.parse(t);if(!Number.isFinite(d))return false;if(since&&d<Date.parse(since))return false;if(until&&d>Date.parse(until))return false;return true};
 let lines=[];try{lines=(await fsp.readFile(auditPath,'utf8')).split('\n').filter(Boolean)}catch(e){if(e.code!=='ENOENT')throw e}
 const events=[];for(const line of lines){let e;try{e=JSON.parse(line)}catch{continue}if(portalId&&e.portalId!==portalId)continue;if(!inRange(e.at))continue;events.push(e)}
 const byEvent={};for(const e of events)byEvent[e.event]=(byEvent[e.event]||0)+1;
 if(format==='csv'){
  const cols=['at','event','portalId','fileId','actor','ip','details'];
  const esc=v=>{const s=v==null?'':String(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
  const rows=events.map(e=>{const d=e.details&&typeof e.details==='object'?e.details:{};return [e.at,e.event,e.portalId||'',e.fileId||'',e.actor||'',e.ip||'',esc(JSON.stringify(d))].map(esc).join(',')});
  res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="audit-export.csv"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  return res.end('\ufeff'+[cols.join(','),...rows].join('\r\n'));
 }
 void audit('audit.export',{format,count:events.length});
 return json(res,200,{generatedAt:new Date().toISOString(),count:events.length,firstAt:events[0]?.at||null,lastAt:events[events.length-1]?.at||null,byEvent,order:'oldest-first',events});
}
if(url.pathname==='/admin/api/retention'&&method==='GET'){
 if(!adminGate(req,res,'retention',method))return;
 return json(res,200,await retention.preview(db.portals));
}
if(url.pathname==='/admin/api/retention'&&method==='POST'){
 if(!adminGate(req,res,'retention',method))return;
 const result=await update(async()=>{const r=await retention.apply(db.portals);void audit('retention.run',{fileAction:r.fileAction,disabled:r.disabled,deleted:r.deleted,auditLinesPruned:r.auditLinesPruned});return r});
 return json(res,200,result);
} 
if(url.pathname==='/admin'&&method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src blob: data:; frame-src blob:; object-src blob:"});return res.end(fs.readFileSync(path.join(__dirname,'admin.html')))}
if(url.pathname==='/admin.js'&&method==='GET'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'});return res.end(fs.readFileSync(path.join(__dirname,'admin.js')))}
// Enterprise Control Center GUI (Фаза 10/11). Публичен като /admin: данните са ДЕМО,
// а административните API-та си изискват Bearer токен. Allowlist — без произволни пътища.
const UI_FILES=(()=>{
 const files={'/ui':['ui/index.html','text/html; charset=utf-8'],'/ui/':['ui/index.html','text/html; charset=utf-8'],'/ui/index.html':['ui/index.html','text/html; charset=utf-8'],'/ui/styles.css':['ui/styles.css','text/css; charset=utf-8'],'/ui/manifest.example.json':['ui/manifest.example.json','application/json; charset=utf-8']};
 for(const f of ['app.js','icons.js','data.js','report-objects.js','report-studio.js','portals.js','portal-control.js','portal-folders.js','portal-files.js','files-manager.js','directory-panel.js','settings-panel.js','export-center.js','public-gateway.js'])files['/ui/'+f]=['ui/'+f,'text/javascript; charset=utf-8'];
 for(const f of ['report-manifest.js','api-spec.js','virtual-storage.js','storage-tree.js','export-rules.js','export-manager.js','download-access.js','public-gateway.js','qrcode.js'])files['/hapi_enterprise/'+f]=['hapi_enterprise/'+f,'text/javascript; charset=utf-8'];
 return files;
})();
if(method==='GET'&&UI_FILES[url.pathname]){
 const [rel,type]=UI_FILES[url.pathname];
 res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-src blob:; object-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
 return res.end(fs.readFileSync(path.join(__dirname,'..',rel)));
}
if(url.pathname==='/'&&method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});return res.end('<!doctype html><html lang="bg"><meta charset="utf-8"><title>hAPI Enterprise</title><style>body{font:16px system-ui;background:#101827;color:#fff;max-width:800px;margin:5rem auto;padding:1rem}a{color:#7dd3fc}</style><h1>hAPI Enterprise</h1><p>Public API: <a href="/api/v1/portals">/api/v1/portals</a></p><p>Административните операции изискват Bearer токен.</p></html>')}
// Isolated static HTML project hosting. Only folders inside DATA_DIR/html-projects
// can be registered. Every served file is checked with realpath to prevent symlink escapes.
if(parts[0]==='site'&&parts.length>=3&&method==='GET'){
 const p=getPortal(parts[1]);if(!p)return fail(res,404,'Not found');
 const project=(p.htmlProjects||[]).find(x=>x.id===parts[2]);if(!project||!project.enabled)return fail(res,404,'Not found');
 const prefix='/site/'+encodeURIComponent(p.slug)+'/'+project.id;
 const cookieName='pe_site_'+project.id;
 const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(v=>{const i=v.indexOf('=');return i<0?['','']:[v.slice(0,i).trim(),v.slice(i+1).trim()]}));
 const verifySession=()=>{const token=cookies[cookieName];if(!token)return false;const s=metadataStore.getSession(keyDigest(token));return !!(s&&(s.scopes||[]).includes('read'))};
 if(requirePortalToken||p.visibility!=='public'){
  if(!verifySession()){
   const token=url.searchParams.get('portal_token');const s=token&&metadataStore.getSession(keyDigest(token));
   if(!s||!(s.scopes||[]).includes('read'))return fail(res,404,'Not found');
   res.writeHead(302,{'Location':prefix+'/', 'Set-Cookie':`${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=${prefix}/; Max-Age=2592000`, 'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end();
  }
 }
 const segments=parts.slice(3);if(segments.some(x=>x==='.'||x==='..'||x.includes('\\')||x.includes('\0')))return fail(res,404,'Not found');
 const relative=segments.length?segments.join('/'):'index.html';
 const base=path.join(htmlProjectsRoot,project.folder);let baseReal,targetReal,st;
 try{baseReal=await fsp.realpath(base);targetReal=await fsp.realpath(path.join(base,relative));st=await fsp.stat(targetReal);if(st.isDirectory()){targetReal=await fsp.realpath(path.join(targetReal,'index.html'));st=await fsp.stat(targetReal)}}catch{return fail(res,404,'Not found')}
 if(!targetReal.startsWith(baseReal+path.sep)||!st.isFile())return fail(res,404,'Not found');
 const ext=path.extname(targetReal).toLowerCase();const mime={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
 if(!mime[ext])return fail(res,415,'File type not supported');
 res.writeHead(200,{'Content-Type':mime[ext],'Content-Length':st.size,'Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});
 return fs.createReadStream(targetReal).pipe(res);
}
if(parts[0]==='qr'&&parts.length===2&&method==='GET'){
 const a=(db.qrArtifacts||[]).find(x=>x.qrId===parts[1]);
 if(!a)return fail(res,404,'Not found');
 let manifest={};
 try{manifest=JSON.parse(fs.readFileSync(path.join(root,a.relativeDirectory,'manifest.json'),'utf8'))}catch{}
 const org=htmlEsc(manifest.organization||''),project=htmlEsc(manifest.project||''),campaign=htmlEsc(manifest.campaign||'');
 const files=Array.isArray(manifest.files)?manifest.files:[];
 const rows=files.map(f=>'<tr><td>'+htmlEsc(f.name||f.id||'')+'</td><td>'+htmlEsc(String(f.sha256||'').slice(0,12))+'</td></tr>').join('');
 const created=htmlEsc(manifest.createdAt||a.createdAt||'');
 const html='<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+htmlEsc(org||project||'QR')+'</title><style>body{font-family:system-ui,sans-serif;margin:2rem;color:#1a1a2e;background:#f6f7fb}main{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e3e6f0;border-radius:12px;padding:2rem;box-shadow:0 4px 16px rgba(0,0,0,.06)}h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1.1rem;margin:1.5rem 0 .5rem;color:#333}p{margin:.25rem 0}table{width:100%;border-collapse:collapse;margin-top:.5rem}th,td{border-bottom:1px solid #eee;text-align:left;padding:.5rem .25rem}th{font-size:.8rem;text-transform:uppercase;color:#888}.meta{color:#666;font-size:.9rem}footer{margin-top:1.5rem;font-size:.8rem;color:#999}</style></head><body><main><h1>'+org+'</h1><div class="meta">'+project+(campaign?' · '+campaign:'')+'</div><h2>Официални документи</h2>'+(rows?'<table><thead><tr><th>Документ</th><th>Отпечатък</th></tr></thead><tbody>'+rows+'</tbody></table>':'<p class="meta">Няма регистрирани файлове.</p>')+'<footer>Регистриран на '+created+' · QR № '+htmlEsc(parts[1])+'</footer></main></body></html>';
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
 return res.end(html);
}
// Публична страница на портала — адресът, който QR кодът отваря: /p/<id портала>[/]
// (приема се и /p/<slug> за стари връзки).
if(parts[0]==='p'&&(parts.length===2||(parts.length===3&&parts[2]===''))&&method==='GET'){
 const portal=resolvePortal(parts[1]);if(!portal)return fail(res,404,'Not found');
 if((requirePortalToken||portal.visibility!=='public')&&!portalAuthorized(req,portal,'read',url))return fail(res,404,'Not found');
 void recordTelemetry('visit',req,portal,null,url);
 const html=fs.readFileSync(path.join(__dirname,'portal.html'));
 // inline стилове не се allow-ват; QR кодът е локален SVG (img-src 'self').
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
 return res.end(html);
}
if(url.pathname==='/portal.js'&&method==='GET'){
 res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 return res.end(fs.readFileSync(path.join(__dirname,'portal.js')));
}
if(url.pathname==='/portal.css'&&method==='GET'){
 res.writeHead(200,{'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 return res.end(fs.readFileSync(path.join(__dirname,'portal.css')));
}
if(parts[0]==='api'&&parts[1]==='v1'&&parts[2]==='portals'&&parts.length===3&&method==='GET')return requirePortalToken?fail(res,404,'Not found'):json(res,200,{portals:db.portals.filter(p=>p.visibility==='public').map(publicPortal)});
// Public API Gateway (PG-6): отделен канал, отделна токен схема и централни правила за достъп.
if(parts[0]==='api'&&parts[1]==='public'&&parts[2]==='v1'){
 const gwApi=require('./gateway-api');
 if(parts[3]==='portals'&&parts[4]&&method==='GET'){
  const gp=getPortal(parts[4]);if(!gp)return fail(res,404,'Not found');
  const gwCfg=gwApi.config(),view=gwApi.portalView(gp,gwCfg);
  if(view.status!=='active')return fail(res,404,'Not found');
  if(parts.length===5)return json(res,200,{portal:view,urls:gwApi.urlsFor(view,gwCfg)});
  if(parts[5]==='files'&&parts.length===6)return json(res,200,{files:gp.files.filter(f=>f.listed!==false).map(f=>gwApi.fileView(gp,f,gwCfg)).filter(f=>f.visibility==='public')});
  return fail(res,404,'Not found');
 }
 if(parts[3]==='files'&&parts[4]){
  const owner=db.portals.find(p=>p.files.some(f=>f.id===parts[4])),f=owner&&owner.files.find(x=>x.id===parts[4]);
  if(!owner||!f)return fail(res,404,'Not found');
  const headerKey=String(req.headers['x-portal-key']||'').trim(),queryKey=String(url.searchParams.get('key')||'').trim(),key=headerKey||queryKey||null;
  const legacyOk=!!(key&&f.accessKeys&&tokenMatch(f.accessKeys,headerKey||queryKey));
  const session=resolveSession(req,url);
  const perms=session?((session.scopes||[]).includes('download')?['files.read','files.download']:['files.read']):[];
  const decision=gwApi.decideFile({portal:owner,file:f,key,keyOk:legacyOk,user:session?{id:session.id||'session',roles:[],permissions:perms}:null,session:{ip:req.socket.remoteAddress},permission:'files.download'});
  if(parts[5]==='access'&&parts.length===6)return json(res,200,{allowed:decision.allowed,reason:decision.reason,detail:decision.detail,checks:decision.checks,mode:decision.mode,visibility:decision.visibility,behaviour:decision.behaviour,url:decision.url});
  if(parts[5]==='download'&&parts.length===6&&method==='GET'){
   if(!decision.allowed){void audit('gateway.download.denied',{portalId:owner.id,fileId:f.id,reason:decision.reason});return json(res,403,{error:'Access denied',reason:decision.reason,detail:decision.detail})}
   const fp=path.join(filesRoot,owner.id,f.id);let stat;try{stat=await fsp.lstat(fp)}catch{return fail(res,404,'File unavailable')}
   if(!stat.isFile())return fail(res,404,'File unavailable');
   void audit('gateway.download',{portalId:owner.id,fileId:f.id});
   if(f.encrypted)return serveEncryptedFile(req,res,fp,f,()=>{counters.downloads++;void recordTelemetry('download',req,owner,f,url)});
   return streamDownload(req,res,fp,stat,f.name,()=>{counters.downloads++;void recordTelemetry('download',req,owner,f,url)});
  }
  return fail(res,404,'Not found');
 }
 return fail(res,404,'Not found');
}
if(parts[0]==='api'&&parts[1]==='v1'&&parts[2]==='p'){
const p=resolvePortal(parts[3]);if(!p)return fail(res,404,'Not found');const tail=parts.slice(4);const downloadRoute=tail[0]==='files'&&tail[2]==='download';const fileForSigned=downloadRoute?p.files.find(f=>f.id===tail[1]):null;const signed=!!(fileForSigned&&fileMode(fileForSigned)==='FREE'&&signedValid(url,p,fileForSigned));if((requirePortalToken||p.visibility!=='public')&&(!signed||requirePortalToken)&&!portalAuthorized(req,p,downloadRoute?'download':'read',url))return fail(res,404,'Not found');
if(!tail.length&&method==='GET'){void recordTelemetry('visit',req,p,null,url);return json(res,200,publicPortal(p));}
if(tail[0]==='openapi.json'&&tail.length===1&&method==='GET'){try{return json(res,200,JSON.parse(await fsp.readFile(path.join(apiRoot,p.slug,'openapi.json'),'utf8')))}catch{return json(res,200,spec(p))}}
// QR кодът води към ПУБЛИЧНАТА СТРАНИЦА на портала (/p/<slug>), не към JSON API-то:
// сканиран с телефон, той отваря готовия списък с файлове, а не суров JSON.
if(tail[0]==='qr.svg'&&tail.length===1&&method==='GET'){res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});return res.end(qrSvg(portalLandingUrl(p,baseUrl(req))))}
// Legacy: portal QR без разширение пренасочва към каноничния .svg (Фаза 3.1).
if(tail[0]==='qr'&&tail.length===1&&method==='GET'){res.writeHead(301,{'Location':portalApiUrl(p,baseUrl(req))+'/qr.svg','Cache-Control':'no-store'});return res.end()}
if(tail[0]==='manifest'&&tail.length===1&&method==='GET'){
 // Манифестът води към виртуалното хранилище: всеки файл носи виртуален път,
 // а не физически път на диска.
 const vs=require('./virtual-storage'),tree=vs.buildTree(p.files);
 return json(res,200,{portal:publicPortal(p),storage:{virtual:true,root:'/',url:portalApiUrl(p,baseUrl(req))+'/storage',scheme:'/<topic>/<category>/<group>/<name>',folderCount:tree.folderCount,fileCount:tree.fileCount},files:p.files.filter(f=>f.listed!==false).map(f=>({...publicFile(f),accessMode:fileMode(f),path:vs.virtualPath(f)}))});
}
// Виртуално хранилище (Фаза 8): дърво topic → category → group → файл.
// `path` е виртуален (/Тема/Категория); физически пътища никога не се показват.
if(tail[0]==='storage'&&tail.length===1&&method==='GET'){
 const vs=require('./virtual-storage'),tree=vs.buildTree(p.files);
 const node=vs.resolve(tree,url.searchParams.get('path')||'/');
 if(!node)return fail(res,404,'Path not found');
 return json(res,200,{virtual:true,root:'/',path:node.path,type:node.type,name:node.name,folders:node.folders||[],files:node.files||[],folderCount:tree.folderCount,fileCount:tree.fileCount});
}
// Папките от хранилището на портала (storage_root) като дърво с API за всяка папка.
// Само за отделена папка на портала: коренът /share или /media не се публикува.
if(tail[0]==='tree'&&(tail.length===1||(tail.length===2&&(tail[1]==='api.json'||tail[1]==='qr.svg')))&&method==='GET'){
 const root=portalRoot(p.storage_root||'/share');
 if(root==='/share'||root==='/media')return fail(res,403,'Folder API requires a dedicated folder (storage_root must be a subfolder)');
 const st=require('./storage-tree');
 const rel=st.normRel(url.searchParams.get('path')||'');
 if(rel===null)return fail(res,400,'Invalid path');
 let out;try{out=await collectStorageTree(root)}catch(e){return fail(res,e.status||500,e.message)}
 if(!out.exists)return fail(res,404,'Folder not found');
 // Скритите папки (флаг „видима“) не се показват в публичния API.
 const publicMeta=folderMetaOf(p);
 if(Object.values(publicMeta).some(f=>f.visible===false)){pruneHiddenFolders(out.tree,publicMeta);st.recount(out.tree);out.folderCount=out.tree.folderCount;out.fileCount=out.tree.fileCount}
 const node=st.resolve(out.tree,rel);
 if(!node)return fail(res,404,'Path not found');
 const apiRoot2=portalApiUrl(p,baseUrl(req))+'/tree';
 const folderUrl=folder=>`${apiRoot2}?path=${encodeURIComponent('/'+folder)}`;
 const apiUrl=folderUrl(rel);
 const folderView={
  portal:{slug:p.slug,title:p.title},
  folder:{path:'/'+rel,name:node.name,parent:rel?('/'+rel.split('/').slice(0,-1).join('/')):'/',folderCount:node.folderCount,fileCount:node.fileCount,bytes:node.bytes},
  urls:{listing:apiUrl,apiJson:apiRoot2+'/api.json?path='+encodeURIComponent('/'+rel),qr:apiRoot2+'/qr.svg?path='+encodeURIComponent('/'+rel)},
 };
 if(tail.length===2&&tail[1]==='qr.svg'){
  res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});
  return res.end(qrSvg(apiUrl));
 }
 if(tail.length===2&&tail[1]==='api.json'){
  void audit('folder.api',{portalId:p.id,path:'/'+rel});
  return json(res,200,{schema_version:'1.0',kind:'storage-folder',...folderView,apiUrl,folders:(node.folders||[]).map(f=>({name:f.name,path:'/'+f.path,folderCount:f.folderCount,fileCount:f.fileCount,bytes:f.bytes,apiUrl:folderUrl(f.path)})),files:(node.files||[]).map(f=>({name:f.name,path:'/'+f.path,size:f.size,modifiedAt:f.modifiedAt||''})),generatedAt:new Date().toISOString()});
 }
 void recordTelemetry('visit',req,p,null,url);
 return json(res,200,{storage:true,root:'/',...folderView,apiUrl,folders:(node.folders||[]).map(f=>({name:f.name,path:'/'+f.path,folderCount:f.folderCount,fileCount:f.fileCount,bytes:f.bytes,apiUrl:folderUrl(f.path)})),files:(node.files||[]).map(f=>({name:f.name,path:'/'+f.path,size:f.size,modifiedAt:f.modifiedAt||''}))});
}
if(tail[0]==='files'&&tail.length===1&&method==='GET')return json(res,200,filePage(p.files.filter(f=>f.listed!==false),url));
if(tail[0]==='files'&&tail[1]&&tail[2]==='rating'&&tail.length===3&&method==='POST'){
 const f=p.files.find(x=>x.id===tail[1]);if(!f||f.listed===false||fileMode(f)==='DISABLED')return fail(res,404,'Not found');
 const b=await parse(req);if(!Number.isInteger(b.stars)||b.stars<1||b.stars>5)return fail(res,400,'Rating must be 1-5');
 if(!resolveSession(req,url))return fail(res,401,'Login required for rating');
 const key=tokenId(req,url);
 const already=telemetry.recent.some(e=>e.event==='rating'&&e.fileId===f.id&&e.tokenId===key);
 if(already)return fail(res,409,'Already rated in recent activity');
 await recordTelemetry('rating',req,p,f,url,{stars:b.stars});return json(res,201,{rated:true});
}
if(tail[0]==='files'&&tail[1]){const f=p.files.find(x=>x.id===tail[1]);if(!f||f.listed===false)return fail(res,404,'Not found');if(tail.length===2&&method==='GET')return json(res,200,publicFile(f));if(tail.length===3&&tail[2]==='qr.svg'&&method==='GET'){res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});return res.end(qrSvg(fileDownloadUrl(p,f,baseUrl(req))))}if(tail.length===3&&tail[2]==='qr'&&method==='GET'){res.writeHead(301,{'Location':portalApiUrl(p,baseUrl(req))+'/files/'+encodeURIComponent(f.id)+'/qr.svg','Cache-Control':'no-store'});return res.end()}if(tail.length===3&&tail[2]==='download'&&method==='GET'){if(fileMode(f)==='DISABLED')return fail(res,403,'Download disabled');if(fileMode(f)==='KEY_REQUIRED'&&!tokenMatch(f.accessKeys,req.headers['x-file-key']))return fail(res,403,'File key required');const fp=path.join(filesRoot,p.id,f.id);let stat;try{stat=await fsp.lstat(fp)}catch{return fail(res,404,'File unavailable')}if(!stat.isFile())return fail(res,404,'File unavailable');if(f.encrypted)return serveEncryptedFile(req,res,fp,f,()=>{counters.downloads++;void recordTelemetry('download',req,p,f,url);void audit('file.download',{portalId:p.id,fileId:f.id,encrypted:true})});return streamDownload(req,res,fp,stat,f.name,()=>{counters.downloads++;void recordTelemetry('download',req,p,f,url);void audit('file.download',{portalId:p.id,fileId:f.id})})}if(tail.length===3&&tail[2]==='preview'&&method==='GET'){if(fileMode(f)==='DISABLED')return fail(res,403,'Preview disabled');if(fileMode(f)==='KEY_REQUIRED'&&!tokenMatch(f.accessKeys,req.headers['x-file-key']))return fail(res,403,'File key required');if(!runtime.settings.preview.enabled)return fail(res,503,'Preview disabled');const buf=readPlainBuffer(p,f);if(!buf)return fail(res,404,'File unavailable');const pv=preview.preview(buf,f.name);if(pv.kind==='inline'){res.writeHead(200,{'Content-Type':pv.mime,'Content-Length':buf.length,'Content-Disposition':'inline; filename*=UTF-8\'\''+encodeURIComponent(f.name.replace(/[\r\n]/g,'')),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(buf)}if(pv.kind==='html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});return res.end(preview.wrap(f.name,pv.html))}res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(pv.text)}if(tail.length===3&&tail[2]==='thumbnail.svg'&&method==='GET'){if(fileMode(f)==='DISABLED')return fail(res,403,'Thumbnail disabled');if(!runtime.settings.preview.thumbnails)return fail(res,503,'Thumbnails disabled');const th=preview.thumbnail(f.name);res.writeHead(200,{'Content-Type':th.mime,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"});return res.end(th.data)}}return fail(res,404,'Not found')}
// FD-6: правилата за експорт и preflight — само за административния канал.
if(parts[0]==='admin'&&parts[1]==='api'&&parts[2]==='v2'&&parts[3]==='export'){
 if(!adminGate(req,res,'*',method))return;
 const gwApi=require('./gateway-api');
 if(parts[4]==='rules'&&parts.length===5&&method==='GET')return json(res,200,gwApi.exportRulesPayload());
 if(parts[4]==='preflight'&&parts.length===5&&method==='POST'){const b=await parse(req);return json(res,200,gwApi.exportPreflight(b))}
 return fail(res,404,'Not found');
}
// PGP ключове и автоподписване на експортни пакети.
const packageSettings=()=>{const s=db.packageSettings||{};return {autoSign:s.autoSign===true,signKeyId:String(s.signKeyId||''),ttlHours:Number.isFinite(s.ttlHours)?s.ttlHours:72,maxKept:Number.isFinite(s.maxKept)?s.maxKept:50}};
const pgpKeyView=k=>({id:k.id,label:k.label,userId:k.userId,algorithm:k.algorithm,bits:k.bits,version:Number(k.version)||4,keyId:k.keyId,fingerprint:k.fingerprint,createdAt:k.createdAt,addedAt:k.addedAt,hasSecret:Boolean(k.secretEnc)});
const pgpKeyById=id=>(db.pgpKeys||[]).find(k=>k.id===id)||null;
const signerFor=(keyId)=>{const list=db.pgpKeys||[];const key=keyId?list.find(k=>k.id===keyId||k.keyId===keyId):list[0];return key||null};
const decryptSecret=key=>{if(!key||!key.secretEnc)return '';return fileCrypto.decrypt(Buffer.from(key.secretEnc,'base64'),adminToken).toString('utf8')};
/**
 * Всички файлове от папката на портала (storage_root), с относителен път.
 * Само реални файлове: без символни връзки и без скрити имена. Има твърди лимити.
 * `storagePath` стеснява обхвата до една подпапка (пакет на папка), но пътищата в
 * пакета остават пълни (`storage/<подпапка>/<файл>`), за да е еднозначно.
 */
async function collectStorageFiles(storageRoot,{maxFiles=500,maxBytes=64*1024*1024,storagePath=''}={}){
 const base=portalRoot(storageRoot);const out=[];let bytes=0;
 const storageTree=require('./storage-tree');
 const sub=storagePath?storageTree.normRel(storagePath):'';
 if(sub===null)throw Object.assign(new Error('Invalid storage path'),{status:400});
 async function walk(dir,rel){
  let entries;try{entries=await fsp.readdir(dir,{withFileTypes:true})}catch(e){if(e.code==='ENOENT'||e.code==='ENOTDIR')return;throw e}
  entries.sort((a,b)=>a.name.localeCompare(b.name));
  for(const entry of entries){
   if(entry.name.startsWith('.'))continue;
   if(entry.isSymbolicLink())continue;
   const full=path.join(dir,entry.name);const next=rel?`${rel}/${entry.name}`:entry.name;
   if(entry.isDirectory()){await walk(full,next);continue}
   if(!entry.isFile())continue;
   if(out.length>=maxFiles)throw Object.assign(new Error(`Твърде много файлове в хранилището (макс. ${maxFiles})`),{status:413});
   const stat=await fsp.stat(full);bytes+=stat.size;
   if(bytes>maxBytes)throw Object.assign(new Error(`Хранилището надвишава ${Math.round(maxBytes/1048576)} MB`),{status:413});
   out.push({name:entry.name,path:`storage/${next}`,data:await fsp.readFile(full),source:'storage'});
  }
 }
 await walk(sub?path.join(base,...sub.split('/')):base,sub);
 return out;
}
/** Флагове на папките (видима/медийна/заключена), нормализирани; липсващ = по подразбиране. */
function folderMetaOf(p){
 const src=p.folderMeta&&typeof p.folderMeta==='object'?p.folderMeta:{};
 const out={};
 for(const [key,value] of Object.entries(src)){
  if(!value||typeof value!=='object')continue;
  if(!key.startsWith('/'))continue;
  out[key]={visible:value.visible!==false,media:value.media===true,locked:value.locked===true};
 }
 return out;
}
/** Заключена ли е папката (или някой неин родител)? Връща пътя на заключената или ''. */
function lockedAncestor(meta,rel){
 const parts=String(rel||'').split('/').filter(Boolean).slice(0,-1);
 for(let i=0;i<=parts.length;i++){
  const key='/'+parts.slice(0,i).join('/');
  if(meta[key]&&meta[key].locked)return key;
 }
 return '';
}
/** Маха скритите папки (visible:false) от дърво — за публичния API. */
function pruneHiddenFolders(node,meta,prefix){
 const base=prefix||'';
 const kept=[];
 for(const child of node.folders||[]){
  const childPath=base?`${base}/${child.name}`:child.name;
  const flags=meta['/'+childPath];
  if(flags&&flags.visible===false)continue;
  pruneHiddenFolders(child,meta,childPath);
  kept.push(child);
 }
 node.folders=kept;
 return node;
}
/**
 * Дървото на папката на портала (storage_root): само метаданни, без съдържание.
 * Скритите файлове и символните връзки се пропускат; има твърди лимити, за да
 * не блокира голяма папка. Връща и броячи, за да не се смятат в GUI-я.
 */
async function collectStorageTree(storageRoot,{maxEntries=2000,maxDepth=12}={}){
 const base=portalRoot(storageRoot);const entries=[];const dirs=[];let truncated=false,exists=false;
 try{const stat=await fsp.stat(base);exists=stat.isDirectory()}catch{exists=false}
 async function walk(dir,rel,depth){
  if(entries.length>=maxEntries){truncated=true;return}
  if(depth>maxDepth){truncated=true;return}
  let list;try{list=await fsp.readdir(dir,{withFileTypes:true})}catch(e){if(e.code==='ENOENT'||e.code==='ENOTDIR'||e.code==='EACCES'||e.code==='EPERM')return;throw e}
  list.sort((a,b)=>a.name.localeCompare(b.name,'bg'));
  for(const entry of list){
   if(entry.name.startsWith('.'))continue;
   if(entry.isSymbolicLink())continue;
   const next=rel?`${rel}/${entry.name}`:entry.name;
   // Папките се запомнят и когато са празни (за да се виждат в експлорера).
   if(entry.isDirectory()){dirs.push(next);await walk(path.join(dir,entry.name),next,depth+1);continue}
   if(!entry.isFile())continue;
   if(entries.length>=maxEntries){truncated=true;return}
   const stat=await fsp.stat(path.join(dir,entry.name)).catch(()=>null);
   entries.push({path:next,size:stat?stat.size:0,modifiedAt:stat?stat.mtime.toISOString():''});
  }
 }
 await walk(base,'',0);
 const storageTree=require('./storage-tree');
 const tree=storageTree.build(entries);
 // Празните папки също се показват (build създава само папки, в които има файлове).
 if(dirs.length){for(const rel of dirs)storageTree.addFolder(tree,rel);storageTree.sortTree(tree);storageTree.recount(tree)}
 return {storageRoot:base,exists,truncated,tree,folderCount:tree.folderCount,fileCount:tree.fileCount,bytes:tree.bytes};
}
if(parts[0]==='admin'&&parts[1]==='api'&&parts[2]==='pgp'&&parts[3]==='keys'){
 if(!adminGate(req,res,'pgp',method))return;
 if(parts.length===4&&method==='GET')return json(res,200,{keys:(db.pgpKeys||[]).map(pgpKeyView),settings:packageSettings()});
 if(parts.length===4&&method==='POST'){
  // Само ПРИКАЧАНЕ на готов ключ — сървърът не генерира ключове.
  const b=await parse(req);const label=clean(b.label).slice(0,80)||'PGP ключ';
  const secretInput=typeof b.secretArmored==='string'?b.secretArmored.trim():'';
  if(!secretInput)return fail(res,400,'Прикачи PGP ключ (armored PRIVATE KEY BLOCK)');
  let material;
  try{
   const parsed=pgp.parseKeyBlock(secretInput);const info=pgp.describe(parsed);
   if(!info.hasSecret)throw Object.assign(new Error('Липсва секретен ключ — прикачи PRIVATE KEY BLOCK'),{status:400});
   material={secretArmored:secretInput,info,publicArmored:pgp.publicKeyOf(secretInput)};
  }catch(e){return fail(res,e.status||400,e.message||'Invalid PGP key')}
  const dup=(db.pgpKeys||[]).find(k=>k.keyId===material.info.keyId);
  if(dup)return fail(res,409,'Този ключ вече е добавен');
  const enc=fileCrypto.encrypt(Buffer.from(material.secretArmored,'utf8'),adminToken).toString('base64');
  const record={id:id(),label,userId:material.info.userId||'',algorithm:material.info.algorithm,bits:material.info.bits||0,version:Number(material.info.version)||4,keyId:material.info.keyId,fingerprint:material.info.fingerprint,createdAt:material.info.createdAt,addedAt:new Date().toISOString(),publicArmored:material.publicArmored,secretEnc:enc};
  return json(res,201,await update(()=>{db.pgpKeys=[...(db.pgpKeys||[]),record];if(!packageSettings().signKeyId)db.packageSettings={...packageSettings(),signKeyId:record.id};void audit('pgp.key.add',{id:record.id,keyId:record.keyId,algorithm:record.algorithm});return pgpKeyView(record)}));
 }
 if(parts.length===6&&parts[5]==='public'&&method==='GET'){const key=pgpKeyById(parts[4]);if(!key)return fail(res,404,'Not found');return json(res,200,{id:key.id,keyId:key.keyId,fingerprint:key.fingerprint,publicArmored:key.publicArmored})}
 if(parts.length===5&&method==='DELETE')return json(res,200,await update(()=>{const key=pgpKeyById(parts[4]);if(!key)throw Object.assign(new Error('Not found'),{status:404});db.pgpKeys=(db.pgpKeys||[]).filter(k=>k.id!==key.id);const s=packageSettings();const rest=db.pgpKeys;const signKeyId=s.signKeyId===key.id?((rest[0]||{}).id||''):(rest.some(k=>k.id===s.signKeyId)?s.signKeyId:((rest[0]||{}).id||''));db.packageSettings={...s,signKeyId,autoSign:rest.length?s.autoSign:false};void audit('pgp.key.remove',{id:key.id,keyId:key.keyId});return {removed:key.id,autoSign:db.packageSettings.autoSign,keys:rest.length}}));
 return fail(res,404,'Not found');
}
// Експортни пакети: ZIP + манифест + хешове + незадължителен PGP подпис.
if(parts[0]==='admin'&&parts[1]==='api'&&parts[2]==='packages'){
 if(!adminGate(req,res,'packages',method))return;
 const settings=packageSettings();
 if(parts.length===3&&method==='GET'){await packager.prune({maxAgeHours:settings.ttlHours,maxCount:settings.maxKept}).catch(()=>{});return json(res,200,{packages:await packager.list(),settings,limits:packager.limits})}
 if(parts.length===3&&method==='POST'){
  const b=await parse(req);const portalId=clean(b.portalId);const p=db.portals.find(x=>x.id===portalId);
  if(!p)return fail(res,404,'Portal not found');
  const wanted=Array.isArray(b.fileIds)&&b.fileIds.length?new Set(b.fileIds.map(x=>String(x))):null;
  const chosen=p.files.filter(f=>!wanted||wanted.has(f.id));
  const includeStorage=b.includeStorage===true;
  // Пакет на една папка от хранилището („Изтегли пакета“ на папка).
  const storagePath=clean(b.storagePath);
  if(!chosen.length&&!includeStorage&&!storagePath)return fail(res,400,'Няма избрани файлове');
  const files=[];const missing=[];
  for(const f of chosen){const buf=readPlainBuffer(p,f);if(!buf){missing.push(f.id);continue}files.push({name:f.name,data:buf,source:'portal'})}
  if(missing.length)return fail(res,409,'Липсващи или недешифрируеми файлове: '+missing.join(', '));
  if(includeStorage||storagePath){
   let storage=[];
   try{storage=await collectStorageFiles(p.storage_root||'/share',{storagePath})}catch(e){return fail(res,e.status||500,e.message)}
   files.push(...storage);
   if(!files.length)return fail(res,404,storagePath?`Папката ${storagePath} е празна или липсва`:`Папката на портала е празна или липсва: ${p.storage_root||'/share'}`);
  }
  const wantSign=b.sign===false?false:b.sign===true?true:settings.autoSign;
  let sign=null;const keyId=clean(b.keyId)||settings.signKeyId;
  if(wantSign){
   const key=signerFor(keyId);
   if(!key)return fail(res,400,'Няма PGP ключ за автоподписване — прикачи ключ в „Настройки“');
   const secretArmored=decryptSecret(key);
   if(!secretArmored)return fail(res,400,'Ключът няма секретна част');
   sign={secretArmored,keyId:key.keyId,label:key.label};
  }
  let meta;
  try{meta=await packager.build({portal:p,files,sign,ttlHours:settings.ttlHours})}catch(e){return fail(res,e.status||500,e.message)}
  await packager.prune({maxAgeHours:settings.ttlHours,maxCount:settings.maxKept}).catch(()=>{});
  void audit('package.build',{portalId:p.id,packageId:meta.id,files:meta.files,signed:meta.hasSignature,sha256:meta.sha256});
  return json(res,201,meta);
 }
 if(parts.length===4&&parts[3]==='settings'&&method==='PATCH'){
  const b=await parse(req);
  const next={...packageSettings()};
  if(b.autoSign!==undefined){
   // Автоподписване има смисъл само след прикачен ключ.
   if(b.autoSign===true&&!(db.pgpKeys||[]).length)return fail(res,400,'Няма прикачен PGP ключ — прикачи ключ в „Настройки“');
   next.autoSign=b.autoSign===true;
  }
  if(b.signKeyId!==undefined){const keyId=clean(b.signKeyId);if(keyId&&!pgpKeyById(keyId))return fail(res,400,'Unknown PGP key');next.signKeyId=keyId}
  if(b.ttlHours!==undefined){const ttl=Number(b.ttlHours);if(!Number.isFinite(ttl)||ttl<1||ttl>24*365)return fail(res,400,'Invalid TTL');next.ttlHours=ttl}
  if(b.maxKept!==undefined){const max=Number(b.maxKept);if(!Number.isInteger(max)||max<1||max>1000)return fail(res,400,'Invalid maxKept');next.maxKept=max}
  return json(res,200,await update(()=>{db.packageSettings=next;void audit('package.settings',next);return next}));
 }
 if(parts.length===4&&method==='GET'){
  let meta;try{meta=await packager.readMeta(parts[3])}catch(e){return fail(res,e.status||400,e.message)}
  if(!meta)return fail(res,404,'Not found');
  return json(res,200,meta);
 }
 if(parts.length===5&&parts[4]==='download'&&method==='GET'){
  const a=await packager.artifact(parts[3],'zip');if(!a)return fail(res,404,'Not found');
  return streamDownload(req,res,a.file,a.stat,a.name,()=>{void audit('package.download',{packageId:a.meta.id,size:a.meta.size})});
 }
 if(parts.length===5&&parts[4]==='signature'&&method==='GET'){
  const a=await packager.artifact(parts[3],'signature');if(!a)return fail(res,404,'Not found');
  const text=await fsp.readFile(a.file,'utf8');
  res.writeHead(200,{'Content-Type':'application/pgp-signature; charset=utf-8','Content-Length':Buffer.byteLength(text),'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(a.name),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  return res.end(text);
 }
 if(parts.length===5&&parts[4]==='verify'&&method==='POST'){
  const a=await packager.artifact(parts[3],'zip');if(!a)return fail(res,404,'Not found');
  const sigArtifact=await packager.artifact(parts[3],'signature');
  const b=await parse(req);
  let publicArmored=clean(b.publicArmored);
  if(!publicArmored){const key=(db.pgpKeys||[]).find(k=>k.keyId===a.meta.signature.keyId)||null;publicArmored=key?key.publicArmored:''}
  if(!sigArtifact)return json(res,200,{valid:false,reason:'NO_SIGNATURE'});
  if(!publicArmored)return fail(res,400,'Липсва публичен ключ за проверка');
  const zipBuf=await fsp.readFile(a.file);
  const armored=await fsp.readFile(sigArtifact.file,'utf8');
  const out=pgp.verifyDetached(zipBuf,armored,publicArmored);
  void audit('package.verify',{packageId:a.meta.id,valid:out.valid,reason:out.reason||''});
  return json(res,200,{...out,packageId:a.meta.id,sha256:a.meta.sha256});
 }
 if(parts.length===4&&method==='DELETE')return json(res,200,await packager.remove(parts[3]));
 return fail(res,404,'Not found');
}
if(parts[0]==='admin'&&parts[1]==='api'&&parts[2]==='cases'){
 if(!adminGate(req,res,'cases',method))return;
 const C=require('./cases');
 if(parts.length===3&&method==='GET')return json(res,200,C.list(db));
 if(parts.length===3&&method==='POST'){const b=await parse(req);return json(res,201,await update(()=>{const c=C.addCase(db,b);void audit('case.add',{id:c.id,number:c.number});return c}))}
 if(parts.length===4&&method==='PATCH'){const b=await parse(req);return json(res,200,await update(()=>{const c=C.patchCase(db,parts[3],b);void audit('case.update',{id:c.id});return c}))}
 if(parts.length===4&&method==='DELETE')return json(res,200,await update(()=>{const r=C.removeCase(db,parts[3]);void audit('case.remove',{id:parts[3]});return r}));
 return fail(res,404,'Not found');
}
if(parts[0]==='admin'&&parts[1]==='api'&&(parts[2]==='variables'||parts[2]==='directory')){
 if(!adminGate(req,res,'directory',method))return;
 const D=require('./directory');
 if(parts[2]==='variables'){
  if(parts.length===3&&method==='GET'){D.state(db);return json(res,200,{types:D.TYPES,variables:D.listVariables(db)})}
  if(parts.length===3&&method==='POST'){const b=await parse(req);return json(res,201,await update(()=>{const v=D.addVariable(db,b);void audit('variable.add',{key:v.key});return v}))}
  if(parts.length===4&&method==='PATCH'){const b=await parse(req);return json(res,200,await update(()=>{const v=D.patchVariable(db,parts[3],b);void audit('variable.update',{key:parts[3]});return v}))}
  if(parts.length===4&&method==='DELETE')return json(res,200,await update(()=>{const r=D.removeVariable(db,parts[3]);void audit('variable.remove',{key:parts[3]});return r}));
  return fail(res,404,'Not found');
 }
 if(parts.length===3&&method==='GET')return json(res,200,D.view(db));
 if(parts[3]==='ingest'&&method==='POST'){const b=await parse(req);return json(res,200,await update(()=>{const r=D.ingest(db,b.emails,runtime.settings.data);void audit('directory.ingest',{created:r.created.length,conflicts:r.conflicts});return r}))}
 if(parts[3]==='rules'&&parts.length===4&&method==='POST'){const b=await parse(req);return json(res,201,await update(()=>{const r=D.addRule(db,b,runtime.settings.data);void audit('directory.rule.add',{pattern:r.rule.pattern});return r}))}
 if(parts[3]==='rules'&&parts.length===5&&method==='DELETE')return json(res,200,await update(()=>{const r=D.removeRule(db,parts[4]);void audit('directory.rule.remove',{id:parts[4]});return r}));
 if(parts[3]==='contacts'&&parts.length===4&&method==='POST'){const b=await parse(req);return json(res,201,await update(()=>{const c=D.addContact(db,b);void audit('directory.contact.add',{id:c.id});return c}))}
 if(parts[3]==='contacts'&&parts.length===5&&method==='PATCH'){const b=await parse(req);return json(res,200,await update(()=>D.patchContact(db,parts[4],b.fields,b.extras)))}
 if(parts[3]==='contacts'&&parts.length===5&&method==='DELETE')return json(res,200,await update(()=>D.removeContact(db,parts[4])));
 if(parts[3]==='conflicts'&&parts[5]==='resolve'&&method==='POST'){const b=await parse(req);return json(res,200,await update(()=>{const r=D.resolveConflict(db,parts[4],b.value);void audit('directory.conflict.resolve',{id:parts[4]});return r}))}
 return fail(res,404,'Not found');
}
if(parts[0]==='admin'&&parts[1]==='api'&&parts[2]==='cabinet'){
 if(!adminGate(req,res,'cabinet',method))return;
 const rel=url.searchParams.get('path')||'',act=parts[3]||'';
 if(act==='info'&&method==='GET')return json(res,200,{...cabinet.capabilities,localOpen:cabinet.capabilities.localOpen&&isLoopback(req)});
 if(act==='list'&&method==='GET')return json(res,200,await cabinet.list(rel));
 if(act==='folder'&&method==='POST'){const b=await parse(req);void audit('cabinet.folder',{path:clean(b.path)});return json(res,201,await cabinet.mkdir(clean(b.path),b.name))}
 if(act==='create'&&method==='POST'){const b=await parse(req);void audit('cabinet.create',{path:clean(b.path),type:b.type});return json(res,201,await cabinet.createFile(clean(b.path),b.name,b.type))}
 if(act==='upload'&&method==='POST'){const fn=fileNameHeader(req);if(!fn)return fail(res,400,'Invalid X-File-Name');const data=await body(req,cabinet.capabilities.maxBytes);void audit('cabinet.upload',{path:rel});return json(res,201,await cabinet.upload(rel,fn,data))}
 if(act==='save'&&method==='POST'){const data=await body(req,5*1024*1024);void audit('cabinet.save',{path:rel});return json(res,200,await cabinet.saveText(rel,data))}
 if(act==='file'&&method==='GET'){const f=await cabinet.file(rel);res.writeHead(200,{'Content-Type':f.mime,'Content-Length':f.size,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Disposition':(f.inline?'inline':'attachment')+"; filename*=UTF-8''"+encodeURIComponent(f.name)});return fs.createReadStream(f.abs).on('error',()=>res.destroy()).pipe(res)}
 if(act==='entry'&&method==='DELETE'){void audit('cabinet.delete',{path:rel});return json(res,200,await cabinet.remove(rel))}
 if(act==='rename'&&method==='POST'){const b=await parse(req);void audit('cabinet.rename',{path:clean(b.path)});return json(res,200,await cabinet.rename(clean(b.path),b.name))}
 if(act==='convert'&&method==='POST'){const b=await parse(req);void audit('cabinet.convert',{path:clean(b.path),to:b.to});return json(res,201,await cabinet.convert(clean(b.path),b.to))}
 if(act==='open'&&method==='POST'){if(!isLoopback(req))return fail(res,404,'Not found');const b=await parse(req);return json(res,200,await cabinet.open(clean(b.path)))}
 return fail(res,404,'Not found');
}
// --- DOCFLOW core API (Phase 1) ---
if(parts[0]==='admin'&&parts[1]==='api'&&parts[2]==='v2'){
 if(!adminGate(req,res,'core',method))return;
 const {registry,store}=coreReady();
 if(parts[3]==='profiles'&&parts.length===4&&method==='GET')return json(res,200,{profiles:registry.listProfiles()});
 if(parts[3]==='groups'){
  if(parts.length===4&&method==='GET'){return json(res,200,{groups:store.listGroups().map(g=>({...g,recordCount:store.listRecords(g.id).length}))})}
  if(parts.length===4&&method==='POST'){const b=await parse(req);const g=store.createGroup({name:clean(b.name),description:clean(b.description),autoRecords:b.autoRecords!==false,registry});void audit('core.group.create',{groupId:g.id});return json(res,201,g)}
  if(parts.length===5){
   if(method==='GET'){const g=store.getGroup(parts[4]);if(!g)return fail(res,404,'Group not found');return json(res,200,{...g,records:store.listRecords(g.id)})}
   if(method==='PATCH'){const b=await parse(req);const g=store.updateGroup(parts[4],{name:b.name,description:b.description});void audit('core.group.update',{groupId:g.id});return json(res,200,g)}
   if(method==='DELETE'){store.deleteGroup(parts[4]);void audit('core.group.delete',{groupId:parts[4]});return json(res,200,{deleted:parts[4]})}
  }
 }
 if(parts[3]==='records'){
  if(parts.length===4&&method==='GET'){const groupId=url.searchParams.get('group_id')||null,prefix=url.searchParams.get('prefix')||null;let recs=store.listRecords(groupId);if(prefix)recs=recs.filter(r=>r.prefix===prefix);return json(res,200,{records:recs})}
  if(parts.length===4&&method==='POST'){const b=await parse(req);const r=store.createRecord({prefix:String(b.prefix),group_id:b.group_id||null,fields:b.fields||{},registry});void audit('core.record.create',{recordId:r.id,prefix:r.prefix});return json(res,201,r)}
  if(parts.length===5){
   const r=store.getRecord(parts[4]);if(!r)return fail(res,404,'Record not found');
   if(method==='GET')return json(res,200,r);
   if(method==='PATCH'){const b=await parse(req);const defs=registry.fieldsFor(r.prefix);for(const [f,v] of Object.entries(b.fields||{})){const def=defs.find(x=>x.name===f);store.setVariable(r.id,f,registry.validateField(r.prefix,f,v),def)}void audit('core.record.update',{recordId:r.id});return json(res,200,store.getRecord(r.id))}
   if(method==='DELETE'){store.deleteRecord(parts[4]);void audit('core.record.delete',{recordId:parts[4]});return json(res,200,{deleted:parts[4]})}
  }
  if(parts.length===6&&parts[5]==='associate'&&method==='POST'){const b=await parse(req);const r=store.associateRecord(parts[4],String(b.groupId||''));void audit('core.record.associate',{recordId:r.id,groupId:r.group_id});return json(res,200,r)}
  if(parts.length===6&&parts[5]==='detach'&&method==='POST'){const r=store.detachRecord(parts[4]);void audit('core.record.detach',{recordId:r.id});return json(res,200,r)}
 }
 if(parts[3]==='search'&&parts.length===4&&method==='GET'){const prefix=url.searchParams.get('prefix')||null,q=url.searchParams.get('q')||'';return json(res,200,{results:store.search(prefix,q)})}
 if(parts[3]==='migrate'&&parts.length===4&&method==='GET'){const bridge=require('./migration-bridge').create({root,store,registry});return json(res,200,await bridge.analyze(db))}
 if(parts[3]==='migrate'&&parts.length===4&&method==='POST'){const b=await parse(req);const dryRun=!!b.dryRun;const bridge=require('./migration-bridge').create({root,store,registry});const out=await bridge.migrate(db,{dryRun});void audit('core.migrate',{dryRun});return json(res,200,out)}
 // Report Studio (Фаза 11 / RS-03): манифест → PDF. Без фалшиви TSA токени:
 // манифест, съдържащ tsaToken/подпис/сертификат, се отхвърля от валидатора.
 if(parts[3]==='reports'&&parts[4]==='render'&&parts.length===5&&method==='POST'){
  let payload;try{payload=JSON.parse((await body(req,1024*1024)).toString('utf8'))}catch(e){return fail(res,e.status||400,e.status?e.message:'Invalid JSON')}
  try{
   const manifest=(payload&&payload.manifest)||payload;
   const reportRender=require('./report-render');
   const pdf=reportRender.renderPdf(manifest,{data:(payload&&payload.data)||{},hashes:(payload&&payload.hashes)||{},watermark:payload&&payload.watermark});
   const digest=require('./report-manifest').digest(manifest)||'';
   const safeName=String((manifest&&manifest.profile)||'default').replace(/[^A-Za-z0-9._-]/g,'_').slice(0,48);
   void audit('report.render',{profile:(manifest&&manifest.profile)||'',digest});
   res.writeHead(201,{'Content-Type':'application/pdf','Content-Length':pdf.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Manifest-SHA256':digest,'Content-Disposition':'attachment; filename="report-'+safeName+'.pdf"'});
   return res.end(pdf);
  }catch(e){return fail(res,e.status||500,(e.code?e.code+': ':'')+(e.message||'Report render failed'))}
 }
 // Публично API на портал (Фаза 8): създава хранилището api/<slug>/ и връща
 // препратките към него (api.json, openapi.json, manifest, files, qr).
 if(parts[3]==='portals'&&parts.length===6&&parts[5]==='api'){
  const portal=getPortal(decodeURIComponent(parts[4]));
  if(!portal)return fail(res,404,'Portal not found');
  const registry=require('./api-registry').create({root:apiRoot,baseUrl:baseUrl(req),qrSvg});
  try{
   if(method==='GET'){const record=await registry.read(portal);if(!record)return fail(res,404,'API not generated');const p=registry.paths(portal);return json(res,200,{record,references:record.links,disk:{dir:p.dir,files:require('./api-registry').FILES}})}
   if(method==='POST'){const out=await registry.ensure(portal);void audit('portal.api.generate',{slug:portal.slug});return json(res,201,out)}
   if(method==='DELETE'){const out=await registry.remove(portal);void audit('portal.api.remove',{slug:portal.slug});return json(res,200,out)}
   return fail(res,405,'Method not allowed');
  }catch(e){return fail(res,e.status||500,e.message||'API generation failed')}
 }
 return fail(res,404,'Not found');
}
if(parts[0]==='admin'&&parts[1]==='api'){if(!adminGate(req,res,'portals',method))return;if(parts[2]==='taxonomy'&&parts.length===3){
 const tx=()=>({categories:[...((db.taxonomy||{}).categories||[])],groups:[...((db.taxonomy||{}).groups||[])]});
 if(method==='GET')return json(res,200,tx());
 const key=k=>k==='category'?'categories':k==='group'?'groups':null;
 if(method==='POST'){const b=await parse(req),k=key(b.kind),nm=clean(b.name);if(!k||!nm||nm.length>80||/[\u0000-\u001f]/.test(nm))return fail(res,400,'Invalid name');
  return json(res,201,await update(()=>{db.taxonomy??={categories:[],groups:[]};db.taxonomy[k]??=[];if(db.taxonomy[k].some(x=>x.toLowerCase()===nm.toLowerCase()))throw Object.assign(new Error('Already exists'),{status:409});db.taxonomy[k].push(nm);db.taxonomy[k].sort((a,c)=>a.localeCompare(c));void audit('taxonomy.add',{kind:b.kind,name:nm});return tx()}))}
 if(method==='DELETE'){const k=key(url.searchParams.get('kind')),nm=clean(url.searchParams.get('name'));if(!k||!nm)return fail(res,400,'Invalid request');
  return json(res,200,await update(()=>{const list=(db.taxonomy||{})[k]||[];if(!list.includes(nm))throw Object.assign(new Error('Not found'),{status:404});db.taxonomy[k]=list.filter(x=>x!==nm);void audit('taxonomy.remove',{kind:url.searchParams.get('kind'),name:nm});return tx()}))}
}
if(parts[2]==='portals'){if(parts.length===3&&method==='GET')return json(res,200,{portals:db.portals.map(adminPortal)});
if(parts.length===3&&method==='POST'){const b=await parse(req),slug=clean(b.slug),title=clean(b.title);if(!validSlug(slug)||!title||title.length>160)return fail(res,400,'Invalid title or slug');
 // Видимостта се задава още при създаването (формата я има), не само после с PATCH.
 const visibility=b.visibility===undefined?'private':String(b.visibility);if(!['private','public'].includes(visibility))return fail(res,400,'Invalid visibility');
 return json(res,201,await update(async()=>{if(getPortal(slug))throw Object.assign(new Error('Slug exists'),{status:409});const p={id:id(),slug,title,description:clean(b.description).slice(0,2000),notesText:clean(b.notes).slice(0,2000),category:clean(b.category).slice(0,120),subject:clean(b.subject).slice(0,200),flag:portalFlag(b.flag),storage_root:portalRoot(b.storage_root),contactId:portalContact(db,b.contactId),caseId:portalCase(db,b.caseId),visibility,createdAt:new Date().toISOString(),files:[]};await fsp.mkdir(path.join(filesRoot,p.id),{recursive:true});db.portals.push(p);await writeApiDir(p,baseUrl(req));void audit('portal.update',{portalId:p.id});return adminPortal(p)}))}
if(parts[3]==='merge'&&parts.length===4&&method==='POST'){
 const b=await parse(req);
 if(!b||typeof b.targetId!=='string'||!Array.isArray(b.sourceIds)||!b.sourceIds.length||b.sourceIds.length>50||b.sourceIds.some(x=>typeof x!=='string')||new Set(b.sourceIds).size!==b.sourceIds.length||b.sourceIds.includes(b.targetId))return fail(res,400,'Invalid merge request');
 const target=db.portals.find(x=>x.id===b.targetId),sources=b.sourceIds.map(sid=>db.portals.find(x=>x.id===sid));
 if(!target||sources.some(s=>!s))return fail(res,404,'Portal not found');
 const merged=await update(async()=>{
  const moved=[];const mv=async(from,to)=>{try{await fsp.mkdir(path.dirname(to),{recursive:true});await fsp.rename(from,to);moved.push([from,to])}catch(e){if(e.code!=='ENOENT')throw e}};
  try{
   for(const s of sources){
    for(const f of s.files){if(target.files.some(x=>x.id===f.id))throw Object.assign(new Error('File id conflict'),{status:409});await mv(path.join(filesRoot,s.id,f.id),path.join(filesRoot,target.id,f.id))}
    for(const a of s.attachments||[])await mv(path.join(internalRoot,s.id,a.id),path.join(internalRoot,target.id,a.id));
   }
  }catch(e){for(const [from,to] of moved.reverse())await fsp.rename(to,from).catch(()=>{});throw e}
  for(const s of sources){
   target.files.push(...s.files);target.notesText=target.notesText||s.notesText||'';target.notes=[...(target.notes||[]),...(s.notes||[])];target.attachments=[...(target.attachments||[]),...(s.attachments||[])];target.htmlProjects=[...(target.htmlProjects||[]),...(s.htmlProjects||[])];
   await fsp.rm(path.join(filesRoot,s.id),{recursive:true,force:true});await fsp.rm(path.join(internalRoot,s.id),{recursive:true,force:true});await fsp.rm(path.join(apiRoot,s.slug),{recursive:true,force:true});
  }
  db.portals=db.portals.filter(x=>!sources.includes(x));
  await writeApiDir(target,baseUrl(req));void audit('portal.merge',{targetId:target.id,sources:sources.map(s=>s.id)});return adminPortal(target);
 });
 return json(res,200,merged);
}const p=db.portals.find(x=>x.id===parts[3]);if(!p)return fail(res,404,'Portal not found');
if(parts.length===4&&method==='GET')return json(res,200,adminPortal(p));
if(parts[4]==='api-info'&&parts.length===5&&method==='GET'){const base=baseUrl(req),apiUrl=portalApiUrl(p,base),landingUrl=portalLandingUrl(p,base);
 // Вътрешен адрес (LAN/localhost) значи QR код, който не се отваря отвън — връщаме флаг,
 // за да го покаже административният панел вместо да остави потребителя да го открие сам.
 const isLocal=/^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i.test(base);
 return json(res,200,{id:p.id,slug:p.slug,landingUrl,apiUrl,directory:'api/'+p.slug,qr:qrSvg(landingUrl),qrTarget:landingUrl,baseIsLocal:isLocal,base})}
// Дървото на папката на портала (експлорер): папки → подпапки → файлове.
// Всяка папка има собствен адрес в API-то (виж `tree/api.json`).
if(parts[4]==='tree'&&parts.length===5&&method==='GET'){
 let out;try{out=await collectStorageTree(p.storage_root||'/share')}catch(e){return fail(res,e.status||500,e.message)}
 const folderNotes=p.folderNotes&&typeof p.folderNotes==='object'?p.folderNotes:{};
 const folderMeta=folderMetaOf(p);
 void audit('portal.tree',{portalId:p.id,folderCount:out.folderCount,fileCount:out.fileCount,truncated:out.truncated});
 return json(res,200,{portal:{id:p.id,slug:p.slug,title:p.title},storageRoot:out.storageRoot,exists:out.exists,truncated:out.truncated,folderCount:out.folderCount,fileCount:out.fileCount,bytes:out.bytes,tree:out.tree,folderNotes,folderMeta,generatedAt:new Date().toISOString()});
}
// Нова папка в папката на портала (само вътре в storage_root).
if(parts[4]==='tree'&&parts[5]==='folder'&&parts.length===6&&method==='POST'){
 const st=require('./storage-tree');const b=await parse(req);
 const parent=st.normRel(b.parent||'');
 if(parent===null)return fail(res,400,'Invalid path');
 const name=clean(b.name);
 if(!name||name==='.'||name==='..'||name.length>100||/[/\\\u0000-\u001f]/.test(name))return fail(res,400,'Invalid folder name');
 const rel=st.normRel(parent?`${parent}/${name}`:name);
 if(rel===null)return fail(res,400,'Invalid path');
 const root=portalRoot(p.storage_root||'/share');
 const full=path.resolve(root,parent,name);
 if(full!==path.resolve(root,rel)||!full.startsWith(path.resolve(root)+path.sep))return fail(res,400,'Invalid path');
 try{await fsp.mkdir(full)}
 catch(e){
  if(e.code==='EEXIST')return fail(res,409,'Папката вече съществува');
  if(e.code==='ENOENT')return fail(res,404,'Родителската папка липсва');
  return fail(res,500,'Папката не може да бъде създадена: '+e.code);
 }
 void audit('portal.tree.folder',{portalId:p.id,path:'/'+rel});
 return json(res,201,{path:'/'+rel,name,parent:'/'+parent,created:true});
}
// Флагове на папка: видима / медийна / заключване (пазят се към портала).
if(parts[4]==='tree'&&parts[5]==='folder'&&parts.length===6&&method==='PATCH'){
 const st=require('./storage-tree');const b=await parse(req);
 const rel=st.normRel(b.path||'');
 if(rel===null)return fail(res,400,'Invalid path');
 const current=folderMetaOf(p)['/'+rel]||{visible:true,media:false,locked:false};
 const next={visible:current.visible!==false,media:current.media===true,locked:current.locked===true};
 for(const key of ['visible','media','locked']){
  if(b[key]===undefined)continue;
  if(typeof b[key]!=='boolean')return fail(res,400,'Invalid '+key);
  next[key]=b[key];
 }
 const saved=await update(()=>{
  p.folderMeta=p.folderMeta&&typeof p.folderMeta==='object'?p.folderMeta:{};
  const key='/'+rel;
  // Пази се само ако е различно от подразбирането, за да не расте базата.
  if(next.visible===false||next.media||next.locked)p.folderMeta[key]={visible:next.visible,media:next.media,locked:next.locked};
  else delete p.folderMeta[key];
  void audit('portal.tree.folder.meta',{portalId:p.id,path:key,visible:next.visible,media:next.media,locked:next.locked});
  return {path:key,...next};
 });
 return json(res,200,saved);
}
// Прикачване на файл в папката на портала (storage_root): тялото е съдържанието,
// пътят идва като ?path=/подпапка/файл.txt (родителските папки се създават).
if(parts[4]==='tree'&&parts[5]==='upload'&&parts.length===6&&method==='POST'){
 const st=require('./storage-tree');
 const rel=st.normRel(url.searchParams.get('path')||'');
 if(rel===null||!rel)return fail(res,400,'Invalid path');
 const name=rel.split('/').pop()||'';
 if(!name||name.startsWith('.')||name.length>240||/[\u0000-\u001f]/.test(name))return fail(res,400,'Invalid file name');
 const meta=folderMetaOf(p);
 const locked=lockedAncestor(meta,rel);
 if(locked)return fail(res,409,`Папката ${locked} е заключена`);
 const data=await body(req,runtime.effective().maxUploadBytes);
 if(!data.length)return fail(res,400,'Празен файл');
 const root=portalRoot(p.storage_root||'/share');
 const rootAbs=path.resolve(root);
 const full=path.resolve(rootAbs,...rel.split('/'));
 if(full!==rootAbs&&!full.startsWith(rootAbs+path.sep))return fail(res,400,'Invalid path');
 const overwrite=url.searchParams.get('overwrite')==='1';
 const exists=await fsp.access(full).then(()=>true,()=>false);
 if(exists&&!overwrite)return fail(res,409,'Файлът вече съществува');
 try{
  await fsp.mkdir(path.dirname(full),{recursive:true});
  await fsp.writeFile(full,data);
 }catch(e){return fail(res,500,`Файлът не може да бъде записан: ${e.code||e.message}`)}
 void audit('portal.tree.upload',{portalId:p.id,path:'/'+rel,size:data.length,overwritten:exists});
 return json(res,201,{path:'/'+rel,name,parent:'/'+rel.split('/').slice(0,-1).join('/'),size:data.length,overwritten:exists});
}
// Коментар към папка (пази се към портала; празен текст го изтрива).
if(parts[4]==='tree'&&parts[5]==='comment'&&parts.length===6&&method==='POST'){
 const st=require('./storage-tree');const b=await parse(req);
 const rel=st.normRel(b.path||'');
 if(rel===null)return fail(res,400,'Invalid path');
 const text=clean(b.comment).slice(0,1000);
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))return fail(res,400,'Invalid comment');
 const saved=await update(()=>{
  p.folderNotes=p.folderNotes&&typeof p.folderNotes==='object'?p.folderNotes:{};
  if(text)p.folderNotes['/'+rel]={text,at:new Date().toISOString()};
  else delete p.folderNotes['/'+rel];
  void audit('portal.tree.comment',{portalId:p.id,path:'/'+rel,hasText:Boolean(text)});
  return {path:'/'+rel,comment:text,notes:p.folderNotes};
 });
 return json(res,200,saved);
}
// Регистриране на файл от папката на портала: файлът на диска става файл в портала
// (с id, SHA-256, версия, политика) — така картата му получава всички метаданни.
if(parts[4]==='tree'&&parts[5]==='register'&&parts.length===6&&method==='POST'){
 const st=require('./storage-tree');const b=await parse(req);
 const rel=st.normRel(b.path||'');
 if(rel===null||!rel)return fail(res,400,'Invalid path');
 const name=rel.split('/').pop()||'';
 if(!name||name.startsWith('.')||name.length>240)return fail(res,400,'Invalid file name');
 if(p.files.some(f=>String(f.name||'').toLowerCase()===name.toLowerCase()))return fail(res,409,'Файл с това име вече е регистриран в портала');
 const root=portalRoot(p.storage_root||'/share');
 const rootAbs=path.resolve(root);
 const full=path.resolve(rootAbs,...rel.split('/'));
 if(!full.startsWith(rootAbs+path.sep))return fail(res,400,'Invalid path');
 let stat;try{stat=await fsp.lstat(full)}catch{return fail(res,404,'Файлът не е намерен')}
 if(!stat.isFile())return fail(res,400,'Пътят не е файл');
 if(stat.size>runtime.effective().maxUploadBytes)return fail(res,413,'Файлът е твърде голям за регистриране');
 const data=await fsp.readFile(full);
 return json(res,201,await update(async()=>{
  const f={id:id(),name,size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),uploadedAt:new Date().toISOString(),category:runtime.settings.data.defaultCategory,group:runtime.settings.data.defaultGroup};
  await fsp.mkdir(path.join(filesRoot,p.id),{recursive:true});
  await fsp.writeFile(path.join(filesRoot,p.id,f.id),data,{flag:'wx',mode:0o600});
  p.files.push(f);
  void audit('file.register.storage',{portalId:p.id,fileId:f.id,path:'/'+rel});
  return publicFile(f);
 },async f=>{await fsp.rm(path.join(filesRoot,p.id,f.id),{force:true})}));
}
// Описание (api.json) на една папка: собствени адреси, броячи и съдържание на едно ниво.
if(parts[4]==='tree'&&parts[5]==='api.json'&&parts.length===6&&method==='GET'){
 const st=require('./storage-tree');
 const rel=st.normRel(url.searchParams.get('path')||'');
 if(rel===null)return fail(res,400,'Invalid path');
 let out;try{out=await collectStorageTree(p.storage_root||'/share')}catch(e){return fail(res,e.status||500,e.message)}
 const node=st.resolve(out.tree,rel);
 if(!node)return fail(res,404,'Path not found');
 const folderApi=folder=>`${baseUrl(req)}/admin/api/portals/${encodeURIComponent(p.id)}/tree?path=${encodeURIComponent('/'+folder)}`;
 const apiUrl=folderApi(rel);
 void audit('portal.tree.api',{portalId:p.id,path:'/'+rel});
 return json(res,200,{schema_version:'1.0',kind:'storage-folder',portal:{id:p.id,slug:p.slug,title:p.title},folder:{path:'/'+rel,name:node.name,parent:rel?('/'+rel.split('/').slice(0,-1).join('/')):'/',folderCount:node.folderCount,fileCount:node.fileCount,bytes:node.bytes},apiUrl,urls:{listing:apiUrl,apiJson:`${baseUrl(req)}/admin/api/portals/${encodeURIComponent(p.id)}/tree/api.json?path=${encodeURIComponent('/'+rel)}`,portal:portalApiUrl(p,baseUrl(req))},folders:(node.folders||[]).map(f=>({name:f.name,path:'/'+f.path,folderCount:f.folderCount,fileCount:f.fileCount,bytes:f.bytes,apiUrl:folderApi(f.path)})),files:node.type==='file'?[node]:(node.files||[]).map(f=>({name:f.name,path:'/'+f.path,size:f.size,modifiedAt:f.modifiedAt||''})),generatedAt:new Date().toISOString()});
}
// Batch policy workflow: validate entire request before applying any changes.
// Preview is read-only and returns the exact affected files; apply is one metadata update.
if(parts[4]==='files'&&parts[5]==='bulk-access'&&parts.length===6&&method==='POST'){
 const b=await parse(req);
 if(!b||!Array.isArray(b.fileIds)||!b.fileIds.length||b.fileIds.length>500||b.fileIds.some(x=>typeof x!=='string')||new Set(b.fileIds).size!==b.fileIds.length||!accessModes.includes(b.mode)||typeof b.dryRun!=='boolean'||(b.listed!==undefined&&typeof b.listed!=='boolean'))return fail(res,400,'Invalid bulk policy');
 const selected=b.fileIds.map(fid=>p.files.find(f=>f.id===fid));
 if(selected.some(f=>!f))return fail(res,404,'File not found; no changes applied');
 const changes=selected.map(f=>({fileId:f.id,name:f.name,before:{mode:fileMode(f),listed:f.listed!==false},after:{mode:b.mode,listed:b.listed===undefined?f.listed!==false:b.listed}}));
 if(b.dryRun)return json(res,200,{dryRun:true,count:changes.length,changes});
 const result=await update(()=>{for(const f of selected){f.accessMode=b.mode;if(b.listed!==undefined)f.listed=b.listed}void audit('file.policy.bulk',{portalId:p.id,count:changes.length,mode:b.mode});return {dryRun:false,count:changes.length,changes}});
 return json(res,200,result);
}
if(parts[4]==='files'&&parts.length===7&&parts[6]==='access'&&method==='PATCH'){
 const f=p.files.find(x=>x.id===parts[5]);if(!f)return fail(res,404,'File not found');const b=await parse(req);
 if(!accessModes.includes(b.mode)||b.listed!==undefined&&typeof b.listed!=='boolean')return fail(res,400,'Invalid file policy');
 return json(res,200,await update(()=>{f.accessMode=b.mode;if(b.listed!==undefined)f.listed=b.listed;void audit('file.policy',{portalId:p.id,fileId:f.id,mode:b.mode});return {fileId:f.id,mode:f.accessMode,listed:f.listed!==false}}));
}
if(parts[4]==='files'&&parts.length===7&&parts[6]==='access-keys'&&method==='POST'){
 const f=p.files.find(x=>x.id===parts[5]);if(!f)return fail(res,404,'File not found');const b=await parse(req);
 if(!validExpiry(b.expiresAt===undefined?null:b.expiresAt))return fail(res,400,'Invalid expiry');
 return json(res,201,await update(()=>{const secret='fk_'+crypto.randomBytes(32).toString('base64url');const k={id:id(),hash:keyDigest(secret),createdAt:new Date().toISOString(),expiresAt:b.expiresAt||null};f.accessKeys??=[];f.accessKeys.push(k);void audit('file.key.create',{portalId:p.id,fileId:f.id,keyId:k.id});return {id:k.id,key:secret,expiresAt:k.expiresAt}}));
}
if(parts[4]==='files'&&parts.length===8&&parts[6]==='access-keys'&&method==='DELETE'){
 const f=p.files.find(x=>x.id===parts[5]);if(!f)return fail(res,404,'File not found');
 return json(res,200,await update(()=>{const n=(f.accessKeys||[]).length;f.accessKeys=(f.accessKeys||[]).filter(k=>k.id!==parts[7]);if(f.accessKeys.length===n)throw Object.assign(new Error('Key not found'),{status:404});void audit('file.key.revoke',{portalId:p.id,fileId:f.id,keyId:parts[7]});return {revoked:parts[7]}}));
}
if(parts[4]==='signing-key'&&parts.length===5&&method==='POST'){return json(res,200,await update(()=>{p.signingSecret=crypto.randomBytes(32).toString('hex');void audit('url.revoke-all',{portalId:p.id});return {revokedAllSignedUrls:true}}))}
if(parts[4]==='files'&&parts[6]==='signed-url'&&parts.length===7&&method==='POST'){const f=p.files.find(x=>x.id===parts[5]);if(!f)return fail(res,404,'File not found');if(fileMode(f)!=='FREE')return fail(res,403,'Signed URL forbidden for protected file');const b=await parse(req);const ttl=Number(b.ttlSeconds||300);if(!Number.isInteger(ttl)||ttl<1||ttl>86400)return fail(res,400,'Invalid TTL');const expires=Math.floor(Date.now()/1000)+ttl;const sig=crypto.createHmac('sha256',p.signingSecret||adminToken).update(`${p.id}:${f.id}:${expires}`).digest('hex');void audit('url.sign',{portalId:p.id,fileId:f.id});return json(res,201,{path:`/api/v1/p/${encodeURIComponent(p.slug)}/files/${f.id}/download?expires=${expires}&sig=${sig}`,expires});}
if(parts.length===4&&method==='PATCH'){const b=await parse(req);return json(res,200,await update(()=>{if(b.title!==undefined){if(!clean(b.title)||clean(b.title).length>160)throw Object.assign(new Error('Invalid title'),{status:400});p.title=clean(b.title)}if(b.description!==undefined)p.description=clean(b.description).slice(0,2000);if(b.notes!==undefined)p.notesText=clean(b.notes).slice(0,2000);if(b.category!==undefined)p.category=clean(b.category).slice(0,120);if(b.subject!==undefined)p.subject=clean(b.subject).slice(0,200);if(b.flag!==undefined)p.flag=portalFlag(b.flag);if(b.storage_root!==undefined)p.storage_root=portalRoot(b.storage_root);if(b.contactId!==undefined)p.contactId=portalContact(db,b.contactId);if(b.caseId!==undefined)p.caseId=portalCase(db,b.caseId);if(b.branding!==undefined){if(!b.branding||typeof b.branding!=='object'||Array.isArray(b.branding)||Object.keys(b.branding).some(x=>!['logoUrl','accentColor'].includes(x))|| (b.branding.logoUrl&&!/^https:\/\//.test(b.branding.logoUrl))||(b.branding.accentColor&&!/^#[0-9a-fA-F]{6}$/.test(b.branding.accentColor)))throw Object.assign(new Error('Invalid branding'),{status:400});p.branding=b.branding}if(b.visibility!==undefined){if(!['public','private'].includes(b.visibility))throw Object.assign(new Error('Invalid visibility'),{status:400});p.visibility=b.visibility}if(b.slug!==undefined){if(!validSlug(b.slug)||db.portals.some(x=>x!==p&&x.slug===b.slug))throw Object.assign(new Error('Invalid or duplicate slug'),{status:400});p.slug=b.slug}void audit('portal.update',{portalId:p.id});return adminPortal(p)}))}
if(parts.length===4&&method==='DELETE'){return json(res,200,await update(async()=>{p.visibility='private';await fsp.rm(path.join(filesRoot,p.id),{recursive:true,force:true});await fsp.rm(path.join(internalRoot,p.id),{recursive:true,force:true});await fsp.rm(path.join(apiRoot,p.slug),{recursive:true,force:true});db.portals=db.portals.filter(x=>x!==p);void audit('portal.delete',{portalId:p.id});return {deleted:p.id}}))}
if(parts[4]==='integrity'&&parts.length===5&&method==='GET'){
 const out=await verifyPortalFiles(p,{signal:new AbortController().signal,setTotal(){},advance(){}});
 void audit('integrity.verify',{portalId:p.id,summary:out.summary});return json(res,200,out);
 }
// Background integrity scan: returns immediately, progress via /admin/api/jobs/:id.
if(parts[4]==='integrity-jobs'&&parts.length===5&&method==='POST'){
 const portalId=p.id;
 const job=jobManager.submit('integrity-scan',{portalId});
 return json(res,202,job);
}
// Internal notes and attachments never enter p.files, public manifests, SDK or signed URLs.
if(parts[4]==='notes'){
 // Вътрешните бележки са СПИСЪК. Свободният текст на портала е p.notesText (различно поле).
 if(!Array.isArray(p.notes))p.notes=[];
 if(parts.length===5&&method==='GET')return json(res,200,{notes:p.notes});
 if(parts.length===5&&method==='POST'){
  const b=await parse(req);const title=clean(b.title),content=clean(b.content);
  if(!title||title.length>160||content.length>20000)return fail(res,400,'Invalid note');
  const taxonomy=normalizeTaxonomy(b);
  return json(res,201,await update(()=>{const n={id:id(),title,content,...taxonomy,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),fileId:clean(b.fileId)||null};if(n.fileId&&!p.files.some(f=>f.id===n.fileId))throw Object.assign(new Error('Unknown linked file'),{status:400});p.notes.push(n);void audit('note.create',{portalId:p.id,noteId:n.id});return n}));
 }
 if(parts.length===6){const n=p.notes.find(x=>x.id===parts[5]);if(!n)return fail(res,404,'Note not found');
  if(method==='PATCH'){const b=await parse(req);if(b.title!==undefined&&(!clean(b.title)||clean(b.title).length>160)||b.content!==undefined&&(typeof b.content!=='string'||b.content.length>20000))return fail(res,400,'Invalid note');const taxonomy=normalizeTaxonomy(b,n);return json(res,200,await update(()=>{if(b.title!==undefined)n.title=clean(b.title);if(b.content!==undefined)n.content=b.content;Object.assign(n,taxonomy);n.updatedAt=new Date().toISOString();void audit('note.update',{portalId:p.id,noteId:n.id});return n}));}
  if(method==='DELETE')return json(res,200,await update(()=>{p.notes=p.notes.filter(x=>x.id!==n.id);void audit('note.delete',{portalId:p.id,noteId:n.id});return {deleted:n.id}}));
 }
}
if(parts[4]==='attachments'){
 p.attachments??=[];
 if(parts.length===5&&method==='GET')return json(res,200,{attachments:p.attachments});
 if(parts.length===5&&method==='POST'){
  const filename=clean(req.headers['x-file-name']);if(!filename||filename.length>240||/[\/\r\n\0]/.test(filename))return fail(res,400,'Invalid X-File-Name');
  const data=await body(req,runtime.effective().maxUploadBytes);const f={id:id(),name:filename,size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),uploadedAt:new Date().toISOString()};
  const folder=path.join(internalRoot,p.id);await fsp.mkdir(folder,{recursive:true});const fp=path.join(folder,f.id);
  await fsp.writeFile(fp,data,{flag:'wx',mode:0o600});
  try{return json(res,201,await update(()=>{p.attachments.push(f);void audit('attachment.create',{portalId:p.id,attachmentId:f.id});return f}));}catch(e){await fsp.rm(fp,{force:true});throw e}
 }
 if(parts.length>=6){const f=p.attachments.find(x=>x.id===parts[5]);if(!f)return fail(res,404,'Attachment not found');
  if(parts.length===7&&parts[6]==='download'&&method==='GET'){
   const fp=path.join(internalRoot,p.id,f.id);let stat;try{stat=await fsp.lstat(fp)}catch{return fail(res,404,'Attachment unavailable')}if(!stat.isFile())return fail(res,404,'Attachment unavailable');
   return streamDownload(req,res,fp,stat,f.name,()=>{void audit('attachment.download',{portalId:p.id,attachmentId:f.id})});
  }
  if(parts.length===6&&method==='DELETE'){
   // Stage the physical file before committing metadata; restore on write failure.
   const fp=path.join(internalRoot,p.id,f.id),staged=fp+'.deleting-'+id();
   let moved=false;
   try{await fsp.rename(fp,staged);moved=true}catch(e){if(e.code!=='ENOENT')throw e;return fail(res,409,'Attachment file missing; integrity check required')}
   let result;
   try{result=await update(()=>{p.attachments=p.attachments.filter(x=>x.id!==f.id);void audit('attachment.delete',{portalId:p.id,attachmentId:f.id});return {deleted:f.id}})}
   catch(e){if(moved)await fsp.rename(staged,fp);throw e}
   // If cleanup fails, the staged object is recoverable and never publicly exposed.
   try{await fsp.unlink(staged)}catch(e){console.error('Staged attachment cleanup failed',staged,e)}
   return json(res,200,result);
  }
 }
}
if(parts[4]==='taxonomy'&&parts.length===5&&method==='GET'){
 const unique=key=>[...new Set(p.files.flatMap(f=>key==='tags'?(f.tags||[]):[f[key]||'']).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
 return json(res,200,{topics:unique('topic'),categories:unique('category'),groups:unique('group'),tags:unique('tags')});
 }
 if(parts[4]==='files'&&parts.length===5&&method==='GET')return json(res,200,filePage(p.files,url));
// Dedicated HTML publishing API. HTML is stored as a downloadable attachment,
// never rendered as active content on the portal origin (prevents stored XSS).
// Authorization is identical to other admin mutations. Published documents
// default to KEY_REQUIRED and unlisted until an admin explicitly changes policy.
if(parts[4]==='html-projects'&&parts.length===5){
 if(method==='GET')return json(res,200,{projects:p.htmlProjects||[]});
 if(method==='POST'){
  const b=await parse(req),folder=clean(b.folder),title=clean(b.title);
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(folder)||!title||title.length>120)return fail(res,400,'Invalid project folder or title');
  const base=await fsp.realpath(htmlProjectsRoot).catch(()=>null);if(!base)return fail(res,400,'Project storage unavailable');
  let actual,index;try{actual=await fsp.realpath(path.join(base,folder));index=await fsp.realpath(path.join(actual,'index.html'));if(!(await fsp.stat(index)).isFile())throw Error('Not a file')}catch{return fail(res,400,'index.html missing')}
  if(!actual.startsWith(base+path.sep)||!index.startsWith(actual+path.sep))return fail(res,400,'Unsafe project folder');
  if((p.htmlProjects||[]).some(x=>x.folder===folder))return fail(res,409,'Project already registered');
  const project=await update(()=>{const item={id:id(),title,folder,enabled:true,createdAt:new Date().toISOString()};p.htmlProjects??=[];p.htmlProjects.push(item);void audit('html.project.register',{portalId:p.id,projectId:item.id});return item});
  return json(res,201,{...project,url:'/site/'+p.slug+'/'+project.id+'/'});
 }
}
if(parts[4]==='html-projects'&&parts.length===6&&method==='DELETE'){
 return json(res,200,await update(()=>{const old=(p.htmlProjects||[]).length;p.htmlProjects=(p.htmlProjects||[]).filter(x=>x.id!==parts[5]);if(old===p.htmlProjects.length)throw Object.assign(new Error('Not found'),{status:404});void audit('html.project.unregister',{portalId:p.id,projectId:parts[5]});return {unregistered:parts[5]}}));
}
if(parts[4]==='html'&&parts.length===5&&method==='POST'){
 const filename=clean(req.headers['x-file-name']);
 if(!filename||filename.length>240||!/^([^\/\r\n\0]+)\.html?$/i.test(filename))return fail(res,400,'An .html or .htm filename is required');
 const contentType=(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
 if(contentType!=='text/html'&&contentType!=='application/octet-stream')return fail(res,415,'Expected text/html');
 const data=await body(req,Math.min(runtime.effective().maxUploadBytes,10*1024*1024));
 if(!data.length||data.includes(0))return fail(res,400,'Invalid HTML payload');
 const result=await update(async()=>{
  const f={id:id(),name:filename,size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),uploadedAt:new Date().toISOString(),contentType:'text/html',accessMode:'KEY_REQUIRED',listed:false};
  await fsp.mkdir(path.join(filesRoot,p.id),{recursive:true});
  await fsp.writeFile(path.join(filesRoot,p.id,f.id),data,{flag:'wx',mode:0o600});
  p.files.push(f);void audit('html.publish',{portalId:p.id,fileId:f.id});return publicFile(f);
 },async f=>{await fsp.rm(path.join(filesRoot,p.id,f.id),{force:true})});
 return json(res,201,{...result,publishStatus:'stored',security:'attachment-only',downloadUrl:'/api/v1/p/'+encodeURIComponent(p.slug)+'/files/'+result.id+'/download'});
}
if(parts[4]==='files'&&parts.length===5&&method==='POST'){const rawName=String(req.headers['x-file-name']||'');let decoded;try{decoded=decodeURIComponent(rawName)}catch{decoded=rawName}const filename=clean(decoded);if(!filename||filename.length>240||/[\/\r\n\0]/.test(filename))return fail(res,400,'Invalid X-File-Name');const wantEncrypt=String(req.headers['x-file-encrypt']||'')==='1';const data=await body(req,runtime.effective().maxUploadBytes);return json(res,201,await update(async()=>{const f={id:id(),name:filename,size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),uploadedAt:new Date().toISOString(),category:runtime.settings.data.defaultCategory,group:runtime.settings.data.defaultGroup};const stored=wantEncrypt?fileCrypto.encrypt(data,adminToken):data;if(wantEncrypt){f.encrypted=true;f.storedSize=stored.length}await fsp.mkdir(path.join(filesRoot,p.id),{recursive:true});await fsp.writeFile(path.join(filesRoot,p.id,f.id),stored,{flag:'wx',mode:0o600});p.files.push(f);void audit('file.upload',{portalId:p.id,fileId:f.id,encrypted:!!f.encrypted});return publicFile(f)},async f=>{await fsp.rm(path.join(filesRoot,p.id,f.id),{force:true})}))}
if(parts[4]==='files'&&parts[5]){
 const f=p.files.find(x=>x.id===parts[5]);
 if(!f)return fail(res,404,'File not found');
 if(parts.length===7&&parts[6]==='metadata'&&method==='PATCH'){const b=await parse(req);const meta=normalizeTaxonomy(b,f);if(typeof b.notes==='string')meta.notes=clean(b.notes).slice(0,2000);
  // Видимост в публичния каталог (иконата 👁/🚫 на файла) — същата проверка като при политиката.
  if(b.listed!==undefined&&typeof b.listed!=='boolean')return fail(res,400,'Invalid listed');
  if(typeof b.listed==='boolean')meta.listed=b.listed;
  return json(res,200,await update(()=>{Object.assign(f,meta);f.modifiedAt=new Date().toISOString();void audit('file.metadata',{portalId:p.id,fileId:f.id,listed:f.listed!==false});return publicFile(f)}))}
 if(parts.length===7&&parts[6]==='lock'&&method==='PATCH'){const b=await parse(req);const locked=!!(b&&b.locked);return json(res,200,await update(()=>{f.locked=locked;f.lockedBy=locked?(clean(b.by)||'admin'):'';f.lockedAt=locked?new Date().toISOString():'';void audit(locked?'file.lock':'file.unlock',{portalId:p.id,fileId:f.id});return publicFile(f)}))}
 if(parts.length===6&&method==='PATCH'){const b=await parse(req);const name=clean(b.name);if(!name||name.length>240||/[\/\r\n\0]/.test(name))return fail(res,400,'Invalid name');return json(res,200,await update(()=>{f.name=name;Object.assign(f,normalizeTaxonomy(b,f));void audit('file.rename',{portalId:p.id,fileId:f.id});return publicFile(f)}))}
 if(parts.length===6&&method==='DELETE')return json(res,200,await update(async()=>{p.files=p.files.filter(x=>x!==f);await fsp.rm(path.join(filesRoot,p.id,f.id),{force:true});void audit('file.delete',{portalId:p.id,fileId:f.id});return {deleted:f.id}}))
 if(parts.length===7&&parts[6]==='sign'&&method==='POST'){const receipt=signer.sign({fileId:f.id,name:f.name,sha256:f.sha256,size:f.size,secret:p.signingSecret||adminToken});void audit('file.sign',{portalId:p.id,fileId:f.id});return json(res,201,{receipt,note:'Receipt is HMAC-SHA256 over the file SHA-256 + timestamp. Key rotation revokes verification of prior receipts until PKCS#7 is available.'})}
 if(parts.length===7&&parts[6]==='verify-signature'&&method==='POST'){const b=await parse(req);return json(res,200,signer.verify(b&&b.receipt,p.signingSecret||adminToken))}
 // Пълен стек с хешове: изчислява се от съдържанието (след декриптиране, ако е нужно).
 if(parts.length===7&&parts[6]==='hashes'&&method==='GET'){
  const fp=path.join(filesRoot,p.id,f.id);
  // Пълният набор: SHA-2 (256/384/512), SHA-3, SHA-1 и MD5 — само поддържаните от OpenSSL.
  const supported=new Set(crypto.getHashes());
  const algos=['sha256','sha512','sha384','sha3-256','sha1','md5'].filter(a=>supported.has(a));
  const hashes={};for(const a of algos)hashes[a]=crypto.createHash(a);
  let size=0;
  try{
   if(f.encrypted){
    const plain=fileCrypto.decrypt(fs.readFileSync(fp),adminToken);size=plain.length;for(const a of algos)hashes[a].update(plain);
   }else{
    for await(const chunk of fs.createReadStream(fp)){size+=chunk.length;for(const a of algos)hashes[a].update(chunk)}
   }
  }catch(e){return fail(res,e.code==='ENOENT'?404:500,e.code==='ENOENT'?'File unavailable':'Hashing failed')}
  const sum={};for(const a of algos)sum[a]=hashes[a].digest('hex');
  const out={fileId:f.id,name:f.name,size,algorithms:algos,hashes:sum,computedAt:new Date().toISOString(),
   // Обратна съвместимост: старите полета остават на горното ниво.
   sha256:sum.sha256||'',sha512:sum.sha512||'',sha1:sum.sha1||'',md5:sum.md5||'',
   registered:{sha256:f.sha256||''},match:(sum.sha256||'')===(f.sha256||'')};
  if(!out.match)out.warning='SHA-256 не съвпада с регистрирания при качване';
  void audit('file.hashes',{portalId:p.id,fileId:f.id,match:out.match,algorithms:algos.length});
  return json(res,200,out);
 }
 if(parts.length===7&&parts[6]==='preview'&&method==='GET'){if(!runtime.settings.preview.enabled)return fail(res,503,'Preview disabled');const buf=readPlainBuffer(p,f);if(!buf)return fail(res,404,'File unavailable');const pv=preview.preview(buf,f.name);if(pv.kind==='inline'){res.writeHead(200,{'Content-Type':pv.mime,'Content-Length':buf.length,'Content-Disposition':'inline; filename*=UTF-8\'\''+encodeURIComponent(f.name.replace(/[\r\n]/g,'')),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(buf)}if(pv.kind==='html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});return res.end(preview.wrap(f.name,pv.html))}res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(pv.text)}
 if(parts.length===7&&parts[6]==='thumbnail.svg'&&method==='GET'){if(!runtime.settings.preview.thumbnails)return fail(res,503,'Thumbnails disabled');const th=preview.thumbnail(f.name);res.writeHead(200,{'Content-Type':th.mime,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"});return res.end(th.data)}
 if(parts.length===7&&parts[6]==='download'&&method==='GET'){
  const fp=path.join(filesRoot,p.id,f.id);let stat;try{stat=await fsp.lstat(fp)}catch{return fail(res,404,'File unavailable')}
  if(!stat.isFile())return fail(res,404,'File unavailable');void audit('file.download.admin',{portalId:p.id,fileId:f.id});
  if(f.encrypted)return serveEncryptedFile(req,res,fp,f,()=>{counters.downloads++});
  return streamDownload(req,res,fp,stat,f.name,()=>{counters.downloads++});
 }
 if(parts.length===7&&parts[6]==='versions'&&method==='GET')return json(res,200,{current:{version:f.version||1,size:f.size,sha256:f.sha256,uploadedAt:f.uploadedAt,encrypted:!!f.encrypted},versions:[...(f.versions||[])].sort((a,b)=>b.version-a.version),total:(f.versions||[]).length+1});
 if(parts.length===7&&parts[6]==='versions'&&method==='POST'){
  const note=clean(req.headers['x-version-note']||'');
  const data=await body(req,runtime.effective().maxUploadBytes);
  const prev=versioning.snapshotCurrent(f,{note});
  const newVersion=versioning.nextVersion(f);
  const curPath=path.join(filesRoot,p.id,f.id);
  const archPath=versioning.versionPath(filesRoot,p.id,f.id,prev.version);
  const sha256=crypto.createHash('sha256').update(data).digest('hex');
  const stored=f.encrypted?fileCrypto.encrypt(data,adminToken):data;
  const result=await update(async()=>{
   await fsp.rename(curPath,archPath);
   try{await fsp.writeFile(curPath,stored,{flag:'wx',mode:0o600})}catch(e){await fsp.rename(archPath,curPath).catch(()=>{});throw e}
   f.versions??=[];f.versions.push(prev);
   f.size=data.length;f.sha256=sha256;f.uploadedAt=new Date().toISOString();f.version=newVersion;
   if(f.encrypted)f.storedSize=stored.length;
   const drop=versioning.pruneTargets(f);
   f.versions=f.versions.filter(v=>!drop.includes(v.version));
   void audit('file.version.upload',{portalId:p.id,fileId:f.id,version:newVersion,prevVersion:prev.version});
   return {pruned:drop};
  },async()=>{await fsp.rm(curPath,{force:true}).catch(()=>{});await fsp.rename(archPath,curPath).catch(()=>{})});
  for(const vn of result.pruned)await fsp.rm(versioning.versionPath(filesRoot,p.id,f.id,vn),{force:true}).catch(()=>{});
  return json(res,201,{file:publicFile(f),version:newVersion,previous:prev,pruned:result.pruned});
 }
 if(parts.length===9&&parts[6]==='versions'&&parts[8]==='download'&&method==='GET'){
  const vn=Number(parts[7]);if(!Number.isInteger(vn)||vn<1)return fail(res,400,'Invalid version');
  const v=(f.versions||[]).find(x=>x.version===vn);if(!v)return fail(res,404,'Version not found');
  const vp=versioning.versionPath(filesRoot,p.id,f.id,vn);
  let stat;try{stat=await fsp.lstat(vp)}catch{return fail(res,404,'Version unavailable')}if(!stat.isFile())return fail(res,404,'Version unavailable');
  if(v.encrypted){let buf;try{buf=fileCrypto.decrypt(fs.readFileSync(vp),adminToken)}catch{return fail(res,500,'Decryption failed')}res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':buf.length,'Content-Disposition':'attachment; filename*=UTF-8\'\''+encodeURIComponent(f.name.replace(/[\r\n]/g,'')+'.v'+vn),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});void audit('file.version.download',{portalId:p.id,fileId:f.id,version:vn});return res.end(buf)}
  return streamDownload(req,res,vp,stat,f.name,()=>{void audit('file.version.download',{portalId:p.id,fileId:f.id,version:vn})});
 }
 if(parts.length===9&&parts[6]==='versions'&&parts[8]==='restore'&&method==='POST'){
  const vn=Number(parts[7]);if(!Number.isInteger(vn)||vn<1)return fail(res,400,'Invalid version');
  const v=(f.versions||[]).find(x=>x.version===vn);if(!v)return fail(res,404,'Version not found');
  const vp=versioning.versionPath(filesRoot,p.id,f.id,vn);
  const curPath=path.join(filesRoot,p.id,f.id);
  const prev=versioning.snapshotCurrent(f,{note:'restore from v'+vn});
  const newVersion=versioning.nextVersion(f);
  const archPath=versioning.versionPath(filesRoot,p.id,f.id,prev.version);
  const result=await update(async()=>{
   await fsp.rename(curPath,archPath);
   try{await fsp.copyFile(vp,curPath)}catch(e){await fsp.rename(archPath,curPath).catch(()=>{});throw e}
   f.versions??=[];f.versions.push(prev);
   f.size=v.size;f.sha256=v.sha256;f.encrypted=!!v.encrypted;f.storedSize=v.storedSize||null;f.uploadedAt=new Date().toISOString();f.version=newVersion;
   void audit('file.version.restore',{portalId:p.id,fileId:f.id,restoredFrom:vn,newVersion});
   return {file:publicFile(f),restoredFrom:vn,version:newVersion};
  },async()=>{await fsp.rm(curPath,{force:true}).catch(()=>{});await fsp.rename(archPath,curPath).catch(()=>{})});
  return json(res,200,result);
 }
}
}return fail(res,404,'Not found')
}return fail(res,404,'Not found')
}catch(e){if(!e||!e.status||e.status>=500)void errorLog.append('error','http',e&&e.message?e.message:'Internal error');return fail(res,e&&e.status||500,e&&e.status?e.message:'Internal error')}}
async function firstRunSeed(){
 if(process.env.HAPI_FIRST_RUN_SEED!=='1')return;
 const marker=path.join(root,'.first-run-done');
 try{await fsp.access(marker);return}catch{}
 let init={};try{init=JSON.parse(fs.readFileSync(process.env.OPTIONS_PATH||'/data/options.json','utf8'))}catch{}
 const str=v=>typeof v==='string'?v.trim():'';
 const dbName=str(init.db_name);
 const slug=dbName.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'files';
 if(!db.portals.length){
  const p={id:id(),slug,title:dbName||'Files',description:'',visibility:'private',createdAt:new Date().toISOString(),files:[]};
  await fsp.mkdir(path.join(filesRoot,p.id),{recursive:true});db.portals.push(p);metadataStore.save(db);
 }
 const uname=/^[A-Za-z0-9_.@-]{1,64}$/.test(str(init.username))?str(init.username):'api';
 if(!metadataStore.getUser(uname)){
  const given=str(init.password),generated=given.length<8||given.length>200;
  const pw=generated?crypto.randomBytes(18).toString('base64url'):given;
  metadataStore.createUser(uname,hashPassword(pw),['read','download']);
  if(generated)await fsp.writeFile(path.join(root,'api-credentials.txt'),'username: '+uname+'\npassword: '+pw+'\n',{mode:0o600});
 }
 if(!(runtime.settings.backupSchedule||{}).enabled)await runtime.save({backupSchedule:{...DEFAULT_BACKUP_SCHEDULE,enabled:true}});
 await fsp.writeFile(marker,new Date().toISOString());
 console.log('First run: portal "'+slug+'", API user "'+uname+'", daily backups enabled.');
}
async function start(){try{const lines=(await fsp.readFile(telemetryFile,'utf8')).split('\n');for(const line of lines){if(!line.trim())continue;try{const e=JSON.parse(line);if(['visit','download','rating'].includes(e.event))applyTelemetry(e)}catch{console.error('Invalid telemetry record')}}}catch(e){if(e.code!=='ENOENT')throw e}await fsp.mkdir(htmlProjectsRoot,{recursive:true});await fsp.mkdir(filesRoot,{recursive:true});await fsp.mkdir(internalRoot,{recursive:true});await auditChain.init();db=metadataStore.load();metadataStore.purgeExpiredSessions();jobManager.recover();await firstRunSeed();for(const p of db.portals)if(!fs.existsSync(path.join(apiRoot,p.slug,'qr.svg')))await writeApiDir(p,baseUrl(null));applyBackupSchedule();if(runtime.settings.retention&&runtime.settings.retention.enabled){const runScheduledRetention=()=>{void queue.then(async()=>{const r=await retention.apply(db.portals);metadataStore.save(db);if(r.deleted||r.disabled||r.auditLinesPruned)void audit('retention.scheduled',{deleted:r.deleted,disabled:r.disabled,auditLinesPruned:r.auditLinesPruned})}).catch(e=>console.error('SCHEDULED RETENTION FAILED',e.message))};setInterval(runScheduledRetention,86400000).unref()}if(storageCheckIntervalMs>0){void runStorageCheck('scheduled').catch(()=>{});setInterval(()=>{void runStorageCheck('scheduled').catch(()=>{})},storageCheckIntervalMs)}http.createServer(handler).listen(port,publicHost,()=>console.log('Internal public API listening on '+publicHost+':'+port));if(ingressMode)http.createServer(handler).listen(adminPort,adminBindHost,()=>console.log('Ingress admin listening on '+adminBindHost+':'+adminPort));
// Public API Gateway (PG-6): отделен listener без административни маршрути.
const gatewayPort=Number(process.env.PUBLIC_GATEWAY_PORT||0),gatewayBind=process.env.PUBLIC_GATEWAY_BIND||'0.0.0.0';
if(gatewayPort>0&&gatewayPort!==port&&gatewayPort!==adminPort){http.createServer((req,res)=>{req.hapiPublicOnly=true;return handler(req,res)}).listen(gatewayPort,gatewayBind,()=>console.log('Public API gateway listening on '+gatewayBind+':'+gatewayPort))}}start().catch(e=>{console.error(e);process.exit(1)});
