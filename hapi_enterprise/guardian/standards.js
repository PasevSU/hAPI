'use strict';
/**
 * BCP 47, Unicode NFC and RFC3339 helpers for Guardian protocols.
 * Never normalize signed payload bytes, IDs or immutable evidence.
 */
const DEFAULT_LANGUAGES=Object.freeze(['bg','en','de']);
function language(raw,{supported=DEFAULT_LANGUAGES,fallback=null}={}){
  if(typeof raw!=='string'||raw.length>60)return fallback;
  try{
    const canonical=Intl.getCanonicalLocales(raw.replace(/_/g,'-'))[0];
    if(!canonical)return fallback;
    const primary=canonical.split('-')[0].toLowerCase();
    return supported.includes(primary)?primary:fallback;
  }catch{return fallback;}
}
function normalizedSearchText(value){
  if(typeof value!=='string')throw new TypeError('TEXT_REQUIRED');
  return value.normalize('NFC');
}
function messageTokens(value){
  if(typeof value!=='string')throw new TypeError('MESSAGE_REQUIRED');
  return [...new Set([...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(x=>x[1]))].sort();
}
function compatibleMessages(source,translated){
  return JSON.stringify(messageTokens(source))===JSON.stringify(messageTokens(translated));
}
function utcTimestamp(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return null;
  const d=new Date(value);
  return Number.isFinite(d.valueOf())?d.toISOString():null;
}
module.exports={language,normalizedSearchText,messageTokens,compatibleMessages,utcTimestamp};
