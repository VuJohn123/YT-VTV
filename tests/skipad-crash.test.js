// tests/skipad-crash.test.js — test bug crash "Cannot read properties of null
// (reading 'click')" khi không tìm thấy nút Skip nào trên trang.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual } = require('./lib/tap');

suite('AdBlock — _skipAdButtons null-safety (features.js)');

test('Không có nút Skip nào trên trang → KHÔNG crash (bug thật đã gặp trên production)', () => {
    global.log = () => {}; global.warn = () => {};
    global.EventBus = { on() {}, emit() {} };
    global.VideoContext = { getVideoEl: () => null };
    global.PlayerControl = {};
    global.AD_MAX_DURATION = 30;
    global.document = {
        querySelector: () => null, // mô phỏng đúng tình huống lỗi: không tìm thấy nút nào
        querySelectorAll: () => [],
        addEventListener() {},
        body: {},
    };
    global.MutationObserver = class { observe() {} disconnect() {} };

    const AdBlock = loadModule('features.js', 'AdBlock', global);

    let threw = false;
    try {
        AdBlock.start(); // sẽ tự gọi _skipAdButtons() nội bộ qua _watchSkipButton/_hideAds flow
    } catch (e) {
        threw = true;
        console.log('  (lỗi thật sự xảy ra):', e.message);
    }
    assertEqual(threw, false, '_skipAdButtons không được throw khi không tìm thấy nút Skip nào');

    AdBlock.stop();
});

run();
