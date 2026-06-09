// virtual-playlist.js - Playlist ảo gộp nhiều playlist của series
async function fetchPlaylistsForSeries(seriesName) {
    const query = `${seriesName} playlist`;
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgQQA1AB`;
    const resp = await fetch(url);
    const html = await resp.text();
    const match = html.match(/var ytInitialData\s*=\s*({.*?});/s);
    if (!match) return [];
    const json = JSON.parse(match[1]);
    const playlists = [];
    try {
        const sections = json.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
        for (const sec of sections) {
            if (sec.itemSectionRenderer) {
                for (const item of sec.itemSectionRenderer.contents) {
                    const pr = item.playlistRenderer;
                    if (pr) playlists.push({ title: pr.title?.simpleText || '', playlistId: pr.playlistId });
                }
            }
        }
    } catch(e) {}
    return playlists;
}
async function buildVirtualPlaylist(seriesName) {
    const playlists = await fetchPlaylistsForSeries(seriesName);
    let allVideos = [];
    for (const pl of playlists) {
        const resp = await fetch(`https://www.youtube.com/playlist?list=${pl.playlistId}`);
        const html = await resp.text();
        const m = html.match(/var ytInitialData\s*=\s*({.*?});/s);
        if (!m) continue;
        const data = JSON.parse(m[1]);
        try {
            const tabs = data.contents.twoColumnBrowseResultsRenderer.tabs;
            for (const tab of tabs) {
                if (tab.tabRenderer?.content?.sectionListRenderer?.contents) {
                    for (const sec of tab.tabRenderer.content.sectionListRenderer.contents) {
                        if (sec.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer) {
                            const videos = sec.itemSectionRenderer.contents[0].playlistVideoListRenderer.contents;
                            for (const vid of videos) {
                                if (vid.playlistVideoRenderer) {
                                    allVideos.push({ title: vid.playlistVideoRenderer.title?.runs?.[0]?.text, videoId: vid.playlistVideoRenderer.videoId });
                                }
                            }
                        }
                    }
                }
            }
        } catch(e) {}
    }
    allVideos.sort((a, b) => (parseTitle(a.title)?.episode||0) - (parseTitle(b.title)?.episode||0));
    return allVideos;
}