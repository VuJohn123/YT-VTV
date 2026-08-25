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
        // L2: RAM miss (thường do vừa hard-reload — _listCache là Map trong
        // memory, mất sạch khi trang tải lại) — thử GM storage trước khi
        // đành build lại từ đầu (search song song nhiều query, tốn thời gian
        // nhất trong toàn bộ flow "Đang tìm...").
        const persisted = Storage.getEpisodeListCache(seriesKey);
        if (persisted) {
            log('[EpisodeEngine] list cache hit (L2 persisted):', seriesKey, persisted.length, 'eps');
            _listCache.set(seriesKey, { list: persisted, timestamp: Date.now() }); // nạp lại lên L1
            return persisted;
        }
        return null;
    }

    function _cacheList(seriesKey, list) {
        _listCache.set(seriesKey, { list, timestamp: Date.now() });
        Storage.saveEpisodeListCache(seriesKey, list);
    }

    // ─── Similarity scoring (bag-of-words Jaccard) ─────────────────────────────
    // "Học máy đơn giản" theo đúng nghĩa: không neural network, không training
    // — nhưng bag-of-words similarity là kỹ thuật CÓ THẬT trong text
    // classification cổ điển (trước deep learning), mạnh hơn substring/prefix
    // match ở chỗ: bền với đảo từ ("Về Nắng Ngày Thương" vẫn khớp "Thương Ngày
    // Nắng Về"), bền với khoảng trắng/dấu câu thừa, và không bị "gãy" hoàn
    // toàn chỉ vì 1-2 ký tự đầu khác (khác với prefix-match hiện có). Regex
    // exact/substring cũ VẪN GIỮ NGUYÊN chạy trước (rẻ hơn, đủ dùng cho phần
    // lớn trường hợp) — Jaccard chỉ là lớp bổ sung khi 2 cái đó đều thất bại.
    const MIN_TOKENS_FOR_JACCARD = 2; // tên series quá ngắn (1 từ) dễ false-positive, không áp dụng
    const JACCARD_THRESHOLD = 0.5;

    function _tokenSet(s) {
        return new Set(
            (s || '').toLowerCase().normalize('NFC')
                .replace(/[.,!?;:'"()\[\]…\-–]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length >= 2)
        );
    }

    function _jaccardRaw(a, b) {
        const setA = _tokenSet(a), setB = _tokenSet(b);
        if (setA.size < MIN_TOKENS_FOR_JACCARD || setB.size < MIN_TOKENS_FOR_JACCARD) {
            return { score: 0, sizeA: setA.size, sizeB: setB.size, intersection: 0, union: 0 };
        }
        let intersection = 0;
        for (const w of setA) if (setB.has(w)) intersection++;
        const union = setA.size + setB.size - intersection;
        return { score: union === 0 ? 0 : intersection / union, sizeA: setA.size, sizeB: setB.size, intersection, union };
    }

    // Giữ nguyên chữ ký cũ (trả về số, không phải object) — dùng ở chỗ chỉ
    // cần điểm số, và để KHÔNG phá vỡ API/test hiện có
    // (tests/series-jaccard.test.js gọi trực tiếp qua _internal, kỳ vọng trả
    // về number). `_jaccardRaw` bên trên mới có đủ thành phần thô
    // (sizeA/sizeB/intersection/union) cho SimilarityReport — xem _seriesMatch.
    function _jaccardSimilarity(a, b) {
        return _jaccardRaw(a, b).score;
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function _seriesMatch(parsed, info, description, seriesKey) {
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

        // Bag-of-words similarity — bắt được trường hợp substring/prefix bó
        // tay: đảo thứ tự từ, viết tắt xen kẽ, dấu câu khác nhau... mà vẫn rõ
        // ràng là "gần như cùng 1 cụm từ" khi nhìn theo tập hợp từ.
        const raw = _jaccardRaw(a, b);
        const jaccard = raw.score;
        if (jaccard >= JACCARD_THRESHOLD) {
            log('[EpisodeEngine] series match qua Jaccard similarity (', jaccard.toFixed(2), '):', a, '≈', b);
            SimilarityReport.report({
                a, b, jaccard, source: 'jaccard', matched: true,
                // Thành phần THÔ của Jaccard (không chỉ điểm số cuối) — cho
                // phép tính lại các độ đo khác (Dice, overlap coefficient...)
                // từ dữ liệu ĐÃ CÓ sau này mà không cần bản userscript mới
                // report lại theo format khác — "gain toàn bộ info hữu ích"
                // ngay từ đầu thay vì phải sửa đi sửa lại schema.
                sizeA: raw.sizeA, sizeB: raw.sizeB, intersection: raw.intersection, union: raw.union,
            });
            return true;
        }
        // Report cả case KHÔNG match (jaccard > 0 nghĩa là có ít nhất 1 từ
        // chung — "gần trúng" thật sự đáng để phân tích khi tinh chỉnh
        // JACCARD_THRESHOLD sau này, KHÁC với jaccard = 0 tức 2 chuỗi chẳng
        // liên quan gì — bỏ qua case đó để không làm loãng histogram/tốn
        // quota ghi free tier bằng dữ liệu vô nghĩa). Không có report này
        // thì /stats chỉ thấy được phân bố của các case ĐÃ match — không đủ
        // để biết ngưỡng 0.5 hiện tại có đang bỏ sót hay bắt nhầm quá nhiều.
        else if (jaccard > 0) {
            SimilarityReport.report({
                a, b, jaccard, source: 'jaccard', matched: false,
                sizeA: raw.sizeA, sizeB: raw.sizeB, intersection: raw.intersection, union: raw.union,
            });
        }

        // Fallback: string match thất bại hoàn toàn (title viết khác hẳn,
        // không có phần chung nào) — thử dùng SeriesLearner (tần suất tên
        // nhân vật đã học từ description các tập trước của series này).
        // Chỉ tin khi confidence > 50% (hơn nửa số từ đặc trưng khớp), để
        // tránh false positive từ 1-2 từ trùng ngẫu nhiên.
        if (description && seriesKey) {
            const cd = SeriesLearner.confidenceDetails(seriesKey, description);
            const confidence = cd.confidence;
            const extra = { matchedCharacters: cd.matchedCount, totalCharacters: cd.totalCharacters, sampleCount: cd.sampleCount };
            if (confidence > 0.5) {
                log('[EpisodeEngine] series match qua description (confidence', confidence.toFixed(2) + '):', parsed.series);
                SimilarityReport.report({ a, b, jaccard: confidence, source: 'learner', matched: true, ...extra });
                return true;
            } else if (confidence > 0) {
                SimilarityReport.report({ a, b, jaccard: confidence, source: 'learner', matched: false, ...extra });
            }
        }
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

        // _channelEq defined at module scope (dùng chung với findNext/findPrevious)

        const _add = (videoId, episode, season, title, url, isCurrent = false, segment = 0, totalSeg = 1, meta = {}) => {
            if (!videoId || seen.has(videoId)) return;

            const entry = {
                videoId, episode, season, title, url, isCurrent, segment, totalSeg,
                publishedText: meta.publishedText || '',
                lengthText: meta.lengthText || '',
                channelName: meta.channelName || '',
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
            // upload trùng tập — ví dụ style title cũ với description khác nhau,
            // hoặc 2 kênh VTV khác nhau cùng đăng lại). Giữ lại bản MỚI hơn theo
            // thời gian đăng, TRỪ KHI 1 trong 2 bản trùng đúng kênh đang xem còn
            // bản kia thì không — khi đó ưu tiên đúng kênh bất kể ngày đăng, vì
            // cùng kênh đồng nghĩa cùng định dạng/chất lượng/phong cách encode,
            // tránh nhảy giữa 2 kênh khác nhau (dù đều hợp lệ VTV) gây khó chịu
            // cho người xem — đúng vấn đề đã báo: "ưu tiên các tập có cùng
            // format/kênh, không được như này đâu nó rõ ràng là khác".
            const existing = list[dupIdx];
            if (existing.isCurrent) return; // không thay thế video đang xem

            const existingMatchesChannel = _channelEq(existing.channelName, channel);
            const entryMatchesChannel    = _channelEq(entry.channelName, channel);

            if (entryMatchesChannel && !existingMatchesChannel) {
                seen.delete(existing.videoId);
                seen.add(videoId);
                if (entry.season == null && existing.season != null) entry.season = existing.season;
                list[dupIdx] = entry;
                log('[EpisodeEngine] dup', groupKey, '→ ưu tiên ĐÚNG KÊNH:', title);
                return;
            }
            if (existingMatchesChannel && !entryMatchesChannel) {
                log('[EpisodeEngine] dup', groupKey, '→ giữ bản đúng kênh, bỏ qua kênh khác:', title);
                return;
            }

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

                // ── FIX BUG THẬT: chặn ứng viên sai kênh TRƯỚC khi accept ──
                // Trước đây _ingest() chỉ so khớp TIÊU ĐỀ (_seriesMatch) — nếu 1
                // kênh HOÀN TOÀN KHÁC (vd kênh đọc truyện audio) có video trùng
                // tên series + đúng định dạng "tập N", nó vẫn được coi là ứng
                // viên hợp lệ và có thể được auto-navigate tới (ChannelDetect chỉ
                // verify SAU KHI đã landing ở trang mới — quá trễ, user đã bị kéo
                // sang kênh lạ). isVTVChannel() (utils.js) dùng CHUNG whitelist
                // với luồng verify chính, đảm bảo nhất quán 1 nguồn sự thật duy
                // nhất về "kênh nào được coi là VTV".
                // Bỏ qua video KHÔNG có channelId lấy được (search.js cũ hơn
                // hoặc field bị thiếu) — chấp nhận rủi ro nhỏ còn hơn chặn nhầm
                // toàn bộ kết quả hợp lệ chỉ vì thiếu 1 field phụ.
                if (v.channelId && !isVTVChannel(v.channelName, v.channelId)) {
                    log('[EpisodeEngine] Bỏ qua ứng viên sai kênh:', v.channelName, '—', v.title);
                    continue;
                }

                const p = parseTitle(v.title || '');
                if (!p.episode) continue;

                // Kiểm tra match qua string TRƯỚC (không dùng description) để
                // biết đây có phải "match chắc chắn" hay "match qua learner" —
                // chỉ học từ description của video match CHẮC CHẮN, tránh vòng
                // lặp tự củng cố (nếu học từ video match nhờ chính learner, sai
                // sót ban đầu sẽ tự khuếch đại qua thời gian).
                const strictMatch = _seriesMatch(p, info);
                const matched = strictMatch || _seriesMatch(p, info, v.description, seriesKey);
                if (!matched) continue;
                if (!_seasonMatch(p, info)) continue;

                if (strictMatch && v.description) SeriesLearner.learn(seriesKey, v.description);

                _add(
                    v.videoId, p.episode, p.season,
                    v.title,
                    v.url || `https://youtu.be/${v.videoId}`,
                    false,
                    p.segment || 0, p.totalSeg || 1,
                    { publishedText: v.publishedText, lengthText: v.lengthText, _seq: v._seq, channelName: v.channelName }
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

    const _channelEq = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

    /** Sort ưu tiên: cùng kênh với `channel` lên trước, rồi mới tới segment thấp trước. */
    function _sortPreferChannel(items, channel, getChannelName, getSegment) {
        return items.slice().sort((a, b) => {
            const aMatch = _channelEq(getChannelName(a), channel);
            const bMatch = _channelEq(getChannelName(b), channel);
            if (aMatch !== bMatch) return aMatch ? -1 : 1;
            return getSegment(a) - getSegment(b);
        });
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
        const fromList = _sortPreferChannel(
            list.filter(e => e.episode === nextEp && _seasonMatch(e, info)),
            channel, e => e.channelName, e => e.segment || 0
        );
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
            const chosen = _sortPreferChannel(hits, channel, v => v.channelName, v => parseTitle(v.title).segment || 0)[0];
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

        // From cache: pick the last segment of prev ep, ưu tiên cùng kênh trước
        const fromList = _sortPreferChannel(
            list.filter(e => e.episode === prevEp && _seasonMatch(e, info)),
            channel, e => e.channelName, e => -(e.segment || 0) // âm để "segment cao nhất" đứng trước sau khi ưu tiên kênh
        );
        if (fromList.length) {
            return { url: fromList[0].url, title: fromList[0].title, episode: prevEp };
        }

        // Search fallback
        const q   = Search.mkQuery(`${info.series} tập ${prevEp}${partStr}`, channel);
        const res = await Search.search(q);
        const hits = _sortPreferChannel(
            res.filter(v => {
                const p = parseTitle(v.title);
                return p.episode === prevEp && _seriesMatch(p, info) && _seasonMatch(p, info);
            }),
            channel, v => v.channelName, v => -(parseTitle(v.title).segment || 0)
        );

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
    function invalidateList(seriesKey) { _listCache.delete(seriesKey); Storage.clearEpisodeListCache(seriesKey); }

    return {
        run, findNext, findPrevious, invalidateList,
        _internal: { _seriesMatch, _jaccardSimilarity, _jaccardRaw },
    };
})();
