// tests/channel-preference.test.js — test ưu tiên tập cùng kênh khi có nhiều
// ứng viên hợp lệ (đều là VTV) cho cùng 1 số tập.
const { loadModule } = require('./lib/loadModule');
const { suite, test, run, assertEqual } = require('./lib/tap');

suite('EpisodeEngine — channel preference (episode-navigator.js)');

function setupMocks() {
    global.log = () => {}; global.warn = () => {};
    global.EventBus = { on() {}, emit() {} };
    global.Storage = {
        getEpisodeListCache: () => null, saveEpisodeListCache() {}, clearEpisodeListCache() {},
    };
    global.Search = {
        mkQuery: (base, ch) => ch ? `${base} ${ch}` : base,
        search: async () => [],
    };
    global.VirtualPlaylist = { build: async () => [], buildFromKnownPlaylist: async () => [] };
    global.SeriesLearner = { learn() {}, isLikelyMatch: () => false };
    global.isVTVChannel = (name) => /VTV|VFC/i.test(name || '');
    global.parseTitle = (title) => {
        const m = title.match(/tập\s*(\d+)(?:\s*\((\d+)\/(\d+)\))?/i);
        if (!m) return { series: title, season: null, episode: null, segment: null, totalSeg: null };
        return { series: 'Thương Ngày Nắng Về', season: null, episode: +m[1], segment: m[2] ? +m[2] : null, totalSeg: m[3] ? +m[3] : null };
    };
    global.compareVideoRecency = (a, b) => 0; // trung lập, để test tập trung vào channel-preference logic
    global.document = { querySelector: () => null };
    global.location = { href: 'https://www.youtube.com/watch?v=CURRENT', search: '?v=CURRENT' };
    global.URLSearchParams = require('url').URLSearchParams;
}

test('Case B (từ cache): ưu tiên tập cùng kênh hiện tại hơn tập khác kênh dù segment thấp hơn', async () => {
    setupMocks();
    const EpisodeEngine = loadModule('episode-navigator.js', 'EpisodeEngine');

    const info = { series: 'Thương Ngày Nắng Về', season: null, episode: 30, segment: null, totalSeg: null };
    const currentChannel = 'VTV Giải Trí Official';

    // 2 ứng viên cho tập 31: 1 từ kênh khác (VFC, segment thấp hơn) và 1 từ ĐÚNG kênh hiện tại
    const list = [
        { episode: 31, season: null, segment: 1, totalSeg: 4, channelName: 'VFC Official', url: 'u1', title: 'VFC ver' },
        { episode: 31, season: null, segment: 2, totalSeg: 4, channelName: 'VTV Giải Trí Official', url: 'u2', title: 'VTV ver' },
    ];

    const next = await EpisodeEngine.findNext(info, currentChannel, list);
    assertEqual(next.title, 'VTV ver', 'Phải chọn bản ĐÚNG KÊNH hiện tại dù segment cao hơn, thay vì bản kênh khác có segment thấp hơn');
});

run();
