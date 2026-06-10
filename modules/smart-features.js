// smart-features.js - Voice, GIF, Watch Later, Full replace, Notes, Age bypass, Scroll playlist

function initVoiceControl() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    State.voiceRecognition = new SR();
    State.voiceRecognition.lang = 'vi-VN';
    State.voiceRecognition.continuous = true;
    State.voiceRecognition.interimResults = false;
    State.voiceRecognition.onresult = (e) => {
        const t = e.results[e.results.length - 1][0].transcript.toLowerCase();
        if (t.includes('tiếp theo'))  { if (State.nextUrl) window.location.href = State.nextUrl; }
        else if (t.includes('quay lại')) { if (State.previousEp?.url) window.location.href = State.previousEp.url; }
        else if (t.includes('tua'))   { const m = t.match(/(\d+)\s*(giây|s)/); if (State.videoEl) State.videoEl.currentTime += m ? parseInt(m[1]) : 30; }
        else if (t.includes('marathon')) { State.marathon = !State.marathon; GM_setValue('vtvUlt_marathon', State.marathon); }
    };
    State.voiceRecognition.onerror = (e) => {
        warn('Voice error:', e.error);
        // Tự restart trừ khi bị abort chủ động
        if (e.error !== 'aborted' && State.voiceEnabled) {
            setTimeout(() => State.voiceRecognition?.start(), 1000);
        }
    };
    State.voiceRecognition.start();
}

function stopVoiceControl() {
    if (State.voiceRecognition) {
        State.voiceRecognition.stop();
        State.voiceRecognition = null;
    }
}

function addToWatchLater(url, title) {
    const list = profileStore('watchLater', []) || [];
    if (!list.find(v => v.url === url)) {
        list.push({ url, title, added: Date.now() });
        profileStore('watchLater', list);
        GM_notification({ text: 'Đã thêm vào Xem sau: ' + title, timeout: 2000 });
    }
}

function recordGIF() {
    if (!State.videoEl?.captureStream) return alert('Trình duyệt không hỗ trợ captureStream');
    const stream  = State.videoEl.captureStream();
    const mr      = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks  = [];
    mr.ondataavailable = e => chunks.push(e.data);
    mr.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `VTV_${Date.now()}.webm`;
        a.click();
    };
    mr.start();
    setTimeout(() => mr.stop(), 10000);
    alert('Đang quay 10 giây...');
}

async function findAndReplaceFull() {
    if (!State.parsedInfo) return;
    const { series, episode } = State.parsedInfo;
    const res  = await searchYT(`${series} tập ${episode}`);
    const full = res.filter(v => {
        const p = parseTitle(v.title);
        return p && p.episode === episode && p.series === series && v.title.toLowerCase().includes('full');
    });
    if (full.length) {
        if (confirm(`Tìm thấy bản Full: ${full[0].title}. Chuyển sang?`)) {
            window.location.href = `https://youtu.be/${full[0].videoId}`;
        }
    } else {
        alert('Không tìm thấy bản Full.');
    }
}

function getNotes(epKey)         { return gmGet('vtvUlt_communityNotes', {})[epKey] || []; }
function addNote(epKey, text)    {
    const all = gmGet('vtvUlt_communityNotes', {});
    if (!all[epKey]) all[epKey] = [];
    all[epKey].push({ text, time: Date.now() });
    gmSet('vtvUlt_communityNotes', all);
}

function scrollToCurrentInPlaylist() {
    if (!location.href.includes('&list=')) return;
    const cid = new URLSearchParams(location.search).get('v');
    if (!cid) return;
    document.querySelectorAll('ytd-playlist-video-renderer').forEach(el => {
        const a = el.querySelector('a[href*="' + cid + '"]');
        if (a) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}
