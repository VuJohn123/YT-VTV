// tests/buffer-monitor.test.js — test tự giảm quality khi buffering liên tục
// (network-bound) VÀ khi tỉ lệ rớt frame cao dù buffer đủ (cpu-bound, mới
// thêm — xem comment ADAPTIVE ở đầu buffer-monitor.js).
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertTrue } = require('./lib/tap');

suite('BufferMonitor — auto-downgrade network-bound + cpu-bound (buffer-monitor.js)');

test('Buffer 3 lần trong 30s → tự giảm quality 1 bậc (network-bound)', () => {
    global.log = () => {};
    global.EventBus = { on() {}, emit() {} };
    let currentQuality = 'hd1080';
    global.PlayerControl = { getQuality: () => currentQuality, setQuality: (q) => { currentQuality = q; return true; } };
    const fakeVideoEl = { addEventListener(evt, fn) { this['_' + evt] = fn; } };
    global.VideoContext = { getVideoEl: () => fakeVideoEl };

    const BufferMonitor = loadModule('buffer-monitor.js', 'BufferMonitor');

    let now = 1_000_000;
    const RealDateNow = Date.now;
    Date.now = () => now;

    BufferMonitor.enable();
    fakeVideoEl._waiting(); now += 5000;
    fakeVideoEl._waiting(); now += 5000;
    fakeVideoEl._waiting();

    Date.now = RealDateNow;
    assertEqual(currentQuality, 'hd720', 'Sau 3 lần buffer liên tiếp trong cửa sổ 30s, quality phải giảm 1 bậc (hd1080 → hd720)');

    // Dọn timer (_dropCheckTimer từ _attach()) — nếu không, process con của
    // test này (execFileSync trong run-all.js) sẽ treo vô thời hạn vì
    // setInterval còn sống giữ event loop không rỗng.
    BufferMonitor.disable();
});

test('Tỉ lệ rớt frame cao dù KHÔNG có sự kiện waiting nào → vẫn tự giảm quality (cpu-bound, KHÁC network-bound)', () => {
    global.log = () => {};
    global.EventBus = { on() {}, emit() {} };
    let currentQuality = 'hd1080';
    global.PlayerControl = { getQuality: () => currentQuality, setQuality: (q) => { currentQuality = q; return true; } };

    // Video "khoẻ mạnh" về mặt buffer (KHÔNG bao giờ fire 'waiting') nhưng
    // rớt frame liên tục — đúng chữ ký của máy quá tải CPU/GPU, không phải
    // mạng chậm. Đây CHÍNH LÀ case cũ (chỉ dựa vào 'waiting') sẽ bỏ sót
    // hoàn toàn.
    let dropped = 0, total = 0;
    const fakeVideoEl = {
        addEventListener() {}, // không cần fire 'waiting' trong test này
        getVideoPlaybackQuality: () => ({ droppedVideoFrames: dropped, totalVideoFrames: total }),
    };
    global.VideoContext = { getVideoEl: () => fakeVideoEl };

    const BufferMonitor = loadModule('buffer-monitor.js', 'BufferMonitor');
    BufferMonitor.enable();

    // Mô phỏng 2 chu kỳ đo (DROP_SPIKE_THRESHOLD=2), mỗi chu kỳ 30% frame bị
    // rớt (> DROP_RATE_THRESHOLD=0.15) — gọi trực tiếp _checkDropRate() qua
    // _internal thay vì chờ setInterval thật (không cần giả lập timer).
    total = 1000; dropped = 300; // chu kỳ 1: baseline 0 → 300/1000 = 30% rớt
    BufferMonitor._internal._checkDropRate(); // snapshot đầu tiên, CHƯA đủ 2 điểm đo để tính delta — không downgrade ở lần gọi này
    assertEqual(currentQuality, 'hd1080', 'Lần đo ĐẦU TIÊN chỉ lấy snapshot baseline, chưa có gì để so sánh — không được downgrade ngay');

    total = 2000; dropped = 600; // chu kỳ 2: delta = (600-300)/(2000-1000) = 30% rớt trong khoảng vừa qua
    BufferMonitor._internal._checkDropRate();
    total = 3000; dropped = 900; // chu kỳ 3: delta tiếp tục 30% → đủ DROP_SPIKE_THRESHOLD=2 lần liên tiếp
    BufferMonitor._internal._checkDropRate();

    assertEqual(currentQuality, 'hd720', 'Rớt frame cao liên tục dù không có waiting nào → vẫn phải tự giảm quality (bắt được case cpu-bound mà logic cũ bỏ sót)');
    BufferMonitor.disable();
});

test('Tỉ lệ rớt frame BÌNH THƯỜNG (dưới ngưỡng) → KHÔNG downgrade nhầm', () => {
    global.log = () => {};
    global.EventBus = { on() {}, emit() {} };
    let currentQuality = 'hd1080';
    let downgradeCalled = false;
    global.PlayerControl = { getQuality: () => currentQuality, setQuality: (q) => { downgradeCalled = true; currentQuality = q; return true; } };

    let dropped = 0, total = 0;
    const fakeVideoEl = {
        addEventListener() {},
        getVideoPlaybackQuality: () => ({ droppedVideoFrames: dropped, totalVideoFrames: total }),
    };
    global.VideoContext = { getVideoEl: () => fakeVideoEl };

    const BufferMonitor = loadModule('buffer-monitor.js', 'BufferMonitor');
    BufferMonitor.enable();

    // 2% rớt frame — bình thường, dưới xa DROP_RATE_THRESHOLD=0.15.
    total = 1000; dropped = 20;
    BufferMonitor._internal._checkDropRate();
    total = 2000; dropped = 40;
    BufferMonitor._internal._checkDropRate();
    total = 3000; dropped = 60;
    BufferMonitor._internal._checkDropRate();

    assertEqual(downgradeCalled, false, 'Tỉ lệ rớt frame bình thường (2%) không được kích hoạt downgrade');
    BufferMonitor.disable();
});

run().then(() => process.exit(process.exitCode || 0));

