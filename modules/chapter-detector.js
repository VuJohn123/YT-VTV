// chapter-detector.js — Layer 2: Tự động phát hiện chapter marker qua khoảng lặng audio
//
// Ý TƯỞNG: đoạn chuyển cảnh/nhạc nền lắng xuống thường có khoảng lặng ngắn.
// Phát hiện các khoảng lặng đủ dài (> MIN_SILENCE_S) để đề xuất làm chapter
// marker, giúp seek nhanh tới đoạn quan trọng dù YouTube không có chapters gốc.
//
// RỦI RO KỸ THUẬT QUAN TRỌNG: createMediaElementSource(video) CHỈ được gọi
// 1 LẦN DUY NHẤT trên 1 <video> element — gọi lần 2 sẽ throw InvalidStateError.
// Ngoài ra, một khi gọi hàm này, audio output của <video> bị "cướp" bởi Web
// Audio API — nếu không nối lại source → destination, video sẽ CÂM HOÀN
// TOÀN. Cả 2 rủi ro đều được xử lý: dùng WeakMap để nhớ element nào đã có
// source (tránh gọi lại lần 2), và LUÔN connect source → destination ngay
// sau khi tạo, song song với nhánh phân tích qua AnalyserNode (không thay thế
// đường audio gốc, chỉ "nghe ké" qua analyser).
//
// CHI PHÍ CPU: chạy 1 vòng phân tích mỗi ANALYSIS_INTERVAL_MS qua
// requestAnimationFrame-throttled interval, không phải mỗi frame — cân bằng
// độ chính xác với tiêu thụ CPU/pin trên thiết bị di động.

