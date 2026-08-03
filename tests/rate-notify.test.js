// tests/rate-notify.test.js — test bug "tăng tốc 4x" báo sai (log nói 4x
// nhưng tốc độ thật chỉ 2x do bị snap) — đúng bug từ ảnh chụp thật.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertTrue } = require('./lib/tap');

suite('VoiceControl — rate notification honesty (features.js)');

function setupMocks() {
    global.log = () => {}; global.warn = () => {};
    let notifiedText = null;
    global.EventBus = { on() {}, emit: (evt, p) => { if (evt === 'voiceLabel') notifiedText = p.text; } };
    global.Storage = { getFeatureFlags: () => ({}), saveFlag() {} };
    global.document = { addEventListener() {}, body: {} };
    global.VideoContext = {};
    global.AD_MAX_DURATION = 30;
    let currentRate = 2; // giả lập đã bị snap về 2 (giống thật)
    global.PlayerControl = { getRate: () => currentRate };
    return { getNotified: () => notifiedText };
}

test('Yêu cầu 4x nhưng thực tế chỉ áp dụng được 2x (bị snap) → notify phải báo ĐÚNG 2x, kèm gợi ý "tốc độ tự do"', () => {
    const { getNotified } = setupMocks();
    const VoiceControl = loadModule('features.js', 'VoiceControl', global);
    VoiceControl._internal._notifyRateApplied(4);
    const text = getNotified();
    assertTrue(text.includes('2x'), `Phải báo tốc độ THẬT (2x), không phải số yêu cầu (4x) — thực tế: "${text}"`);
    assertTrue(!text.startsWith('✓ 4x'), 'Không được nói dối là đã áp dụng 4x');
    assertTrue(text.includes('tốc độ tự do'), 'Nên gợi ý lệnh "tốc độ tự do" khi bị snap');
});

test('Yêu cầu khớp đúng tốc độ thật (không bị snap) → notify đơn giản, không kèm cảnh báo thừa', () => {
    const { getNotified } = setupMocks();
    global.PlayerControl.getRate = () => 1.5;
    const VoiceControl = loadModule('features.js', 'VoiceControl', global);
    VoiceControl._internal._notifyRateApplied(1.5);
    const text = getNotified();
    assertTrue(text === '✓ 1.5x', `Không cần cảnh báo khi không bị snap — thực tế: "${text}"`);
});

run();
