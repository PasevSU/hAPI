'use strict';
// Role-based access control over the administrative API. Three roles are resolved
// from independent bearer tokens (admin, operator, viewer). Each admin route is tagged
// with a capability; a capability maps a role to full access, read-only (GET) access,
// or no access. Routes not tagged default to admin-only.
const crypto=require('node:crypto');
const safeEqual=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)};
// capability -> { role: true (all methods) | 'read' (GET only) }
const CAPABILITIES={
 '*':{admin:true},
 diagnostics:{admin:true,operator:'read',viewer:'read'},
 sensors:{admin:true,viewer:'read'},
 metrics:{admin:true,viewer:'read'},
 audit:{admin:true,viewer:'read'},
 jobs:{admin:true,operator:true,viewer:'read'},
 portals:{admin:true,operator:true,viewer:'read'},
 cabinet:{admin:true,operator:true,viewer:'read'},
 directory:{admin:true,operator:true,viewer:'read'},
 settings:{admin:true},
 qr:{admin:true},
 backup:{admin:true},
 errors:{admin:true,operator:'read',viewer:'read'},
 profiles:{admin:true},
 storage:{admin:true,operator:true,viewer:'read'},
 load:{admin:true,operator:'read',viewer:'read'},
 whoami:{admin:true,operator:'read',viewer:'read'},
 users:{admin:true}
};
function create({adminToken,operatorToken,viewerToken,userRoles={},groupRoles={}}){
 const roleForUser=user=>{if(!user)return null;const r=userRoles[user];return r==='admin'||r==='operator'||r==='viewer'?r:null};
 const roleForGroups=groups=>{for(const g of groups){const r=groupRoles[g];if(r==='admin'||r==='operator'||r==='viewer')return r}return null};
 function resolveIngress(req){
  if(!req.ingress)return null;
  const groups=String(req.headers['x-remote-groups']||'').split(',').map(s=>s.trim()).filter(Boolean);
  const user=String(req.headers['x-remote-user']||'').trim();
  return roleForUser(user)||roleForGroups(groups);
 }
 function resolve(req){
  const given=(req.headers.authorization||'').replace(/^Bearer /i,'');
  if(safeEqual(given,adminToken))return 'admin';
  if(operatorToken&&safeEqual(given,operatorToken))return 'operator';
  if(viewerToken&&safeEqual(given,viewerToken))return 'viewer';
  return resolveIngress(req);
 }
 function allowed(role,capability,method){
  if(!role)return false;
  if(role==='admin')return true;
  const c=CAPABILITIES[capability];
  if(!c)return false;
  const v=c[role];
  if(v===true)return true;
  if(v==='read')return method==='GET';
  return false;
 }
 return {resolve,allowed,role:resolve};
}
module.exports={create,CAPABILITIES};
