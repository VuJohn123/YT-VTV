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
            h.push({ episode, url, title });
            set('history_' + seriesKey, JSON.stringify(h));
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
    /** @returns {{autoPlay,marathon,autoSkip,voiceEnabled,audioMode,pipEnabled}} */
    function getFeatureFlags() {
        return {
            autoPlay:     getGlobal('auto',      true),
            marathon:     getGlobal('marathon',  false),
            autoSkip:     getGlobal('autoskip',  false),
            voiceEnabled: getGlobal('voice',     true),
            audioMode:    getGlobal('audioMode', false),
            pipEnabled:   getGlobal('pip',       true),
        };
    }

    function saveFlag(key, value) { setGlobal(key, value); }

    return {
        get, set, del,
        getGlobal, setGlobal,
        currentProfile, switchProfile, setupProfileMenu,
        getSeries, saveSeries, clearSeries,
        getHistory, addToHistory,
        getSkipData, learnSkip,
        addStats, getProgress,
        addToWatchLater, getWatchLater,
        getNotes, addNote,
        getVirtualPlaylistCache, saveVirtualPlaylistCache,
        getUIPrefs, saveUIPrefs,
        getFeatureFlags, saveFlag,
    };
})();
