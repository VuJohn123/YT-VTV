// episode-navigator.js — Layer 2: Episode discovery engine
// Nhận ParsedInfo + channel, emit events qua EventBus.
// Không giữ state giữa các navigations.

const EpisodeEngine = (() => {
    // ─── Helpers ──────────────────────────────────────────────────────────────
    function _matchesSeries(parsed, info) {
        if (!parsed?.series || parsed.series !== info.series) return false;
        if (info.season && parsed.season !== null && parsed.season !== info.season) return false;
        return true;
    }

    function _sortBySegment(candidates, desc = false) {
        return [...candidates].sort((a, b) => {
            const pa = parseTitle(a.title ?? a.episode?.toString() ?? '');
            const pb = parseTitle(b.title ?? b.episode?.toString() ?? '');
            const diff = (pa.segment || 0) - (pb.segment || 0);
            return desc ? -diff : diff;
        });
    }

    // ─── findNext ─────────────────────────────────────────────────────────────
    /**
     * @param {ParsedInfo}    info
     * @param {string}        channel
     * @param {Array}         episodeList  — already-built list (fast path)
     * @returns {Promise<{url:string, title:string, source:string}|null>}
     */
    async function findNext(info, channel, episodeList = []) {
        // Fast path: episode list already available
        if (episodeList.length > 0) {
            const nextEp = info.episode + 1;
            const candidates = episodeList.filter(e =>
                e.episode === nextEp && (!info.season || e.season === info.season || e.season === null)
            );
            if (candidates.length) {
                const chosen = _sortBySegment(candidates)[0];
                return { url: chosen.url, title: chosen.title, source: 'cached' };
            }
        }

        const partStr = info.season ? ` - P${info.season}` : '';

        // Next segment of the same episode
        if (info.segment && info.totalSeg && info.segment < info.totalSeg) {
            const segTitle = `${info.series} tập ${info.episode}${partStr} (${info.segment + 1}/${info.totalSeg})`;
            let r = await Search.search(Search.mkQuery(segTitle, channel));
            let v = r.filter(v => v.title.includes(`(${info.segment + 1}/${info.totalSeg})`));
            if (!v.length && channel) {
                r = await Search.search(segTitle);
                v = r.filter(v => v.title.includes(`(${info.segment + 1}/${info.totalSeg})`));
            }
            if (v.length) return { url: `https://youtu.be/${v[0].videoId}`, title: v[0].title, source: 'segment' };
            return null;
        }

        // Next episode
        const nextEp    = info.episode + 1;
        const baseTitle = `${info.series} tập ${nextEp}${partStr}`;
        let r = await Search.search(Search.mkQuery(baseTitle, channel));
        if (!r.length && channel) r = await Search.search(baseTitle);

        let candidates = r.filter(v => {
            const p = parseTitle(v.title);
            return _matchesSeries(p, info) && p.episode === nextEp;
        });

        // Try next season
        if (!candidates.length && info.season) {
            const ns = info.season + 1;
            const ct = `${info.series} tập 1 - P${ns}`;
            r = await Search.search(Search.mkQuery(ct, channel));
            const cv = r.filter(v => parseTitle(v.title)?.season === ns);
            if (cv.length) return { url: `https://youtu.be/${cv[0].videoId}`, title: cv[0].title, source: 'newseason' };
            return null;
        }

        if (!candidates.length) return null;
        const chosen = _sortBySegment(candidates)[0];
        return { url: `https://youtu.be/${chosen.videoId}`, title: chosen.title, source: 'episode' };
    }

    // ─── findPrevious ─────────────────────────────────────────────────────────
    async function findPrevious(info, channel, episodeList = []) {
        const pe = info.episode - 1;
        if (pe < 1) return null;

        if (episodeList.length > 0) {
            const candidates = episodeList.filter(e =>
                e.episode === pe && (!info.season || e.season === info.season || e.season === null)
            );
            if (candidates.length) {
                const chosen = _sortBySegment(candidates, true)[0]; // highest segment
                return { url: chosen.url, title: chosen.title, episode: pe };
            }
        }

        const partStr   = info.season ? ` - P${info.season}` : '';
        const baseTitle = `${info.series} tập ${pe}${partStr}`;
        let r = await Search.search(Search.mkQuery(baseTitle, channel));
        if (!r.length && channel) r = await Search.search(baseTitle);

        const candidates = r.filter(v => {
            const p = parseTitle(v.title);
            return _matchesSeries(p, info) && p.episode === pe;
        });
        if (!candidates.length) return null;
        const chosen = _sortBySegment(candidates, true)[0];
        return { url: `https://youtu.be/${chosen.videoId}`, title: chosen.title, episode: pe };
    }

    // ─── findEpisodeList ──────────────────────────────────────────────────────
    async function findEpisodeList(info, channel, virtualPlaylistData) {
        const list    = [];
        const partStr = info.season ? ` - P${info.season}` : '';
        const ce      = info.episode;

        // Seed with current video
        list.push({
            videoId:  new URLSearchParams(location.search).get('v'),
            episode:  ce,
            season:   info.season,
            url:      location.href,
            title:    document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || `Tập ${ce}`,
            isCurrent: true,
            segment:  info.segment || 0,
            totalSeg: info.totalSeg || 1,
        });

        const _addVideos = (videos) => {
            for (const vid of videos) {
                if (!vid.videoId) continue;
                const p = parseTitle(vid.title);
                if (!p?.episode) continue;
                if (p.series !== info.series) continue;
                if (info.season && p.season !== null && p.season !== info.season) continue;
                list.push({
                    videoId:  vid.videoId,
                    episode:  p.episode,
                    season:   p.season,
                    url:      `https://youtu.be/${vid.videoId}`,
                    title:    vid.title,
                    isCurrent: false,
                    segment:  p.segment || 0,
                    totalSeg: p.totalSeg || 1,
                });
            }
        };

        if (virtualPlaylistData?.length) {
            _addVideos(virtualPlaylistData);

            // Patch missing segments for current episode
            if (info.totalSeg && info.totalSeg > 1) {
                const presentSegs = new Set(list.filter(e => e.episode === ce).map(e => e.segment));
                const missing = [];
                for (let seg = 1; seg <= info.totalSeg; seg++) {
                    if (!presentSegs.has(seg)) missing.push(seg);
                }
                if (missing.length) {
                    log('[EpisodeEngine] patching missing segments:', missing);
                    const r = await Search.search(Search.mkQuery(`${info.series} tập ${ce}${partStr}`, channel));
                    _addVideos(r.filter(v => {
                        const p = parseTitle(v.title);
                        return p?.series === info.series && p.episode === ce &&
                            (!info.season || p.season === null || p.season === info.season);
                    }));
                }
            }
        } else {
            // Fallback: search window around current episode
            const startEp = Math.max(1, ce - 3);
            const endEp   = ce + 12;
            for (let ep = startEp; ep <= endEp; ep++) {
                if (ep === ce) continue;
                const queries = [
                    `${info.series} tập ${ep}${partStr}`,
                    info.season ? `${info.series} p${info.season} tập ${ep}` : null,
                ].filter(Boolean);
                for (const q of queries) {
                    const results = await Search.search(Search.mkQuery(q, channel));
                    _addVideos(results.filter(v => {
                        const p = parseTitle(v.title);
                        return p?.series === info.series && p.episode === ep &&
                            (!info.season || p.season === null || p.season === info.season);
                    }));
                }
            }
        }

        // Dedup + sort
        const seen   = new Set();
        const unique = [];
        for (const item of list) {
            if (!seen.has(item.videoId)) { seen.add(item.videoId); unique.push(item); }
        }
        unique.sort((a, b) => a.episode !== b.episode ? a.episode - b.episode : (a.segment || 0) - (b.segment || 0));

        log('[EpisodeEngine] list size:', unique.length);
        return unique;
    }

    // ─── Main orchestration (called by entry.js) ──────────────────────────────
    /**
     * Run full episode discovery and emit results onto EventBus.
     * @param {ParsedInfo} info
     * @param {string}     channel
     */
    async function run(info, channel) {
        log('[EpisodeEngine] run:', info.series, 'ep', info.episode);

        // Build virtual playlist (series-scoped, cached)
        const vpData = await VirtualPlaylist.build(info.series);

        // Build episode list
        const list = await findEpisodeList(info, channel, vpData);
        EventBus.emit('playlistReady', { list });

        // Find prev
        const prev = await findPrevious(info, channel, list);
        if (prev) EventBus.emit('prevFound', prev);

        // Find next
        const next = await findNext(info, channel, list);
        if (next) {
            EventBus.emit('nextFound', next);
        } else {
            // Fallback to YouTube autoplay
            const ap = getYouTubeAutoplay();
            if (ap) EventBus.emit('nextFound', { ...ap, source: 'autoplay' });
            else     EventBus.emit('nextNotFound');
        }

        // Missing episode detection
        const missing = detectMissingEpisodes(list);
        if (missing.episodes.length || missing.segments.length) {
            EventBus.emit('missingDetected', missing);
        }
    }

    return { run, findNext, findPrevious, findEpisodeList };
})();
