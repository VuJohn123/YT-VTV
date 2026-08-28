// tests/channel-filter.test.js — test isVTVChannel() dùng để chặn ứng viên
// "tập tiếp theo" từ kênh sai (root cause của bug "bị kéo sang kênh lạ")
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertTrue, assertFalse } = require('./lib/tap');

suite('isVTVChannel — channel filtering (utils.js)');

const utils = loadModule('utils.js', 'isVTVChannel');
// utils.js không có wrapper IIFE — các hàm/const đều ở top-level, nên
// loadModule dùng exportedName='isVTVChannel' chỉ lấy đúng hàm cần test.
const isVTVChannel = utils;

test('Kênh chính thức "VTV Giải Trí Official" (regex match) được chấp nhận', () => {
    assertTrue(isVTVChannel('VTV Giải Trí Official', 'UCsomeUnknownId'));
});

test('Kênh "VFC Official" (regex match) được chấp nhận', () => {
    assertTrue(isVTVChannel('VFC Official', 'UCanotherUnknownId'));
});

test('Kênh lạ "J G" (kịch bản bug thật đã gặp — kênh đọc audio) BỊ CHẶN', () => {
    assertFalse(isVTVChannel('J G', 'UCJGaudiochannel'));
});

test('Kênh lạ bất kỳ không khớp pattern nào cũng bị chặn', () => {
    assertFalse(isVTVChannel('Kênh Reup Phim Lậu', 'UCxyz'));
});

// ── Channel ID whitelist (VTV_KNOWN_CHANNELS/VTV_CHANNEL_IDS) ─────────────
// Bug thật đã fix: "VTV Giải Trí Official" và "VFC Official" — 2 kênh QUAN
// TRỌNG NHẤT với toàn bộ script — trước đây chỉ được nhận diện qua regex
// TÊN (yếu hơn, tên hiển thị đổi được), KHÔNG có trong whitelist ID (mạnh
// hơn, ID không đổi được). Test xác nhận: dù tên hiển thị đổi thành thứ
// KHÔNG khớp regex nào, vẫn phải được chấp nhận nhờ đúng channel ID thật.
const VTV_KNOWN_CHANNELS = loadModule('utils.js', 'VTV_KNOWN_CHANNELS');

test('ID thật của "VTV Giải Trí Official" phải nằm trong whitelist ID (không chỉ regex tên)', () => {
    const entry = VTV_KNOWN_CHANNELS.find(c => c.name === 'VTV Giải Trí Official');
    assertTrue(!!entry, 'phải có mặt trong VTV_KNOWN_CHANNELS');
    // Dù tên hiển thị đổi thành thứ KHÔNG khớp bất kỳ regex nào — vẫn phải
    // pass nhờ đúng ID (lớp xác thực mạnh hơn tên).
    assertTrue(isVTVChannel('Tên Kênh Đã Đổi Hoàn Toàn Không Liên Quan', entry.id));
});

test('ID thật của "VFC Official" phải nằm trong whitelist ID (không chỉ regex tên)', () => {
    const entry = VTV_KNOWN_CHANNELS.find(c => c.name === 'VFC Official');
    assertTrue(!!entry, 'phải có mặt trong VTV_KNOWN_CHANNELS');
    assertTrue(isVTVChannel('Tên Kênh Đã Đổi Hoàn Toàn Không Liên Quan', entry.id));
});

run();
