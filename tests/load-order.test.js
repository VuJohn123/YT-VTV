// tests/load-order.test.js — Production checklist (Scalable/Debugging-
// Friendly): mô phỏng đúng thứ tự @require thật trong vtv-ultimate.user.js,
// load TOÀN BỘ module vào 1 vm context DÙNG CHUNG (giống hệt cách
// Tampermonkey nối các @require lại rồi chạy tuần tự trong CÙNG 1 scope
// global) — bắt ReferenceError nếu module nào tham chiếu 1 global (const/
// function IIFE của module khác) Ở TOP-LEVEL (không phải bên trong hàm chờ
// gọi sau) mà global đó CHƯA được định nghĩa tại thời điểm module này tự
// thực thi.
//
// BỐI CẢNH: audit phát hiện nhiều module có `EventBus.on(...)` chạy ngay ở
// top-level IIFE (vd player-control.js cuối file, watch-party.js, video-
// context.js...) — các chỗ này CẦN `EventBus` global đã tồn tại NGAY LÚC
// LOAD, không phải lúc callback được gọi. Thứ tự @require hiện tại đặt
// event-bus.js load RẤT SỚM (#2/23) nên hiện KHÔNG có bug — nhưng đây là
// pattern DỄ VỠ (fragile): nếu sau này ai sắp xếp lại thứ tự @require (vd
// để tối ưu load time) mà không biết dependency ngầm này, sẽ crash NGAY KHI
// LOAD với lỗi khó hiểu, và KHÔNG TEST NÀO KHÁC bắt được (mọi test khác
// dùng loadModule() với mock riêng lẻ từng module, không mô phỏng thứ tự
// @require thật). Test này chính là lưới an toàn cho đúng rủi ro đó.
//
// PHẠM VI: chỉ load tới hết history-viewer.js (KHÔNG chạy tới entry.js) —
// entry.js gọi UI.init() cuối cùng, việc này cần mock DOM đầy đủ (panel HTML
// thật, getElementById trả đúng element vừa tạo...) mới chạy được, tốn công
// sức không tương xứng với mục tiêu test này (bắt ReferenceError do thứ tự
// load sai, không phải kiểm thử UI rendering — UI rendering đã được cover
// gián tiếp qua các test khác dùng loadModule() cho ui.js). 22/23 module đã
// đủ để xác nhận toàn bộ dependency chain giữa các module lõi.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { suite, test, run, assertTrue, assertEqual } = require('./lib/tap');

suite('Load order — mô phỏng đúng thứ tự @require thật (vtv-ultimate.user.js)');

function getRequireOrder() {
    const headerPath = path.join(__dirname, '..', 'vtv-ultimate.user.js');
    const header = fs.readFileSync(headerPath, 'utf8');
    return header.split('\n')
        .filter(l => l.includes('@require') && l.includes('modules/'))
        .map(l => l.match(/modules\/([a-z-]+\.js)/)[1]);
}

function buildSandbox() {
    const sandbox = {
        console: { log() {}, warn() {}, error() {} }, // im lặng — test này chỉ quan tâm module có load được không, không phải log output
        window: { addEventListener() {}, removeEventListener() {} },
        document: {
            addEventListener() {}, removeEventListener() {},
            querySelector() { return null; }, querySelectorAll() { return []; },
            createElement() {
                return {
                    style: { setProperty() {}, cssText: '' },
                    addEventListener() {}, removeEventListener() {},
                    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
                    setAttribute() {}, appendChild() {},
                };
            },
            body: { appendChild() {}, addEventListener() {} },
            head: { appendChild() {} },
            getElementById() { return null; },
            readyState: 'complete',
        },
        location: { href: 'https://www.youtube.com/watch?v=test', search: '', pathname: '/watch' },
        navigator: { userAgent: 'test', mediaDevices: undefined },
        URLSearchParams,
        setTimeout, clearTimeout, setInterval, clearInterval,
        requestAnimationFrame: (fn) => setTimeout(fn, 16), cancelAnimationFrame: clearTimeout,
        Promise, Map, Set, JSON, Math, Date, Array, Object, String, Number, RegExp, Error,
        crypto: { randomUUID: () => 'x', subtle: { digest: async () => new ArrayBuffer(32) } },
        fetch: async () => ({ text: async () => '', json: async () => ({}) }),
        GM_setValue() {}, GM_getValue(k, d) { return d; }, GM_deleteValue() {},
        GM_registerMenuCommand() {}, GM_xmlhttpRequest() {}, GM_addStyle() {}, GM_openInTab() {},
        unsafeWindow: undefined,
        BroadcastChannel: class { postMessage() {} addEventListener() {} close() {} },
        MutationObserver: class { observe() {} disconnect() {} },
        URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
        Blob: class {},
        HTMLAnchorElement: class {},
        customElements: { whenDefined: () => Promise.resolve() },
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    return sandbox;
}

test('22 module lõi (đến hết history-viewer.js) load sạch theo ĐÚNG thứ tự @require thật — không ReferenceError do sai thứ tự', () => {
    const moduleNames = getRequireOrder();
    assertTrue(moduleNames.length >= 20, 'setup: phải đọc được danh sách @require thật từ vtv-ultimate.user.js (đọc được ' + moduleNames.length + ')');

    // entry.js luôn là module CUỐI CÙNG theo thiết kế (orchestrator, gọi
    // UI.init() và mọi flow chính) — loại nó khỏi phạm vi test này (xem
    // giải thích PHẠM VI ở đầu file). Nếu entry.js không phải module cuối,
    // đó tự nó là 1 vấn đề kiến trúc đáng test riêng, không phải mục tiêu
    // của test hiện tại.
    assertEqual(moduleNames[moduleNames.length - 1], 'entry.js', 'entry.js phải luôn là module cuối cùng trong load order (orchestrator)');
    const toLoad = moduleNames.slice(0, -1);

    const sandbox = buildSandbox();
    const failures = [];
    for (const name of toLoad) {
        const filePath = path.join(__dirname, '..', 'modules', name);
        if (!fs.existsSync(filePath)) continue; // external CDN (vd peerjs) không có file local, bỏ qua
        const code = fs.readFileSync(filePath, 'utf8');
        try {
            vm.runInContext(code, sandbox, { filename: name });
        } catch (e) {
            failures.push(`${name}: ${e.constructor.name}: ${e.message}`);
        }
    }

    assertEqual(failures.length, 0, 'Module load thất bại theo đúng thứ tự @require thật:\n  ' + failures.join('\n  '));
});

run().then(() => process.exit(process.exitCode || 0));
