'use strict';
/**
 * Single authoritative definitions for hAPI Admin DevTools.
 *
 * Immutable policy constants are NOT editable by AI, environment variables, or
 * Home Assistant options. Runtime values are parsed explicitly and bounded.
 * Primary Enterprise add-on has its own independent runtime-config.js.
 */
const fs=require('node:fs');
const path=require('node:path');

function deepFreeze(value){
  if(value && typeof value==='object' && !Object.isFrozen(value)){
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const DEFINITIONS=deepFreeze({
  schemaVersion:1,
  app:{slug:'hapi_admin_devtools',releaseTagPrefix:'hapi-dev-v'},
  enterprise:{slug:'hapi_enterprise',healthPath:'/ready'},
  github:{
    owner:'PasevSU',
    repo:'hAPI',
    apiVersion:'2022-11-28',
    keyId:'4FC0B2596C68DCB9',
    baseUrl:'https://github.com',
    apiUrl:'https://api.github.com',
  },
  transport:{
    ingressPort:8099,
    enterprisePort:8099,
    enterpriseHostname:'hapi_enterprise',
    ingressProxyAddress:'172.30.32.2',
  },
  limits:{
    requestBodyBytes:30000,
    enrollmentBytes:256000,
    githubGpgBytes:512000,
    githubCommitBytes:400000,
    githubActionsBytes:1048576,
    gpgSignatureChars:16000,
    githubTimeoutMs:8000,
    githubCommitTimeoutMs:7000,
    hapiProbeTimeoutMs:2500,
    monitorIntervalMs:30000,
    monitorJournalBytes:2097152,
    challengeExpiryMs:300000,
  },
  security:{
    fingerprintHexDigits:[40,64],
    signatureHeader:'-----BEGIN PGP SIGNATURE-----',
    releasePhaseNames:['unit','integration','regression','integrity','rollback'],
    releaseEnvironments:['ubuntu','haos','windows'],
    targetArchitectures:['amd64','aarch64','armv7'],
    // These are *not* enabled by the registry.
    writeEnabled:false,
    deployEnabled:false,
    autoRepairEnabled:false,
  },
  locale:{supported:['bg','en','de'],fallback:'bg'},
});

function parsePort(raw,fallback){
  if(raw===undefined||raw===null||raw==='')return fallback;
  if(!/^[0-9]{1,5}$/.test(String(raw)))throw Error('INVALID_DEVTOOLS_PORT');
  const n=Number(raw);
  if(!Number.isSafeInteger(n)||n<1||n>65535)throw Error('INVALID_DEVTOOLS_PORT');
  return n;
}
function readAddonVersion(configPath=path.join(__dirname,'config.yaml')){
  const content=fs.readFileSync(configPath,'utf8');
  const version=content.match(/^version:\s*["']?([0-9]+\.[0-9]+\.[0-9]+)["']?\s*$/m)?.[1];
  if(!version)throw Error('INVALID_DEVTOOLS_ADDON_VERSION');
  return version;
}
function getRuntimeConfig(env=process.env){
  const dataDir=path.resolve(env.HAPI_DEVTOOLS_DATA||'/data');
  const optionsPath=path.resolve(env.HAPI_DEVTOOLS_OPTIONS||path.join(dataDir,'options.json'));
  return Object.freeze({
    dataDir,
    optionsPath,
    enrollmentPath:path.join(dataDir,'enrollment.json'),
    monitorPath:path.join(dataDir,'monitor'),
    ingressPort:parsePort(env.PORT,DEFINITIONS.transport.ingressPort),
  });
}
module.exports={DEFINITIONS,readAddonVersion,getRuntimeConfig,parsePort,deepFreeze};
