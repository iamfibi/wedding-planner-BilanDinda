# Panduan Setup Wedding Planner

Setup ini cukup dilakukan **sekali**, sekitar 20–30 menit. Setelah selesai, Anda dan pasangan cukup membuka satu link dari HP atau laptop mana pun.

Ringkasnya ada 3 bagian:

| Bagian | Fungsi | Perumpamaan |
|---|---|---|
| A. Google Sheets + Apps Script | Tempat menyimpan data | Buku catatan |
| B. config.js | Menghubungkan web ke buku catatan | Alamat buku catatan |
| C. GitHub Pages | Menampilkan web di internet | Etalase |

---

## A. Siapkan Google Sheets (tempat data)

### 1. Buat spreadsheet baru
1. Buka **https://sheets.new** (login dengan akun Google Anda).
2. Klik judul "Untitled spreadsheet" di kiri atas, lalu ganti menjadi **Wedding Planner Data**.

> Spreadsheet ini tidak perlu diisi apa-apa. Sheet *Tabungan*, *Anggaran*, *Pembayaran*, dan *Pengaturan* akan dibuat otomatis, lengkap dengan daftar item anggaran dari template.

### 2. Pasang script
1. Di menu atas, klik **Extensions → Apps Script** (dalam bahasa Indonesia: **Ekstensi → Apps Script**).
2. Akan terbuka tab baru berisi kode `function myFunction() {...}`. **Hapus semua** kode itu.
3. Buka file `apps-script/Code.gs` dari folder ini, salin **seluruh** isinya, lalu tempel ke editor Apps Script.
4. Cari baris ini di bagian atas:
   ```js
   const PIN = 'ganti-pin-ini';
   ```
   Ganti `ganti-pin-ini` dengan PIN rahasia Anda, misalnya `'melati2027!'`.
   - Minimal 6 karakter. Gabungan huruf dan angka lebih aman.
   - Jangan pakai tanggal lahir atau tanggal nikah.
   - PIN inilah yang dipakai Anda dan pasangan untuk masuk ke web.
5. Klik ikon **💾 Save** (atau tekan Ctrl+S).

### 3. Deploy (aktifkan) script
1. Klik tombol biru **Deploy → New deployment** di kanan atas.
2. Klik ikon ⚙️ di sebelah "Select type", lalu pilih **Web app**.
3. Isi:
   - **Description:** `Wedding Planner`
   - **Execute as:** **Me** (email Anda)
   - **Who has access:** **Anyone**
4. Klik **Deploy**.
5. Google akan meminta izin:
   1. Klik **Authorize access**, lalu pilih akun Google Anda.
   2. Akan muncul peringatan *"Google hasn't verified this app"*. Ini normal, karena script-nya buatan Anda sendiri, bukan aplikasi dari Play Store.
   3. Klik **Advanced** → **Go to Wedding Planner (unsafe)** → **Allow**.
6. Salin **Web app URL** yang muncul. Bentuknya seperti:
   ```
   https://script.google.com/macros/s/AKfycb.................../exec
   ```

> **Kenapa "Anyone"?** Supaya web bisa mengirim data ke script ini. Tetap aman: tanpa PIN yang benar, script menolak semua permintaan, dan isi spreadsheet tetap hanya bisa dibuka oleh Anda.

### 4. Tes
Tempel URL tadi di browser. Kalau muncul tulisan seperti ini, berarti sudah berhasil:
```
{"ok":true,"message":"Wedding Planner API aktif."}
```

---

## B. Hubungkan web ke Google Sheets

Buka file `config.js`, lalu tempel URL dari langkah A.3 di antara tanda kutip:

```js
window.CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycb.../exec',
};
```

Simpan file. (Kalau Anda memakai Claude, cukup kirim URL-nya dan Claude yang mengisinya.)

---

## C. Upload ke GitHub dan nyalakan hosting

