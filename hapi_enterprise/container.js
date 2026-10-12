'use strict';
// DI контейнер (Фаза 2.1, P1/P2). Лениво инстанцира сингълтони; поддържа
// transient фабрики и директна регистрация на стойности. Държан < 100 реда.
const err=(m,s)=>{const e=Error(m);if(s)e.status=s;return e};

function create(){
  const factories=new Map(); // name -> {fn, singleton}
  const instances=new Map(); // name -> resolved singleton
  const values=new Map();    // name -> plain value

  function register(name,factory,{singleton=true}={}){
    if(typeof name!=='string'||!name)throw err('Container: name required');
    if(typeof factory!=='function')throw err(`Container: factory for "${name}" must be a function`);
    factories.set(name,{fn:factory,singleton:!!singleton});
    instances.delete(name);values.delete(name);
    return name;
  }

  function registerValue(name,value){
    if(typeof name!=='string'||!name)throw err('Container: name required');
    values.set(name,value);factories.delete(name);instances.delete(name);
    return name;
  }

  function has(name){return factories.has(name)||values.has(name)||instances.has(name);}

  function get(name,{transient=false}={}){
    if(values.has(name))return values.get(name);
    if(!transient&&instances.has(name))return instances.get(name);
    const entry=factories.get(name);
    if(!entry)throw err(`Container: "${name}" is not registered`);
    const inst=entry.fn(c=>get(c));
    if(entry.singleton&&!transient)instances.set(name,inst);
    return inst;
  }

  function list(){return [...new Set([...factories.keys(),...values.keys(),...instances.keys()])];}

  function clear(){factories.clear();instances.clear();values.clear();}

  return {register,registerValue,get,has,list,clear};
}
module.exports={create};
