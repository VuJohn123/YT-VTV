// episode-navigator.js - Tìm tập tiếp theo, trước đó, danh sách phân đoạn

const MAX_EPISODES_IN_LIST = 10;
const VISIBLE_EPISODES = 4;

// ── Helper dùng chung: tìm với channel prefix, fallback không prefix ──
async function _searchWithFallback(title, filterFn, channel) {
    const withCh = (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${title} ${channel}` : title;
    let results = await searchYT(withCh);
    let found   = results.filter(filterFn);
    if (found.length) return found;

    // Fallback: bỏ channel trong query nếu chưa thử
    if (INCLUDE_CHANNEL_IN_SEARCH && channel) {
        results = await searchYT(title);
        found   = results.filter(filterFn);
    }
    return found;
}

function _makeFilter(series, episode, season, segmentCheck) {
    return (v) => {
        const p = parseTitle(v.title);
        if (!p || p.series !== series || p.episode !== episode) return false;
        if (season ? p.season !== season : p.season) return false;
        return segmentCheck ? segmentCheck(p) : true;
    };
}

async function findNext(info, channel) {
    const { series, episode, season, segment, totalSeg } = info;
    const total    = totalSeg || 1;
    const partStr  = season ? ` - P${season}` : '';

    // ── Còn phân đoạn trong tập hiện tại ──
    if (segment && total > 1 && segment < total) {
        const nextSeg  = segment + 1;
        const segTitle = `${series} tập ${episode}${partStr} (${nextSeg}/${total})`;
        const found    = await _searchWithFallback(
            segTitle,
            v => parseTitle(v.title)?.segment === nextSeg && parseTitle(v.title)?.totalSeg === total,
            channel
        );
        if (found.length) return { url: `https://youtu.be/${found[0].videoId}`, title: found[0].title, source: 'segment' };
        return null;
    }

    // ── Tìm tập kế tiếp ──
    const nextEp  = episode + 1;
    const segCheck = (total > 1) ? (p => p.segment === 1 && p.totalSeg === total) : null;
    const exactTitle = (total > 1)
        ? `${series} tập ${nextEp}${partStr} (1/${total})`
        : `${series} tập ${nextEp}${partStr}`;

    const filter = _makeFilter(series, nextEp, season, segCheck);
    let found = await _searchWithFallback(exactTitle, filter, channel);
    if (found.length) return { url: `https://youtu.be/${found[0].videoId}`, title: found[0].title, source: 'episode' };

    // Fallback không phân đoạn (video có thể chưa chia đoạn)
    if (total > 1) {
        const fallbackTitle = `${series} tập ${nextEp}${partStr}`;
        const fallbackFilter = _makeFilter(series, nextEp, season, null);
        found = await _searchWithFallback(fallbackTitle, fallbackFilter, channel);
        if (found.length) return { url: `https://youtu.be/${found[0].videoId}`, title: found[0].title, source: 'episode_fallback' };
    }

    // Cross-season
    if (season) {
        const ns = season + 1;
        const ctTitle = `${series} tập 1 - P${ns}${total > 1 ? ' (1/' + total + ')' : ''}`;
        found = await _searchWithFallback(ctTitle, v => parseTitle(v.title)?.season === ns, channel);
        if (found.length) return { url: `https://youtu.be/${found[0].videoId}`, title: found[0].title, source: 'newseason' };
    }

    return null;
}

async function findPrevious(info, channel) {
    const { series, episode, season, totalSeg } = info;
    const prevEp  = episode - 1;
    if (prevEp < 1) return null;

    const total   = totalSeg || 1;
    const partStr = season ? ` - P${season}` : '';

    // Tìm phân đoạn cuối của tập trước — nhưng KHÔNG giả định totalSeg bằng nhau
    // Thử từ phân đoạn cao xuống, hoặc thẳng tập không phân đoạn
    if (total > 1) {
        // Thử tìm segment = total (giả định cùng structure), nếu miss thì fallback
        for (const seg of [total, total - 1, 1]) {
            const t = `${series} tập ${prevEp}${partStr} (${seg}/${total})`;
            const f = _makeFilter(series, prevEp, season, p => p.segment === seg);
            const found = await _searchWithFallback(t, f, channel);
            if (found.length) return { url: `https://youtu.be/${found[0].videoId}`, title: found[0].title, episode: prevEp };
        }
    }

    // Fallback: tập không phân đoạn hoặc bất kỳ segment nào
    const fallbackTitle  = `${series} tập ${prevEp}${partStr}`;
    const fallbackFilter = _makeFilter(series, prevEp, season, null);
    const found = await _searchWithFallback(fallbackTitle, fallbackFilter, channel);
    if (found.length) return { url: `https://youtu.be/${found[0].videoId}`, title: found[0].title, episode: prevEp };

    return null;
}

async function findEpisodeList(info, channel) {
    const { series, episode, season, totalSeg } = info;
    const total   = totalSeg || 1;
    const partStr = season ? ` - P${season}` : '';
    const list    = [];

    // Thêm video hiện tại
    const currentTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || `Tập ${episode}`;
    list.push({ episode, url: location.href, title: currentTitle, isCurrent: true, segment: info.segment || 0, totalSeg: total });

    const startEp = Math.max(1, episode - 2);
    const endEp   = episode + MAX_EPISODES_IN_LIST - 3;

    for (let ep = startEp; ep <= endEp; ep++) {
        if (ep === episode) continue;
        const baseTitle = `${series} tập ${ep}${partStr}`;
        const results   = await searchYT(
            (INCLUDE_CHANNEL_IN_SEARCH && channel) ? `${baseTitle} ${channel}` : baseTitle
        );
        for (const vid of results) {
            const p = parseTitle(vid.title);
            if (!p || p.series !== series || p.episode !== ep) continue;
            if (season ? p.season !== season : p.season) continue;
            list.push({
                episode: ep,
                url: `https://youtu.be/${vid.videoId}`,
                title: vid.title,
                isCurrent: false,
                segment: p.segment || 0,
                totalSeg: p.totalSeg || 1,
            });
        }
    }

    // Sắp xếp và dedup
    list.sort((a, b) => a.episode !== b.episode ? a.episode - b.episode : (a.segment || 0) - (b.segment || 0));
    const seen   = new Set();
    const unique = [];
    for (const item of list) {
        const key = `${item.episode}_${item.segment || 0}`;
        if (!seen.has(key)) { seen.add(key); unique.push(item); }
    }

    log(`Episode list: ${unique.length} items (range ${startEp}-${endEp})`);
    return unique;
}
