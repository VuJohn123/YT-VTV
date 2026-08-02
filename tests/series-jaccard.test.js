// tests/series-jaccard.test.js — test bag-of-words similarity mới thêm vào
// _seriesMatch (episode-navigator.js), bắt các case mà substring/prefix cũ
// bó tay (đảo từ, dấu câu khác nhau) mà KHÔNG gây false-positive.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertTrue, assertFalse } = require('./lib/tap');

function setupMocks() {
    global.log = () => {}; global.warn = () => {};
    global.Storage = { getEpisodeListCache: () => null, saveEpisodeListCache() {}, clearEpisodeListCache() {} };
    global.Search = { mkQuery: (b) => b, search: async () => [] };
    global.VirtualPlaylist = { build: async () => [], buildFromKnownPlaylist: async () => [] };
    global.SeriesLearner = { learn() {}, confidenceScore: () => 0 };
    global.isVTVChannel = () => true;
    global.parseTitle = () => ({});
    global.compareVideoRecency = () => 0;
    global.document = { querySelector: () => null };
    global.location = { href: '', search: '' };
    global.URLSearchParams = require('url').URLSearchParams;
}

suite('EpisodeEngine — Jaccard series similarity (episode-navigator.js)');

setupMocks();
const EpisodeEngine = loadModule('episode-navigator.js', 'EpisodeEngine', global);
const { _seriesMatch, _jaccardSimilarity } = EpisodeEngine._internal;

test('Đảo thứ tự từ vẫn nhận diện đúng (substring/prefix cũ sẽ bó tay case này)', () => {
    const parsed = { episode: 5, series: 'Nắng Về Ngày Thương' }; // đảo lộn thứ tự
    const info   = { series: 'Thương Ngày Nắng Về' };
    assertTrue(_seriesMatch(parsed, info), 'Cùng bộ từ, chỉ khác thứ tự — phải nhận ra là cùng series');
});

test('Series hoàn toàn khác nhau KHÔNG được nhận nhầm', () => {
    const parsed = { episode: 5, series: 'Hành Trình Công Lý' };
    const info   = { series: 'Thương Ngày Nắng Về' };
    assertFalse(_seriesMatch(parsed, info), 'Series khác hẳn không được match');
});

test('Tên series ngắn (1 từ) không dùng Jaccard (tránh false-positive dễ dàng)', () => {
    assertEqual = require('./lib/tap').assertEqual;
    const sim = _jaccardSimilarity('Kiều', 'Khanh');
    assertEqual(sim, 0, 'Tên 1 từ phải trả về 0 (dưới MIN_TOKENS), không tính Jaccard');
});

test('Vẫn hoạt động đúng cho case dễ (giống hệt nhau)', () => {
    const parsed = { episode: 5, series: 'Thương Ngày Nắng Về' };
    const info   = { series: 'Thương Ngày Nắng Về' };
    assertTrue(_seriesMatch(parsed, info));
});

run();