const ChapterDetector = (() => {
    const MIN_SILENCE_S = 1.2;      // khoảng lặng tối thiểu để tính là ranh giới chapter
    const SILENCE_THRESHOLD = 0.02;  // biên độ RMS dưới ngưỡng này coi là "lặng"
    const ANALYSIS_INTERVAL_MS = 200;
    const MIN_GAP_BETWEEN_CHAPTERS_S = 30; // tránh tạo quá nhiều chapter sát nhau

    // Nhớ những <video> element đã có MediaElementSourceNode, vì gọi
    // createMediaElementSource() lần 2 trên cùng element sẽ throw exception.
    const _sourcedElements = new WeakMap();

    let _ctx = null, _analyser = null, _dataArray = null, _pollHandle = null;
    let _silenceStart = null;
    let _chapters = [];
    let _enabled = false;

    function _rms(dataArray) {
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const v = (dataArray[i] - 128) / 128;
            sum += v * v;
        }
        return Math.sqrt(sum / dataArray.length);
    }

    function _poll() {
        const v = VideoContext.getVideoEl();
        if (!v || !_analyser || v.paused) return;

        _analyser.getByteTimeDomainData(_dataArray);
        const amplitude = _rms(_dataArray);
        const t = v.currentTime;

        if (amplitude < SILENCE_THRESHOLD) {
            if (_silenceStart === null) _silenceStart = t;
            else if (t - _silenceStart >= MIN_SILENCE_S) {
                _maybeAddChapter(t);
                _silenceStart = null; // reset để không tạo nhiều chapter liên tiếp cho cùng 1 khoảng lặng dài
            }
        } else {
            _silenceStart = null;
        }
    }

    function _maybeAddChapter(t) {
        const last = _chapters[_chapters.length - 1];
        if (last && t - last < MIN_GAP_BETWEEN_CHAPTERS_S) return; // quá gần chapter trước, bỏ qua
        _chapters.push(Math.round(t));
        EventBus.emit('chapterDetected', { chapters: _chapters.slice() });

        // Kết hợp với SeriesLearner/introAvg: chapter ĐẦU TIÊN phát hiện được
        // trong phiên này, nếu rơi vào khung thời gian hợp lý cho intro (cùng
        // tiêu chí với learnSkip trong storage.js: 5s < t < 50% duration), có
        // thể là ranh giới hết intro thật — đề xuất SỚM ngay từ tập đầu tiên
        // thay vì bắt user tự skip đủ 3 lần mới có introAvg. CHỦ Ý không tự
        // seek/skip dựa trên gợi ý này (xem saveSuggestedIntro) — khoảng lặng
        // audio không chắc chắn là hết intro, có thể là khoảnh khắc kịch tính
        // giữa cảnh phim, chỉ nên GỢI Ý cho user tự quyết định.
        if (_chapters.length === 1 && window._vtvSeriesKey) {
            const v = VideoContext.getVideoEl();
            const dur = v?.duration || 0;
            if (dur > 0 && t > 5 && t < dur * 0.5) {
                const before = Storage.getSkipData(window._vtvSeriesKey);
                Storage.saveSuggestedIntro(window._vtvSeriesKey, t);
                if (!before.introAvg && !before.introSuggested) {
                    EventBus.emit('voiceLabel', {
                        text: `💡 Có thể hết intro tại ${Math.round(t)}s — xem thêm vài tập để mình học chính xác hơn`,
                    });
                    setTimeout(() => EventBus.emit('voiceLabel', { text: '' }), 4000);
                }
            }
        }
    }

    function _setupForCurrentVideo() {
        const v = VideoContext.getVideoEl();
        if (!v || !_enabled) return false;

        try {
            if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
            // AudioContext có thể bị trình duyệt tự suspend nếu enable() được
            // gọi không từ user gesture trực tiếp (autoplay policy). resume()
            // là no-op an toàn nếu context đã ở trạng thái running.
            if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});

            let source = _sourcedElements.get(v);
            if (!source) {
                // Element này CHƯA từng có MediaElementSourceNode — an toàn để tạo.
                source = _ctx.createMediaElementSource(v);
                _sourcedElements.set(v, source);
                // QUAN TRỌNG: nối source → destination để giữ nguyên audio ra
                // loa. Nếu bỏ bước này, video sẽ câm hoàn toàn vì audio output
                // đã bị Web Audio API "cướp" khỏi luồng mặc định của <video>.
                source.connect(_ctx.destination);
            }
            // else: element này ĐÃ có source từ lần setup trước (ví dụ user
            // tắt rồi bật lại tính năng mà không đổi tập) — dùng lại, KHÔNG
            // được gọi createMediaElementSource() lần 2 (sẽ throw).

            _analyser = _ctx.createAnalyser();
            _analyser.fftSize = 512;
            _dataArray = new Uint8Array(_analyser.fftSize);
            source.connect(_analyser); // nhánh phụ để phân tích, không ảnh hưởng nhánh chính đã nối destination

            if (_pollHandle) clearInterval(_pollHandle);
            _pollHandle = setInterval(_poll, ANALYSIS_INTERVAL_MS);
            return true;
        } catch (e) {
            warn('[ChapterDetector] Không thể khởi tạo Web Audio API:', e);
            return false;
        }
    }

    /**
     * Bật phân tích cho video hiện tại. An toàn để gọi nhiều lần — tự kiểm
     * tra element đã có source chưa trước khi tạo mới.
     */
    function enable() {
        _enabled = true;
        _chapters = [];
        _silenceStart = null;

        const ok = _setupForCurrentVideo();
        // Re-setup mỗi khi video element mới sẵn sàng (SPA nav sang tập khác
        // tạo/thay <video> element) — nếu không, _analyser vẫn gắn với element
        // CŨ đã detach, phân tích sai/không phân tích gì cả cho tập mới. Đây
        // là lỗi "chưa thực sự SPA-aware" — quan trọng vì đây là 1 trong các
        // module dễ bị bỏ sót khi tổng rà soát tính SPA-aware của cả project.
        EventBus.on('videoReady', () => { _chapters = []; _silenceStart = null; _setupForCurrentVideo(); });

        if (!ok) _enabled = false;
        return ok;
    }

    function disable() {
        _enabled = false;
        if (_pollHandle) { clearInterval(_pollHandle); _pollHandle = null; }
        // KHÔNG đóng _ctx hay disconnect source→destination — chỉ ngừng
        // nhánh phân tích (analyser). Đóng AudioContext ở đây có thể làm câm
        // audio nếu gọi nhầm lúc video vẫn đang phát, nên chỉ dừng polling.
        if (_analyser) { try { _analyser.disconnect(); } catch (e) {} _analyser = null; }
    }

    function getChapters() { return _chapters.slice(); }
    function isEnabled() { return _enabled; }

    return { enable, disable, getChapters, isEnabled };
})();
