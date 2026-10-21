'use strict';
// OCR плъгин (Фаза 2.4). Интерфейс за извличане на текст; конфигурационно
// сменяем (disabled | native | tesseract). disabled е default и не изисква външен
// бинарен инструмент — add-on-ът остава самодостатъчен, докато не се включи OCR.
const MODES=['disabled','native','tesseract'];

function create({mode='disabled'}={}){
  if(!MODES.includes(mode))throw Error(`OCR: unknown mode "${mode}" (valid: ${MODES.join(', ')})`);
  const available=mode!=='disabled';
  return {
    mode,
    available,
    capabilities:{modes:MODES},
    // Връща текст или null, когато OCR е изключен/неприложим.
    async extractText(buffer,mime){
      if(!available)return null;
      if(mode==='native'){
        // "native" = текстови слоеве без реален OCR (PDF/DOCX текстови блокове).
        // Реален OCR идва с 'tesseract', което изисква външен бинарен инструмент.
        if(mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'){
          const ooxml=require('../ooxml');
          try{return ooxml.docxBlocks(buffer).map(b=>b.text||'').filter(Boolean).join('\n');}catch{return null}
        }
        return null;
      }
      // 'tesseract' — бъдещо свързване; тук връща null, докато не се добави бинарен път.
      return null;
    }
  };
}
module.exports={create,MODES};
