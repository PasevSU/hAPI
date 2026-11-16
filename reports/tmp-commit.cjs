'use strict';
// Комит на 0.69.230 без проблеми с кавичките в PowerShell.
const { execFileSync } = require('node:child_process');
const message =
  '0.69.230: временната връзка е за избраното ниво (папка/файл), път с две точки се отказва';
execFileSync('git', ['add', '-A'], { stdio: 'inherit' });
execFileSync('git', ['commit', '-m', message], { stdio: 'inherit' });
console.log('комитнат 0.69.230');
