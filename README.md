# ⚡ UGLab — Auto-Jawab Soal Praktikum Gunadarma

Auto-jawab soal praktikum iLab & v-class Gunadarma menggunakan AI (Gemini, ChatGPT).

---

## 🚀 Cara Install

1. Buka Chrome → `chrome://extensions/`
2. Aktifkan **Developer Mode** (pojok kanan atas)
3. Klik **"Load unpacked"**
4. Pilih folder `prelab/` ini
5. Ekstensi siap digunakan!

---

## 📋 Cara Pakai

1. **Login ke AI pilihan Anda** (mis. `gemini.google.com` atau `chatgpt.com`)
2. **Buka halaman kuis/soal** di iLab atau v-class Gunadarma
3. Klik ikon **UGLab ⚡** di toolbar Chrome
4. Popup akan otomatis mendeteksi soal di halaman
5. (Opsional) Tulis instruksi tambahan di textarea
6. Klik **"Mulai Auto-Jawab"**
7. Tab AI akan terbuka otomatis, soal dikirim, dan jawaban diisi!

---

## 🎯 Tipe Soal yang Didukung

| Tipe | Deskripsi |
|------|-----------|
| **Pilihan Ganda** | Radio button, otomatis klik opsi yang benar |
| **True/False** | Pilih Benar atau Salah |
| **Multi-Select** | Checkbox, centang semua jawaban yang benar |
| **Isian Singkat** | Input text, otomatis diisi |
| **Essay** | Textarea / Atto editor Moodle |
| **Coding** | Mendukung CodeMirror & Ace Editor |
| **Multi-Kotak** | Isi beberapa input text sekaligus |

---

## 🔧 Arsitektur

```
┌─────────────────┐     scrape soal      ┌──────────────────┐
│   Popup UI      │ ──────────────────► │  LMS Content     │
│  (popup.html)   │                      │  Script          │
└────────┬────────┘                      │  (lms-content.js)│
         │ PRELAB_START                  └────────┬─────────┘
         ▼                                        │ PRELAB_ANSWERS
┌─────────────────┐    open/relay        ┌────────▼─────────┐
│   Background    │ ──────────────────► │  AI Tab          │
│  Service Worker │ ◄────────────────── │  Injector        │
│  (background.js)│     AI_RESULT        │  (ai-injector.js)│
└─────────────────┘                      └──────────────────┘
```

**Flow:**
1. Popup → Background: kirim payload soal
2. Background: buka tab AI baru (atau reuse)
3. AI Injector: deteksi payload pending, inject prompt ke AI
4. AI Injector: tunggu streaming selesai, extract JSON
5. Background: relay jawaban ke tab LMS
6. LMS Content Script: isi jawaban ke form

---

## ⚙️ Konfigurasi & Mode Eksekusi

### 1. API Mode (Fast)
Menggunakan API SambaNova / Groq Cloud secara langsung.
1. Buka popup ekstensi UGLab.
2. Pilih **API Mode**.
3. Masukkan **SambaNova API Key** Anda pada input box (bisa didapatkan gratis di [SambaNova Cloud](https://cloud.sambanova.ai/)).
4. Key akan disimpan secara lokal dan aman di browser (`chrome.storage.local`), tidak akan pernah ter-commit ke git.
5. Anda dapat memasukkan beberapa key yang dipisahkan dengan koma jika ingin menggunakan rotasi rate-limit.

### 2. Web Mode (Visual)
Menggunakan antarmuka web AI (Gemini Web, ChatGPT Web, atau Claude Web) secara otomatis tanpa memerlukan API Key.
1. Pilih **Web Mode** di popup UGLab.
2. Pilih engine yang diinginkan (Gemini, ChatGPT, Claude).
3. Pastikan Anda telah login ke akun AI tersebut pada browser.

### 3. URL Target LMS
- **iLab** (Moodle-based): `https://ilab.gunadarma.ac.id/*`
- **v-class**: `https://v-class.gunadarma.ac.id/*`
- **Ujian Online**: `https://ujian.gunadarma.ac.id/*`

---

## 🔍 Troubleshooting

**Soal tidak terdeteksi?**
- Pastikan halaman sudah dimuat penuh
- Klik "Scan Ulang Soal" di popup
- Cek apakah halaman adalah halaman kuis aktif

**AI tidak merespon?**
- Pastikan sudah login ke penyedia AI yang dipilih
- Coba refresh tab AI
- Cek koneksi internet

**Jawaban tidak terisi?**
- Beberapa soal mungkin menggunakan format yang berbeda
- Coba tambahkan instruksi di textarea "Instruksi Tambahan"

---

## 📝 Catatan

- Ekstensi ini untuk tujuan edukasi dan latihan
- Selalu verifikasi jawaban sebelum submit
- Gunakan secara bertanggung jawab

---

*UGLab v1.0 — Made for Gunadarma Students*
