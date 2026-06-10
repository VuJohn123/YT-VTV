// ==UserScript==
// @name         VTV Giải Trí Ultimate
// @namespace    https://github.com/VuJohn123/YT-VTV
// @version      7.4
// @description  Marathon, voice, PiP, movable UI, keyboard, profile, GIF, audio mode, virtual playlist, stats, missing episodes...
// @author       VuJohn123
// @match        https://www.youtube.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        unsafeWindow
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/utils.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/channel-detect.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/search.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/episode-navigator.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/storage.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/ui.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/adblock.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/smart-features.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/keyboard.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/detectors.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/audio-mode.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/pip.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/virtual-playlist.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/stats.js
// @require      https://raw.githubusercontent.com/VuJohn123/YT-VTV/main/modules/missing-detector.js
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    async function main() {
        // Dọn dẹp state từ lần chạy trước
        cancelRedirect();
        stopWatchTimer();
        resetAudioMode();

        State.nextUrl      = null;
        State.nextTitle    = '';
        State.previousEp   = null;
        State.episodeList  = [];
        State.adVideoDetected = false;

        if (!State.panel) createPanel();
        else if (!State.uiHidden) renderSearching();

        State.channelName = await waitForChannel();
        if (State.channelName !== TARGET_CHANNEL) {
            setTitle('❌ Sai kênh');
            setBody(`<div>${escapeHTML(State.channelName) || 'Không xác định'}</div>`);
            return;
        }

        const rawTitle = (
            document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.getAttribute('title') ||
            document.title
        ).replace(/\s*-\s*YouTube$/, '').trim();
        log('Raw title:', rawTitle);

        if (document.querySelector('ytd-message-renderer #message') || document.body.innerText.includes('Video unavailable')) {
            setTitle('⚠️ Video không khả dụng');
            setBody('<div>Video bị gỡ hoặc riêng tư.</div>');
            addToggles('vtv-panel-content');
            return;
        }

        const info = parseTitle(rawTitle);
        if (!info.episode) {
            const ap = getYouTubeAutoplay();
            if (ap) {
                setTitle('🎞️ Gợi ý YouTube');
                const body = document.getElementById('vtv-ult-body');
                if (body) {
                    body.innerHTML = '';
                    const titleDiv = document.createElement('div');
                    titleDiv.className = 'next-title';
                    titleDiv.textContent = ap.title;
                    const skipBtn = document.createElement('button');
                    skipBtn.textContent = '⏭ Xem ngay';
                    skipBtn.addEventListener('click', () => { window.location.href = ap.url; });
                    body.appendChild(titleDiv);
                    body.appendChild(skipBtn);
                }
                State.nextUrl   = ap.url;
                State.nextTitle = ap.title;
            } else {
                setBody('<div class="title">❌ Không nhận dạng được tập phim</div>');
            }
            addToggles('vtv-panel-content');
            setupMonitoring();
            return;
        }

        State.parsedInfo = info;
        State.seriesKey  = `${info.series}|S${info.season ?? 0}`;
        addToHistory(State.seriesKey, info.episode, location.href, rawTitle);

        const epType = detectEpisodeType(rawTitle);
        log('Episode type:', epType);

        let desc = '';
        try { desc = (unsafeWindow.ytInitialPlayerResponse?.videoDetails?.shortDescription) || ''; } catch(e) {}
        log('Genres:', detectGenres(desc));

        // Tìm điều hướng song song
        const [prevResult, listResult, nextResult] = await Promise.allSettled([
            findPrevious(info, State.channelName),
            findEpisodeList(info, State.channelName),
            findNext(info, State.channelName),
        ]);

        State.previousEp  = prevResult.status  === 'fulfilled' ? prevResult.value  : null;
        State.episodeList = listResult.status  === 'fulfilled' ? listResult.value  : [];
        const next        = nextResult.status  === 'fulfilled' ? nextResult.value  : null;

        if (next) {
            State.nextUrl   = next.url;
            State.nextTitle = next.title;
            renderFound(State.nextTitle, State.nextUrl, next.source);
            // Prefetch trang kế
            const link = document.createElement('link');
            link.rel  = 'prefetch';
            link.href = State.nextUrl;
            document.head.appendChild(link);
            storeSeries(State.seriesKey, info.episode, State.nextUrl, State.nextTitle);
        } else {
            setTitle('❌ Không tìm thấy tập kế');
            setBody(`
                <input type="text" id="vtv-manual" placeholder="Tìm tập...">
                <button id="vtv-manual-btn">Tìm</button>
                <div id="vtv-panel-content"></div>
            `);
            document.getElementById('vtv-manual-btn')?.addEventListener('click', async () => {
                const q = document.getElementById('vtv-manual')?.value.trim();
                if (!q) return;
                const res = await searchYT(q);
                const c   = document.getElementById('vtv-panel-content');
                if (!c) return;
                c.innerHTML = '';
                const title = document.createElement('b');
                title.textContent = 'Kết quả:';
                const ul = document.createElement('ul');
                ul.className = 'episode-list';
                for (const r of res) {
                    const a  = document.createElement('a');
                    a.href        = `https://youtu.be/${r.videoId}`;
                    a.textContent = r.title;
                    ul.appendChild(Object.assign(document.createElement('li'), {})).appendChild(a);
                }
                c.appendChild(title);
                c.appendChild(ul);
            });
            addToggles('vtv-panel-content');
            const ap = getYouTubeAutoplay();
            if (ap) { State.nextUrl = ap.url; State.nextTitle = ap.title; }
        }

        // Hiển thị tập thiếu
        const missing = detectMissingEpisodes(State.episodeList);
        if (missing.length) {
            const c = document.getElementById('vtv-panel-content');
            if (c) {
                const warn = document.createElement('div');
                warn.innerHTML = `<br><b>⚠️ Tập bị thiếu:</b> ${missing.join(', ')}`;
                c.appendChild(warn);
            }
        }

        setupMonitoring();
        scrollToCurrentInPlaylist();

        if (State.voiceEnabled) initVoiceControl();
        if (State.audioMode)   enableAudioMode();
        if (State.pipEnabled)  enableAutoPiP();
    }

    // ── Navigation: fix race condition với pending flag ──
    let _navigatePending = false;

    function onNavigate() {
        if (location.pathname !== '/watch') return;
        const vid = new URLSearchParams(location.search).get('v');
        if (vid === State.lastVid || _navigatePending) return;

        _navigatePending = true;
        setTimeout(() => {
            _navigatePending = false;
            const currentVid = new URLSearchParams(location.search).get('v');
            if (currentVid !== vid) return; // đã navigate tiếp rồi
            State.lastVid = currentVid;
            main();
        }, 800);
    }

    // ── Bootstrap ──
    setupProfiles();
    setupKeyboardShortcuts();

    if (location.pathname === '/watch') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(main, 500));
        else setTimeout(main, 500);
    }
    document.addEventListener('yt-navigate-finish', onNavigate);

    if (State.marathon) { document.body.classList.add('vtv-marathon'); startAdBlocking(); }

    window.addEventListener('beforeunload', () => {
        stopWatchTimer();   // flush watch time trước khi rời trang
        stopAdBlocking();
        stopVoiceControl();
    });
})();
