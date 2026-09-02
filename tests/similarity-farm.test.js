// tests/similarity-farm.test.js — Farm Mode: parse RSS feed thật (mẫu XML
// đúng format YouTube trả về), sampling không thiên lệch khi vượt cap, và
// whitelist = seed list VTV mặc định (VTV_KNOWN_CHANNELS, utils.js) + kênh
// user tự thêm/loại trừ — user KHÔNG cần tự thêm gì mới chạy farm được
// ngay (feedback thật: "tự nhiên lại phải thêm whitelist... chỉ cần là 1
// list các kênh VTV đã biết trước").
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertTrue, assertFalse } = require('./lib/tap');

const FAKE_SEEDS = [
    { id: 'UCseed1', name: 'VTV Giải Trí Official' },
    { id: 'UCseed2', name: 'VFC Official' },
];

function setupMocks(storeOverrides = {}) {
    global.log = () => {}; global.warn = () => {};
    const store = { similarityFarmWhitelist: '[]', similarityFarmExcludedSeeds: '[]', similarityReportUrl: '', ...storeOverrides };
    global.Storage = {
        getGlobal: (k, d) => (k in store ? store[k] : d),
        setGlobal: (k, v) => { store[k] = v; },
    };
    // Mock VTV_KNOWN_CHANNELS thay vì dùng danh sách thật của utils.js — test
    // module này độc lập với nội dung thật của seed list (nội dung thật đã
    // có test riêng ở tests/channel-filter.test.js), chỉ cần biết CƠ CHẾ
    // seed+exclude+user-added hoạt động đúng.
    global.VTV_KNOWN_CHANNELS = FAKE_SEEDS;
    return store;
}

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:AAA111</id>
    <yt:videoId>AAA111</yt:videoId>
    <title>Thương Ngày Nắng Về - Tập 47</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=AAA111"/>
    <media:group>
      <media:title>Thương Ngày Nắng Về - Tập 47</media:title>
      <media:description>Cháu dâu xúc động khi nhà chồng yêu thương &amp; quan tâm.</media:description>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:BBB222</id>
    <yt:videoId>BBB222</yt:videoId>
    <title>Thương Ngày Nắng Về - Tập 48</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=BBB222"/>
    <media:group>
      <media:title>Thương Ngày Nắng Về - Tập 48</media:title>
      <media:description><![CDATA[Bà Nga & Vân Vân đối đầu căng thẳng.]]></media:description>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:CCC333</id>
    <yt:videoId>CCC333</yt:videoId>
    <title>Về Nhà Đi Con - Tập 12</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=CCC333"/>
    <media:group>
      <media:title>Về Nhà Đi Con - Tập 12</media:title>
      <media:description>Ông Sơn lo lắng cho Thư.</media:description>
    </media:group>
  </entry>
