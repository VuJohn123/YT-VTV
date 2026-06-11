// virtual-playlist.js - Lấy toàn bộ video từ playlist của series, sắp xếp đúng thứ tự

async function fetchPlaylistsForSeries(seriesName) {
    const query = `${seriesName} playlist`;
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgQQA1AB`;
    const resp = await fetch(url);
    const html = await resp.text();
    const m = html.match(/var ytInitialData\s*=\s*({.*?});/s);
    if (!m) return [];
    const json = JSON.parse(m[1]);
    const playlists = [];
    try {
        const sections = json.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
        for (const sec of sections) {
            if (sec.itemSectionRenderer) {
                for (const item of sec.itemSectionRenderer.contents) {
                    const pr = item.playlistRenderer;
                    if (pr) playlists.push({
                        title: pr.title?.simpleText || '',
                        playlistId: pr.playlistId,
                        videoCount: pr.videoCount || 0
                    });
                }
            }
        }
    } catch(e) {}
    log(`Found ${playlists.length} playlists for "${seriesName}"`);
    return playlists;
}

async function fetchVideosFromPlaylist(playlistId) {
    const videos = [];
    let nextPageToken = null;
    let attempts = 0;
    const maxAttempts = 10; // Tránh vòng lặp vô hạn
    do {
        try {
            let url = `https://www.youtube.com/playlist?list=${playlistId}`;
            if (nextPageToken) url += `&index=${nextPageToken}`;
            const resp = await fetch(url);
            const html = await resp.text();
            const m = html.match(/var ytInitialData\s*=\s*({.*?});/s);
            if (!m) break;
            const data = JSON.parse(m[1]);
            // Trích xuất video
            const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
            if (tabs) {
                for (const tab of tabs) {
                    const contents = tab?.tabRenderer?.content?.sectionListRenderer?.contents;
                    if (contents) {
                        for (const sec of contents) {
                            const items = sec?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;
                            if (items) {
                                for (const item of items) {
                                    const vr = item?.playlistVideoRenderer;
                                    if (vr && vr.videoId) {
                                        videos.push({
                                            title: vr.title?.runs?.[0]?.text || '',
                                            videoId: vr.videoId
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
            // Lấy continuation token
            const continuations = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.continuations;
            if (continuations?.[0]?.nextContinuationData?.continuation) {
                nextPageToken = continuations[0].nextContinuationData.continuation;
            } else {
                nextPageToken = null;
            }
            attempts++;
        } catch(e) {
            warn(`Error fetching playlist ${playlistId}:`, e);
            break;
        }
    } while (nextPageToken && attempts < maxAttempts);
    return videos;
}

async function buildVirtualPlaylist(seriesName) {
    // Kiểm tra cache trước (lưu trong storage)
    const cacheKey = 'vtvUlt_virtual_' + seriesName.replace(/\s+/g, '_');
    const cached = GM_getValue(cacheKey, null);
    if (cached) {
        const data = JSON.parse(cached);
        // Dùng cache trong 1 giờ
        if (Date.now() - data.timestamp < 3600000) {
            log('Using cached virtual playlist for', seriesName);
            return data.videos;
        }
    }

    log('Building virtual playlist for', seriesName);
    const playlists = await fetchPlaylistsForSeries(seriesName);
    let allVideos = [];
    // Lấy video từ từng playlist, ưu tiên playlist có nhiều video nhất (thường là playlist chính)
    playlists.sort((a, b) => b.videoCount - a.videoCount);
    for (const pl of playlists) {
        const videos = await fetchVideosFromPlaylist(pl.playlistId);
        log(`Fetched ${videos.length} videos from playlist: ${pl.title}`);
        allVideos = allVideos.concat(videos);
    }
    // Loại bỏ trùng lặp videoId
    const seen = new Set();
    const unique = [];
    for (const v of allVideos) {
        if (!seen.has(v.videoId)) {
            seen.add(v.videoId);
            unique.push(v);
        }
    }
    // Sắp xếp theo số tập và phân đoạn
    unique.sort((a, b) => {
        const pa = parseTitle(a.title);
        const pb = parseTitle(b.title);
        if (!pa.episode && !pb.episode) return 0;
        if (!pa.episode) return 1;
        if (!pb.episode) return -1;
        if (pa.episode !== pb.episode) return pa.episode - pb.episode;
        return (pa.segment || 0) - (pb.segment || 0);
    });
    log(`Virtual playlist built: ${unique.length} unique videos`);
    // Lưu cache
    GM_setValue(cacheKey, JSON.stringify({ videos: unique, timestamp: Date.now() }));
    return unique;
}