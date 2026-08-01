// storage.js — Layer 1: Profile-aware persistence
// Tất cả GM_getValue / GM_setValue đi qua module này.
// Các module khác KHÔNG gọi GM_getValue/setValue trực tiếp.

const Storage = (() => {
    // ─── Profile ──────────────────────────────────────────────────────────────
    let _currentProfile = GM_getValue('vtvUlt_currentProfile', 'default');

    function _prefix() { return `vtvUlt_${_currentProfile}_`; }

    /** Get a profile-scoped value. @param {string} key @param {*} [def] */
    function get(key, def) { return GM_getValue(_prefix() + key, def); }

    /** Set a profile-scoped value. @param {string} key @param {*} value */
    function set(key, value) { GM_setValue(_prefix() + key, value); }

    /** Delete a profile-scoped value. @param {string} key */
    function del(key) { GM_deleteValue(_prefix() + key); }

    /** Get a global (non-profile) value. */
    function getGlobal(key, def) { return GM_getValue('vtvUlt_' + key, def); }

    /** Set a global (non-profile) value. */
    function setGlobal(key, value) { GM_setValue('vtvUlt_' + key, value); }

    function currentProfile() { return _currentProfile; }

    function switchProfile(name) {
        _currentProfile = name;
        GM_setValue('vtvUlt_currentProfile', name);
        const profiles = GM_getValue('vtvUlt_profiles', ['default']);
        if (!profiles.includes(name)) { profiles.push(name); GM_setValue('vtvUlt_profiles', profiles); }
        location.reload();
    }

    function setupProfileMenu() {
        GM_registerMenuCommand('Chọn Profile', () => {
            const profiles = GM_getValue('vtvUlt_profiles', ['default']);
            const newProfile = prompt(
                `Nhập tên profile (hiện tại: ${_currentProfile}).\nCác profile: ${profiles.join(', ')}`,
                _currentProfile
            );
            if (newProfile && newProfile !== _currentProfile) switchProfile(newProfile);
        });
    }

    // ─── Series state ─────────────────────────────────────────────────────────
    /** @returns {{lastEp:number, nextUrl:string, nextTitle:string}|null} */
    function getSeries(seriesKey) {
        const raw = get('series_' + seriesKey);
        if (!raw) return null;
        try { return JSON.parse(raw); }
        catch (e) { warn('Corrupt series data for', seriesKey); return null; }
    }

    function saveSeries(seriesKey, lastEp, nextUrl, nextTitle) {
        set('series_' + seriesKey, JSON.stringify({ lastEp, nextUrl, nextTitle }));
    }

    function clearSeries(seriesKey) { del('series_' + seriesKey); }

    // ─── Watch history ────────────────────────────────────────────────────────
    /** @returns {Array<{episode:number, url:string, title:string}>} */
    function getHistory(seriesKey) {
        const raw = get('history_' + seriesKey);
        if (!raw) return [];
        try { return JSON.parse(raw); }
        catch (e) { warn('Corrupt history for', seriesKey); return []; }
    }

    function addToHistory(seriesKey, episode, url, title) {
        const h = getHistory(seriesKey);
        if (!h.find(e => e.episode === episode)) {
            h.push({ episode, url, title, watchedAt: Date.now() });
            set('history_' + seriesKey, JSON.stringify(h));
        }
    }

    /**
     * Enumerate TOÀN BỘ series đã có lịch sử xem (cần GM_listValues vì
     * GM storage không có API "list theo prefix" trực tiếp, phải tự lọc).
     * @returns {Array<{seriesKey:string, episodes:Array}>}
     */
    function getAllHistory() {
        try {
            const p = _prefix(); // per-profile prefix, ví dụ 'vtvUlt_default_'
            const keys = GM_listValues().filter(k => k.startsWith(p + 'history_'));
            return keys.map(k => {
                const seriesKey = k.slice((p + 'history_').length);
                return { seriesKey, episodes: getHistory(seriesKey) };
            }).filter(s => s.episodes.length > 0);
        } catch (e) {
            warn('[Storage] Lỗi khi enumerate history:', e);
            return [];
        }
    }

    // ─── Skip data (intro/outro learning) ────────────────────────────────────
    /** @returns {{intros:number[], outros:number[], introAvg?:number, outroAvg?:number}} */
    function getSkipData(key) {
        const raw = GM_getValue('vtvUlt_skipData' + key, null);
        if (!raw) return { intros: [], outros: [] };
        try { return JSON.parse(raw); } catch (e) { return { intros: [], outros: [] }; }
    }

    function saveSkipData(key, data) { GM_setValue('vtvUlt_skipData' + key, JSON.stringify(data)); }

    /**
     * Đề xuất introAvg SỚM (từ tập đầu tiên) dựa trên ChapterDetector (phát
     * hiện khoảng lặng audio) — CHỦ Ý tách riêng khỏi `introAvg` (chỉ tính từ
     * ≥3 lần user THẬT SỰ tự skip, xem learnSkip). Không bao giờ ghi đè lên
     * introAvg đã có — suggested chỉ là gợi ý độ tin cậy thấp hơn nhiều (audio
     * có khoảng lặng không nhất thiết là hết intro — có thể là khoảng lặng
     * kịch tính giữa cảnh phim), dùng để HIỂN THỊ gợi ý cho user quyết định,
     * KHÔNG dùng để tự động seek im lặng như introAvg thật.
     */
    function saveSuggestedIntro(key, seconds) {
        const d = getSkipData(key);
        if (d.introAvg) return; // đã có dữ liệu thật đáng tin hơn, không cần gợi ý nữa
        if (d.introSuggested) return; // đã gợi ý rồi trong phiên trước, không ghi đè liên tục
        d.introSuggested = Math.round(seconds);
        saveSkipData(key, d);
    }

    function learnSkip(key, from, to, duration) {
        const d = getSkipData(key);
        if (from < 5 && to > 5 && to < duration * 0.5) {
            d.intros.push(to);
            if (d.intros.length >= 3)
                d.introAvg = Math.round(d.intros.reduce((a, b) => a + b, 0) / d.intros.length);
        } else if (to > duration - 10 && from < duration - 5) {
            d.outros.push(from);
            if (d.outros.length >= 3)
                d.outroAvg = Math.round(d.outros.reduce((a, b) => a + b, 0) / d.outros.length);
        }
        saveSkipData(key, d);
    }

    // ─── Series stats ─────────────────────────────────────────────────────────
    function getStats(seriesKey) {
        return GM_getValue('vtvUlt_stats_' + seriesKey, { totalTime: 0, episodes: {} });
    }

    function addStats(seriesKey, episode, duration) {
        const stats = getStats(seriesKey);
        stats.totalTime += duration || 0;
        if (episode) {
            if (!stats.episodes[episode]) stats.episodes[episode] = 0;
            stats.episodes[episode] += duration || 0;
        }
        GM_setValue('vtvUlt_stats_' + seriesKey, stats);
    }

    function getProgress(seriesKey, totalEpisodes) {
        const stats = getStats(seriesKey);
        const watched = Object.keys(stats.episodes).length;
        return totalEpisodes
            ? { watched, total: totalEpisodes, percent: Math.round(watched / totalEpisodes * 100) }
            : { watched, total: '?', percent: 0 };
    }

    // ─── Vị trí xem dở (continue-where-left-off) ──────────────────────────────
    // Riêng biệt với addStats (vốn track tổng THỜI GIAN đã xem cộng dồn, không
    // phải VỊ TRÍ hiện tại) — cần lưu currentTime/duration để tính % thật và
    // biết chính xác nên resume từ đâu.
    /** @returns {{episode:number, currentTime:number, duration:number, updatedAt:number}|null} */
    function getLastPosition(seriesKey) {
        return GM_getValue('vtvUlt_lastpos_' + seriesKey, null);
    }

    function saveLastPosition(seriesKey, episode, currentTime, duration, url) {
        // Không lưu nếu đã xem gần hết (>95%) — coi như đã xong tập, không cần
        // resume nữa, tránh hỏi "xem tiếp tập cũ" cho tập đã hoàn thành.
        if (duration > 0 && currentTime / duration > 0.95) {
            GM_deleteValue('vtvUlt_lastpos_' + seriesKey);
            return;
        }
        GM_setValue('vtvUlt_lastpos_' + seriesKey, { episode, currentTime, duration, url, updatedAt: Date.now() });
    }

    function clearLastPosition(seriesKey) { GM_deleteValue('vtvUlt_lastpos_' + seriesKey); }

    // ─── Watch later ──────────────────────────────────────────────────────────
    function getWatchLater() { return get('watchLater') || []; }

    function addToWatchLater(url, title) {
        const list = getWatchLater();
        if (!list.find(v => v.url === url)) {
            list.push({ url, title, added: Date.now() });
            set('watchLater', list);
            GM_notification({ text: 'Đã thêm vào Xem sau: ' + title, timeout: 2000 });
        }
    }

    // ─── Community notes ──────────────────────────────────────────────────────
    function getNotes(epKey) {
        let all;
        try { all = JSON.parse(GM_getValue('vtvUlt_communityNotes', '{}')); }
        catch (e) { all = {}; }
        if (epKey === undefined) return all;
        return all[epKey] || [];
    }

    function addNote(epKey, text) {
        const all = getNotes();
        if (!all[epKey]) all[epKey] = [];
        all[epKey].push({ text, time: Date.now() });
        GM_setValue('vtvUlt_communityNotes', JSON.stringify(all));
    }

    // ─── Virtual playlist cache ───────────────────────────────────────────────
    function getVirtualPlaylistCache(seriesName) {
        const raw = GM_getValue('vtvUlt_virtual_' + seriesName.replace(/\s+/g, '_'), null);
        if (!raw) return null;
        try {
            const data = JSON.parse(raw);
            if (Date.now() - data.timestamp < VP_CACHE_TTL) return data.videos;
            return null;
        } catch (e) { return null; }
    }

    function saveVirtualPlaylistCache(seriesName, videos) {
        GM_setValue(
            'vtvUlt_virtual_' + seriesName.replace(/\s+/g, '_'),
            JSON.stringify({ videos, timestamp: Date.now() })
        );
    }

    // ─── Episode list cache (L2 — sống sót qua hard reload) ───────────────────
    // EpisodeEngine đã có cache trong RAM (_listCache, mất khi trang reload).
    // Danh sách này là kết quả SAU dedup + SeriesLearner matching + search —
    // build lại tốn nhiều lệnh Search.search() song song. Persist ra GM storage
    // để hard-reload (fallback của Navigator khi SPA nav thất bại, hoặc user
    // F5 tay) không phải trả giá build lại từ đầu — chỉ VirtualPlaylist cache
    // (dữ liệu thô) được persist trước đây, còn list ĐÃ XỬ LÝ thì chưa.
    const EP_LIST_CACHE_TTL = 10 * 60_000; // đồng bộ với TTL cache RAM trong episode-navigator.js

    function getEpisodeListCache(seriesKey) {
        const raw = GM_getValue('vtvUlt_eplist_' + seriesKey.replace(/\s+/g, '_'), null);
        if (!raw) return null;
        try {
            const data = JSON.parse(raw);
            if (Date.now() - data.timestamp < EP_LIST_CACHE_TTL) return data.list;
            return null;
        } catch (e) { return null; }
    }

    function saveEpisodeListCache(seriesKey, list) {
        GM_setValue(
            'vtvUlt_eplist_' + seriesKey.replace(/\s+/g, '_'),
            JSON.stringify({ list, timestamp: Date.now() })
        );
    }

    function clearEpisodeListCache(seriesKey) {
        GM_deleteValue('vtvUlt_eplist_' + seriesKey.replace(/\s+/g, '_'));
    }

    // ─── Series learner data (thống kê từ đặc trưng học được từ description) ──
    // Không có TTL — dữ liệu học càng lâu càng chính xác, không nên tự hết hạn
    // như cache thông thường (khác VirtualPlaylist cache vốn cần refresh định kỳ
    // vì danh sách tập có thể thay đổi).
    function getLearnedData(seriesKey) {
        const raw = GM_getValue('vtvUlt_learn_' + seriesKey.replace(/\s+/g, '_'), null);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function saveLearnedData(seriesKey, data) {
        GM_setValue('vtvUlt_learn_' + seriesKey.replace(/\s+/g, '_'), JSON.stringify(data));
    }

    // ─── UI prefs ─────────────────────────────────────────────────────────────
    function getUIPrefs() {
        return {
            collapsed:      getGlobal('collapsed',  false),
            hidden:         getGlobal('hidden',     false),
            panelPos:       getGlobal('panelPos',   null),
        };
    }

    function saveUIPrefs(prefs) {
        for (const [k, v] of Object.entries(prefs)) setGlobal(k, v);
    }

    // ─── Feature flags (persisted toggles) ───────────────────────────────────
    /** @returns {{autoPlay,marathon,autoSkip,voiceEnabled,audioMode,pipEnabled,sponsorBlock}} */
    function getFeatureFlags() {
        return {
            autoPlay:     getGlobal('auto',      true),
            marathon:     getGlobal('marathon',  true), // "Chặn QC+" giờ mặc định BẬT theo yêu cầu — cùng nhóm với autoPlay/voice/PiP là 4 tính năng lõi cho trải nghiệm xem VTV thuận tiện nhất
            autoSkip:     getGlobal('autoskip',  false),
            voiceEnabled: getGlobal('voice',     true),
            audioMode:    getGlobal('audioMode', false),
            pipEnabled:   getGlobal('pip',       true),
            // Mặc định false: gọi network ra server bên thứ 3 (sponsor.ajay.app)
            // cho MỖI video, nên để user tự bật thay vì âm thầm bật sẵn.
            sponsorBlock: getGlobal('sponsorBlock', false),
            watchParty:   getGlobal('watchParty', false),
            chapterDetect: getGlobal('chapterDetect', false),
            tvMode:        getGlobal('tvMode', false),
        };
    }

    function saveFlag(key, value) { setGlobal(key, value); }

    // ─── Error log (persistent, capped ring buffer) ────────────────────────────
    // Trước đây lỗi trong EventBus handler chỉ console.warn — mất ngay khi
    // đóng DevTools, user không có cách nào tự xem lại để báo cho dev. Giờ
    // lưu lại 50 lỗi gần nhất, xem qua GM_registerMenuCommand (entry.js).
    const ERROR_LOG_MAX = 50;
    function logError(context, message) {
        // Hàm log KHÔNG BAO GIỜ được phép tự throw — nếu không sẽ che mất lỗi
        // gốc đang cố log, hoặc gây lỗi mới ngay trong error handler.
        try {
            const log = GM_getValue('vtvUlt_errorLog', []);
            log.push({ t: Date.now(), context, message: String(message).slice(0, 500) });
            while (log.length > ERROR_LOG_MAX) log.shift();
            GM_setValue('vtvUlt_errorLog', log);
        } catch (e) { /* best-effort, im lặng nếu chính việc log cũng lỗi */ }
    }
    function getErrorLog()   { return GM_getValue('vtvUlt_errorLog', []); }
    function clearErrorLog() { GM_setValue('vtvUlt_errorLog', []); }

    // ─── Version migration ──────────────────────────────────────────────────────
    // 1 nơi DUY NHẤT theo dõi lịch sử thay đổi format dữ liệu — trước đây mỗi
    // lần đổi format phải vá tạm ngay tại chỗ dùng (ví dụ migration sponsorBlock
    // flag từng nằm trong entry.js's one-time init) — dồn hết vào đây để dễ
    // theo dõi, dễ thêm bước mới mà không sợ quên nơi cũ.
    const CURRENT_SCHEMA_VERSION = 1;
    function runMigrations() {
        const last = GM_getValue('vtvUlt_schemaVersion', 0);
        if (last >= CURRENT_SCHEMA_VERSION) return;
        log('[Storage] Migrating dữ liệu:', last, '→', CURRENT_SCHEMA_VERSION);

        // 0 → 1: nút "Chặn QC+" (marathon) giờ điều khiển GỘP cả AdBlock lẫn
        // SponsorBlock (trước đây 2 flag tách biệt) — user đã bật marathon từ
        // trước khi có tính năng gộp cần được tự động bật luôn sponsorBlock
        // để không mất tính năng ngầm hiểu là "đã bật" theo UI mới.
        if (last < 1) {
            const flags = getFeatureFlags();
            if (flags.marathon && !flags.sponsorBlock) saveFlag('sponsorBlock', true);
        }

        GM_setValue('vtvUlt_schemaVersion', CURRENT_SCHEMA_VERSION);
        log('[Storage] Migration hoàn tất, schema hiện tại:', CURRENT_SCHEMA_VERSION);
    }

    return {
        get, set, del,
        getGlobal, setGlobal,
        currentProfile, switchProfile, setupProfileMenu,
        getSeries, saveSeries, clearSeries,
        getHistory, addToHistory, getAllHistory,
        getSkipData, saveSuggestedIntro, learnSkip,
        addStats, getStats, getProgress,
        getLastPosition, saveLastPosition, clearLastPosition,
        addToWatchLater, getWatchLater,
        getNotes, addNote,
        getVirtualPlaylistCache, saveVirtualPlaylistCache,
        getEpisodeListCache, saveEpisodeListCache, clearEpisodeListCache,
        getLearnedData, saveLearnedData,
        getUIPrefs, saveUIPrefs,
        getFeatureFlags, saveFlag,
        logError, getErrorLog, clearErrorLog,
        runMigrations,
    };
})();
