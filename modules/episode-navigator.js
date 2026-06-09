// episode-navigator.js - Tìm tất cả tập, sắp xếp đúng thứ tự, hỗ trợ P2 (season), mở rộng danh sách
const MAX_EPISODES_IN_LIST = 10;
const VISIBLE_EPISODES = 4;
const MAX_SEARCH_DEPTH = 3; // Tìm sâu hơn: thử nhiều query để bắt đủ tập

async function findNext(info, channel) {
    const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
    
    // Nếu đang trong phân đoạn (segment) và chưa hết → tìm phân đoạn kế
    if (info.segment && info.totalSeg && info.segment < info.totalSeg) {
        const partStr = info.season ? ` - P${info.season}` : '';
        const st = `${info.series} tập ${info.episode}${partStr} (${info.segment + 1}/${info.totalSeg})`;
        let r = await searchYT(mk(st));
        let v = r.filter(v => v.title.includes(`(${info.segment + 1}/${info.totalSeg})`));
        if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'segment'};
        if (channel) { r = await searchYT(st); v = r.filter(v => v.title.includes(`(${info.segment + 1}/${info.totalSeg})`)); if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'segment'}; }
        return null;
    }

    // Tìm tập kế tiếp (cùng season)
    const ne = info.episode + 1;
    const partStr = info.season ? ` - P${info.season}` : '';
    const et = `${info.series} tập ${ne}${partStr}`;
    let r = await searchYT(mk(et));
    let v = r.filter(v => {
        const p = parseTitle(v.title);
        return p && p.series === info.series && p.episode === ne && (info.season ? p.season === info.season : !p.season);
    });
    if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'episode'};
    if (channel) { 
        r = await searchYT(et); 
        v = r.filter(v => {
            const p = parseTitle(v.title);
            return p && p.series === info.series && p.episode === ne && (info.season ? p.season === info.season : !p.season);
        }); 
        if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'episode'}; 
    }
    
    // Nếu không tìm thấy tập kế, thử season mới
    if (info.season) { 
        const ns = info.season + 1; 
        const ct = `${info.series} tập 1 - P${ns}`; 
        r = await searchYT(mk(ct)); 
        const cv = r.filter(v => parseTitle(v.title)?.season === ns); 
        if (cv.length) return {url: `https://youtu.be/${cv[0].videoId}`, title: cv[0].title, source:'newseason'}; 
    }
    return null;
}

async function findPrevious(info, channel) {
    const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
    const pe = info.episode - 1; 
    if (pe < 1) return null;
    const partStr = info.season ? ` - P${info.season}` : '';
    const et = `${info.series} tập ${pe}${partStr}`;
    let r = await searchYT(mk(et)); 
    let v = r.filter(v => { 
        const p = parseTitle(v.title); 
        return p && p.series === info.series && p.episode === pe && (info.season ? p.season === info.season : !p.season); 
    });
    if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, episode: pe};
    if (channel) { 
        r = await searchYT(et); 
        v = r.filter(v => { 
            const p = parseTitle(v.title); 
            return p && p.series === info.series && p.episode === pe && (info.season ? p.season === info.season : !p.season); 
        }); 
        if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, episode: pe}; 
    }
    return null;
}

// Tìm tất cả tập trong phạm vi rộng, sắp xếp đúng thứ tự
async function findEpisodeList(info, channel) {
    const list = [];
    const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
    const ce = info.episode;
    const partStr = info.season ? ` - P${info.season}` : '';
    
    // Lấy URL tập hiện tại
    const currentTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || `Tập ${ce}`;
    list.push({
        episode: ce,
        url: location.href,
        title: currentTitle,
        isCurrent: true,
        segment: info.segment || 0,
        totalSeg: info.totalSeg || 1
    });
    
    // Tìm các tập xung quanh: trước 2 tập, sau 7 tập (tổng ~10)
    const searchStart = Math.max(1, ce - 2);
    const searchEnd = ce + MAX_EPISODES_IN_LIST - 3;
    
    // Gom các promise tìm kiếm
    const searchPromises = [];
    for (let ep = searchStart; ep <= searchEnd; ep++) {
        if (ep === ce) continue;
        const t = `${info.series} tập ${ep}${partStr}`;
        searchPromises.push((async () => {
            const r = await searchYT(mk(t));
            const v = r.filter(v => {
                const p = parseTitle(v.title);
                return p && p.series === info.series && p.episode === ep && (info.season ? p.season === info.season : !p.season);
            });
            if (v.length) {
                const parsed = parseTitle(v[0].title);
                return {
                    episode: ep,
                    url: `https://youtu.be/${v[0].videoId}`,
                    title: v[0].title,
                    isCurrent: false,
                    segment: parsed.segment || 0,
                    totalSeg: parsed.totalSeg || 1
                };
            }
            return null;
        })());
    }
    
    const results = await Promise.all(searchPromises);
    for (const r of results) {
        if (r) list.push(r);
    }
    
    // Sắp xếp: theo episode tăng dần, sau đó theo segment tăng dần
    list.sort((a, b) => {
        if (a.episode !== b.episode) return a.episode - b.episode;
        return (a.segment || 0) - (b.segment || 0);
    });
    
    // Loại bỏ trùng lặp (cùng episode + segment)
    const seen = new Set();
    const unique = [];
    for (const item of list) {
        const key = `${item.episode}_${item.segment || 0}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(item);
        }
    }
    
    log(`Episode list: ${unique.length} episodes found (range ${searchStart}-${searchEnd})`);
    return unique;
}