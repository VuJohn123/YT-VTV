// missing-detector.js - Phát hiện tập và phân đoạn bị thiếu
function detectMissingEpisodes(list) {
    // Phát hiện thiếu tập (chỉ xét tập không có segment hoặc segment=1)
    const eps = list.filter(e => e.episode && (!e.segment || e.segment === 1)).map(e => e.episode);
    if (eps.length < 2) return [];
    eps.sort((a,b) => a-b);
    const min = eps[0], max = eps[eps.length-1];
    const missingEps = [];
    for (let i = min; i <= max; i++) if (!eps.includes(i)) missingEps.push(i);

    // Phát hiện thiếu phân đoạn trong cùng tập
    const missingSegs = suggestMissingSegments(list);
    return { episodes: missingEps, segments: missingSegs };
}