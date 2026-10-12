'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
// Acceptance test for §8.7: the admin hierarchy (group -> profile -> records) must be
// navigable and provide controls for creating groups and inspecting their records.
(async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../hapi_enterprise/admin.html'),'utf8');
 // Navigation entry point exposes the hierarchy panel
 assert.match(html,/data-panel="hierarchy"/,'nav button for hierarchy panel');
 assert.match(html,/id="panel-hierarchy"/,'hierarchy panel present');
 // Group creation control
 assert.match(html,/id="hier-group-name"/,'group name input present');
 assert.match(html,/id="hier-group-form"/,'group creation form present');
 // Record inspection (group -> records) and profile schema listing
 assert.match(html,/id="hier-records-card"/,'records card present');
 assert.match(html,/id="hier-records-title"/,'records title present');
 assert.match(html,/id="hier-records"/,'records container present');
 assert.match(html,/id="hier-profiles"/,'profiles container present');
 console.log('admin-hierarchy OK');
})().catch(e=>{console.error(e);process.exit(1)});
