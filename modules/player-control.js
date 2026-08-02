// player-control.js — Layer 2: Internal function layer cho điều khiển player
//
// MỤC TIÊU: 1 nơi DUY NHẤT chứa logic thao tác video (seek/rate/volume/quality/
// fullscreen/PiP...), để VoiceControl, Keyboard, UI đều gọi qua đây thay vì mỗi
// module tự viết lại (trước đây VoiceControl tự làm rate/seek/volume riêng,
// Keyboard không có các thao tác này, UI cũng vậy — dẫn đến logic trùng lặp
// và không nhất quán, ví dụ clamp range khác nhau giữa các nơi).
//
// COMPATIBILITY: `#movie_player` là INTERNAL Polymer player object trên trang
// youtube.com/watch (khác iframe API đã bị Google deprecate setPlaybackQuality
// từ 2018). API nội bộ này cũng có thể đổi giữa các version, nên MỌI method
// gọi qua nó đều có multi-fallback: thử API mới → API cũ → thao tác trực tiếp
// lên <video> element (luôn có tác dụng, chỉ thiếu 1 số tính năng như quality
// discrete steps của YouTube). Không method nào được tin tưởng single-point.

const PlayerControl = (() => {
    /**
     * Lấy internal player object. 2 tầng fallback:
     * 1. #movie_player trực tiếp expose API (build YouTube phổ biến hiện nay)
     * 2. yt.player.getPlayerByElement (một số build cũ hơn không expose thẳng
     *    trên #movie_player, cần đi qua namespace yt.player toàn cục)
     */
    function _player() {
        const mp = document.getElementById('movie_player');
        if (mp && typeof mp.getAvailableQualityLevels === 'function') return mp;
        try {
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const p = win.yt?.player?.getPlayerByElement?.(document.querySelector('#movie_player'));
            if (p && typeof p.getAvailableQualityLevels === 'function') return p;
        } catch (e) { /* fall through */ }
        return document.getElementById('movie_player'); // fallback thô, có thể thiếu API nhưng vẫn hữu ích cho play/pause/fullscreen qua <video>
    }
    function _video()  { return VideoContext.getVideoEl(); }

    // ─── SEEK ───────────────────────────────────────────────────────────────
    /** Tua tới thời điểm tuyệt đối (giây), tự clamp trong [0, duration]. */
    function seekTo(seconds) {
        const v = _video();
        if (!v) return false;
        const dur = v.duration || Infinity;
        v.currentTime = Math.max(0, Math.min(dur, seconds));
        return true;
    }

    /** Tua tương đối (giây, có thể âm để lùi). */
    function seekBy(deltaSeconds) {
        const v = _video();
        if (!v) return false;
        return seekTo(v.currentTime + deltaSeconds);
    }

    // ─── PLAYBACK RATE ────────────────────────────────────────────────────────
    // YouTube's own UI chỉ hỗ trợ các mốc rời rạc: 0.25, 0.5, 0.75, 1, 1.25,
    // 1.5, 1.75, 2 (đôi khi thêm 0.05 steps ở 1.05-1.95 tuỳ A/B test). Đặt rate
    // trực tiếp qua <video>.playbackRate NGOÀI các mốc này vẫn hoạt động về mặt
    // kỹ thuật, nhưng UI Settings menu của YouTube sẽ hiện sai / không đồng bộ
    // (không tự nhảy tới option gần nhất). Để giữ trải nghiệm nhất quán khi
    // user mở Settings kiểm tra, ta snap về option gần nhất trong danh sách mà
    // YouTube thực sự hỗ trợ, lấy trực tiếp từ player nếu có (đề phòng YouTube
    // đổi danh sách), fallback về danh sách chuẩn nếu API không khả dụng.
    const _DEFAULT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

    function getAvailableRates() {
        try {
            const p = _player();
            const rates = p?.getAvailablePlaybackRates?.();
            if (Array.isArray(rates) && rates.length) return rates;
        } catch (e) { /* fall through */ }
        return _DEFAULT_RATES;
    }

    function _snapRate(rate) {
        const rates = getAvailableRates();
        return rates.reduce((closest, r) => Math.abs(r - rate) < Math.abs(closest - rate) ? r : closest, rates[0]);
    }

    /** Đặt playback rate, tự snap về mốc gần nhất YouTube hỗ trợ để đồng bộ UI Settings. */
    function setRate(rate) {
        const v = _video();
        if (!v) return false;
        const snapped = _snapRate(Math.max(0.1, Math.min(4, rate)));
        // Ưu tiên API nội bộ của player (nếu có) vì nó tự đồng bộ UI Settings menu;
        // fallback trực tiếp lên <video> nếu API không tồn tại (vẫn hoạt động,
        // chỉ là UI Settings có thể không tự cập nhật hiển thị).
        try {
            const p = _player();
            if (p?.setPlaybackRate) { p.setPlaybackRate(snapped); return true; }
        } catch (e) { /* fall through */ }
        v.playbackRate = snapped;
        return true;
    }

    function getRate() { return _video()?.playbackRate ?? 1; }

    /**
     * Đặt playback rate TỰ DO, KHÔNG snap về mốc YouTube UI hỗ trợ (khác
     * setRate() ở trên — cái đó cố ý snap để đồng bộ UI Settings menu). Dùng
     * khi user muốn tốc độ v.d 3x, 5x mà YouTube UI không có sẵn.
     * GIỚI HẠN THẬT (không phải lựa chọn tuỳ ý): Chrome tự MUTE audio khi
     * playbackRate > 4 (giới hạn cứng của trình duyệt, không có API nào bypass
     * được) — trên 4x video vẫn chạy nhanh nhưng sẽ CÂM. Clamp tối đa ở 8 để
     * vẫn cho phép "tốc độ tự do" cao hơn nhiều UI gốc (2x) nhưng cảnh báo rõ
     * ràng thay vì im lặng để user tự hỏi vì sao mất tiếng.
     */
    function setRateExact(rate) {
        const v = _video();
        if (!v) return { ok: false };
        const clamped = Math.max(0.1, Math.min(8, rate));
        try {
            const p = _player();
            if (p?.setPlaybackRate) p.setPlaybackRate(clamped);
        } catch (e) { /* fall through, vẫn set trực tiếp bên dưới */ }
        v.playbackRate = clamped;
        return { ok: true, rate: clamped, audioMuted: clamped > 4 };
    }

    // ─── VOLUME ─────────────────────────────────────────────────────────────
    function setVolume(fraction /* 0..1 */) {
        const v = _video();
        if (!v) return false;
        v.volume = Math.max(0, Math.min(1, fraction));
        if (v.volume > 0) v.muted = false;
        return true;
    }

    function getVolume() { return _video()?.volume ?? 1; }

    /**
     * Boost âm lượng vượt quá 100% chuẩn HTML5 (`<video>.volume` bị trình
     * duyệt clamp cứng ở 1.0, không có cách nào vượt qua bằng property này —
     * giới hạn thật của spec, không phải bug). Để thật sự vượt 100%, PHẢI
     * dùng Web Audio API GainNode (xem audio-graph.js) — đây là kỹ thuật
     * chuẩn mà các extension "volume booster" thật sự dùng, không phải hack.
     *
     * @param {number} percent 0-200 (100 = bình thường, không qua Web Audio API)
     */
    function setVolumeBoost(percent) {
        const v = _video();
        if (!v) return { ok: false };
        const clamped = Math.max(0, Math.min(200, percent));

        if (clamped <= 100) {
            // Không cần Web Audio API cho ≤100% — dùng thẳng <video>.volume,
            // tránh overhead AudioContext không cần thiết cho case phổ biến
            // nhất (user không boost). Đưa gain của AudioGraph về 1 nếu đã
            // từng bật trước đó, tránh boost kép (video.volume × gain).
            AudioGraph.setGain(1);
            v.volume = clamped / 100;
            if (v.volume > 0) v.muted = false;
            return { ok: true, percent: clamped, usedWebAudio: false };
        }

        // >100%: cần AudioGraph. v.volume giữ ở 1.0 (không giảm để bù trừ,
        // gain đảm nhiệm toàn bộ việc boost) — nếu AudioGraph không khả dụng
        // (trình duyệt cũ, hoặc lỗi tạo graph), fallback về 100% thay vì âm
        // thầm không làm gì, để user biết giới hạn thật thay vì tưởng đã boost.
        v.volume = 1; v.muted = false;
        AudioGraph.attach(v);
        if (!AudioGraph.isGraphActive()) {
            return { ok: false, percent: 100, usedWebAudio: false, error: 'Web Audio API không khả dụng trên trình duyệt này' };
        }
        AudioGraph.setGain(clamped / 100);
        return { ok: true, percent: clamped, usedWebAudio: true };
    }

    function getVolumeBoost() {
        const gain = AudioGraph.getGain();
        return Math.round((gain > 1 ? gain : (_video()?.volume ?? 1)) * 100);
    }

    function mute()   { const v = _video(); if (v) v.muted = true;  return !!v; }
    function unmute() { const v = _video(); if (v) v.muted = false; return !!v; }
    function isMuted() { return !!_video()?.muted; }

    // ─── QUALITY ────────────────────────────────────────────────────────────
    // setPlaybackQuality/setPlaybackQualityRange dùng label cũ (hd1080, large,
    // small...) và ĐÃ BỊ Google deprecate trên iframe API — nhưng #movie_player
    // ở đây là internal Polymer object trên trang watch, không phải iframe,
    // nên method vẫn có thể tồn tại tuỳ version. KHÔNG tin tưởng nó hoạt động;
    // luôn kiểm tra bằng getPlaybackQuality() sau khi set, và không throw nếu
    // API không có — chỉ trả về false để caller biết và có thể thông báo user.
    function getAvailableQualities() {
        try {
            const p = _player();
            return p?.getAvailableQualityLevels?.() || [];
        } catch (e) { return []; }
    }

    function getQuality() {
        try { return _player()?.getPlaybackQuality?.() ?? null; }
        catch (e) { return null; }
    }

    /**
     * Trả về mức chất lượng THẤP NHẤT thực sự tồn tại cho video này (loại trừ
     * 'auto' vì đó không phải 1 mức cụ thể). Dùng khi cần ép video xuống tối
     * thiểu để tiết kiệm băng thông (ví dụ AudioMode — chỉ nghe không cần xem).
     * @returns {string} label quality thấp nhất, mặc định 'tiny' nếu không xác định được
     */
    function getLowestQuality() {
        try {
            // levels thường xếp thứ tự cao→thấp, ví dụ ['hd1080','hd720','large','medium','small','tiny','auto']
            const levels = getAvailableQualities();
            const real = levels.filter(l => l !== 'auto');
            return real[real.length - 1] ?? 'tiny';
        } catch (e) { return 'tiny'; }
    }

    /**
     * Đặt chất lượng video. accepts: 'auto', 'hd1080', 'hd720', 'large',
     * 'medium', 'small', 'tiny', hoặc số (1080, 720...) sẽ tự map sang label.
     * @returns {boolean} true nếu gọi API thành công (không đảm bảo YouTube áp dụng — nó có thể no-op tuỳ điều kiện mạng).
     */
    function setQuality(quality) {
        const NUM_TO_LABEL = { 2160: 'highres', 1440: 'hd1440', 1080: 'hd1080', 720: 'hd720', 480: 'large', 360: 'medium', 240: 'small', 144: 'tiny' };
        const label = typeof quality === 'number' ? (NUM_TO_LABEL[quality] || 'auto') : quality;

        try {
            const p = _player();
            if (!p) return false;
            // API mới hơn (nếu tồn tại): setPlaybackQualityRange nhận (min, max)
            if (p.setPlaybackQualityRange) { p.setPlaybackQualityRange(label, label); return true; }
            if (p.setPlaybackQuality)      { p.setPlaybackQuality(label); return true; }
        } catch (e) { /* fall through */ }
        return false; // Không có API khả dụng — không có cách nào set quality qua <video> trực tiếp (nó không expose resolution switching)
    }

    // ─── FULLSCREEN ───────────────────────────────────────────────────────────
    function enterFullscreen() {
        const el = document.querySelector('#movie_player');
        el?.requestFullscreen?.().catch(() => {});
        return !!el;
    }
    function exitFullscreen() { document.exitFullscreen?.(); return true; }
    function toggleFullscreen() {
        if (!document.fullscreenElement) return enterFullscreen();
        return exitFullscreen();
    }

    // ─── PLAY / PAUSE ─────────────────────────────────────────────────────────
    function play()  { const v = _video(); v?.play?.();  return !!v; }
    function pause() { const v = _video(); v?.pause?.(); return !!v; }
    function togglePlay() {
        const v = _video();
        if (!v) return false;
        v.paused ? v.play() : v.pause();
        return true;
    }

    // ─── PICTURE-IN-PICTURE ───────────────────────────────────────────────────
    /** @returns {Promise<boolean>} true nếu request thành công */
    async function enterPiP() {
        const v = _video();
        if (!v || document.pictureInPictureElement) return false;
        try { await v.requestPictureInPicture(); return true; }
        catch (e) { return false; }
    }

    /** @returns {Promise<boolean>} true nếu exit thành công */
    async function exitPiP() {
        if (!document.pictureInPictureElement) return false;
        try { await document.exitPictureInPicture(); return true; }
        catch (e) { return false; }
    }

    function togglePiP() {
        const v = _video();
        if (!v) return false;
        if (!document.pictureInPictureElement) enterPiP();
        else exitPiP();
        return true;
    }

    return {
        seekTo, seekBy,
        setRate, getRate, getAvailableRates, setRateExact,
        setVolume, getVolume, mute, unmute, isMuted, setVolumeBoost, getVolumeBoost,
        setQuality, getQuality, getAvailableQualities, getLowestQuality,
        enterFullscreen, exitFullscreen, toggleFullscreen,
        play, pause, togglePlay,
        togglePiP, enterPiP, exitPiP,
    };
})();
