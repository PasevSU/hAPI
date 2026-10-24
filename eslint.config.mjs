import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**', 'data/**', 'release/**', 'build/**', 'dist/**',
      '.dev/**', '.github/**', 'img/**', 'hapi_enterprise/fonts/**',
      'hapi_enterprise/*.html', 'custom_components/**/portal.html',
      'documentation/**', 'docs/**',
      // Локални среди (Python venv за инструменти, TimescaleDB и т.н.): не са код на
      // проекта и не бива да чупят `eslint .` — venv-ът съдържа чужди JS файлове.
      '.venv/**', '**/.venv/**', 'venv/**', '**/site-packages/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.commonjs }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-var': 'off'
    }
  },
  // Браузърните файлове НЕ живеят в Node: `document`, `window`, `location`, `fetch`
  // са им законни. Без този блок конфигурацията даваше 406 фалшиви `no-undef`, заради
  // което lint никога не е бил пускан (и не е имало CI стъпка). Файловете са класически
  // скриптове в страницата на панела, портала и генератора.
  {
    files: [
      'hapi_enterprise/ui/**/*.js',
      // Целият публичен портал живее в своя папка (страница, скрипт, речник) — браузърни
      // глобални, както UI-я; дотогава беше в корена и се изброяваше по име.
      'hapi_enterprise/portal/**/*.js',
      'hapi_enterprise/secret-view.js',
      'hapi_enterprise/generator/**/*.js',
      'custom_components/**/*.js'
    ],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser }
    }
  },
  // Двойни модули (UMD): `if (typeof window !== 'undefined') window.X = API` и
  // `if (module.exports)`. Живеят и в Node, и в страница — затова виждат и двете среди.
  {
    files: ['hapi_enterprise/storage-tree.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.commonjs } }
  },
  // Вендорски QR енкодер (генериран код, не се поддържа ръчно): правилата за стил и
  // повторни `var` декларации не важат за него — важното е да е наличен и непроменен.
  {
    files: ['hapi_enterprise/qrcode.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.amd, ...globals.node, ...globals.commonjs } },
    rules: { 'no-redeclare': 'off', 'no-control-regex': 'off', 'no-unused-vars': 'off' }
  },
  // ESM файлове (Node .mjs и браузърните модули на Evidence View портала) не бива да се
  // проверяват като CommonJS — иначе всеки `import` е „parsing error“.
  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module', ecmaVersion: 2022, globals: { ...globals.node } }
  },
  {
    files: ['hapi_enterprise/evidence-portal/assets/**/*.js'],
    languageOptions: { sourceType: 'module', ecmaVersion: 2022, globals: { ...globals.browser } }
  },
  prettier
];
