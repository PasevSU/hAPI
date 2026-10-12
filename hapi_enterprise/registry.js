'use strict';
// Metadata-driven profile schemas (prefix 1000-5000). A new profile is a config entry,
// never new code. Schemas come from built-in defaults overlaid by the `profiles:` block
// in config.yaml / runtime settings.
const err=(m,status=400)=>Object.assign(new Error(m),{status});
const TYPES=['string','text','email','domain','phone','number','date','url','bool','list','encrypted'];
const FIELD_KEY=/^[a-z][a-z0-9_]{0,39}$/;
const clean=v=>typeof v==='string'?v.trim():'';

const DEFAULTS={
 '1000':{label:{bg:'Указател',en:'Directory',de:'Verzeichnis'},fields:[
  {name:'name',type:'string',required:true,indexed:true},
  {name:'organization',type:'string',indexed:true},
  {name:'department',type:'string'},
  {name:'email',type:'email',indexed:true},
  {name:'phone',type:'phone'},
  {name:'address',type:'string'},
  {name:'city',type:'string'},
  {name:'country',type:'string'},
  {name:'website',type:'url'},
  {name:'notes',type:'text'},
 ]},
 '1001':{label:{bg:'Служител',en:'Employee',de:'Mitarbeiter'},fields:[
  {name:'name',type:'string',required:true,indexed:true},
  {name:'egn',type:'string',pattern:'^[0-9]{10}$',indexed:true},
  {name:'phone',type:'phone'},
  {name:'hired_at',type:'date'},
 ]},
 '2000':{label:{bg:'Картотека',en:'Cabinet',de:'Kartei'},fields:[
  {name:'title',type:'string',required:true,indexed:true},
  {name:'category',type:'string',indexed:true},
  {name:'group',type:'string',indexed:true},
  {name:'tags',type:'list'},
  {name:'notes',type:'text'},
 ]},
 '3000':{label:{bg:'Портал',en:'Portal',de:'Portal'},fields:[
  {name:'slug',type:'string',required:true,indexed:true},
  {name:'title',type:'string',required:true,indexed:true},
  {name:'description',type:'text'},
 ]},
 '4000':{label:{bg:'Текст',en:'Text',de:'Text'},fields:[
  {name:'title',type:'string',required:true,indexed:true},
  {name:'body',type:'text'},
  {name:'kind',type:'string'},
 ]},
 '5000':{label:{bg:'Шаблон',en:'Template',de:'Vorlage'},fields:[
  {name:'title',type:'string',required:true,indexed:true},
  {name:'body',type:'text'},
  {name:'type',type:'string'},
 ]},
};

// Value validators return a normalized value or throw {status:400}.
const CHECK={
 string:v=>{v=clean(v);if(v.length>500)throw err('String too long');return v},
 text:v=>{v=clean(v);if(v.length>10000)throw err('Text too long');return v},
 email:v=>{v=clean(v).toLowerCase();if(!/^[^\s@<>"]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/i.test(v))throw err('Invalid email');return v},
 domain:v=>{v=clean(v).toLowerCase();if(!/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*\.[a-z]{2,}$/i.test(v))throw err('Invalid domain');return v},
 phone:v=>{v=clean(v);if(!/^\+?[0-9 ()./-]{5,25}$/.test(v))throw err('Invalid phone');return v},
 number:v=>{v=clean(v);if(!/^-?\d{1,15}([.,]\d{1,6})?$/.test(v))throw err('Invalid number');return v},
 date:v=>{v=clean(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v)))throw err('Invalid date');return v},
 url:v=>{v=clean(v);try{const u=new URL(v);if(!/^https?:$/.test(u.protocol))throw err('Invalid url');return v}catch{throw err('Invalid url')}},
 bool:v=>{if(typeof v==='boolean')return v;v=clean(String(v));if(!/^(true|false)$/i.test(v))throw err('Invalid boolean');return /^true$/i.test(v)},
 list:v=>{if(typeof v==='string')v=v.split(',');if(!Array.isArray(v))throw err('Invalid list');const a=v.map(x=>clean(String(x))).filter(Boolean);if(a.length>500)throw err('List too long');return a},
 encrypted:v=>{v=clean(v);if(v.length>10000)throw err('Encrypted value too long');return v},
};

function mergeDefaults(config){
 const out={};
 for(const [prefix,def] of Object.entries(DEFAULTS))out[prefix]=JSON.parse(JSON.stringify(def));
 if(config&&typeof config==='object'&&!Array.isArray(config)){
  for(const [prefix,def] of Object.entries(config)){
   if(!/^[0-9]{4}$/.test(prefix))throw err('Profile prefix must be 4 digits');
   if(!def||typeof def!=='object')throw err('Invalid profile definition');
   const base=out[prefix]||{label:{},fields:[]};
   const merged={label:{...base.label,...(def.label||{})},fields:Array.isArray(def.fields)?def.fields:base.fields};
   // Validate merged schema eagerly so config mistakes fail fast.
   for(const f of merged.fields){if(!f||!FIELD_KEY.test(f.name||''))throw err(`Invalid field name in profile ${prefix}`);if(!TYPES.includes(f.type))throw err(`Unknown type "${f.type}" in profile ${prefix}`)}
   out[prefix]=merged;
  }
 }
 return out;
}

function create(config){
 const profiles=mergeDefaults(config);
 const prefixes=Object.keys(profiles).sort();
 function getProfile(prefix){return profiles[prefix]||null}
 function fieldsFor(prefix){const p=profiles[prefix];if(!p)throw err('Unknown profile',404);return p.fields}
 function listProfiles(){return prefixes.map(prefix=>({prefix,label:profiles[prefix].label,fields:profiles[prefix].fields.map(f=>({name:f.name,type:f.type,required:!!f.required,indexed:!!f.indexed,pattern:f.pattern||null}))}))}
 function label(prefix,lang='bg'){const p=profiles[prefix];if(!p)return prefix;return p.label[lang]||p.label.bg||prefix}
 function validateField(prefix,name,value){
  const p=profiles[prefix];if(!p)throw err('Unknown profile',404);
  const f=p.fields.find(x=>x.name===name);if(!f)throw err(`Unknown field "${name}"`,422);
  const out=CHECK[f.type](value);
  if(f.pattern&&typeof out==='string'&&!new RegExp(f.pattern).test(out))throw err(`Value does not match pattern`);
  return out;
 }
 function validateRecord(prefix,fields){
  const p=profiles[prefix];if(!p)throw err('Unknown profile',404);
  const out={};const errors={};
  for(const [name,raw] of Object.entries(fields||{})){
   const f=p.fields.find(x=>x.name===name);if(!f){errors[name]='unknown field';continue}
   try{out[name]=validateField(prefix,name,raw)}catch(e){errors[name]=e.message}
  }
  for(const f of p.fields)if(f.required&&(out[f.name]===undefined||out[f.name]===''))errors[f.name]='required';
  if(Object.keys(errors).length)throw Object.assign(err('Invalid record',422),{errors});
  return out;
 }
 return {profiles,prefixes,listProfiles,getProfile,fieldsFor,label,validateField,validateRecord};
}
module.exports={create,DEFAULTS,TYPES,FIELD_KEY};
