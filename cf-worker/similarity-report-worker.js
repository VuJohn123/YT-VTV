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
 * 2 ENDPOINT:
 *   POST /       — nhận report (JSON, xem isValidDecision())
 *   GET  /stats  — trang HTML thống kê (histogram Jaccard, breakdown theo
 *                  nguồn, bảng report gần nhất) — mở thẳng URL Worker + /stats
 *                  trên trình duyệt để xem, không cần thêm gì (không auth,
 *                  xem README.md phần rủi ro).
 * KHÔNG có videoId/seriesKey/bất kỳ định danh cá nhân nào trong payload —
 * xem comment PRIVACY ở modules/similarity-report.js phía client.
 */

// Giới hạn kích thước payload thô — chặn abuse gửi payload khổng lồ giả mạo
// report thật (endpoint public, không có auth — xem README.md phần rủi ro).
const MAX_BODY_BYTES = 2048;

// Free tier Cloudflare Workers: 1000 subrequest tới KV/invocation (đã
// research kỹ, tái xác nhận qua nguồn chính thức Cloudflare — Changelog
// 2026-02-11 "Workers are no longer limited to 1000 subrequests": free plan
// giới hạn 50 subrequest RA NGOÀI internet nhưng riêng subrequest tới dịch
// vụ Cloudflare CÙNG ACCOUNT như KV là 1000/invocation, KHÁC hẳn giới hạn
// 50 hay bị nhầm). Cap ở 1000 để /stats luôn nằm gọn trong 1 invocation
// free tier, không cần trả phí/nâng cấp gói.
const MAX_STATS_READS = 1000;

function jsonResponse(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function isValidDecision(d) {
    // sizeA/sizeB/intersection/union (Jaccard) và matchedCharacters/
    // totalCharacters/sampleCount (SeriesLearner) đều OPTIONAL — client cũ
    // hơn (chưa có bản gửi field thô) vẫn phải tiếp tục hoạt động bình
    // thường, không bị Worker từ chối chỉ vì thiếu field mới.
    const optNum = (v) => v === undefined || typeof v === 'number';
    return d
        && typeof d.a === 'string' && d.a.length > 0 && d.a.length <= 200
        && typeof d.b === 'string' && d.b.length > 0 && d.b.length <= 200
        && (d.jaccard === null || typeof d.jaccard === 'number')
        && (d.source === 'jaccard' || d.source === 'learner')
        && typeof d.matched === 'boolean'
        && optNum(d.sizeA) && optNum(d.sizeB) && optNum(d.intersection) && optNum(d.union)
        && optNum(d.matchedCharacters) && optNum(d.totalCharacters) && optNum(d.sampleCount);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/** Đọc tối đa MAX_STATS_READS report gần nhất (key sort theo timestamp nên
 * list() trả về đúng thứ tự thời gian — xem comment ở chỗ tạo key trong
 * POST handler), tính toán mọi số liệu cần cho trang /stats trong 1 lượt
 * quét duy nhất (tránh đọc KV nhiều lần cho từng số liệu khác nhau). */
async function _gatherStats(env) {
    const reports = [];
    let cursor;
    while (reports.length < MAX_STATS_READS) {
        const page = await env.SIMILARITY_REPORTS.list({ prefix: 'report:', cursor, limit: 1000 });
        for (const k of page.keys) {
            if (reports.length >= MAX_STATS_READS) break;
            const raw = await env.SIMILARITY_REPORTS.get(k.name);
            if (raw) { try { reports.push(JSON.parse(raw)); } catch (e) {} }
        }
        if (page.list_complete || !page.cursor) break;
        cursor = page.cursor;
    }

    // KV list() trả về key theo thứ tự lexicographic — TRÙNG với thứ tự thời
    // gian vì key có dạng "report:<epoch-ms 13 chữ số>:<suffix>" (cùng độ
    // dài chữ số từ nay tới năm 2286 — xem comment ở nơi tạo key), nghĩa là
    // reports[] đang ở thứ tự CŨ→MỚI. Đảo lại để "gần nhất" lên đầu.
    reports.reverse();

    const bucketCount = 10; // 0.0–0.1, 0.1–0.2 ... 0.9–1.0
    const histogram = new Array(bucketCount).fill(0);
    let matchedCount = 0;
    const bySource = { jaccard: 0, learner: 0 };
    // Dice coefficient (2·|A∩B| / (|A|+|B|)) — độ đo KHÁC Jaccard, tính lại
    // được TỪ DỮ LIỆU THÔ đã report (sizeA/sizeB/intersection) mà không cần
    // client gửi thêm gì — đúng giá trị của việc report cả thành phần thô,
    // không chỉ điểm Jaccard cuối cùng.
    let diceSum = 0, diceCount = 0;

    for (const r of reports) {
        if (r.matched) matchedCount++;
        if (r.source === 'jaccard' || r.source === 'learner') bySource[r.source]++;
        if (typeof r.jaccard === 'number') {
            const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(r.jaccard * bucketCount)));
            histogram[idx]++;
        }
        if (typeof r.sizeA === 'number' && typeof r.sizeB === 'number' && typeof r.intersection === 'number' && (r.sizeA + r.sizeB) > 0) {
            diceSum += (2 * r.intersection) / (r.sizeA + r.sizeB);
            diceCount++;
        }
    }

    return {
        total: reports.length,
        matchedCount,
        bySource,
        histogram,
        avgDice: diceCount > 0 ? diceSum / diceCount : null,
        recent: reports.slice(0, 50),
        truncated: reports.length >= MAX_STATS_READS, // có thể còn nhiều report cũ hơn chưa được tính
    };
}