</feed>`;

suite('SimilarityFarm — parse RSS + sampling + seed list VTV mặc định + run() (similarity-farm.js)');

test('_parseFeed(): parse đúng title/description từ RSS thật của YouTube, xử lý CDATA và entity escape', () => {
    setupMocks();
    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    const entries = SimilarityFarm._internal._parseFeed(SAMPLE_RSS);

    assertEqual(entries.length, 3, 'phải parse đúng 3 entry');
    assertEqual(entries[0].title, 'Thương Ngày Nắng Về - Tập 47');
    assertEqual(entries[0].description, 'Cháu dâu xúc động khi nhà chồng yêu thương & quan tâm.', 'phải unescape &amp; → &');
    assertEqual(entries[1].description, 'Bà Nga & Vân Vân đối đầu căng thẳng.', 'phải bóc được nội dung trong CDATA');
    assertEqual(entries[2].title, 'Về Nhà Đi Con - Tập 12');
});

test('_sampleDown(): không cắt bớt gì nếu mảng đã ≤ n', () => {
    setupMocks();
    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    const arr = [1, 2, 3];
    const result = SimilarityFarm._internal._sampleDown(arr, 10);
    assertEqual(result.length, 3);
});

test('_sampleDown(): cắt đúng xuống n phần tử khi mảng lớn hơn cap', () => {
    setupMocks();
    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    const arr = Array.from({ length: 1000 }, (_, i) => i);
    const result = SimilarityFarm._internal._sampleDown(arr, 800);
    assertEqual(result.length, 800, 'phải cắt đúng xuống đúng cap');
    const isJustFirst800 = result.every((v, i) => v === i);
    assertFalse(isJustFirst800, 'không được luôn lấy N phần tử ĐẦU tiên theo thứ tự — phải xáo trộn ngẫu nhiên trước khi cắt');
});

// (thu gọn còn 1 suite() duy nhất cho cả file — suite() reset danh sách
// test tích luỹ, gọi nhiều lần trong 1 file sẽ LÀM MẤT các test đã đăng ký
// trước đó, xem tests/lib/tap.js)

test('getWhitelist(): NGAY TỪ ĐẦU (chưa thêm gì) đã có sẵn toàn bộ seed list VTV — không phải rỗng', () => {
    setupMocks();
    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    const wl = SimilarityFarm.getWhitelist();

    assertEqual(wl.length, FAKE_SEEDS.length, 'whitelist mặc định phải chứa ĐÚNG toàn bộ seed list, không cần user thêm gì');
    assertTrue(wl.every(c => c.seed === true), 'mọi kênh trong whitelist mặc định phải được đánh dấu seed:true');
    assertTrue(wl.some(c => c.channelId === 'UCseed1'));
    assertTrue(wl.some(c => c.channelId === 'UCseed2'));
});

test('addChannel(): thêm kênh MỚI (không phải seed) → seed list giữ nguyên, kênh mới có seed:false', () => {
    setupMocks();
    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');

    assertTrue(SimilarityFarm.addChannel('Kênh User Tự Thêm', 'UCuser1'));
    const wl = SimilarityFarm.getWhitelist();
    assertEqual(wl.length, FAKE_SEEDS.length + 1, 'phải có thêm đúng 1 kênh, không mất seed nào');
    const added = wl.find(c => c.channelId === 'UCuser1');
    assertTrue(!!added);
    assertEqual(added.seed, false, 'kênh user tự thêm phải đánh dấu seed:false');
});

test('addChannel(): thêm trùng ID với 1 kênh SEED đã có sẵn → không thêm trùng (return false)', () => {
    setupMocks();
    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');

    assertFalse(SimilarityFarm.addChannel('Tên khác', 'UCseed1'), 'UCseed1 đã có sẵn trong seed list → không thêm trùng');
    assertEqual(SimilarityFarm.getWhitelist().length, FAKE_SEEDS.length, 'whitelist không phình ra thêm');
});

test('removeChannel(): loại 1 kênh SEED khỏi farm → biến mất khỏi whitelist NHƯNG không đụng gì tới VTV_KNOWN_CHANNELS gốc', () => {
    setupMocks();
    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');

    SimilarityFarm.removeChannel('UCseed1');
    const wl = SimilarityFarm.getWhitelist();
    assertEqual(wl.length, FAKE_SEEDS.length - 1, 'whitelist thực tế phải giảm 1');
    assertFalse(wl.some(c => c.channelId === 'UCseed1'));
    assertEqual(FAKE_SEEDS.length, 2, 'mảng seed gốc phải nguyên vẹn, không bị mutate');
});

test('addChannel(): thêm lại đúng ID của 1 seed đã bị loại trước đó → "un-exclude" (khôi phục), KHÔNG tạo bản ghi trùng', () => {
    setupMocks();
    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');

    SimilarityFarm.removeChannel('UCseed1');
    assertEqual(SimilarityFarm.getWhitelist().length, 1, 'sau khi loại, chỉ còn 1 kênh (UCseed2)');

    assertTrue(SimilarityFarm.addChannel('VTV Giải Trí Official', 'UCseed1'), 'thêm lại đúng ID seed đã loại → phải thành công (un-exclude)');
    const wl = SimilarityFarm.getWhitelist();
    assertEqual(wl.length, 2, 'phải trở lại đủ 2 kênh');
    const restored = wl.find(c => c.channelId === 'UCseed1');
    assertEqual(restored.seed, true, 'kênh được khôi phục vẫn phải là seed:true (không biến thành user-added trùng lặp)');
    assertEqual(wl.filter(c => c.channelId === 'UCseed1').length, 1);
});

test('removeChannel(): xoá kênh USER tự thêm → xoá thẳng, không ảnh hưởng seed list', () => {
    setupMocks();
    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');

    SimilarityFarm.addChannel('Kênh User', 'UCuser1');
    assertEqual(SimilarityFarm.getWhitelist().length, FAKE_SEEDS.length + 1);

    SimilarityFarm.removeChannel('UCuser1');
    const wl = SimilarityFarm.getWhitelist();
    assertEqual(wl.length, FAKE_SEEDS.length, 'trở lại đúng số seed ban đầu');
    assertTrue(wl.every(c => c.seed === true), 'toàn bộ còn lại đều phải là seed (không sót kênh user nào)');
});

test('run(): whitelist rỗng (đã loại trừ HẾT seed, không tự thêm gì) → trả lỗi rõ ràng, KHÔNG throw, KHÔNG gọi GM_xmlhttpRequest', async () => {
    setupMocks({ similarityReportUrl: 'https://worker.example.com' });
    let fetchCalled = false;
    global.GM_xmlhttpRequest = () => { fetchCalled = true; };

    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    SimilarityFarm.removeChannel('UCseed1');
    SimilarityFarm.removeChannel('UCseed2');
    assertEqual(SimilarityFarm.getWhitelist().length, 0, 'setup: whitelist phải thật sự rỗng trước khi test run()');

    const result = await SimilarityFarm.run();

    assertFalse(result.ok);
    assertTrue(result.error.includes('Whitelist'), 'thông báo lỗi phải nói rõ nguyên nhân là whitelist rỗng');
    assertFalse(fetchCalled, 'không được gọi fetch gì khi whitelist rỗng');
});

test('run(): chưa cấu hình SimilarityReport URL → trả lỗi rõ ràng, không fetch RSS phí công (dù seed list mặc định vẫn có sẵn)', () => {
    setupMocks(); // seed list mặc định có sẵn ngay, KHÔNG cần similarityFarmWhitelist
    let fetchCalled = false;
    global.GM_xmlhttpRequest = () => { fetchCalled = true; };
    global.EpisodeEngine = { _internal: { _jaccardRaw: () => ({ score: 0 }), JACCARD_THRESHOLD: 0.5 } };
    global.SimilarityReport = { isConfigured: () => false, report: () => {} };

    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    return SimilarityFarm.run().then((result) => {
        assertFalse(result.ok);
        assertTrue(result.error.includes('Report'), 'thông báo lỗi phải nói rõ nguyên nhân là chưa cấu hình report URL');
        assertFalse(fetchCalled, 'không đáng tốn request RSS nếu cuối cùng không gửi report được');
    });
});

test('run(): dùng NGAY seed list mặc định (không thêm gì) → farm cả 2 kênh seed, đúng tổng số cặp và ngưỡng JACCARD_THRESHOLD thật', async () => {
    setupMocks({ similarityReportUrl: 'https://worker.example.com' }); // KHÔNG set similarityFarmWhitelist — đúng tình huống thật của user mới cài, chưa thêm gì
    global.GM_xmlhttpRequest = (opts) => {
        opts.onload({ status: 200, responseText: SAMPLE_RSS }); // cả 2 kênh trả về CÙNG 3 video mẫu cho đơn giản
    };
    global.SimilarityReport = { isConfigured: () => true, report: () => {} };
    global.EpisodeEngine = {
        _internal: {
            JACCARD_THRESHOLD: 0.5,
            _jaccardRaw: (a, b) => {
                const same = a.split(' ')[0] === b.split(' ')[0];
                return { score: same ? 0.9 : 0.1, sizeA: 3, sizeB: 3, intersection: same ? 3 : 0, union: 3 };
            },
        },
    };
    const reported = [];
    global.SimilarityReport.report = (d) => reported.push(d);

    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    const result = await SimilarityFarm.run();

    assertTrue(result.ok);
    assertEqual(result.channelsProcessed, 2, 'phải tự động farm CẢ 2 kênh seed mặc định, không cần user thêm gì');
    assertEqual(result.totalEntries, 6, '2 kênh × 3 video/kênh (mock)');
    assertEqual(result.totalPossiblePairs, 6, '2 kênh × C(3,2)=3 cặp/kênh = 6');
    assertEqual(result.sent, 6);
    assertEqual(reported.length, 6);
});

// ── Bug thật user gặp (ảnh chụp): "Farm hoàn tất! Video tổng cộng: 0" cho
// CẢ 6/6 kênh — trước đây code coi đây là ok:true (thành công) dù rõ ràng
// bất thường (không thể trùng hợp cả 6 kênh cùng lúc không có video nào).
// Root cause thật của TẠI SAO fetch trả 0 (mạng/CORS/RSS đổi format...)
// KHÔNG xác nhận được từ môi trường test (cần trình duyệt thật) — test này
// chỉ xác nhận phần chắc chắn sửa được: không còn báo "thành công" giả khi
// mọi kênh đều 0 video.

test('preview(): TẤT CẢ kênh đều trả về 0 video → đánh dấu likelyFetchFailure:true, KHÔNG coi là bình thường', async () => {
    setupMocks();
    global.GM_xmlhttpRequest = (opts) => {
        opts.onload({ status: 200, responseText: '<feed></feed>' }); // response "hợp lệ" (status 2xx) nhưng không có <entry> nào — mô phỏng đúng bug thật
    };

    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    const pre = await SimilarityFarm.preview();

    assertEqual(pre.channels, FAKE_SEEDS.length);
    assertEqual(pre.totalEntries, 0);
    assertTrue(pre.likelyFetchFailure, 'toàn bộ kênh 0 video → phải đánh dấu rõ đây là dấu hiệu lỗi, không phải kết quả bình thường');
});

test('preview(): CHỈ 1 trong nhiều kênh trả về 0 video (kênh khác vẫn có) → KHÔNG đánh dấu likelyFetchFailure (đây là tình huống bình thường)', async () => {
    setupMocks();
    let callCount = 0;
    global.GM_xmlhttpRequest = (opts) => {
        callCount++;
        // Kênh đầu tiên gọi tới: 0 video (có thể kênh mới, ít video). Kênh
        // thứ hai: có video bình thường. Đây LÀ tình huống hợp lệ, không
        // phải bug — không nên bị nhầm với case "toàn bộ đều 0".
        opts.onload(callCount === 1
            ? { status: 200, responseText: '<feed></feed>' }
            : { status: 200, responseText: SAMPLE_RSS });
    };

    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    const pre = await SimilarityFarm.preview();

    assertFalse(pre.likelyFetchFailure, '1/2 kênh có video → KHÔNG được coi là lỗi, đây là tình huống bình thường (1 kênh ít/không có video gần đây)');
    assertTrue(pre.totalEntries > 0);
});

test('run(): TẤT CẢ kênh đều trả về 0 video → trả ok:false với thông báo lỗi rõ ràng, KHÔNG báo "hoàn tất" giả (đúng bug user gặp)', async () => {
    setupMocks({ similarityReportUrl: 'https://worker.example.com' });
    global.GM_xmlhttpRequest = (opts) => {
        opts.onload({ status: 200, responseText: '<feed></feed>' });
    };
    global.EpisodeEngine = { _internal: { _jaccardRaw: () => ({ score: 0 }), JACCARD_THRESHOLD: 0.5 } };
    let reportCalled = false;
    global.SimilarityReport = { isConfigured: () => true, report: () => { reportCalled = true; } };

    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    const result = await SimilarityFarm.run();

    assertFalse(result.ok, 'KHÔNG được báo ok:true khi toàn bộ kênh đều 0 video — đây chính là bug user gặp qua ảnh chụp');
    assertTrue(result.error.length > 0, 'phải có thông báo lỗi cho user biết, không phải âm thầm im lặng');
    assertFalse(reportCalled, 'không có gì để report khi 0 video — không được gọi SimilarityReport.report() vô ích');
});

test('_fetchFeed() PHẢI truyền field `timeout` cho GM_xmlhttpRequest (Network Handling audit — xem tests/sponsor-block.test.js)', async () => {
    setupMocks({ similarityReportUrl: 'https://worker.example.com' });
    let capturedOpts = null;
    global.GM_xmlhttpRequest = (opts) => {
        capturedOpts = opts;
        opts.onload({ status: 200, responseText: SAMPLE_RSS });
    };

    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    await SimilarityFarm.preview();

    assertTrue(!!capturedOpts, 'setup: GM_xmlhttpRequest phải được gọi ít nhất 1 lần');
    assertEqual(typeof capturedOpts.timeout, 'number', 'field `timeout` phải có mặt và là số — thiếu nó khiến request có thể treo vô thời hạn');
    assertTrue(capturedOpts.timeout > 0);
});

// ── Retry logic (Well-Intelligent audit) ────────────────────────────────────
// _fetchFeed() phải PHÂN BIỆT lỗi transient (đáng retry) với lỗi thật (không
// đáng retry) — retry mù mọi loại lỗi vừa lãng phí thời gian vừa không "thông
// minh". Test dùng biến đếm số lần gọi thay vì response queue tĩnh (setupMocks
// trong file này chỉ hỗ trợ 1 response cố định), vì cần hành vi KHÁC NHAU giữa
// lần gọi 1 và lần gọi 2 cho cùng 1 kênh.

test('_fetchFeed(): lỗi mạng ở lần đầu, THÀNH CÔNG ở lần retry → phải trả về entries của lần retry (không bỏ cuộc sau 1 lần)', async () => {
    setupMocks({ similarityReportUrl: 'https://worker.example.com' });
    let callCount = 0;
    global.GM_xmlhttpRequest = (opts) => {
        callCount++;
        if (callCount === 1) opts.onerror(new Error('network down'));
        else opts.onload({ status: 200, responseText: SAMPLE_RSS });
    };

    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    // Chỉ có 1 kênh trong whitelist test để đếm số lần gọi chính xác — dùng
    // removeChannel bớt 1 seed, addChannel thêm đúng 1 kênh cần test.
    SimilarityFarm.removeChannel('UCseed2');
    const pre = await SimilarityFarm.preview();

    assertEqual(callCount, 2, 'phải gọi network đúng 2 lần: lần đầu lỗi + 1 lần retry (không phải bỏ cuộc ngay, cũng không phải retry vô hạn)');
    assertEqual(pre.totalEntries, 3, 'lần retry thành công phải trả về đúng 3 video từ SAMPLE_RSS, không phải mảng rỗng của lần đầu');
});

test('_fetchFeed(): status 4xx (lỗi phía request, VD channel ID sai) → KHÔNG retry, chỉ gọi network đúng 1 lần', async () => {
    setupMocks({ similarityReportUrl: 'https://worker.example.com' });
    let callCount = 0;
    global.GM_xmlhttpRequest = (opts) => {
        callCount++;
        opts.onload({ status: 404, responseText: 'not found' });
    };

    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    SimilarityFarm.removeChannel('UCseed2');
    await SimilarityFarm.preview();

    assertEqual(callCount, 1, '4xx là lỗi phía request (không phải server tạm quá tải) — retry vô ích vì sẽ lỗi y hệt, KHÔNG được retry');
});

test('_fetchFeed(): status 5xx (server tạm quá tải) → CÓ retry (khác 4xx)', async () => {
    setupMocks({ similarityReportUrl: 'https://worker.example.com' });
    let callCount = 0;
    global.GM_xmlhttpRequest = (opts) => {
        callCount++;
        opts.onload({ status: 503, responseText: 'service unavailable' });
    };

    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    SimilarityFarm.removeChannel('UCseed2');
    await SimilarityFarm.preview();

    assertEqual(callCount, 2, '5xx là lỗi server tạm thời — ĐÁNG retry (khác 4xx), phải gọi đúng 2 lần');
});

test('_fetchFeed(): 2xx nhưng parse ra 0 entry → KHÔNG retry (khác lỗi mạng/5xx — nhiều khả năng là lỗi định dạng thật, retry vô ích)', async () => {
    setupMocks({ similarityReportUrl: 'https://worker.example.com' });
    let callCount = 0;
    global.GM_xmlhttpRequest = (opts) => {
        callCount++;
        opts.onload({ status: 200, responseText: '<feed></feed>' });
    };

    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    SimilarityFarm.removeChannel('UCseed2');
    await SimilarityFarm.preview();

    assertEqual(callCount, 1, '2xx-nhưng-0-entry KHÔNG được coi là transient — retry sẽ chỉ lãng phí thời gian nếu response luôn vậy (API đổi format thật)');
});

test('_fetchFeed(): lỗi CẢ 2 lần (lần đầu + lần retry) → trả về mảng rỗng, không throw, không retry lần 3', async () => {
    setupMocks({ similarityReportUrl: 'https://worker.example.com' });
    let callCount = 0;
    global.GM_xmlhttpRequest = (opts) => {
        callCount++;
        opts.ontimeout();
    };

    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    SimilarityFarm.removeChannel('UCseed2');
    const pre = await SimilarityFarm.preview();

    assertEqual(callCount, 2, 'đúng 2 lần (1 gốc + 1 retry), KHÔNG retry thêm lần 3 dù vẫn lỗi — tránh vòng lặp retry vô hạn');
    assertEqual(pre.totalEntries, 0);
    assertTrue(pre.likelyFetchFailure, 'lỗi cả 2 lần cho kênh duy nhất → vẫn phải đánh dấu likelyFetchFailure đúng như thiết kế');
});

run().then(() => process.exit(process.exitCode || 0));
