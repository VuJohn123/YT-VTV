// virtual-playlist.js - Lấy toàn bộ video từ playlist (dùng cache search toàn cục, sửa lọc mùa)

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
    return playlists;
}

async function fetchVideosFromPlaylist(playlistId) {
    const videos = [];
    let continuation = null;
    let attempts = 0;
    const maxAttempts = 200;

    async function fetchContinuation(token) {
        const resp = await fetch('https://www.youtube.com/youtubei/v1/browse?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                context: { client: { clientName: 'WEB', clientVersion: '2.20250610.00.00' } },
                continuation: token
            })
        });
        return resp.json();
    }

    try {
        let url = `https://www.youtube.com/playlist?list=${playlistId}`;
        let resp = await fetch(url);
        let html = await resp.text();
        let m = html.match(/var ytInitialData\s*=\s*({.*?});/s);
        if (!m) return videos;
        let data = JSON.parse(m[1]);

        const extractVideos = (data) => {
            const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
            if (!tabs) return { videos: [], continuation: null };
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
            const continuations = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.continuations;
            if (continuations?.[0]?.nextContinuationData?.continuation) {
                return { videos, continuation: continuations[0].nextContinuationData.continuation };
            }
            return { videos, continuation: null };
        };

        let result = extractVideos(data);
        continuation = result.continuation;
        attempts++;

        while (continuation && attempts < maxAttempts) {
            const nextData = await fetchContinuation(continuation);
            if (!nextData) break;
            const onResponseActions = nextData?.onResponseReceivedActions;
            if (onResponseActions) {
                for (const action of onResponseActions) {
                    const items = action?.appendContinuationItemsAction?.continuationItems;
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
            continuation = null;
            if (onResponseActions) {
                for (const action of onResponseActions) {
                    const cont = action?.appendContinuationItemsAction?.continuation;
                    if (cont) continuation = cont;
                }
            }
            attempts++;
        }
    } catch(e) {
        warn('Error fetching playlist:', e);
    }
    log(`Fetched ${videos.length} videos from playlist ${playlistId}`);
    return videos;
}

async function buildVirtualPlaylist(seriesName) {
    const cacheKey = 'vtvUlt_virtual_' + seriesName.replace(/\s+/g, '_');
    const cached = GM_getValue(cacheKey, null);
    if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < 6 * 3600000) {
            log('Using cached virtual playlist for', seriesName);
            return data.videos;
        }
    }

    log('Building virtual playlist for', seriesName);
    const playlists = await fetchPlaylistsForSeries(seriesName);
    let allVideos = [];
    playlists.sort((a, b) => b.videoCount - a.videoCount);
    for (const pl of playlists) {
        const videos = await fetchVideosFromPlaylist(pl.playlistId);
        allVideos = allVideos.concat(videos);
    }
    // Loại bỏ trùng lặp
    const seen = new Set();
    const unique = [];
    for (const v of allVideos) {
        if (!seen.has(v.videoId)) {
            seen.add(v.videoId);
            unique.push(v);
        }
    }
    // Sắp xếp
    unique.sort((a, b) => {
        const pa = parseTitle(a.title);
        const pb = parseTitle(b.title);
        if (!pa.episode && !pb.episode) return 0;
        if (!pa.episode) return 1;
        if (!pb.episode) return -1;
        if (pa.episode !== pb.episode) return pa.episode - pb.episode;
        return (pa.segment || 0) - (pb.segment || 0);
    });
    GM_setValue(cacheKey, JSON.stringify({ videos: unique, timestamp: Date.now() }));
    return unique;
}