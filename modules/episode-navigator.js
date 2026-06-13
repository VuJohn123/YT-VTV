// episode-navigator.js - Tìm tập tiếp theo, trước đó, danh sách (sửa lỗi thiếu segment, cache thông minh)
const MAX_EPISODES_IN_LIST = 10;

async function findNext(info, channel) {
    // Nếu có episodeList đầy đủ, ưu tiên dùng nó để tìm tập tiếp theo mà không cần search lại
    if (episodeList.length > 0) {
        const nextEp = info.episode + 1;
        const candidates = episodeList.filter(e => e.episode === nextEp && (info.season ? e.season === info.season || e.season === null : true));
        if (candidates.length > 0) {
            candidates.sort((a, b) => (a.segment || 0) - (b.segment || 0));
            const chosen = candidates[0];
            return {url: chosen.url, title: chosen.title, source:'cached'};
        }
    }

    const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
    const partStr = info.season ? ` - P${info.season}` : '';

    if (info.segment && info.totalSeg && info.segment < info.totalSeg) {
        const segTitle = `${info.series} tập ${info.episode}${partStr} (${info.segment + 1}/${info.totalSeg})`;
        let r = await searchYT(mk(segTitle));
        let v = r.filter(v => v.title.includes(`(${info.segment + 1}/${info.totalSeg})`));
        if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'segment'};
        if (channel) { r = await searchYT(segTitle); v = r.filter(v => v.title.includes(`(${info.segment + 1}/${info.totalSeg})`)); if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'segment'}; }
        return null;
    }

    const nextEp = info.episode + 1;
    const baseTitle = `${info.series} tập ${nextEp}${partStr}`;
    let r = await searchYT(mk(baseTitle));
    if (channel && r.length === 0) r = await searchYT(baseTitle);

    let candidates = r.filter(v => {
        const p = parseTitle(v.title);
        return p && p.series === info.series && p.episode === nextEp && (info.season ? p.season === info.season || p.season === null : true);
    });

    if (candidates.length === 0) {
        if (info.season) {
            const ns = info.season + 1;
            const ct = `${info.series} tập 1 - P${ns}`; // không thêm segment vì không biết totalSeg mùa mới
            r = await searchYT(mk(ct));
            const cv = r.filter(v => parseTitle(v.title)?.season === ns);
            if (cv.length) return {url: `https://youtu.be/${cv[0].videoId}`, title: cv[0].title, source:'newseason'};
        }
        return null;
    }

    candidates.sort((a, b) => {
        const pa = parseTitle(a.title);
        const pb = parseTitle(b.title);
        return (pa?.segment || 0) - (pb?.segment || 0);
    });

    const chosen = candidates[0];
    return {url: `https://youtu.be/${chosen.videoId}`, title: chosen.title, source:'episode'};
}

async function findPrevious(info, channel) {
    if (episodeList.length > 0) {
        const pe = info.episode - 1;
        if (pe < 1) return null;
        const candidates = episodeList.filter(e => e.episode === pe && (info.season ? e.season === info.season || e.season === null : true));
        if (candidates.length > 0) {
            candidates.sort((a, b) => (b.segment || 0) - (a.segment || 0));
            const chosen = candidates[0];
            return {url: chosen.url, title: chosen.title, episode: pe};
        }
    }
    const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
    const pe = info.episode - 1;
    if (pe < 1) return null;
    const partStr = info.season ? ` - P${info.season}` : '';
    const baseTitle = `${info.series} tập ${pe}${partStr}`;
    let r = await searchYT(mk(baseTitle));
    if (channel && r.length === 0) r = await searchYT(baseTitle);
    const candidates = r.filter(v => {
        const p = parseTitle(v.title);
        return p && p.series === info.series && p.episode === pe && (info.season ? p.season === info.season || p.season === null : true);
    });
    if (candidates.length === 0) return null;
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
    const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
    const ce = info.episode;
    const partStr = info.season ? ` - P${info.season}` : '';

    const currentTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || `Tập ${ce}`;
    list.push({
        videoId: new URLSearchParams(location.search).get('v'),
        episode: ce,
        url: location.href,
        title: currentTitle,
        isCurrent: true,
        segment: info.season ? (info.segment || 0) : 0,
        totalSeg: info.totalSeg || 1
    });

    const addVideos = (videos) => {
        for (const vid of videos) {
            if (!vid.videoId) continue;
            const p = parseTitle(vid.title);
            if (!p || !p.episode) continue;
            // Chỉ kiểm tra series, bỏ qua season nếu không có
            if (p.series !== info.series) continue;
            // Nếu season được xác định trong video, phải khớp với season hiện tại (nếu có)
            if (info.season && p.season !== null && p.season !== info.season) continue;
            list.push({
                videoId: vid.videoId,
                episode: p.episode,
                url: `https://youtu.be/${vid.videoId}`,
                title: vid.title,
                isCurrent: false,
                segment: p.segment || 0,
                totalSeg: p.totalSeg || 1
            });
        }
    };

    if (virtualPlaylistData && virtualPlaylistData.length > 0) {
        addVideos(virtualPlaylistData);

        // Kiểm tra xem tập hiện tại có đủ tất cả segments không
        // (virtual playlist có thể thiếu một số segment do playlist YT không đầy đủ)
        if (info.totalSeg && info.totalSeg > 1) {
            const presentSegments = new Set(
                list.filter(e => e.episode === ce).map(e => e.segment)
            );
            const missingSegs = [];
            for (let seg = 1; seg <= info.totalSeg; seg++) {
                if (!presentSegments.has(seg)) missingSegs.push(seg);
            }
            if (missingSegs.length > 0) {
                log(`Virtual playlist thiếu segment ${missingSegs} của tập ${ce}, bổ sung bằng search...`);
                const segQuery = `${info.series} tập ${ce}${partStr}`;
                const segResults = await searchYT(mk(segQuery));
                const validSegs = segResults.filter(v => {
                    const p = parseTitle(v.title);
                    if (!p || p.series !== info.series || p.episode !== ce) return false;
                    if (info.season && p.season !== null && p.season !== info.season) return false;
                    return true;
                });
                addVideos(validSegs);
            }
        }
    } else {
        // Fallback search nếu không có virtual playlist
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
                    if (!p || p.series !== info.series || p.episode !== ep) return false;
                    if (info.season && p.season !== null && p.season !== info.season) return false;
                    return true;
                });
                addVideos(valid);
            }
        }

        // Bổ sung tìm kiếm các segment của tập hiện tại nếu có multi-part
        if (info.totalSeg && info.totalSeg > 1) {
            const segQuery = `${info.series} tập ${ce}${partStr}`;
            const segResults = await searchYT(mk(segQuery));
            const validSegs = segResults.filter(v => {
                const p = parseTitle(v.title);
                if (!p || p.series !== info.series || p.episode !== ce) return false;
                if (info.season && p.season !== null && p.season !== info.season) return false;
                return true;
            });
            addVideos(validSegs);
        }
    }

    // Loại bỏ trùng lặp bằng videoId
    const seen = new Set();
    const unique = [];
    for (const item of list) {
        if (!seen.has(item.videoId)) {
            seen.add(item.videoId);
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