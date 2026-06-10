function initVoiceControl() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    voiceRecognition = new SR(); voiceRecognition.lang = 'vi-VN'; voiceRecognition.continuous = true; voiceRecognition.interimResults = false;
    voiceRecognition.onresult = (e) => {
        const t = e.results[e.results.length-1][0].transcript.toLowerCase();
        if (t.includes('tiếp theo') || t.includes('next')) { if (nextUrl) window.location.href = nextUrl; }
        else if (t.includes('quay lại') || t.includes('back')) { if (previousEp?.url) window.location.href = previousEp.url; }
        else if (t.includes('tua')) { const m = t.match(/(\d+)\s*(giây|s)/); videoEl.currentTime += m ? parseInt(m[1]) : 30; }
        else if (t.includes('marathon')) { marathon = !marathon; GM_setValue('vtvUlt_marathon', marathon); }
    };
    voiceRecognition.start();
    log('Voice control started');
}
function startVoiceControl() { initVoiceControl(); }
function stopVoiceControl() { if (voiceRecognition) { voiceRecognition.stop(); voiceRecognition = null; log('Voice control stopped'); } }

function addToWatchLater(url, title) {
    let list = profileStore('watchLater', []);
    if (!list.find(v => v.url === url)) { list.push({url, title, added: Date.now()}); profileStore('watchLater', list); GM_notification({text: 'Đã thêm vào Xem sau: ' + title, timeout: 2000}); }
}
function recordGIF() {
    if (!videoEl?.captureStream) return alert('Không hỗ trợ');
    const stream = videoEl.captureStream(); const mr = new MediaRecorder(stream, {mimeType: 'video/webm'}); const chunks = [];
    mr.ondataavailable = e => chunks.push(e.data); mr.onstop = () => { const blob = new Blob(chunks, {type: 'video/webm'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `VTV_${Date.now()}.webm`; a.click(); };
    mr.start(); setTimeout(() => mr.stop(), 10000); alert('Đang quay 10 giây...');
}
async function findAndReplaceFull() {
    if (!parsedInfo) return;
    const q = `${parsedInfo.series} tập ${parsedInfo.episode}`; const res = await searchYT(q);
    const full = res.filter(v => { const p = parseTitle(v.title); return p && p.episode === parsedInfo.episode && p.series === parsedInfo.series && v.title.toLowerCase().includes('full'); });
    if (full.length) { if (confirm(`Tìm thấy bản Full: ${full[0].title}. Chuyển sang?`)) window.location.href = `https://youtu.be/${full[0].videoId}`; }
}
function getNotes(epKey) { const all = GM_getValue('vtvUlt_communityNotes', '{}'); return JSON.parse(all)[epKey] || []; }
function addNote(epKey, text) { const all = GM_getValue('vtvUlt_communityNotes', '{}'); const data = JSON.parse(all); if (!data[epKey]) data[epKey] = []; data[epKey].push({text, time: Date.now()}); GM_setValue('vtvUlt_communityNotes', JSON.stringify(data)); }
function scrollToCurrentInPlaylist() {
    if (!location.href.includes('&list=')) return;
    const cid = new URLSearchParams(location.search).get('v'); if (!cid) return;
    document.querySelectorAll('ytd-playlist-video-renderer').forEach(el => { const a = el.querySelector('#video-title'); if (a && a.href.includes(cid)) { el.scrollIntoView({behavior:'smooth', block:'center'}); el.style.border='2px solid #3ea6ff'; } });
}
async function bypassAgeRestriction(videoId) {
    const choice = prompt('Video bị giới hạn độ tuổi.\n1. Embed\n2. Invidious\n3. Piped');
    if (choice === '1') window.location.href = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
    else if (choice === '2') window.location.href = `https://invidious.snopyta.org/watch?v=${videoId}`;
    else if (choice === '3') window.location.href = `https://piped.video/watch?v=${videoId}`;
}