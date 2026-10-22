'use strict';
// Двустепенна проверка: ПЪРВО целият GUI, и само при 100 % успех — съвместимостта на пакета.
//
// Правилото е от оператора: „само и единствено след 100 % успеваемост на предходната точка
// премини към тестване на съвместимост“. Затова то е кодирано тук, а не в главата на човека:
//   • Степен 1 — GUI: панелите, секциите, бутоните, DOM-ът, речниците, иконите, навигацията.
//   • Степен 2 — съвместимост: HA правилата, HACS/HACS-издание, Dockerfile ↔ модули,
//     опции ↔ схема, приемането на изданието, матрицата на сценариите, verify-release.
//
// Степен 2 НЕ тръгва, ако степен 1 има дори един провал — така „зелено“ никога не значи
// „минало някъде другаде“. Всяка степен пише своя ред и общият изход е код 1 при провал.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

// Степен 1 — какво вижда и натиска потребителят.
const GUI = [
  ['dom-harness', 'тестовият DOM: селектори, click→submit, dataset/classList'],
  ['gui-panels', '9 панела върху жив add-on + създаване през формата'],
  ['gui-sections', '15 секции · 32 бутона с очакван отговор'],
  ['gui-coverage', 'пази списъците: секция/бутон/навигация без тест чупи теста'],
  ['ui-coverage', 'всеки подмаршрут има панел'],
  ['ui-i18n', 'речникът: ключове × 3 езика'],
  ['ui-icons', 'иконите: дефинирани и използвани'],
  ['ui-navigation', 'навигацията води до панел'],
  ['ui-settings-sections', '15 таба · избор на секция · действия'],
  ['ui-version', 'версията в интерфейса = config.yaml'],
  ['dashboard', 'таблото показва реални данни, не демо числа'],
  ['files-manager', 'модулът за файлове: 11 действия, реални endpoints, без фиктивни бутони'],
  ['policy-gui', 'политиките (RBAC) през интерфейса'],
  ['report-studio-panel', 'Report Studio: шаблони, валидация, преглед'],
  ['cms-panel', 'CMS подпис и проверка през панела'],
  ['secret-panel', 'тайни връзки през панела'],
  ['portal-page', 'публичната страница на портала (това, което вижда посетителят)'],
  ['portal-page-render', 'страницата РИСУВА id · резюме · адрес за изтегляне · линк'],
  ['portal-page-contract', 'договорът за страницата: id · QR · резюме · линкове · изтегляне'],
  ['portal-api-qr', 'QR кодът на портала води до страницата с файлове, не до JSON'],
  ['portal-folder-refs', 'препращането към папките: по път, не по име'],
  ['full-journey', 'целият път S01…S12: старт → портал → папки → правила → страница → пакет → линкове → тайни → отчет → изтриване'],
  ['full-journey-office', 'административният път S01…S12: версии → метаданни → хешове → подписан линк → разписка → бележки → известия → контакти'],
  ['visitors-panel', 'панелът „Кой влиза“: реални сензори в DOM, изтриване, CSV'],
  ['full-journey-sensors', 'целият път S01…S11: трафик → локация → режими → срок → износи → панел → изтриване → рестарт'],
  ['portal-monitoring', 'мониторингът в панела с порталите: общо и за портал, локация, клиенти, файлове'],
];

