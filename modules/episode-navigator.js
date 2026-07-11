// episode-navigator.js — Layer 2: Episode discovery engine
// Fixes:
//   1. Cache miss bug: episodeList được cache đúng theo seriesKey
//   2. Missing episode detection chạy sau khi list đã đầy đủ
//   3. findNext/findPrev ưu tiên list cache, fallback search với fuzzy match
//   4. Không re-search nếu đã có hit trong cache
//   5. Dedup video trùng tập (nhiều bản upload style title khác nhau cho cùng
//      1 tập thật) — giữ bản đáng tin cậy nhất theo classifyDuration (full >
//      unknown > segment) rồi mới tới publishedTimeText, so khớp season kiểu
//      fuzzy (null = wildcard) để không tách nhầm 1 tập thật thành 2 tập ảo
//      chỉ vì cách ghi "phần mấy" khác nhau giữa các title.
//   6. Duration-aware: video 50p-1h30 coi là "full", 3-6p coi là "segment"
//      (nhiều khả năng chỉ là 1 phần bị chia nhỏ như 1/4, 2/4 — không phải
//      lỗi, style title cũ hay chia tập dài thành nhiều video ngắn), giúp
//      chọn đúng bản đầy đủ khi có nhiều video trùng tập với thời lượng khác
//      nhau (xem compareVideoRecency trong utils.js).

