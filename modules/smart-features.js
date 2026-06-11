// smart-features.js - Voice Control (fix videoEl null, improved logging, stable)
let voicePausedVideo = false;
let voiceResumeTimer = null;

function initVoiceControl() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        warn('Trình duyệt không hỗ trợ Web Speech API');
        return;
    }
    
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    voiceRecognition = new SR();
    voiceRecognition.lang = 'vi-VN';
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;
    voiceRecognition.maxAlternatives = 3;
    
    voiceRecognition.onstart = () => {
        // Tạm dừng video để tránh âm thanh lọt vào micro
        if (videoEl && !videoEl.paused) {
            videoEl.pause();
            voicePausedVideo = true;
        }
    };
    
    voiceRecognition.onresult = (e) => {
        let finalTranscript = '';
        let interimTranscript = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
            let best = e.results[i][0];
            for (let j = 1; j < e.results[i].length; j++) {
                if (e.results[i][j].confidence > best.confidence) best = e.results[i][j];
            }
            if (e.results[i].isFinal) {
                finalTranscript += best.transcript;
            } else {
                interimTranscript += best.transcript;
            }
        }
        const transcript = finalTranscript || interimTranscript;
        if (transcript) {
            if (typeof updateVoiceLabel === 'function') updateVoiceLabel(transcript);
            const t = transcript.toLowerCase().trim();
            log('Voice raw result:', transcript, 'final:', !!finalTranscript);
            // Execute command if final or clear command pattern
            if (finalTranscript || /tua\s+\d+|tiếp theo|quay lại|dừng|phát|marathon|audio mode|pip/i.test(t)) {
                processVoiceCommand(t);
                resumeVideoAfterVoice();
                // Clear label after 2s
                clearTimeout(interimTimer);
                interimTimer = setTimeout(() => { if (typeof updateVoiceLabel === 'function') updateVoiceLabel(''); }, 2000);
            }
        }
    };
    
    voiceRecognition.onerror = (e) => {
        warn('Voice error:', e.error);
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('Lỗi: ' + e.error);
        resumeVideoAfterVoice();
        setTimeout(() => { if (typeof updateVoiceLabel === 'function') updateVoiceLabel(''); }, 3000);
    };
    
    voiceRecognition.onend = () => {
        log('Voice recognition ended');
        resumeVideoAfterVoice();
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('');
        // Restart if voice is still enabled
        if (voiceEnabled) {
            setTimeout(() => {
                if (voiceEnabled) initVoiceControl();
            }, 500);
        }
    };
    
    try {
        voiceRecognition.start();
        log('Voice control started (native Vietnamese, auto-pause video)');
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('🎤 Đang nghe...');
        setTimeout(() => { if (typeof updateVoiceLabel === 'function') updateVoiceLabel(''); }, 2000);
    } catch (e) {
        warn('Không thể khởi động voice:', e);
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('Lỗi khởi động');
    }
}

function resumeVideoAfterVoice() {
    if (voicePausedVideo && videoEl && videoEl.paused) {
        videoEl.play().catch(() => {});
        voicePausedVideo = false;
    }
}

