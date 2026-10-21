import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/**', 'data/**', 'release/**', 'build/**', 'dist/**',
      '.dev/**', '.github/**', 'img/**', 'hapi_enterprise/fonts/**',
      'hapi_enterprise/*.html', 'custom_components/**/portal.html',
      'documentation/**', 'docs/**'
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
  prettier
];
