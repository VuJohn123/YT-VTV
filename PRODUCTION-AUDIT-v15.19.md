# Production Checklist Audit — v15.19

Audit có hệ thống theo 14 tiêu chí user yêu cầu. Mỗi mục ghi rõ: đã sửa gì
(kèm bug thật tìm được), đã kiểm tra kỹ và xác nhận SẠCH (không phải chỉ lướt
qua), hoặc còn tồn đọng cần làm tiếp.

## ✅ Network Handling — bug nghiêm trọng nhất tìm được
**5/5 chỗ** dùng `GM_xmlhttpRequest` trong toàn bộ codebase
(`sponsor-block.js`, `tv-mode.js`, `similarity-report.js`,
`similarity-farm.js`) đều có sẵn callback `ontimeout` nhưng **thiếu field
`timeout`** — GM_xmlhttpRequest không tự đặt timeout mặc định, nên
`ontimeout` không bao giờ được kích hoạt, request có thể treo vô thời hạn.
Đã thêm `timeout` cho cả 5 chỗ (10-15s tuỳ mức độ tin cậy của từng API).

## ✅ Well-Intelligent (smart retry, không phải retry mù)
`similarity-farm.js`: thêm retry PHÂN LOẠI lỗi — chỉ retry lỗi transient
(network error, timeout, HTTP 5xx). KHÔNG retry 4xx (lỗi phía request, thử
lại vô ích) hay 2xx-nhưng-0-entry (nhiều khả năng lỗi định dạng thật). 6 test
xác nhận từng nhánh. Phát hiện phụ: `_sampleDown` bị xoá nhầm trong 1 lần
sửa trước + `RETRY_DELAY_MS` chưa khai báo — cả 2 đã sửa (bug thật, không
phải giả thuyết).

## ✅ Debugging-Friendly
- `tv-mode.js` (207 dòng, network-heavy, API reverse-engineered) **chưa
  từng có test nào** trước audit này — gap nghiêm trọng nhất về coverage.
  Đã viết 14 test cover mọi nhánh lỗi thật (mã ghép nối sai định dạng, JSON
  hỏng do API đổi format, SID không parse được, phiên hết hạn HTTP 400, lỗi
  server 500 kèm status code...).
- Lỗi TV Mode connect giờ `warn()` ra console trước khi hiện message cho
  user (trước đây chỉ hiện UI, mất thông tin debug khi cần chẩn đoán).

