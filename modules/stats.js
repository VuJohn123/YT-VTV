// stats.js - Thống kê thời gian xem (đo thực tế qua timeupdate)

function _getStats(seriesKey) {
    return gmGet('vtvUlt_stats_' + seriesKey, { totalTime: 0, episodes: {} });
}

function _saveStats(seriesKey, stats) {
    gmSet('vtvUlt_stats_' + seriesKey, stats);
}

// Gọi khi bắt đầu xem một video (trong main())
function startWatchTimer() {
    State.watchStartTime = Date.now();
    State.watchAccumulated = 0;
    if (!State.videoEl) return;
    // Dừng đếm khi pause, tiếp tục khi play
    State.videoEl.addEventListener('pause', _onPause);
    State.videoEl.addEventListener('play',  _onPlay);
}

function _onPause() {
    if (State.watchStartTime !== null) {
        State.watchAccumulated += (Date.now() - State.watchStartTime) / 1000;
        State.watchStartTime = null;
    }
}

function _onPlay() {
    State.watchStartTime = Date.now();
}

// Gọi khi thoát hoặc chuyển video — flush thời gian vào storage
function flushWatchTime() {
    if (!State.seriesKey) return;
    if (State.watchStartTime !== null) {
        State.watchAccumulated += (Date.now() - State.watchStartTime) / 1000;
        State.watchStartTime = null;
    }
    const duration = Math.round(State.watchAccumulated);
    if (duration < 1) return;

    const stats = _getStats(State.seriesKey);
    stats.totalTime += duration;
    if (State.parsedInfo?.episode) {
        if (!stats.episodes[State.parsedInfo.episode]) stats.episodes[State.parsedInfo.episode] = 0;
        stats.episodes[State.parsedInfo.episode] += duration;
    }
    _saveStats(State.seriesKey, stats);
    log('Watch time flushed:', duration, 's');
}

// Cleanup event listeners khi chuyển video
function stopWatchTimer() {
    flushWatchTime();
    State.watchAccumulated = 0;
    State.watchStartTime = null;
    if (State.videoEl) {
        State.videoEl.removeEventListener('pause', _onPause);
        State.videoEl.removeEventListener('play',  _onPlay);
    }
}

function getProgress(seriesKey, totalEpisodes) {
    const stats = _getStats(seriesKey);
    const watched = Object.keys(stats.episodes).length;
    if (totalEpisodes) return { watched, total: totalEpisodes, percent: Math.round(watched / totalEpisodes * 100) };
    return { watched, total: '?', percent: 0 };
}
