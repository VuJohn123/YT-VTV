// utils.js - Biến toàn cục & hàm dùng chung
const DEBUG = true;
const TARGET_CHANNEL = 'VTV Giải Trí Official';
const AD_MAX_DURATION = 30;
const EPISODES_TO_SHOW = 5;
const INCLUDE_CHANNEL_IN_SEARCH = true;

let autoPlay = GM_getValue('vtvUlt_auto', true);
let marathon = GM_getValue('vtvUlt_marathon', false);
let autoSkip = GM_getValue('vtvUlt_autoskip', false);
let nextUrl = null, nextTitle = '';
let previousEp = null, episodeList = [];
let countdownInterval = null, redirectScheduled = false;
let timeCheckInterval = null;
let videoEl = null;
let panel = null;
let channelName = '';
let lastVid = null;
let seriesKey = null;
let parsedInfo = null;
let uiCollapsed = GM_getValue('vtvUlt_collapsed', false);
let uiHidden = GM_getValue('vtvUlt_hidden', false);
let currentProfile = GM_getValue('vtvUlt_currentProfile', 'default');
let panelPos = GM_getValue('vtvUlt_panelPos', null);
let voiceRecognition = null;
let adObserver = null, adSkipInterval = null, adVideoDetected = false;
let vtvLastTime = -1;
let voiceEnabled = GM_getValue('vtvUlt_voice', true);
let audioMode = GM_getValue('vtvUlt_audioMode', false);
let pipEnabled = GM_getValue('vtvUlt_pip', true);

const log = (...a) => DEBUG && console.log('[VTV Ult]', ...a);
const warn = (...a) => DEBUG && console.warn('[VTV Ult]', ...a);
function escapeHTML(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function parseTitle(rawTitle) {
    log('Parsing title:', rawTitle);
    let t = rawTitle.replace(/\s*-\s*YouTube$/i, '').trim();
    const r = { series: '', season: null, episode: null, segment: null, totalSeg: null, format: 'full' };

    if (/TRỰC TIẾP/i.test(t)) { r.format = 'live'; t = t.replace(/TRỰC TIẾP\s*/i, ''); }
    else if (/Preview/i.test(t)) { r.format = 'preview'; t = t.replace(/Preview\s*/i, ''); }
    else if (/Shorts/i.test(t)) { r.format = 'short'; t = t.replace(/Shorts\s*/i, ''); }
    else if (/Trailer Official/i.test(t)) { r.format = 'trailer'; t = t.replace(/Trailer Official\s*/i, ''); }
    else if (/Highlight|Trích đoạn/i.test(t)) r.format = 'highlight';

    let m = t.match(/^(.*?)\s+(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(?:P(\d+)|Phần\s*(\d+)))?\s*(?:\((\d+)\/(\d+)\))?/i);
    if (m) {
        r.series = m[1].trim();
        r.episode = parseFloat(m[2]);
        r.season = m[3] ? parseInt(m[3]) : (m[4] ? parseInt(m[4]) : null);
        if (m[5] && m[6]) { r.segment = parseInt(m[5]); r.totalSeg = parseInt(m[6]); }
    } else {
        m = t.match(/^(.*?)\s+(?:P(\d+)|Phần\s*(\d+))\s+(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)\s*(?:\((\d+)\/(\d+)\))?/i);
        if (m) {
            r.series = m[1].trim();
            r.season = m[2] ? parseInt(m[2]) : (m[3] ? parseInt(m[3]) : null);
            r.episode = parseFloat(m[4]);
            if (m[5] && m[6]) { r.segment = parseInt(m[5]); r.totalSeg = parseInt(m[6]); }
        } else {
            m = t.match(/^(.*?)\s*\|\s*(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)/i);
            if (m) { r.series = m[1].trim(); r.episode = parseFloat(m[2]); }
            else {
                m = t.match(/(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)/i);
                if (m) { r.episode = parseFloat(m[1]); r.series = t.replace(m[0], '').trim(); }
            }
        }
    }

    r.series = r.series.replace(/(?:FULL|Full|Shorts|Preview|Trailer|Trực tiếp|TRỰC TIẾP)/gi, '').trim()
        .replace(/\|\s*VTV Giải Trí\s*$/i, '').replace(/\s*\|\s*/g, ' - ').trim();
    if (!r.series && r.episode) {
        const parts = t.split('|');
        r.series = parts[0].trim();
    }
    log('Parsed result:', r);
    return r;
}

function getYouTubeAutoplay() {
    const el = document.querySelector('ytd-compact-autoplay-renderer a.yt-simple-endpoint');
    if (el) return {url: 'https://www.youtube.com' + el.getAttribute('href'), title: el.querySelector('#video-title')?.textContent?.trim() || ''};
    const un = document.querySelector('ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer:first-child a.yt-simple-endpoint');
    if (un) return {url: 'https://www.youtube.com' + un.getAttribute('href'), title: un.querySelector('#video-title')?.textContent?.trim() || ''};
    return null;
}

function suggestMissingSegments(list) {
    const byEp = {};
    for (const item of list) {
        if (!item.episode || !item.totalSeg || item.totalSeg <= 1) continue;
        if (!byEp[item.episode]) byEp[item.episode] = { total: item.totalSeg, present: new Set() };
        if (item.segment) byEp[item.episode].present.add(item.segment);
    }
    const missing = [];
    for (const [ep, data] of Object.entries(byEp)) {
        for (let seg = 1; seg <= data.total; seg++) {
            if (!data.present.has(seg)) {
                missing.push({ episode: parseInt(ep), segment: seg, totalSeg: data.total });
            }
        }
    }
    return missing;
}

// === Countdown functions ===
function cancelRedirect() {
    redirectScheduled = false;
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    // Ẩn nút hủy và đồng hồ đếm ngược (nếu panel đang hiển thị)
    if (panel) {
        const cancelBtn = document.getElementById('vtv-cancel');
        if (cancelBtn) cancelBtn.style.display = 'none';
        const cd = document.getElementById('vtv-cd');
        if (cd) cd.textContent = '';
    }
}

function doRedirect() {
    if (nextUrl && !adVideoDetected) {
        log('Redirecting to:', nextUrl);
        window.location.href = nextUrl;
    }
}

function startCountdown(sec) {
    if (!autoPlay || !nextUrl || adVideoDetected) return;
    log('Countdown started:', sec);
    redirectScheduled = true;
    const cd = document.getElementById('vtv-cd');
    if (cd) cd.textContent = `⏳ ${sec}s`;
    const cancelBtn = document.getElementById('vtv-cancel');
    if (cancelBtn) cancelBtn.style.display = 'inline-block';
    if (countdownInterval) clearInterval(countdownInterval);
    let rem = sec;
    countdownInterval = setInterval(() => {
        rem--;
        if (rem <= 0) {
            clearInterval(countdownInterval);
            doRedirect();
        } else {
            if (cd) cd.textContent = `⏳ ${rem}s`;
        }
    }, 1000);
}

function getAdaptiveThreshold() {
    if (!videoEl?.duration || videoEl.duration < AD_MAX_DURATION) return 0;
    return Math.max(5, Math.min(30, Math.floor(videoEl.duration * 0.03)));
}