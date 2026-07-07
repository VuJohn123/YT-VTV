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
    function _player() { return document.getElementById('movie_player'); }
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

    // ─── VOLUME ─────────────────────────────────────────────────────────────
    function setVolume(fraction /* 0..1 */) {
        const v = _video();
        if (!v) return false;
        v.volume = Math.max(0, Math.min(1, fraction));
        if (v.volume > 0) v.muted = false;
        return true;
    }

    function getVolume() { return _video()?.volume ?? 1; }

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
    function togglePiP() {
        const v = _video();
        if (!v) return false;
        if (!document.pictureInPictureElement) v.requestPictureInPicture?.().catch(() => {});
        else document.exitPictureInPicture?.();
        return true;
    }

    return {
        seekTo, seekBy,
        setRate, getRate, getAvailableRates,
        setVolume, getVolume, mute, unmute, isMuted,
        setQuality, getQuality, getAvailableQualities,
        enterFullscreen, exitFullscreen, toggleFullscreen,
        play, pause, togglePlay,
        togglePiP,
    };
})();
