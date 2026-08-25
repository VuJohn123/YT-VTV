// tests/skipad-crash.test.js — 2 bug thật đã gặp trên production ở
// _skipAdButtons() (features.js — AdBlock):
//   1. `btn?.offsetParent !== null` khi btn=null → `undefined !== null` =
//      true (optional chaining short-circuit, KHÔNG phải null) → crash
//      "Cannot read properties of null (reading 'click')".
//   2. Chạy VÔ ĐIỀU KIỆN + query KHÔNG scoped vào player → tự bấm nhầm bất
//      kỳ nút "Skip"/"Bỏ qua" nào TRÊN TOÀN TRANG kể cả khi KHÔNG có quảng
//      cáo, khiến user không tương tác được các phần khác của YouTube.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertFalse, assertTrue } = require('./lib/tap');

function baseDoc(overrides = {}) {
    return {
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        body: {},
        ...overrides,
    };
}

suite('AdBlock — _skipAdButtons null-safety & scope (features.js)');

test('Không có nút Skip nào trên trang, không có quảng cáo → KHÔNG crash', () => {
    global.log = () => {}; global.warn = () => {};
    global.EventBus = { on() {}, emit() {} };
    global.VideoContext = { getVideoEl: () => null };
    global.PlayerControl = {};
    global.AD_MAX_DURATION = 30;
    global.document = baseDoc();
    global.MutationObserver = class { observe() {} disconnect() {} };

    const AdBlock = loadModule('features.js', 'AdBlock', global);

    let threw = false;
    try {
        AdBlock._internal._skipAdButtons();
    } catch (e) {
        threw = true;
        console.log('  (lỗi thật sự xảy ra):', e.message);
    }
    assertEqual(threw, false, '_skipAdButtons không được throw khi không tìm thấy nút Skip nào');
});

test('KHÔNG có quảng cáo (không có class ad-showing) → tuyệt đối không bấm nút nào, kể cả nếu tồn tại nút "Skip" ngoài player', () => {
    global.log = () => {}; global.warn = () => {};
    global.EventBus = { on() {}, emit() {} };
    global.VideoContext = { getVideoEl: () => null };
    global.PlayerControl = {};
    global.AD_MAX_DURATION = 30;
    global.MutationObserver = class { observe() {} disconnect() {} };

    let decoyClicked = false;
    // Mô phỏng đúng bug thật: 1 nút "Skip to content" (accessibility, không
    // liên quan quảng cáo) tồn tại Ở ĐÂU ĐÓ trên trang, TRÙNG với selector
    // fallback aria-label — nếu code cũ (query document, không gate theo
    // ad-state) vẫn còn thì nút này sẽ bị bấm nhầm.
    const decoyBtn = { offsetParent: {}, click: () => { decoyClicked = true; } };
    global.document = baseDoc({
        querySelector: (sel) => {
            if (sel.includes('ad-showing') || sel.includes('ad-interrupting')) return null; // KHÔNG có quảng cáo
            if (sel.includes('aria-label')) return decoyBtn; // decoy ở TOÀN TRANG (document-level)
            return null; // '.html5-video-player' cũng không "tìm thấy" ở cấp document trong test này — không quan trọng vì phải bail sớm trước khi tới đó
        },
    });

    const AdBlock = loadModule('features.js', 'AdBlock', global);
    AdBlock._internal._skipAdButtons();

    assertFalse(decoyClicked, 'Không có quảng cáo → không được bấm bất kỳ nút nào, kể cả nút trùng tên nằm ngoài player');
});

test('CÓ quảng cáo thật (class ad-showing) + nút Skip nằm ĐÚNG trong player → được bấm', () => {
    global.log = () => {}; global.warn = () => {};
    global.EventBus = { on() {}, emit() {} };
    global.VideoContext = { getVideoEl: () => null };
    global.PlayerControl = {};
    global.AD_MAX_DURATION = 30;
    global.MutationObserver = class { observe() {} disconnect() {} };

    let realClicked = false, decoyClicked = false;
    const realSkipBtn  = { offsetParent: {}, click: () => { realClicked = true; } };
    const decoyOnPage  = { offsetParent: {}, click: () => { decoyClicked = true; } }; // nút trùng tên NGOÀI player — không được đụng tới

    const playerEl = {
        querySelector: (sel) => (sel === '.ytp-skip-ad-button' ? realSkipBtn : null), // chỉ có nút THẬT bên trong player
    };

    global.document = baseDoc({
        querySelector: (sel) => {
            if (sel.includes('ad-showing')) return {}; // CÓ quảng cáo — class ad-showing hiện diện
            if (sel === '.html5-video-player') return playerEl;
            if (sel.includes('aria-label')) return decoyOnPage; // nếu code lỡ query document thay vì player sẽ bấm nhầm cái này
            if (sel === 'ytd-player') return null;
            return null;
        },
    });

    const AdBlock = loadModule('features.js', 'AdBlock', global);
    AdBlock._internal._skipAdButtons();

    assertTrue(realClicked, 'Nút Skip THẬT nằm trong player phải được bấm khi đang có quảng cáo');
    assertFalse(decoyClicked, 'KHÔNG được bấm nút trùng tên nằm ngoài player (chứng minh query đã scoped đúng)');
});

run().then(() => process.exit(process.exitCode || 0));

