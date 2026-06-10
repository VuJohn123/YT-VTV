// smart-features.js - Voice Control (seek precision), GIF, Watch Later, Full Replace, Notes, Age Bypass, Scroll Playlist

function initVoiceControl() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        warn('Trình duyệt không hỗ trợ Web Speech API');
        return;
    }
    
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    voiceRecognition = new SR();
    voiceRecognition.lang = 'vi-VN';
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = false;
    
    voiceRecognition.onresult = (e) => {
        const t = e.results[e.results.length - 1][0].transcript.toLowerCase().trim();
        log('Voice command:', t);
        
        // === Điều hướng tập ===
        if (t.includes('tiếp theo') || t.includes('next')) {
            if (nextUrl) {
                log('Voice: next episode');
                window.location.href = nextUrl;
            }
        }
        else if (t.includes('quay lại') || t.includes('back') || t.includes('tập trước')) {
            if (previousEp?.url) {
                log('Voice: previous episode');
                window.location.href = previousEp.url;
            }
        }
        
        // === Tua đến vị trí chính xác ===
        // "tua đến phút 15 giây 30", "đến 5:45", "tua tới 3 phút 20"
        else if (t.includes('tua đến') || t.includes('tua tới') || t.includes('đến phút') || t.includes('đến')) {
            // Trích xuất phút và giây
            const patterns = [
                /(?:phút|phut)\s*(\d+)\s*(?:giây|giay)\s*(\d+)/,  // "phút 15 giây 30"
                /(\d+)\s*phút\s*(\d+)\s*giây/,                     // "15 phút 30 giây"
                /(\d+):(\d+)/,                                       // "15:30"
                /(?:phút|phut)\s*(\d+)/,                            // "phút 15"
                /(\d+)\s*(?:giây|giay)/                             // "30 giây"
            ];
            
            let targetTime = null;
            for (const pattern of patterns) {
                const match = t.match(pattern);
                if (match) {
                    if (match[2] !== undefined) {
                        targetTime = parseInt(match[1]) * 60 + parseInt(match[2]);
                    } else {
                        const val = parseInt(match[1]);
                        targetTime = pattern.toString().includes('phút') ? val * 60 : val;
                    }
                    break;
                }
            }
            
            if (targetTime !== null && videoEl && targetTime < videoEl.duration) {
                videoEl.currentTime = targetTime;
                log('Voice: seek to', targetTime, 'seconds');
            }
        }
        
        // === Tua thêm ===
        // "tua thêm 2 phút", "tiến 30 giây", "tua nhanh 1 phút"
        else if (t.includes('tua thêm') || t.includes('tua nhanh') || t.includes('tiến') || t.includes('tới')) {
            let amount = 30; // mặc định 30 giây
            const patterns = [
                /(\d+)\s*(?:phút|phut)/,
                /(\d+)\s*(?:giây|giay|s)/
            ];
            for (const pattern of patterns) {
                const match = t.match(pattern);
                if (match) {
                    amount = parseInt(match[1]);
                    if (pattern.toString().includes('phút')) amount *= 60;
                    break;
                }
            }
            if (videoEl) {
                videoEl.currentTime = Math.min(videoEl.duration, videoEl.currentTime + amount);
                log('Voice: forward', amount, 'seconds');
            }
        }
        
        // === Tua lùi ===
        // "chậm lại 10 giây", "lùi 30 giây", "tua lại 1 phút"
        else if (t.includes('chậm lại') || t.includes('lùi') || t.includes('tua lại') || t.includes('tua lui')) {
            let amount = 10; // mặc định 10 giây
            const patterns = [
                /(\d+)\s*(?:phút|phut)/,
                /(\d+)\s*(?:giây|giay|s)/
            ];
            for (const pattern of patterns) {
                const match = t.match(pattern);
                if (match) {
                    amount = parseInt(match[1]);
                    if (pattern.toString().includes('phút')) amount *= 60;
                    break;
                }
            }
            if (videoEl) {
                videoEl.currentTime = Math.max(0, videoEl.currentTime - amount);
                log('Voice: backward', amount, 'seconds');
            }
        }
        
        // === Toggle Marathon ===
        else if (t.includes('marathon')) {
            marathon = !marathon;
            GM_setValue('vtvUlt_marathon', marathon);
            log('Voice: marathon toggled to', marathon);
            if (marathon) {
                document.body.classList.add('vtv-marathon');
                if (typeof startAdBlocking === 'function') startAdBlocking();
            } else {
                document.body.classList.remove('vtv-marathon');
                if (typeof stopAdBlocking === 'function') stopAdBlocking();
            }
        }
        
        // === Toggle Audio Mode ===
        else if (t.includes('audio mode') || t.includes('chế độ nghe')) {
            toggleAudioMode();
            log('Voice: audio mode toggled');
        }
        
        // === Like video ===
        else if (t.includes('like') || t.includes('thích')) {
            const likeBtn = document.querySelector('#top-level-buttons-computed yt-icon-button:first-child button');
            if (likeBtn) likeBtn.click();
        }
    };
    
    voiceRecognition.onerror = (e) => {
        warn('Voice recognition error:', e.error);
        if (e.error === 'not-allowed') {
            log('Microphone permission denied');
        }
    };
    
    voiceRecognition.onend = () => {
        // Tự động khởi động lại nếu voice vẫn được bật
        if (voiceEnabled) {
            try { voiceRecognition.start(); } catch (e) {}
        }
    };
    
    try {
        voiceRecognition.start();
        log('Voice control started with seek precision');
    } catch (e) {
        warn('Failed to start voice recognition:', e);
    }
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
            el.scrollIntoView({behavior: 'smooth', block: 'center'});
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