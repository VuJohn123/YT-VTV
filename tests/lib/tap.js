// tests/lib/tap.js — test runner tối giản, không phụ thuộc npm package nào
// (đúng tinh thần userscript: càng ít dependency càng ít điểm hỏng).

let _tests = [];
let _suiteName = '';

function suite(name) { _suiteName = name; _tests = []; }
function test(name, fn) { _tests.push({ name, fn }); }

async function run() {
    let pass = 0, fail = 0;
    console.log(`\n▶ ${_suiteName}`);
    for (const { name, fn } of _tests) {
        try {
            await fn();
            console.log(`  ✓ ${name}`);
            pass++;
        } catch (e) {
            console.log(`  ✗ ${name}`);
            console.log(`    ${e.message}`);
            fail++;
        }
    }
    console.log(`  ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
    return { pass, fail };
}

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}
function assertTrue(cond, msg)  { if (!cond)  throw new Error(msg || 'Expected truthy value'); }
function assertFalse(cond, msg) { if (cond)   throw new Error(msg || 'Expected falsy value'); }
function assertDeepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error(msg || `Expected ${e}, got ${a}`);
}

module.exports = { suite, test, run, assertEqual, assertTrue, assertFalse, assertDeepEqual };
