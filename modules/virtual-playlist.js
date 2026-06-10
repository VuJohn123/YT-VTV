// virtual-playlist.js - Playlist ảo gộp nhiều playlist của series

async function _fetchYTData(url) {
    try {
        const resp = await fetch(url);
        const html = await resp.text();
        const start = html.indexOf('var ytInitialData');
        if (start === -1) return null;
        const eqIdx = html.indexOf('=', start) + 1;
        let depth = 0, end = -1;
        for (let i = eqIdx; i < html.length; i++) {
            if      (html[i] === '{') depth++;
            else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        if (end === -1) return null;
        return JSON.parse(html.slice(eqIdx, end).trim());
    } catch(e) {
        warn('_fetchYTData error:', e);
        return null;
    }
}

async function fetchPlaylistsForSeries(seriesName) {
    const url  = `https://www.youtube.com/results?search_query=${encodeURIComponent(seriesName + ' playlist')}&sp=EgQQA1AB`;
    const json = await _fetchYTData(url);
    if (!json) return [];
    const playlists = [];
    try {
        const sections = json.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
        for (const sec of sections) {
            for (const item of sec.itemSectionRenderer?.contents ?? []) {
                const pr = item.playlistRenderer;
                if (pr) playlists.push({ title: pr.title?.simpleText || '', playlistId: pr.playlistId });
            }
        }
    } catch(e) {}
    return playlists;
}

async function buildVirtualPlaylist(seriesName) {
    const playlists  = await fetchPlaylistsForSeries(seriesName);
    const allVideos  = [];

    for (const pl of playlists) {
        const json = await _fetchYTData(`https://www.youtube.com/playlist?list=${pl.playlistId}`);
        if (!json) continue;
        try {
            const tabs = json.contents.twoColumnBrowseResultsRenderer.tabs;
            for (const tab of tabs) {
                const contents = tab.tabRenderer?.content?.sectionListRenderer?.contents;
                if (!contents) continue;
                for (const sec of contents) {
                    const videos = sec.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;
                    if (!videos) continue;
                    for (const vid of videos) {
                        const pvr = vid.playlistVideoRenderer;
                        if (pvr) allVideos.push({ title: pvr.title?.runs?.[0]?.text, videoId: pvr.videoId });
                    }
                }
            }
        } catch(e) {}
    }

    allVideos.sort((a, b) => (parseTitle(a.title)?.episode || 0) - (parseTitle(b.title)?.episode || 0));
    return allVideos;
}
