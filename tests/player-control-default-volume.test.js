// tests/player-control-default-volume.test.js — Settings tab (ui.js) cho phép
// user đặt "âm lượng mặc định" — <video> element bị YouTube tạo MỚI mỗi khi
// chuyển tập (SPA nav) nên tự reset về 100%, phải tự áp lại target đã lưu
// mỗi lần 'videoReady' fire (xem cuối player-control.js).
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual } = require('./lib/tap');

suite('PlayerControl — tự áp lại "âm lượng mặc định" mỗi khi chuyển tập (player-control.js)');

test('Có default đã lưu (khác 100%) → videoReady fire phải tự gọi setVolumeBoost với đúng giá trị đó', () => {
    global.log = () => {}; global.warn = () => {};
    const fakeVideo = { volume: 1, muted: false, playbackRate: 1 };
    global.VideoContext = { getVideoEl: () => fakeVideo };
    global.document = { getElementById: () => null };
    global.AudioGraph = { attach() {}, setGain() {}, getGain: () => 1, isGraphActive: () => false };

    const handlers = {};
    global.EventBus = { on: (evt, fn) => { (handlers[evt] ||= []).push(fn); }, emit() {} };
    global.Storage  = { getGlobal: (key, def) => (key === 'defaultVolumeBoost' ? 150 : def) };

    loadModule('player-control.js', 'PlayerControl', global);

    handlers['videoReady'].forEach(fn => fn({}));

    assertEqual(fakeVideo.volume, 1, 'video.volume phải giữ ở 1.0 (>100% dùng AudioGraph gain, không phải video.volume)');
});

test('Default vẫn là 100% (chưa từng đổi) → KHÔNG gọi setVolumeBoost thừa mỗi lần chuyển tập', () => {
    global.log = () => {}; global.warn = () => {};
    const fakeVideo = { volume: 1, muted: false, playbackRate: 1 };
    global.VideoContext = { getVideoEl: () => fakeVideo };
    global.document = { getElementById: () => null };
    let attachCalled = false;
    global.AudioGraph = { attach: () => { attachCalled = true; }, setGain() {}, getGain: () => 1, isGraphActive: () => false };

    const handlers = {};
    global.EventBus = { on: (evt, fn) => { (handlers[evt] ||= []).push(fn); }, emit() {} };
    global.Storage  = { getGlobal: (key, def) => def }; // luôn trả default gốc (100)

    loadModule('player-control.js', 'PlayerControl', global);
    handlers['videoReady'].forEach(fn => fn({}));

    assertEqual(attachCalled, false, 'Default = 100% (không có gì để boost) → không cần đụng tới AudioGraph mỗi lần chuyển tập');
});

run().then(() => process.exit(process.exitCode || 0));
