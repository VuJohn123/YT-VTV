// series-learner.js — Layer 2: "Học" đặc trưng series từ description (statistical, không AI)
//
// MINH BẠCH VỀ CÁCH HOẠT ĐỘNG: đây KHÔNG PHẢI machine learning theo nghĩa
// neural network/AI model — không có training, không có weights, không dự
// đoán xác suất phức tạp. Đây là THỐNG KÊ TẦN SUẤT đơn giản (đếm từ xuất hiện
// bao nhiêu lần) kết hợp rule-based matching — nhưng vẫn tạo ra hiệu ứng "học
// dần theo thời gian" thực sự: xem càng nhiều tập của 1 series, hệ thống càng
// nhận diện chính xác series đó qua description, dù title bị viết khác đi.
//
// Ý TƯỞNG: description các tập CÙNG 1 series thường lặp lại tên nhân vật
// (ví dụ "Kiên", "Châu", "Diễm Loan"...) và hashtag cố định (#phimvietnam
// #vtv...). Đếm tần suất các từ/cụm từ xuất hiện qua NHIỀU description của
// cùng series → xây "character dictionary" riêng cho series đó → dùng để:
//   1. Tăng độ tin cậy khi match series (nếu description video mới chứa các
//      tên nhân vật đã biết của series X, tăng khả năng đây đúng là series X
//      dù title viết khác kiểu).
//   2. Gợi ý sửa lỗi parse title khi series match bị mơ hồ (fuzzy match theo
//      tên series không đủ chắc chắn).
//
// LƯU TRỮ: dùng GM storage, key theo seriesKey — dữ liệu học được PERSIST qua
// session, càng dùng lâu càng chính xác hơn (đúng tinh thần "học" thật, dù cơ
// chế bên dưới chỉ là đếm tần suất).

const SeriesLearner = (() => {
    const MIN_WORD_LEN = 2;          // bỏ qua từ quá ngắn (không có ý nghĩa phân biệt)
    const MIN_OCCURRENCE_TO_LEARN = 2; // từ phải xuất hiện ít nhất 2 description khác nhau mới được coi là "đặc trưng series" (tránh học nhầm từ ngẫu nhiên chỉ xuất hiện 1 lần)
    const MAX_CHARACTERS_TRACKED = 15; // giới hạn số từ đặc trưng lưu mỗi series, tránh phình to vô hạn

    // Stopword tiếng Việt phổ biến trong description phim — không mang tính
    // phân biệt series, cần loại trừ khỏi việc "học tên nhân vật".
    const STOPWORDS = new Set([
        'và', 'của', 'trong', 'với', 'để', 'khi', 'là', 'có', 'không', 'được',
        'này', 'đã', 'sẽ', 'cho', 'từ', 'một', 'các', 'những', 'phim', 'tập',
        'xem', 'full', 'hd', 'vtv', 'vtv1', 'vtv3', 'việt', 'nam', 'giải', 'trí',
        'trên', 'mới', 'nhất', 'hay', 'phần', 'sau', 'trước', 'lúc', 'thì',
        'nhưng', 'nếu', 'vì', 'nên', 'đến', 'vào', 'ra', 'lên', 'xuống',
    ]);

    function _tokenize(text) {
        if (!text) return [];
        return text
            .replace(/#\S+/g, '')          // bỏ hashtag (học riêng, không lẫn vào "tên nhân vật")
            .replace(/[.,!?;:'"()\[\]…]/g, ' ')
            .split(/\s+/)
            .map(w => w.trim())
            .filter(w => w.length >= MIN_WORD_LEN && !STOPWORDS.has(w.toLowerCase()));
    }

    function _extractHashtags(text) {
        if (!text) return [];
        return (text.match(/#\S+/g) || []).map(h => h.toLowerCase());
    }

    function _storageKey(seriesKey) { return 'learn_' + seriesKey; }

    /**
     * Nạp 1 description mới vào "kiến thức" đã học cho series này. Gọi mỗi
     * lần có description mới (từ search result hoặc virtual playlist).
     * @param {string} seriesKey
     * @param {string} description
     */
    function learn(seriesKey, description) {
        if (!seriesKey || !description) return;

        const data = Storage.getLearnedData(seriesKey) || { wordCounts: {}, hashtagCounts: {}, sampleCount: 0 };
        data.sampleCount++;

        // Đếm MỖI TỪ TỐI ĐA 1 LẦN mỗi description — tránh 1 description dài
        // lặp lại 1 từ nhiều lần làm lệch thống kê so với description khác.
        const wordsInThisDesc = new Set(_tokenize(description));
        for (const w of wordsInThisDesc) {
            data.wordCounts[w] = (data.wordCounts[w] || 0) + 1;
        }
        const hashtagsInThisDesc = new Set(_extractHashtags(description));
        for (const h of hashtagsInThisDesc) {
            data.hashtagCounts[h] = (data.hashtagCounts[h] || 0) + 1;
        }

        Storage.saveLearnedData(seriesKey, data);
    }

    /**
     * Lấy danh sách "từ đặc trưng" (khả năng cao là tên nhân vật) đã học
     * được cho series này — những từ xuất hiện đủ nhiều description khác
     * nhau để không phải ngẫu nhiên.
     * @param {string} seriesKey
     * @returns {string[]} tối đa MAX_CHARACTERS_TRACKED từ, sắp theo tần suất giảm dần
     */
    function getLearnedCharacters(seriesKey) {
        const data = Storage.getLearnedData(seriesKey);
        if (!data || data.sampleCount < MIN_OCCURRENCE_TO_LEARN) return []; // chưa đủ mẫu để tin tưởng

        return Object.entries(data.wordCounts)
            .filter(([word, count]) => count >= MIN_OCCURRENCE_TO_LEARN)
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_CHARACTERS_TRACKED)
            .map(([word]) => word);
    }

    /**
     * Tính "điểm tin cậy" (0-1) rằng 1 description thuộc về series đã học,
     * dựa trên số từ đặc trưng trùng khớp. Dùng làm tín hiệu PHỤ (không thay
     * thế) cho _seriesMatch dựa trên tên series trong episode-navigator.js —
     * hữu ích nhất khi title bị viết khác kiểu nhưng description vẫn nhắc
     * đúng tên nhân vật quen thuộc.
     * @param {string} seriesKey
     * @param {string} description
     * @returns {number} 0 nếu chưa học đủ hoặc không khớp gì, tăng dần theo số từ trùng
     */
    function confidenceScore(seriesKey, description) {
        const characters = getLearnedCharacters(seriesKey);
        if (!characters.length || !description) return 0;

        const wordsInDesc = new Set(_tokenize(description));
        const matched = characters.filter(c => wordsInDesc.has(c));
        return matched.length / characters.length;
    }

    return { learn, getLearnedCharacters, confidenceScore };
})();
