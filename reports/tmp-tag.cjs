'use strict';
// Комитва отчета и слага тага за 0.69.230 (без проблеми с кавичките в PowerShell).
const { execFileSync } = require('node:child_process');
execFileSync('git', ['add', '-A'], { stdio: 'inherit' });
const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (status) execFileSync('git', ['commit', '-m', '0.69.230: матрица 441/441 · отчет за изданието'], { stdio: 'inherit' });
execFileSync('git', ['tag', '-a', 'v0.69.230', '-m', 'hAPI Enterprise 0.69.230: временната връзка е за избраното ниво'], { stdio: 'inherit' });
console.log(execFileSync('git', ['log', '--oneline', '-1'], { encoding: 'utf8' }).trim());
console.log('таг: ' + execFileSync('git', ['describe', '--tags', '--exact-match'], { encoding: 'utf8' }).trim());
