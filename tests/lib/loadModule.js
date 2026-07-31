// tests/lib/loadModule.js
// Loader zero-dependency (không cần npm install gì) để test trực tiếp code
// PRODUCTION trong modules/*.js — không phải bản sao/rewrite riêng cho test.
//
// LƯU Ý KỸ THUẬT: mọi module trong dự án này dùng pattern
// `const X = (() => {...})();`. Ban đầu thử dùng `vm.runInContext` để load —
// KHÔNG hoạt động, vì Node's vm context không expose top-level `const`/`let`
// ra ngoài context object (chỉ `var`/`function` mới thành property của
// context — giới hạn thật của Node, không phải bug ở đây). Giải pháp: dùng
// chính cơ chế `require()` của Node — đọc file, nối thêm `module.exports = X`
// VÀO CUỐI CÙNG SCOPE (không phải sandbox riêng), ghi ra file tạm rồi
// require() — đây là cách đã dùng xuyên suốt session và test thật đã PASS.

const fs = require('fs');
const path = require('path');
const os = require('os');

let _tmpCounter = 0;

/**
 * Load 1 module production (modules/*.js), tự inject mock globals bằng cách
 * gán vào `global.*` TRƯỚC khi require (giống hệt cách browser/Tampermonkey
 * cung cấp EventBus/Storage/... như biến toàn cục cho mỗi module).
 *
 * @param {string} relativePath   vd 'video-context.js'
 * @param {string} exportedName   tên biến top-level cần lấy ra, vd 'VideoContext'
 * @param {object} mockGlobals    sẽ được gán vào global.* trước khi require
 * @returns {*} giá trị của exportedName sau khi module chạy xong
 */
function loadModule(relativePath, exportedName, mockGlobals = {}) {
    for (const [k, v] of Object.entries(mockGlobals)) global[k] = v;

    const srcPath = path.join(__dirname, '..', '..', 'modules', relativePath);
    const code = fs.readFileSync(srcPath, 'utf8') + `\nmodule.exports = ${exportedName};\n`;
    const tmpPath = path.join(os.tmpdir(), `vtvtest_${exportedName}_${_tmpCounter++}_${Date.now()}.js`);
    fs.writeFileSync(tmpPath, code);
    try {
        delete require.cache[require.resolve(tmpPath)];
        return require(tmpPath);
    } finally {
        fs.unlinkSync(tmpPath);
    }
}

module.exports = { loadModule };