function _renderStatsHtml(stats) {
    const maxBucket = Math.max(1, ...stats.histogram);
    const bars = stats.histogram.map((count, i) => {
        const heightPct = Math.round((count / maxBucket) * 100);
        const label = `${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}`;
        return `<div class="bar-col">
            <div class="bar-count">${count}</div>
            <div class="bar" style="height:${Math.max(heightPct, count > 0 ? 4 : 0)}%"></div>
            <div class="bar-label">${label}</div>
        </div>`;
    }).join('');

    const rows = stats.recent.map(r => `<tr>
        <td>${escapeHtml(r.a)}</td>
        <td>${escapeHtml(r.b)}</td>
        <td>${typeof r.jaccard === 'number' ? r.jaccard.toFixed(3) : '—'}</td>
        <td>${escapeHtml(r.source)}</td>
        <td>${r.matched ? '✅' : '❌'}</td>
        <td>${r.source === 'jaccard'
            ? (typeof r.sizeA === 'number' ? `${r.intersection}/${r.union} từ` : '—')
            : (typeof r.matchedCharacters === 'number' ? `${r.matchedCharacters}/${r.totalCharacters} tên` : '—')}</td>
        <td>${new Date(r.ts).toLocaleString('vi-VN')}</td>
    </tr>`).join('');

    const matchedPct = stats.total > 0 ? Math.round((stats.matchedCount / stats.total) * 100) : 0;

    return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="UTF-8">
<title>Similarity Report — Thống kê</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #0f0f0f; color: #eee; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .sub { color: #888; font-size: 13px; margin-bottom: 24px; }
  .cards { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 28px; }
  .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px; padding: 16px 20px; min-width: 140px; }
  .card .num { font-size: 26px; font-weight: 700; }
  .card .label { color: #999; font-size: 12px; margin-top: 4px; }
  .chart { display: flex; align-items: flex-end; gap: 6px; height: 160px; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px; padding: 16px; margin-bottom: 28px; }
  .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  .bar-count { font-size: 11px; color: #aaa; margin-bottom: 4px; }
  .bar { width: 100%; background: linear-gradient(180deg,#ff3b3b,#a10000); border-radius: 3px 3px 0 0; min-height: 2px; }
  .bar-label { font-size: 10px; color: #777; margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a2a2a; }
  th { color: #999; font-weight: 600; font-size: 11px; text-transform: uppercase; }
  .note { color: #777; font-size: 12px; margin-top: 8px; }
</style></head>
<body>
  <h1>📊 Similarity Report — Thống kê</h1>
  <div class="sub">Dữ liệu match series (Jaccard/SeriesLearner) từ VTV Ultimate userscript — ẩn danh, chỉ tên series + điểm số.</div>

  <div class="cards">
    <div class="card"><div class="num">${stats.total}</div><div class="label">Tổng report</div></div>
    <div class="card"><div class="num">${matchedPct}%</div><div class="label">Tỉ lệ matched</div></div>
    <div class="card"><div class="num">${stats.bySource.jaccard}</div><div class="label">Qua Jaccard</div></div>
    <div class="card"><div class="num">${stats.bySource.learner}</div><div class="label">Qua SeriesLearner</div></div>
    <div class="card"><div class="num">${stats.avgDice !== null ? stats.avgDice.toFixed(3) : '—'}</div><div class="label">Dice trung bình</div></div>
  </div>

  <h2 style="font-size:14px;color:#ccc;">Phân bố điểm Jaccard (dùng để chọn ngưỡng JACCARD_THRESHOLD)</h2>
  <div class="chart">${bars}</div>

  <h2 style="font-size:14px;color:#ccc;">${stats.recent.length} report gần nhất</h2>
  <table>
    <thead><tr><th>Series A</th><th>Series B</th><th>Jaccard</th><th>Nguồn</th><th>Matched</th><th>Chi tiết</th><th>Thời gian</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">Chưa có report nào.</td></tr>'}</tbody>
  </table>
  ${stats.truncated ? `<div class="note">⚠️ Đang hiển thị ${MAX_STATS_READS} report gần nhất (giới hạn free tier mỗi lần tải trang) — có thể còn report cũ hơn chưa tính vào số liệu trên.</div>` : ''}
</body></html>`;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === 'GET' && url.pathname === '/stats') {
            const stats = await _gatherStats(env);
            return new Response(_renderStatsHtml(stats), {
                headers: { 'Content-Type': 'text/html; charset=UTF-8' },
            });
        }

        if (request.method !== 'POST') {
            return jsonResponse({ error: 'Chỉ nhận POST / hoặc GET /stats' }, 405);
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
                // Field thô optional — lưu nguyên nếu client có gửi (xem
                // comment "GAIN TOÀN BỘ INFO HỮU ÍCH" ở similarity-report.js).
                sizeA: decision.sizeA, sizeB: decision.sizeB,
                intersection: decision.intersection, union: decision.union,
                matchedCharacters: decision.matchedCharacters,
                totalCharacters: decision.totalCharacters,
                sampleCount: decision.sampleCount,
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
