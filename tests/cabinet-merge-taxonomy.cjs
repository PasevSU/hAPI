'use strict';
const { stopChild } = require('./helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const ooxml=require('../hapi_enterprise/ooxml.js');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-cab-'));
 const token='cabinet-test-admin-secret-2026-q9',pub=18311,B=`http://127.0.0.1:${pub}`;
 const child=spawn(process.execPath,[path.join(__dirname,'../hapi_enterprise/server.js')],{env:{...process.env,DATA_DIR:dir,ADMIN_TOKEN:token,PORT:String(pub)},stdio:'pipe'});
 try{
  let ready=false;
  for(let i=0;i<70;i++){try{if((await fetch(B+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}
  assert(ready,'server startup');
  const A={authorization:'Bearer '+token},J={...A,'content-type':'application/json'};
  const call=(p,m='GET',b)=>fetch(B+p,{method:m,headers:b===undefined?A:J,body:b===undefined?undefined:JSON.stringify(b)});
  const q=p=>'?path='+encodeURIComponent(p);
  // Auth required
  assert.equal((await fetch(B+'/admin/api/cabinet/list')).status,401);
  // Folders, nesting
  assert.equal((await call('/admin/api/cabinet/folder','POST',{path:'',name:'Договори'})).status,201);
  assert.equal((await call('/admin/api/cabinet/folder','POST',{path:'Договори',name:'2026'})).status,201);
  assert.equal((await call('/admin/api/cabinet/folder','POST',{path:'',name:'Договори'})).status,409);
  // Path traversal and bad names
  for(const bad of ['..','../x','a/../../x','a\\b','C:','con','x?','.'])assert.equal((await call('/admin/api/cabinet/list'+q(bad))).status,400,'list '+bad);
  assert.equal((await call('/admin/api/cabinet/folder','POST',{path:'',name:'../evil'})).status,400);
  // Create md/txt/docx/xlsx
  for(const [n,t] of [['бележки','md'],['plain','txt'],['док','docx'],['табл','xlsx']])assert.equal((await call('/admin/api/cabinet/create','POST',{path:'Договори/2026',name:n,type:t})).status,201,t);
  assert.equal((await call('/admin/api/cabinet/create','POST',{path:'',name:'x.exe',type:'exe'})).status,400);
  const docx=Buffer.from(await (await call('/admin/api/cabinet/file'+q('Договори/2026/док.docx'))).arrayBuffer());
  assert.equal(docx.slice(0,2).toString(),'PK');
  // Save text + convert md -> pdf
  assert.equal((await fetch(B+'/admin/api/cabinet/save'+q('Договори/2026/бележки.md'),{method:'POST',headers:A,body:'# Заглавие\n\nТекст с кирилица.\n\n- един\n- два\n'})).status,200);
  const conv=await call('/admin/api/cabinet/convert','POST',{path:'Договори/2026/бележки.md',to:'pdf'});
  assert.equal(conv.status,201);const out=await conv.json();assert.equal(out.name,'бележки.pdf');
  const pdf=await call('/admin/api/cabinet/file'+q('Договори/2026/бележки.pdf'));
  assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(pdf.headers.get('x-content-type-options'),'nosniff');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).slice(0,5).toString(),'%PDF-');
  // Convert a real docx -> pdf; second conversion gets a unique name
  const real=ooxml.docx('Първи ред\nВтори ред');
  assert.equal((await fetch(B+'/admin/api/cabinet/upload'+q('Договори'),{method:'POST',headers:{...A,'x-file-name':encodeURIComponent('писмо.docx')},body:real})).status,201);
  const c1=await (await call('/admin/api/cabinet/convert','POST',{path:'Договори/писмо.docx',to:'pdf'})).json();
  const c2=await (await call('/admin/api/cabinet/convert','POST',{path:'Договори/писмо.docx',to:'pdf'})).json();
  assert.equal(c1.name,'писмо.pdf');assert.notEqual(c2.name,c1.name);
  assert.equal((await call('/admin/api/cabinet/convert','POST',{path:'Договори/2026/табл.xlsx',to:'pdf'})).status,400);
  // Dangerous types are never rendered inline
  assert.equal((await fetch(B+'/admin/api/cabinet/upload'+q(''),{method:'POST',headers:{...A,'x-file-name':'x.svg'},body:'<svg onload=alert(1)/>'})).status,201);
  const svg=await call('/admin/api/cabinet/file'+q('x.svg'));assert(/attachment/.test(svg.headers.get('content-disposition')));assert.equal(svg.headers.get('content-type'),'application/octet-stream');
  // List order, rename, delete, open disabled
  const list=await (await call('/admin/api/cabinet/list'+q('Договори'))).json();assert.equal(list.items[0].type,'folder');
  assert.equal((await call('/admin/api/cabinet/rename','POST',{path:'Договори/писмо.pdf',name:'писмо-1.pdf'})).status,200);
  assert.equal((await call('/admin/api/cabinet/entry'+q('Договори/2026'),'DELETE')).status,200);
  assert.equal((await call('/admin/api/cabinet/list'+q('Договори/2026'))).status,404);
  assert.equal((await call('/admin/api/cabinet/open','POST',{path:'x.svg'})).status,404);
  // Taxonomy
  assert.equal((await call('/admin/api/taxonomy','POST',{kind:'category',name:'Финанси'})).status,201);
  assert.equal((await call('/admin/api/taxonomy','POST',{kind:'category',name:'финанси'})).status,409);
  assert.equal((await call('/admin/api/taxonomy','POST',{kind:'group',name:'Екип А'})).status,201);
  assert.equal((await call('/admin/api/taxonomy','POST',{kind:'nope',name:'x'})).status,400);
  let tx=await (await call('/admin/api/taxonomy')).json();assert.deepEqual(tx,{categories:['Финанси'],groups:['Екип А']});
  tx=await (await call('/admin/api/taxonomy?kind=category&name='+encodeURIComponent('Финанси'),'DELETE')).json();assert.deepEqual(tx.categories,[]);
  // Merge
  const mk=async(slug)=>(await (await call('/admin/api/portals','POST',{slug,title:slug})).json()).id;
  const t=await mk('target'),s1=await mk('src-one'),s2=await mk('src-two');
  for(const [pid,name] of [[t,'a.txt'],[s1,'b.txt'],[s2,'c.txt']])assert.equal((await fetch(`${B}/admin/api/portals/${pid}/files`,{method:'POST',headers:{...A,'x-file-name':name},body:name})).status,201);
  assert.equal((await call('/admin/api/portals/merge','POST',{targetId:t,sourceIds:[t]})).status,400);
  assert.equal((await call('/admin/api/portals/merge','POST',{targetId:t,sourceIds:['missing']})).status,404);
  const m=await call('/admin/api/portals/merge','POST',{targetId:t,sourceIds:[s1,s2]});assert.equal(m.status,200);
  const merged=await m.json();assert.deepEqual(merged.files.map(f=>f.name).sort(),['a.txt','b.txt','c.txt']);
  const all=await (await call('/admin/api/portals')).json();assert.equal(all.portals.length,1);
  for(const f of merged.files)assert(fs.existsSync(path.join(dir,'files',t,f.id)),'file moved '+f.name);
  assert(!fs.existsSync(path.join(dir,'api','src-one'))&&!fs.existsSync(path.join(dir,'api','src-two')),'source api dirs removed');
  assert(fs.existsSync(path.join(dir,'api','target','qr.svg')));
  const info=await (await call(`/admin/api/portals/${t}/api-info`)).json();assert(/\/api\/v1\/p\/target$/.test(info.apiUrl));assert(info.qr.startsWith('<svg'));
  // QR кодът сочи публичната страница по id; вътрешният адрес се маркира, за да не се
  // раздава QR, който не се отваря извън локалната мрежа.
  assert.ok(info.landingUrl.endsWith('/p/'+t),'QR сочи публичната страница по id');assert.equal(info.qrTarget,info.landingUrl);
  assert.equal(info.baseIsLocal,true,'тестът работи на 127.0.0.1');
  // Admin page CSP allows blob PDF preview
  const page=await fetch(B+'/admin');assert(/frame-src blob:/.test(page.headers.get('content-security-policy')));
  console.log('cabinet-merge-taxonomy OK');
 }finally{await stopChild(child);fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
