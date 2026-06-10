// ui.js - Giao diện panel, movable, countdown, monitoring, toggle

GM_addStyle(`
    #vtv-ult-panel {
        position: fixed; bottom: 20px; right: 20px;
        background: rgba(33,33,33,0.95); color: #fff;
        border-radius: 12px;
        font-family: 'YouTube Sans', Roboto, Arial, sans-serif;
        font-size: 14px; z-index: 9999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        max-width: 400px;
        transition: opacity 0.3s;
        user-select: none;
    }
    #vtv-ult-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 8px 16px; cursor: move;
    }
    #vtv-ult-header .title { font-weight: 500; }
    #vtv-ult-header button {
        background: none; border: none; color: #aaa;
        font-size: 16px; cursor: pointer; padding: 0 4px;
    }
    #vtv-ult-header button:hover { color: #fff; }
    #vtv-ult-body { padding: 0 16px 12px 16px; }
    #vtv-ult-panel.collapsed #vtv-ult-body { display: none; }
    #vtv-ult-panel.hidden { display: none; }
    #vtv-ult-mini-btn {
        position: fixed; bottom: 20px; right: 20px;
        width: 40px; height: 40px;
        background: rgba(33,33,33,0.9); color: #fff;
        border: none; border-radius: 50%; font-size: 20px;
        cursor: pointer; z-index: 9998; display: none;
        align-items: center; justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }
    #vtv-ult-mini-btn:hover { background: #ff0000; }
    #vtv-ult-panel .message { margin-bottom: 8px; line-height: 1.4; }
    #vtv-ult-panel .next-title {
        color: #3ea6ff; word-break: break-word;
        margin-bottom: 8px; max-height: 60px; overflow: hidden; text-overflow: ellipsis;
    }
    #vtv-ult-panel .buttons {
        display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 8px 0;
    }
    #vtv-ult-panel button {
        background: #3ea6ff; border: none; color: #fff;
        padding: 4px 12px; border-radius: 18px; cursor: pointer; font-size: 13px;
    }
    #vtv-ult-panel button:hover { background: #1c8adb; }
    #vtv-ult-panel button.secondary { background: #444; }
    #vtv-ult-panel button.back-btn { background: #cc3333; }
    #vtv-ult-panel .countdown { font-size: 13px; color: #ffcc00; margin-left: 8px; }
    #vtv-ult-panel .toggle-row {
        display: flex; align-items: center; gap: 6px;
        margin-top: 6px; font-size: 12px; color: #aaa;
    }
    #vtv-ult-panel input[type="text"] {
        width: 100%; padding: 6px 8px; border-radius: 8px; border: none;
        background: #555; color: #fff; font-size: 13px; box-sizing: border-box;
    }
    #vtv-ult-panel .episode-list {
        list-style: none; padding: 0; margin: 6px 0; max-height: 150px; overflow-y: auto;
    }
    #vtv-ult-panel .episode-list li { margin: 2px 0; }
    #vtv-ult-panel .episode-list a {
        color: #3ea6ff; text-decoration: none; font-size: 12px;
        display: block; padding: 4px 8px; border-radius: 4px;
    }
    #vtv-ult-panel .episode-list a:hover { background: #444; }
    #vtv-ult-panel .episode-list a.current { background: #555; color: #fff; font-weight: bold; }
    .vtv-pip-active #movie_player {
        position: fixed; bottom: 20px; left: 20px; width: 300px; height: 169px; z-index: 10000;
    }
`);

// ── DOM helpers (tránh innerHTML string cho event-binding UI) ──
function _el(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'cls')       el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;  // chỉ dùng khi nội dung đã escape
        else                   el.setAttribute(k, v);
    }
    for (const ch of children) { if (ch) el.appendChild(ch); }
    return el;
}
function _btn(text, cls, onClick) {
    const b = _el('button', { text, cls });
    b.addEventListener('click', onClick);
    return b;
}

function createPanel() {
    log('Creating panel...');

    const titleSpan  = _el('span', { cls: 'title', text: 'VTV Ult' });
    const collapseBtn = _el('button', { title: 'Thu gọn', text: '–' });
    const closeBtn    = _el('button', { title: 'Đóng',    text: '✕' });
    const header = _el('div', { id: 'vtv-ult-header' }, [titleSpan, _el('div', {}, [collapseBtn, closeBtn])]);
    const body   = _el('div', { id: 'vtv-ult-body' });
    const panel  = _el('div', { id: 'vtv-ult-panel' }, [header, body]);

    const mini = _el('button', { id: 'vtv-ult-mini-btn', title: 'Hiện bảng điều khiển', text: '▶' });

    document.body.appendChild(panel);
    document.body.appendChild(mini);
    State.panel = panel;

    collapseBtn.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
        State.uiCollapsed = panel.classList.contains('collapsed');
        GM_setValue('vtvUlt_collapsed', State.uiCollapsed);
        collapseBtn.textContent = State.uiCollapsed ? '+' : '–';
    });
    closeBtn.addEventListener('click', () => {
        panel.classList.add('hidden');
        State.uiHidden = true;
        GM_setValue('vtvUlt_hidden', true);
        mini.style.display = 'flex';
    });
    mini.addEventListener('click', () => {
        panel.classList.remove('hidden');
        State.uiHidden = false;
        GM_setValue('vtvUlt_hidden', false);
        mini.style.display = 'none';
    });

    if (State.uiCollapsed) panel.classList.add('collapsed');
    if (State.uiHidden)  { panel.classList.add('hidden'); mini.style.display = 'flex'; }

    makePanelMovable(header);
    if (State.panelPos) {
        panel.style.left   = State.panelPos.left + 'px';
        panel.style.top    = State.panelPos.top  + 'px';
        panel.style.right  = 'auto';
        panel.style.bottom = 'auto';
    }
    snapPanelToViewport();
    log('Panel created');
}

