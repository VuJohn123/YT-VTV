// ui.js - Giao diện panel, movable, countdown, monitoring, toggle playlist
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
    #vtv-ult-panel .auto-toggle,
    #vtv-ult-panel .marathon-toggle,
    #vtv-ult-panel .autoskip-toggle,
    #vtv-ult-panel .voice-toggle,
    #vtv-ult-panel .audio-toggle,
    #vtv-ult-panel .pip-toggle,
    #vtv-ult-panel .playlist-toggle {
        display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; color: #aaa;
    }
    #vtv-ult-panel input[type="text"] {
        width: 100%; padding: 6px 8px; border-radius: 8px; border: none;
        background: #555; color: #fff; font-size: 13px; box-sizing: border-box;
    }
    #vtv-ult-panel .episode-list {
        list-style: none; padding: 0; margin: 6px 0; max-height: 200px; overflow-y: auto;
    }
    #vtv-ult-panel .episode-list li { margin: 2px 0; }
    #vtv-ult-panel .episode-list a {
        color: #3ea6ff; text-decoration: none; font-size: 12px;
        display: block; padding: 4px 8px; border-radius: 4px;
    }
    #vtv-ult-panel .episode-list a:hover { background: #444; text-decoration: none; }
    #vtv-ult-panel .episode-list a.current { background: #555; color: #fff; font-weight: bold; }
    #vtv-voice-label {
        font-size: 11px; color: #aaa; margin-left: 8px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        display: inline-block; vertical-align: middle;
    }
