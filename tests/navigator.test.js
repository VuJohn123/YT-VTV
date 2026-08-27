// tests/navigator.test.js — test watchdog động của Navigator (SPA nav)
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertTrue } = require('./lib/tap');

suite('Navigator — adaptive watchdog (navigator.js)');

test('Watchdog tự thu hẹp từ 1200ms mặc định xuống sát latency SPA nav thực đo được', async () => {
    let currentHref = 'https://www.youtube.com/watch?v=AAA';
    global.location = new Proxy({}, { get(_, p) { return p === 'href' ? currentHref : undefined; } });
    global.log = () => {}; global.warn = () => {};
    global.URLSearchParams = require('url').URLSearchParams;

    const listeners = {};
    global.document = {
        addEventListener(evt, fn) { (listeners[evt] ||= []).push(fn); },
        // Không có anchor thật nào trên trang trong test này (mô phỏng
        // trường hợp fallback) — _findReusableRealAnchor() phải tự nhận ra
        // không có gì dùng được rồi rơi về nhánh tạo anchor mới bên dưới,
        // không được throw vì thiếu querySelectorAll.
        querySelectorAll: () => [],
        createElement: () => ({ style: {}, click() {}, remove() {}, set href(v) {}, set rel(v) {}, set tabIndex(v) {} }),
        body: { appendChild() {} },
    };
    global.MouseEvent = function () {};
    let hardReloadFiredAt = null;
    let testStart;
    global.window = {
        _listeners: {},
        addEventListener(evt, fn) { (this._listeners[evt] ||= []).push(fn); },
        location: { set href(v) { hardReloadFiredAt = Date.now() - testStart; } },
    };

    const Navigator = loadModule('navigator.js', 'Navigator');

    let now = 1_000_000;
    const RealDateNow = Date.now;
    Date.now = () => now;

    function simulateNav(newVid, latencyMs) {
        const targetUrl = `https://www.youtube.com/watch?v=${newVid}`;
        Navigator.goTo(targetUrl);
        now += latencyMs;
        currentHref = targetUrl;
        listeners['yt-navigate-finish'].forEach(fn => fn());
    }

    // 4 lần nav SPA "nhanh" (~250ms) liên tiếp — đủ mẫu để watchdog tự học
    simulateNav('B1', 250);
    simulateNav('B2', 250);
    simulateNav('B3', 250);
    simulateNav('B4', 250);

    Date.now = RealDateNow; // cần thời gian thật cho setTimeout hoạt động
    testStart = Date.now();
    Navigator.goTo('https://www.youtube.com/watch?v=WONTNAV'); // cố ý không confirm URL đổi -> watchdog phải fire

    await new Promise(resolve => setTimeout(resolve, 900));
    assertTrue(hardReloadFiredAt !== null && hardReloadFiredAt < 900,
        `Watchdog phải fire SỚM hơn 900ms (mặc định gốc 1200ms) sau khi học được latency thấp — thực tế: ${hardReloadFiredAt}ms`);
});

run().then(() => process.exit(process.exitCode || 0));
