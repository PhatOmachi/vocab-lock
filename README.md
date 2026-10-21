# Vocab Lock 🔒

Extension cho Microsoft Edge (chạy được cả Chrome) giúp học từ vựng tiếng Anh trong lúc lướt web:
lưu từ kèm nghĩa tiếng Việt, rồi thỉnh thoảng **khóa trình duyệt** hỏi lại — trả lời đúng mới dùng tiếp được.

Mặc định chạy **miễn phí, không cần tài khoản**. Cấu hình thêm mô hình AI (Gemini, ChatGPT, Claude, Ollama… hoặc URL bất kỳ) / Deepgram thì bật thêm tính năng AI và giọng nói.

## Cài đặt / cập nhật trên Edge

1. Tải mã nguồn về một thư mục cố định (vd `D:\Tools\vocab-lock`). **Đừng xóa thư mục này.**
   - Dùng git: `git clone https://github.com/PhatOmachi/vocab-lock.git` — cập nhật bằng `git pull`.
   - Hoặc trên GitHub bấm **Code → Download ZIP** rồi giải nén. Cập nhật: giải nén **đè** lên thư mục cũ.

   Cập nhật bằng cách nào thì dữ liệu cũng giữ nguyên, miễn là **cùng đường dẫn thư mục** và không bấm Remove extension.
2. Mở `edge://extensions`, bật **Chế độ dành cho nhà phát triển** (Developer mode).
3. Lần đầu: bấm **Tải tiện ích đã giải nén** (Load unpacked) → chọn thư mục.
   Cập nhật: bấm nút ↻ **Reload** ở thẻ Vocab Lock.
4. Ghim icon Vocab Lock lên thanh công cụ.

## Lưu từ

- Bôi đen từ trên trang → chuột phải → **Lưu "…" vào Vocab Lock**, hoặc nhấn **Alt + Shift + S**, hoặc bấm icon extension.
- Nhiều nghĩa cách nhau bằng dấu phẩy — trả lời **một** nghĩa bất kỳ là đúng. Phần trong ngoặc là tuỳ chọn.
- Ghi chú viết được nhiều dòng (Enter xuống dòng, Ctrl + Enter để lưu nhanh).
- Câu chứa từ đó trên trang được lưu kèm (dùng cho kiểu câu hỏi “Điền vào chỗ trống” và để AI dịch đúng ngữ cảnh).

## Khóa hỏi bài

- Ngẫu nhiên mỗi 10–30 phút (chỉnh được) — **tất cả các tab** bị khóa tới khi trả lời đúng.
- Video/nhạc đang phát (kể cả YouTube ở tab khác) tạm dừng, trả lời xong **tự phát tiếp**. Tắt được ở Cài đặt chung.
- Thứ tự hỏi kiểu **xáo bài theo vòng**: mỗi vòng hỏi đủ mọi từ đang học, mỗi từ 1 lần, không hỏi 1 từ 2 lần liền. Từ hay sai thường được hỏi sớm hơn trong vòng.
- Sai 3 lần → gợi ý chữ cái đầu. Sai 6 lần → hiện đáp án, bạn tự gõ lại để mở khóa.
- Trả lời đúng → **Tiếp tục** hoặc **Đã thuộc, không hỏi lại**.

### 5 kiểu câu hỏi (bật/tắt + bấm “Thử” ở Cài đặt chung)

| Kiểu | Cần gì |
|---|---|
| Nghĩa của từ (EN → VI) | Miễn phí |
| Đoán từ (VI → EN) | Miễn phí |
| Trắc nghiệm 4 đáp án (phím tắt A B C D) | Miễn phí, cần ≥ 4 từ |
| Điền vào chỗ trống | Miễn phí (dùng câu ví dụ/câu gốc). Có mô hình AI thì tạo câu mới mỗi lần |
| Luyện phát âm (đọc to từ) | Deepgram + quyền micro |

## Phát âm 🔊

Nút loa ở mọi nơi có từ: nhấn để nghe, **nhấn lần nữa trong 3 giây để nghe chậm**. Có phiên âm IPA.
Nguồn: từ điển miễn phí dictionaryapi.dev, từ nào không có thì dùng giọng đọc có sẵn của Edge. Chọn giọng Mỹ/Anh trong Cài đặt.

## AI & giọng nói (tuỳ chọn)

Vào **Quản lý → AI & giọng nói**.

**Mô hình AI** — dùng nhà cung cấp nào cũng được:
1. Chọn **Nhà cung cấp** để điền sẵn: Google Gemini, OpenAI, Anthropic Claude, OpenRouter, Groq, DeepSeek,
   Ollama / LM Studio (chạy trên máy), hoặc **Tuỳ chỉnh** để tự nhập URL.
2. **Base URL** sửa tự do — dùng được proxy riêng, máy chủ nội bộ, localhost…
3. **Định dạng API**: `OpenAI-compatible` (đa số nhà cung cấp, vLLM, Ollama, LM Studio…), `Google Gemini`, hoặc `Anthropic`.
4. Dán **API key** (máy chủ chạy trên máy thì để trống được), gõ tên **Model** hoặc bấm **Tải danh sách** để chọn.
5. Bấm **Lưu & kiểm tra** — extension gọi thử model, chỉ lưu khi chạy được.

