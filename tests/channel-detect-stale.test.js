// tests/channel-detect-stale.test.js — test bug thật: window.ytInitialPlayerResponse
// không tự cập nhật sau SPA nav, khiến resolve() trả về kênh của video CŨ.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual } = require('./lib/tap');

suite('ChannelDetect — stale ytInitialPlayerResponse (channel-detect.js)');

function setupMocks() {
    global.customElements = { whenDefined: () => Promise.resolve() };
    global.document = { querySelector: () => null }; // không có DOM fallback trong test này — cô lập đúng phần fast-path
    return loadModule('channel-detect.js', 'ChannelDetect');
}

test('window.ytInitialPlayerResponse THUỘC VIDEO CŨ (chưa cập nhật sau SPA nav) → KHÔNG được tin dùng', async () => {
    global.window = {
        ytInitialPlayerResponse: {
            videoDetails: { videoId: 'OLD_VIDEO_ID', author: 'Kênh Cũ', channelId: 'UCold' },
        },
    };
    const ChannelDetect = setupMocks();
    // resolve() cho video MỚI — nhưng global vẫn còn trỏ tới video CŨ
    const result = await Promise.race([
        ChannelDetect.resolve('NEW_VIDEO_ID'),
        new Promise(resolve => setTimeout(() => resolve({ name: '', id: null, _timedOut: true }), 100)),
    ]);
    // Vì không có DOM fallback trong test này, kỳ vọng KHÔNG trả về "Kênh Cũ"
    // (nếu bug tồn tại, nó sẽ trả về Kênh Cũ ngay lập tức — sai)
    console.log('  → kết quả:', JSON.stringify(result));
    assertEqual(result.name === 'Kênh Cũ', false, 'TUYỆT ĐỐI không được trả về tên kênh của video CŨ khi videoId không khớp');
});

test('window.ytInitialPlayerResponse ĐÚNG video hiện tại → dùng bình thường (fast path)', async () => {
    global.window = {
        ytInitialPlayerResponse: {
            videoDetails: { videoId: 'MATCH_ID', author: 'Kênh Đúng', channelId: 'UCcorrect' },
        },
    };
    const ChannelDetect = setupMocks();
    const result = await ChannelDetect.resolve('MATCH_ID');
    assertEqual(result.name, 'Kênh Đúng', 'videoId khớp thì phải dùng fast path bình thường');
    assertEqual(result.id, 'UCcorrect');
});

run().then(() => process.exit(process.exitCode || 0));
