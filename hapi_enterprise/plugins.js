'use strict';
// Плъгин регистър (Фаза 2.4, P2/P4). Именувани плъгини по вид (storage, renderer,
// ocr), конфигурационно сменяеми без рефакторинг на потребителите.
function create(){
  const reg=new Map(); // kind -> Map(name -> impl)

  function register(kind,name,impl){
    if(typeof kind!=='string'||!kind)throw Error('Plugins: kind required');
    if(typeof name!=='string'||!name)throw Error('Plugins: name required');
    if(!impl||typeof impl!=='object')throw Error(`Plugin ${kind}/${name}: implementation required`);
    if(!reg.has(kind))reg.set(kind,new Map());
    reg.get(kind).set(name,impl);
    return name;
  }

  function get(kind,name){const m=reg.get(kind);return m?m.get(name):undefined;}
  function list(kind){const m=reg.get(kind);return m?[...m.keys()]:[];}
  function has(kind,name){const m=reg.get(kind);return !!(m&&m.has(name));}
  function all(){const out={};for(const [k,m] of reg)out[k]=[...m.keys()];return out;}

  return {register,get,list,has,all};
}
module.exports={create};