Có mô hình AI thì bật thêm:
- **Tự điền khi lưu từ:** nghĩa đúng ngữ cảnh câu bạn đang đọc, loại từ, câu ví dụ, cách đọc kiểu Việt (vd `diu-BÍCH-quơ-tợt`).
- **Chấm mềm:** trả lời khác chữ nhưng đúng ý vẫn được tính đúng; có nút thêm cách hiểu đó vào nghĩa.
- **Điền vào chỗ trống:** tạo câu mới mỗi lần hỏi.

Mẹo: nên chọn model nhỏ, nhanh (bản flash / mini / haiku…) vì việc này đơn giản. Model “suy nghĩ” (reasoning) vẫn chạy được nhưng chậm hơn.
Ollama: cần đặt biến môi trường `OLLAMA_ORIGINS=chrome-extension://*` rồi khởi động lại Ollama thì extension mới gọi được.

**Deepgram** — tạo key tại https://console.deepgram.com
- Bấm **Cấp quyền micro** (một lần).
- **Luyện phát âm:** đọc to từ, Deepgram nghe ra đúng từ thì mở khóa (kiểm tra “nghe có ra từ không”, không chấm chi tiết từng âm).
- **Trả lời bằng giọng nói:** nút micro trong ô trả lời — nói nghĩa tiếng Việt hoặc từ tiếng Anh thay vì gõ.

Key chỉ lưu trên máy này, chỉ gửi thẳng tới địa chỉ bạn cấu hình, **không nằm trong file xuất đồng bộ**.
Lỗi AI (hết lượt, mất mạng…) thì extension tự quay về cách chấm miễn phí.

## Nhập từ hàng loạt (Quản lý → Nhập & đồng bộ)

**Thêm nhiều từ** — mỗi dòng một từ, cột nào không có thì để trống:

- Dạng ngắn: `cutover - quá trình cắt chuyển` (dùng `-`, `=` hoặc `:`).
- Dạng đầy đủ, cột cách nhau bằng `|` (hoặc Tab — dán thẳng từ Excel / Google Sheets):

  `Từ | Nghĩa | Loại từ | Phiên âm | Cách đọc | Câu ví dụ | Dịch câu ví dụ | Ghi chú`

  ```
  cutover | quá trình cắt chuyển | n | /ˈkʌtˌoʊvər/ | CẮT-âu-vơ | The final cutover is at midnight. | Chuyển đổi cuối lúc nửa đêm. | thuật ngữ IT
  impacts | ảnh hưởng, tác động | v
  ```
- Dòng đầu có thể là tiêu đề cột (vd `Từ | Nghĩa | Câu ví dụ`) — khi đó các cột xếp thứ tự nào cũng được, tiêu đề tiếng Việt hay tiếng Anh đều nhận.
- Ghi chú muốn xuống dòng thì gõ `\n`.
- Có cấu hình mô hình AI: tick **Dùng AI điền các cột còn trống** — AI chỉ điền ô bạn bỏ trống, dòng chỉ có từ tiếng Anh cũng được.

**File CSV:** bấm **Tải file mẫu (.csv)**, điền bằng Excel / Google Sheets rồi nhập ở **Nhập từ file**. **Xuất file CSV** để sửa hàng loạt bằng Excel rồi nhập lại.

**Bổ sung bằng AI:** điền loại từ, cách đọc, câu ví dụ cho các từ đã lưu còn thiếu (không sửa phần bạn đã nhập).

**Sửa từng từ:** bấm ✎ trong bảng Từ vựng để sửa đủ các trường; ô **Phiên âm** để trống thì dùng phiên âm từ điển, nhập vào thì ưu tiên phiên âm của bạn.

## Đồng bộ thủ công giữa các máy

**Quản lý → Nhập & đồng bộ** → **Xuất file JSON**, chép sang máy kia → **Nhập từ file**:
**Gộp** (từ trùng giữ bản sửa mới hơn) hoặc **Thay thế toàn bộ**.

## Lưu ý

- Dữ liệu nằm trong bộ nhớ local của extension. **Gỡ extension là mất dữ liệu** → nhớ xuất file định kỳ.
- Khóa không hiện ở trang hệ thống (`edge://…`, tab mới, cửa hàng tiện ích, trình xem PDF) — mở trang web bất kỳ là thấy.
- Đây là “khóa mềm”: tắt extension là thoát được. Đừng ăn gian nha 😅

## Cấu trúc

| File | Vai trò |
|---|---|
| `manifest.json` | Khai báo extension (Manifest V3) |
| `background.js` | Lịch hỏi, chọn kiểu câu hỏi, lưu từ, thống kê, phát âm, gọi mô hình AI (3 định dạng API) / Deepgram |
| `content.js` | Màn hình khóa + hộp lưu từ trên trang (giao diện kiểu Atlassian, shadow DOM) |
| `offscreen.*` | Trang ẩn: phát audio + thu âm micro (tránh bị CSP/quyền của Facebook chặn) |
| `common.js` | Hàm dùng chung: chấm đáp án, chuẩn hoá, bộ icon… |
| `popup.*` | Popup khi bấm icon |
| `options.*` | Trang quản lý: Từ vựng · Cài đặt chung · AI & giọng nói · Nhập & đồng bộ |
| `ui-select.js` | Dropdown & ô chọn model kiểu Atlassian (thay select/datalist mặc định của trình duyệt) |
| `ui.css` | Token màu & component theo Atlassian Design System (sáng/tối) |
