// ui.js — Layer 3: Panel UI
// Nhận events từ EventBus, không kéo state từ global vars.
// Mọi user interaction phát ra EventBus events hoặc gọi Storage.saveFlag().

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
    #vtv-ult-header .vtv-title { font-weight: 500; }
    #vtv-ult-header button {
        background: none; border: none; color: #aaa;
        font-size: 16px; cursor: pointer; padding: 0 4px;
    }
    #vtv-ult-header button:hover { color: #fff; }
    #vtv-ult-body { padding: 0 16px 12px 16px; }
    #vtv-ult-panel.vtv-collapsed #vtv-ult-body { display: none; }
    #vtv-ult-panel.vtv-hidden { display: none; }
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
    #vtv-ult-panel .vtv-message { margin-bottom: 8px; line-height: 1.4; }
    #vtv-ult-panel .vtv-next-title {
        color: #3ea6ff; word-break: break-word;
        margin-bottom: 8px; max-height: 60px; overflow: hidden; text-overflow: ellipsis;
    }
    #vtv-ult-panel .vtv-buttons {
        display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 8px 0;
    }
    #vtv-ult-panel button {
        background: #3ea6ff; border: none; color: #fff;
        padding: 4px 12px; border-radius: 18px; cursor: pointer; font-size: 13px;
    }
    #vtv-ult-panel button:hover { background: #1c8adb; }
    #vtv-ult-panel button.vtv-secondary { background: #444; }
    #vtv-ult-panel button.vtv-back-btn  { background: #cc3333; }
    #vtv-ult-panel .vtv-countdown { font-size: 13px; color: #ffcc00; margin-left: 8px; }
    #vtv-ult-panel .vtv-toggle-row {
        display: flex; align-items: center; gap: 6px; margin-top: 6px;
        font-size: 12px; color: #aaa;
    }
    #vtv-ult-panel input[type="text"] {
        width: 100%; padding: 6px 8px; border-radius: 8px; border: none;
        background: #555; color: #fff; font-size: 13px; box-sizing: border-box;
    }
    #vtv-ult-panel .vtv-episode-list {
        list-style: none; padding: 0; margin: 6px 0; max-height: 200px; overflow-y: auto;
    }
    #vtv-ult-panel .vtv-episode-list li { margin: 2px 0; }
    #vtv-ult-panel .vtv-episode-list a {
        color: #3ea6ff; text-decoration: none; font-size: 12px;
        display: block; padding: 4px 8px; border-radius: 4px;
    }
    #vtv-ult-panel .vtv-episode-list a:hover { background: #444; }
    #vtv-ult-panel .vtv-episode-list a.vtv-current { background: #555; color: #fff; font-weight: bold; }
    #vtv-voice-label {
        font-size: 11px; color: #aaa; margin-left: 8px; max-width: 150px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        display: inline-block; vertical-align: middle;
    }