function makePanelMovable(header) {
    let dragging = false, sx, sy, il, it;
    header.addEventListener('mousedown', e => {
        dragging = true; sx = e.clientX; sy = e.clientY;
        const r = State.panel.getBoundingClientRect();
        il = r.left; it = r.top;
        e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        State.panel.style.left   = (il + e.clientX - sx) + 'px';
        State.panel.style.top    = (it + e.clientY - sy) + 'px';
        State.panel.style.right  = 'auto';
        State.panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        snapPanelToViewport();
        const r = State.panel.getBoundingClientRect();
        GM_setValue('vtvUlt_panelPos', { left: r.left, top: r.top });
    });
}

function snapPanelToViewport() {
    const p = State.panel;
    if (!p) return;
    const r      = p.getBoundingClientRect();
    const margin = 20;
    let l = Math.max(margin, Math.min(r.left, window.innerWidth  - r.width  - margin));
    let t = Math.max(margin, Math.min(r.top,  window.innerHeight - r.height - margin));
    if (l !== r.left || t !== r.top) { p.style.left = l + 'px'; p.style.top = t + 'px'; }
}

function setBody(html) {
    const b = document.getElementById('vtv-ult-body');
    if (b) b.innerHTML = html;
}
function setTitle(text) {
    const t = document.querySelector('#vtv-ult-header .title');
    if (t) t.textContent = text;
}

// ── Toggles: dùng array config thay vì lặp thủ công ──
const TOGGLE_CONFIG = [
    { id: 'vtv-auto',       label: 'Tự động chuyển', stateKey: 'autoPlay',    gmKey: 'vtvUlt_auto',
      on: null, off: null },
    { id: 'vtv-marathon',   label: 'Marathon',        stateKey: 'marathon',   gmKey: 'vtvUlt_marathon',
      on: () => { document.body.classList.add('vtv-marathon');    startAdBlocking(); },
      off: () => { document.body.classList.remove('vtv-marathon'); stopAdBlocking(); } },
    { id: 'vtv-autoskip',   label: 'Tự động tua intro', stateKey: 'autoSkip', gmKey: 'vtvUlt_autoskip',
      on: null, off: null },
    { id: 'vtv-voice',      label: 'Voice Control 🎤', stateKey: 'voiceEnabled', gmKey: 'vtvUlt_voice',
      on: initVoiceControl, off: stopVoiceControl },
    { id: 'vtv-audio-mode', label: 'Audio Mode 🔇',    stateKey: 'audioMode',  gmKey: 'vtvUlt_audioMode',
      on: enableAudioMode, off: disableAudioMode },
    { id: 'vtv-pip',        label: 'Auto PiP 🖼️',     stateKey: 'pipEnabled', gmKey: 'vtvUlt_pip',
      on: enableAutoPiP,   off: disableAutoPiP },
];

function addToggles(containerId) {
    const c = document.getElementById(containerId);
    if (!c) return;
    for (const cfg of TOGGLE_CONFIG) {
        const cb  = _el('input', { type: 'checkbox', id: cfg.id });
        cb.checked = State[cfg.stateKey];
        const row = _el('div', { cls: 'toggle-row' }, [_el('label', {}, [cb, document.createTextNode(' ' + cfg.label)])]);
        c.appendChild(row);
        cb.addEventListener('change', e => {
            State[cfg.stateKey] = e.target.checked;
            GM_setValue(cfg.gmKey, e.target.checked);
            if (e.target.checked) { cfg.on?.(); }
            else                  { cfg.off?.(); }
        });
    }
    // Sync marathon adblock state on render
    if (State.marathon) { document.body.classList.add('vtv-marathon'); startAdBlocking(); }
}

function renderSearching() {
    setTitle('⏳ Đang tìm...');
    setBody('<div id="vtv-panel-content"></div>');
    addToggles('vtv-panel-content');
}

