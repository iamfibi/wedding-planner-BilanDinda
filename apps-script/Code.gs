/**
 * Wedding Planner — penghubung antara web (GitHub Pages) dan Google Sheets.
 *
 * Cara pakai singkat (panduan lengkap ada di PANDUAN.md):
 * 1. Ganti PIN di bawah dengan PIN rahasia Anda.
 * 2. Klik Deploy > New deployment > Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 3. Salin URL web app ke file config.js di web.
 *
 * Saat memperbarui kode ini: tempel kode baru, isi lagi PIN Anda,
 * lalu Deploy > Manage deployments > Edit > Version: New version > Deploy.
 */

// GANTI PIN INI. Jangan pakai tanggal lahir atau tanggal nikah.
const PIN = 'ganti-pin-ini';

const SHEETS = {
  Pengaturan: ['kunci', 'nilai'],
  Pocket: ['id', 'nama', 'satuan', 'nilai_sekarang', 'tgl_nilai', 'catatan'],
  // jenis: setor | tarik | pindah. kantong = pocket asal/tujuan, ke = pocket tujuan (khusus pindah).
  Tabungan: ['id', 'tanggal', 'oleh', 'jenis', 'jumlah', 'catatan', 'kantong', 'ke', 'gram'],
  Anggaran: ['id', 'kategori', 'item', 'vendor', 'estimasi', 'harga_deal', 'jatuh_tempo', 'catatan'],
  Pembayaran: ['id', 'item_id', 'tanggal', 'jumlah', 'catatan', 'kantong'],
};

// Kolom yang disimpan sebagai teks agar Google Sheets tidak mengubahnya jadi angka/tanggal.
const TEXT_COLUMNS = ['id', 'item_id', 'kantong', 'ke', 'oleh', 'jenis', 'catatan', 'kategori', 'item', 'vendor', 'nama', 'satuan', 'kunci'];

const SCHEMA_VERSION = '2';

const DEFAULT_SETTINGS = {
  nama1: 'Bilan',
  nama2: 'Dinda',
  tanggal_nikah: '',
  target_tabungan: 0,
};

const DEFAULT_POCKETS = [
  ['Valas MyBCA', ''],
  ['Reksadana', ''],
  ['Logam Mulia', 'gram'],
  ['Perhiasan', 'gram'],
];

// Item awal diambil dari sheet "Tracking" pada template.
const SEED_ITEMS = {
  'Lamaran': ['Dekorasi', 'Catering', 'Snack', 'Fotografi', 'MUA', 'Busana lamaran', 'Cincin', 'Seserahan'],
  'Pre-Wedding': ['Fotografi', 'Busana', 'MUA', 'Sewa studio', 'Konsumsi'],
  'Administrasi': ['Pre-marital check up', 'Vaksin (Puskesmas)', 'Pas foto', 'Dukcapil', 'Gereja'],
  'Resepsi': ['Wedding Organizer', 'Venue', 'Catering / FnB', 'Foto & video', 'Dekorasi', 'MC', 'Entertainment', 'Photobox'],
  'Busana & MUA': ['Busana pengantin wanita', 'Busana pengantin pria', 'Sepatu', 'MUA pengantin', 'Busana keluarga', 'MUA keluarga'],
  'Undangan & Souvenir': ['Undangan cetak', 'Undangan digital', 'Souvenir', 'Bridesmaid box'],
  'Transport & Akomodasi': ['Transport persiapan', 'Penginapan keluarga', 'Mobil pengantin', 'Mobil keluarga'],
};

