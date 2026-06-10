// utils.js - Biến toàn cục & hàm dùng chung
const DEBUG = true;
const TARGET_CHANNEL = 'VTV Giải Trí Official';
const AD_MAX_DURATION = 30;
const EPISODES_TO_SHOW = 5;
const INCLUDE_CHANNEL_IN_SEARCH = true;

// ── State object tập trung, thay thế biến global rải rác ──
const State = {
    autoPlay:    GM_getValue('vtvUlt_auto', true),
    marathon:    GM_getValue('vtvUlt_marathon', false),
    autoSkip:    GM_getValue('vtvUlt_autoskip', false),
    voiceEnabled: GM_getValue('vtvUlt_voice', true),
    audioMode:   GM_getValue('vtvUlt_audioMode', false),
    pipEnabled:  GM_getValue('vtvUlt_pip', true),
    uiCollapsed: GM_getValue('vtvUlt_collapsed', false),
    uiHidden:    GM_getValue('vtvUlt_hidden', false),
    currentProfile: GM_getValue('vtvUlt_currentProfile', 'default'),
    panelPos:    GM_getValue('vtvUlt_panelPos', null),

    nextUrl: null,
    nextTitle: '',
    previousEp: null,
    episodeList: [],
    countdownInterval: null,
    timeCheckInterval: null,
    redirectScheduled: false,
    videoEl: null,
    panel: null,
    channelName: '',
    lastVid: null,
    seriesKey: null,
    parsedInfo: null,
    voiceRecognition: null,
    adObserver: null,
    adSkipInterval: null,
    adVideoDetected: false,
    vtvLastTime: -1,
    // Thời điểm bắt đầu xem (để tính watch time thực tế)
    watchStartTime: null,
    watchAccumulated: 0,
};

// Aliases backward-compat cho các module dùng biến trực tiếp
// (dần dần sẽ migrate sang State.xxx)
Object.defineProperties(window, {
    autoPlay:       { get: () => State.autoPlay,       set: v => State.autoPlay = v,       configurable: true },
    marathon:       { get: () => State.marathon,       set: v => State.marathon = v,       configurable: true },
    autoSkip:       { get: () => State.autoSkip,       set: v => State.autoSkip = v,       configurable: true },
    voiceEnabled:   { get: () => State.voiceEnabled,   set: v => State.voiceEnabled = v,   configurable: true },
    audioMode:      { get: () => State.audioMode,      set: v => State.audioMode = v,      configurable: true },
    pipEnabled:     { get: () => State.pipEnabled,     set: v => State.pipEnabled = v,     configurable: true },
    uiCollapsed:    { get: () => State.uiCollapsed,    set: v => State.uiCollapsed = v,    configurable: true },
    uiHidden:       { get: () => State.uiHidden,       set: v => State.uiHidden = v,       configurable: true },
    currentProfile: { get: () => State.currentProfile, set: v => State.currentProfile = v, configurable: true },
    panelPos:       { get: () => State.panelPos,       set: v => State.panelPos = v,       configurable: true },
    nextUrl:        { get: () => State.nextUrl,        set: v => State.nextUrl = v,        configurable: true },
    nextTitle:      { get: () => State.nextTitle,      set: v => State.nextTitle = v,      configurable: true },
    previousEp:     { get: () => State.previousEp,     set: v => State.previousEp = v,     configurable: true },
    episodeList:    { get: () => State.episodeList,    set: v => State.episodeList = v,    configurable: true },
    countdownInterval: { get: () => State.countdownInterval, set: v => State.countdownInterval = v, configurable: true },
    timeCheckInterval:  { get: () => State.timeCheckInterval,  set: v => State.timeCheckInterval = v,  configurable: true },
    redirectScheduled:  { get: () => State.redirectScheduled,  set: v => State.redirectScheduled = v,  configurable: true },
    videoEl:        { get: () => State.videoEl,        set: v => State.videoEl = v,        configurable: true },
    panel:          { get: () => State.panel,          set: v => State.panel = v,          configurable: true },
    channelName:    { get: () => State.channelName,    set: v => State.channelName = v,    configurable: true },
    lastVid:        { get: () => State.lastVid,        set: v => State.lastVid = v,        configurable: true },
    seriesKey:      { get: () => State.seriesKey,      set: v => State.seriesKey = v,      configurable: true },
    parsedInfo:     { get: () => State.parsedInfo,     set: v => State.parsedInfo = v,     configurable: true },
    voiceRecognition: { get: () => State.voiceRecognition, set: v => State.voiceRecognition = v, configurable: true },
    adObserver:     { get: () => State.adObserver,     set: v => State.adObserver = v,     configurable: true },
    adSkipInterval: { get: () => State.adSkipInterval, set: v => State.adSkipInterval = v, configurable: true },
    adVideoDetected: { get: () => State.adVideoDetected, set: v => State.adVideoDetected = v, configurable: true },
    vtvLastTime:    { get: () => State.vtvLastTime,    set: v => State.vtvLastTime = v,    configurable: true },
});