## ✅ Scalable / Well-Organized — load-order dependency
Phát hiện: nhiều module (`player-control.js`, `watch-party.js`,
`video-context.js`, `buffer-monitor.js`...) có `EventBus.on(...)` chạy ở
TOP-LEVEL IIFE (không nằm trong hàm chờ gọi sau) — cần `EventBus` global đã
tồn tại NGAY LÚC LOAD. Thứ tự `@require` hiện tại đúng (event-bus.js load
rất sớm, #2/23) nên KHÔNG có bug hiện tại — nhưng đây là pattern dễ vỡ nếu
ai sắp xếp lại load order sau này mà không biết dependency ngầm.

Đã viết `tests/load-order.test.js` — mô phỏng ĐÚNG thứ tự `@require` thật
trong 1 vm context dùng chung, bắt `ReferenceError` nếu thứ tự bị phá vỡ.
Đã tự kiểm chứng test THẬT SỰ bắt được lỗi (cố tình đảo thứ tự sai trong 1
bản copy tạm, xác nhận test fail đúng như dự đoán, rồi khôi phục file gốc
nguyên vẹn — đã diff xác nhận byte-identical).

## ✅ No Exploitations / input validation
- Rà toàn bộ `innerHTML` trong `ui.js`/`history-viewer.js` — mọi chỗ chèn
  dữ liệu động đều qua `escapeHTML`/`_escapeHtml` nhất quán; chỗ dùng
  `.textContent` an toàn tự nhiên. Không tìm thấy vector XSS thật.
- **14/14 chỗ `JSON.parse`** trong codebase đều có try/catch bọc đúng.
- `SimilarityReport.configure(url)` trước đây chấp nhận BẤT KỲ chuỗi nào,
  không validate — user gõ nhầm (thiếu scheme, dán nhầm `javascript:`...)
  sẽ âm thầm lưu URL sai, lỗi chỉ lộ ra ở tận lúc `GM_xmlhttpRequest` chạy
  (fire-and-forget, user không bao giờ biết report có gửi được không). Đã
  thêm validate: chỉ chấp nhận `https://` hợp lệ hoặc chuỗi rỗng (tắt tính
  năng), trả `{ok, error}` để caller báo lỗi rõ ràng ngay lúc cấu hình. 5
  test mới cover mọi case (hợp lệ, rỗng, thiếu scheme, http://, scheme lạ).

## ✅ No Placeholder
Grep toàn bộ TODO/FIXME/XXX/HACK/placeholder/"chưa làm" — sạch (chỉ có 2
chỗ HTML `placeholder=` attribute hợp lệ, không phải code chưa hoàn thiện).

## ✅ Stable/Reliable — timer & interval leaks
Rà toàn bộ `setInterval`/`setTimeout` trong mọi module — mọi chỗ đều có
`clearInterval`/`clearTimeout` tương ứng đúng lúc `disable()`. Không phát
hiện leak mới (các fix leak trước đây ở WatchParty/AudioMode/AutoPiP/
BufferMonitor từ v15.x vẫn còn nguyên).

## ✅ Most-Performant
Rà các vòng lặp lồng nhau (`similarity-farm.js` pairwise Jaccard,
`episode-navigator.js` similarity scoring) — đều có cap hợp lý
(`MAX_REPORTS_PER_RUN`, RSS giới hạn 15 video/kênh → tối đa C(15,2)=105
cặp/kênh) và không phải vấn đề performance thật ở quy mô dữ liệu thực tế.
`_isAdShowingByClass`/`_hideAds` (features.js) đã coalesce đúng qua rAF từ
trước — không tìm thấy hot-path nào cần tối ưu thêm.

## ✅ Updated Info (research xác nhận, không đoán)
Research lại giới hạn Cloudflare Workers/KV free tier 2026 qua nguồn chính
thức (Cloudflare Changelog 2026-02-11) — xác nhận **con số hiện dùng trong
code vẫn đúng 100%**: 50 subrequest ra ngoài internet, nhưng **1000**
subrequest riêng cho dịch vụ Cloudflare cùng account (KV) — không phải nhầm
lẫn, đã dẫn nguồn chính thức trực tiếp vào comment thay vì chỉ "đã research"
chung chung.

## Kết quả kiểm thử
`npm test`: **132/132 PASS** (từ 104 trước audit này → +28 test mới, toàn bộ
đều test bug/behavior thật, không có test giả để tăng số đếm). Mọi module
`node --check` OK, Worker code syntax OK.

## Còn tồn đọng (chưa làm trong lượt audit này)
- Chưa áp dụng retry-pattern (transient-aware) cho `sponsor-block.js` —
  đã cân nhắc nhưng ưu tiên thấp hơn vì module này đã graceful-degrade tốt
  sẵn (lỗi 1 video không chặn flow chính, không mất dữ liệu như Farm Mode).
- Chưa audit sâu `ui.js`/`features.js` (2 file lớn nhất, 1169 + 1429 dòng)
  ở mức chi tiết dòng-theo-dòng như đã làm với `similarity-farm.js`/
  `tv-mode.js` — đã audit các khía cạnh cross-cutting (XSS, JSON.parse,
  timer leak, load-order) bao phủ 2 file này, nhưng chưa rà logic nghiệp vụ
  chi tiết bên trong từng hàm.
- "Compact CLI usage" (tránh dùng nhiều flag dòng lệnh phức tạp) — không áp
  dụng trực tiếp cho codebase JS/userscript này, đã hiểu là ám chỉ tổ chức
  code nhiều file nhỏ thay vì 1 file khổng lồ (đã đạt — 24 module riêng
  biệt theo layer, module lớn nhất 1429 dòng vẫn có cấu trúc rõ theo từng
  IIFE con).
