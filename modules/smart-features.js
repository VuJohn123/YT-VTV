// smart-features.js - Voice Control (continuous, no video pause), GIF, Watch Later, Full Replace, Notes, Age Bypass, Scroll Playlist

let lastInterim = '';
let interimTimer = null;
let commandCooldown = false;

function initVoiceControl() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        warn('Trình duyệt không hỗ trợ Web Speech API');
        return;
    }
    
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (voiceRecognition) {
        try { voiceRecognition.abort(); } catch(e) {}
    }
    voiceRecognition = new SR();
    voiceRecognition.lang = 'vi-VN';
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = false; // chỉ lấy kết quả cuối cùng
    voiceRecognition.maxAlternatives = 1;
    
    voiceRecognition.onresult = (e) => {
        let transcript = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
            if (e.results[i].isFinal) {
                transcript += e.results[i][0].transcript;
            }
        }
        transcript = transcript.toLowerCase().trim();
        if (transcript && transcript.length < 80) {
            log('Voice final:', transcript);
            if (typeof updateVoiceLabel === 'function') updateVoiceLabel(transcript);
            if (!commandCooldown && /tua\s+\d+|tiếp theo|quay lại|dừng|phát|marathon|audio mode|pip|tự động|like|dislike/i.test(transcript)) {
                commandCooldown = true;
                processVoiceCommand(transcript);
                setTimeout(() => { commandCooldown = false; }, 1500);
            }
            clearTimeout(interimTimer);
            interimTimer = setTimeout(() => { if (typeof updateVoiceLabel === 'function') updateVoiceLabel(''); }, 1500);
        }
    };
    
    voiceRecognition.onerror = (e) => {
        warn('Voice error:', e.error);
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('Lỗi: ' + e.error);
        setTimeout(() => { if (typeof updateVoiceLabel === 'function') updateVoiceLabel(''); }, 2000);
    };
    
    voiceRecognition.onend = () => {
        log('Voice recognition ended');
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('');
        if (voiceEnabled && voiceRecognition) {
            setTimeout(() => {
                if (voiceEnabled && voiceRecognition) {
                    try { voiceRecognition.start(); } catch(e) {}
                }
            }, 1000);
        }
    };
    
    try {
        voiceRecognition.start();
        log('Voice control started (continuous, no video pause)');
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('🎤 Sẵn sàng');
        setTimeout(() => { if (typeof updateVoiceLabel === 'function') updateVoiceLabel(''); }, 2000);
    } catch (e) {
        warn('Không thể khởi động voice:', e);
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('Lỗi khởi động');
    }
}

