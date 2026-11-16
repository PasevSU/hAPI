import { assertUniqueObjectId, clone, invariant } from '../core/utils.js';
const DATE=/^(\d{2})\.(\d{2})\.(\d{4})$/;
const DATE_RANGE=/^(\d{2}\.\d{2}\.\d{4})\s*[-–]\s*(\d{2}\.\d{2}\.\d{4})$/;
const TIME_RANGE=/^(\d{1,2}:\d{2})\s*(?:Uhr\s*)?(?:bis|[-–])\s*(\d{1,2}:\d{2})(?:\s*Uhr)?$/i;
const SUPPORTED_TYPES=new Set(['DATE','DATE_RANGE','TIME_RANGE','EMAIL','TELEPHONE','FAX','DOCUMENT_REFERENCE','PERSON_NAME']);
function parseDate(value) {
  const match=value.match(DATE);
  if(!match)return null;
  const day=Number(match[1]),month=Number(match[2]),year=Number(match[3]);
  const date=new Date(0);
  date.setUTCHours(0,0,0,0);
  date.setUTCFullYear(year,month-1,day);
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
  return {iso:`${match[3]}-${match[2]}-${match[1]}`,day:match[1],month:match[2],year:match[3]};
}
function parseTime(value) {
  const match=value.match(/^(\d{1,2}):(\d{2})$/);
  if(!match)return null;
  const hour=Number(match[1]),minute=Number(match[2]);
  return hour<=23&&minute<=59?hour*60+minute:null;
}
export function parseStructuredValue(type, raw) {
  const text=String(raw??'').trim(); let valid=SUPPORTED_TYPES.has(type), normalized=text, components={};
  if(type==='DATE'){const date=parseDate(text);valid=!!date;if(date){normalized=date.iso;components={day:date.day,month:date.month,year:date.year};}}
  else if(type==='DATE_RANGE'){const m=text.match(DATE_RANGE);const start=m&&parseDate(m[1]),end=m&&parseDate(m[2]);valid=!!(start&&end&&start.iso<=end.iso);components=m?{start:m[1],end:m[2]}:{};}
  else if(type==='TIME_RANGE'){const m=text.match(TIME_RANGE);const start=m&&parseTime(m[1]),end=m&&parseTime(m[2]);valid=Number.isInteger(start)&&Number.isInteger(end)&&start<=end;components=m?{start:m[1],end:m[2]}:{};}
  else if(type==='EMAIL'){valid=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);normalized=text.toLowerCase();}
  else if(type==='TELEPHONE'||type==='FAX'){valid=/[+()\d][\d\s()+\-/]{5,}/.test(text);}
  else if(type==='DOCUMENT_REFERENCE'){valid=/[A-Za-z0-9]/.test(text) && text.length>=3;}
  else if(type==='PERSON_NAME'){valid=/\p{L}/u.test(text);}
  return {raw:text,normalized,valid,components};
}
export function addDarkBlueStructuredField(manifest, field) {
  invariant(field.object_id && field.field_type && field.datatype, 'object_id, field_type, datatype required');
  assertUniqueObjectId(manifest, field.object_id);
  const m=clone(manifest);
  const parsed=parseStructuredValue(field.datatype,field.value);
  m.objects.push({object_id:field.object_id,machine_type:'semantic.structured',ui_color:'dark-blue',page:field.page,search_zone_id:field.search_zone_id??null,ocr_policy:{run:true,persist_text:true},capture_policy:{persist:true},structured:{field_type:field.field_type,label:field.label??null,datatype:field.datatype,value:parsed,relation:field.relation??null},hash_policy:{include_text:field.include_text!==false}}); return m;
}
