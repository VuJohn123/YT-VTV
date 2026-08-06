// audio-graph.js — Layer 2: quản lý CHUNG 1 Web Audio API graph cho video hiện
// tại. LÝ DO TỒN TẠI MODULE NÀY: `AudioContext.createMediaElementSource(video)`
// chỉ được phép gọi ĐÚNG 1 LẦN cho mỗi <video> — gọi lần 2 (dù ở module khác,
// context khác) sẽ throw `InvalidStateError: HTMLMediaElement already
// connected...`. Nếu về sau có 2+ module cùng cần audio graph (vd VolumeBooster
// >100%) đều cần tap vào audio graph của cùng 1 video — nếu mỗi module tự gọi
// createMediaElementSource riêng, module load SAU sẽ crash ngay khi bật cả 2
// tính năng cùng lúc. Module này là NƠI DUY NHẤT được gọi
// createMediaElementSource trong toàn bộ codebase; mọi module khác PHẢI xin
// tap qua đây.
//
// Graph: <video> → sourceNode → gainNode (volume boost) → destination (loa)
//                                    ↳ analyser taps (dự phòng cho module phân tích audio trong tương lai)
// Analyser tap nối SAU gainNode để phân tích đúng âm lượng user thực sự nghe
// (đã boost), không phải âm lượng gốc trước khi boost.
const AudioGraph = (() => {
    let _ctx        = null;
    let _sourceNode  = null;
    let _sourceVideoEl = null;
    let _gainNode    = null;
    let _compressor  = null; // chống clipping/rè khi boost cao — xem setGain()
    let _lastGain    = 1;    // giữ nguyên mức boost khi chuyển tập (video mới)

    function _ensureContext() {
        if (!_ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null; // trình duyệt không hỗ trợ — mọi hàm dưới đây tự no-op an toàn
            _ctx = new AC();
        }
        if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
        return _ctx;
    }

    /**
     * Đảm bảo có graph cho video HIỆN TẠI. An toàn gọi nhiều lần — nếu video
     * không đổi, trả về graph đã có sẵn, không tạo lại (tránh crash gọi
     * createMediaElementSource 2 lần).
     */
    function _ensureGraph(videoEl) {
        if (!videoEl) return null;
        const ctx = _ensureContext();
        if (!ctx) return null;
        if (_sourceNode && _sourceVideoEl === videoEl) return _sourceNode;

        try {
            // Video đổi (chuyển tập) — Web Audio KHÔNG có API để "gỡ" 1
            // MediaElementSourceNode khỏi <video> cũ của nó; source/gain/
            // compressor cũ chỉ đơn giản mất hết tham chiếu, GC tự dọn khi
            // <video> cũ cũng bị YouTube gỡ khỏi DOM (SPA nav sang tập mới).
            _sourceNode = ctx.createMediaElementSource(videoEl);
            _sourceVideoEl = videoEl;

            _gainNode = ctx.createGain();
            _gainNode.gain.value = _lastGain; // giữ nguyên mức boost user đã chọn

            // DynamicsCompressorNode: nén động — khi boost gain cao (vd 200%),
            // audio dễ bị "vỡ tiếng"/rè do vượt biên độ [-1, 1] mà DAC hỗ trợ.
            // Compressor tự động giảm biên độ đỉnh mượt mà thay vì clip cứng,
            // đây là khác biệt giữa 1 volume booster "thông minh" và loại chỉ
            // nhân gain thô (rè khó nghe ở mức boost cao) — đúng yêu cầu
            // "chính xác và thông minh hơn bình thường".
            _compressor = ctx.createDynamicsCompressor();
            _compressor.threshold.value = -12; // dB — bắt đầu nén khi tín hiệu vượt -12dB
            _compressor.knee.value = 18;
            _compressor.ratio.value = 8;
            _compressor.attack.value = 0.003;
            _compressor.release.value = 0.25;

            _sourceNode.connect(_gainNode);
            _gainNode.connect(_compressor);
            _compressor.connect(ctx.destination);
        } catch (e) {
            warn('[AudioGraph] Không tạo được audio graph (trình duyệt/trang có thể chặn Web Audio API):', e);
            _sourceNode = null;
            _sourceVideoEl = null;
        }
        return _sourceNode;
    }

    /** Gọi khi video đổi (videoReady) để đảm bảo graph luôn theo đúng video hiện tại. */
    function attach(videoEl) { _ensureGraph(videoEl); }

    /**
     * Đặt mức boost âm lượng, 1.0 = 100% (bình thường), tối đa 2.0 = 200%.
     * Dưới 100%, dùng luôn <video>.volume chuẩn (PlayerControl.setVolume) —
     * KHÔNG cần AudioContext, tránh overhead Web Audio API không cần thiết
     * cho trường hợp phổ biến nhất (user không boost).
     */
    function setGain(value) {
        _lastGain = Math.max(0, Math.min(2, value));
        if (_gainNode) _gainNode.gain.value = _lastGain;
        return _lastGain;
    }
    function getGain() { return _lastGain; }
    function isGraphActive() { return !!_sourceNode; }

    /**
     * Cấp 1 AnalyserNode "nghe ké" audio graph cho module khác cần phân tích audio
     * — nối SAU gainNode để phân tích đúng âm lượng thực nghe được (đã boost),
     * KHÔNG nối analyser vào destination (không tạo thêm output/echo).
     */
    function getAnalyserTap(videoEl, fftSize = 512) {
        const src = _ensureGraph(videoEl);
        if (!src || !_ctx) return null;
        const analyser = _ctx.createAnalyser();
        analyser.fftSize = fftSize;
        _gainNode.connect(analyser);
        return analyser;
    }

    return { attach, setGain, getGain, isGraphActive, getAnalyserTap };
})();
