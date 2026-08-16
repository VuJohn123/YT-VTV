/**
 * similarity-report-worker.js — Cloudflare Worker nhận report ẩn danh từ
 * SimilarityReport.report() (modules/similarity-report.js) để tích luỹ dữ
 * liệu thật, phục vụ tinh chỉnh JACCARD_THRESHOLD trong episode-navigator.js
 * sau này thay vì đoán 1 con số cố định (0.5) không có dữ liệu hỗ trợ.
 *
 * Đây KHÔNG phải hạ tầng của dev gốc (không có quyền deploy thay user) —
 * user tự deploy Worker này bằng account Cloudflare của CHÍNH MÌNH, dữ liệu
 * hoàn toàn thuộc quyền kiểm soát của user. Xem README.md cùng thư mục.
 *
 * ENDPOINT DUY NHẤT: POST / — payload JSON dạng
 *   { a: string, b: string, jaccard: number|null, source: 'jaccard'|'learner', matched: boolean, ts: number }
 * KHÔNG có videoId/seriesKey/bất kỳ định danh cá nhân nào trong payload —
 * xem comment PRIVACY ở modules/similarity-report.js phía client.
 */

// Giới hạn kích thước payload thô — chặn abuse gửi payload khổng lồ giả mạo
// report thật (endpoint public, không có auth — xem README.md phần rủi ro).
const MAX_BODY_BYTES = 2048;

function jsonResponse(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function isValidDecision(d) {
    return d
        && typeof d.a === 'string' && d.a.length > 0 && d.a.length <= 200
        && typeof d.b === 'string' && d.b.length > 0 && d.b.length <= 200
        && (d.jaccard === null || typeof d.jaccard === 'number')
        && (d.source === 'jaccard' || d.source === 'learner')
        && typeof d.matched === 'boolean';
}

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') {
            return jsonResponse({ error: 'Chỉ nhận POST' }, 405);
        }

        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) {
            return jsonResponse({ error: 'Payload quá lớn' }, 413);
        }

        let decision;
        try {
            decision = JSON.parse(raw);
        } catch (e) {
            return jsonResponse({ error: 'JSON không hợp lệ' }, 400);
        }

        if (!isValidDecision(decision)) {
            return jsonResponse({ error: 'Payload thiếu/sai field bắt buộc' }, 400);
        }

        // Lưu vào KV — key theo timestamp + random suffix để tránh đè lẫn
        // nhau nếu nhiều report đến CÙNG mili-giây (2 tab cùng lúc chẳng
        // hạn). Value là chính payload đã validate — không thêm gì (không
        // có IP, không có User-Agent, giữ đúng tinh thần ẩn danh của client).
        const key = `report:${decision.ts || Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
        try {
            await env.SIMILARITY_REPORTS.put(key, JSON.stringify({
                a: decision.a.toLowerCase().trim(),
                b: decision.b.toLowerCase().trim(),
                jaccard: decision.jaccard,
                source: decision.source,
                matched: decision.matched,
                ts: decision.ts || Date.now(),
            }));
        } catch (e) {
            // KV ghi lỗi (hiếm, thường do quota) — vẫn trả 200 cho client vì
            // client dùng fire-and-forget (onload rỗng, không đọc response),
            // không đáng để retry/thử lại phức tạp cho 1 dòng thống kê.
            return jsonResponse({ ok: false, warning: 'lưu thất bại, đã bỏ qua' }, 200);
        }

        return jsonResponse({ ok: true });
    },
};
