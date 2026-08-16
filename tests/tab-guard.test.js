// tests/tab-guard.test.js — mô phỏng 2 "tab" thật sự (2 instance module độc
// lập, mỗi tab 1 closure riêng — đúng như 2 tab trình duyệt thật) giao tiếp
// qua nhau bằng 1 mock BroadcastChannel bus dùng chung (định tuyến message
// giữa các instance cùng "channel name", giống hệt semantics thật của
// BroadcastChannel API).
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertTrue } = require('./lib/tap');

suite('TabGuard — cảnh báo trùng tab, KHÔNG sync (tab-guard.js)');

test('2 tab cùng videoId → cả 2 nhận cảnh báo; 1 tab đổi video khác → cảnh báo tự tắt', () => {
    global.log = () => {}; global.warn = () => {};

    class BusChannel {
        constructor(name) {
            this.name = name;
            this._listeners = [];
            (BusChannel._reg[name] ||= new Set()).add(this);
        }
        addEventListener(type, fn) { if (type === 'message') this._listeners.push(fn); }
        postMessage(data) {
            for (const inst of BusChannel._reg[this.name]) {
                if (inst === this) continue; // như BroadcastChannel thật: không tự nhận lại message của chính mình
                inst._listeners.forEach(fn => fn({ data }));
            }
        }
        close() { BusChannel._reg[this.name]?.delete(this); }
    }
    BusChannel._reg = {};
    global.BroadcastChannel = BusChannel;

    const emitted = [];
    global.EventBus = { emit: (evt, payload) => emitted.push({ evt, payload }), on() {} };

    // 2 instance ĐỘC LẬP — mỗi cái là 1 closure riêng với state riêng
    // (_tabId khác nhau vì Math.random() mỗi lần load), y hệt 2 tab thật.
    const tabA = loadModule('tab-guard.js', 'TabGuard');
    const tabB = loadModule('tab-guard.js', 'TabGuard');

    tabA.enable();
    tabB.enable();

    tabA.setCurrentVideo('EP1');
    assertEqual(
        emitted.filter(e => e.evt === 'dupTabWarning' && e.payload.count > 0).length, 0,
        'Chỉ mới 1 tab đang xem EP1 — chưa có gì trùng để cảnh báo'
    );

    tabB.setCurrentVideo('EP1'); // tab B mở ĐÚNG video mà tab A đang xem
    const warnings = emitted.filter(e => e.evt === 'dupTabWarning' && e.payload.count > 0);
    assertTrue(warnings.length >= 1, 'Cả 2 tab cùng videoId EP1 → phải có cảnh báo được emit (count > 0)');

    emitted.length = 0;
    tabA.setCurrentVideo('EP2'); // tab A chuyển sang tập khác — không còn trùng B nữa
    const clears = emitted.filter(e => e.evt === 'dupTabWarning' && e.payload.count === 0);
    assertTrue(clears.length >= 1, 'A đổi sang video khác không còn trùng B → phải emit count:0 (tự tắt cảnh báo)');
});

test('disable() → tự dọn cảnh báo của chính tab đó ngay lập tức (không đợi peer hết hạn)', () => {
    global.log = () => {}; global.warn = () => {};

    class BusChannel {
        constructor(name) {
            this.name = name;
            this._listeners = [];
            (BusChannel._reg[name] ||= new Set()).add(this);
        }
        addEventListener(type, fn) { if (type === 'message') this._listeners.push(fn); }
        postMessage(data) {
            for (const inst of BusChannel._reg[this.name]) {
                if (inst === this) continue;
                inst._listeners.forEach(fn => fn({ data }));
            }
        }
        close() { BusChannel._reg[this.name]?.delete(this); }
    }
    BusChannel._reg = {};
    global.BroadcastChannel = BusChannel;

    const emitted = [];
    global.EventBus = { emit: (evt, payload) => emitted.push({ evt, payload }), on() {} };

    const tabA = loadModule('tab-guard.js', 'TabGuard');
    const tabB = loadModule('tab-guard.js', 'TabGuard');

    tabA.enable();
    tabB.enable();
    tabA.setCurrentVideo('EP1');
    tabB.setCurrentVideo('EP1');
    assertTrue(
        emitted.some(e => e.evt === 'dupTabWarning' && e.payload.count > 0),
        'Setup: phải có cảnh báo trước khi test disable()'
    );

    // NOTE: disable() giờ gửi tín hiệu "rời đi" (videoId:null) TRƯỚC KHI
    // đóng channel — B nhận được sẽ dọn A khỏi peer list NGAY, không cần đợi
    // PEER_STALE_MS. Test cả 2 phía: A tự dọn cảnh báo của A, và B cũng dọn
    // theo vì đã nhận tín hiệu rời đi từ A.
    emitted.length = 0;
    tabA.disable();
    const clears = emitted.filter(e => e.evt === 'dupTabWarning' && e.payload.count === 0);
    assertTrue(clears.length >= 1, 'disable() phải emit ngay count:0 (cả tự dọn của A lẫn B nhận tín hiệu rời đi từ A)');

    // Sau disable(), A không còn nhận message nào nữa (channel đã đóng) —
    // B gửi thêm heartbeat cũng không thể khiến A tự bật cảnh báo lại.
    emitted.length = 0;
    tabB.setCurrentVideo('EP1');
    assertEqual(
        emitted.filter(e => e.evt === 'dupTabWarning' && e.payload.count > 0).length, 0,
        'B gửi lại heartbeat sau khi A đã disable() → không ai còn cảnh báo trùng nữa (B đã dọn A khỏi peer list)'
    );
    assertEqual(tabA.isEnabled(), false, 'A phải ở trạng thái disabled sau disable()');
});

run().then(() => process.exit(process.exitCode || 0));
