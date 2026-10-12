# UGLab 2.1.1 — Auto-Jawab Soal Praktikum Gunadarma

Ekstensi Chrome yang membaca soal praktikum di iLab / v-class Gunadarma (Moodle), Google Colab, dan Jupyter, mengirimnya ke AI, lalu mengisi jawabannya otomatis.

Dua cara memakai AI:

| Mode | AI yang dipakai | Perlu |
|------|-----------------|-------|
| **API Mode** | Endpoint OpenAI-compatible milik Anda sendiri | Endpoint, API Key, Model |
| **Web Mode** | Gemini, ChatGPT, atau Claude lewat tab browser | Login ke akun AI tersebut |

---

## Fitur baru di versi 2.1.1

**API Mode**
- Endpoint, API Key, dan Model diisi sendiri (contoh endpoint: `https://api.zrouter.dev/v1/`). Tidak ada lagi provider atau model yang di-hardcode.
- Tombol **Simpan Credentials** dengan transisi halus ke tampilan "Credentials Tersimpan", dan tombol **Ubah Credentials** untuk mengganti endpoint, key, atau model.
- API Mode terkunci sampai credentials disimpan. Chrome meminta izin akses ke endpoint saat Anda menyimpan.
- Prompt tidak lagi terpotong diam-diam: petunjuk modul tidak diulang di setiap soal, sehingga notebook dengan banyak soal terkirim utuh.

**Google Colab dan Jupyter**
- Semua soal terisi sekali jalan, termasuk cell yang berada jauh di bawah layar (di JupyterLab/Notebook 7 jawaban ditulis lewat model notebook, bukan DOM).
- Jupyter online dengan kernel Pyodide: pustaka yang tidak disediakan kernel (misalnya `seaborn`) dipasang otomatis tanpa menulis kode ke cell. Pustaka yang sudah terpasang tidak disentuh.
- `pd.read_csv("https://...")` dan `requests` bekerja di Pyodide.
- Jawaban berupa penjelasan (cell `# ...`) otomatis dijadikan komentar, bukan teks mentah.

**Soal koding Moodle (CodeRunner)**
- Template dibaca utuh dari editor, jadi kode tidak terpotong di tengah.
- Jawaban dimasukkan ke editor Ace/CodeMirror meski situs memblokir skrip inline.
- Kode pengujian dari soal tidak disalin ke jawaban (menghindari output ganda), dan baris header UI seperti `Python` / `Run` dibuang.

**Web Mode**
- Satu prompt berisi semua soal, jawaban diambil sekali, tanpa membuka tab berulang kali.
- Prompt tidak terkirim dua kali, dan tombol Stop tidak lagi tertekan saat AI sedang menjawab.
- Gambar soal ditempel ke chat AI sebagai PNG.

**Tampilan**
- Ikon garis bergaya SF Symbols menggantikan emoji.

---

## Cara Install

1. Buka Chrome, ke `chrome://extensions/`.
2. Aktifkan **Developer Mode** (pojok kanan atas).
3. Klik **Load unpacked**.
4. Pilih folder proyek ini (folder yang berisi `manifest.json`).
5. Setelah memperbarui kode, klik tombol reload pada kartu UGLab, lalu muat ulang halaman soal.

---

## Cara Pakai API Mode

1. Buka halaman soal (iLab, v-class, Colab, atau Jupyter) lalu klik ikon **UGLab** di toolbar.
2. Pilih **API Mode**.
3. Isi tiga kolom:
   - **Endpoint**: alamat dasar API yang kompatibel dengan OpenAI, diawali `http://` atau `https://`. Ekstensi memanggil `{endpoint}/chat/completions`.
   - **API Key**: boleh lebih dari satu, dipisahkan koma, untuk rotasi saat terkena rate limit.
   - **Model**: nama model persis seperti di penyedia API Anda (contoh `gpt-4o-mini`). Kolom ini wajib.
