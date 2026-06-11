// smart-features.js - Voice Control (native Vietnamese), GIF, Watch Later, Full Replace, Notes, Age Bypass, Scroll Playlist

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
    
    voiceRecognition.onresult = (e) => {
        let finalTranscript = '';
        let interimTranscript = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
            const best = e.results[i][0];
            if (e.results[i].isFinal && best.confidence > 0.6) {
                finalTranscript += best.transcript;
            } else if (!e.results[i].isFinal) {
                interimTranscript += best.transcript;
            }
        }
        const transcript = finalTranscript || interimTranscript;
        if (transcript) {
            if (typeof updateVoiceLabel === 'function') updateVoiceLabel(transcript);
            const t = transcript.toLowerCase().trim();
            if (finalTranscript) {
                processVoiceCommand(t);
                setTimeout(() => { if (typeof updateVoiceLabel === 'function') updateVoiceLabel(''); }, 2000);
            }
        }
    };
    
    voiceRecognition.onerror = (e) => {
        warn('Voice error:', e.error);
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('Lỗi: ' + e.error);
        setTimeout(() => { if (typeof updateVoiceLabel === 'function') updateVoiceLabel(''); }, 3000);
    };
    
    voiceRecognition.onend = () => {
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('');
        if (voiceEnabled) {
            try { voiceRecognition.start(); } catch (e) {}
        }
    };
    
    try {
        voiceRecognition.start();
        log('Voice control started (native Vietnamese)');
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('🎤 Đang nghe...');
        setTimeout(() => { if (typeof updateVoiceLabel === 'function') updateVoiceLabel(''); }, 2000);
    } catch (e) {
        warn('Không thể khởi động voice:', e);
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('Lỗi khởi động');
    }
}

function processVoiceCommand(t) {
    log('Voice command:', t);
    
    if (/tiếp theo|tập sau|next/i.test(t)) {
        if (nextUrl) window.location.href = nextUrl;
    }
    else if (/quay lại|tập trước|back/i.test(t)) {
        if (previousEp?.url) window.location.href = previousEp.url;
    }
    else if (/tua đến|tua tới|đến phút|đến\b/i.test(t)) {
        const patterns = [
            /(?:phút|phut)\s*(\d+)\s*(?:giây|giay)\s*(\d+)/,
            /(\d+)\s*(?:phút|phut)\s*(\d+)\s*(?:giây|giay)/,
            /(\d+):(\d+)/,
            /(?:phút|phut)\s*(\d+)/,
            /(\d+)\s*(?:giây|giay)/
        ];
        let target = null;
        for (const p of patterns) {
            const m = t.match(p);
            if (m) {
                if (m[2] !== undefined) target = parseInt(m[1]) * 60 + parseInt(m[2]);
                else target = parseInt(m[1]) * (p.toString().includes('phút') ? 60 : 1);
                break;
            }
        }
        if (target !== null && videoEl) videoEl.currentTime = Math.min(videoEl.duration, target);
    }
    else if (/tua thêm|tua nhanh|tiến|tới/i.test(t)) {
        let amount = 30;
        const m = t.match(/(\d+)\s*(phút|giây|s)/);
        if (m) amount = parseInt(m[1]) * (m[2].includes('phút') ? 60 : 1);
        if (videoEl) videoEl.currentTime = Math.min(videoEl.duration, videoEl.currentTime + amount);
    }
    else if (/chậm lại|lùi|tua lại|tua lui/i.test(t)) {
        let amount = 10;
        const m = t.match(/(\d+)\s*(phút|giây|s)/);
        if (m) amount = parseInt(m[1]) * (m[2].includes('phút') ? 60 : 1);
        if (videoEl) videoEl.currentTime = Math.max(0, videoEl.currentTime - amount);
    }
    else if (/dừng|tạm dừng|pause/i.test(t)) { if (videoEl) videoEl.pause(); }
    else if (/tiếp tục|phát|play|chạy/i.test(t)) { if (videoEl) videoEl.play(); }
    else if (/âm lượng|volume/i.test(t)) {
        const m = t.match(/(\d+)/);
        if (m && videoEl) videoEl.volume = Math.min(1, parseInt(m[1]) / 100);
    }
    else if (/tắt tiếng|mute/i.test(t)) { if (videoEl) videoEl.volume = 0; }
    else if (/bật tiếng|unmute/i.test(t)) { if (videoEl) videoEl.volume = 1; }
    else if (/toàn màn hình|fullscreen/i.test(t)) {
        const fsBtn = document.querySelector('.ytp-fullscreen-button');
        if (fsBtn) fsBtn.click();
    }
    else if (/thoát toàn màn hình/i.test(t)) {
        if (document.fullscreenElement) document.exitFullscreen();
    }
    else if (/tăng tốc độ|nhanh hơn|speed up/i.test(t)) {
        if (videoEl) videoEl.playbackRate = Math.min(2, videoEl.playbackRate + 0.25);
    }
    else if (/giảm tốc độ|chậm hơn|slow down/i.test(t)) {
        if (videoEl) videoEl.playbackRate = Math.max(0.25, videoEl.playbackRate - 0.25);
    }
    else if (/tốc độ bình thường|bình thường|normal speed/i.test(t)) {
        if (videoEl) videoEl.playbackRate = 1;
    }
    else if (/marathon/i.test(t)) {
        marathon = !marathon; GM_setValue('vtvUlt_marathon', marathon);
        if (marathon) { document.body.classList.add('vtv-marathon'); if (typeof startAdBlocking === 'function') startAdBlocking(); }
        else { document.body.classList.remove('vtv-marathon'); if (typeof stopAdBlocking === 'function') stopAdBlocking(); }
    }
    else if (/audio mode|chế độ nghe/i.test(t)) {
        audioMode = !audioMode; GM_setValue('vtvUlt_audioMode', audioMode);
        if (audioMode) { if (typeof enableAudioMode === 'function') enableAudioMode(); }
        else { if (typeof disableAudioMode === 'function') disableAudioMode(); }
    }
    else if (/pip|picture in picture/i.test(t)) {
        pipEnabled = !pipEnabled; GM_setValue('vtvUlt_pip', pipEnabled);
        if (pipEnabled) { if (typeof enableAutoPiP === 'function') enableAutoPiP(); }
        else { if (typeof disableAutoPiP === 'function') disableAutoPiP(); }
    }
    else if (/tự động chuyển|auto next/i.test(t)) {
        autoPlay = !autoPlay; GM_setValue('vtvUlt_auto', autoPlay);
    }
    else if (/like|thích/i.test(t)) {
        const likeBtn = document.querySelector('#top-level-buttons-computed yt-icon-button:first-child button');
        if (likeBtn) likeBtn.click();
    }
    else if (/dislike|không thích/i.test(t)) {
        const dislikeBtn = document.querySelector('#top-level-buttons-computed yt-icon-button:last-child button');
        if (dislikeBtn) dislikeBtn.click();
    }
}

function startVoiceControl() {
    if (voiceRecognition) { try { voiceRecognition.abort(); } catch(e) {} }
    initVoiceControl();
}

function stopVoiceControl() {
    if (voiceRecognition) { voiceRecognition.stop(); voiceRecognition = null; log('Voice control stopped'); }
}

// ========== BYPASS AGE RESTRICTION (đa phương thức mạnh mẽ) ==========
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