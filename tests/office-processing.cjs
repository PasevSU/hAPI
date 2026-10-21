'use strict';
// Pure-module tests for Phase 4.4 document processing: real xlsx content,
// xlsx/pptx extraction, and pdf table + watermark rendering.
const assert=require('node:assert/strict');
const ooxml=require('../hapi_enterprise/ooxml');
const pdf=require('../hapi_enterprise/pdf-writer');

// 1) xlsx roundtrip: numbers become strings on readback (inline values only).
{
 const rows=[['Име','Години'],['Иван',42],['Мария',30]];
 const buf=ooxml.xlsx(rows);
 const parsed=ooxml.xlsxBlocks(buf);
 assert.deepEqual(parsed,[['Име','Години'],['Иван','42'],['Мария','30']],'xlsx roundtrip');
}
// 2) xlsx escapes markup correctly (cell containing angle brackets survives).
{
 const buf=ooxml.xlsx([['<a&b>']]);
 assert.deepEqual(ooxml.xlsxBlocks(buf),[['<a&b>']],'xlsx escaping');
}
// 3) pptx text extraction from a crafted minimal slide.
{
 const slide1='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Заглавие</a:t></a:r></a:p><a:p><a:r><a:t>Първа точка</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
 const pptx=ooxml.zip([{name:'ppt/slides/slide1.xml',data:slide1}]);
 const blocks=ooxml.pptxBlocks(pptx);
 assert.deepEqual(blocks,[{type:'p',text:'Заглавие'},{type:'p',text:'Първа точка'}],'pptx text extraction');
}
// 4) pdf.render accepts table blocks + watermark and emits a PDF.
{
 const buf=pdf.render([
  {type:'h1',text:'Таблица'},
  {type:'table',header:true,rows:[['Име','Години'],['Иван','42'],['Мария','30']]}
 ],{title:'Отчет',watermark:'СЛУЖЕБНО'});
 assert.ok(Buffer.isBuffer(buf)&&buf.length>0,'pdf emitted');
 assert.ok(buf.subarray(0,8).toString('latin1').startsWith('%PDF'),'pdf magic');
}
// 5) markdown table parsing produces a table block with header flag.
{
 const blocks=pdf.markdownBlocks('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
 const tbl=blocks.find(b=>b.type==='table');
 assert.ok(tbl,'table block present');
 assert.equal(tbl.header,true,'header detected');
 assert.deepEqual(tbl.rows,[['A','B'],['1','2']],'table rows');
}
// 6) pdf.render embeds JPEG images (DCTDecode) and rejects non-JPEG.
{
 const jpeg=Buffer.from([0xFF,0xD8,0xFF,0xC0,0x00,0x11,0x08,0x00,0x10,0x00,0x10,0x03,0x01,0x11,0x00,0x02,0x11,0x01,0x03,0x11,0x01,0xFF,0xD9]);
 const buf=pdf.render([{type:'image',data:jpeg}],{title:'img'});
 assert.ok(buf.includes(Buffer.from('/Subtype /Image','latin1')),'image xobject present');
 assert.ok(buf.includes(Buffer.from('/DCTDecode','latin1')),'jpeg filter present');
 assert.throws(()=>pdf.render([{type:'image',data:Buffer.from('not-jpeg')}]),/JPEG/,'rejects non-jpeg');
}
console.log('office-processing OK');