const log  = (...a) => DEBUG && console.log('[VTV Ult]', ...a);
const warn = (...a) => DEBUG && console.warn('[VTV Ult]', ...a);

function escapeHTML(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function parseTitle(rawTitle) {
    log('Parsing title:', rawTitle);
    let t = rawTitle.replace(/\s*-\s*YouTube$/i, '').trim();
    const r = { series: '', season: null, episode: null, segment: null, totalSeg: null, format: 'full' };

    if (/TRỰC TIẾP/i.test(t))            { r.format = 'live';      t = t.replace(/TRỰC TIẾP\s*/i, ''); }
    else if (/Preview/i.test(t))         { r.format = 'preview';   t = t.replace(/Preview\s*/i, ''); }
    else if (/Shorts/i.test(t))          { r.format = 'short';     t = t.replace(/Shorts\s*/i, ''); }
    else if (/Trailer Official/i.test(t)){ r.format = 'trailer';   t = t.replace(/Trailer Official\s*/i, ''); }
    else if (/Highlight|Trích đoạn/i.test(t)) r.format = 'highlight';

    let m = t.match(/^(.*?)\s+(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(?:P(\d+)|Phần\s*(\d+)))?\s*(?:\((\d+)\/(\d+)\))?/i);
    if (m) {
        r.series   = m[1].trim();
        r.episode  = parseFloat(m[2]);
        r.season   = m[3] ? parseInt(m[3]) : (m[4] ? parseInt(m[4]) : null);
        if (m[5] && m[6]) { r.segment = parseInt(m[5]); r.totalSeg = parseInt(m[6]); }
    } else {
        m = t.match(/^(.*?)\s*\|\s*(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)/i);
        if (m) { r.series = m[1].trim(); r.episode = parseFloat(m[2]); }
        else {
            m = t.match(/(?:tập|Tập|TẬP)\s*(\d+(?:\.\d+)?)/i);
            if (m) { r.episode = parseFloat(m[1]); r.series = t.replace(m[0], '').trim(); }
        }
    }
    r.series = r.series
        .replace(/(?:FULL|Full|Shorts|Preview|Trailer|Trực tiếp|TRỰC TIẾP)/gi, '').trim()
        .replace(/\|\s*VTV Giải Trí\s*$/i, '')
        .replace(/\s*\|\s*/g, ' - ').trim();
    if (!r.series && r.episode) { const parts = t.split('|'); r.series = parts[0].trim(); }
    log('Parsed result:', r);
    return r;
}

function getYouTubeAutoplay() {
    try {
        const items = document.querySelectorAll('ytd-compact-autoplay-renderer ytd-compact-video-renderer, .ytp-autonav-endscreen-upnext-container');
        for (const el of items) {
            const a = el.querySelector('a');
            const title = el.querySelector('#video-title')?.textContent?.trim() || el.querySelector('.ytp-autonav-endscreen-upnext-title')?.textContent?.trim();
            if (a && title) return { url: a.href, title };
        }
    } catch(e) {}
    return null;
}

function storeSeries(key, episode, url, title) {
    const data = gmGet('vtvUlt_series_' + key, {});
    data[episode] = { url, title };
    gmSet('vtvUlt_series_' + key, data);
}

// ── GM storage helpers với JSON serialization an toàn ──
function gmGet(key, defaultVal) {
    const raw = GM_getValue(key);
    if (raw === undefined || raw === null) return defaultVal;
    if (typeof raw === 'object') return raw; // một số GM trả về object trực tiếp
    try { return JSON.parse(raw); } catch(e) { return raw; }
}
function gmSet(key, val) {
    GM_setValue(key, typeof val === 'object' ? JSON.stringify(val) : val);
}
