'use strict';
// Document versioning (Phase 4.3). Dependency-free helpers; physical I/O and
// authorization stay in server.js. Kept behind an interface so the on-disk
// layout (current content at {id}, history at {id}.v{n}) can be swapped later.
const path=require('node:path');

const MAX_VERSIONS=50;

function versionPath(filesRoot,portalId,fileId,version){
 return version==null?path.join(filesRoot,portalId,fileId):path.join(filesRoot,portalId,fileId+'.v'+version);
}

// Version record describing a file's *current* content, ready to be archived
// before its content is replaced by a new version.
function snapshotCurrent(file,{note=''}={}){
 return {
  version:Number.isInteger(file.version)&&file.version>0?file.version:1,
  size:file.size,
  sha256:file.sha256,
  uploadedAt:file.uploadedAt,
  encrypted:!!file.encrypted,
  storedSize:file.storedSize||null,
  note:String(note).slice(0,2000),
  archivedAt:new Date().toISOString()
 };
}

// Next version number for a file (first versioned upload becomes v2, since v1
// is the original upload archived as a snapshot).
function nextVersion(file){
 return (Number.isInteger(file.version)&&file.version>0?file.version:1)+1;
}

// Ordered history (oldest first) with the current head flagged last.
function history(file){
 const versions=[...(file.versions||[])].sort((a,b)=>a.version-b.version);
 const head={version:Number.isInteger(file.version)&&file.version>0?file.version:1,size:file.size,sha256:file.sha256,uploadedAt:file.uploadedAt,encrypted:!!file.encrypted,current:true};
 return [...versions,head];
}

// Version numbers (oldest first) that exceed maxVersions and must be pruned.
function pruneTargets(file,maxVersions=MAX_VERSIONS){
 const versions=[...(file.versions||[])].sort((a,b)=>a.version-b.version);
 return versions.slice(0,Math.max(0,versions.length-maxVersions)).map(v=>v.version);
}

module.exports={create:()=>({versionPath,snapshotCurrent,nextVersion,history,pruneTargets}),versionPath,snapshotCurrent,nextVersion,history,pruneTargets,MAX_VERSIONS};
