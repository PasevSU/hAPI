'use strict';
// Minimal dependency-free ZIP writer/reader and OOXML (docx/xlsx) helpers.
const zlib=require('node:zlib');
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(buf){let c=0xFFFFFFFF;for(let i=0;i<buf.length;i++)c=CRC[(c^buf[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const unesc=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(m,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-fA-F]+);/g,(m,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&amp;/g,'&');

function zip(entries){
 const locals=[],centrals=[];let offset=0;
 for(const e of entries){
  const name=Buffer.from(e.name,'utf8'),raw=Buffer.isBuffer(e.data)?e.data:Buffer.from(e.data,'utf8'),comp=zlib.deflateRawSync(raw),crc=crc32(raw);
  const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt16LE(0x0800,6);lh.writeUInt16LE(8,8);lh.writeUInt16LE(0,10);lh.writeUInt16LE(0x21,12);lh.writeUInt32LE(crc,14);lh.writeUInt32LE(comp.length,18);lh.writeUInt32LE(raw.length,22);lh.writeUInt16LE(name.length,26);lh.writeUInt16LE(0,28);
  const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);ch.writeUInt16LE(0x0800,8);ch.writeUInt16LE(8,10);ch.writeUInt16LE(0,12);ch.writeUInt16LE(0x21,14);ch.writeUInt32LE(crc,16);ch.writeUInt32LE(comp.length,20);ch.writeUInt32LE(raw.length,24);ch.writeUInt16LE(name.length,28);ch.writeUInt32LE(offset,42);
  locals.push(lh,name,comp);centrals.push(ch,name);offset+=30+name.length+comp.length;
 }
 const cd=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,cd,end]);
}

function unzip(buf,{maxEntryBytes=64*1024*1024}={}){
 let eocd=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--){if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break}}
 if(eocd<0)throw Object.assign(new Error('Not a valid ZIP/OOXML file'),{status:400});
 const count=buf.readUInt16LE(eocd+10);let p=buf.readUInt32LE(eocd+16);const out=new Map();
 for(let i=0;i<count;i++){
  if(buf.readUInt32LE(p)!==0x02014b50)throw Object.assign(new Error('Corrupt ZIP directory'),{status:400});
  const method=buf.readUInt16LE(p+10),csize=buf.readUInt32LE(p+20),nlen=buf.readUInt16LE(p+28),elen=buf.readUInt16LE(p+30),clen=buf.readUInt16LE(p+32),lho=buf.readUInt32LE(p+42);
  const name=buf.toString('utf8',p+46,p+46+nlen);p+=46+nlen+elen+clen;
  out.set(name,()=>{
   const ln=buf.readUInt16LE(lho+26),le=buf.readUInt16LE(lho+28),start=lho+30+ln+le,data=buf.subarray(start,start+csize);
   if(method===0)return Buffer.from(data);
   if(method===8)return zlib.inflateRawSync(data,{maxOutputLength:maxEntryBytes});
   throw Object.assign(new Error('Unsupported ZIP compression'),{status:400});
  });
 }
 return out;
}

function docx(text){
 const paras=String(text||'').split(/\r?\n/).map(l=>`<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('');
 return zip([
  {name:'[Content_Types].xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'},
  {name:'_rels/.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'},
  {name:'word/document.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`}
 ]);
}

function xlsx(){
 return zip([
  {name:'[Content_Types].xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'},
  {name:'_rels/.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
  {name:'xl/workbook.xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'},
  {name:'xl/_rels/workbook.xml.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'},
  {name:'xl/worksheets/sheet1.xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'}
 ]);
}

// Extracts paragraphs from a .docx as renderable blocks (headings, lists, text, page breaks).
function docxBlocks(buf){
 const files=unzip(buf);const doc=files.get('word/document.xml');
 if(!doc)throw Object.assign(new Error('Not a Word (.docx) document'),{status:400});
 const xml=doc().toString('utf8'),blocks=[];
 for(const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)){
  const p=m[0];let text='';
  for(const tok of p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:br\s+w:type="page"\s*\/>/g)){
   if(tok[1]!==undefined)text+=unesc(tok[1]);else if(tok[0].startsWith('<w:tab'))text+='\t';else if(/w:type="page"/.test(tok[0])){if(text)blocks.push({type:'p',text});text='';blocks.push({type:'pagebreak'})}else text+='\n'}
  const style=(/<w:pStyle\s+w:val="([^"]+)"/.exec(p)||[])[1]||'';
  const level=/^(?:Heading|Заглавие)\s*(\d)$/i.exec(style);
  if(!text.trim()){blocks.push({type:'space'});continue}
  if(/^Title$/i.test(style))blocks.push({type:'h1',text});
  else if(level)blocks.push({type:'h'+Math.min(3,Number(level[1])),text});
  else if(/<w:numPr>/.test(p)||/List/i.test(style))blocks.push({type:'li',marker:'•',text,level:0});
  else blocks.push({type:'p',text});
 }
 return blocks;
}
module.exports={zip,unzip,docx,xlsx,docxBlocks,crc32};
