# Bàn giao v15.12 — 3 việc còn treo từ bàn giao trước đã xử lý

## 1. Bug thật đã tìm ra + fix: "1 phát ba cái"
Root cause: `EventBus.on('videoReady', ...)` được đăng ký BÊN TRONG `enable()`
của `WatchParty`/`AudioMode`/`AutoPiP`/`BufferMonitor` — mỗi lần user bật lại
tính năng (sau khi đã tắt), 1 listener MỚI chồng lên listener cũ (EventBus
không tự huỷ khi `disable()` chạy). Bật/tắt N lần → N listener trùng.

Rõ nhất ở `WatchParty`: bật/tắt 3 lần rồi chuyển tập → broadcast `'nav'` bắn
ra 3 lần liên tiếp cho cùng 1 URL → tab/máy khác trong phòng tự
`Navigator.goTo()` 3 lần dồn dập. Đã tái hiện bug bằng test THẬT trước khi
sửa (`tests/watch-party-listener-leak.test.js`), fix xong test pass.

**Sửa**: đăng ký listener đúng 1 LẦN ở module-scope (chạy khi file load),
`enable()`/`disable()` chỉ còn bật/tắt cờ `_enabled` — mọi handler tự gác
cổng bằng cờ này. Áp dụng cho cả 4 module (`watch-party.js`, `features.js`
2 chỗ, `buffer-monitor.js`).

## 2. Cross-tab sync cảnh báo → module MỚI `tab-guard.js`
KHÁC `WatchParty` (không sync/điều khiển gì, chỉ CẢNH BÁO thụ động), mặc
định BẬT SẴN. Cơ chế: heartbeat qua `BroadcastChannel` riêng (khác channel
WatchParty), tab nào phát hiện tab khác cùng máy đang mở CÙNG `videoId` →
hiện banner trong panel. Gửi tín hiệu "rời đi" tường minh khi đóng
tab/disable() thay vì đợi hết hạn 12s.

Toggle trong UI: "🪟 Cảnh báo trùng tab" (nhóm nâng cao). Test:
`tests/tab-guard.test.js` (mô phỏng 2 tab thật qua mock BroadcastChannel bus
dùng chung).

## 3. Report-to-backend similarity training → `similarity-report.js` + `cf-worker/`
Đúng như đã hứa ở bàn giao trước: viết code Worker sẵn để user TỰ deploy
(không có quyền deploy thay). Client-side: `SimilarityReport` module, MẶC
ĐỊNH TẮT TUYỆT ĐỐI (0 network call) trừ khi user tự cấu hình URL qua menu
"📊 Cấu hình Similarity Report". Payload ẩn danh (chỉ 2 tên series + điểm
Jaccard, không videoId/seriesKey). Worker code + `wrangler.toml` +
`README.md` (kèm giải thích rõ vì sao KHÔNG thể khai sẵn `@connect` cho mọi
user — đã research kỹ Tampermonkey issue #1593) trong `cf-worker/`.

Test: `tests/similarity-report.test.js` — đặc biệt test "mặc định phải là
no-op tuyệt đối" vì đây là tính năng duy nhất gửi dữ liệu ra ngoài.

## Trạng thái
`npm test`: **56/56 PASS** (48 gốc + 8 mới). Tất cả module `node --check` OK.
Version bump 15.11 → 15.12.

## Việc còn treo (chưa làm)
- Không còn gì từ danh sách cũ. Nếu phát sinh bug/feature mới, cần user tự
  cung cấp thêm mô tả cụ thể để chẩn đoán chắc chắn (nguyên tắc #5 trong bàn
  giao gốc: không đoán mù về hành vi trình duyệt/YouTube internals).