function processVoiceCommand(t) {
    log('Processing voice command:', t);
    
    // Ensure videoEl is available
    if (!videoEl) {
        videoEl = document.querySelector('video.html5-main-video');
        if (!videoEl) {
            log('No video element found');
            return;
        }
    }
    
    t = t.replace(/[.,?!]/g, '').replace(/\s+/g, ' ').trim();
    
    if (/tiếp theo|tập sau|next/i.test(t)) {
        if (nextUrl) window.location.href = nextUrl;
        return;
    }
    if (/quay lại|tập trước|back/i.test(t)) {
        if (previousEp?.url) window.location.href = previousEp.url;
        return;
    }
    
    // Tua đến vị trí cụ thể
    if (/tua đến|tua tới|đến phút|đến\s+\d/i.test(t)) {
        const patterns = [
            /(\d+)\s*phút\s*(\d+)\s*giây/,
            /(\d+)\s*:\s*(\d+)/,
            /phút\s*(\d+)\s*giây\s*(\d+)/,
            /phút\s*(\d+)/,
            /(\d+)\s*giây/
        ];
        for (const p of patterns) {
            const m = t.match(p);
            if (m) {
                let target;
                if (m[2] !== undefined) {
                    target = parseInt(m[1]) * 60 + parseInt(m[2]);
                } else {
                    target = parseInt(m[1]) * (p.toString().includes('phút') ? 60 : 1);
                }
                videoEl.currentTime = Math.min(videoEl.duration, target);
                log('Voice: seek to', target, 'seconds');
                return;
            }
        }
    }
    
    // Tua thêm (forward)
    if (/tua thêm|tua nhanh|tua\s+\d+|tiến\s+\d+|tới\s+\d+/i.test(t)) {
        let amount = 30;
        const m = t.match(/(\d+)\s*(phút|giây|s)/);
        if (m) {
            amount = parseInt(m[1]);
            if (m[2] && m[2].includes('phút')) amount *= 60;
        }
        videoEl.currentTime = Math.min(videoEl.duration, videoEl.currentTime + amount);
        log('Voice: forward', amount, 'seconds');
        return;
    }
    
    // Tua lùi
    if (/chậm lại|lùi\s+\d+|tua lại\s+\d+|tua lui\s+\d+/i.test(t)) {
        let amount = 10;
        const m = t.match(/(\d+)\s*(phút|giây|s)/);
        if (m) {
            amount = parseInt(m[1]);
            if (m[2] && m[2].includes('phút')) amount *= 60;
        }
        videoEl.currentTime = Math.max(0, videoEl.currentTime - amount);
        log('Voice: backward', amount, 'seconds');
        return;
    }
    
    // Phát/dừng
    if (/dừng|tạm dừng|pause/i.test(t)) { videoEl.pause(); return; }
    if (/tiếp tục|phát|play|chạy/i.test(t)) { videoEl.play(); return; }
    
    // Âm lượng
    if (/âm lượng|volume/i.test(t)) {
        const m = t.match(/(\d+)/);
        if (m) videoEl.volume = Math.min(1, parseInt(m[1]) / 100);
        return;
    }
    if (/tắt tiếng|mute/i.test(t)) { videoEl.volume = 0; return; }
    if (/bật tiếng|unmute/i.test(t)) { videoEl.volume = 1; return; }
    
    // Toàn màn hình
    if (/toàn màn hình|fullscreen/i.test(t)) {
        document.querySelector('.ytp-fullscreen-button')?.click();
        return;
    }
    if (/thoát toàn màn hình/i.test(t)) {
        if (document.fullscreenElement) document.exitFullscreen();
        return;
    }
    
    // Tốc độ
    if (/tăng tốc độ|nhanh hơn|speed up/i.test(t)) {
        videoEl.playbackRate = Math.min(2, videoEl.playbackRate + 0.25);
        return;
    }
    if (/giảm tốc độ|chậm hơn|slow down/i.test(t)) {
        videoEl.playbackRate = Math.max(0.25, videoEl.playbackRate - 0.25);
        return;
    }
    if (/tốc độ bình thường|bình thường|normal speed/i.test(t)) {
        videoEl.playbackRate = 1;
        return;
    }
    
    // Toggles
    if (/marathon/i.test(t)) {
        marathon = !marathon; GM_setValue('vtvUlt_marathon', marathon);
        if (marathon) { document.body.classList.add('vtv-marathon'); if (typeof startAdBlocking === 'function') startAdBlocking(); }
        else { document.body.classList.remove('vtv-marathon'); if (typeof stopAdBlocking === 'function') stopAdBlocking(); }
        return;
    }
    if (/audio mode|chế độ nghe/i.test(t)) {
        audioMode = !audioMode; GM_setValue('vtvUlt_audioMode', audioMode);
        if (audioMode) { if (typeof enableAudioMode === 'function') enableAudioMode(); }
        else { if (typeof disableAudioMode === 'function') disableAudioMode(); }
        return;
    }
    if (/pip|picture in picture/i.test(t)) {
        pipEnabled = !pipEnabled; GM_setValue('vtvUlt_pip', pipEnabled);
        if (pipEnabled) { if (typeof enableAutoPiP === 'function') enableAutoPiP(); }
        else { if (typeof disableAutoPiP === 'function') disableAutoPiP(); }
        return;
    }
    if (/tự động chuyển|auto next/i.test(t)) {
        autoPlay = !autoPlay; GM_setValue('vtvUlt_auto', autoPlay);
        return;
    }
    
    // Like/Dislike
    if (/like|thích/i.test(t)) {
        document.querySelector('#top-level-buttons-computed yt-icon-button:first-child button')?.click();
        return;
    }
    if (/dislike|không thích/i.test(t)) {
        document.querySelector('#top-level-buttons-computed yt-icon-button:last-child button')?.click();
        return;
    }
}

function startVoiceControl() {
    if (voiceRecognition) {
        try { voiceRecognition.abort(); } catch(e) {}
        voiceRecognition = null;
    }
    initVoiceControl();
}

function stopVoiceControl() {
    if (voiceRecognition) {
        voiceRecognition.stop();
        voiceRecognition = null;
        log('Voice control stopped');
    }
}