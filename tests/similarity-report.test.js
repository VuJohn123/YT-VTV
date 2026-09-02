// tests/similarity-report.test.js — SimilarityReport PHẢI mặc định là no-op
// tuyệt đối (0 network call) khi chưa cấu hình URL — đây là tính năng opt-in
// duy nhất gửi dữ liệu ra ngoài (xem cf-worker/README.md), nên bug ở đây
// nghiêm trọng hơn bình thường (gửi nhầm dữ liệu ra ngoài không xin phép).
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertTrue, assertFalse } = require('./lib/tap');

function setupMocks(storedUrl) {
    global.log = () => {}; global.warn = () => {};
    const store = { similarityReportUrl: storedUrl };
    global.Storage = {
        getGlobal: (k, d) => (k in store ? store[k] : d),
        setGlobal: (k, v) => { store[k] = v; },
    };
    return store;
}

suite('SimilarityReport — opt-in, mặc định no-op tuyệt đối (similarity-report.js)');

test('Chưa cấu hình URL (mặc định) → report() KHÔNG được gọi GM_xmlhttpRequest', () => {
    setupMocks(''); // rỗng = trạng thái mặc định thật sự (Storage.getGlobal('similarityReportUrl',''))
    let called = false;
    global.GM_xmlhttpRequest = () => { called = true; };

    const SimilarityReport = loadModule('similarity-report.js', 'SimilarityReport');
    SimilarityReport.report({ a: 'thương ngày nắng về', b: 'nắng về ngày thương', jaccard: 0.8, source: 'jaccard', matched: true });

    assertFalse(called, 'Mặc định KHÔNG cấu hình URL → tuyệt đối không được gửi request nào ra ngoài');
    assertFalse(SimilarityReport.isConfigured());
});

test('Đã cấu hình URL → report() gửi đúng payload qua GM_xmlhttpRequest', () => {
    setupMocks('https://vtv-similarity-report.example.workers.dev');
    let capturedCall = null;
    global.GM_xmlhttpRequest = (opts) => { capturedCall = opts; };

    const SimilarityReport = loadModule('similarity-report.js', 'SimilarityReport');
    assertTrue(SimilarityReport.isConfigured());

    SimilarityReport.report({ a: 'Thương Ngày Nắng Về', b: 'nắng về ngày thương', jaccard: 0.833, source: 'jaccard', matched: true });

    assertTrue(!!capturedCall, 'Phải gọi GM_xmlhttpRequest khi đã cấu hình URL');
    assertEqual(capturedCall.method, 'POST');
    assertEqual(capturedCall.url, 'https://vtv-similarity-report.example.workers.dev');
    // Network Handling audit — xem giải thích đầy đủ ở tests/sponsor-block.test.js
    assertEqual(typeof capturedCall.timeout, 'number', 'field `timeout` phải có mặt và là số — thiếu nó khiến request có thể treo vô thời hạn');
    assertTrue(capturedCall.timeout > 0);

    const payload = JSON.parse(capturedCall.data);
    assertEqual(payload.a, 'thương ngày nắng về', 'Tên series phải được lowercase trước khi gửi');
    assertEqual(payload.source, 'jaccard');
    assertEqual(payload.matched, true);
    assertFalse('videoId' in payload || 'seriesKey' in payload, 'KHÔNG được có bất kỳ định danh cá nhân nào trong payload (xem PRIVACY comment)');
});

test('configure() lưu/xoá URL qua Storage.setGlobal đúng key', () => {
    const store = setupMocks('');
    global.GM_xmlhttpRequest = () => {};

    const SimilarityReport = loadModule('similarity-report.js', 'SimilarityReport');
    SimilarityReport.configure('  https://foo.workers.dev  ');
    assertEqual(store.similarityReportUrl, 'https://foo.workers.dev', 'Phải tự trim khoảng trắng thừa');

    SimilarityReport.configure('');
    assertEqual(store.similarityReportUrl, '', 'Để trống phải tắt hẳn (không giữ URL cũ)');
});

// ── Validate URL trước khi lưu (No Exploitations / input validation audit) ─
test('configure(): URL hợp lệ (https://) → ok:true, lưu bình thường', () => {
    const store = setupMocks('');
    global.GM_xmlhttpRequest = () => {};
    const SimilarityReport = loadModule('similarity-report.js', 'SimilarityReport');

    const result = SimilarityReport.configure('https://worker.example.workers.dev');
    assertTrue(result.ok);
    assertEqual(store.similarityReportUrl, 'https://worker.example.workers.dev');
});

test('configure(): chuỗi rỗng → ok:true (tắt tính năng là hành động hợp lệ, không phải lỗi)', () => {
    const store = setupMocks('https://old.example.com');
    global.GM_xmlhttpRequest = () => {};
    const SimilarityReport = loadModule('similarity-report.js', 'SimilarityReport');

    const result = SimilarityReport.configure('');
    assertTrue(result.ok);
    assertEqual(store.similarityReportUrl, '');
});

test('configure(): URL thiếu scheme (gõ nhầm phổ biến) → ok:false, KHÔNG lưu, không phá URL cũ', () => {
    const store = setupMocks('https://old.example.com');
    global.GM_xmlhttpRequest = () => {};
    const SimilarityReport = loadModule('similarity-report.js', 'SimilarityReport');

    const result = SimilarityReport.configure('worker.example.workers.dev'); // thiếu "https://"
    assertFalse(result.ok);
    assertTrue(result.error.length > 0, 'phải có thông báo lỗi rõ ràng');
    assertEqual(store.similarityReportUrl, 'https://old.example.com', 'URL cũ phải giữ nguyên, không bị ghi đè bởi input sai');
});

test('configure(): URL http:// (không phải https://) → ok:false', () => {
    setupMocks('');
    global.GM_xmlhttpRequest = () => {};
    const SimilarityReport = loadModule('similarity-report.js', 'SimilarityReport');

    const result = SimilarityReport.configure('http://worker.example.com');
    assertFalse(result.ok);
    assertTrue(result.error.includes('https'), 'lỗi phải nói rõ lý do là thiếu https');
});

test('configure(): scheme khác lạ (javascript:, ftp:...) → ok:false, không lưu', () => {
    const store = setupMocks('');
    global.GM_xmlhttpRequest = () => {};
    const SimilarityReport = loadModule('similarity-report.js', 'SimilarityReport');

    const result = SimilarityReport.configure('javascript:alert(1)');
    assertFalse(result.ok);
    assertEqual(store.similarityReportUrl, '');
});

run().then(() => process.exit(process.exitCode || 0));
