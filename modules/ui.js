// ui.js — Layer 3: Panel UI
// Redesign: glassmorphism, smooth animations, micro-interactions.
// Hoàn toàn EventBus-driven — không pull state từ globals.

GM_addStyle(`
/* ── Reset & base ───────────────────────────────────────────────────────── */
#vtv-panel *, #vtv-panel *::before, #vtv-panel *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Panel shell ────────────────────────────────────────────────────────── */
#vtv-panel {
    position: fixed;
    bottom: 24px; right: 24px;
    width: 320px;
    background: rgba(15, 15, 20, 0.88);
    backdrop-filter: blur(18px) saturate(160%);
    -webkit-backdrop-filter: blur(18px) saturate(160%);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 16px;
    color: #e8e8ef;
    font-family: 'YouTube Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    z-index: 99999;
    box-shadow:
        0 8px 32px rgba(0,0,0,0.55),
        0 2px 8px  rgba(0,0,0,0.35),
        inset 0 1px 0 rgba(255,255,255,0.07);
    transform: translateY(0);
    transition: opacity .25s ease, transform .25s ease, box-shadow .25s ease;
    overflow: hidden;
    user-select: none;
    will-change: transform;
}
#vtv-panel.vtv-hidden   { opacity: 0; pointer-events: none; transform: translateY(12px); }
#vtv-panel.vtv-collapsed #vtv-body { max-height: 0 !important; }

/* ── Drag handle / header ───────────────────────────────────────────────── */
#vtv-header {
    display: flex; align-items: center; gap: 8px;
    padding: 11px 14px 10px;
    cursor: grab;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.03);
}
#vtv-header:active { cursor: grabbing; }

#vtv-logo {
    width: 22px; height: 22px; flex-shrink: 0;
    background: linear-gradient(135deg, #ff3d3d 0%, #ff6b35 100%);
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 800; color: #fff; letter-spacing: -.5px;
}
#vtv-title {
    flex: 1; font-size: 12.5px; font-weight: 600;
    color: #e0e0eb; letter-spacing: .2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.vtv-hbtn {
    width: 24px; height: 24px; flex-shrink: 0;
    background: rgba(255,255,255,0.07); border: none; border-radius: 7px;
    color: #888; cursor: pointer; font-size: 13px;
    display: flex; align-items: center; justify-content: center;
    transition: background .15s, color .15s;
}
.vtv-hbtn:hover { background: rgba(255,255,255,0.14); color: #ddd; }

/* ── Collapsible body ───────────────────────────────────────────────────── */
#vtv-body {
    max-height: 600px;
    overflow: hidden;
    transition: max-height .3s cubic-bezier(.4,0,.2,1);
}
#vtv-inner { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }

/* ── Status row (main message) ──────────────────────────────────────────── */
#vtv-status {
    font-size: 12px; color: #a0a0b0; line-height: 1.45;
    min-height: 16px;
}
#vtv-status.vtv-loading {
    display: flex; align-items: center; gap: 6px; color: #7878a0;
}
.vtv-spinner {
    width: 13px; height: 13px; flex-shrink: 0;
    border: 2px solid rgba(120,120,160,0.25);
    border-top-color: #7878c0;
    border-radius: 50%;
    animation: vtv-spin .7s linear infinite;
}
@keyframes vtv-spin { to { transform: rotate(360deg); } }

/* ── Next episode card ──────────────────────────────────────────────────── */
#vtv-next-card {
    background: rgba(62,166,255,0.09);
    border: 1px solid rgba(62,166,255,0.2);
    border-radius: 10px;
    padding: 9px 11px;
    display: none;
}
#vtv-next-card.vtv-show { display: block; }
#vtv-next-label { font-size: 10.5px; color: #5fa8d3; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
#vtv-next-title {
    font-size: 12.5px; font-weight: 500; color: #d0e8ff;
    line-height: 1.35; max-height: 50px; overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
}

/* ── Countdown bar ──────────────────────────────────────────────────────── */
#vtv-cd-row {
    display: none; align-items: center; gap: 8px; font-size: 11.5px; color: #ffcc44;
}
#vtv-cd-row.vtv-show { display: flex; }
#vtv-cd-bar-track {
    flex: 1; height: 3px; background: rgba(255,255,255,0.1); border-radius: 99px; overflow: hidden;
}
#vtv-cd-bar { height: 100%; background: #ffcc44; border-radius: 99px; transition: width .9s linear; }
#vtv-cd-sec { font-variant-numeric: tabular-nums; font-weight: 600; min-width: 28px; }

/* ── Action buttons ─────────────────────────────────────────────────────── */
#vtv-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.vtv-btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 6px 13px; border: none; border-radius: 9px;
    font-size: 12.5px; font-weight: 500; cursor: pointer;
    transition: filter .15s, transform .1s;
    white-space: nowrap;
}
.vtv-btn:active { transform: scale(.96); }
.vtv-btn-primary  { background: linear-gradient(135deg,#3ea6ff,#2575d0); color: #fff; }
.vtv-btn-primary:hover  { filter: brightness(1.12); }
.vtv-btn-danger   { background: rgba(220,50,50,.75); color: #fff; }
.vtv-btn-danger:hover   { filter: brightness(1.15); }
.vtv-btn-ghost    { background: rgba(255,255,255,0.08); color: #bbb; }
.vtv-btn-ghost:hover    { background: rgba(255,255,255,0.14); color: #ddd; }
.vtv-btn-cancel   { background: rgba(255,255,255,0.06); color: #888; font-size: 11.5px; padding: 5px 10px; }
.vtv-btn-cancel:hover { color: #bbb; }

/* ── Toggle grid ────────────────────────────────────────────────────────── */
#vtv-toggles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
}
.vtv-tog {
    display: flex; align-items: center; gap: 7px;
    padding: 6px 9px; border-radius: 9px;
    background: rgba(255,255,255,0.05);
    cursor: pointer; transition: background .15s;
    font-size: 12px; color: #aaa;
    border: 1px solid transparent;
}
.vtv-tog:hover { background: rgba(255,255,255,0.09); }
.vtv-tog.vtv-on { background: rgba(62,166,255,0.13); border-color: rgba(62,166,255,0.22); color: #c8e4ff; }
.vtv-tog input { display: none; }
.vtv-sw {
    width: 28px; height: 16px; flex-shrink: 0;
    background: rgba(255,255,255,0.15); border-radius: 99px;
    position: relative; transition: background .2s;
}
.vtv-sw::after {
    content: ''; position: absolute;
    top: 2px; left: 2px;
    width: 12px; height: 12px; border-radius: 50%;
    background: #fff; transition: transform .2s, box-shadow .2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
.vtv-tog.vtv-on .vtv-sw { background: #3ea6ff; }
.vtv-tog.vtv-on .vtv-sw::after { transform: translateX(12px); box-shadow: 0 1px 4px rgba(62,166,255,0.5); }

/* ── Episode list ───────────────────────────────────────────────────────── */
#vtv-list-wrap {
    background: rgba(0,0,0,0.25); border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.06);
    overflow: hidden;
    transition: max-height .3s ease;
}
#vtv-list-hd {
    display: flex; align-items: center; justify-content: space-between;
    padding: 7px 10px; cursor: pointer;
    font-size: 11px; color: #777; text-transform: uppercase; letter-spacing: .4px;
}
#vtv-list-hd:hover { color: #aaa; }
#vtv-list-caret { transition: transform .25s; font-style: normal; }
#vtv-list-wrap.vtv-list-open #vtv-list-caret { transform: rotate(180deg); }
#vtv-list-inner {
    max-height: 0; overflow-y: auto; overflow-x: hidden;
    transition: max-height .3s ease;
    scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent;
}
#vtv-list-wrap.vtv-list-open #vtv-list-inner { max-height: 200px; }
.vtv-ep-item {
    display: flex; align-items: center; gap: 7px;
    padding: 6px 10px; text-decoration: none;
    color: #999; font-size: 12px;
    transition: background .12s, color .12s;
    border-top: 1px solid rgba(255,255,255,0.04);
}
.vtv-ep-item:hover { background: rgba(255,255,255,0.06); color: #ddd; }
.vtv-ep-item.vtv-ep-cur {
    background: rgba(62,166,255,0.12); color: #a8d4ff; font-weight: 600;
}
.vtv-ep-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; opacity: .5; }
.vtv-ep-item.vtv-ep-cur .vtv-ep-dot { background: #3ea6ff; opacity: 1; }

/* ── Warning badge ──────────────────────────────────────────────────────── */
.vtv-warn {
    background: rgba(255,180,0,.1); border: 1px solid rgba(255,180,0,.22);
    border-radius: 8px; padding: 6px 10px;
    font-size: 11.5px; color: #f0c040; line-height: 1.4;
}

/* ── Voice label ────────────────────────────────────────────────────────── */
#vtv-voice-label {
    font-size: 11px; color: #7878c0; font-style: italic;
    min-height: 14px; transition: opacity .2s;
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}

/* ── Mini FAB (when panel hidden) ───────────────────────────────────────── */
#vtv-fab {
    position: fixed; bottom: 24px; right: 24px;
    width: 44px; height: 44px;
    background: linear-gradient(135deg,#ff3d3d,#c0392b);
    border: none; border-radius: 50%; color: #fff;
    font-size: 18px; cursor: pointer; z-index: 99998;
    box-shadow: 0 4px 14px rgba(0,0,0,0.5);
    display: none; align-items: center; justify-content: center;
    transition: transform .2s, box-shadow .2s;
}
#vtv-fab:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.6); }
#vtv-fab.vtv-show { display: flex; }

/* ── Missing ep warning animation ──────────────────────────────────────── */
@keyframes vtv-fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.vtv-fadein { animation: vtv-fadein .2s ease forwards; }
`);

