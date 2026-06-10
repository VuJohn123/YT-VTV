// search.js - Tìm kiếm YouTube

async function searchYT(q) {
    log('Search:', q);
    try {
        const res  = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
        const html = await res.text();

        // Tìm boundary an toàn hơn: lấy từ "ytInitialData =" đến dấu ";" kết thúc object
        const start = html.indexOf('var ytInitialData');
        if (start === -1) return [];
        const eqIdx = html.indexOf('=', start) + 1;
        // Tìm ";" sau khi đóng object lớn nhất — dùng brace counter
        let depth = 0, end = -1;
        for (let i = eqIdx; i < html.length; i++) {
            if      (html[i] === '{') depth++;
            else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        if (end === -1) return [];

        const json = JSON.parse(html.slice(eqIdx, end).trim());
        const vids = [];
        const sections = json?.contents?.twoColumnSearchResultsRenderer
            ?.primaryContents?.sectionListRenderer?.contents ?? [];

        for (const sec of sections) {
            for (const item of sec.itemSectionRenderer?.contents ?? []) {
                const vr = item.videoRenderer;
                if (vr) {
                    const title   = vr.title?.runs?.[0]?.text || '';
                    const videoId = vr.videoId;
                    if (title && videoId) vids.push({ title, videoId });
                }
            }
        }
        return vids;
    } catch(e) {
        warn('searchYT error:', e);
        return [];
    }
}