function doGet(e) {
  return json_({ ok: true, message: 'Wedding Planner API aktif.', versi: SCHEMA_VERSION });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Permintaan tidak valid.' });
  }
  if (String(req.pin || '') !== String(PIN)) {
    return json_({ ok: false, error: 'PIN salah.' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    setup_();
    switch (req.action) {
      case 'getAll':
        break;
      case 'save':
        saveRow_(req.sheet, req.row || {});
        break;
      case 'delete':
        deleteRow_(req.sheet, req.id);
        break;
      case 'saveSettings':
        saveSettings_(req.settings || {});
        break;
      default:
        return json_({ ok: false, error: 'Aksi tidak dikenal.' });
    }
    return json_({ ok: true, data: getAll_() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/** Membuat sheet yang belum ada dan memperbarui struktur lama. Dipanggil otomatis di setiap permintaan. */
function setup_() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  const upgrade = props.getProperty('schema') !== SCHEMA_VERSION;

  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
      setTextFormats_(sh);
      if (name === 'Pengaturan') {
        const rows = Object.keys(DEFAULT_SETTINGS).map(function (k) { return [k, DEFAULT_SETTINGS[k]]; });
        sh.getRange(2, 1, rows.length, 2).setValues(rows);
      }
      if (name === 'Pocket') {
        const rows = DEFAULT_POCKETS.map(function (p) { return [newId_(), p[0], p[1], '', '', '']; });
        sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
      }
      if (name === 'Anggaran') {
        const rows = [];
        Object.keys(SEED_ITEMS).forEach(function (kat) {
          SEED_ITEMS[kat].forEach(function (item) {
            rows.push([newId_(), kat, item, '', 0, '', '', '']);
          });
        });
        sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
      }
    } else if (upgrade) {
      ensureHeaders_(sh, SHEETS[name]);
      setTextFormats_(sh);
    }
  });

  if (upgrade) {
    migrateToPockets_();
    props.setProperty('schema', SCHEMA_VERSION);
  }
}

/** Menambahkan kolom baru yang belum ada di sheet lama (di ujung kanan). */
function ensureHeaders_(sh, wanted) {
  const lastCol = Math.max(1, sh.getLastColumn());
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const missing = wanted.filter(function (h) { return headers.indexOf(h) === -1; });
  if (missing.length) {
    const start = headers.filter(String).length + 1;
    sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
}

function setTextFormats_(sh) {
  const headers = headerRow_(sh);
  const rows = Math.max(1, sh.getMaxRows() - 1);
  headers.forEach(function (h, i) {
    if (TEXT_COLUMNS.indexOf(h) !== -1) sh.getRange(2, i + 1, rows, 1).setNumberFormat('@');
  });
}

/** Catatan lama (sebelum ada pocket) dimasukkan ke pocket pertama (Valas MyBCA). */
function migrateToPockets_() {
  const pockets = readSheet_('Pocket');
  if (!pockets.length) return;
  const defaultId = String(pockets[0].id);
  fillEmpty_('Tabungan', 'kantong', defaultId);
  fillEmpty_('Tabungan', 'jenis', 'setor');
  fillEmpty_('Pembayaran', 'kantong', defaultId);
}

function fillEmpty_(sheetName, column, value) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  const last = sh.getLastRow();
  if (last < 2) return;
  const col = headerRow_(sh).indexOf(column) + 1;
  if (!col) return;
  const range = sh.getRange(2, col, last - 1, 1);
  const values = range.getValues().map(function (r) { return [r[0] === '' ? value : r[0]]; });
  range.setValues(values);
}

function getAll_() {
  const out = {};
  Object.keys(SHEETS).forEach(function (name) {
    if (name !== 'Pengaturan') out[name] = readSheet_(name);
  });
  const settings = Object.assign({}, DEFAULT_SETTINGS);
  readSheet_('Pengaturan').forEach(function (r) { settings[r.kunci] = r.nilai; });
  out.Pengaturan = settings;
  return out;
}

function headerRow_(sh) {
  return sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
}

function readSheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  const values = sh.getDataRange().getValues();
  const headers = values.shift().map(String);
  const tz = Session.getScriptTimeZone();
  return values
    .filter(function (r) { return r.some(function (v) { return v !== ''; }); })
    .map(function (r) {
      const obj = {};
      headers.forEach(function (h, i) {
        if (!h) return;
        let v = r[i];
        if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        obj[h] = v;
      });
      return obj;
    });
}

function saveRow_(name, row) {
  if (!SHEETS[name] || name === 'Pengaturan') throw new Error('Sheet tidak dikenal.');
  const allowed = SHEETS[name];
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  const headers = headerRow_(sh);
  if (!row.id) row.id = newId_();
  const rowIndex = findRow_(sh, row.id);
  const existing = rowIndex ? sh.getRange(rowIndex, 1, 1, headers.length).getValues()[0] : [];
  // Kolom ditulis sesuai posisi header di sheet; kolom tambahan buatan sendiri tidak disentuh.
  const values = headers.map(function (h, i) {
    if (allowed.indexOf(h) === -1) return existing[i] === undefined ? '' : existing[i];
    return row[h] === undefined || row[h] === null ? '' : row[h];
  });
  if (rowIndex) {
    sh.getRange(rowIndex, 1, 1, values.length).setValues([values]);
  } else {
    sh.appendRow(values);
  }
}

function deleteRow_(name, id) {
  if (!SHEETS[name] || name === 'Pengaturan') throw new Error('Sheet tidak dikenal.');
  if (name === 'Pocket' && pocketInUse_(id)) {
    throw new Error('Pocket ini masih punya catatan transaksi. Hapus atau pindahkan catatannya dulu.');
  }
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  const rowIndex = findRow_(sh, id);
  if (rowIndex) sh.deleteRow(rowIndex);
  // Menghapus item anggaran juga menghapus semua pembayarannya.
  if (name === 'Anggaran') {
    const pay = SpreadsheetApp.getActive().getSheetByName('Pembayaran');
    const col = headerRow_(pay).indexOf('item_id');
    const rows = pay.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][col]) === String(id)) pay.deleteRow(i + 1);
    }
  }
}

function pocketInUse_(id) {
  const sid = String(id);
  const used = function (r) { return String(r.kantong) === sid || String(r.ke) === sid; };
  return readSheet_('Tabungan').some(used) || readSheet_('Pembayaran').some(used);
}

function saveSettings_(settings) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Pengaturan');
  const values = sh.getDataRange().getValues();
  Object.keys(settings).forEach(function (k) {
    if (!(k in DEFAULT_SETTINGS)) return;
    let found = false;
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === k) {
        sh.getRange(i + 1, 2).setValue(settings[k]);
        found = true;
        break;
      }
    }
    if (!found) sh.appendRow([k, settings[k]]);
  });
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(1, 1, last, 1).getValues();
  for (let i = 1; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 1;
  }
  return 0;
}

// Diawali huruf agar tidak pernah dibaca Google Sheets sebagai angka.
function newId_() {
  return 'r' + Utilities.getUuid().slice(0, 8);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