function renderFound(title, url, source) {
    setTitle('▶️ Điều hướng');
    setBody(`
        ${source === 'newseason' ? '<div class="message">🔁 Phần mới!</div>' : ''}
        <div class="buttons">
            ${State.previousEp ? '<button id="vtv-prev" class="back-btn">◀ Quay lại</button>' : ''}
            ${url             ? '<button id="vtv-skip">⏭ Tiếp theo</button>'                 : ''}
            <button id="vtv-cancel" class="secondary" style="display:none;">❌ Huỷ</button>
            <span class="countdown" id="vtv-cd"></span>
        </div>
        <div class="next-title">${escapeHTML(title)}</div>
        <div id="episode-list-container"></div>
        <div id="vtv-panel-content"></div>
    `);

    if (State.previousEp) document.getElementById('vtv-prev')?.addEventListener('click', () => { window.location.href = State.previousEp.url; });
    document.getElementById('vtv-skip')?.addEventListener('click',   () => { if (url) window.location.href = url; });
    document.getElementById('vtv-cancel')?.addEventListener('click', cancelRedirect);
    addToggles('vtv-panel-content');

    if (State.episodeList.length) {
        const ec = document.getElementById('episode-list-container');
        if (ec) {
            const ul = _el('ul', { cls: 'episode-list' });
            for (const ep of State.episodeList) {
                const a  = _el('a', { href: ep.url, cls: ep.isCurrent ? 'current' : '', text: (ep.isCurrent ? '📌 ' : '📺 ') + ep.title });
                ul.appendChild(_el('li', {}, [a]));
            }
            ec.appendChild(ul);
        }
    }
}

function cancelRedirect() {
    log('Cancel redirect');
    State.redirectScheduled = false;
    if (State.countdownInterval) { clearInterval(State.countdownInterval); State.countdownInterval = null; }
    const cd = document.getElementById('vtv-cd');
    if (cd) cd.textContent = '';
    document.getElementById('vtv-cancel')?.style.setProperty('display', 'none');
}

function doRedirect() {
    if (State.nextUrl && !State.adVideoDetected) {
        log('Redirecting to:', State.nextUrl);
        window.location.href = State.nextUrl;
    }
}

function startCountdown(sec) {
    if (!State.autoPlay || !State.nextUrl || State.adVideoDetected) return;
    log('Countdown:', sec);
    State.redirectScheduled = true;
    const cd = document.getElementById('vtv-cd');
    if (cd) cd.textContent = `⏳ ${sec}s`;
    document.getElementById('vtv-cancel')?.style.setProperty('display', 'inline-block');
    if (State.countdownInterval) clearInterval(State.countdownInterval);
    let rem = sec;
    State.countdownInterval = setInterval(() => {
        rem--;
        if (rem <= 0) { clearInterval(State.countdownInterval); doRedirect(); }
        else if (cd)  { cd.textContent = `⏳ ${rem}s`; }
    }, 1000);
}

function setupMonitoring() {
    log('Setting up monitoring');
    if (State.videoEl) {
        State.videoEl.removeEventListener('ended', onVideoEnded);
        State.videoEl.removeEventListener('seeked', onSeeked);
    }
    State.videoEl = document.querySelector('video.html5-main-video');
    if (!State.videoEl) { setTimeout(setupMonitoring, 1000); return; }

    if (State.timeCheckInterval) clearInterval(State.timeCheckInterval);
    State.vtvLastTime = State.videoEl.currentTime;
    if (State.seriesKey && State.autoSkip) setTimeout(() => applyAutoSkip(State.seriesKey), 2000);

    const checkAd = () => {
        const dur = State.videoEl?.duration;
        // Chỉ coi là ad nếu video ngắn VÀ không phải kênh đích
        State.adVideoDetected = (dur > 0 && dur < AD_MAX_DURATION && State.channelName !== TARGET_CHANNEL);
        if (State.adVideoDetected) cancelRedirect();
    };
    State.videoEl.addEventListener('loadedmetadata', checkAd);
    checkAd();

    State.timeCheckInterval = setInterval(() => {
        if (!State.videoEl || !State.autoPlay || !State.nextUrl || State.redirectScheduled || State.adVideoDetected) return;
        const rem = State.videoEl.duration - State.videoEl.currentTime;
        if (rem > 0 && rem <= getAdaptiveThreshold()) startCountdown(Math.floor(rem));
    }, 1000);

    State.videoEl.addEventListener('ended',  onVideoEnded);
    State.videoEl.addEventListener('seeked', onSeeked);

    // Bắt đầu đo watch time
    startWatchTimer();
}

function getAdaptiveThreshold() {
    const dur = State.videoEl?.duration;
    if (!dur || dur < AD_MAX_DURATION) return 0;
    return Math.max(5, Math.min(30, Math.floor(dur * 0.03)));
}

function onSeeked() {
    if (!State.videoEl || !State.autoPlay || !State.nextUrl || State.redirectScheduled || State.adVideoDetected) return;
    const cur = State.videoEl.currentTime;
    log('Seeked from', State.vtvLastTime, 'to', cur);
    if (cur > State.vtvLastTime + 5) learnSkip(State.seriesKey, State.vtvLastTime, cur);
    State.vtvLastTime = cur;
    const dur = State.videoEl.duration;
    if (dur && (dur - cur) <= getAdaptiveThreshold() * 2) startCountdown(Math.floor(dur - cur));
}

function onVideoEnded() {
    log('Video ended');
    if (State.autoPlay && State.nextUrl && !State.adVideoDetected) {
        cancelRedirect();
        doRedirect();
    }
}
