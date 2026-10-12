'use strict';
// Dependency-free PDF writer with embedded TrueType fonts (Unicode incl. Cyrillic).
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const FONT_FILES={regular:'DejaVuSans.ttf',bold:'DejaVuSans-Bold.ttf',mono:'DejaVuSansMono.ttf'};
const FONT_NAMES={regular:'DejaVuSans',bold:'DejaVuSans-Bold',mono:'DejaVuSansMono'};
const cache={};

function parseFont(buf){
 const u16=o=>buf.readUInt16BE(o),i16=o=>buf.readInt16BE(o),u32=o=>buf.readUInt32BE(o);
 const n=u16(4),T={};for(let i=0;i<n;i++){const o=12+i*16;T[buf.toString('latin1',o,o+4)]={off:u32(o+8),len:u32(o+12)}}
 for(const k of ['head','hhea','hmtx','cmap','maxp'])if(!T[k])throw Error('Invalid font: missing '+k);
 const upm=u16(T.head.off+18),bbox=[i16(T.head.off+36),i16(T.head.off+38),i16(T.head.off+40),i16(T.head.off+42)];
 const ascent=i16(T.hhea.off+4),descent=i16(T.hhea.off+6),nHM=u16(T.hhea.off+34),hm=T.hmtx.off;
 let sub=null;const cm=T.cmap.off,num=u16(cm+2);
 for(let i=0;i<num;i++){const pid=u16(cm+4+i*8),eid=u16(cm+6+i*8),off=cm+u32(cm+8+i*8),fmt=u16(off);
  if(fmt===12&&pid===3&&eid===10){sub={off,fmt};break}
  if(fmt===4&&((pid===3&&eid===1)||pid===0)&&(!sub||sub.fmt!==12))sub={off,fmt}}
 if(!sub)throw Error('Invalid font: no Unicode cmap');
 const memo=new Map();
 function glyph(cp){
  if(memo.has(cp))return memo.get(cp);let g=0;
  if(sub.fmt===12){const ng=u32(sub.off+12);for(let i=0;i<ng;i++){const o=sub.off+16+i*12,s=u32(o),e=u32(o+4);if(cp>=s&&cp<=e){g=u32(o+8)+cp-s;break}}}
  else if(cp<=0xFFFF){const sx2=u16(sub.off+6),segs=sx2/2,eo=sub.off+14,so=eo+sx2+2,dO=so+sx2,rO=dO+sx2;
   for(let i=0;i<segs;i++){if(cp<=u16(eo+2*i)){const st=u16(so+2*i);if(cp>=st){const ro=u16(rO+2*i),d=u16(dO+2*i);if(ro===0)g=(cp+d)&0xFFFF;else{const v=u16(rO+2*i+ro+2*(cp-st));g=v?(v+d)&0xFFFF:0}}break}}}
  memo.set(cp,g);return g;
 }
 const adv=g=>u16(hm+4*Math.min(g,nHM-1));
 return {buf,upm,bbox,ascent,descent,glyph,adv};
}
function font(kind){
 if(!cache[kind]){cache[kind]=parseFont(fs.readFileSync(path.join(__dirname,'fonts',FONT_FILES[kind])))}
 return cache[kind];
}

function jpegSize(buf){
 // Чете ширина/височина от SOF сегмента на JPEG (без външни зависимости).
 let i=2;
 while(i<buf.length){
  if(buf[i]!==0xFF)throw Error('Invalid JPEG data');
  const marker=buf[i+1];
  if(marker>=0xC0&&marker<=0xCF&&marker!==0xC4&&marker!==0xC8&&marker!==0xCC)return {h:buf.readUInt16BE(i+5),w:buf.readUInt16BE(i+7)};
  i+=2+buf.readUInt16BE(i+2);
 }
 throw Error('Invalid JPEG data: no SOF marker');
}
const A4={w:595.28,h:841.89},M={l:56,r:56,t:60,b:64};
const STYLES={
 h1:{font:'bold',size:20,lead:26,before:14,after:8},
 h2:{font:'bold',size:16,lead:21,before:12,after:6},
 h3:{font:'bold',size:13,lead:18,before:10,after:4},
 p:{font:'regular',size:11,lead:16,before:0,after:7},
 li:{font:'regular',size:11,lead:16,before:0,after:3,indent:20},
 quote:{font:'regular',size:11,lead:16,before:0,after:7,indent:16,gray:0.4},
 code:{font:'mono',size:9.5,lead:13,before:2,after:6,pad:4},
 table:{font:'regular',size:9.5,lead:13,before:6,after:8,pad:4}
};
const hex=n=>n.toString(16).padStart(4,'0');
const num=n=>(Math.round(n*100)/100).toString();

