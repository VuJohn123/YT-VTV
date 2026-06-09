// ==UserScript==
// @name         VTV Giải Trí Ultimate
// @namespace    https://github.com/VuJohn123/YT-VTV
// @version      7.3
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

(function() {
    'use strict';

    // Khởi tạo biến trạng thái cho các toggle mới (các biến này phải được khai báo toàn cục trong utils.js, 
    // nhưng để tránh sửa nhiều file, ta khai báo lại ở đây nếu chưa có)
    if (typeof voiceEnabled === 'undefined') window.voiceEnabled = GM_getValue('vtvUlt_voice', true);
    if (typeof audioMode === 'undefined') window.audioMode = GM_getValue('vtvUlt_audioMode', false);
    if (typeof pipEnabled === 'undefined') window.pipEnabled = GM_getValue('vtvUlt_pip', true);

    async function main() {
        cancelRedirect();
        nextUrl = null; nextTitle = ''; previousEp = null; episodeList = [];
        adVideoDetected = false;
        if (!panel) createPanel(); else if (!uiHidden) renderSearching();

        channelName = await waitForChannel();
        if (channelName !== TARGET_CHANNEL) {
            setTitle('❌ Sai kênh');
            setBody(`<div>${channelName || 'Không xác định'}</div>`);
            return;
        }

        const rawTitle = (document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.getAttribute('title') || document.title)
            .replace(/\s*-\s*YouTube$/, '').trim();
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
                setBody(`<div class="next-title">${escapeHTML(ap.title)}</div><button id="vtv-skip">⏭ Xem ngay</button>`);
                document.getElementById('vtv-skip')?.addEventListener('click', () => { if (ap.url) window.location.href = ap.url; });
                nextUrl = ap.url; nextTitle = ap.title;
            } else {
                setBody('<div class="title">❌ Không nhận dạng được tập phim</div>');
            }
            addToggles('vtv-panel-content');
            setupMonitoring();
            return;
        }

        parsedInfo = info;
        seriesKey = `${info.series}|S${info.season ?? 0}`;
        addToHistory(seriesKey, info.episode, location.href, rawTitle);

        // Phân loại tập & thể loại
        const epType = detectEpisodeType(rawTitle);
        log('Episode type:', epType);
        let desc = '';
        try { desc = (unsafeWindow.ytInitialPlayerResponse?.videoDetails?.shortDescription) || ''; } catch(e) {}
        const genres = detectGenres(desc);
        log('Genres:', genres);
        updateSeriesStats(seriesKey, videoEl?.duration || 0);

        previousEp = await findPrevious(info, channelName);
        episodeList = await findEpisodeList(info, channelName);
        const next = await findNext(info, channelName);

        if (next) {
            nextUrl = next.url; nextTitle = next.title;
            renderFound(nextTitle, nextUrl, next.source);
            const link = document.createElement('link'); link.rel = 'prefetch'; link.href = nextUrl; document.head.appendChild(link);
            storeSeries(seriesKey, info.episode, nextUrl, nextTitle);
        } else {
            setTitle('❌ Không tìm thấy tập kế');
            setBody(`<input type="text" id="vtv-manual" placeholder="Tìm tập..."><button id="vtv-manual-btn">Tìm</button><div id="vtv-panel-content"></div>`);
            document.getElementById('vtv-manual-btn')?.addEventListener('click', async () => {
                const q = document.getElementById('vtv-manual')?.value.trim();
                if (q) {
                    const res = await searchYT(q);
                    const c = document.getElementById('vtv-panel-content');
                    if (c) c.innerHTML = '<b>Kết quả:</b><ul class="episode-list">' + res.map(r => `<li><a href="https://youtu.be/${r.videoId}">${escapeHTML(r.title)}</a></li>`).join('') + '</ul>';
                }
            });
            addToggles('vtv-panel-content');
            const ap = getYouTubeAutoplay();
            if (ap) { nextUrl = ap.url; nextTitle = ap.title; }
        }

        // Hiển thị tập thiếu
        const missing = detectMissingEpisodes(episodeList);
        if (missing.length) {
            const missingStr = missing.join(', ');
            const c = document.getElementById('vtv-panel-content');
            if (c) c.innerHTML += `<br><b>⚠️ Tập bị thiếu:</b> ${missingStr}`;
        }

        setupMonitoring();
        scrollToCurrentInPlaylist();

        // Kích hoạt các chế độ theo trạng thái toggle
        if (voiceEnabled) { if (typeof startVoiceControl === 'function') startVoiceControl(); }
        if (audioMode) { if (typeof enableAudioMode === 'function') enableAudioMode(); }
        if (pipEnabled) { if (typeof enableAutoPiP === 'function') enableAutoPiP(); }
    }

    function onNavigate() {
        if (location.pathname !== '/watch') return;
        const vid = new URLSearchParams(location.search).get('v');
        if (vid === lastVid) return;
        setTimeout(() => {
            if (new URLSearchParams(location.search).get('v') !== vid) return;
            lastVid = vid;
            main();
        }, 800);
    }

    setupProfiles();
    setupKeyboardShortcuts();

    if (location.pathname === '/watch') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(main, 500));
        else setTimeout(main, 500);
    }
    document.addEventListener('yt-navigate-finish', onNavigate);

    if (marathon) { document.body.classList.add('vtv-marathon'); startAdBlocking(); }
    // Voice, Audio, PiP sẽ được khởi động trong main() dựa vào toggle
    window.addEventListener('beforeunload', () => {
        stopAdBlocking();
        if (voiceRecognition) voiceRecognition.stop();
    });
})();