'use strict';
// SQLite repository (Фаза 2.3). Асинхронна фасада над core-store, която
// имплементира Repository контракта — единствената persistence граница.
const repository=require('./repository');

function create({path,dbId='1',secret,registry=null}){
  const store=require('./core-store').create({path,dbId,secret});
  const run=fn=>Promise.resolve().then(()=>fn());
  const notFound=m=>Object.assign(Error(m),{status:404});

  const impl={
    // Groups
    listGroups:()=>run(()=>store.listGroups()),
    getGroup:id=>run(()=>store.getGroup(id)),
    createGroup:input=>run(()=>store.createGroup({...input,registry})),
    updateGroup:(id,input)=>run(()=>store.updateGroup(id,input)),
    deleteGroup:id=>run(()=>store.deleteGroup(id)),

    // Records
    listRecords:groupId=>run(()=>store.listRecords(groupId)),
    getRecord:id=>run(()=>store.getRecord(id)),
    createRecord:input=>run(()=>store.createRecord({...input,registry})),
    updateRecord:(id,fields)=>run(()=>{
      const r=store.getRecord(id);if(!r)throw notFound('Record not found');
      const defs=registry?registry.fieldsFor(r.prefix):[];
      for(const [f,v] of Object.entries(fields||{})){
        const def=defs.find(x=>x.name===f);
        const val=registry?registry.validateField(r.prefix,f,v):v;
        store.setVariable(id,f,val,def);
      }
      return store.getRecord(id);
    }),
    deleteRecord:id=>run(()=>store.deleteRecord(id)),
    associateRecord:(id,groupId)=>run(()=>store.associateRecord(id,groupId)),
    detachRecord:id=>run(()=>store.detachRecord(id)),
    searchRecords:(prefix,q)=>run(()=>store.search(prefix,q)),

    // Variables
    getVariable:key=>run(()=>store.getVariable(key)),
    setVariable:(recordId,field,value,fieldDef)=>run(()=>store.setVariable(recordId,field,value,fieldDef)),
    listVariablesForRecord:recordId=>run(()=>{const r=store.getRecord(recordId);if(!r)throw notFound('Record not found');return r.fields||{};}),

    // Meta + lifecycle
    getMeta:key=>run(()=>store.getMeta(key)),
    setMeta:(key,value)=>run(()=>store.setMeta(key,value)),
    close:()=>run(()=>store.close())
  };

  return repository.create(impl);
}
module.exports={create};
