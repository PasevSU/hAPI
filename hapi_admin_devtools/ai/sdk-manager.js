'use strict';
/**
 * Optional OpenAI Agents SDK adapter.
 * Director is always the manager. Specialist agents are tools with no OS,
 * GitHub, filesystem, HTTP, HA, or release capability.
 * This module is inert unless explicitly called and provided a trusted SDK.
 */
const {classify,buildPlan,hierarchy}=require('./director');
const SPECIALISTS=[
 ['incident-agent','Reproduce current defect reports and distinguish historical issues from live incidents'],
 ['storage-agent','Analyze file and SQLite integrity without changing stored data'],
 ['portal-agent','Review portal, QR, folder and quarantine behavior without bypassing authorization'],
 ['frontend-agent','Review UI flows and accessibility; propose isolated changes only'],
 ['knowledge-agent','Find verified historical defects, changelog evidence and missing documentation'],
 ['architecture-agent','Plan APIs and central definitions without editing production'],
 ['security-agent','Review access, OpenPGP boundaries, untrusted data and quarantine policies'],
 ['qa-agent','Design independently reproducible baseline and candidate tests'],
 ['performance-agent','Analyze measured cache candidates without enabling caching'],
 ['locale-agent','Audit BG, EN and DE translations and formatting contracts'],
 ['release-agent','Review signed commits, evidence and release eligibility without publishing'],
 ['recovery-agent','Plan external backup/rollback evidence without executing restore']
];
function createManager(sdk,{model='gpt-4.1-mini'}={}){
 if(!sdk||typeof sdk.Agent!=='function'||typeof sdk.run!=='function')
   throw Error('AGENTS_SDK_UNAVAILABLE');
 const agents=SPECIALISTS.map(([name,instructions])=>new sdk.Agent({
   name,
   model,
   instructions:instructions+' Do not claim any action was executed; respond with a bounded recommendation only. '+
    'Never request secrets, execute tools, or override the deterministic release controller.'
 }));
 const tools=agents.map(agent=> {
   if(typeof agent.asTool!=='function')throw Error('AGENTS_SDK_AGENT_TOOLS_UNSUPPORTED');
   return agent.asTool({toolName:agent.name.replace(/-/g,'_'),
     toolDescription:'Read-only specialist analysis: '+agent.name});
 });
 const director=new sdk.Agent({
   name:'hAPI-DEV Development Director',
   model,
   instructions:'You lead all hAPI project development analysis. '+
    'Respect the supplied deterministic taxonomy, category, owner, and risk classification. '+
    'Assign read-only subtasks to specialists as tools, create a structured plan, and clearly state unknowns. '+
    'Never assert that a patch was executed, that CI passed, that a release was published, or that HA restarted. '+
    'Never request private keys, credentials, document contents or raw personal telemetry. '+
    'Your output is advice, not authorization to alter production or GitHub.',
   tools
 });
 return {director,agents,tools};
}
async function analyzeTask(input,{sdk,model='gpt-4.1-mini',maxTurns=6}={}){
 const task=classify(input),plan=buildPlan(input);
 if(!sdk)throw Error('AGENTS_SDK_NOT_CONFIGURED');
 if(!Number.isInteger(maxTurns)||maxTurns<1||maxTurns>12)
   throw Error('INVALID_AI_TURN_BUDGET');
 const manager=createManager(sdk,{model});
 const payload={task:{title:task.title,category:task.category,owner:task.owner,risk:task.risk,
   target:task.target,secondaryCategories:task.secondaryCategories},
   planningSteps:plan.plan,
   allowedActions:['analyze','classify','plan','suggest-tests'],
   deniedActions:['git-push','deploy','publish-release','restart-ha','change-permissions'],
   taxonomyVersion:hierarchy.schemaVersion};
 const result=await sdk.run(manager.director,JSON.stringify(payload),
   {maxTurns,tracingDisabled:true});
 return {task,plan:plan.plan,
   aiAnalysis:String(result?.finalOutput??'').slice(0,16000),
   status:'advisory-only',executedActions:[],releaseAuthorized:false,
   model,provenance:'OpenAI Agents SDK; model output untrusted until independently verified'};
}
module.exports={createManager,analyzeTask,SPECIALISTS};
