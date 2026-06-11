// smart-features.js - Voice Control (có label), GIF, Watch Later, Full Replace, Notes, Age Bypass, Scroll Playlist

function initVoiceControl() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        warn('Trình duyệt không hỗ trợ Web Speech API');
        return;
    }
    
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    voiceRecognition = new SR();
    voiceRecognition.lang = 'vi-VN';
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true; // Bật interim để thấy kết quả tạm thời
    
    voiceRecognition.onresult = (e) => {
        let finalTranscript = '';
        let interimTranscript = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
            if (e.results[i].isFinal) {
                finalTranscript += e.results[i][0].transcript;
            } else {
                interimTranscript += e.results[i][0].transcript;
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
        log('Voice control started');
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('🎤 Đang nghe...');
        setTimeout(() => { if (typeof updateVoiceLabel === 'function') updateVoiceLabel(''); }, 2000);
    } catch (e) {
        warn('Không thể khởi động voice:', e);
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('Lỗi khởi động');
    }
}

function processVoiceCommand(t) {
    log('Voice command:', t);
    // Điều hướng
    if (t.includes('tiếp theo') || t.includes('next')) { if (nextUrl) window.location.href = nextUrl; }
    else if (t.includes('quay lại') || t.includes('back')) { if (previousEp?.url) window.location.href = previousEp.url; }
    // Tua chính xác
    else if (t.includes('tua đến phút') || t.includes('tua đến') || t.includes('đến phút')) {
        const patterns = [/(\d+)\s*phút\s*(\d+)\s*giây/, /(\d+):(\d+)/, /phút\s*(\d+)/, /(\d+)\s*giây/];
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
    // Tua thêm / lùi
    else if (t.includes('tua thêm') || t.includes('tiến')) {
        const m = t.match(/(\d+)/); const val = m ? parseInt(m[1]) : 30;
        if (videoEl) videoEl.currentTime = Math.min(videoEl.duration, videoEl.currentTime + val);
    }
    else if (t.includes('lùi') || t.includes('tua lại') || t.includes('chậm lại')) {
        const m = t.match(/(\d+)/); const val = m ? parseInt(m[1]) : 10;
        if (videoEl) videoEl.currentTime = Math.max(0, videoEl.currentTime - val);
    }
    // Điều khiển phát
    else if (t.includes('dừng') || t.includes('tạm dừng')) { if (videoEl) videoEl.pause(); }
    else if (t.includes('tiếp tục') || t.includes('phát')) { if (videoEl) videoEl.play(); }
    // Âm lượng
    else if (t.includes('âm lượng')) {
        const m = t.match(/(\d+)/);
        if (m && videoEl) videoEl.volume = Math.min(1, parseInt(m[1]) / 100);
    }
    // Toggle
    else if (t.includes('marathon')) { marathon = !marathon; GM_setValue('vtvUlt_marathon', marathon); }
    else if (t.includes('audio mode')) { audioMode = !audioMode; GM_setValue('vtvUlt_audioMode', audioMode); if (audioMode) enableAudioMode(); else disableAudioMode(); }
}

function startVoiceControl() {
    if (voiceRecognition) {
        try { voiceRecognition.abort(); } catch(e) {}
    }
    initVoiceControl();
}

function stopVoiceControl() {
    if (voiceRecognition) {
        voiceRecognition.stop();
        voiceRecognition = null;
        log('Voice control stopped');
        if (typeof updateVoiceLabel === 'function') updateVoiceLabel('');
    }
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

async function bypassAgeRestriction(videoId) {
    const choice = prompt('Video bị giới hạn độ tuổi.\n1. Embed (YouTube)\n2. Invidious\n3. Piped');
    if (choice === '1') window.location.href = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
    else if (choice === '2') window.location.href = `https://invidious.snopyta.org/watch?v=${videoId}`;
    else if (choice === '3') window.location.href = `https://piped.video/watch?v=${videoId}`;
}