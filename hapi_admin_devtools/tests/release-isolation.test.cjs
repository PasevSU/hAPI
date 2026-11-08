'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('Enterprise and Admin DevTools never share version, slug or GHCR package',()=>{
  const enterprise=read('hapi_enterprise/config.yaml');
  const dev=read('hapi_admin_devtools/config.yaml');
  assert.match(enterprise,/^slug: "hapi_enterprise"$/m);
  assert.match(dev,/^slug: "hapi_admin_devtools"$/m);
  assert.match(enterprise,/^image: "ghcr.io\/pasevsu\/\{arch\}-addon-hapi_enterprise"$/m);
  assert.match(dev,/^image: "ghcr.io\/pasevsu\/\{arch\}-addon-hapi_admin_devtools"$/m);
  const enterpriseVersion=enterprise.match(/^version: "([^"]+)"$/m)?.[1];
  const devVersion=dev.match(/^version: "([^"]+)"$/m)?.[1];
  assert.ok(enterpriseVersion&&devVersion&&enterpriseVersion!==devVersion);
});
test('tag namespaces and build contexts are completely separated',()=>{
  const enterpriseRelease=read('.github/workflows/release.yml');
  const enterpriseImage=read('.github/workflows/addon-image.yml');
  const devRelease=read('.github/workflows/admin-devtools-release.yml');
  assert.match(enterpriseRelease,/tags:\s*\["v\*"\]/);
  assert.match(enterpriseImage,/tags:\s*\['v\*'\]/);
  assert.match(devRelease,/- 'hapi-dev-v\*'/);
  assert.match(devRelease,/context: hapi_admin_devtools/);
  assert.match(enterpriseImage,/context: hapi_enterprise/);
  assert.match(devRelease,/addon-hapi_admin_devtools/);
  assert.doesNotMatch(devRelease,/context: hapi_enterprise/);
  assert.doesNotMatch(devRelease,/- 'v\*'/);
  assert.match(devRelease,/hapi_admin_devtools\/config.yaml/);
});
test('dev Docker build uses separate metadata and cannot overwrite Enterprise image',()=>{
  const docker=read('hapi_admin_devtools/Dockerfile');
  assert.match(docker,/ARG BUILD_VERSION=0\.2\.0/);
  assert.match(docker,/ARG BUILD_ARCH=amd64/);
  assert.doesNotMatch(docker,/COPY\s+.*hapi_enterprise/);
});
