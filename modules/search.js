// search.js - Tìm kiếm YouTube
async function searchYT(q) {
    log('Search:', q);
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
    const html = await res.text();
    const m = html.match(/var ytInitialData\s*=\s*({.*?});/s);
    if (!m) return [];
    const json = JSON.parse(m[1]);
    const vids = [];
    try {
        const sections = json.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
        for (const sec of sections) {
            if (sec.itemSectionRenderer) {
                for (const item of sec.itemSectionRenderer.contents) {
                    const vr = item.videoRenderer;
                    if (vr) {
                        const ti = vr.title?.runs?.[0]?.text || '';
                        const vi = vr.videoId;
                        if (ti && vi) vids.push({title: ti, videoId: vi});
                    }
                }
            }
        }
    } catch(e) {}
    return vids;
}