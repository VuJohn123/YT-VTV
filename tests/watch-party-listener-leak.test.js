// tests/watch-party-listener-leak.test.js — "1 phát ba cái": toggle
// WatchParty on/off nhiều lần rồi chuyển tập → broadcast 'nav' (và mọi sync
// message khác) bị lặp lại N lần thay vì đúng 1 lần, vì mỗi lần enable()
// chạy lại thì EventBus.on('videoReady', ...) được đăng ký THÊM 1 lần mới,
// không có gì huỷ đăng ký cũ đi khi disable(). Bug thật: user bật/tắt
// WatchParty vài lần trong 1 phiên (thử tính năng, đổi ý...) rồi chuyển tập
// → tab/máy khác trong phòng nhận N bản tin 'nav' giống hệt nhau, tự
// Navigator.goTo() N lần liên tiếp cho CÙNG 1 URL.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual } = require('./lib/tap');

suite('WatchParty — không được rò rỉ EventBus listener khi toggle enable/disable (watch-party.js)');

test('Bật/tắt 3 lần rồi chuyển tập → broadcast nav CHỈ 1 lần, không phải 3 lần', () => {
    global.log = () => {}; global.warn = () => {};
    global.URLSearchParams = require('url').URLSearchParams;
    global.location = { search: '?v=EP1', href: 'https://www.youtube.com/watch?v=EP1' };

    // EventBus mock THẬT — track handlers theo event, emit() gọi hết mọi
    // handler đã đăng ký (kể cả trùng lặp) để bug lộ ra đúng như production.
    const _handlers = {};
    global.EventBus = {
        on(evt, fn) { (_handlers[evt] ||= []).push(fn); return () => {}; },
        emit(evt, payload) { (_handlers[evt] || []).forEach(fn => fn(payload)); },
    };

    const sentMessages = [];
    global.BroadcastChannel = class {
        constructor(name) { this.name = name; }
        postMessage(msg) { sentMessages.push(msg); }
        addEventListener() {}
        close() {}
    };

    global.VideoContext = { getVideoEl: () => null };
    global.PlayerControl = { play() {}, pause() {}, seekTo() {}, setRate() {} };
    global.Navigator = { goTo: () => {} };

    const WatchParty = loadModule('watch-party.js', 'WatchParty');

    // User thử bật/tắt WatchParty 3 lần trong 1 phiên (test tính năng, đổi ý).
    WatchParty.enable();
    WatchParty.disable();
    WatchParty.enable();
    WatchParty.disable();
    WatchParty.enable();

    // Chuyển sang tập kế tiếp → videoReady fire ĐÚNG 1 LẦN (như production thật).
    EventBus.emit('videoReady', { videoEl: null, duration: 0 });

    const navMessages = sentMessages.filter(m => m.type === 'nav');
    assertEqual(navMessages.length, 1,
        `1 lần videoReady phải chỉ broadcast 'nav' ĐÚNG 1 LẦN, không phải ${navMessages.length} lần ` +
        `(mỗi lần enable() trước đó bị leak thêm 1 listener trùng)`);
});

run().then(() => process.exit(process.exitCode || 0));
