'use strict';
/**
 * hAPI-DEV Development Director: authoritative hierarchy + deterministic
 * categorization. An AI can interpret and plan, but cannot change category,
 * owner, privileges, lifecycle, or the release gates at will.
 */
const crypto=require('node:crypto');
const hierarchy=require('./development-hierarchy.json');
const categories=new Map(hierarchy.categories.map(x=>[x.id,x]));
const states=new Set(hierarchy.workflow.states);
const VALID_TARGETS=new Set(['enterprise','devtools','integration','ci','documentation','unknown']);
const SEVERITIES=new Set(['low','medium','high','critical']);
const word=(v)=>String(v||'').toLocaleLowerCase('en').normalize('NFC');
function categoryScores({title='',description='',files=[]}={}){
 const text=word(title+' '+description+' '+(Array.isArray(files)?files.join(' '):''));
 return hierarchy.categories.map(c=>{
  let score=0;
  for(const k of c.keywords){
   if(text.includes(word(k)))score+=k.length>=6?3:2;
  }
  const fileText=Array.isArray(files)?files.join(' ').toLowerCase():'';
  for(const moduleName of c.modules){
   if(fileText.includes(word(moduleName)))score+=4;
  }
  return {id:c.id,score};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}
function classify(input){
 if(!input || typeof input!=='object'||Array.isArray(input))throw Error('INVALID_DEVELOPMENT_TASK');
 if(typeof input.title!=='string'||!input.title.trim()||input.title.length>240)throw Error('INVALID_TASK_TITLE');
 const ranked=categoryScores(input),chosen=ranked[0];
 const category=chosen?categories.get(chosen.id):null;
 const target=VALID_TARGETS.has(input.target)?input.target:'unknown';
 const critical=category?.priority==='critical';
 const risk=critical?'critical':(SEVERITIES.has(input.risk)?input.risk:category?.priority||'medium');
 const owner=category?.owner||'director';
 return Object.freeze({
  id:typeof input.id==='string' && /^[a-zA-Z0-9_-]{4,96}$/.test(input.id)?input.id:null,
  title:input.title.trim(),category:category?.id||'unclassified',owner,
  secondaryCategories:ranked.slice(1,5).map(x=>x.id),target,risk,
  status:'categorized',score:chosen?.score||0,
  requiresSecurityReview:critical||risk==='high',
  requiresRecoveryReview:target==='enterprise'&&risk!=='low',
  automation:'analysis-only',
  allowedNext:['evidence-collection','planned'],
 });
}
function validateTransition(from,to,{role='director',evidence=[]}={}){
 if(!states.has(from)||!states.has(to))return {allowed:false,reason:'UNKNOWN_TASK_STATE'};
 if(hierarchy.workflow.noDirectTransitions.includes(from+'->'+to))
  return {allowed:false,reason:'UNSAFE_STATE_TRANSITION'};
 const graph={
   new:['categorized','blocked'],
   categorized:['evidence-collection','planned','blocked'],
   'evidence-collection':['planned','reproduced','blocked'],
   planned:['reproduced','candidate-ready','blocked'],
   reproduced:['candidate-ready','blocked'],
   'candidate-ready':['variant-a-tested','blocked'],
   'variant-a-tested':['variant-b-tested','blocked'],
   'variant-b-tested':['review-ready','blocked'],
   'review-ready':['approved','blocked'],
   approved:['staged','blocked'],
   staged:['released','rolled-back','blocked'],
   released:['verified','rolled-back','blocked'],
   verified:[],
   'rolled-back':['evidence-collection','blocked'],
   blocked:['evidence-collection']
 };
 if(!graph[from]?.includes(to))return {allowed:false,reason:'NOT_ALLOWED_BY_WORKFLOW'};
 const protectedStates=new Set(['approved','staged','released','verified']);
 if(protectedStates.has(to)){
   if(role!=='external-release-controller')return {allowed:false,reason:'EXTERNAL_RELEASE_AUTHORITY_REQUIRED'};
   if(!Array.isArray(evidence)||!evidence.includes('signed-intent')||
     !evidence.includes('independent-ci')||!evidence.includes('external-rollback'))
       return {allowed:false,reason:'REQUIRED_EVIDENCE_MISSING'};
 }
 return {allowed:true,reason:'ALLOWED'};
}
function buildPlan(input){
 const task=classify(input);
 const basis=[...(Array.isArray(input.files)?input.files:[])].slice(0,15);
 return Object.freeze({
  ...task,plan:[
   {step:'inventory',owner:task.owner,description:'Find changed and legacy functionality; pin commit SHA'},
   {step:'reproduce',owner:'incident-agent',description:'Verify actual failure with baseline evidence'},
   {step:'design',owner:task.owner,description:'Prepare minimal bounded change proposal'},
   {step:'security-review',owner:'security-agent',description:'Review authorization, source trust, and policy impact'},
   {step:'independent-tests',owner:'qa-agent',description:'Run unchanged baseline and candidate in isolated test variants'},
   {step:'release-readiness',owner:'release-agent',description:'Evaluate immutable CI/signature/recovery evidence; no autonomous publication'},
  ],sources:basis,provenance:'deterministic-verified-policy-not-ai-guess',
 });
}
function fingerprintTask(input){
 return crypto.createHash('sha256').update(JSON.stringify({
  title:String(input.title||'').trim(),target:input.target||'unknown',
  files:Array.isArray(input.files)?[...input.files].sort():[],
 })).digest('hex');
}
module.exports={hierarchy,categoryScores,classify,validateTransition,buildPlan,fingerprintTask};
