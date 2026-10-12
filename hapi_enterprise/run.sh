#!/bin/sh
# node:sqlite DatabaseSync is required for the authoritative metadata store.
# Abort before starting listeners on unsupported Home Assistant base images.
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22 || (major===22 && minor<13)){console.error("Portal Enterprise requires Node.js >=22.13 for SQLite DatabaseSync");process.exit(1)} try{require("node:sqlite").DatabaseSync}catch(e){console.error("Node SQLite unavailable:",e.message);process.exit(1)}' || exit 1
ADMIN_TOKEN="$(node -e 'const fs=require("fs");const weak=t=>typeof t!=="string"||t.length<24||t==="CHANGE_TO_RANDOM_SECRET_AT_LEAST_24_CHARACTERS"||/^(.{1,8})\1{3,}$/.test(t);let t;try{t=(o=>o.token||o.admin_token)(JSON.parse(fs.readFileSync("/data/options.json","utf8")))}catch{}if(weak(t)){const f="/data/admin-token";try{t=fs.readFileSync(f,"utf8").trim()}catch{}if(weak(t)){t=require("crypto").randomBytes(32).toString("hex");fs.writeFileSync(f,t,{mode:0o600})}}process.stdout.write(t)')" || exit 1
export ADMIN_TOKEN
BACKUP_DIR="$(node -e 'try{const v=JSON.parse(require("fs").readFileSync("/data/options.json","utf8")).backup_folder;if(typeof v==="string")process.stdout.write(v.trim())}catch{}')"
export BACKUP_DIR
export INGRESS_MODE=true
export HAPI_FIRST_RUN_SEED=1
export REQUIRE_PORTAL_TOKEN=true
export PUBLIC_BIND_HOST=0.0.0.0
export ADMIN_PORT=8098
export DATA_DIR="$(node /app/storage-preflight.js)" || exit 1
exec node /app/server.js
