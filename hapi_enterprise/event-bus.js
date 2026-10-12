'use strict';
// In-process Event Bus (Фаза 2.2, P5). Излъчва наблюдаеми domain събития;
// слушателите се изпълняват асинхронно и никога не хвърлят към излъчвателя.
function create(){
  const handlers=new Map(); // event -> Set(fn)

  function on(event,fn){
    if(typeof event!=='string'||!event)throw Error('EventBus: event name required');
    if(typeof fn!=='function')throw Error('EventBus: listener must be a function');
    if(!handlers.has(event))handlers.set(event,new Set());
    handlers.get(event).add(fn);
    return ()=>off(event,fn);
  }

  function once(event,fn){
    const wrap=(payload)=>{off(event,wrap);return fn(payload);};
    return on(event,wrap);
  }

  function off(event,fn){
    const set=handlers.get(event);
    if(!set)return false;
    if(fn){const r=set.delete(fn);if(!set.size)handlers.delete(event);return r;}
    handlers.delete(event);return true;
  }

  function listenerCount(event){const s=handlers.get(event);return s?s.size:0;}
  function events(){return [...handlers.keys()];}

  async function emit(event,payload={}){
    const set=handlers.get(event);
    if(!set)return [];
    const results=[];
    for(const fn of [...set]){
      try{results.push(await fn(payload));}
      catch(e){console.error('EVENT BUS LISTENER FAILURE',event,e&&e.message);}
    }
    return results;
  }

  return {on,once,off,emit,listenerCount,events};
}
module.exports={create};
