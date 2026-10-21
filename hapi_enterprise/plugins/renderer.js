'use strict';
// Renderer плъгин (Фаза 2.4). Единен интерфейс към PDF (pdf-writer) и OOXML
// (docx/xlsx) без външни зависимости. Форматът се избира от потребителя.
const pdf=require('../pdf-writer');
const ooxml=require('../ooxml');

function create(){
  return {
    // blocks: [{type:'h1'|'p'|'li'|'space'|'pagebreak', text, marker, level}]
    renderPdf(blocks,{title='',watermark=''}={}){return Buffer.from(pdf.render(blocks,{title,watermark}));},
    markdownToBlocks(md){return pdf.markdownBlocks(md);},
    renderDocx(text){return ooxml.docx(text);},
    renderXlsx(rows){return ooxml.xlsx(rows);},
    docxToBlocks(buf){return ooxml.docxBlocks(buf);},
    xlsxToBlocks(buf){return ooxml.xlsxBlocks(buf);},
    pptxToBlocks(buf){return ooxml.pptxBlocks(buf);},
    render({format,blocks,text,title,rows,watermark}){
      switch(format){
        case 'pdf':return this.renderPdf(blocks||[],{title,watermark});
        case 'docx':return this.renderDocx(text||'');
        case 'xlsx':return this.renderXlsx(rows||[]);
        default:throw Object.assign(Error(`Renderer: unknown format "${format}"`),{status:400});
      }
    }
  };
}
module.exports={create};
