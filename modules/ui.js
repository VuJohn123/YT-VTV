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
    max-width: calc(100vw - 48px);
    /* Trước đây panel không có giới hạn chiều cao tổng thể — trên viewport
       thấp (cửa sổ nhỏ, DevTools mở, laptop màn hình thấp...) nội dung dài
       (danh sách tập thiếu, cảnh báo...) đẩy panel tràn lên TRÊN mép màn
       hình (vì neo bottom:24px, panel phình lên trên khi nội dung dài),
       bị trình duyệt cắt mất phần trên mà không có cách nào cuộn tới.
       FIX LẦN 1 (max-height: calc(100vh - 48px)) tạo ra REGRESSION MỚI: cho
       phép panel cao tới mức mép trên chỉ cách top màn hình 24px — ĐÈ LÊN
       đúng vùng chuông thông báo/avatar/tạo video của YouTube (topbar cao
       ~56-64px, cùng phía phải với panel neo right:24px) — user không bấm
       được các nút đó nữa khi panel mở rộng đủ cao. Giờ chừa hẳn 96px ở
       trên — đủ dư so với topbar thật (~64px) mà vẫn giải quyết được bug
       gốc (nội dung dài vẫn cuộn được trong #vtv-body bên dưới thay vì
       tràn ra ngoài). */
    max-height: calc(100vh - 96px);
    display: flex;
    flex-direction: column;
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
    flex-shrink: 0;
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
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0; /* bắt buộc để flex child cho phép co lại nhỏ hơn content, kích hoạt scroll thay vì tràn */
    transition: max-height .3s cubic-bezier(.4,0,.2,1);
    scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent;
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
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
}
.vtv-tog {
    display: flex; align-items: center; justify-content: center;
    flex-direction: column; gap: 3px;
    padding: 7px 4px 6px; border-radius: 9px;
    background: rgba(255,255,255,0.05);
    cursor: pointer; transition: background .15s, border-color .15s;
    border: 1px solid transparent;
    min-width: 0; overflow: hidden;
}
.vtv-tog:hover { background: rgba(255,255,255,0.09); }
.vtv-tog.vtv-on { background: rgba(62,166,255,0.13); border-color: rgba(62,166,255,0.25); }
.vtv-tog input { display: none; }
.vtv-tog-icon {
    font-size: 15px; line-height: 1; flex-shrink: 0;
    position: relative;
}
.vtv-tog-icon::after {
    content: '';
    position: absolute; bottom: -2px; right: -3px;
    width: 5px; height: 5px; border-radius: 50%;
    background: #444; transition: background .2s;
}
.vtv-tog.vtv-on .vtv-tog-icon::after { background: #3ea6ff; }
.vtv-tog-lbl {
    font-size: 10px; color: #777; letter-spacing: .1px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 100%; text-align: center;
    transition: color .15s; line-height: 1.1;
}
.vtv-tog.vtv-on .vtv-tog-lbl { color: #7ab8f5; }

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

/* ── Advanced toggles group (collapsible, cùng pattern với list tập) ────── */
#vtv-adv-wrap {
    background: rgba(0,0,0,0.25); border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.06);
    overflow: hidden;
}
#vtv-adv-hd {
    display: flex; align-items: center; justify-content: space-between;
    padding: 7px 10px; cursor: pointer;
    font-size: 11px; color: #777; text-transform: uppercase; letter-spacing: .4px;
}
#vtv-adv-hd:hover { color: #aaa; }
#vtv-adv-caret { transition: transform .25s; font-style: normal; }
#vtv-adv-wrap.vtv-adv-open #vtv-adv-caret { transform: rotate(180deg); }
#vtv-adv-inner {
    max-height: 0; overflow: hidden;
    transition: max-height .25s ease;
}
/* Trước đây max-height: 60px — chỉ đủ cho 3 hàng toggle, nhưng
   #vtv-room-panel/#vtv-tv-panel (mã phòng, nút kết nối, form ghép TV) nằm
   LỒNG BÊN TRONG #vtv-adv-inner — khi mở "Sync tab"/"TV Mode", nội dung
   thật sự cần nhiều hơn 60px rất nhiều, bị overflow:hidden cắt gần hết
   (đúng bug đã báo: layout bị hẹp, nút "Tạo phòng mới" như bị cắt, mã phòng
   không hiện đủ). Nâng lên đủ rộng cho mọi tổ hợp nội dung; #vtv-body (viền
   ngoài) đã có overflow-y:auto nên nếu vẫn còn dư sẽ tự cuộn, không tràn ra
   ngoài màn hình. */