const UI = (() => {
    // ─── State ────────────────────────────────────────────────────────────────
    let _panel       = null;
    let _fab         = null;
    let _collapsed   = false;
    let _listOpen    = false;
    let _list        = [];
    let _flags       = Storage.getFeatureFlags();
    let _prefs       = Storage.getUIPrefs();
    let _prevEp      = null;
    let _nextUrl     = null;
    let _cdTotal     = 0;

    // ─── Build panel DOM (once) ───────────────────────────────────────────────
    function _build() {
        if (_panel) return;

        _panel = document.createElement('div');
        _panel.id = 'vtv-panel';
        _panel.innerHTML = `
            <div id="vtv-header">
                <div id="vtv-logo">V</div>
                <div id="vtv-title">VTV Ultimate</div>
                <button class="vtv-hbtn" id="vtv-btn-collapse" title="Thu gọn">−</button>
                <button class="vtv-hbtn" id="vtv-btn-close"    title="Ẩn">✕</button>
            </div>
            <div id="vtv-body">
                <div id="vtv-inner">
                    <div id="vtv-status"></div>
                    <div id="vtv-next-card">
                        <div id="vtv-next-label">Tập tiếp theo</div>
                        <div id="vtv-next-title"></div>
                    </div>
                    <div id="vtv-cd-row">
                        <div id="vtv-cd-bar-track"><div id="vtv-cd-bar" style="width:100%"></div></div>
                        <span id="vtv-cd-sec">--</span>
                        <button class="vtv-btn vtv-btn-cancel" id="vtv-btn-cancel">Huỷ</button>
                    </div>
                    <div id="vtv-actions"></div>
                    <div id="vtv-voice-label"></div>
                    <div id="vtv-list-wrap">
                        <div id="vtv-list-hd">
                            <span>Danh sách tập</span>
                            <i id="vtv-list-caret">▾</i>
                        </div>
                        <div id="vtv-list-inner"></div>
                    </div>
                    <div id="vtv-toggles"></div>
                    <div id="vtv-warnings"></div>
                </div>
            </div>`;
        document.body.appendChild(_panel);

        _fab = document.createElement('button');
        _fab.id = 'vtv-fab';
        _fab.textContent = '▶';
        _fab.title = 'Hiện VTV Ultimate';
        document.body.appendChild(_fab);

        // Restore prefs
        if (_prefs.collapsed) { _collapsed = true; _panel.classList.add('vtv-collapsed'); }
        if (_prefs.hidden)    { _panel.classList.add('vtv-hidden'); _fab.classList.add('vtv-show'); }
        if (_prefs.panelPos)  _applyPos(_prefs.panelPos);

        _renderToggles();
        _wireEvents();
    }

    function _applyPos(pos) {
        _panel.style.left   = pos.x + 'px';
        _panel.style.top    = pos.y + 'px';
        _panel.style.right  = 'auto';
        _panel.style.bottom = 'auto';
    }

    // ─── Wire static events ───────────────────────────────────────────────────
    function _wireEvents() {
        // Collapse
        document.getElementById('vtv-btn-collapse').addEventListener('click', () => {
            _collapsed = !_collapsed;
            _panel.classList.toggle('vtv-collapsed', _collapsed);
            document.getElementById('vtv-btn-collapse').textContent = _collapsed ? '+' : '−';
            Storage.saveUIPrefs({ collapsed: _collapsed });
        });

        // Hide
        document.getElementById('vtv-btn-close').addEventListener('click', () => {
            _panel.classList.add('vtv-hidden');
            _fab.classList.add('vtv-show');
            Storage.saveUIPrefs({ hidden: true });
        });

        // FAB → show
        _fab.addEventListener('click', () => {
            _panel.classList.remove('vtv-hidden');
            _fab.classList.remove('vtv-show');
            Storage.saveUIPrefs({ hidden: false });
        });

        // Cancel countdown
        document.getElementById('vtv-btn-cancel').addEventListener('click', () => {
            EventBus.emit('cancelRedirect');
        });

        // Playlist toggle
        document.getElementById('vtv-list-hd').addEventListener('click', () => {
            _listOpen = !_listOpen;
            document.getElementById('vtv-list-wrap').classList.toggle('vtv-list-open', _listOpen);
        });

        // Drag
        _makeDraggable(document.getElementById('vtv-header'));
    }

    function _makeDraggable(handle) {
        let dragging = false, ox, oy, il, it;
        handle.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            dragging = true;
            const r = _panel.getBoundingClientRect();
            il = r.left; it = r.top; ox = e.clientX; oy = e.clientY;
            document.body.style.cursor = 'grabbing';
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            _panel.style.left   = (il + e.clientX - ox) + 'px';
            _panel.style.top    = (it + e.clientY - oy) + 'px';
            _panel.style.right  = 'auto';
            _panel.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            document.body.style.cursor = '';
            _clampToViewport();
            const r = _panel.getBoundingClientRect();
            Storage.saveUIPrefs({ panelPos: { x: r.left, y: r.top } });
        });
    }

    function _clampToViewport() {
        const r = _panel.getBoundingClientRect(), m = 16;
        let x = r.left, y = r.top;
        x = Math.min(Math.max(x, m), window.innerWidth  - r.width  - m);
        y = Math.min(Math.max(y, m), window.innerHeight - r.height - m);
        if (x !== r.left || y !== r.top) {
            _panel.style.left = x + 'px';
            _panel.style.top  = y + 'px';
        }
    }

    // ─── Toggles ──────────────────────────────────────────────────────────────
    const TOGGLE_DEFS = [
        { id: 'tog-auto',     flag: 'autoPlay',     gm: 'auto',      icon: '⏭', label: 'Tự chuyển' },
        { id: 'tog-marathon', flag: 'marathon',     gm: 'marathon',  icon: '🏃', label: 'Marathon' },
        { id: 'tog-skip',     flag: 'autoSkip',     gm: 'autoskip',  icon: '⏩', label: 'Auto Skip' },
        { id: 'tog-voice',    flag: 'voiceEnabled', gm: 'voice',     icon: '🎤', label: 'Voice (V)' },
        { id: 'tog-audio',    flag: 'audioMode',    gm: 'audioMode', icon: '🔇', label: 'Audio Mode' },
        { id: 'tog-pip',      flag: 'pipEnabled',   gm: 'pip',       icon: '🖼️', label: 'PiP' },
    ];

    function _renderToggles() {
        const grid = document.getElementById('vtv-toggles');
        if (!grid) return;
        grid.innerHTML = '';
        for (const def of TOGGLE_DEFS) {
            const on  = !!_flags[def.flag];
            const tog = document.createElement('label');
            tog.className = 'vtv-tog' + (on ? ' vtv-on' : '');
            tog.id = def.id;
            tog.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''}><span class="vtv-sw"></span>${def.icon} ${def.label}`;
            tog.querySelector('input').addEventListener('change', e => {
                const val = e.target.checked;
                _flags[def.flag] = val;
                tog.classList.toggle('vtv-on', val);
                Storage.saveFlag(def.gm, val);
                EventBus.emit('modeChange', { key: def.flag, value: val });
                // Feature-specific side events
                if (def.flag === 'voiceEnabled') EventBus.emit(val ? 'voiceStart'       : 'voiceStop');
                if (def.flag === 'audioMode')    EventBus.emit(val ? 'audioModeEnable'  : 'audioModeDisable');
                if (def.flag === 'pipEnabled')   EventBus.emit(val ? 'pipEnable'        : 'pipDisable');
            });
            grid.appendChild(tog);
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function _setStatus(html, loading = false) {
        const el = document.getElementById('vtv-status');
        if (!el) return;
        el.className = loading ? 'vtv-loading' : '';
        el.innerHTML = loading
            ? `<div class="vtv-spinner"></div>${html}`
            : html;
    }

    function _setTitle(t) {
        const el = document.getElementById('vtv-title');
        if (el) el.textContent = t;
    }

    function _setActions(...btns) {
        const el = document.getElementById('vtv-actions');
        if (!el) return;
        el.innerHTML = '';
        for (const { label, cls, onClick } of btns) {
            const b = document.createElement('button');
            b.className = `vtv-btn ${cls}`;
            b.innerHTML = label;
            b.addEventListener('click', onClick);
            el.appendChild(b);
        }
    }

    function _showNextCard(title, show = true) {
        const card  = document.getElementById('vtv-next-card');
        const titleEl = document.getElementById('vtv-next-title');
        if (!card || !titleEl) return;
        if (show) {
            titleEl.textContent = title;
            card.classList.add('vtv-show');
        } else {
            card.classList.remove('vtv-show');
        }
    }

    function _renderList() {
        const inner = document.getElementById('vtv-list-inner');
        if (!inner || !_list.length) return;
        inner.innerHTML = '';
        for (const ep of _list) {
            const a = document.createElement('a');
            a.className = 'vtv-ep-item' + (ep.isCurrent ? ' vtv-ep-cur' : '');
            a.href = ep.url;
            a.innerHTML = `<span class="vtv-ep-dot"></span>${escapeHTML(ep.title)}`;
            inner.appendChild(a);
        }
        // Auto-scroll to current
        const cur = inner.querySelector('.vtv-ep-cur');
        if (cur) setTimeout(() => cur.scrollIntoView({ block: 'nearest' }), 50);
    }

    // ─── Public render states ─────────────────────────────────────────────────
    function showSearching() {
        _setTitle('VTV Ultimate');
        _setStatus('Đang tìm kiếm...', true);
        _showNextCard('', false);
        document.getElementById('vtv-cd-row')?.classList.remove('vtv-show');
        document.getElementById('vtv-warnings').innerHTML = '';
        _setActions();
    }

    function showWrongChannel(name) {
        _setTitle('Không phải kênh VTV');
        _setStatus(name ? `Kênh: <b>${escapeHTML(name)}</b>` : 'Kênh không xác định');
        _showNextCard('', false);
        _setActions();
    }

    function showUnavailable() {
        _setTitle('Video không khả dụng');
        _setStatus('Video bị gỡ hoặc riêng tư.');
        _showNextCard('', false);
        _setActions();
    }

    function showUnrecognized() {
        _setTitle('Không nhận dạng');
        _setStatus('Không phát hiện tên tập phim trong tiêu đề.');
        _showNextCard('', false);
        _setActions();
    }

    function showAutoplay(apTitle, apUrl) {
        _setTitle('Gợi ý YouTube');
        _setStatus('Không có tập tiếp theo trong danh sách VTV.');
        _showNextCard(apTitle, true);
        _setActions({ label: '⏭ Xem ngay', cls: 'vtv-btn-primary', onClick: () => { if (apUrl) location.href = apUrl; } });
    }

    function showOutOfOrder(current, expected, expectedUrl) {
        _setTitle('⚠️ Sai thứ tự');
        _setStatus(`Bạn đang xem tập <b>${current}</b>. Tiến trình đang ở tập <b>${expected}</b>.`);
        _showNextCard('', false);
        _setActions(
            { label: `Đến tập ${expected}`, cls: 'vtv-btn-primary', onClick: () => { if (expectedUrl) location.href = expectedUrl; } },
            { label: 'Bỏ qua',              cls: 'vtv-btn-ghost',   onClick: () => EventBus.emit('outOfOrderIgnored') }
        );
    }

    function showFound(title, url, source, prev) {
        _setTitle(source === 'newseason' ? '🔁 Phần mới!' : '▶ Tập tiếp theo');
        _setStatus(source === 'cached' ? 'Tìm thấy trong danh sách' : source === 'autoplay' ? 'Gợi ý YouTube' : 'Đã tìm thấy');
        _showNextCard(title, true);
        _nextUrl = url;
        _prevEp  = prev;

        const btns = [];
        if (url)  btns.push({ label: '⏭ Tiếp theo', cls: 'vtv-btn-primary', onClick: () => location.href = url });
        if (prev?.url) btns.push({ label: '◀ Quay lại', cls: 'vtv-btn-danger', onClick: () => location.href = prev.url });
        _setActions(...btns);

        _renderList();
    }

    function showNotFound(prev) {
        _setTitle('Không tìm thấy tập kế');
        _setStatus('Không tìm thấy tập tiếp theo.');
        _showNextCard('', false);

        const btns = [];
        if (prev?.url) btns.push({ label: '◀ Quay lại', cls: 'vtv-btn-danger', onClick: () => location.href = prev.url });
        _setActions(...btns);
        _renderList();
    }

    function appendMissingWarning({ episodes, segments }) {
        const el = document.getElementById('vtv-warnings');
        if (!el) return;
        let html = '';
        if (episodes.length) html += `⚠️ Tập bị thiếu: <b>${episodes.join(', ')}</b>`;
        if (segments.length) {
            if (html) html += '<br>';
            html += '⚠️ Phân đoạn thiếu: ' + segments.map(s => `T${s.episode}(${s.segment}/${s.totalSeg})`).join(', ');
        }
        if (html) {
            el.innerHTML = `<div class="vtv-warn vtv-fadein">${html}</div>`;
        }
    }

    // ─── Countdown ────────────────────────────────────────────────────────────
    function updateCountdown(remaining) {
        const row = document.getElementById('vtv-cd-row');
        const sec = document.getElementById('vtv-cd-sec');
        const bar = document.getElementById('vtv-cd-bar');
        if (!row) return;
        if (remaining <= 0) {
            row.classList.remove('vtv-show');
            return;
        }
        row.classList.add('vtv-show');
        sec.textContent = remaining + 's';
        if (_cdTotal > 0) bar.style.width = (remaining / _cdTotal * 100) + '%';
    }

    function startCountdown(total) {
        _cdTotal = total;
        const bar = document.getElementById('vtv-cd-bar');
        if (bar) bar.style.width = '100%';
        updateCountdown(total);
    }

    function clearCountdown() {
        updateCountdown(0);
        _cdTotal = 0;
    }

    function setVoiceLabel(text) {
        const el = document.getElementById('vtv-voice-label');
        if (el) el.textContent = text || '';
    }

    function scrollToCurrentInPlaylist() {
        if (!location.href.includes('&list=')) return;
        const cid = new URLSearchParams(location.search).get('v');
        if (!cid) return;
        document.querySelectorAll('ytd-playlist-video-renderer').forEach(el => {
            const a = el.querySelector('a#video-title');
            if (a?.href?.includes(cid)) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.style.outline = '2px solid #3ea6ff';
            }
        });
    }

    // ─── Init ─────────────────────────────────────────────────────────────────
    function init() {
        _flags = Storage.getFeatureFlags();
        _prefs = Storage.getUIPrefs();
        _build();
    }

    // ─── EventBus wiring ──────────────────────────────────────────────────────
    EventBus.on('nextFound',       ({ title, url }) => { _nextUrl = url; });
    EventBus.on('prevFound',       (prev)           => { _prevEp = prev; });
    EventBus.on('playlistReady',   ({ list })        => { _list = list; });
    EventBus.on('countdownTick',   ({ remaining, total }) => {
        if (total) _cdTotal = total;
        updateCountdown(remaining);
    });
    EventBus.on('countdownStart',  ({ total })       => startCountdown(total));
    EventBus.on('countdownCancel', ()                => clearCountdown());
    EventBus.on('voiceLabel',      ({ text })        => setVoiceLabel(text));
    EventBus.on('modeChange',      ({ key, value })  => { _flags[key] = value; });

    return {
        init,
        showSearching, showWrongChannel, showUnavailable, showUnrecognized,
        showAutoplay, showOutOfOrder, showFound, showNotFound,
        appendMissingWarning, scrollToCurrentInPlaylist,
        get panel() { return _panel; },
    };
})();