`);

function createPanel() {
    log('Creating panel...');
    const el = document.createElement('div');
    el.id = 'vtv-ult-panel';
    const hd = document.createElement('div');
    hd.id = 'vtv-ult-header';
    hd.innerHTML = `
        <span class="title">VTV Ult</span>
        <div>
            <button id="vtv-collapse-btn" title="Thu gọn">–</button>
            <button id="vtv-close-btn" title="Đóng">✕</button>
        </div>
    `;
    el.appendChild(hd);
    const bd = document.createElement('div');
    bd.id = 'vtv-ult-body';
    el.appendChild(bd);
    document.body.appendChild(el);
    panel = el;

    const mini = document.createElement('button');
    mini.id = 'vtv-ult-mini-btn';
    mini.textContent = '▶';
    mini.title = 'Hiện bảng điều khiển';
    document.body.appendChild(mini);

    document.getElementById('vtv-collapse-btn').addEventListener('click', () => {
        panel.classList.toggle('collapsed');
        uiCollapsed = panel.classList.contains('collapsed');
        GM_setValue('vtvUlt_collapsed', uiCollapsed);
        document.getElementById('vtv-collapse-btn').textContent = uiCollapsed ? '+' : '–';
    });
    document.getElementById('vtv-close-btn').addEventListener('click', () => {
        panel.classList.add('hidden');
        uiHidden = true;
        GM_setValue('vtvUlt_hidden', true);
        mini.style.display = 'flex';
    });
    mini.addEventListener('click', () => {
        panel.classList.remove('hidden');
        uiHidden = false;
        GM_setValue('vtvUlt_hidden', false);
        mini.style.display = 'none';
    });

    if (uiCollapsed) panel.classList.add('collapsed');
    if (uiHidden) { panel.classList.add('hidden'); mini.style.display = 'flex'; }

    makePanelMovable(hd);
    if (panelPos) {
        panel.style.left = panelPos.left + 'px';
        panel.style.top = panelPos.top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }
    snapPanelToViewport();
}

function makePanelMovable(header) {
    let isDragging = false, sx, sy, il, it;
    header.addEventListener('mousedown', e => {
        isDragging = true;
        sx = e.clientX; sy = e.clientY;
        const r = panel.getBoundingClientRect();
        il = r.left; it = r.top;
        e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        panel.style.left = (il + e.clientX - sx) + 'px';
        panel.style.top = (it + e.clientY - sy) + 'px';
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            snapPanelToViewport();
            const r = panel.getBoundingClientRect();
            GM_setValue('vtvUlt_panelPos', { left: r.left, top: r.top });
        }
    });
}

function snapPanelToViewport() {
    const r = panel.getBoundingClientRect();
    const margin = 20;
    let newLeft = r.left, newTop = r.top;
    const maxLeft = window.innerWidth - r.width - margin;
    const maxTop = window.innerHeight - r.height - margin;
    if (newLeft < margin) newLeft = margin;
    if (newTop < margin) newTop = margin;
    if (newLeft > maxLeft) newLeft = maxLeft;
    if (newTop > maxTop) newTop = maxTop;
    if (newLeft !== r.left || newTop !== r.top) {
        panel.style.left = newLeft + 'px';
        panel.style.top = newTop + 'px';
    }
}

function setBody(html) { const b = document.getElementById('vtv-ult-body'); if (b) b.innerHTML = html; }
function setTitle(text) { const t = document.querySelector('#vtv-ult-header .title'); if (t) t.textContent = text; }

function addToggles(cid) {
    const c = document.getElementById(cid);
    if (!c) return;
    c.innerHTML += `
        <div class="auto-toggle"><label><input type="checkbox" id="vtv-auto" ${autoPlay ? 'checked' : ''}> Tự động chuyển</label></div>
        <div class="marathon-toggle"><label><input type="checkbox" id="vtv-marathon" ${marathon ? 'checked' : ''}> Marathon</label></div>
        <div class="autoskip-toggle"><label><input type="checkbox" id="vtv-autoskip" ${autoSkip ? 'checked' : ''}> Tự động tua intro</label></div>
        <div class="voice-toggle">
            <label><input type="checkbox" id="vtv-voice" ${voiceEnabled ? 'checked' : ''}> Voice Control 🎤</label>
            <span id="vtv-voice-label"></span>
        </div>
        <div class="audio-toggle"><label><input type="checkbox" id="vtv-audio-mode" ${audioMode ? 'checked' : ''}> Audio Mode 🔇</label></div>
        <div class="pip-toggle"><label><input type="checkbox" id="vtv-pip" ${pipEnabled ? 'checked' : ''}> Auto PiP 🖼️</label></div>
        <div class="playlist-toggle"><label><input type="checkbox" id="vtv-playlist" ${playlistVisible ? 'checked' : ''}> Hiện playlist 📋</label></div>
    `;
    document.getElementById('vtv-auto')?.addEventListener('change', e => { autoPlay = e.target.checked; GM_setValue('vtvUlt_auto', autoPlay); });
    document.getElementById('vtv-marathon')?.addEventListener('change', e => {
        marathon = e.target.checked; GM_setValue('vtvUlt_marathon', marathon);
        if (marathon) { document.body.classList.add('vtv-marathon'); if (typeof startAdBlocking === 'function') startAdBlocking(); }
        else { document.body.classList.remove('vtv-marathon'); if (typeof stopAdBlocking === 'function') stopAdBlocking(); }
    });
    document.getElementById('vtv-autoskip')?.addEventListener('change', e => { autoSkip = e.target.checked; GM_setValue('vtvUlt_autoskip', autoSkip); });
    document.getElementById('vtv-voice')?.addEventListener('change', e => {
        voiceEnabled = e.target.checked; GM_setValue('vtvUlt_voice', voiceEnabled);
        if (voiceEnabled) { if (typeof startVoiceControl === 'function') startVoiceControl(); }
        else { if (typeof stopVoiceControl === 'function') stopVoiceControl(); }
    });
    document.getElementById('vtv-audio-mode')?.addEventListener('change', e => {
        audioMode = e.target.checked; GM_setValue('vtvUlt_audioMode', audioMode);
        if (audioMode) { if (typeof enableAudioMode === 'function') enableAudioMode(); }
        else { if (typeof disableAudioMode === 'function') disableAudioMode(); }
    });
    document.getElementById('vtv-pip')?.addEventListener('change', e => {
        pipEnabled = e.target.checked; GM_setValue('vtvUlt_pip', pipEnabled);
        if (pipEnabled) { if (typeof enableAutoPiP === 'function') enableAutoPiP(); }
        else { if (typeof disableAutoPiP === 'function') disableAutoPiP(); }
    });
    document.getElementById('vtv-playlist')?.addEventListener('change', e => {
        playlistVisible = e.target.checked;
        const listContainer = document.getElementById('episode-list-container');
        if (listContainer) listContainer.style.display = playlistVisible ? '' : 'none';
    });
    if (marathon) { document.body.classList.add('vtv-marathon'); if (typeof startAdBlocking === 'function') startAdBlocking(); }
}

function renderSearching() { setTitle('⏳ Đang tìm...'); setBody('<div id="vtv-panel-content"></div>'); addToggles('vtv-panel-content'); }
function renderFound(title, url, source) {
    setTitle('▶️ Điều hướng');
    let html = `
        ${source === 'newseason' ? '<div class="message">🔁 Phần mới!</div>' : ''}
        <div class="buttons">
            ${previousEp ? '<button id="vtv-prev" class="back-btn">◀ Quay lại</button>' : ''}
            ${url ? '<button id="vtv-skip">⏭ Tiếp theo</button>' : ''}
            <button id="vtv-cancel" class="secondary" style="display:none;">❌ Huỷ</button>
            <span class="countdown" id="vtv-cd"></span>
        </div>
        <div class="next-title">${escapeHTML(title)}</div>
        <div id="episode-list-container" style="display:${playlistVisible ? '' : 'none'}"></div>
        <div id="vtv-panel-content"></div>
    `;
    setBody(html);
    if (previousEp) { document.getElementById('vtv-prev')?.addEventListener('click', () => { if (previousEp.url) window.location.href = previousEp.url; }); }
    document.getElementById('vtv-skip')?.addEventListener('click', () => { if (url) window.location.href = url; });
    document.getElementById('vtv-cancel')?.addEventListener('click', cancelRedirect);
    addToggles('vtv-panel-content');
    if (episodeList.length) {
        const ec = document.getElementById('episode-list-container');
        ec.innerHTML = '<ul class="episode-list">' + episodeList.map(e => `<li><a href="${e.url}" class="${e.isCurrent ? 'current' : ''}">${e.isCurrent ? '📌' : '📺'} ${escapeHTML(e.title)}</a></li>`).join('') + '</ul>';
    }
}
function renderOutOfOrder(current, expected, expectedUrl) {
    setTitle('⚠️ Sai thứ tự tập');
    setBody(`
        <div class="message">Bạn đang xem tập ${current}, tập tiếp theo nên là tập ${expected}.</div>
        <div class="buttons">
            <button id="vtv-go">Đến tập ${expected}</button>
            <button id="vtv-stay" class="secondary">Ở lại</button>
        </div>
        <div id="vtv-panel-content"></div>
    `);
    addToggles('vtv-panel-content');
    document.getElementById('vtv-go')?.addEventListener('click', () => { if (expectedUrl) window.location.href = expectedUrl; });
    document.getElementById('vtv-stay')?.addEventListener('click', () => { clearSeries(seriesKey); main(); });
}

function setupMonitoring() {
    log('Setting up monitoring');
    if (videoEl) { videoEl.removeEventListener('ended', onVideoEnded); videoEl.removeEventListener('seeked', onSeeked); }
    videoEl = document.querySelector('video.html5-main-video');
    if (!videoEl) { log('Video element not found, retrying...'); setTimeout(setupMonitoring, 1000); return; }
    log('Video element found, duration:', videoEl.duration);
    if (timeCheckInterval) clearInterval(timeCheckInterval);
    vtvLastTime = videoEl.currentTime;
    if (seriesKey && autoSkip) setTimeout(() => applyAutoSkip(seriesKey), 2000);
    const checkAd = () => {
        if (videoEl && videoEl.duration && videoEl.duration < AD_MAX_DURATION) { adVideoDetected = true; cancelRedirect(); }
        else adVideoDetected = false;
    };
    videoEl.addEventListener('loadedmetadata', checkAd); checkAd();
    timeCheckInterval = setInterval(() => {
        if (!videoEl || !autoPlay || !nextUrl || redirectScheduled || adVideoDetected) return;
        const rem = videoEl.duration - videoEl.currentTime;
        if (rem <= getAdaptiveThreshold() && rem > 0) startCountdown(Math.floor(rem));
    }, 1000);
    videoEl.addEventListener('ended', onVideoEnded);
    videoEl.addEventListener('seeked', onSeeked);
}

function onSeeked() {
    if (!videoEl || !autoPlay || !nextUrl || redirectScheduled || adVideoDetected) return;
    const cur = videoEl.currentTime;
    if (cur > vtvLastTime + 5) learnSkip(seriesKey, vtvLastTime, cur);
    vtvLastTime = cur;
    const dur = videoEl.duration;
    if (dur && (dur - cur) <= getAdaptiveThreshold() * 2) startCountdown(Math.floor(dur - cur));
}
function onVideoEnded() {
    log('Video ended event fired. autoPlay=', autoPlay, 'nextUrl=', !!nextUrl, 'adVideoDetected=', adVideoDetected);
    if (autoPlay && nextUrl && !adVideoDetected) { cancelRedirect(); doRedirect(); }
}

function updateVoiceLabel(text) {
    const label = document.getElementById('vtv-voice-label');
    if (label) {
        label.textContent = text || '';
        label.title = text || '';
    }
}