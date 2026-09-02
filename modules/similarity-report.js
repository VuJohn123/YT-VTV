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
//
// "GAIN TOÀN BỘ INFO HỮU ÍCH": ngoài điểm số cuối cùng, còn gửi kèm các
// THÀNH PHẦN THÔ đứng sau điểm số đó (sizeA/sizeB/intersection/union cho
// Jaccard; matchedCharacters/totalCharacters/sampleCount cho SeriesLearner)
// — cùng vẫn là dữ liệu dẫn xuất từ tên series (không thêm định danh cá
// nhân nào), nhưng cho phép tính lại các độ đo KHÁC (Dice, overlap
// coefficient, hay điều chỉnh MIN_OCCURRENCE_TO_LEARN...) từ dữ liệu ĐÃ CÓ
// sau này mà không cần sửa lại schema report / bắt user cập nhật script để
// thu thập lại từ đầu.

const SimilarityReport = (() => {
    const CONFIG_KEY = 'similarityReportUrl';
    // Cùng bug Network Handling đã fix ở sponsor-block.js/tv-mode.js (audit
    // toàn dự án). Ở đây ít quan trọng hơn (fire-and-forget, không block gì
    // — xem onload rỗng bên dưới) nhưng vẫn nên set để request thật sự tự
    // dọn dẹp thay vì treo vô thời hạn trong hàng đợi network của trình
    // duyệt (tích tụ nhiều request "ma" theo thời gian nếu server không
    // phản hồi, dù không gây lỗi thấy được ngay).
    const REQUEST_TIMEOUT_MS = 10_000;

    function _getUrl() {
        return Storage.getGlobal(CONFIG_KEY, '');
    }

    function isConfigured() {
        return !!_getUrl();
    }

    /**
     * Validate cơ bản trước khi lưu — chặn lỗi gõ nhầm phổ biến (URL thiếu
     * scheme, dán nhầm URL không phải http/https như javascript:, hoặc URL
     * rõ ràng sai định dạng) TRƯỚC KHI lưu vào GM storage, thay vì để lỗi
     * âm thầm xảy ra ở tận lúc GM_xmlhttpRequest thật sự chạy (fire-and-
     * forget, user sẽ KHÔNG BAO GIỜ biết report đang gửi đi đâu/có gửi được
     * không — xem onload rỗng trong report()). Đây không phải phòng thủ
     * trước "tấn công" (user tự cấu hình URL của chính mình, không có bên
     * thứ 3 nào can thiệp được vào giá trị này) — mục đích là chặn user tự
     * gõ nhầm, và tuân thủ nguyên tắc validate input cơ bản của code
     * production-ready.
     * @returns {{ok:boolean, error?:string}}
     */
    function _validateUrl(url) {
        const trimmed = (url || '').trim();
        if (!trimmed) return { ok: true }; // rỗng = tắt tính năng, hợp lệ
        let parsed;
        try { parsed = new URL(trimmed); }
        catch (e) { return { ok: false, error: 'URL không hợp lệ — thiếu "https://" ở đầu?' }; }
        if (parsed.protocol !== 'https:') {
            return { ok: false, error: `Chỉ chấp nhận URL https:// (nhận được "${parsed.protocol}") — GM_xmlhttpRequest cần HTTPS để đảm bảo dữ liệu không bị đọc/sửa giữa đường.` };
        }
        return { ok: true };
    }

    /**
     * @param {string} url
     * @returns {{ok:boolean, error?:string}} — caller (menu command trong
     * entry.js) PHẢI kiểm tra `ok` để báo lỗi rõ cho user thay vì âm thầm
     * lưu 1 URL sai (xem comment ở _validateUrl()).
     */
    function configure(url) {
        const validation = _validateUrl(url);
        if (!validation.ok) return validation;
        Storage.setGlobal(CONFIG_KEY, (url || '').trim());
        return { ok: true };
    }

    /**
     * Report 1 quyết định match series (không throw, không block flow chính
     * — best-effort, giống hệt triết lý của SponsorBlock.getSegments()).
     * @param {{a:string, b:string, jaccard:number, source:'jaccard'|'learner', matched:boolean,
     *          sizeA?:number, sizeB?:number, intersection?:number, union?:number,
     *          matchedCharacters?:number, totalCharacters?:number, sampleCount?:number}} decision
     */
    function report(decision) {
        const url = _getUrl();
        if (!url) return; // mặc định — tuyệt đại đa số user sẽ dừng ở đây, 0 network call

        // Field thô — optional, chỉ có mặt nếu caller truyền vào (Jaccard vs
        // SeriesLearner gửi bộ field khác nhau, không ép field không liên
        // quan phải có mặt = null cho gọn payload). Ép về số nguyên/bỏ qua
        // nếu không phải number hợp lệ — tránh gửi rác nếu caller truyền sai kiểu.
        const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

        try {
            const payload = JSON.stringify({
                a: (decision.a || '').toLowerCase().trim(),
                b: (decision.b || '').toLowerCase().trim(),
                jaccard: typeof decision.jaccard === 'number' ? Math.round(decision.jaccard * 1000) / 1000 : null,
                source: decision.source,
                matched: !!decision.matched,
                sizeA: num(decision.sizeA), sizeB: num(decision.sizeB),
                intersection: num(decision.intersection), union: num(decision.union),
                matchedCharacters: num(decision.matchedCharacters),
                totalCharacters: num(decision.totalCharacters),
                sampleCount: num(decision.sampleCount),
                ts: Date.now(),
            });
            GM_xmlhttpRequest({
                method: 'POST',
                url,
                headers: { 'Content-Type': 'application/json' },
                data: payload,
                timeout: REQUEST_TIMEOUT_MS,
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
