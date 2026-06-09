// storage.js - Profile, history, skip data
function getProfilePrefix() { return 'vtvUlt_' + currentProfile + '_'; }
function profileStore(key, value) {
    const fullKey = getProfilePrefix() + key;
    if (value === undefined) return GM_getValue(fullKey);
    GM_setValue(fullKey, value);
}
function switchProfile(profileName) {
    currentProfile = profileName;
    GM_setValue('vtvUlt_currentProfile', profileName);
    location.reload();
}
function setupProfiles() {
    GM_registerMenuCommand('Chọn Profile', () => {
        const profiles = GM_getValue('vtvUlt_profiles', ['default']);
        const newProfile = prompt('Nhập tên profile (hiện tại: ' + currentProfile + ').\nCác profile: ' + profiles.join(', '), currentProfile);
        if (newProfile && newProfile !== currentProfile) {
            if (!profiles.includes(newProfile)) { profiles.push(newProfile); GM_setValue('vtvUlt_profiles', profiles); }
            switchProfile(newProfile);
        }
    });
}
function getHistory(key) { const raw = profileStore('history_' + key); return raw ? JSON.parse(raw) : []; }
function addToHistory(key, episode, url, title) {
    const h = getHistory(key);
    if (!h.find(e => e.episode === episode)) { h.push({episode, url, title}); profileStore('history_' + key, JSON.stringify(h)); }
}
function getSkipData(key) { const raw = GM_getValue('vtvUlt_skipData' + key, null); return raw ? JSON.parse(raw) : { intros: [], outros: [] }; }
function saveSkipData(key, data) { GM_setValue('vtvUlt_skipData' + key, JSON.stringify(data)); }
function learnSkip(key, from, to) {
    const d = getSkipData(key); const dur = videoEl?.duration || 0;
    if (from < 5 && to > 5 && to < dur * 0.5) { d.intros.push(to); if (d.intros.length >= 3) d.introAvg = Math.round(d.intros.reduce((a,b)=>a+b,0) / d.intros.length); }
    else if (to > dur - 10 && from < dur - 5) { d.outros.push(from); if (d.outros.length >= 3) d.outroAvg = Math.round(d.outros.reduce((a,b)=>a+b,0) / d.outros.length); }
    saveSkipData(key, d);
}
function applyAutoSkip(key) {
    if (!autoSkip) return;
    const d = getSkipData(key);
    if (d.introAvg && videoEl.currentTime < d.introAvg) { log('Auto-skip intro to', d.introAvg); videoEl.currentTime = d.introAvg; }
}