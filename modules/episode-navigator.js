// episode-navigator.js - Tìm tập tiếp theo, trước đó, danh sách đầy đủ phân đoạn
const MAX_EPISODES_IN_LIST = 10;
const VISIBLE_EPISODES = 4;

async function findNext(info, channel) {
    const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
    
    // Nếu còn phân đoạn trong cùng tập → tìm phân đoạn tiếp theo
    if (info.segment && info.totalSeg && info.segment < info.totalSeg) {
        const partStr = info.season ? ` - P${info.season}` : '';
        const segTitle = `${info.series} tập ${info.episode}${partStr} (${info.segment + 1}/${info.totalSeg})`;
        let r = await searchYT(mk(segTitle));
        let v = r.filter(v => v.title.includes(`(${info.segment + 1}/${info.totalSeg})`));
        if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'segment'};
        if (channel) { 
            r = await searchYT(segTitle); 
            v = r.filter(v => v.title.includes(`(${info.segment + 1}/${info.totalSeg})`)); 
            if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'segment'}; 
        }
        return null;
    }

    // Hết phân đoạn → tìm tập tiếp theo, ưu tiên phân đoạn 1 nếu có
    const nextEp = info.episode + 1;
    const partStr = info.season ? ` - P${info.season}` : '';
    const total = info.totalSeg || 1;
    
    // Xây dựng tiêu đề với phân đoạn 1 nếu tập có phân đoạn (total > 1)
    const exactTitle = (total > 1) 
        ? `${info.series} tập ${nextEp}${partStr} (1/${total})`
        : `${info.series} tập ${nextEp}${partStr}`;
    
    let r = await searchYT(mk(exactTitle));
    let v = r.filter(v => {
        const p = parseTitle(v.title);
        if (!p || p.series !== info.series || p.episode !== nextEp) return false;
        if (info.season ? p.season !== info.season : p.season) return false;
        if (total > 1) {
            // Phải khớp segment 1
            return p.segment === 1 && p.totalSeg === total;
        }
        return true;
    });
    if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'episode'};
    
    // Nếu không tìm thấy với phân đoạn 1 (có thể video chưa lên), fallback tìm không phân đoạn
    if (total > 1) {
        const fallbackTitle = `${info.series} tập ${nextEp}${partStr}`;
        r = await searchYT(mk(fallbackTitle));
        v = r.filter(v => {
            const p = parseTitle(v.title);
            return p && p.series === info.series && p.episode === nextEp && (info.season ? p.season === info.season : !p.season);
        });
        if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'episode_fallback'};
    }
    
    // Thử kênh khác nếu không có kết quả
    if (channel) {
        r = await searchYT(exactTitle);
        v = r.filter(v => {
            const p = parseTitle(v.title);
            if (!p || p.series !== info.series || p.episode !== nextEp) return false;
            if (info.season ? p.season !== info.season : p.season) return false;
            if (total > 1) return p.segment === 1 && p.totalSeg === total;
            return true;
        });
        if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'episode'};
    }
    
    // Cross-season
    if (info.season) {
        const ns = info.season + 1;
        const ct = `${info.series} tập 1 - P${ns} (1/${total})`;
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
    const total = info.totalSeg || 1;
    
    // Tìm phân đoạn cuối cùng của tập trước (nếu có phân đoạn)
    let exactTitle;
    if (total > 1) {
        // Giả sử tập trước cũng có cùng totalSeg, tìm segment = total
        exactTitle = `${info.series} tập ${pe}${partStr} (${total}/${total})`;
    } else {
        exactTitle = `${info.series} tập ${pe}${partStr}`;
    }
    
    let r = await searchYT(mk(exactTitle));
    let v = r.filter(v => {
        const p = parseTitle(v.title);
        if (!p || p.series !== info.series || p.episode !== pe) return false;
        if (info.season ? p.season !== info.season : p.season) return false;
        if (total > 1) return p.segment === total && p.totalSeg === total;
        return true;
    });
    if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, episode: pe};
    
    // Fallback: tìm bất kỳ video của tập trước
    const fallbackTitle = `${info.series} tập ${pe}${partStr}`;
    r = await searchYT(mk(fallbackTitle));
    v = r.filter(v => {
        const p = parseTitle(v.title);
        return p && p.series === info.series && p.episode === pe && (info.season ? p.season === info.season : !p.season);
    });
    if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, episode: pe};
    
    if (channel) {
        r = await searchYT(exactTitle);
        v = r.filter(v => {
            const p = parseTitle(v.title);
            if (!p || p.series !== info.series || p.episode !== pe) return false;
            if (info.season ? p.season !== info.season : p.season) return false;
            if (total > 1) return p.segment === total && p.totalSeg === total;
            return true;
        });
        if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, episode: pe};
    }
    return null;
}

// Lấy danh sách đầy đủ các video (bao gồm tất cả phân đoạn) xung quanh tập hiện tại
async function findEpisodeList(info, channel) {
    const list = [];
    const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
    const ce = info.episode;
    const partStr = info.season ? ` - P${info.season}` : '';
    const total = info.totalSeg || 1;
    
    // Thêm video hiện tại vào danh sách
    const currentTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || `Tập ${ce}`;
    list.push({
        episode: ce,
        url: location.href,
        title: currentTitle,
        isCurrent: true,
        segment: info.segment || 0,
        totalSeg: info.totalSeg || 1
    });
    
    // Phạm vi tập: trước 2, sau 7
    const startEp = Math.max(1, ce - 2);
    const endEp = ce + MAX_EPISODES_IN_LIST - 3;
    
    // Tìm kiếm tất cả video cho từng tập
    for (let ep = startEp; ep <= endEp; ep++) {
        if (ep === ce) continue;
        const baseTitle = `${info.series} tập ${ep}${partStr}`;
        const results = await searchYT(mk(baseTitle));
        // Lọc tất cả video khớp episode, season
        const valid = results.filter(v => {
            const p = parseTitle(v.title);
            return p && p.series === info.series && p.episode === ep && (info.season ? p.season === info.season : !p.season);
        });
        for (const vid of valid) {
            const p = parseTitle(vid.title);
            list.push({
                episode: ep,
                url: `https://youtu.be/${vid.videoId}`,
                title: vid.title,
                isCurrent: false,
                segment: p.segment || 0,
                totalSeg: p.totalSeg || 1
            });
        }
    }
    
    // Sắp xếp: theo episode, sau đó theo segment
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
    
    log(`Episode list: ${unique.length} episodes (range ${startEp}-${endEp})`);
    return unique;
}