#vtv-adv-wrap.vtv-adv-open #vtv-adv-inner { max-height: 420px; }
#vtv-toggles-adv {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px;
    padding: 4px;
}

/* ── Watch Party room panel ──────────────────────────────────────────────── */
#vtv-room-panel {
    padding: 8px; display: flex; flex-direction: column; gap: 6px;
}
.vtv-room-row { display: flex; gap: 6px; align-items: center; }
.vtv-room-input {
    flex: 1; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.15);
    color: #eee; border-radius: 6px; padding: 5px 8px; font-size: 12px;
    text-transform: uppercase; letter-spacing: 1px; text-align: center;
    min-width: 0;
}
.vtv-room-code {
    font-size: 18px; font-weight: 700; letter-spacing: 3px; text-align: center;
    color: #a8d4ff; background: rgba(62,166,255,.1); border: 1px solid rgba(62,166,255,.3);
    border-radius: 8px; padding: 8px; user-select: all; cursor: pointer;
}
.vtv-room-status { font-size: 11px; color: #999; text-align: center; }
.vtv-room-btn {
    background: rgba(62,166,255,.18); border: 1px solid rgba(62,166,255,.4);
    color: #cfe8ff; border-radius: 6px; padding: 6px 10px; font-size: 11.5px;
    cursor: pointer; font-weight: 600; white-space: nowrap;
}
.vtv-room-btn:hover { background: rgba(62,166,255,.28); }
.vtv-room-btn:disabled { opacity: .5; cursor: default; }
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
.vtv-btn-mini {
    background: rgba(62,166,255,.15); border: 1px solid rgba(62,166,255,.35);
    color: #a8d4ff; border-radius: 6px; padding: 3px 8px; margin-left: 6px;
    font-size: 11px; cursor: pointer; font-weight: 600;
}
.vtv-btn-mini:hover { background: rgba(62,166,255,.25); }
.vtv-btn-mini-ghost {
    background: transparent; border-color: rgba(255,255,255,.15); color: #999;
}
.vtv-btn-mini-ghost:hover { background: rgba(255,255,255,.06); }

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
                    <div id="vtv-adv-wrap">
                        <div id="vtv-adv-hd">
                            <span>Tính năng nâng cao</span>
                            <i id="vtv-adv-caret">▾</i>
                        </div>
                        <div id="vtv-adv-inner">
                            <div id="vtv-toggles-adv"></div>
                            <div id="vtv-room-panel" style="display:none"></div>
                            <div id="vtv-tv-panel" style="display:none"></div>
                        </div>
                    </div>
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

        // Advanced toggles group — thu gọn mặc định, mở/đóng khi click header
        document.getElementById('vtv-adv-hd').addEventListener('click', () => {
            document.getElementById('vtv-adv-wrap').classList.toggle('vtv-adv-open');
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
        { id: 'tog-marathon', flag: 'marathon',     gm: 'marathon',  icon: '🚫', label: 'Chặn QC+', combo: 'sponsorBlock' }, // flag/gm key giữ tên cũ 'marathon' để không phá dữ liệu user đã lưu, nhưng thực chất đây là AdBlock toggle. GỘP với SponsorBlock: bật 1 nút này tắt/bật CẢ HAI (quảng cáo YouTube lẫn đoạn sponsor trong video) — trước đây 2 nút riêng biệt (Chặn QC + Skip Sponsor) gây rối vì cùng chung mục đích "loại bỏ nội dung không muốn xem".
        { id: 'tog-skip',     flag: 'autoSkip',     gm: 'autoskip',  icon: '⏩', label: 'Skip Intro'},
        { id: 'tog-voice',    flag: 'voiceEnabled', gm: 'voice',     icon: '🎤', label: 'Voice'     },
        { id: 'tog-audio',    flag: 'audioMode',    gm: 'audioMode', icon: '🔇', label: 'Audio'     },
        { id: 'tog-pip',      flag: 'pipEnabled',   gm: 'pip',       icon: '🖼',  label: 'PiP'       },
        { id: 'tog-wp',       flag: 'watchParty',   gm: 'watchParty', icon: '🔗', label: 'Sync tab (cùng máy)', advanced: true }, // Chỉ đồng bộ giữa các tab CÙNG máy/CÙNG trình duyệt qua BroadcastChannel — KHÔNG phải xem chung qua mạng với người khác (khác Teleparty/Discord). Đổi label cho rõ, tránh hiểu lầm.
        { id: 'tog-tv',       flag: 'tvMode',       gm: 'tvMode',      icon: '📺', label: 'TV Mode', advanced: true },
    ];

    /**
     * Render Room UI cho Watch Party remote tier (nhiều máy). 3 trạng thái:
     * 1. Chưa vào phòng nào — nút "Tạo phòng" + ô nhập code để vào phòng có sẵn
     * 2. Đang tạo/kết nối (loading) — disable nút, hiện "Đang kết nối..."
     * 3. Đã trong phòng — hiện room code lớn (bấm để copy) + số người + nút Rời
     */
    /**
     * Render TV Mode panel — kết nối YouTube trên TV qua Lounge API.
     * 2 trạng thái: chưa kết nối (nhập mã ghép nối 12 số) / đã kết nối
     * (hiện tên TV + nút ngắt).
     */
    function _renderTvPanel() {
        const el = document.getElementById('vtv-tv-panel');
        if (!el) return;

        if (TvMode.isConnected()) {
            el.innerHTML = `
                <div class="vtv-room-status">📺 Đã kết nối: <b>${TvMode.getScreenName() || 'TV'}</b></div>
                <button class="vtv-room-btn" id="vtv-tv-disconnect-btn">Ngắt kết nối</button>`;
            document.getElementById('vtv-tv-disconnect-btn')?.addEventListener('click', async () => {
                await TvMode.disconnect();
                _renderTvPanel();
            });
            return;
        }

        el.innerHTML = `
            <div class="vtv-room-status">Trên TV: Cài đặt → "Liên kết bằng mã TV" để hiện mã 12 số</div>
            <div class="vtv-room-row">
                <input class="vtv-room-input" id="vtv-tv-code-input" placeholder="123456789012" maxlength="14">
                <button class="vtv-room-btn" id="vtv-tv-connect-btn">Kết nối</button>
            </div>
            <div class="vtv-room-status" id="vtv-tv-msg"></div>`;

        const msgEl = document.getElementById('vtv-tv-msg');
        document.getElementById('vtv-tv-connect-btn')?.addEventListener('click', async (e) => {
            const code = document.getElementById('vtv-tv-code-input')?.value?.trim();
            if (!code) { msgEl.textContent = '❌ Nhập mã ghép nối'; return; }
            e.target.disabled = true;
            msgEl.textContent = 'Đang ghép nối...';
            try {
                const info = await TvMode.pairWithCode(code);
                msgEl.textContent = `Đã tìm thấy "${info.name}", đang kết nối...`;
                await TvMode.connect();

                // BUG ĐÃ SỬA: trước đây chỉ TvMode.connect() xong là dừng —
                // video ĐANG XEM lúc kết nối không tự mở trên TV, phải đợi
                // chuyển sang tập KHÁC (navigation) mới có video được cast,
                // vì playVideo() trước đây chỉ được gọi trong _runMain() (chạy
                // theo navigation event). Cast NGAY video hiện tại ở đây.
                const currentVideoId = new URLSearchParams(location.search).get('v');
                const v = VideoContext.getVideoEl();
                if (currentVideoId) {
                    msgEl.textContent = `Đã kết nối "${info.name}" — đang mở video hiện tại...`;
                    try {
                        await TvMode.playVideo(currentVideoId, v?.currentTime || 0);
                    } catch (castErr) {
                        warn('[UI] Kết nối TV thành công nhưng cast video hiện tại thất bại:', castErr);
                        // Không coi là lỗi nghiêm trọng — kết nối vẫn thành công,
                        // user có thể tự chuyển tập để cast, hoặc thử lại.
                    }
                }

                _renderTvPanel();
            } catch (err) {
                msgEl.textContent = '❌ ' + (err.message || 'Lỗi kết nối TV');
                e.target.disabled = false;
            }
        });
    }

    function _renderRoomPanel() {
        const el = document.getElementById('vtv-room-panel');
        if (!el) return;

        const info = WatchParty.getRoomInfo();

        if (info.roomId) {
            // Trạng thái 3: đang trong phòng
            const followChecked = WatchParty.getFollowNav() ? 'checked' : '';
            el.innerHTML = `
                <div class="vtv-room-code" id="vtv-room-code-display" title="Bấm để copy">${info.roomId}</div>
                <div class="vtv-room-status">${info.isHost ? 'Chủ phòng' : 'Khách'} · ${info.peerCount} người khác đang kết nối</div>
                <label class="vtv-room-row" style="cursor:pointer">
                    <input type="checkbox" id="vtv-room-follow-nav" ${followChecked}>
                    <span class="vtv-room-status" style="flex:1">Tự chuyển tập theo phòng</span>
                </label>
                <button class="vtv-room-btn" id="vtv-room-leave-btn">Rời phòng</button>`;
            document.getElementById('vtv-room-code-display')?.addEventListener('click', () => {
                navigator.clipboard?.writeText(info.roomId).then(() => {
                    EventBus.emit('voiceLabel', { text: '📋 Đã copy mã phòng' });
                }).catch(() => {});
            });
            document.getElementById('vtv-room-follow-nav')?.addEventListener('change', (e) => {
                WatchParty.setFollowNav(e.target.checked);
            });
            document.getElementById('vtv-room-leave-btn')?.addEventListener('click', () => {
                WatchParty.leaveRoom();
                _renderRoomPanel();
            });
            return;
        }

        if (!WatchParty.isRemoteSupported()) {
            el.innerHTML = `<div class="vtv-room-status">⚠️ Trình duyệt không hỗ trợ WebRTC, không thể tạo phòng nhiều máy.</div>`;
            return;
        }

        // Trạng thái 1: chưa vào phòng nào
        el.innerHTML = `
            <button class="vtv-room-btn" id="vtv-room-create-btn">➕ Tạo phòng mới</button>
            <div class="vtv-room-row">
                <input class="vtv-room-input" id="vtv-room-code-input" placeholder="Nhập mã phòng" maxlength="6">
                <button class="vtv-room-btn" id="vtv-room-join-btn">Vào phòng</button>
            </div>
            <div class="vtv-room-status" id="vtv-room-msg"></div>`;

        const msgEl = document.getElementById('vtv-room-msg');

        document.getElementById('vtv-room-create-btn')?.addEventListener('click', async (e) => {
            e.target.disabled = true;
            msgEl.textContent = 'Đang tạo phòng...';
            try {
                await WatchParty.createRoom();
                _renderRoomPanel();
            } catch (err) {
                msgEl.textContent = '❌ ' + (err.message || 'Lỗi tạo phòng');
                e.target.disabled = false;
            }
        });

        document.getElementById('vtv-room-join-btn')?.addEventListener('click', async (e) => {
            const code = document.getElementById('vtv-room-code-input')?.value?.trim();
            if (!code || code.length < 4) { msgEl.textContent = '❌ Nhập mã phòng hợp lệ'; return; }
            e.target.disabled = true;
            msgEl.textContent = 'Đang kết nối...';
            try {
                await WatchParty.joinRoom(code);
                _renderRoomPanel();
            } catch (err) {
                msgEl.textContent = '❌ ' + (err.message || 'Không kết nối được');
                e.target.disabled = false;
            }
        });
    }


    function _renderToggles() {
        const grid    = document.getElementById('vtv-toggles');
        const gridAdv = document.getElementById('vtv-toggles-adv');
        const advWrap = document.getElementById('vtv-adv-wrap');
        if (!grid || !gridAdv) return;
        grid.innerHTML = ''; gridAdv.innerHTML = '';

        let anyAdvancedOn = false;

        for (const def of TOGGLE_DEFS) {
            const on  = !!_flags[def.flag];
            if (def.advanced && on) anyAdvancedOn = true;

            const tog = document.createElement('label');
            tog.className = 'vtv-tog' + (on ? ' vtv-on' : '');
            tog.id = def.id;
            tog.title = def.label;
            tog.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''}><span class="vtv-tog-icon">${def.icon}</span><span class="vtv-tog-lbl">${def.label}</span>`;
            tog.querySelector('input').addEventListener('change', e => {
                const val = e.target.checked;
                _flags[def.flag] = val;
                Storage.saveFlag(def.gm, val);
                // EventBus.emit('modeChange') là nguồn chân lý DUY NHẤT cập nhật
                // UI (class 'vtv-on', checked state, mở nhóm nâng cao nếu cần) —
                // xem listener modeChange bên dưới. Không set thủ công ở đây nữa
                // để tránh 2 nơi cùng làm 1 việc dễ lệch nhau khi sửa code sau này.
                EventBus.emit('modeChange', { key: def.flag, value: val });
                // Feature-specific side events
                if (def.flag === 'voiceEnabled') EventBus.emit(val ? 'voiceStart'       : 'voiceStop');
                if (def.flag === 'audioMode')    EventBus.emit(val ? 'audioModeEnable'  : 'audioModeDisable');
                if (def.flag === 'pipEnabled')   EventBus.emit(val ? 'pipEnable'        : 'pipDisable');
                // Combo flag: nút "Chặn QC+" (marathon) giờ điều khiển CẢ
                // AdBlock (qua modeChange emit ở trên) LẪN SponsorBlock cùng
                // lúc — gộp 2 tính năng "loại bỏ nội dung không muốn xem"
                // thành 1 nút duy nhất thay vì tách rời gây rối.
                if (def.combo) {
                    _flags[def.combo] = val;
                    Storage.saveFlag(def.combo, val);
                    if (def.combo === 'sponsorBlock') {
                        const vid = new URLSearchParams(location.search).get('v');
                        val ? SponsorBlock.enable(vid) : SponsorBlock.disable();
                    }
                }
                if (def.flag === 'watchParty') {
                    val ? WatchParty.enable() : WatchParty.disable();
                    const roomPanel = document.getElementById('vtv-room-panel');
                    if (roomPanel) {
                        roomPanel.style.display = val ? 'flex' : 'none';
                        if (val) _renderRoomPanel();
                    }
                }
                if (def.flag === 'tvMode') {
                    const tvPanel = document.getElementById('vtv-tv-panel');
                    if (tvPanel) {
                        tvPanel.style.display = val ? 'flex' : 'none';
                        if (val) _renderTvPanel();
                        else if (TvMode.isConnected()) TvMode.disconnect(); // tắt toggle = ngắt kết nối luôn, tránh treo phiên vô ích
                    }
                }
            });
            (def.advanced ? gridAdv : grid).appendChild(tog);
        }

        // Tự mở nhóm nâng cao nếu có tính năng nào trong đó đang bật — tránh
        // trạng thái "user đã bật SponsorBlock nhưng panel hiện thu gọn, nhìn
        // như tính năng biến mất" gây khó hiểu ở lần mở panel tiếp theo.
        if (anyAdvancedOn && advWrap) advWrap.classList.add('vtv-adv-open');

        // Nếu watchParty đã bật sẵn từ trước (reload trang khi đang bật), hiện
        // room panel ngay — không cần đợi user tự toggle lại mới thấy.
        if (_flags.watchParty) {
            const roomPanel = document.getElementById('vtv-room-panel');
            if (roomPanel) { roomPanel.style.display = 'flex'; _renderRoomPanel(); }
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
        _setActions({ label: '⏭ Xem ngay', cls: 'vtv-btn-primary', onClick: () => { if (apUrl) Navigator.goTo(apUrl); } });
    }

    function showOutOfOrder(current, expected, expectedUrl) {
        _setTitle('⚠️ Sai thứ tự');
        _setStatus(`Bạn đang xem tập <b>${current}</b>. Tiến trình đang ở tập <b>${expected}</b>.`);
        _showNextCard('', false);
        _setActions(
            { label: `Đến tập ${expected}`, cls: 'vtv-btn-primary', onClick: () => { if (expectedUrl) Navigator.goTo(expectedUrl); } },
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
        if (url)  btns.push({ label: '⏭ Tiếp theo', cls: 'vtv-btn-primary', onClick: () => Navigator.goTo(url) });
        if (prev?.url) btns.push({ label: '◀ Quay lại', cls: 'vtv-btn-danger', onClick: () => Navigator.goTo(prev.url) });
        _setActions(...btns);

        _renderList();
    }

    function showNotFound(prev) {
        _setTitle('Không tìm thấy tập kế');
        _setStatus('Không tìm thấy tập tiếp theo.');
        _showNextCard('', false);

        const btns = [];
        if (prev?.url) btns.push({ label: '◀ Quay lại', cls: 'vtv-btn-danger', onClick: () => Navigator.goTo(prev.url) });
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

    /**
     * Banner hỏi "xem tiếp tập dở" — dùng chung #vtv-warnings container, KHÔNG
     * đè lên panel chính (khác showOutOfOrder/showFound vốn thay toàn bộ nội
     * dung), vì đây chỉ là gợi ý phụ trong lúc tập hiện tại vẫn đang xử lý
     * bình thường song song.
     */
    function showContinuePrompt(lastPos) {
        const el = document.getElementById('vtv-warnings');
        if (!el) return;
        const pct = lastPos.duration > 0 ? Math.round(lastPos.currentTime / lastPos.duration * 100) : 0;
        const mins = Math.floor(lastPos.currentTime / 60);
        const secs = Math.floor(lastPos.currentTime % 60).toString().padStart(2, '0');
        el.innerHTML = `<div class="vtv-warn vtv-fadein" id="vtv-continue-prompt">
            📌 Bạn đang xem dở tập <b>${lastPos.episode}</b> (${mins}:${secs}, ${pct}%).
            <button id="vtv-continue-btn" class="vtv-btn-mini">Xem tiếp</button>
            <button id="vtv-continue-dismiss" class="vtv-btn-mini vtv-btn-mini-ghost">Bỏ qua</button>
        </div>`;
        document.getElementById('vtv-continue-btn')?.addEventListener('click', () => {
            EventBus.emit('continueRequested', lastPos);
            el.innerHTML = '';
        });
        document.getElementById('vtv-continue-dismiss')?.addEventListener('click', () => { el.innerHTML = ''; });
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
    EventBus.on('modeChange', ({ key, value }) => {
        _flags[key] = value;
        // Đồng bộ lại checkbox DOM tương ứng — trước đây chỉ update biến
        // _flags trong bộ nhớ, khiến UI panel không phản ánh đúng trạng thái
        // khi tính năng được bật/tắt từ nguồn khác (voice command, ví dụ
        // "bật sponsorblock") thay vì click trực tiếp vào checkbox.
        const def = TOGGLE_DEFS.find(d => d.flag === key);
        if (!def) return;
        const tog = document.getElementById(def.id);
        if (!tog) return;
        tog.classList.toggle('vtv-on', value);
        const input = tog.querySelector('input');
        if (input) input.checked = value;
        // Nếu vừa bật 1 toggle nâng cao từ nguồn ngoài UI, mở nhóm ra để user
        // thấy phản hồi visual thay vì phải tự tìm.
        if (def.advanced && value) document.getElementById('vtv-adv-wrap')?.classList.add('vtv-adv-open');
    });

    return {
        init,
        showSearching, showWrongChannel, showUnavailable, showUnrecognized,
        showAutoplay, showOutOfOrder, showFound, showNotFound,
        appendMissingWarning, showContinuePrompt, scrollToCurrentInPlaylist,
        get panel() { return _panel; },
    };
})();
