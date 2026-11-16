#!/usr/bin/env node
const http=require('http');
const port=Number(process.env.PORT||8787);
const req=http.get({host:'127.0.0.1',port,path:'/api/self-test'},r=>{let s='';r.on('data',d=>s+=d);r.on('end',()=>{console.log(s);process.exit(r.statusCode===200?0:1)})});
req.on('error',e=>{console.error('Server is not running:',e.message);process.exit(2)});
