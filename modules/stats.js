function updateSeriesStats(seriesKey, duration) {
    const stats = GM_getValue('vtvUlt_stats_' + seriesKey, { totalTime: 0, episodes: {} });
    stats.totalTime += duration || 0;
    if (parsedInfo?.episode) {
        if (!stats.episodes[parsedInfo.episode]) stats.episodes[parsedInfo.episode] = 0;
        stats.episodes[parsedInfo.episode] += duration || 0;
    }
    GM_setValue('vtvUlt_stats_' + seriesKey, stats);
}
function getProgress(seriesKey, totalEpisodes) {
    const stats = GM_getValue('vtvUlt_stats_' + seriesKey, { totalTime: 0, episodes: {} });
    const watched = Object.keys(stats.episodes).length;
    if (totalEpisodes) return { watched, total: totalEpisodes, percent: Math.round(watched / totalEpisodes * 100) };
    return { watched, total: '?', percent: 0 };
}