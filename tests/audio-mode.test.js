// tests/audio-mode.test.js — test heuristic audio-truyện + auto speed-bump
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertTrue, assertFalse, assertEqual } = require('./lib/tap');

suite('isAudioStoryContent — heuristic (utils.js)');

const isAudioStoryContent = loadModule('utils.js', 'isAudioStoryContent');

test('"[AUDIO TRUYỆN FULL] Ma Nữ Báo Thù" → nhận diện đúng', () => {
    assertTrue(isAudioStoryContent('[AUDIO TRUYỆN FULL] Ma Nữ Báo Thù'));
});
test('"Đọc truyện: Tây Du Ký - Chương 12" → nhận diện đúng', () => {
    assertTrue(isAudioStoryContent('Đọc truyện: Tây Du Ký - Chương 12'));
});
test('"Diễn đọc tiểu thuyết ngôn tình" → nhận diện đúng', () => {
    assertTrue(isAudioStoryContent('Diễn đọc tiểu thuyết ngôn tình'));
});
test('Phim VTV bình thường KHÔNG bị nhận nhầm', () => {
    assertFalse(isAudioStoryContent('Thương Ngày Nắng Về tập 31 [1/4]'));
});
test('MV nhạc KHÔNG bị nhận nhầm', () => {
    assertFalse(isAudioStoryContent('[Official MV] Thank You for Your Love - THANK YOU'));
});
test('Tiêu đề rỗng/null không throw, trả false', () => {
    assertFalse(isAudioStoryContent(''));
    assertFalse(isAudioStoryContent(null));
});

run();
