import { clone } from '../core/utils.js';
function isRedRecord(value) {
  return value&&typeof value==='object'&&(
    value.ui_color==='red'||
    value.machine_type==='operation.discard'||
    (typeof value.object_id==='string'&&value.object_id.startsWith('RED-'))||
    (typeof value.id==='string'&&value.id.startsWith('RED-'))
  );
}
function clean(value) {
  if(Array.isArray(value))return value.filter(item=>!isRedRecord(item)&&!isRedReference(item)).map(clean);
  if(!value||typeof value!=='object')return value;
  const result=Object.create(Object.getPrototypeOf(value)===null?null:Object.prototype);
  for(const [key,item] of Object.entries(value)){
    if(key.startsWith('RED-')||isRedRecord(item)||isRedReference(item))continue;
    result[key]=clean(item);
  }
  return result;
}
function isRedReference(value) {
  if(!value||typeof value!=='object')return false;
  return ['object_id','id','from','to'].some(key=>typeof value[key]==='string'&&value[key].startsWith('RED-'));
}
function containsRed(value) {
  if(isRedRecord(value)||isRedReference(value))return true;
  if(Array.isArray(value))return value.some(containsRed);
  if(value&&typeof value==='object')return Object.entries(value).some(([key,item])=>key.startsWith('RED-')||containsRed(item));
  return false;
}
export function purgeRedTransientState(manifest) {
  return clean(clone(manifest));
}
export function assertNoRedPersistence(manifest) {
  if(containsRed(manifest))throw new Error('red transient data persisted');
  return true;
}
