// virtual-playlist.js — Layer 2: Fetch & cache YouTube playlist videos per series
// Cache được scoped theo series name và stored qua Storage module.

const VirtualPlaylist = (() => {
    // Giới hạn số playlist xử lý mỗi lần build, để tránh fetch tràn lan
    // khi search trả về nhiều playlist không liên quan (false positive).
    const MAX_PLAYLISTS_PER_SERIES = 5;

    // ─── In-memory cache (L1), Storage is L2 ─────────────────────────────────
    /** @type {Map<string, {data: Array, timestamp: number}>} */
    const _memCache = new Map();

    function _memKey(seriesName) { return seriesName.toLowerCase().trim(); }

    async function _fetchPlaylistsForSeries(seriesName) {
        const url  = `https://www.youtube.com/results?search_query=${encodeURIComponent(seriesName + ' playlist')}&sp=EgQQA1AB`;
        const html = await (await fetch(url)).text();
        const m    = html.match(/var ytInitialData\s*=\s*({.*?});/s);
        if (!m) return [];
        const playlists = [];
        try {
            const sections = JSON.parse(m[1])
                ?.contents?.twoColumnSearchResultsRenderer
                ?.primaryContents?.sectionListRenderer?.contents ?? [];
            for (const sec of sections) {
                for (const item of sec?.itemSectionRenderer?.contents ?? []) {
                    const pr = item.playlistRenderer;
                    if (pr) playlists.push({
                        title:      pr.title?.simpleText || '',
                        playlistId: pr.playlistId,
                        videoCount: parseInt(pr.videoCount) || 0,
                    });
                }
            }
        } catch (e) { warn('[VirtualPlaylist] parse playlists error:', e); }
        return playlists;
    }

    async function _fetchVideosFromPlaylist(playlistId) {
        const videos = [];

        const _continuation = async (token) => {
            const resp = await fetch(
                'https://www.youtube.com/youtubei/v1/browse?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
                {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        context:      { client: { clientName: 'WEB', clientVersion: '2.20250610.00.00' } },
                        continuation: token,
                    }),
                }
            );
            return resp.json();
        };

        const _extractVideos = (data) => {
            for (const tab of data?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? []) {
                const items = tab?.tabRenderer?.content?.sectionListRenderer?.contents
                    ?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;
                if (items) {
                    for (const item of items) {
                        const vr = item?.playlistVideoRenderer;
                        if (vr?.videoId) videos.push({ title: vr.title?.runs?.[0]?.text || '', videoId: vr.videoId, _seq: videos.length });
                    }
                }
            }
            return data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]
                ?.tabRenderer?.content?.sectionListRenderer?.continuations
                ?.[0]?.nextContinuationData?.continuation ?? null;
        };

        const _extractContinuationVideos = (data) => {
            let cont = null;
            for (const action of data?.onResponseReceivedActions ?? []) {
                for (const item of action?.appendContinuationItemsAction?.continuationItems ?? []) {
                    const vr = item?.playlistVideoRenderer;
                    if (vr?.videoId) videos.push({ title: vr.title?.runs?.[0]?.text || '', videoId: vr.videoId, _seq: videos.length });
                }
                cont = action?.appendContinuationItemsAction?.continuation ?? cont;
            }
            return cont;
        };

        try {
            const html = await (await fetch(`https://www.youtube.com/playlist?list=${playlistId}`)).text();
            const m = html.match(/var ytInitialData\s*=\s*({.*?});/s);
            if (!m) return videos;
            let cont = _extractVideos(JSON.parse(m[1]));
            let attempts = 0;
            while (cont && attempts < 200) {
                cont = _extractContinuationVideos(await _continuation(cont));
                attempts++;
            }
        } catch (e) { warn('[VirtualPlaylist] fetch error:', e); }

        log(`[VirtualPlaylist] fetched ${videos.length} videos from playlist ${playlistId}`);
        return videos;
    }

    function _dedupAndSort(videos) {
        const seen   = new Set();
        const unique = [];
        for (const v of videos) {
            if (!seen.has(v.videoId)) { seen.add(v.videoId); unique.push(v); }
        }
        unique.sort((a, b) => {
            const pa = parseTitle(a.title), pb = parseTitle(b.title);
            if (!pa.episode && !pb.episode) return 0;
            if (!pa.episode) return 1;
            if (!pb.episode) return -1;
            if (pa.episode !== pb.episode) return pa.episode - pb.episode;
            return (pa.segment || 0) - (pb.segment || 0);
        });
        return unique;
    }

    /**
     * Build (or return cached) virtual playlist for a series.
     * Cache hierarchy: in-memory (session) → Storage (persisted, 6h TTL).
     * @param {string} seriesName
     * @returns {Promise<Array<{title:string, videoId:string}>>}
     */
    async function build(seriesName) {
        const mKey = _memKey(seriesName);

        // L1 check
        const memHit = _memCache.get(mKey);
        if (memHit && Date.now() - memHit.timestamp < VP_CACHE_TTL) {
            log('[VirtualPlaylist] L1 hit:', seriesName);
            return memHit.data;
        }

        // L2 check (Storage)
        const stored = Storage.getVirtualPlaylistCache(seriesName);
        if (stored) {
            log('[VirtualPlaylist] L2 hit:', seriesName);
            _memCache.set(mKey, { data: stored, timestamp: Date.now() });
            return stored;
        }

        log('[VirtualPlaylist] building:', seriesName);
        const rawPlaylists = await _fetchPlaylistsForSeries(seriesName);

        // Lọc playlist rác: bỏ playlist quá nhỏ và tên không liên quan tới series
        const nameHint = seriesName.toLowerCase().trim();
        const playlists = rawPlaylists
            .filter(pl => pl.videoCount >= 2 && pl.title && pl.title.toLowerCase().includes(nameHint.split(' ')[0]))
            .sort((a, b) => b.videoCount - a.videoCount)
            .slice(0, MAX_PLAYLISTS_PER_SERIES);

        log(`[VirtualPlaylist] ${rawPlaylists.length} playlist tìm thấy, dùng ${playlists.length} sau lọc`);

        let allVideos = [];
        for (const pl of playlists) {
            allVideos = allVideos.concat(await _fetchVideosFromPlaylist(pl.playlistId));
        }
        const result = _dedupAndSort(allVideos);

        _memCache.set(mKey, { data: result, timestamp: Date.now() });
        Storage.saveVirtualPlaylistCache(seriesName, result);
        return result;
    }

    /**
     * Build playlist từ 1 playlistId ĐÃ BIẾT CHẮC (ví dụ lấy từ URL param
     * `list=` của video đang xem — khi YouTube tự gắn video vào ngữ cảnh
     * playlist, đó gần như chắc chắn là playlist trọn bộ đúng series).
     * Nhanh hơn build() thông thường vì bỏ qua hoàn toàn bước search + rank
     * playlist ứng viên — chỉ có 1 network call (playlist page) thay vì 2+
     * (search rồi mới fetch từng playlist ứng viên).
     * @param {string} seriesName dùng làm cache key, giống build()
     * @param {string} playlistId
     * @returns {Promise<Array<{title:string, videoId:string}>>}
     */
    async function buildFromKnownPlaylist(seriesName, playlistId) {
        const mKey = _memKey(seriesName);

        const memHit = _memCache.get(mKey);
        if (memHit && Date.now() - memHit.timestamp < VP_CACHE_TTL) {
            log('[VirtualPlaylist] L1 hit (known playlist path):', seriesName);
            return memHit.data;
        }
        const stored = Storage.getVirtualPlaylistCache(seriesName);
        if (stored) {
            log('[VirtualPlaylist] L2 hit (known playlist path):', seriesName);
            _memCache.set(mKey, { data: stored, timestamp: Date.now() });
            return stored;
        }

        log('[VirtualPlaylist] fetch trực tiếp từ playlist đã biết:', playlistId);
        const videos = await _fetchVideosFromPlaylist(playlistId);
        const result = _dedupAndSort(videos);

        // Chỉ cache nếu playlist THỰC SỰ liên quan tới series này — kiểm tra
        // bằng cách parse vài title đầu xem có chứa tên series không. Không
        // chỉ dựa vào result.length > 0, vì URL's `list=` có thể trỏ tới 1
        // playlist khác chủ đề hoàn toàn (ví dụ user click nhầm từ gợi ý) —
        // nếu cache nhầm ở đây, mọi lần gọi build(seriesName) sau đó (kể cả
        // qua nhánh search bình thường) sẽ đọc phải cache sai vĩnh viễn cho
        // tới khi TTL hết hạn.
        const nameHint = seriesName.toLowerCase().trim().split(' ')[0];
        const looksRelevant = result.some(v => (v.title || '').toLowerCase().includes(nameHint));

        if (result.length && looksRelevant) {
            _memCache.set(mKey, { data: result, timestamp: Date.now() });
            Storage.saveVirtualPlaylistCache(seriesName, result);
        } else if (result.length && !looksRelevant) {
            log('[VirtualPlaylist] playlist đã biết KHÔNG khớp series, bỏ qua cache:', playlistId);
            return []; // để caller tự fallback sang build() (search) thay vì dùng data sai
        }
        return result;
    }

    /** Invalidate caches for a series (e.g. user triggered refresh). */
    function invalidate(seriesName) {
        _memCache.delete(_memKey(seriesName));
        // Storage TTL will naturally expire; no direct delete API needed.
    }

    return { build, buildFromKnownPlaylist, invalidate };
})();