const EpisodeEngine = (() => {
    // ─── Per-series episode list cache (in-memory, session) ───────────────────
    // seriesKey → { list: Array, timestamp: number }
    const _listCache = new Map();
    const LIST_CACHE_TTL = 10 * 60_000; // 10 min

    function _getCachedList(seriesKey) {
        const hit = _listCache.get(seriesKey);
        if (hit && Date.now() - hit.timestamp < LIST_CACHE_TTL) return hit.list;
        return null;
    }

    function _cacheList(seriesKey, list) {
        _listCache.set(seriesKey, { list, timestamp: Date.now() });
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function _seriesMatch(parsed, info) {
        if (!parsed?.episode) return false;
        // Loose series match: normalized lowercase, allow partial
        const a = (parsed.series || '').toLowerCase().trim();
        const b = (info.series   || '').toLowerCase().trim();
        if (!a || !b) return false;
        if (a === b) return true;
        // One contains the other (handles trailing noise)
        if (a.includes(b) || b.includes(a)) return true;
        // Shared prefix ≥ 6 chars
        let common = 0;
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
            if (a[i] === b[i]) common++; else break;
        }
        if (common >= 6) return true;
        return false;
    }

    function _seasonMatch(parsed, info) {
        if (!info.season) return true; // no season constraint
        if (parsed.season === null) return true; // video has no season tag → accept
        return parsed.season === info.season;
    }

    function _sortByEpSeg(arr) {
        return [...arr].sort((a, b) =>
            a.episode !== b.episode
                ? a.episode - b.episode
                : (a.segment || 0) - (b.segment || 0)
        );
    }

    // ─── Build episode list ───────────────────────────────────────────────────
    async function _buildList(info, channel, seriesKey, vpData) {
        // Check in-memory cache first
        const cached = _getCachedList(seriesKey);
        if (cached) {
            log('[EpisodeEngine] list cache hit:', seriesKey, cached.length, 'eps');
            return cached;
        }

        const list = [];
        const seen = new Set();              // dedup theo videoId (video giống hệt, tránh add 2 lần)
        const byEpSegGroup = new Map();       // "episode|segment" → mảng index trong `list` (nhóm ứng viên cùng tập)

        // So khớp season kiểu fuzzy, cùng tinh thần với _seasonMatch: nếu 1 trong 2
        // bên không ghi season (null), coi là có thể cùng 1 tập thật (style title cũ
        // không luôn ghi rõ "phần mấy"). Chỉ coi là KHÁC tập khi cả 2 đều có season
        // xác định và khác nhau.
        const _seasonCompatible = (a, b) => (a == null || b == null || a === b);

        const _add = (videoId, episode, season, title, url, isCurrent = false, segment = 0, totalSeg = 1, meta = {}) => {
            if (!videoId || seen.has(videoId)) return;

            const entry = {
                videoId, episode, season, title, url, isCurrent, segment, totalSeg,
                publishedText: meta.publishedText || '',
                lengthText: meta.lengthText || '',
                _seq: typeof meta._seq === 'number' ? meta._seq : undefined,
            };

            const groupKey = `${episode}|${segment}`;
            const candidateIdxs = byEpSegGroup.get(groupKey) || [];

            // Tìm ứng viên trùng thật trong nhóm (season fuzzy-match)
            const dupIdx = candidateIdxs.find(idx => _seasonCompatible(list[idx].season, season));

            if (dupIdx === undefined) {
                seen.add(videoId);
                byEpSegGroup.set(groupKey, [...candidateIdxs, list.length]);
                list.push(entry);
                return;
            }

            // Đã có 1 video khác cho đúng tập/segment này (trường hợp nhiều bản
            // upload trùng tập — ví dụ style title cũ với description khác nhau).
            // Giữ lại bản MỚI hơn theo thời gian đăng (hoặc thứ tự playlist nếu
            // không có date). Video hiện tại (isCurrent) luôn được ưu tiên giữ vì
            // đó là video user đang xem thật.
            const existing = list[dupIdx];
            if (existing.isCurrent) return; // không thay thế video đang xem

            const cmp = compareVideoRecency(entry, existing);
            if (cmp > 0) {
                // entry mới hơn existing → thay thế, và merge season nếu entry
                // có season xác định còn existing thì null (giữ thông tin chi tiết hơn)
                seen.delete(existing.videoId);
                seen.add(videoId);
                if (entry.season == null && existing.season != null) entry.season = existing.season;
                list[dupIdx] = entry;
                log('[EpisodeEngine] dup', groupKey, '→ giữ bản mới hơn:', title);
            } else {
                log('[EpisodeEngine] dup', groupKey, '→ bỏ qua bản cũ hơn:', title);
            }
        };

        // Seed: current video
        const currentVid = new URLSearchParams(location.search).get('v');
        const currentTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')
            ?.textContent?.trim() || `Tập ${info.episode}`;
        _add(currentVid, info.episode, info.season, currentTitle, location.href, true,
            info.segment || 0, info.totalSeg || 1);

        const _ingest = (videos) => {
            for (const v of videos) {
                if (!v.videoId) continue;
                const p = parseTitle(v.title || '');
                if (!p.episode) continue;
                if (!_seriesMatch(p, info)) continue;
                if (!_seasonMatch(p, info)) continue;
                _add(
                    v.videoId, p.episode, p.season,
                    v.title,
                    v.url || `https://youtu.be/${v.videoId}`,
                    false,
                    p.segment || 0, p.totalSeg || 1,
                    { publishedText: v.publishedText, lengthText: v.lengthText, _seq: v._seq }
                );
            }
        };

        // Path A: use virtual playlist data
        if (vpData?.length) {
            _ingest(vpData);
            log('[EpisodeEngine] ingested from VP:', list.length - 1, 'videos');

            // Gap-fill: if multi-segment current ep has missing segs, search them
            if (info.totalSeg && info.totalSeg > 1) {
                const presentSegs = new Set(
                    list.filter(e => e.episode === info.episode).map(e => e.segment)
                );
                const missing = [];
                for (let s = 1; s <= info.totalSeg; s++) {
                    if (!presentSegs.has(s)) missing.push(s);
                }
                if (missing.length) {
                    const partStr = info.season ? ` - P${info.season}` : '';
                    const q = Search.mkQuery(`${info.series} tập ${info.episode}${partStr}`, channel);
                    _ingest(await Search.search(q));
                }
            }
        } else {
            // Path B: search-based fallback — window [-5, +10] quanh tập hiện tại.
            // Cố ý bất đối xứng: ưu tiên tìm các tập PHÍA SAU (marathon/auto-next
            // cần next nhiều hơn prev), lùi chỉ cần đủ để out-of-order guard hoạt động.
            const partStr = info.season ? ` - P${info.season}` : '';
            const lo = Math.max(1, info.episode - 5);
            const hi = info.episode + 10;
            const queries = new Set();

            for (let ep = lo; ep <= hi; ep++) {
                if (ep === info.episode) continue;
                queries.add(Search.mkQuery(`${info.series} tập ${ep}${partStr}`, channel));
            }
            // Also a broad query to catch surrounding eps in one shot
            queries.add(Search.mkQuery(`${info.series} tập${partStr}`, channel));

            const results = await Promise.all([...queries].map(q => Search.search(q)));
            for (const r of results) _ingest(r);
        }

        const sorted = _sortByEpSeg(list);
        _cacheList(seriesKey, sorted);
        log('[EpisodeEngine] built list, size:', sorted.length);
        return sorted;
    }

    // ─── findNext ─────────────────────────────────────────────────────────────
    async function findNext(info, channel, list) {
        const partStr = info.season ? ` - P${info.season}` : '';

        // Case A: next segment of same episode
        if (info.segment && info.totalSeg && info.segment < info.totalSeg) {
            const nextSeg = info.segment + 1;
            // Check list first
            const fromList = list.find(e =>
                e.episode === info.episode && e.segment === nextSeg
            );
            if (fromList) return { url: fromList.url, title: fromList.title, source: 'cached' };
            // Search fallback
            const segQ = `${info.series} tập ${info.episode}${partStr} (${nextSeg}/${info.totalSeg})`;
            const res  = await Search.search(Search.mkQuery(segQ, channel));
            const hit  = res.find(v => {
                const p = parseTitle(v.title);
                return p.episode === info.episode && p.segment === nextSeg;
            });
            if (hit) return { url: `https://youtu.be/${hit.videoId}`, title: hit.title, source: 'segment' };
            return null;
        }

        // Case B: next episode from cache
        const nextEp = info.episode + 1;
        const fromList = list
            .filter(e => e.episode === nextEp && _seasonMatch(e, info))
            .sort((a, b) => (a.segment || 0) - (b.segment || 0));
        if (fromList.length) {
            return { url: fromList[0].url, title: fromList[0].title, source: 'cached' };
        }

        // Case C: search fallback
        const q   = Search.mkQuery(`${info.series} tập ${nextEp}${partStr}`, channel);
        let   res = await Search.search(q);
        let   hits = res.filter(v => {
            const p = parseTitle(v.title);
            return p.episode === nextEp && _seriesMatch(p, info) && _seasonMatch(p, info);
        });

        if (!hits.length && channel) {
            // Retry without channel name
            res  = await Search.search(`${info.series} tập ${nextEp}${partStr}`);
            hits = res.filter(v => {
                const p = parseTitle(v.title);
                return p.episode === nextEp && _seriesMatch(p, info) && _seasonMatch(p, info);
            });
        }

        if (hits.length) {
            const chosen = hits.sort((a, b) => (parseTitle(a.title).segment || 0) - (parseTitle(b.title).segment || 0))[0];
            return { url: `https://youtu.be/${chosen.videoId}`, title: chosen.title, source: 'search' };
        }

        // Case D: try next season
        if (info.season) {
            const ns = info.season + 1;
            const sq = Search.mkQuery(`${info.series} tập 1 - P${ns}`, channel);
            const sr = await Search.search(sq);
            const sv = sr.find(v => {
                const p = parseTitle(v.title);
                return p.season === ns && _seriesMatch(p, info);
            });
            if (sv) return { url: `https://youtu.be/${sv.videoId}`, title: sv.title, source: 'newseason' };
        }

        return null;
    }

    // ─── findPrevious ─────────────────────────────────────────────────────────
    async function findPrevious(info, channel, list) {
        const prevEp  = info.episode - 1;
        if (prevEp < 1) return null;
        const partStr = info.season ? ` - P${info.season}` : '';

        // From cache: pick the last segment of prev ep
        const fromList = list
            .filter(e => e.episode === prevEp && _seasonMatch(e, info))
            .sort((a, b) => (b.segment || 0) - (a.segment || 0));
        if (fromList.length) {
            return { url: fromList[0].url, title: fromList[0].title, episode: prevEp };
        }

        // Search fallback
        const q   = Search.mkQuery(`${info.series} tập ${prevEp}${partStr}`, channel);
        const res = await Search.search(q);
        const hits = res
            .filter(v => {
                const p = parseTitle(v.title);
                return p.episode === prevEp && _seriesMatch(p, info) && _seasonMatch(p, info);
            })
            .sort((a, b) => (parseTitle(b.title).segment || 0) - (parseTitle(a.title).segment || 0));

        if (!hits.length) return null;
        return { url: `https://youtu.be/${hits[0].videoId}`, title: hits[0].title, episode: prevEp };
    }

    // ─── Main run ─────────────────────────────────────────────────────────────
    async function run(info, channel, seriesKey) {
        log('[EpisodeEngine] run:', info.series, 'S', info.season, 'ep', info.episode);

        // 1. Build virtual playlist — ưu tiên playlist ĐÃ BIẾT từ URL hiện tại
        // (param `list=`), vì khi YouTube tự gắn video vào ngữ cảnh playlist,
        // đó gần như chắc chắn là playlist trọn bộ đúng series — nhanh hơn và
        // chính xác hơn nhiều so với phải search bằng tên series (build()).
        const knownPlaylistId = new URLSearchParams(location.search).get('list');
        let vpData;
        if (knownPlaylistId) {
            vpData = await VirtualPlaylist.buildFromKnownPlaylist(info.series, knownPlaylistId);
            // Nếu playlist đã biết không trả được gì hữu ích (playlist riêng
            // tư, đã xoá, hoặc không thực sự chứa series này), fallback về
            // build() thông thường thay vì bỏ cuộc.
            if (!vpData?.length) vpData = await VirtualPlaylist.build(info.series);
        } else {
            vpData = await VirtualPlaylist.build(info.series);
        }

        // 2. Build episode list (series-scoped cache)
        const list = await _buildList(info, channel, seriesKey, vpData);
        EventBus.emit('playlistReady', { list });

        // 3. Find prev first (fast from cache, no UI dependency)
        const prev = await findPrevious(info, channel, list);
        if (prev) EventBus.emit('prevFound', prev);

        // 4. Find next
        const next = await findNext(info, channel, list);
        if (next) {
            EventBus.emit('nextFound', next);
        } else {
            const ap = getYouTubeAutoplay();
            if (ap) EventBus.emit('nextFound', { ...ap, source: 'autoplay' });
            else     EventBus.emit('nextNotFound');
        }

        // 5. Missing detection — runs after list is complete
        const missing = detectMissingEpisodes(list);
        if (missing.episodes.length || missing.segments.length) {
            EventBus.emit('missingDetected', missing);
        }
    }

    /** Invalidate list cache for a series (e.g. user force-refresh) */
    function invalidateList(seriesKey) { _listCache.delete(seriesKey); }

    return { run, findNext, findPrevious, invalidateList };
})();
