// tests/tv-mode.test.js — tv-mode.js CHƯA TỪNG có test nào (audit Production
// checklist — Debugging-Friendly/Stable: 1 module xử lý network reverse-
// engineered API mà không có test canh gác là 1 gap thật). Cover các path
// chính: pairing thành công/thất bại, connect() parse response, sendCommand
// tăng RID đúng lúc, xử lý phiên hết hạn (400), timeout field.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertTrue, assertFalse } = require('./lib/tap');

function setupMocks(responseQueue) {
    global.log = () => {}; global.warn = () => {};
    let idx = 0;
    const calls = [];
    global.GM_xmlhttpRequest = (opts) => {
        calls.push(opts);
        const next = responseQueue[Math.min(idx, responseQueue.length - 1)];
        idx++;
        if (next.type === 'error') opts.onerror(new Error('network error'));
        else if (next.type === 'timeout') opts.ontimeout();
        else opts.onload(next);
    };
    return calls;
}

suite('TvMode — Lounge API pairing/connect/sendCommand (tv-mode.js)');

test('pairWithCode(): mã không đúng 12 chữ số → báo lỗi rõ ràng, KHÔNG gọi network', async () => {
    const calls = setupMocks([]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');

    let threw = false, msg = '';
    try { await TvMode.pairWithCode('123'); } catch (e) { threw = true; msg = e.message; }

    assertTrue(threw, 'phải throw khi mã sai định dạng');
    assertTrue(msg.includes('12 chữ số'), 'thông báo lỗi phải nói rõ lý do (12 chữ số)');
    assertEqual(calls.length, 0, 'không được gọi network nếu mã đã sai định dạng ngay từ đầu (fail fast)');
});

test('pairWithCode(): chấp nhận mã có dấu cách/gạch ngang, tự strip trước khi validate', async () => {
    setupMocks([{ status: 200, responseText: JSON.stringify({ screen: { loungeToken: 'TOK', screenId: 'SID123', name: 'Samsung TV' } }) }]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');

    const info = await TvMode.pairWithCode('1234 5678-9012');
    assertEqual(info.screenId, 'SID123');
    assertEqual(info.name, 'Samsung TV');
});

test('pairWithCode(): status khác 200 → báo lỗi "không tìm thấy TV", không throw kiểu parse lỗi mù mờ', async () => {
    setupMocks([{ status: 404, responseText: '' }]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');

    let msg = '';
    try { await TvMode.pairWithCode('123456789012'); } catch (e) { msg = e.message; }
    assertTrue(msg.includes('Không tìm thấy TV'), 'lỗi phải rõ ràng, không phải stack trace kỹ thuật');
});

test('pairWithCode(): response 200 nhưng JSON hỏng (API đổi format) → báo lỗi RÕ nguyên nhân, không throw SyntaxError thô', async () => {
    setupMocks([{ status: 200, responseText: 'not json at all {{{' }]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');

    let msg = '';
    try { await TvMode.pairWithCode('123456789012'); } catch (e) { msg = e.message; }
    assertTrue(msg.includes('API có thể đã thay đổi'), 'phải phân biệt được lỗi PARSE (API đổi format) với lỗi mã sai — 2 loại lỗi rất khác nhau về nguyên nhân');
});

test('pairWithCode(): JSON hợp lệ nhưng thiếu loungeToken/screenId → báo lỗi rõ, không crash truy cập undefined', async () => {
    setupMocks([{ status: 200, responseText: JSON.stringify({ screen: {} }) }]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');

    let threw = false;
    try { await TvMode.pairWithCode('123456789012'); } catch (e) { threw = true; }
    assertTrue(threw);
});

test('connect(): chưa pairWithCode() → báo lỗi rõ ràng thay vì gửi request với loungeToken null', async () => {
    const calls = setupMocks([]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');

    let msg = '';
    try { await TvMode.connect(); } catch (e) { msg = e.message; }
    assertTrue(msg.includes('Chưa ghép nối'));
    assertEqual(calls.length, 0, 'không được gọi network nếu chưa pair — fail fast');
});

test('connect(): parse đúng SID từ response dạng length-prefixed chunks thật của Lounge API', async () => {
    setupMocks([
        { status: 200, responseText: JSON.stringify({ screen: { loungeToken: 'TOK', screenId: 'SID1', name: 'TV' } }) },
        // Response THẬT của bind endpoint không phải 1 JSON object đơn — là
        // chuỗi "length-prefixed chunks" chứa mảng ["c","<SID>","",8]. Test
        // với format gần với thật để không chỉ pass bằng mock giả tạo quá
        // đơn giản không phản ánh đúng parse logic.
        { status: 200, responseText: '135\n[[0,["c","AAAA-BBBB-SID-VALUE","",8]]\n' },
    ]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');

    await TvMode.pairWithCode('123456789012');
    const result = await TvMode.connect();

    assertTrue(result);
    assertTrue(TvMode.isConnected());
});

test('connect(): response không parse được SID (API đổi format hoàn toàn) → báo lỗi rõ, KHÔNG coi là connected', async () => {
    setupMocks([
        { status: 200, responseText: JSON.stringify({ screen: { loungeToken: 'TOK', screenId: 'SID1', name: 'TV' } }) },
        { status: 200, responseText: 'hoàn toàn không giống format cũ nữa' },
    ]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');

    await TvMode.pairWithCode('123456789012');
    let msg = '';
    try { await TvMode.connect(); } catch (e) { msg = e.message; }

    assertTrue(msg.includes('đổi format'), 'phải phân biệt rõ đây là lỗi PARSE do API đổi, không phải lỗi mạng thường');
    assertFalse(TvMode.isConnected(), 'không được coi là connected khi parse SID thất bại');
});

test('sendCommand(): chưa connect() → báo lỗi rõ, không gửi lệnh với SID null', async () => {
    const calls = setupMocks([]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');

    let msg = '';
    try { await TvMode.pause(); } catch (e) { msg = e.message; }
    assertTrue(msg.includes('Chưa kết nối'));
    assertEqual(calls.length, 0);
});

test('sendCommand(): message index luôn tăng dù RID không đổi (độc lập với nhau đúng theo spec Lounge)', async () => {
    const calls = setupMocks([
        { status: 200, responseText: JSON.stringify({ screen: { loungeToken: 'TOK', screenId: 'SID1', name: 'TV' } }) },
        { status: 200, responseText: '["c","SID-X","",8]' },
        { status: 200, responseText: '' }, // pause
        { status: 200, responseText: '' }, // resume
        { status: 200, responseText: '' }, // seekTo
    ]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');
    await TvMode.pairWithCode('123456789012');
    await TvMode.connect();

    await TvMode.pause();
    await TvMode.resume();
    await TvMode.seekTo(42);

    // 3 lệnh cuối cùng (bỏ qua 2 call đầu là pair+connect) — mỗi lệnh phải
    // có message index KHÁC NHAU (req0_, req1_, req2_) trong body gửi đi.
    const cmdCalls = calls.slice(2);
    const hasReq0 = cmdCalls[0].data.includes('req0_');
    const hasReq1 = cmdCalls[1].data.includes('req1_');
    const hasReq2 = cmdCalls[2].data.includes('req2_');
    assertTrue(hasReq0 && hasReq1 && hasReq2, 'mỗi lệnh liên tiếp phải dùng message index tăng dần (req0_, req1_, req2_...), không được lặp lại/không đổi');
});

test('sendCommand(): server trả 400 (Unknown SID — phiên hết hạn) → tự đánh dấu disconnected, báo lỗi rõ nguyên nhân', async () => {
    setupMocks([
        { status: 200, responseText: JSON.stringify({ screen: { loungeToken: 'TOK', screenId: 'SID1', name: 'TV' } }) },
        { status: 200, responseText: '["c","SID-X","",8]' },
        { status: 400, responseText: 'Unknown SID' },
    ]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');
    await TvMode.pairWithCode('123456789012');
    await TvMode.connect();
    assertTrue(TvMode.isConnected());

    let msg = '';
    try { await TvMode.pause(); } catch (e) { msg = e.message; }

    assertTrue(msg.includes('hết hạn'), 'phải phân biệt rõ đây là phiên hết hạn (cần ghép nối lại), không phải lỗi mạng chung chung');
    assertFalse(TvMode.isConnected(), 'phải tự đánh dấu disconnected — caller không nên tiếp tục gửi lệnh vào phiên đã chết');
});

test('sendCommand(): server trả status khác (500) → báo lỗi có kèm status code, không nuốt lỗi', async () => {
    setupMocks([
        { status: 200, responseText: JSON.stringify({ screen: { loungeToken: 'TOK', screenId: 'SID1', name: 'TV' } }) },
        { status: 200, responseText: '["c","SID-X","",8]' },
        { status: 500, responseText: 'Internal Server Error' },
    ]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');
    await TvMode.pairWithCode('123456789012');
    await TvMode.connect();

    let msg = '';
    try { await TvMode.pause(); } catch (e) { msg = e.message; }
    assertTrue(msg.includes('500'), 'thông báo lỗi nên kèm status code thật để dễ debug, không chỉ "lỗi chung chung"');
});

test('disconnect(): gửi tín hiệu terminate rồi dọn state, ngay cả khi request terminate thất bại (best-effort)', async () => {
    setupMocks([
        { status: 200, responseText: JSON.stringify({ screen: { loungeToken: 'TOK', screenId: 'SID1', name: 'TV' } }) },
        { status: 200, responseText: '["c","SID-X","",8]' },
        { type: 'error' }, // request terminate LỖI MẠNG
    ]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');
    await TvMode.pairWithCode('123456789012');
    await TvMode.connect();
    assertTrue(TvMode.isConnected());

    await TvMode.disconnect(); // không được throw dù request terminate lỗi

    assertFalse(TvMode.isConnected(), 'phải dọn state local dù request terminate thất bại (best-effort, xem comment trong tv-mode.js)');
});

// ── Network Handling audit (Production checklist) ──────────────────────────
test('_gmFetch() (dùng chung cho mọi request) PHẢI truyền field `timeout`', async () => {
    const calls = setupMocks([{ status: 200, responseText: JSON.stringify({ screen: { loungeToken: 'T', screenId: 'S', name: 'TV' } }) }]);
    const TvMode = loadModule('tv-mode.js', 'TvMode');
    await TvMode.pairWithCode('123456789012');

    assertEqual(calls.length, 1);
    assertEqual(typeof calls[0].timeout, 'number', 'field `timeout` phải có mặt — thiếu nó khiến ontimeout callback không bao giờ kích hoạt');
    assertTrue(calls[0].timeout > 0);
});

run().then(() => process.exit(process.exitCode || 0));
