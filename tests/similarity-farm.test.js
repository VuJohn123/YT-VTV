// tests/similarity-farm.test.js — Farm Mode: parse RSS feed thật (mẫu XML
// đúng format YouTube trả về), sampling không thiên lệch khi vượt cap, và
// whitelist add/remove/dedupe.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual, assertTrue, assertFalse } = require('./lib/tap');

function setupMocks(storeOverrides = {}) {
    global.log = () => {}; global.warn = () => {};
    const store = { similarityFarmWhitelist: '[]', similarityReportUrl: '', ...storeOverrides };
    global.Storage = {
        getGlobal: (k, d) => (k in store ? store[k] : d),
        setGlobal: (k, v) => { store[k] = v; },
    };
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

suite('SimilarityFarm — parse RSS thật + sampling + whitelist (similarity-farm.js)');

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
    // Không thiên lệch: phải KHÔNG PHẢI luôn là 800 phần tử ĐẦU (nếu sampling
    // đúng ngẫu nhiên, xác suất cực thấp mà kết quả trùng khớp y hệt dãy đầu).
    const isJustFirst800 = result.every((v, i) => v === i);
    assertFalse(isJustFirst800, 'không được luôn lấy N phần tử ĐẦU tiên theo thứ tự — phải xáo trộn ngẫu nhiên trước khi cắt');
});

test('addChannel()/getWhitelist()/removeChannel(): thêm, dedupe theo channelId, xoá đúng', () => {
    const store = setupMocks();
    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');

    assertTrue(SimilarityFarm.addChannel('VTV Giải Trí Official', 'UCvtv123'));
    assertEqual(SimilarityFarm.getWhitelist().length, 1);

    assertFalse(SimilarityFarm.addChannel('VTV Giải Trí Official (tên khác)', 'UCvtv123'), 'cùng channelId → không thêm trùng dù tên khác');
    assertEqual(SimilarityFarm.getWhitelist().length, 1, 'vẫn chỉ 1 kênh sau khi thử thêm trùng');

    SimilarityFarm.addChannel('Kênh Khác', 'UCkhac456');
    assertEqual(SimilarityFarm.getWhitelist().length, 2);

    SimilarityFarm.removeChannel('UCvtv123');
    const remaining = SimilarityFarm.getWhitelist();
    assertEqual(remaining.length, 1);
    assertEqual(remaining[0].channelId, 'UCkhac456');
});

test('run(): whitelist rỗng → trả lỗi rõ ràng, KHÔNG throw, KHÔNG gọi GM_xmlhttpRequest', async () => {
    setupMocks({ similarityReportUrl: 'https://worker.example.com' });
    let fetchCalled = false;
    global.GM_xmlhttpRequest = () => { fetchCalled = true; };

    const SimilarityFarm = loadModule('similarity-farm.js', 'SimilarityFarm');
    const result = await SimilarityFarm.run();

    assertFalse(result.ok);
    assertTrue(result.error.includes('Whitelist'), 'thông báo lỗi phải nói rõ nguyên nhân là whitelist rỗng');
    assertFalse(fetchCalled, 'không được gọi fetch gì khi whitelist rỗng');
});

test('run(): chưa cấu hình SimilarityReport URL → trả lỗi rõ ràng, không fetch RSS phí công', () => {
    const store = setupMocks({ similarityFarmWhitelist: JSON.stringify([{ name: 'X', channelId: 'UC1' }]) });
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

test('run(): 1 kênh 3 video → đúng C(3,2)=3 report được gửi, với đúng ngưỡng JACCARD_THRESHOLD thật', async () => {
    setupMocks({
        similarityFarmWhitelist: JSON.stringify([{ name: 'Kênh Test', channelId: 'UCtest' }]),
        similarityReportUrl: 'https://worker.example.com',
    });
    global.GM_xmlhttpRequest = (opts) => {
        opts.onload({ status: 200, responseText: SAMPLE_RSS });
    };
    global.SimilarityReport = { isConfigured: () => true, report: () => {} };
    global.EpisodeEngine = {
        _internal: {
            JACCARD_THRESHOLD: 0.5,
            _jaccardRaw: (a, b) => {
                // Giả lập đơn giản: "giống nhau" nếu chia sẻ từ đầu tiên.
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
    assertEqual(result.totalEntries, 3);
    assertEqual(result.totalPossiblePairs, 3, 'C(3,2) = 3 cặp');
    assertEqual(result.sent, 3);
    assertEqual(reported.length, 3, 'phải gọi SimilarityReport.report() đúng 3 lần');
    assertEqual(reported[0].source, 'jaccard');
});

run().then(() => process.exit(process.exitCode || 0));
