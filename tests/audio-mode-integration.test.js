// tests/audio-mode-integration.test.js — test AudioMode.enable() tự bump tốc
// độ 1.5x cho nội dung audio truyện, giữ nguyên tốc độ cho nội dung khác.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual } = require('./lib/tap');

suite('AudioMode — smart speed bump (features.js)');

function setupMocks(title, initialRate = 1) {
    global.log = () => {}; global.warn = () => {};
    global.EventBus = { on() {}, emit() {} };
    global.Storage = { saveFlag() {}, getFeatureFlags: () => ({}) };
    global.isAudioStoryContent = loadModule('utils.js', 'isAudioStoryContent'); // load THẬT từ utils.js, giống production (utils.js load trước features.js)
    global.document = {
        querySelector: (sel) => sel.includes('h1') ? null : null, // giả lập không tìm thấy h1, fallback document.title
        title: title + ' - YouTube',
        createElement: () => ({ style: {}, remove() {} }),
        head: { appendChild() {} },
        addEventListener() {},
        body: {},
    };
    let currentRate = initialRate;
    let currentQuality = 'hd1080';
    global.VideoContext = { getVideoEl: () => null };
    global.PlayerControl = {
        getQuality: () => currentQuality,
        setQuality: (q) => { currentQuality = q; return true; },
        getLowestQuality: () => 'tiny',
        getRate: () => currentRate,
        setRate: (r) => { currentRate = r; return true; },
    };
    return { getRate: () => currentRate };
}

test('Nội dung audio truyện → tự tăng tốc lên 1.5x khi bật Audio Mode', () => {
    const { getRate } = setupMocks('[AUDIO TRUYỆN] Ma Nữ Báo Thù - Chương 1');
    const AudioMode = loadModule('features.js', 'AudioMode', global);
    AudioMode.enable();
    assertEqual(getRate(), 1.5, 'Tốc độ phải tự tăng lên 1.5x cho audio truyện');
});

test('Nội dung bình thường (phim VTV) → GIỮ NGUYÊN tốc độ khi bật Audio Mode', () => {
    const { getRate } = setupMocks('Thương Ngày Nắng Về tập 31 [1/4]');
    const AudioMode = loadModule('features.js', 'AudioMode', global);
    AudioMode.enable();
    assertEqual(getRate(), 1, 'Tốc độ KHÔNG được tự đổi cho nội dung không phải audio truyện');
});

test('Tắt Audio Mode → khôi phục đúng tốc độ gốc (không phải luôn về 1.0)', () => {
    const { getRate } = setupMocks('[AUDIO TRUYỆN] Test', 1.25); // user đã tự set 1.25x từ trước
    const AudioMode = loadModule('features.js', 'AudioMode', global);
    AudioMode.enable();
    assertEqual(getRate(), 1.5, 'Phải bump lên 1.5x trước');
    AudioMode.disable();
    assertEqual(getRate(), 1.25, 'Phải khôi phục ĐÚNG tốc độ user đã đặt trước đó (1.25x), không phải mặc định 1.0x');
});

run();
