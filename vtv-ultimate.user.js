// ==UserScript==
// @name         VTV Giải Trí Ultimate
// @namespace    https://github.com/VuJohn123/YT-VTV
// @version      7.1
// @description  Tất cả smart features: marathon, voice, PiP, movable UI, keyboard, profile, GIF...
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
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

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

        previousEp = await findPrevious(info, channelName);
        episodeList = await findEpisodeList(info, channelName);
        const next = await findNext(info, channelName);

        if (next) {
            nextUrl = next.url; nextTitle = next.title;
            renderFound(nextTitle, nextUrl, next.source);
            const link = document.createElement('link'); link.rel = 'prefetch'; link.href = nextUrl; document.head.appendChild(link);
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
        setupMonitoring();
        scrollToCurrentInPlaylist();
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
    try { initVoiceControl(); } catch(e) {}
    window.addEventListener('beforeunload', () => {
        stopAdBlocking();
        if (voiceRecognition) voiceRecognition.stop();
    });
})();