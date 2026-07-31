// tests/buffer-monitor.test.js — test tự giảm quality khi buffering liên tục
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual } = require('./lib/tap');

suite('BufferMonitor — auto-downgrade (buffer-monitor.js)');

test('Buffer 3 lần trong 30s → tự giảm quality 1 bậc', () => {
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
});

run();