function render(blocks,{title='',watermark=''}={}){
 const used={};const fontIds={};const faces={};
 const face=kind=>{if(!faces[kind]){faces[kind]={f:font(kind),key:'F'+(Object.keys(faces).length+1),used:new Map()}}return faces[kind]};
 const measure=(kind,s,size)=>{const F=face(kind).f;let w=0;for(const ch of s)w+=F.adv(F.glyph(ch.codePointAt(0)));return w*size/F.upm};
 const encode=(kind,s)=>{const fc=face(kind),F=fc.f;let out='';for(const ch of s){const cp=ch.codePointAt(0),g=F.glyph(cp);out+=hex(g);if(!fc.used.has(g))fc.used.set(g,cp)}return out};
 const pages=[];const images=[];let ops,y;
 const newPage=()=>{ops=[];pages.push(ops);y=A4.h-M.t};
 const maxW=A4.w-M.l-M.r;
 function wrap(kind,size,text,width){
  const lines=[];
  for(const para of String(text).replace(/\t/g,'    ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').split('\n')){
   if(!para.trim()){lines.push('');continue}
   let line='';
   for(const word of para.split(/(?<= )/)){
    const cand=line+word;
    if(measure(kind,cand.trimEnd(),size)<=width){line=cand;continue}
    if(line)lines.push(line.trimEnd());
    if(measure(kind,word.trimEnd(),size)<=width){line=word;continue}
    line='';for(const ch of word){if(measure(kind,line+ch,size)>width&&line){lines.push(line);line=ch}else line+=ch}
   }
   lines.push(line.trimEnd());
  }
  return lines;
 }
 const draw=(kind,size,x,yy,text,gray=0)=>{ops.push(`BT ${gray?num(gray)+' g ':''}/${face(kind).key} ${num(size)} Tf ${num(x)} ${num(yy)} Td <${encode(kind,text)}> Tj ET${gray?' 0 g':''}`)};
 newPage();
 for(const b of blocks){
  if(b.type==='pagebreak'){newPage();continue}
  if(b.type==='space'){y-=6;continue}
  if(b.type==='hr'){if(y-14<M.b)newPage();y-=8;ops.push(`0.7 G 0.8 w ${num(M.l)} ${num(y)} m ${num(A4.w-M.r)} ${num(y)} l S 0 G`);y-=8;continue}
  if(b.type==='image'){
   const data=b.data;
   if(!Buffer.isBuffer(data)||!data.length)throw Error('Image block requires a JPEG data buffer');
   if(data[0]!==0xFF||data[1]!==0xD8)throw Error('Only JPEG images are supported (convert PNG/WebP first)');
   const sz=jpegSize(data);
   const dw=Math.min(Number(b.width)||sz.w,maxW);
   const dh=Math.min(Number(b.height)||(sz.h*dw/sz.w),A4.h-M.t-M.b);
   if(y-dh<M.b)newPage();
   const imgN=images.length+1;
   images.push({data,w:sz.w,h:sz.h});
   ops.push(`q ${num(dw)} 0 0 ${num(dh)} ${num(M.l)} ${num(y-dh)} cm /Im${imgN} Do Q`);
   y-=dh+6;continue;
  }
  if(b.type==='table'){
   const st=STYLES.table,pad=st.pad;
   const rows=(b.rows||[]).map(r=>Array.isArray(r)?r.map(c=>String(c==null?'':c)):Object.values(r||{}).map(c=>String(c==null?'':c)));
   const ncol=Math.max(1,...rows.map(r=>r.length));
   const colW=maxW/ncol,cellW=Math.max(10,colW-pad*2);
   const wrapped=rows.map(r=>{const cells=[];for(let c=0;c<ncol;c++)cells.push(wrap(st.font,st.size,r[c]||'',cellW));return cells});
   const rowH=wrapped.map((w,ri)=>Math.max(1,...w.map(c=>c.length))*st.lead+pad*2);
   if(y-st.before-Math.min(...rowH)<M.b&&y<A4.h-M.t)newPage();
   y-=st.before;
   for(let ri=0;ri<rows.length;ri++){
    const rh=rowH[ri];
    if(y-rh<M.b){newPage();y=A4.h-M.t-st.before}
    const top=y;
    for(let ci=0;ci<ncol;ci++)ops.push(`0.6 G 0.5 w ${num(M.l+ci*colW)} ${num(top-rh)} ${num(colW)} ${num(rh)} re S 0 G`);
    for(let ci=0;ci<ncol;ci++){
     const x=M.l+ci*colW;
     wrapped[ri][ci].forEach((ln,li)=>{
      draw(b.header&&ri===0?'bold':st.font,st.size,x+pad,top-pad-st.size-li*st.lead,ln);
     });
    }
    y=top-rh;
   }
   y-=st.after;continue;
  }
  const st=STYLES[b.type]||STYLES.p;
  const indent=(st.indent||0)+(b.type==='li'?(b.level||0)*16:0)+(b.type==='li'?0:0);
  const x0=M.l+(b.type==='li'?(b.level||0)*16:0)+(b.type==='quote'?st.indent:0);
  const textX=M.l+indent+(b.type==='quote'?0:0);
  const width=maxW-(b.type==='li'?(st.indent+(b.level||0)*16):0)-(b.type==='quote'?st.indent:0)-(b.type==='code'?st.pad*2:0);
  const lines=wrap(st.font,st.size,b.text||'',width);
  if(y-st.before-st.lead<M.b&&y<A4.h-M.t)newPage();
  y-=st.before;
  lines.forEach((ln,i)=>{
   if(y-st.lead<M.b)newPage();
   const base=y-st.size;
   if(b.type==='code')ops.push(`0.95 g ${num(M.l)} ${num(y-st.lead+2)} ${num(maxW)} ${num(st.lead)} re f 0 g`);
   if(b.type==='quote')ops.push(`0.75 G 2 w ${num(M.l+4)} ${num(y-st.lead+2)} m ${num(M.l+4)} ${num(y+2)} l S 0 G`);
   if(i===0&&b.type==='li')draw('regular',st.size,M.l+(b.level||0)*16,base,b.marker||'•');
   if(ln)draw(st.font,st.size,b.type==='code'?M.l+st.pad:(b.type==='li'?M.l+(b.level||0)*16+st.indent:x0),base,ln,st.gray||0);
   y-=st.lead;
  });
  y-=st.after;
 }
 // page numbers
 pages.forEach((p,i)=>{ops=p;const label=(i+1)+' / '+pages.length,w=measure('regular',label,9);draw('regular',9,(A4.w-w)/2,32,label,0.45);
  if(watermark){const wm=String(watermark);ops.push(`BT 0.92 g /${face('regular').key} ${num(46)} Tf 0.707 0.707 -0.707 0.707 ${num(A4.w/2)} ${num(A4.h/2)} Tm <${encode('regular',wm)}> Tj ET 0 g`)}
 });

 const objs=[];const reserve=()=>{objs.push(null);return objs.length};const setObj=(n,b)=>{objs[n-1]=Buffer.isBuffer(b)?b:Buffer.from(b,'latin1')};
 const stream=(n,dict,data)=>setObj(n,Buffer.concat([Buffer.from(`${n} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`,'latin1'),data,Buffer.from('\nendstream\nendobj\n','latin1')]));
 const obj=(n,body)=>setObj(n,`${n} 0 obj\n${body}\nendobj\n`);
 const catalog=reserve(),pagesRef=reserve(),info=reserve();
 const u16hex=s=>{let o='FEFF';for(let i=0;i<s.length;i++)o+=hex(s.charCodeAt(i));return o};
 const fontRefs={};
 for(const [kind,fc] of Object.entries(faces)){
  const F=fc.f,type0=reserve(),cid=reserve(),desc=reserve(),file=reserve(),tou=reserve();fontRefs[fc.key]=type0;
  const gids=[...fc.used.keys()].sort((a,b)=>a-b);
  stream(file,`/Length1 ${F.buf.length} /Filter /FlateDecode`,zlib.deflateSync(F.buf));
  obj(desc,`<< /Type /FontDescriptor /FontName /${FONT_NAMES[kind]} /Flags 32 /FontBBox [${F.bbox.map(v=>Math.round(v*1000/F.upm)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(F.ascent*1000/F.upm)} /Descent ${Math.round(F.descent*1000/F.upm)} /CapHeight ${Math.round(F.ascent*700/F.upm)} /StemV 80 /FontFile2 ${file} 0 R >>`);
  obj(cid,`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${FONT_NAMES[kind]} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /DW 1000 /W [${gids.map(g=>`${g} [${Math.round(F.adv(g)*1000/F.upm)}]`).join(' ')}] /CIDToGIDMap /Identity >>`);
  const chunks=[];for(let i=0;i<gids.length;i+=100){chunks.push(`${Math.min(100,gids.length-i)} beginbfchar\n`+gids.slice(i,i+100).map(g=>{const cp=fc.used.get(g);const u=cp>0xFFFF?hex(0xD800+((cp-0x10000)>>10))+hex(0xDC00+((cp-0x10000)&0x3FF)):hex(cp);return `<${hex(g)}> <${u}>`}).join('\n')+'\nendbfchar')}
  stream(tou,'/Filter /FlateDecode',zlib.deflateSync(Buffer.from('/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n'+chunks.join('\n')+'\nendcmap CMapName currentdict /CMap defineresource pop end end','latin1')));
  obj(type0,`<< /Type /Font /Subtype /Type0 /BaseFont /${FONT_NAMES[kind]} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tou} 0 R >>`);
 }
 const imgRefs=[];for(const im of images){const r=reserve();stream(r,`/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,im.data);imgRefs.push(r)}
 const fontRes=Object.entries(fontRefs).map(([k,r])=>`/${k} ${r} 0 R`).join(' ');
 const xobjRes=imgRefs.length?` /XObject << ${imgRefs.map((r,i)=>`/Im${i+1} ${r} 0 R`).join(' ')} >>`:'';
 const kids=[];
 for(const p of pages){
  const c=reserve(),pg=reserve();kids.push(pg);
  stream(c,'/Filter /FlateDecode',zlib.deflateSync(Buffer.from(p.join('\n'),'latin1')));
  obj(pg,`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << ${fontRes} >>${xobjRes} >> /Contents ${c} 0 R >>`);
 }
 obj(pagesRef,`<< /Type /Pages /Kids [${kids.map(k=>k+' 0 R').join(' ')}] /Count ${kids.length} >>`);
 obj(catalog,`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);
 obj(info,`<< /Title <${u16hex(String(title).slice(0,200))}> /Producer (hAPI Enterprise) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g,'').slice(0,14)}Z) >>`);
 const head=Buffer.from('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n','latin1'),parts=[head],offs=[];let pos=head.length;
 for(const o of objs){offs.push(pos);parts.push(o);pos+=o.length}
 let xref=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`+offs.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
 xref+=`trailer\n<< /Size ${objs.length+1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
 parts.push(Buffer.from(xref,'latin1'));
 return Buffer.concat(parts);
}

function inline(s){
 return s.replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g,'$1 ($2)').replace(/(\*\*|__)(.+?)\1/g,'$2').replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g,'$1$2').replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g,'$1$2').replace(/~~(.+?)~~/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/<[^>]+>/g,'');
}
function markdownBlocks(md){
 const blocks=[],lines=String(md).replace(/^\uFEFF/,'').split(/\r?\n/);let para=[],code=null,table=null;
 const flush=()=>{if(para.length){blocks.push({type:'p',text:inline(para.join(' '))});para=[]}};
 const flushTable=()=>{if(table){const rows=table.rows;blocks.push({type:'table',header:table.header,rows:rows.map(r=>r.map(c=>inline(c)))});table=null}};
 const splitRow=l=>l.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());
 for(const line of lines){
  if(/^\s*```/.test(line)){if(code){blocks.push({type:'code',text:code.join('\n')});code=null}else{flush();flushTable();code=[]}continue}
  if(code){code.push(line);continue}
  let m;
  if(/^\s*\|/.test(line)){
   if(/^\s*\|?\s*:?-{2,}/.test(line)){if(table&&table.rows.length&&!table.header)table.header=true}
   else{flush();if(!table)table={rows:[],header:false};table.rows.push(splitRow(line))}
   continue;
  }
  flushTable();
  if(!line.trim()){flush();continue}
  if((m=/^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))){flush();blocks.push({type:'h'+Math.min(3,m[1].length),text:inline(m[2])});continue}
  if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)){flush();blocks.push({type:'hr'});continue}
  if((m=/^(\s*)[-*+]\s+(.*)$/.exec(line))){flush();blocks.push({type:'li',marker:'•',level:Math.min(4,Math.floor(m[1].replace(/\t/g,'  ').length/2)),text:inline(m[2])});continue}
  if((m=/^(\s*)(\d+)[.)]\s+(.*)$/.exec(line))){flush();blocks.push({type:'li',marker:m[2]+'.',level:Math.min(4,Math.floor(m[1].replace(/\t/g,'  ').length/2)),text:inline(m[3])});continue}
  if((m=/^>\s?(.*)$/.exec(line))){flush();blocks.push({type:'quote',text:inline(m[1])});continue}
  para.push(line.trim());
 }
 if(code)blocks.push({type:'code',text:code.join('\n')});
 flushTable();flush();return blocks;
}
module.exports={render,markdownBlocks};
