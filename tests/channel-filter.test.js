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

run();