`);

const UI = (() => {
    let _panel        = null;
    let _miniBtn      = null;
    let _prefs        = Storage.getUIPrefs();
    let _flags        = Storage.getFeatureFlags();
    let _playlistVisible = true;

    // ─── Cached nav state (populated from events) ─────────────────────────────
    let _nextUrl   = null;
    let _prevUrl   = null;
    let _list      = [];

    // ─── Panel creation ───────────────────────────────────────────────────────
    function _createPanel() {
        if (_panel) return;

        const el = document.createElement('div');
        el.id = 'vtv-ult-panel';
        const hd = document.createElement('div');
        hd.id = 'vtv-ult-header';
        hd.innerHTML = `
            <span class="vtv-title">VTV Ult</span>
            <div>
                <button id="vtv-collapse-btn" title="Thu gọn">–</button>
                <button id="vtv-close-btn"    title="Đóng">✕</button>
            </div>`;
        el.appendChild(hd);
        const bd = document.createElement('div');
        bd.id = 'vtv-ult-body';
        el.appendChild(bd);
        document.body.appendChild(el);
        _panel = el;

        const mini = document.createElement('button');
        mini.id = 'vtv-ult-mini-btn';
        mini.textContent = '▶';
        mini.title = 'Hiện bảng điều khiển';
        document.body.appendChild(mini);
        _miniBtn = mini;

        document.getElementById('vtv-collapse-btn').addEventListener('click', () => {
            _panel.classList.toggle('vtv-collapsed');
            const collapsed = _panel.classList.contains('vtv-collapsed');
            Storage.saveUIPrefs({ collapsed });
            document.getElementById('vtv-collapse-btn').textContent = collapsed ? '+' : '–';
        });
        document.getElementById('vtv-close-btn').addEventListener('click', () => {
            _panel.classList.add('vtv-hidden');
            Storage.saveUIPrefs({ hidden: true });
            _miniBtn.style.display = 'flex';
        });
        mini.addEventListener('click', () => {
            _panel.classList.remove('vtv-hidden');
            Storage.saveUIPrefs({ hidden: false });
            _miniBtn.style.display = 'none';
        });

        if (_prefs.collapsed) _panel.classList.add('vtv-collapsed');
        if (_prefs.hidden)    { _panel.classList.add('vtv-hidden'); _miniBtn.style.display = 'flex'; }

        _makePanelMovable(hd);
        if (_prefs.panelPos) {
            _panel.style.left   = _prefs.panelPos.left + 'px';
            _panel.style.top    = _prefs.panelPos.top  + 'px';
            _panel.style.right  = 'auto';
            _panel.style.bottom = 'auto';
        }
        _snapToViewport();
    }

    function _makePanelMovable(header) {
        let dragging = false, sx, sy, il, it;
        header.addEventListener('mousedown', e => {
            dragging = true; sx = e.clientX; sy = e.clientY;
            const r = _panel.getBoundingClientRect(); il = r.left; it = r.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            _panel.style.left   = (il + e.clientX - sx) + 'px';
            _panel.style.top    = (it + e.clientY - sy) + 'px';
            _panel.style.right  = 'auto';
            _panel.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            _snapToViewport();
            const r = _panel.getBoundingClientRect();
            Storage.saveUIPrefs({ panelPos: { left: r.left, top: r.top } });
        });
    }

    function _snapToViewport() {
        if (!_panel) return;
        const r = _panel.getBoundingClientRect();
        const m = 20;
        let l = r.left, t = r.top;
        if (l < m) l = m;
        if (t < m) t = m;
        if (l > window.innerWidth  - r.width  - m) l = window.innerWidth  - r.width  - m;
        if (t > window.innerHeight - r.height - m) t = window.innerHeight - r.height - m;
        if (l !== r.left || t !== r.top) { _panel.style.left = l + 'px'; _panel.style.top = t + 'px'; }
    }

    // ─── Body helpers ─────────────────────────────────────────────────────────
    function _setBody(html) { const b = document.getElementById('vtv-ult-body'); if (b) b.innerHTML = html; }
    function _setTitle(t)   { const el = document.querySelector('#vtv-ult-header .vtv-title'); if (el) el.textContent = t; }

    function _renderPlaylist(containerId) {
        const ec = document.getElementById(containerId);
        if (!ec || !_list.length) return;
        ec.innerHTML = '<ul class="vtv-episode-list">' +
            _list.map(e => `<li><a href="${e.url}" class="${e.isCurrent ? 'vtv-current' : ''}">${e.isCurrent ? '📌' : '📺'} ${escapeHTML(e.title)}</a></li>`).join('') +
            '</ul>';
    }

    function _renderToggles(containerId) {
        const c = document.getElementById(containerId);
        if (!c) return;
        c.innerHTML += `
            <div class="vtv-toggle-row"><label><input type="checkbox" id="vtv-auto" ${_flags.autoPlay ? 'checked' : ''}> Tự động chuyển</label></div>
            <div class="vtv-toggle-row"><label><input type="checkbox" id="vtv-marathon" ${_flags.marathon ? 'checked' : ''}> Marathon</label></div>
            <div class="vtv-toggle-row"><label><input type="checkbox" id="vtv-autoskip" ${_flags.autoSkip ? 'checked' : ''}> Tự động tua intro</label></div>
            <div class="vtv-toggle-row">
                <label><input type="checkbox" id="vtv-voice" ${_flags.voiceEnabled ? 'checked' : ''}> Voice Control 🎤</label>
                <span id="vtv-voice-label"></span>
            </div>
            <div class="vtv-toggle-row"><label><input type="checkbox" id="vtv-audio-mode" ${_flags.audioMode ? 'checked' : ''}> Audio Mode 🔇</label></div>
            <div class="vtv-toggle-row"><label><input type="checkbox" id="vtv-pip" ${_flags.pipEnabled ? 'checked' : ''}> Auto PiP 🖼️</label></div>
            <div class="vtv-toggle-row"><label><input type="checkbox" id="vtv-playlist" ${_playlistVisible ? 'checked' : ''}> Hiện playlist 📋</label></div>
        `;
        _wireToggles();
    }

    function _wireToggles() {
        const wire = (id, key, gmKey, onChange) => {
            document.getElementById(id)?.addEventListener('change', e => {
                _flags[key] = e.target.checked;
                Storage.saveFlag(gmKey, e.target.checked);
                EventBus.emit('modeChange', { key, value: e.target.checked });
                onChange?.(e.target.checked);
            });
        };

        wire('vtv-auto',       'autoPlay',     'auto',      null);
        wire('vtv-autoskip',   'autoSkip',     'autoskip',  null);
        wire('vtv-voice',      'voiceEnabled', 'voice',
            v => EventBus.emit(v ? 'voiceStart' : 'voiceStop'));
        wire('vtv-audio-mode', 'audioMode',    'audioMode',
            v => EventBus.emit(v ? 'audioModeEnable' : 'audioModeDisable'));
        wire('vtv-pip',        'pipEnabled',   'pip',
            v => EventBus.emit(v ? 'pipEnable' : 'pipDisable'));

        document.getElementById('vtv-marathon')?.addEventListener('change', e => {
            _flags.marathon = e.target.checked;
            Storage.saveFlag('marathon', e.target.checked);
            EventBus.emit('modeChange', { key: 'marathon', value: e.target.checked });
        });

        document.getElementById('vtv-playlist')?.addEventListener('change', e => {
            _playlistVisible = e.target.checked;
            const el = document.getElementById('vtv-list-container');
            if (el) el.style.display = _playlistVisible ? '' : 'none';
        });
    }

    // ─── Public render methods ────────────────────────────────────────────────
    function showSearching() {
        _setTitle('⏳ Đang tìm...');
        _setBody('<div id="vtv-panel-content"></div>');
        _renderToggles('vtv-panel-content');
    }

    function showWrongChannel(name) {
        _setTitle('❌ Sai kênh');
        _setBody(`<div>${name || 'Không xác định'}</div>`);
    }

    function showUnavailable() {
        _setTitle('⚠️ Video không khả dụng');
        _setBody('<div>Video bị gỡ hoặc riêng tư.</div><div id="vtv-panel-content"></div>');
        _renderToggles('vtv-panel-content');
    }

    function showUnrecognized() {
        _setTitle('❌ Không nhận dạng được tập phim');
        _setBody('<div id="vtv-panel-content"></div>');
        _renderToggles('vtv-panel-content');
    }

    function showAutoplay(apTitle, apUrl) {
        _setTitle('🎞️ Gợi ý YouTube');
        _setBody(`
            <div class="vtv-next-title">${escapeHTML(apTitle)}</div>
            <button id="vtv-skip">⏭ Xem ngay</button>
            <div id="vtv-panel-content"></div>`);
        document.getElementById('vtv-skip')
            ?.addEventListener('click', () => { if (apUrl) window.location.href = apUrl; });
        _renderToggles('vtv-panel-content');
    }

    function showOutOfOrder(current, expected, expectedUrl) {
        _setTitle('⚠️ Sai thứ tự tập');
        _setBody(`
            <div class="vtv-message">Bạn đang xem tập ${current}, tập tiếp theo nên là tập ${expected}.</div>
            <div class="vtv-buttons">
                <button id="vtv-go">Đến tập ${expected}</button>
                <button id="vtv-stay" class="vtv-secondary">Ở lại</button>
            </div>
            <div id="vtv-panel-content"></div>`);
        _renderToggles('vtv-panel-content');
        document.getElementById('vtv-go')
            ?.addEventListener('click', () => { if (expectedUrl) window.location.href = expectedUrl; });
        document.getElementById('vtv-stay')
            ?.addEventListener('click', () => EventBus.emit('outOfOrderIgnored'));
    }

    function showFound(title, url, source, prevEp) {
        _setTitle('▶️ Điều hướng');
        _setBody(`
            ${source === 'newseason' ? '<div class="vtv-message">🔁 Phần mới!</div>' : ''}
            <div class="vtv-buttons">
                ${prevEp ? '<button id="vtv-prev" class="vtv-back-btn">◀ Quay lại</button>' : ''}
                ${url    ? '<button id="vtv-skip">⏭ Tiếp theo</button>' : ''}
                <button id="vtv-cancel" class="vtv-secondary" style="display:none;">❌ Huỷ</button>
                <span class="vtv-countdown" id="vtv-cd"></span>
            </div>
            <div class="vtv-next-title">${escapeHTML(title)}</div>
            <div id="vtv-list-container" style="display:${_playlistVisible ? '' : 'none'}"></div>
            <div id="vtv-panel-content"></div>`);

        if (prevEp) {
            document.getElementById('vtv-prev')
                ?.addEventListener('click', () => { if (prevEp.url) window.location.href = prevEp.url; });
        }
        document.getElementById('vtv-skip')
            ?.addEventListener('click', () => { if (url) window.location.href = url; });
        document.getElementById('vtv-cancel')
            ?.addEventListener('click', () => EventBus.emit('cancelRedirect'));

        _renderPlaylist('vtv-list-container');
        _renderToggles('vtv-panel-content');
    }

    function showNotFound(prevEp) {
        _setTitle('❌ Không tìm thấy tập kế');
        _setBody(`
            <input type="text" id="vtv-manual" placeholder="Tìm tập...">
            <button id="vtv-manual-btn">Tìm</button>
            <div id="vtv-list-container" style="display:${_playlistVisible ? '' : 'none'}"></div>
            <div id="vtv-panel-content"></div>`);

        document.getElementById('vtv-manual-btn')?.addEventListener('click', async () => {
            const q = document.getElementById('vtv-manual')?.value.trim();
            if (!q) return;
            const res = await Search.search(q);
            const c   = document.getElementById('vtv-panel-content');
            if (c) c.innerHTML = '<b>Kết quả:</b><ul class="vtv-episode-list">' +
                res.map(r => `<li><a href="https://youtu.be/${r.videoId}">${escapeHTML(r.title)}</a></li>`).join('') +
                '</ul>';
        });

        _renderPlaylist('vtv-list-container');
        _renderToggles('vtv-panel-content');
    }

    function appendMissingWarning(missing) {
        const c = document.getElementById('vtv-panel-content');
        if (!c) return;
        let msg = '';
        if (missing.episodes.length) msg += `⚠️ Tập bị thiếu: ${missing.episodes.join(', ')}. `;
        if (missing.segments.length) {
            msg += '⚠️ Phân đoạn thiếu: ';
            msg += missing.segments.map(s => `Tập ${s.episode} (${s.segment}/${s.totalSeg})`).join(', ');
        }
        if (msg) c.innerHTML += `<br><b>${msg}</b>`;
    }

    // ─── Countdown display ────────────────────────────────────────────────────
    function updateCountdown(remaining) {
        const cd        = document.getElementById('vtv-cd');
        const cancelBtn = document.getElementById('vtv-cancel');
        if (cd)        cd.textContent = remaining > 0 ? `⏳ ${remaining}s` : '';
        if (cancelBtn) cancelBtn.style.display = remaining > 0 ? 'inline-block' : 'none';
    }

    function clearCountdown() { updateCountdown(0); }

    // ─── Voice label ──────────────────────────────────────────────────────────
    function setVoiceLabel(text) {
        const el = document.getElementById('vtv-voice-label');
        if (el) { el.textContent = text || ''; el.title = text || ''; }
    }

    // ─── Scroll to current in YouTube's playlist sidebar ─────────────────────
    function scrollToCurrentInPlaylist() {
        if (!location.href.includes('&list=')) return;
        const cid = new URLSearchParams(location.search).get('v');
        if (!cid) return;
        document.querySelectorAll('ytd-playlist-video-renderer').forEach(el => {
            const a = el.querySelector('#video-title');
            if (a?.href.includes(cid)) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.style.border = '2px solid #3ea6ff';
            }
        });
    }

    // ─── Init & EventBus wiring ───────────────────────────────────────────────
    function init() {
        _flags = Storage.getFeatureFlags();
        _prefs = Storage.getUIPrefs();
        _createPanel();
    }

    // Wire incoming events
    EventBus.on('nextFound',        ({ title, url, source }) => {
        _nextUrl = url;
    });
    EventBus.on('prevFound',        (prev) => { _prevUrl = prev.url; });
    EventBus.on('playlistReady',    ({ list }) => { _list = list; });
    EventBus.on('countdownTick',    ({ remaining }) => updateCountdown(remaining));
    EventBus.on('countdownCancel',  clearCountdown);
    EventBus.on('voiceLabel',       ({ text }) => setVoiceLabel(text));
    EventBus.on('modeChange',       ({ key, value }) => { _flags[key] = value; });

    return {
        init,
        showSearching, showWrongChannel, showUnavailable, showUnrecognized,
        showAutoplay, showOutOfOrder, showFound, showNotFound,
        appendMissingWarning, scrollToCurrentInPlaylist,
        get panel() { return _panel; },
    };
})();