// Степен 2 — пакетът като продукт за Home Assistant.
const COMPAT = [
  ['ha-compatibility', '42 правила за add-on (блокер = провал)'],
  ['hacs-structure', 'структурата на HACS хранилището'],
  ['haoss-release', 'HACS изданието се строи и валидира'],
  ['haoss-in-sync', 'release/haoss = източникът, същата версия'],
  ['docker-runtime', 'Dockerfile COPY ↔ всички локални модули'],
  ['single-source', 'едно дърво: няма второ копие на UI-я в корена'],
  ['addon-config', 'опции ↔ схема на Supervisor'],
  ['addon-changelog', 'CHANGELOG на add-on-а е синхронизиран'],
  ['gateway-server', 'публичният gateway като отделен listener'],
  ['portal-rules-applied', 'правилата на портала се взимат и се прилагат на живо'],
  ['visitor-sensors', 'сензори за комуникацията: кой влиза, какво тегли, от кое IP и откъде'],
  ['ingress-isolation', 'ingress каналът не пуска чужди пътища'],
  ['ingress-auth', 'самоличността през ingress'],
  ['ingress-panel-load', 'панелът се зарежда през ingress: документ + всички ресурси'],
  ['api-spec-coverage', 'договорът на API-то е покрит'],
  ['raspberrypi-compat', 'малки машини: памет, лимити, архитектури'],
  ['storage-paths', 'пътищата на хранилището в контейнера'],
  ['network-storage', 'мрежово хранилище: поведение и откази'],
  ['instance-lock', 'една инстанция върху едни данни'],
  ['shared-data', 'слоят за споделени данни'],
  ['shared-data-processes', 'два процеса върху едни данни'],
  ['shared-data-burst', 'заливка от 3 процеса без загуба'],
  ['shared-data-access', 'един източник на истина + кръстосани слоеве'],
  ['shared-mode-shutdown', 'спирането сваля регистрацията'],
  ['release-acceptance', 'самите артефакти: версия, отпечатъци, модули'],
  ['scenario-matrix', 'области · маршрути · способности · опции · тестове'],
  ['docs-consistency', 'версията и връзките в документите'],
  ['release-tooling', 'инструментите за издаване'],
];

function runOne(testFile) {
  const file = path.join(root, 'tests', testFile + '.cjs');
  if (!fs.existsSync(file)) return { ok: false, output: 'липсва файл: tests/' + testFile + '.cjs' };
  return runNode(file);
}

function runScript(scriptName) {
  const file = path.join(root, 'scripts', scriptName + '.cjs');
  if (!fs.existsSync(file)) return { ok: false, output: 'липсва файл: scripts/' + scriptName + '.cjs' };
  return runNode(file);
}

function runNode(file) {
  const run = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8', timeout: 15 * 60 * 1000 });
  const output = ((run.stdout || '') + (run.stderr || '')).trim();
  return { ok: run.status === 0, code: run.status === null ? undefined : run.status, output };
}

function runStage(title, list) {
  console.log('\n═══ ' + title + ' ═══');
  let passed = 0;
  const failures = [];
  for (const [name, what] of list) {
    const result = runOne(name);
    if (result.ok) {
      passed += 1;
      console.log('  ✔ ' + name + ' — ' + what);
      continue;
    }
    failures.push({ name, what, output: result.output });
    console.log('  ✘ ' + name + ' — ' + what + (result.code === undefined ? '' : ' (код ' + result.code + ')'));
  }
  if (failures.length) {
    console.log('\n  Провали:');
    for (const failure of failures) {
      console.log('\n  ── ' + failure.name + ' ──');
      const tail = failure.output.split('\n').slice(-12).join('\n');
      for (const line of tail.split('\n')) console.log('    ' + line);
    }
  }
  return { passed, total: list.length, failures };
}

const gui = runStage('СТЕПЕН 1 · GUI', GUI);
if (gui.failures.length) {
  console.log('\n═══ ОБОБЩЕНИЕ ═══');
  console.log('  GUI: ' + gui.passed + '/' + gui.total + ' — съвместимост НЕ се пуска, докато GUI не е 100 %');
  process.exit(1);
}
console.log('\n  GUI: ' + gui.passed + '/' + gui.total + ' — 100 %, минавам към съвместимостта');

const compat = runStage('СТЕПЕН 2 · СЪВМЕСТИМОСТ НА ПАКЕТА', COMPAT);

// Изданието се проверява най-накрая: S01–S21 върху dist/ (изисква построени артефакти).
const verify = runScript('verify-release');
console.log('\n═══ СТЕПЕН 3 · ИЗДАНИЕ ═══');
if (verify.ok) console.log('  ✔ verify-release — S01–S21 върху dist/');
else {
  console.log('  ✘ verify-release');
  for (const line of verify.output.split('\n').slice(-12)) console.log('    ' + line);
}

console.log('\n═══ ОБОБЩЕНИЕ ═══');
console.log('  GUI: ' + gui.passed + '/' + gui.total);
console.log('  Съвместимост: ' + compat.passed + '/' + compat.total);
console.log('  Издание: ' + (verify.ok ? 'проверено' : 'ПРОВАЛЕНО'));
const allGreen = compat.failures.length === 0 && verify.ok;
console.log(allGreen ? '\n  ✔ 100 % — ГУИ и съвместимост са зелени' : '\n  ✘ има провали — виж по-горе');
process.exit(allGreen ? 0 : 1);
