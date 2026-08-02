// chapter-detector.js — Layer 2: Tự động phát hiện chapter marker qua khoảng lặng audio
//
// Ý TƯỞNG: đoạn chuyển cảnh/nhạc nền lắng xuống thường có khoảng lặng ngắn.
// Phát hiện các khoảng lặng đủ dài (> MIN_SILENCE_S) để đề xuất làm chapter
// marker, giúp seek nhanh tới đoạn quan trọng dù YouTube không có chapters gốc.
//
// AUDIO GRAPH: dùng chung AudioGraph (audio-graph.js) thay vì tự quản lý
// AudioContext/MediaElementSourceNode riêng — xem comment đầu file đó để biết
// lý do (Web Audio API chỉ cho tạo source node 1 lần/video, cần 1 chủ sở hữu
// duy nhất khi có nhiều module cùng cần tap vào audio của video, ví dụ
// VolumeBooster trong features.js).
//
// CHI PHÍ CPU: chạy 1 vòng phân tích mỗi ANALYSIS_INTERVAL_MS qua
// requestAnimationFrame-throttled interval, không phải mỗi frame — cân bằng
// độ chính xác với tiêu thụ CPU/pin trên thiết bị di động.

const ChapterDetector = (() => {
    const MIN_SILENCE_S = 1.2;      // khoảng lặng tối thiểu để tính là ranh giới chapter
    const SILENCE_THRESHOLD = 0.02;  // biên độ RMS dưới ngưỡng này coi là "lặng"
    const ANALYSIS_INTERVAL_MS = 200;
    const MIN_GAP_BETWEEN_CHAPTERS_S = 30; // tránh tạo quá nhiều chapter sát nhau

    let _analyser = null, _dataArray = null, _pollHandle = null;
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
            // Dùng chung AudioGraph (audio-graph.js) thay vì tự tạo AudioContext/
            // MediaElementSourceNode riêng — Web Audio API chỉ cho tạo source
            // node 1 LẦN DUY NHẤT mỗi <video>; nếu VolumeBooster (features.js)
            // cũng cần tap vào audio của cùng video, tự tạo riêng ở đây sẽ
            // crash khi cả 2 tính năng cùng bật. AudioGraph là nơi DUY NHẤT sở
            // hữu source node, cấp AnalyserNode "nghe ké" cho module này.
            _analyser = AudioGraph.getAnalyserTap(v, 512);
            if (!_analyser) return false; // trình duyệt không hỗ trợ Web Audio API hoặc lỗi tạo graph
            _dataArray = new Uint8Array(_analyser.fftSize);

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
