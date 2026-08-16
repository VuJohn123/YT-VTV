// similarity-report.js — Layer 2: Report quyết định match Jaccard/SeriesLearner
// lên backend do USER TỰ DEPLOY, phục vụ mục đích tune JACCARD_THRESHOLD
// (episode-navigator.js) dựa trên dữ liệu thật thay vì đoán 1 con số cố định.
//
// QUYẾT ĐỊNH ĐÃ TỪ CHỐI TRƯỚC ĐÂY (xem bàn giao): dev không có quyền tự
// deploy hạ tầng ngoài, nên tính năng này ở đây dưới dạng CODE SẴN SÀNG,
// MẶC ĐỊNH TẮT HOÀN TOÀN — không gửi bất kỳ request nào ra ngoài trừ khi
// user tự deploy Worker (xem cf-worker/README.md) rồi tự dán URL vào qua
// menu "⚙️ Cấu hình Similarity Report" (GM_registerMenuCommand, entry.js).
// Không có URL cấu hình = report() luôn no-op, 0 network call.
//
// PRIVACY: KHÔNG gửi videoId, seriesKey (private cache key), hay bất kỳ định
// danh nào của user. Payload chỉ gồm 2 chuỗi tên series đã lowercase (dữ
// liệu vốn đã public trên YouTube title/description), điểm Jaccard, và
// nguồn quyết định (jaccard/learner) — đúng tinh thần "luôn báo rõ dữ liệu
// công khai" đã áp dụng nhất quán ở SponsorBlock (sponsor-block.js).

const SimilarityReport = (() => {
    const CONFIG_KEY = 'similarityReportUrl';

    function _getUrl() {
        return Storage.getGlobal(CONFIG_KEY, '');
    }

    function isConfigured() {
        return !!_getUrl();
    }

    function configure(url) {
        Storage.setGlobal(CONFIG_KEY, (url || '').trim());
    }

    /**
     * Report 1 quyết định match series (không throw, không block flow chính
     * — best-effort, giống hệt triết lý của SponsorBlock.getSegments()).
     * @param {{a:string, b:string, jaccard:number, source:'jaccard'|'learner', matched:boolean}} decision
     */
    function report(decision) {
        const url = _getUrl();
        if (!url) return; // mặc định — tuyệt đại đa số user sẽ dừng ở đây, 0 network call

        try {
            const payload = JSON.stringify({
                a: (decision.a || '').toLowerCase().trim(),
                b: (decision.b || '').toLowerCase().trim(),
                jaccard: typeof decision.jaccard === 'number' ? Math.round(decision.jaccard * 1000) / 1000 : null,
                source: decision.source,
                matched: !!decision.matched,
                ts: Date.now(),
            });
            GM_xmlhttpRequest({
                method: 'POST',
                url,
                headers: { 'Content-Type': 'application/json' },
                data: payload,
                onload: () => {}, // fire-and-forget — không cần biết kết quả, không được phép làm chậm/chặn flow chính
                onerror: (e) => warn('[SimilarityReport] gửi lỗi (bỏ qua, không ảnh hưởng tính năng chính):', e),
                ontimeout: () => {},
            });
        } catch (e) {
            warn('[SimilarityReport] lỗi khi chuẩn bị report (bỏ qua):', e);
        }
    }

    return { report, isConfigured, configure };
})();
