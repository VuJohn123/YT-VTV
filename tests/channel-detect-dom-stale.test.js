// tests/channel-detect-dom-stale.test.js — bug thật KHÁC (mới phát hiện,
// khác bug ytInitialPlayerResponse ở channel-detect-stale.test.js): DOM
// fallback (_fromDOM(), đọc ytd-video-owner-renderer) trước đây được tin
// NGAY LẬP TỨC ở lần đọc đầu tiên — nếu bắt trúng "chốc lát" DOM còn hiển
// thị nội dung video CŨ trước khi Polymer re-render xong sau SPA nav (đã
// research: đây là pattern chung đã xác nhận của YouTube — DOM metadata lag
// behind navigation), sẽ CACHE VĨNH VIỄN sai tên kênh cho videoId MỚI —
// đúng triệu chứng "thỉnh thoảng mắc kẹt sau SPA nav, không detect được
// kênh khác" mà user báo.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual } = require('./lib/tap');

suite('ChannelDetect — DOM fallback lag sau SPA nav (channel-detect.js)');

test('DOM đọc lần 1 = kênh CŨ (còn lag), lần 2 = kênh MỚI (đã re-render xong) → phải trả về kênh MỚI, không cache nhầm kênh cũ', async () => {
    global.customElements = { whenDefined: () => Promise.resolve() };
    global.window = {}; // không có ytInitialPlayerResponse — buộc rơi hẳn vào nhánh DOM fallback

    let domReadCount = 0;
    global.document = {
        querySelector: (sel) => {
            if (sel !== 'ytd-video-owner-renderer') return null;
            domReadCount++;
            // Lần đọc ĐẦU TIÊN mô phỏng đúng "chốc lát" DOM còn stale (kênh
            // CŨ) — lần đọc THỨ HAI trở đi mô phỏng Polymer đã re-render
            // xong, DOM đã đúng kênh MỚI.
            const isStale = domReadCount === 1;
            return {
                shadowRoot: null,
                querySelector: (innerSel) => {
                    if (innerSel !== '#channel-name a') return null;
                    return {
                        textContent: isStale ? 'Kênh Cũ (còn lag)' : 'Kênh Mới Đúng',
                        getAttribute: () => (isStale ? '/channel/UCold' : '/channel/UCnew'),
                    };
                },
            };
        },
    };

    const ChannelDetect = loadModule('channel-detect.js', 'ChannelDetect');
    const result = await ChannelDetect.resolve('NEW_VIDEO_ID');

    assertEqual(domReadCount >= 2, true, 'Phải đọc DOM ít nhất 2 lần trước khi chấp nhận kết quả (xác nhận ổn định)');
    assertEqual(result.name, 'Kênh Mới Đúng', 'Phải trả về kênh MỚI (đã ổn định), TUYỆT ĐỐI không phải "Kênh Cũ (còn lag)" từ lần đọc đầu tiên');
    assertEqual(result.id, 'UCnew');
});

test('DOM ổn định NGAY từ lần đọc đầu (không lag) → vẫn đúng, chỉ chậm thêm 1 tick retry (~300ms) so với trước', async () => {
    global.customElements = { whenDefined: () => Promise.resolve() };
    global.window = {};

    let domReadCount = 0;
    global.document = {
        querySelector: (sel) => {
            if (sel !== 'ytd-video-owner-renderer') return null;
            domReadCount++;
            return {
                shadowRoot: null,
                querySelector: (innerSel) => (innerSel === '#channel-name a'
                    ? { textContent: 'VTV Giải Trí Official', getAttribute: () => '/channel/UCvtv' }
                    : null),
            };
        },
    };

    const ChannelDetect = loadModule('channel-detect.js', 'ChannelDetect');
    const result = await ChannelDetect.resolve('STABLE_VIDEO_ID');

    assertEqual(result.name, 'VTV Giải Trí Official', 'Kết quả cuối cùng vẫn phải đúng khi DOM ổn định ngay từ đầu');
    assertEqual(result.id, 'UCvtv');
});

run().then(() => process.exit(process.exitCode || 0));
