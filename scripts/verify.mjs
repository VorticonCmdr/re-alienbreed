// Strict verification: requires the original files, runs every test with skipping disabled, and fails on
// missing fixtures, skipped or zero executed tests. Exploratory scripts are not part of this command.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const required = ['ALIEN.EXE', 'LBMZ.HUF', 'DEMO.DAT', 'LBMS/TEA.256', 'LBMS/TEB.256', 'LBMS/TEAN.256', 'PLAYER1.EHF', 'PANEL.VHF', 'SETUP.DAT'];
const missing = required.filter(name => !existsSync(new URL(`../game/${name}`, import.meta.url)));
if (missing.length) { console.error(`Setup failure: original files missing from game/: ${missing.join(', ')}`); process.exit(2); }

const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], { env: { ...process.env, ALIEN_BREED_STRICT: '1' }, encoding: 'utf8' });
process.stdout.write(run.stdout); process.stderr.write(run.stderr);
const count = name => Number((run.stdout.match(new RegExp(`^# ${name} (\\d+)`, 'm')) || [])[1] ?? NaN);
const tests = count('tests'), pass = count('pass'), fail = count('fail'), skipped = count('skipped'), todo = count('todo');
const problems = [];
if (run.status !== 0) problems.push(`test runner exited with ${run.status}`);
if (!(tests > 0)) problems.push('no tests were executed');
if (fail) problems.push(`${fail} failing`);
if (skipped) problems.push(`${skipped} skipped (strict verification allows none)`);
if (todo) problems.push(`${todo} todo`);
if (pass !== tests) problems.push(`${pass}/${tests} passed`);
if (problems.length) { console.error(`\nVerification FAILED: ${problems.join('; ')}`); process.exit(1); }
console.log(`\nVerification passed: ${pass} tests, none skipped.`);
