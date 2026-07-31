// tests/voice-fuzzy.test.js — test logic fuzzy-match/Levenshtein/parseAmount
// của VoiceControl, load TRỰC TIẾP code production qua _internal export.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertTrue } = require('./lib/tap');

suite('VoiceControl — fuzzy match / Levenshtein / parseAmount (features.js)');

const VoiceControl = loadModule('features.js', 'VoiceControl', {
    log: () => {}, warn: () => {},
    EventBus: { on() {}, emit() {} },
    Storage: { getFeatureFlags: () => ({}), saveFlag() {} },
    document: { addEventListener() {}, body: {} },
    VideoContext: {},
    PlayerControl: {},
    AD_MAX_DURATION: 30,
});
const { _fuzzyCorrectCoreKeywords, _levenshtein, _parseAmount, _re } = VoiceControl._internal;

test('Levenshtein: dừg vs dừng = 1', () => {
    assertEqual(_levenshtein('dừg', 'dừng'), 1);
});

test('Fuzzy: "dừg lại" tự sửa thành "dừng lại"', () => {
    assertEqual(_fuzzyCorrectCoreKeywords('dừg lại'), 'dừng lại');
});

test('Fuzzy: "lụp lại đoạn này" tự sửa thành "lặp lại đoạn này"', () => {
    assertEqual(_fuzzyCorrectCoreKeywords('lụp lại đoạn này'), 'lặp lại đoạn này');
});

test('Fuzzy: KHÔNG được đụng vào câu bình thường ("cho mình xem tiếp phim này đi")', () => {
    assertEqual(_fuzzyCorrectCoreKeywords('cho mình xem tiếp phim này đi'), null);
});

test('Fuzzy: KHÔNG được sửa "phim" thành "phát" dù gần (an toàn > bắt được nhiều case)', () => {
    assertEqual(_fuzzyCorrectCoreKeywords('tôi muốn xem phim này'), null);
});

test('Fuzzy: KHÔNG được sửa "lùi" thành "lặp" (nghĩa khác hẳn nhau — rủi ro đã phát hiện qua test)', () => {
    // "lùi" không nằm trong CORE_KEYWORDS nên không có gì để so khớp - đảm bảo không đổi
    assertEqual(_fuzzyCorrectCoreKeywords('lùi lại xíu'), null);
});

test('Fuzzy: "chip intro" KHÔNG sửa được (ngoài khả năng — giới hạn thật của edit distance)', () => {
    assertEqual(_fuzzyCorrectCoreKeywords('chip intro'), null);
});

test('parseAmount: "2 phút" → 120s', () => {
    assertEqual(_parseAmount('2 phút'), 120);
});

test('parseAmount: "30 giây" → 30s', () => {
    assertEqual(_parseAmount('30 giây'), 30);
});

test('parseAmount: không có số → dùng default', () => {
    assertEqual(_parseAmount('không có số nào', 30), 30);
});

test('_re: "tua 10 phút" khớp forward-seek pattern (bug đã fix — trước đây không khớp gì cả)', () => {
    const t = 'tua 10 phút';
    const matches = _re('tua nhanh|tua thêm|bỏ qua|skip|tiến lên|nhảy qua').test(t) ||
        (_re('tua').test(t) && !/tua\s*(lại|lùi)/.test(t));
    assertTrue(matches, '"tua 10 phút" phải khớp forward-seek');
});

test('_re: "tua lại 5 giây" KHÔNG bị forward-seek nuốt nhầm (phải để backward xử lý)', () => {
    const t = 'tua lại 5 giây';
    const isForward = _re('tua nhanh|tua thêm|bỏ qua|skip|tiến lên|nhảy qua').test(t) ||
        (_re('tua').test(t) && !/tua\s*(lại|lùi)/.test(t));
    assertEqual(isForward, false, '"tua lại" phải được loại khỏi forward-seek');
});

run();
