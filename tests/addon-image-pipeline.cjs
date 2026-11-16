'use strict';
// ОБРАЗЪТ НА ADD-ON-А СЕ СТРОИ ЗА ВСЯКА ВЕРСИЯ, КОЯТО STORE-ЪТ ВИЖДА (0.69.217).
//
// Защо има тест: при 0.69.215 версията беше вдигната в `config.yaml` и качена в `main`, но
// таг НЕ беше пускан. Workflow-ът „Add-on image“ се пускаше само на таг, тоест образът
// `ghcr.io/pasevsu/aarch64-addon-hapi_enterprise:0.69.215` не съществуваше. Home Assistant
// показа обновяване и на всяко натискане даваше `[404] manifest unknown` — точно защото
// `config.yaml` вече беше „освободен“, а образът — не. Потребителят го видя преди нас.
//
// Тестът пази договора между три файла, които иначе се разминават тихо:
//   • `config.yaml` — името на образа (конвенцията на HA: `{arch}-addon-<slug>`), архитектурите;
//   • `.github/workflows/addon-image.yml` — кога се строи, какви тагове слага, има ли право
//     да публикува в ghcr.io и чете ли версията от `config.yaml`, а не от тага;
//   • `.github/workflows/release.yml` — създава Release, но НЕ строи образа (иначе два
//     различни източника на едно и също изображение).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const config = read('hapi_enterprise/config.yaml');
const image = read('.github/workflows/addon-image.yml');
const release = read('.github/workflows/release.yml');
const ci = read('.github/workflows/ci.yml');

// ── 0. Образът се ИЗПЪЛНЯВА в CI, не само се строи (0.69.224) ───────────────
// `docker-runtime.cjs` проверява Dockerfile-а статично; нищо дотук не стартираше готовия
// образ, тоест липсващ `COPY` или счупен `require` се виждаше чак в Home Assistant.
assert.match(ci, /docker run --rm/, 'CI трябва да пусне контейнера, не само да го построи');
assert.match(
  ci,
  /--entrypoint node[\s\S]{0,200}require\('\/app\/core'\)/,
  'CI вдига глобалния слой вътре в образа — това хваща липсващ COPY на core.js/core_module/',
);
assert.match(ci, /if \(!svg\.startsWith\('<svg'\)\)/, 'CI проверява, че QR кодът в образа наистина се рисува');

const field = (name) => {
  const m = new RegExp(`^${name}:\\s*"?([^"\\n]+)"?`, 'm').exec(config);
  return m ? m[1].trim() : '';
};
const slug = field('slug');
const imageName = field('image');

// ── 1. Името на образа следва конвенцията на Home Assistant ──────────────────
assert.ok(slug, 'config.yaml има slug');
assert.match(
  imageName,
  new RegExp(`^ghcr\\.io/[a-z0-9-]+/\\{arch\\}-addon-${slug}$`),
  `image трябва да е ghcr.io/<owner>/{arch}-addon-${slug} (с малки букви): ${imageName}`,
);

// ── 2. Архитектурите в config.yaml и в матрицата са едни и същи ──────────────
// Списъкът на `arch:` е осеян с коментари, затова се режат коментарите, а не се разчита на
// „само тирета в началото на ред“.
const archBlock = /^arch:\s*\n((?:[ \t]*(?:#[^\n]*|- \S+)\n)+)/m.exec(config);
assert.ok(archBlock, 'config.yaml изброява архитектури');
const declared = [...archBlock[1].matchAll(/^\s*-\s*(\S+)\s*$/gm)].map((m) => m[1].trim());
assert.deepEqual(declared.sort(), ['aarch64', 'amd64', 'armv7'], 'обявените архитектури: ' + declared.join(', '));
for (const arch of declared) {
  assert.match(image, new RegExp(`arch: ${arch}\\b`), `workflow-ът строи и за ${arch}`);
}

// ── 3. Кога се строи: таг И main ────────────────────────────────────────────
// Тагът е изданието; `main` е предпазната мрежа срещу „версия без образ“ (404 в HA).
// Точното правило, което тестът пази: в `on.push` на workflow-а трябва да има и
// `branches: [main]` освен `tags: ['v*']`.
assert.match(image, /^\s*tags: \['v\*'\]/m, 'workflow-ът се пуска на таг v*');
assert.match(
  image,
  /^\s*branches: \[main\]/m,
  'workflow-ът се пуска и на push към main — иначе версия в config.yaml може да остане без образ',
);

// ── 4. Права и публикуване ──────────────────────────────────────────────────
assert.match(image, /packages: write/, 'нужно е packages: write, иначе push към ghcr.io пада');
assert.match(image, /push: true/, 'образът се качва, не само се строи');
assert.match(image, /docker\/build-push-action@v\d+/, 'строи се с официалния docker action (BuildKit)');

// ── 5. Версията идва от config.yaml, не от тага ─────────────────────────────
assert.match(
  image,
  /grep -m1 '\^version:' hapi_enterprise\/config\.yaml/,
  'версията се чете от config.yaml — така образът и store-ът не могат да се разминат',
);
assert.match(image, /:\$\{\{ steps\.meta\.outputs\.version \}\}/, 'тагът на образа е прочетената версия');

// ── 6. Owner-ът се сваля до малки букви (Docker отказва главни) ─────────────
assert.match(image, /tr '\[:upper:\]' '\[:lower:\]'/, 'owner-ът минава през lower-case (иначе: repository name must be lowercase)');

// ── 7. `release.yml` не строи образ — един източник на изображението ────────
assert.doesNotMatch(release, /build-push-action|packages: write/, 'release.yml не бива да строи образа: това е работа на addon-image.yml');

console.log(
  `PASS addon-image-pipeline: image=${imageName} · arch=${declared.join('/')} · тригери таг+main · ` +
    'push към ghcr.io с packages:write · версия от config.yaml · release.yml само Release',
);
