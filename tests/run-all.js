// tests/run-all.js — chạy toàn bộ test suite, tổng hợp kết quả.
// Mỗi file test chạy trong process con riêng (không share global state giữa
// các file — mock global.EventBus/Storage/... của file này không được rò rỉ
// sang file kia).

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testFiles = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.test.js'))
    .sort();

console.log(`Chạy ${testFiles.length} test suite: ${testFiles.join(', ')}\n`);

let anyFail = false;
for (const file of testFiles) {
    try {
        const output = execFileSync('node', [path.join(__dirname, file)], { encoding: 'utf8' });
        process.stdout.write(output);
    } catch (e) {
        process.stdout.write(e.stdout || '');
        console.error(`\n⚠ ${file} thoát với lỗi (exit code ${e.status})`);
        anyFail = true;
    }
}

console.log(anyFail ? '\n❌ Có test suite FAIL — xem chi tiết ở trên.' : '\n✅ Tất cả test suite PASS.');
process.exit(anyFail ? 1 : 0);
