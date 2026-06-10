// missing-detector.js - Phát hiện lỗ hổng tập phim

function detectMissingEpisodes(list) {
    if (!list.length) return [];
    // Lọc các tập không phải phân đoạn (totalSeg <= 1) và có số tập hợp lệ
    const episodes = list
        .filter(e => e.episode && (e.totalSeg == null || e.totalSeg <= 1))
        .map(e => e.episode);
    if (episodes.length < 2) return [];

    episodes.sort((a, b) => a - b);
    const min = episodes[0];
    const max = episodes[episodes.length - 1];
    const epSet = new Set(episodes); // O(1) lookup thay vì includes()
    const missing = [];
    for (let i = min + 1; i < max; i++) {
        if (!epSet.has(i)) missing.push(i);
    }
    log('Missing episodes detected:', missing);
    return missing;
}
