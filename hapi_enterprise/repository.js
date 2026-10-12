'use strict';
// Repository интерфейс (Фаза 2.3, ADR-04/P4). Дефинира persistence контракта за
// групи, записи и променливи, така че бекендът да се сменя без рефакторинг.
const METHODS={
  group:['listGroups','getGroup','createGroup','updateGroup','deleteGroup'],
  record:['listRecords','getRecord','createRecord','updateRecord','deleteRecord','associateRecord','detachRecord','searchRecords'],
  variable:['getVariable','setVariable','listVariablesForRecord'],
  meta:['getMeta','setMeta'],
  lifecycle:['close']
};
const ALL=[...METHODS.group,...METHODS.record,...METHODS.variable,...METHODS.meta,...METHODS.lifecycle];

function create(impl){
  if(!impl||typeof impl!=='object')throw Error('Repository: implementation object required');
  const missing=ALL.filter(m=>typeof impl[m]!=='function');
  if(missing.length)throw Error(`Repository: missing methods: ${missing.join(', ')}`);
  return impl;
}
module.exports={create,METHODS};
