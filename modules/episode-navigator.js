// episode-navigator.js - Tìm tập tiếp theo, trước đó, danh sách (tối ưu merge virtual playlist)
const MAX_EPISODES_IN_LIST = 10;

async function findNext(info, channel) {
    const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
    const partStr = info.season ? ` - P${info.season}` : '';

    // Nếu còn phân đoạn trong cùng tập → tìm segment tiếp theo
    if (info.segment && info.totalSeg && info.segment < info.totalSeg) {
        const segTitle = `${info.series} tập ${info.episode}${partStr} (${info.segment + 1}/${info.totalSeg})`;
        let r = await searchYT(mk(segTitle));
        let v = r.filter(v => v.title.includes(`(${info.segment + 1}/${info.totalSeg})`));
        if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'segment'};
        if (channel) { r = await searchYT(segTitle); v = r.filter(v => v.title.includes(`(${info.segment + 1}/${info.totalSeg})`)); if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'segment'}; }
        return null;
    }

    // Tìm tập tiếp theo
    const nextEp = info.episode + 1;
    const baseTitle = `${info.series} tập ${nextEp}${partStr}`;
    let r = await searchYT(mk(baseTitle));
    if (channel && r.length === 0) r = await searchYT(baseTitle);

    let candidates = r.filter(v => {
        const p = parseTitle(v.title);
        return p && p.series === info.series && p.episode === nextEp && (info.season ? p.season === info.season : !p.season);
    });

    // Fallback: dùng virtual playlist nếu có
    if (candidates.length === 0 && episodeList.length > 0) {
        // Tìm trong episodeList (đã có sẵn)
        const found = episodeList.filter(e => e.episode === nextEp && (info.season ? e.season === info.season : true));
        if (found.length) {
            found.sort((a, b) => (a.segment || 0) - (b.segment || 0));
            return {url: found[0].url, title: found[0].title, source:'virtual'};
        }
        // Suy luận phân đoạn thiếu
        const missing = suggestMissingSegments(episodeList);
        const nextMissing = missing.find(m => m.episode === nextEp && m.segment === 1);
        if (nextMissing) {
            const guessTitle = `${info.series} tập ${nextEp}${partStr} (1/${nextMissing.totalSeg})`;
            r = await searchYT(mk(guessTitle));
            candidates = r.filter(v => { const p = parseTitle(v.title); return p && p.series === info.series && p.episode === nextEp; });
            if (candidates.length === 0 && channel) { r = await searchYT(guessTitle); candidates = r.filter(v => { const p = parseTitle(v.title); return p && p.series === info.series && p.episode === nextEp; }); }
        }
    }

    if (candidates.length === 0) {
        // Cross-season
        if (info.season) {
            const ns = info.season + 1;
            const ct = `${info.series} tập 1 - P${ns} (1/${info.totalSeg || 1})`;
            r = await searchYT(mk(ct));
            const cv = r.filter(v => parseTitle(v.title)?.season === ns);
            if (cv.length) return {url: `https://youtu.be/${cv[0].videoId}`, title: cv[0].title, source:'newseason'};
        }
        return null;
    }

    // Ưu tiên segment nhỏ nhất
    candidates.sort((a, b) => {
        const pa = parseTitle(a.title);
        const pb = parseTitle(b.title);
        return (pa?.segment || 0) - (pb?.segment || 0);
    });

    const chosen = candidates[0];
    return {url: `https://youtu.be/${chosen.videoId}`, title: chosen.title, source:'episode'};
}

async function findPrevious(info, channel) {
    const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
    const pe = info.episode - 1;
    if (pe < 1) return null;
    const partStr = info.season ? ` - P${info.season}` : '';
    const baseTitle = `${info.series} tập ${pe}${partStr}`;
    let r = await searchYT(mk(baseTitle));
    if (channel && r.length === 0) r = await searchYT(baseTitle);
    const candidates = r.filter(v => {
        const p = parseTitle(v.title);
        return p && p.series === info.series && p.episode === pe && (info.season ? p.season === info.season : !p.season);
    });
    if (candidates.length === 0) {
        // Tìm trong episodeList
        const found = episodeList.filter(e => e.episode === pe && (info.season ? e.season === info.season : true));
        if (found.length) {
            found.sort((a, b) => (b.segment || 0) - (a.segment || 0));
            return {url: found[0].url, title: found[0].title, episode: pe};
        }
        return null;
    }
    candidates.sort((a, b) => {
        const pa = parseTitle(a.title);
        const pb = parseTitle(b.title);
        return (pb?.segment || 0) - (pa?.segment || 0);
    });
    const chosen = candidates[0];
    return {url: `https://youtu.be/${chosen.videoId}`, title: chosen.title, episode: pe};
}

async function findEpisodeList(info, channel, virtualPlaylistData) {
    const list = [];
    const ce = info.episode;
    const partStr = info.season ? ` - P${info.season}` : '';

    // Luôn thêm tập hiện tại
    const currentTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || `Tập ${ce}`;
    list.push({ episode: ce, url: location.href, title: currentTitle, isCurrent: true, segment: info.segment || 0, totalSeg: info.totalSeg || 1 });

    // Hàm thêm video từ mảng, không trùng lặp
    const addVideos = (videos) => {
        for (const vid of videos) {
            const p = parseTitle(vid.title);
            if (!p || !p.episode) continue;
            // Chỉ thêm nếu cùng series và (không có season hoặc khớp season)
            if (p.series !== info.series) continue;
            if (info.season && p.season !== info.season) continue;
            list.push({
                episode: p.episode,
                url: `https://youtu.be/${vid.videoId}`,
                title: vid.title,
                isCurrent: (p.episode === ce && (p.segment || 0) === (info.segment || 0)),
                segment: p.segment || 0,
                totalSeg: p.totalSeg || 1
            });
        }
    };

    // 1. Thêm từ virtual playlist (đã đầy đủ, đã sắp xếp)
    if (virtualPlaylistData && virtualPlaylistData.length > 0) {
        addVideos(virtualPlaylistData);
    } else {
        // 2. Nếu không có virtual, tìm kiếm thủ công (giới hạn phạm vi)
        const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
        const startEp = Math.max(1, ce - 3);
        const endEp = ce + 12;
        for (let ep = startEp; ep <= endEp; ep++) {
            if (ep === ce) continue;
            const queries = [
                `${info.series} tập ${ep}${partStr}`,
                `${info.series} p${info.season || 2} tập ${ep}`,
                `${info.series} phần ${info.season || 2} tập ${ep}`,
            ];
            for (const q of queries) {
                const results = await searchYT(mk(q));
                const valid = results.filter(v => {
                    const p = parseTitle(v.title);
                    return p && p.series === info.series && p.episode === ep && (info.season ? p.season === info.season : !p.season);
                });
                addVideos(valid);
            }
        }
    }

    // Loại bỏ trùng lặp (cùng episode + segment) và sắp xếp
    const seen = new Set();
    const unique = [];
    for (const item of list) {
        const key = `${item.episode}_${item.segment || 0}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(item);
        }
    }
    unique.sort((a, b) => {
        if (a.episode !== b.episode) return a.episode - b.episode;
        return (a.segment || 0) - (b.segment || 0);
    });
    log(`Episode list: ${unique.length} episodes`);
    return unique;
}