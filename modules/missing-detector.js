function detectMissingEpisodes(list) {
    const eps = list.filter(e => e.episode && (!e.segment || e.segment === 1)).map(e => e.episode);
    if (eps.length < 2) return { episodes: [], segments: [] };
    eps.sort((a,b) => a-b);
    const min = eps[0], max = eps[eps.length-1];
    const missingEps = [];
    for (let i = min; i <= max; i++) if (!eps.includes(i)) missingEps.push(i);
    const missingSegs = suggestMissingSegments(list);
    return { episodes: missingEps, segments: missingSegs };
}