4. Klik **Simpan Credentials**. Chrome menampilkan dialog izin akses ke endpoint; pilih **Allow**. Box berubah menjadi "Credentials Tersimpan".
5. Klik **Mulai Auto-Jawab**. Soal terdeteksi, dikirim ke endpoint, dan jawaban diisi otomatis.
6. Untuk mengganti credentials, klik **Ubah Credentials**, ubah isiannya, lalu simpan lagi.

Catatan:
- Credentials disimpan di `chrome.storage.local` pada profil Chrome Anda sendiri. Tidak ada di folder proyek, tidak ikut ter-clone atau ter-zip, dan tidak tersinkron ke perangkat lain.
- Jangan menaruh key di README, issue, atau file apa pun di repo.
- Soal bergambar hanya bisa dijawab kalau model yang Anda pilih mendukung gambar.
- Pakai endpoint `https://`; dengan `http://` key dikirim tanpa enkripsi.

---

## Cara Pakai Web Mode

1. Buka tab AI pilihan Anda dan **login** (`gemini.google.com`, `chatgpt.com`, atau `claude.ai`).
2. Buka halaman soal lalu klik ikon **UGLab**.
3. Pilih **Web Mode** dan engine yang diinginkan (Gemini, ChatGPT, atau Claude).
4. (Opsional) Tulis instruksi tambahan, misalnya "Jawab dalam bahasa Indonesia".
5. Klik **Mulai Auto-Jawab**. Tab AI terbuka sendiri, semua soal dikirim dalam satu prompt, jawabannya dibaca, lalu diisi ke halaman soal. Tab AI ditutup otomatis setelah selesai.
6. Web Mode tidak memerlukan API Key.

---

## Tipe Soal yang Didukung

| Tipe | Keterangan |
|------|------------|
| Pilihan ganda, Benar/Salah | Klik opsi yang dipilih |
| Multi-select | Centang semua jawaban yang benar |
| Isian singkat, multi-kotak, menjodohkan | Input dan dropdown diisi |
| Essay | Textarea / editor Moodle |
| Koding (CodeRunner) | Ace dan CodeMirror |
| Notebook | Google Colab dan Jupyter (cell dengan `# CODE HERE`, `<...>`, atau `# ...`) |

URL target: `praktikum.gunadarma.ac.id`, `v-class.gunadarma.ac.id`, `elearning.gunadarma.ac.id`, `ujian.gunadarma.ac.id`, `colab.research.google.com`, `jupyter.org`, dan `localhost`.

---

## Arsitektur

```
Popup (popup.html / popup.js)
   │  scan soal, PRELAB_START
   ▼
Background service worker (src/background.js) ── API Mode ──► endpoint /chat/completions
   │  Web Mode: buka / pakai tab AI
   ▼
AI Injector (src/ai-injector.js): isi prompt, tunggu jawaban, ekstrak JSON
   │  GEMINI_DONE
   ▼
Background ── jawaban ──► halaman soal
                          • Moodle: src/lms-content.js
                          • Colab / Jupyter: src/notebook-content.js, src/jupyter-expose.js
```

---

## Troubleshooting

**Soal tidak terdeteksi?** Pastikan halaman sudah dimuat penuh, klik **Scan Ulang Soal**, dan pastikan halamannya kuis atau notebook yang aktif.

**API Mode tidak jalan?** Pastikan status "Credentials Tersimpan" dan dialog izin sudah di-Allow. Kalau muncul `Failed to fetch`, simpan ulang credentials; kalau muncul `API 401`, key atau model salah.

**AI tidak merespon di Web Mode?** Pastikan sudah login, coba muat ulang tab AI, dan cek koneksi.

**Hanya sebagian soal terisi?** Klik **Scan Ulang Soal**, lalu ulangi. Kalau memakai API Mode, pastikan model Anda mampu menjawab semua soal sekaligus.

**Jupyter: `ModuleNotFoundError` atau `Host is unreachable`?** Muat ulang tab notebook setelah memperbarui ekstensi supaya instalasi pustaka otomatis aktif.

---

## Catatan

- Ekstensi ini untuk tujuan edukasi dan latihan.
- Selalu periksa jawaban sebelum submit.
- Gunakan secara bertanggung jawab.

---

*UGLab v2.1.1 — Made for Gunadarma Students*