function processVoiceCommand(t) {
    log('Processing voice command:', t);
    
    if (!videoEl) {
        videoEl = document.querySelector('video.html5-main-video');
        if (!videoEl) return;
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
                if (m[2] !== undefined) target = parseInt(m[1]) * 60 + parseInt(m[2]);
                else target = parseInt(m[1]) * (p.toString().includes('phút') ? 60 : 1);
                videoEl.currentTime = Math.min(videoEl.duration, target);
                return;
            }
        }
    }
    
    // Tua thêm (forward)
    if (/tua thêm|tua nhanh|tua\s+\d+|tiến\s+\d+|tới\s+\d+/i.test(t)) {
        let amount = 30;
        const m = t.match(/(\d+)\s*(phút|giây|s)/);
        if (m) { amount = parseInt(m[1]); if (m[2] && m[2].includes('phút')) amount *= 60; }
        videoEl.currentTime = Math.min(videoEl.duration, videoEl.currentTime + amount);
        return;
    }
    
    // Tua lùi
    if (/chậm lại|lùi\s+\d+|tua lại\s+\d+|tua lui\s+\d+/i.test(t)) {
        let amount = 10;
        const m = t.match(/(\d+)\s*(phút|giây|s)/);
        if (m) { amount = parseInt(m[1]); if (m[2] && m[2].includes('phút')) amount *= 60; }
        videoEl.currentTime = Math.max(0, videoEl.currentTime - amount);
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

// ========== BYPASS AGE RESTRICTION ==========
async function bypassAgeRestriction(videoId) {
    const methods = [
        { name: 'Embed (YouTube)', url: `https://www.youtube.com/embed/${videoId}?autoplay=1` },
        { name: 'YouTube NoCookie', url: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1` },
        { name: 'Invidious (snopyta)', url: `https://invidious.snopyta.org/watch?v=${videoId}` },
        { name: 'Invidious (yewtu)', url: `https://yewtu.be/watch?v=${videoId}` },
        { name: 'Piped', url: `https://piped.video/watch?v=${videoId}` },
        { name: 'Piped (kavin)', url: `https://piped.kavin.rocks/watch?v=${videoId}` },
        { name: 'CloudTube', url: `https://tube.cadence.moe/watch?v=${videoId}` }
    ];
    for (const method of methods) {
        try {
            const resp = await fetch(method.url, { method: 'HEAD' });
            if (resp.ok) {
                if (confirm(`Mở bằng: ${method.name}?`)) {
                    window.location.href = method.url;
                    return;
                }
            }
        } catch(e) { continue; }
    }
    const choice = prompt('Chọn phương thức bypass:\n1. Embed (YouTube)\n2. Invidious\n3. Piped');
    if (choice === '1') window.location.href = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
    else if (choice === '2') window.location.href = `https://invidious.snopyta.org/watch?v=${videoId}`;
    else if (choice === '3') window.location.href = `https://piped.video/watch?v=${videoId}`;
}

// ========== Các tiện ích khác ==========
function addToWatchLater(url, title) {
    let list = profileStore('watchLater', []);
    if (!list.find(v => v.url === url)) {
        list.push({url, title, added: Date.now()});
        profileStore('watchLater', list);
        GM_notification({text: 'Đã thêm vào Xem sau: ' + title, timeout: 2000});
    }
}

function recordGIF() {
    if (!videoEl?.captureStream) return alert('Không hỗ trợ quay video');
    const stream = videoEl.captureStream();
    const mr = new MediaRecorder(stream, {mimeType: 'video/webm'});
    const chunks = [];
    mr.ondataavailable = e => chunks.push(e.data);
    mr.onstop = () => {
        const blob = new Blob(chunks, {type: 'video/webm'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `VTV_${Date.now()}.webm`;
        a.click();
    };
    mr.start();
    setTimeout(() => mr.stop(), 10000);
    alert('Đang quay 10 giây...');
}

async function findAndReplaceFull() {
    if (!parsedInfo) return;
    const q = `${parsedInfo.series} tập ${parsedInfo.episode}`;
    const res = await searchYT(q);
    const full = res.filter(v => {
        const p = parseTitle(v.title);
        return p && p.episode === parsedInfo.episode && p.series === parsedInfo.series && v.title.toLowerCase().includes('full');
    });
    if (full.length) {
        if (confirm(`Tìm thấy bản Full: ${full[0].title}. Chuyển sang?`)) {
            window.location.href = `https://youtu.be/${full[0].videoId}`;
        }
    }
}

function getNotes(epKey) {
    const all = GM_getValue('vtvUlt_communityNotes', '{}');
    return JSON.parse(all)[epKey] || [];
}

function addNote(epKey, text) {
    const all = GM_getValue('vtvUlt_communityNotes', '{}');
    const data = JSON.parse(all);
    if (!data[epKey]) data[epKey] = [];
    data[epKey].push({text, time: Date.now()});
    GM_setValue('vtvUlt_communityNotes', JSON.stringify(data));
}

function scrollToCurrentInPlaylist() {
    if (!location.href.includes('&list=')) return;
    const cid = new URLSearchParams(location.search).get('v');
    if (!cid) return;
    document.querySelectorAll('ytd-playlist-video-renderer').forEach(el => {
        const a = el.querySelector('#video-title');
        if (a && a.href.includes(cid)) {
            el.scrollIntoView({behavior:'smooth', block:'center'});
            el.style.border = '2px solid #3ea6ff';
        }
    });
}