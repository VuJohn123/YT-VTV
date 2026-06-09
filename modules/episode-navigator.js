// episode-navigator.js - Tìm tập trước, sau, danh sách
async function findNext(info, channel) {
    const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
    if (info.segment && info.totalSeg && info.segment < info.totalSeg) {
        const st = `${info.series} tập ${info.episode}${info.season ? ` - P${info.season}` : ''} (${info.segment + 1}/${info.totalSeg})`;
        let r = await searchYT(mk(st)); let v = r.filter(v => v.title.includes(`(${info.segment + 1}/${info.totalSeg})`));
        if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'segment'};
        if (channel) { r = await searchYT(st); v = r.filter(v => v.title.includes(`(${info.segment + 1}/${info.totalSeg})`)); if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'segment'}; }
        return null;
    }
    const ne = info.episode + 1;
    const et = `${info.series} tập ${ne}${info.season ? ` - P${info.season}` : ''}`;
    let r = await searchYT(mk(et)); let v = r.filter(v => { const p = parseTitle(v.title); return p && p.series === info.series && p.episode === ne && (info.season ? p.season === info.season : !p.season); });
    if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'episode'};
    if (channel) { r = await searchYT(et); v = r.filter(v => { const p = parseTitle(v.title); return p && p.series === info.series && p.episode === ne && (info.season ? p.season === info.season : !p.season); }); if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source:'episode'}; }
    if (info.season) { const ns = info.season + 1; const ct = `${info.series} tập 1 - P${ns}`; r = await searchYT(mk(ct)); const cv = r.filter(v => parseTitle(v.title)?.season === ns); if (cv.length) return {url: `https://youtu.be/${cv[0].videoId}`, title: cv[0].title, source:'newseason'}; }
    return null;
}
async function findPrevious(info, channel) {
    const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
    const pe = info.episode - 1; if (pe < 1) return null;
    const et = `${info.series} tập ${pe}${info.season ? ` - P${info.season}` : ''}`;
    let r = await searchYT(mk(et)); let v = r.filter(v => { const p = parseTitle(v.title); return p && p.series === info.series && p.episode === pe && (info.season ? p.season === info.season : !p.season); });
    if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, episode: pe};
    if (channel) { r = await searchYT(et); v = r.filter(v => { const p = parseTitle(v.title); return p && p.series === info.series && p.episode === pe && (info.season ? p.season === info.season : !p.season); }); if (v.length) return {url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, episode: pe}; }
    return null;
}
async function findEpisodeList(info, channel) {
    const list = []; const mk = (exact) => (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${exact} ${channel}` : exact;
    const ce = info.episode; const start = Math.max(1, ce - 1); const end = ce + EPISODES_TO_SHOW - 2;
    for (let ep = start; ep <= end; ep++) {
        if (ep === ce) list.push({episode: ep, url: location.href, title: document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || `Tập ${ep}`, isCurrent: true});
        else {
            const ps = info.season ? ` - P${info.season}` : ''; const t = `${info.series} tập ${ep}${ps}`;
            const r = await searchYT(mk(t)); const v = r.filter(v => { const p = parseTitle(v.title); return p && p.series === info.series && p.episode === ep && (info.season ? p.season === info.season : !p.season); });
            if (v.length) list.push({episode: ep, url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, isCurrent: false});
        }
    }
    return list;
}