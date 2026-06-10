// storage.js - Profile, history, skip data
function getProfilePrefix() { return 'vtvUlt_' + State.currentProfile + '_'; }

function profileStore(key, value) {
    const fullKey = getProfilePrefix() + key;
    if (value === undefined) return gmGet(fullKey);
    gmSet(fullKey, value);
}

function switchProfile(profileName) {
    State.currentProfile = profileName;
    GM_setValue('vtvUlt_currentProfile', profileName);
    location.reload();
}

function setupProfiles() {
    GM_registerMenuCommand('Chọn Profile', () => {
        const profiles = gmGet('vtvUlt_profiles', ['default']);
        const newProfile = prompt(
            'Nhập tên profile (hiện tại: ' + State.currentProfile + ').\nCác profile: ' + profiles.join(', '),
            State.currentProfile
        );
        if (newProfile && newProfile !== State.currentProfile) {
            if (!profiles.includes(newProfile)) { profiles.push(newProfile); gmSet('vtvUlt_profiles', profiles); }
            switchProfile(newProfile);
        }
    });
}

function getHistory(key) {
    return profileStore('history_' + key) || [];
}

function addToHistory(key, episode, url, title) {
    const h = getHistory(key);
    if (!h.find(e => e.episode === episode)) {
        h.push({ episode, url, title });
        profileStore('history_' + key, h);
    }
}

function getSkipData(key) {
    return gmGet('vtvUlt_skipData' + key, { intros: [], outros: [] });
}

function saveSkipData(key, data) {
    gmSet('vtvUlt_skipData' + key, data);
}

function learnSkip(key, from, to) {
    const d = getSkipData(key);
    const dur = State.videoEl?.duration || 0;
    if (from < 5 && to > 5 && to < dur * 0.5) {
        d.intros.push(to);
        if (d.intros.length >= 3) d.introAvg = Math.round(d.intros.reduce((a, b) => a + b, 0) / d.intros.length);
    } else if (to > dur - 10 && from < dur - 5) {
        d.outros.push(from);
        if (d.outros.length >= 3) d.outroAvg = Math.round(d.outros.reduce((a, b) => a + b, 0) / d.outros.length);
    }
    saveSkipData(key, d);
}

function applyAutoSkip(key) {
    if (!State.autoSkip) return;
    const d = getSkipData(key);
    if (d.introAvg && State.videoEl.currentTime < d.introAvg) {
        log('Auto-skip intro to', d.introAvg);
        State.videoEl.currentTime = d.introAvg;
    }
}
