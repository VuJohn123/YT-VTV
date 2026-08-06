// tests/storage.test.js — test error-log ring buffer + version migration
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertTrue, assertFalse } = require('./lib/tap');

suite('Storage — error log & migration (storage.js)');

function freshStorage() {
    let store = {};
    global.GM_getValue = (k, d) => (k in store ? store[k] : d);
    global.GM_setValue = (k, v) => { store[k] = v; };
    global.GM_deleteValue = (k) => { delete store[k]; };
    global.GM_listValues = () => Object.keys(store);
    global.log = () => {}; global.warn = () => {};
    return loadModule('storage.js', 'Storage');
}

test('logError() giới hạn tối đa 50 mục, giữ 50 mục GẦN NHẤT', () => {
    const Storage = freshStorage();
    for (let i = 0; i < 60; i++) Storage.logError('TestCtx', `Lỗi số ${i}`);
    const log = Storage.getErrorLog();
    assertEqual(log.length, 50, 'log phải bị cap ở 50');
    assertEqual(log[0].message, 'Lỗi số 10', 'phải giữ 50 lỗi GẦN NHẤT, không phải 50 đầu');
    assertEqual(log[49].message, 'Lỗi số 59', 'lỗi cuối cùng phải là lỗi mới nhất');
});

test('clearErrorLog() xoá sạch log', () => {
    const Storage = freshStorage();
    Storage.logError('ctx', 'msg');
    Storage.clearErrorLog();
    assertEqual(Storage.getErrorLog().length, 0);
});

test('runMigrations(): tự bật sponsorBlock nếu marathon đã bật từ trước (schema 0→1)', () => {
    const Storage = freshStorage();
    Storage.saveFlag('marathon', true);
    Storage.runMigrations();
    assertTrue(Storage.getFeatureFlags().sponsorBlock, 'sponsorBlock phải tự bật khi marathon đã bật trước migration');
});

test('runMigrations(): idempotent — không ghi đè lựa chọn tay của user SAU migration', () => {
    const Storage = freshStorage();
    Storage.saveFlag('marathon', true);
    Storage.runMigrations();
    Storage.saveFlag('sponsorBlock', false); // user tự tắt lại
    Storage.runMigrations(); // chạy lại lần 2 (schema đã = 1, phải no-op)
    assertFalse(Storage.getFeatureFlags().sponsorBlock, 'migration không được chạy lại và ghi đè lựa chọn user');
});

test('learnSkip(): dùng robust average (median), 1 lần tua ngẫu nhiên không liên quan (outlier) KHÔNG kéo lệch introAvg', () => {
    const Storage = freshStorage();
    // 4 lần skip intro thật, nhất quán quanh ~90s
    Storage.learnSkip('s|3', 0, 88, 1400);
    Storage.learnSkip('s|3', 0, 90, 1400);
    Storage.learnSkip('s|3', 0, 92, 1400);
    // 1 lần tua ngẫu nhiên không liên quan (user xem lại đoạn đầu vì lý do khác),
    // rơi đúng vào khung "trông giống skip intro" nhưng là outlier thật sự (600s)
    Storage.learnSkip('s|3', 0, 600, 1400);
    const d = Storage.getSkipData('s|3');
    assertTrue(d.introAvg < 150, `introAvg phải gần các mẫu THẬT (~90s), không bị outlier 600s kéo lệch — thực tế: ${d.introAvg}`);
});

test('learnSkip(): giới hạn tối đa 10 mẫu gần nhất (tự thích nghi nếu series đổi định dạng intro)', () => {
    const Storage = freshStorage();
    for (let i = 0; i < 15; i++) Storage.learnSkip('s|4', 0, 90 + i, 1400);
    const d = Storage.getSkipData('s|4');
    assertEqual(d.intros.length, 10, 'chỉ giữ tối đa 10 mẫu gần nhất');
});

run();
