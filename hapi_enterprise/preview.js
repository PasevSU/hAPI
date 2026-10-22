'use strict';
// Document preview & thumbnails (Phase 4.3). Dependency-free: renders text,
// Markdown and DOCX to HTML, serves PDF/PNG/JPEG/SVG inline, and produces an
// SVG type thumbnail for every file. Config-disablable via settings.preview.
const pdf=require('./pdf-writer');
const ooxml=require('./ooxml');

const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const extOf=name=>{const m=/\.([a-z0-9]{1,10})$/i.exec(name||'');return m?m[1].toLowerCase():''};
const INLINE=new Set(['pdf','png','jpg','jpeg','gif','svg']);
const MIME={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',svg:'image/svg+xml',md:'text/markdown',markdown:'text/markdown',txt:'text/plain',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
const THUMB_COLOR={pdf:'#dc2626',docx:'#2563eb',xlsx:'#16a34a',pptx:'#ea580c',md:'#7c3aed',markdown:'#7c3aed',txt:'#64748b',png:'#0891b2',jpg:'#0891b2',jpeg:'#0891b2',gif:'#0891b2',svg:'#9333ea'};

function mdToHtml(md){
 const blocks=pdf.markdownBlocks(md);
 const out=[];
 for(const b of blocks){
  const t=esc(b.text||'');
  switch(b.type){
   case 'h1':out.push('<h1>'+t+'</h1>');break;
   case 'h2':out.push('<h2>'+t+'</h2>');break;
   case 'h3':out.push('<h3>'+t+'</h3>');break;
   case 'li':out.push('<ul><li>'+t+'</li></ul>');break;
   case 'quote':out.push('<blockquote>'+t+'</blockquote>');break;
   case 'code':out.push('<pre><code>'+t+'</code></pre>');break;
   case 'hr':out.push('<hr/>');break;
   case 'table':{
    const rows=(b.rows||[]).map(r=>(r||[]).map(c=>esc(c)));
    const bodyRows=b.header?rows.slice(1):rows;
    const head=b.header?'<thead><tr>'+rows[0].map(c=>'<th>'+c+'</th>').join('')+'</tr></thead>':'';
    out.push('<table>'+head+'<tbody>'+bodyRows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table>');
    break;
   }
   default:out.push('<p>'+t+'</p>');
  }
 }
 return out.join('\n');
}

function docxToHtml(buffer){
 // Същото богато извличане като при PDF: таблицата става таблица, а картинката — картинка.
 const blocks=ooxml.docxRich(buffer).blocks;
 return blocks.map(b=>{
  if(b.type==='table'){
   const rows=(b.rows||[]).map(r=>'<tr>'+r.map((c,i)=>`<${(b.header&&i>=0)?'th':'td'}>${esc(c||'')}</${(b.header&&i>=0)?'th':'td'}>`).join('')+'</tr>').join('');
   return '<table>'+rows+'</table>';
  }
  if(b.type==='image')return ''; // картинките не се показват в текстовия преглед
  const t=esc(b.text||'');
  if(b.type==='h1')return '<h1>'+t+'</h1>';
  if(b.type==='h2')return '<h2>'+t+'</h2>';
  if(b.type==='h3')return '<h3>'+t+'</h3>';
  if(b.type==='li')return '<p class="li">• '+t+'</p>';
  if(b.type==='pagebreak')return '<hr/>';
  if(b.type==='space')return '<br/>';
  return '<p>'+t+'</p>';
 }).join('\n');
}

function xlsxToHtml(buffer){
 const rows=ooxml.xlsxBlocks(buffer);
 if(!rows.length)return '<p>(empty spreadsheet)</p>';
 const head='<thead><tr>'+rows[0].map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead>';
 const body=rows.slice(1).map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('');
 return '<table>'+head+'<tbody>'+body+'</tbody></table>';
}
function pptxToHtml(buffer){
 const blocks=ooxml.pptxBlocks(buffer);
 return blocks.map(b=>b.type==='space'?'<hr/>':'<p>'+esc(b.text||'')+'</p>').join('\n');
}

function wrap(title,body){
 return '<!doctype html><html lang="bg"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title>'+
  '<style>body{font:15px/1.6 system-ui,sans-serif;background:#f8fafc;color:#0f172a;max-width:800px;margin:2rem auto;padding:0 1rem}h1,h2,h3{line-height:1.25}code,pre{background:#eef2f7;border-radius:4px}pre{padding:.8rem;overflow:auto}blockquote{border-left:4px solid #cbd5e1;margin:0;padding-left:1rem;color:#475569}.li{margin-left:1em}hr{border:none;border-top:1px solid #e2e8f0}table{border-collapse:collapse;width:100%;margin:.5rem 0}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;font-size:14px}th{background:#eef2f7}</style>'+
  '<h1>'+esc(title)+'</h1>'+body+'</html>';
}

function create({enabled=true}={}){
 return {
  enabled,
  wrap,
  capabilities:{formats:['html','text','inline'],thumbnails:['svg']},
  // Returns {kind:'inline',mime} | {kind:'html',html} | {kind:'text',text}.
  // For 'inline' the caller streams the original bytes; no rasterization here.
  preview(buffer,name){
   if(!enabled)return {kind:'text',text:'Preview disabled'};
   const ext=extOf(name);
   if(INLINE.has(ext))return {kind:'inline',mime:MIME[ext]||'application/octet-stream'};
   if(ext==='docx'){
    try{return {kind:'html',html:docxToHtml(buffer)}}catch{return {kind:'text',text:buffer.toString('utf8').slice(0,100000)}}
   }
   if(ext==='xlsx'){
    try{return {kind:'html',html:xlsxToHtml(buffer)}}catch{return {kind:'text',text:buffer.toString('utf8').slice(0,100000)}}
   }
   if(ext==='pptx'){
    try{return {kind:'html',html:pptxToHtml(buffer)}}catch{return {kind:'text',text:buffer.toString('utf8').slice(0,100000)}}
   }
   if(ext==='md'||ext==='markdown')return {kind:'html',html:mdToHtml(buffer.toString('utf8'))};
   return {kind:'text',text:buffer.toString('utf8').slice(0,100000)};
  },
  // SVG thumbnail (type badge + name); never exposes file bytes.
  thumbnail(name){
   const ext=extOf(name),label=(ext||'file').toUpperCase().slice(0,5);
   const color=THUMB_COLOR[ext]||'#475569',safe=esc(String(name||'').slice(0,26));
   const svg='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="150" viewBox="0 0 120 150">'+
    '<rect x="4" y="4" width="112" height="142" rx="8" fill="'+color+'"/>'+
    '<rect x="4" y="4" width="112" height="30" rx="8" fill="rgba(255,255,255,0.18)"/>'+
    '<text x="60" y="25" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">'+label+'</text>'+
    '<text x="60" y="82" font-family="system-ui,sans-serif" font-size="11" fill="#fff" text-anchor="middle">'+safe+'</text>'+
    '<text x="60" y="98" font-family="system-ui,sans-serif" font-size="9" fill="rgba(255,255,255,0.75)" text-anchor="middle">hAPI Enterprise</text></svg>';
   return {kind:'svg',mime:'image/svg+xml',data:Buffer.from(svg,'utf8')};
  }
 };
}
module.exports={create,wrap,mdToHtml,docxToHtml,xlsxToHtml,pptxToHtml};
