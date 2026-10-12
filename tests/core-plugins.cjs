'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
  // --- Storage plugin ---
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'core-plugins-'));
  try{
    const storage=require('../hapi_enterprise/plugins/storage').create({root:dir});
    await storage.write('a/b.txt',Buffer.from('hello'));
    assert.equal((await storage.read('a/b.txt')).toString(),'hello');
    assert.equal(await storage.exists('a/b.txt'),true);
    const listing=await storage.list('a');
    assert.deepEqual(listing,[{name:'b.txt',dir:false}]);
    await storage.remove('a');
    assert.equal(await storage.exists('a/b.txt'),false);
    await assert.rejects(()=>storage.read('../secret'),/outside root|Invalid path/);

    // --- Renderer plugin ---
    const renderer=require('../hapi_enterprise/plugins/renderer').create();
    const blocks=renderer.markdownToBlocks('# Заглавие\nТекст\n- точка');
    assert(blocks.some(b=>b.type==='h1'));
    const pdf=renderer.renderPdf(blocks,{title:'Тест'});
    assert(Buffer.isBuffer(pdf)&&pdf.toString('latin1',0,5)==='%PDF-');
    const docx=renderer.renderDocx('Текст за документ');
    assert(Buffer.isBuffer(docx)&&docx.readUInt32LE(0)===0x04034b50); // ZIP magic
    const xlsx=renderer.renderXlsx();
    assert(Buffer.isBuffer(xlsx)&&xlsx.readUInt32LE(0)===0x04034b50);
    const back=renderer.docxToBlocks(docx);
    assert(back.some(b=>b.text.includes('Текст за документ')));
    assert.throws(()=>renderer.render({format:'tiff'}),/unknown format/);

    // --- OCR plugin ---
    const ocrOff=require('../hapi_enterprise/plugins/ocr').create({mode:'disabled'});
    assert.equal(ocrOff.available,false);
    assert.equal(await ocrOff.extractText(docx,'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),null);
    const ocrNative=require('../hapi_enterprise/plugins/ocr').create({mode:'native'});
    const text=await ocrNative.extractText(docx,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert(text&&text.includes('Текст за документ'));
    assert.throws(()=>require('../hapi_enterprise/plugins/ocr').create({mode:'watson'}),/unknown mode/);

    console.log('core-plugins OK');
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
