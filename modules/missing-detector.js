// missing-detector.js - Phát hiện lỗ hổng tập phim

function detectMissingEpisodes(list) {
    if (!list.length) return [];
    const episodes = list.filter(e => e.episode && !e.segment).map(e => e.episode);
    if (episodes.length < 2) return [];
    episodes.sort((a,b) => a-b);
    const min = episodes[0];
    const max = episodes[episodes.length - 1];
    const missing = [];
    for (let i = min; i <= max; i++) {
        if (!episodes.includes(i)) missing.push(i);
    }
    log('Missing episodes detected:', missing);
    return missing;
}