### 1. Buat repository
1. Buka **https://github.com/new** (login sebagai `iamfibi`).
2. **Repository name:** `wedding-planner-BilanDinda`
3. Pilih **Public**. GitHub Pages gratis hanya untuk repo publik.
   > Tidak masalah: yang terlihat publik hanya kode tampilan. Data keuangan Anda ada di Google Sheets dan dilindungi PIN.
4. Jangan centang apa pun di bawahnya. Klik **Create repository**.

### 2. Upload file
Pilih salah satu cara:

- **Cara mudah (lewat browser):** di halaman repo yang baru dibuat, klik link **"uploading an existing file"**. Seret (drag) file `index.html`, `style.css`, `app.js`, `config.js`, `PANDUAN.md`, dan folder `apps-script` ke halaman tersebut, lalu klik **Commit changes**.
- **Lewat Claude:** minta Claude untuk "push ke GitHub". Akan muncul jendela login GitHub sekali di komputer Anda.

### 3. Nyalakan GitHub Pages
1. Di repo, klik **Settings** → menu kiri **Pages**.
2. Di bagian **Build and deployment**:
   - **Source:** Deploy from a branch
   - **Branch:** `main`, folder `/ (root)`, lalu klik **Save**
3. Tunggu 1–2 menit, lalu refresh halaman. Akan muncul alamat web Anda:
   ```
   https://iamfibi.github.io/wedding-planner-BilanDinda/
   ```

---

## D. Mulai pakai

1. Buka **https://iamfibi.github.io/wedding-planner-BilanDinda/** dan masukkan PIN.
2. Buka tab **Pengaturan**, isi nama Anda, nama pasangan, tanggal pernikahan, dan (opsional) target tabungan.
3. Kirim link dan PIN ke pasangan Anda lewat chat pribadi.
4. **Tambahkan ke layar utama HP** supaya terasa seperti aplikasi:
   - **Android (Chrome):** menu ⋮ → *Add to Home screen*
   - **iPhone (Safari):** tombol Share → *Add to Home Screen*

### Cara pakai sehari-hari
- **Menabung:** tab **Tabungan** → *+ Catat tabungan* → pilih siapa yang menyetor → isi jumlah.
- **Isi harga vendor:** tab **Anggaran** → klik item → isi *Estimasi* atau *Harga deal* → *Simpan*.
- **Bayar DP/cicilan:** klik item di **Anggaran** → di bagian *Pembayaran*, isi jumlah → *+ Catat pembayaran*.
- **Lihat kondisi keuangan:** tab **Ringkasan** menampilkan saldo, sisa tagihan, kekurangan dana, dan berapa yang perlu ditabung per bulan.

Data otomatis diperbarui setiap kali aplikasi dibuka. Tekan tombol ⟳ di kanan atas untuk memuat ulang secara manual.

---

## Pertanyaan umum

**Lupa PIN?**
Buka spreadsheet → Extensions → Apps Script. PIN ada di baris `const PIN = ...`.

**Mau ganti PIN?**
Ubah baris PIN di Apps Script → Save → **Deploy → Manage deployments** → klik ✏️ → *Version*: **New version** → **Deploy**. URL tidak berubah.

**Kalau saya mengubah `Code.gs` lagi?**
Sama seperti di atas: setelah menyimpan, lakukan **Manage deployments → New version**. Tanpa langkah ini, perubahan belum aktif.

**Bisa lihat atau edit data langsung di spreadsheet?**
Bisa. Semua data ada di sheet *Tabungan*, *Anggaran*, dan *Pembayaran*. Kolom `oleh` di sheet *Tabungan* berisi `p1` (Anda), `p2` (pasangan), atau `keluarga`. Jangan ubah kolom `id`.

**Ada cadangan (backup)?**
Google Sheets otomatis menyimpan riwayat versi: **File → Version history**.

**Apakah pasangan perlu akun Google atau GitHub?**
Tidak. Cukup link web dan PIN.
