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

test('saveSuggestedIntro(): không ghi đè introAvg thật đã có (≥3 lần user tự skip)', () => {
    const Storage = freshStorage();
    Storage.learnSkip('s|1', 1, 92, 1400);
    Storage.learnSkip('s|1', 2, 90, 1400);
    Storage.learnSkip('s|1', 3, 88, 1400);
    const before = Storage.getSkipData('s|1').introAvg;
    Storage.saveSuggestedIntro('s|1', 300);
    const after = Storage.getSkipData('s|1');
    assertEqual(after.introAvg, before, 'introAvg thật không được đụng vào');
    assertEqual(after.introSuggested, undefined, 'không thêm introSuggested khi đã có introAvg thật');
});

run();
