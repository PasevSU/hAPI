#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function usage(){console.log('01-core CLI\n  node cli.js info\n  node cli.js self-test\nLoads the CryptoJS core and checks that secure random bytes are available.')}
function main(args){const command=args[0]||'help';if(command==='help'||command==='--help'||command==='-h'){usage();return}if(command==='info'){console.log(JSON.stringify({package:'01-core',runtime:process.version,crypto:typeof globalThis.crypto?.getRandomValues==='function'?'webcrypto':'node'},null,2));return}if(command!=='self-test')throw new Error(`Unknown command: ${command}`);const context=vm.createContext({console,Math,Uint32Array,globalThis:{crypto:require('node:crypto').webcrypto}});vm.runInContext(fs.readFileSync(path.join(__dirname,'core.js'),'utf8'),context);const cryptoJs=context.CryptoJS;if(!cryptoJs?.lib?.WordArray?.random)throw new Error('CryptoJS core did not initialize its secure random provider.');const sample=cryptoJs.lib.WordArray.random(32);if(sample.sigBytes!==32||sample.toString().length!==64)throw new Error('Secure random self-test failed.');console.log(JSON.stringify({ok:true,wordArrayBytes:sample.sigBytes,secureRandom:true},null,2))}
try{main(process.argv.slice(2))}catch(error){console.error(`core: ${error.message}`);process.exitCode=1}