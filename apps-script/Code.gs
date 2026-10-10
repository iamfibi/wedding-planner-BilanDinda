/**
 * Wedding Planner — penghubung antara web (GitHub Pages) dan Google Sheets.
 *
 * Cara pakai singkat (panduan lengkap ada di PANDUAN.md):
 * 1. Ganti PIN di bawah dengan PIN rahasia Anda.
 * 2. Klik Deploy > New deployment > Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 3. Salin URL web app ke file config.js di web.
 */

// GANTI PIN INI. Jangan pakai tanggal lahir atau tanggal nikah.
const PIN = 'ganti-pin-ini';

const SHEETS = {
  Pengaturan: ['kunci', 'nilai'],
  Tabungan: ['id', 'tanggal', 'oleh', 'jenis', 'jumlah', 'catatan'],
  Anggaran: ['id', 'kategori', 'item', 'vendor', 'estimasi', 'harga_deal', 'jatuh_tempo', 'catatan'],
  Pembayaran: ['id', 'item_id', 'tanggal', 'jumlah', 'catatan'],
};

const DEFAULT_SETTINGS = {
  nama1: 'Bilan',
  nama2: 'Dinda',
  tanggal_nikah: '',
  target_tabungan: 0,
};

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
  return json_({ ok: true, message: 'Wedding Planner API aktif.' });
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
        saveRow_(req.sheet, req.row);
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

/** Membuat sheet yang belum ada. Dipanggil otomatis di setiap permintaan. */
function setup_() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
      if (name === 'Pengaturan') {
        const rows = Object.keys(DEFAULT_SETTINGS).map(function (k) { return [k, DEFAULT_SETTINGS[k]]; });
        sh.getRange(2, 1, rows.length, 2).setValues(rows);
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
    }
  });
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

function readSheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  const values = sh.getDataRange().getValues();
  const headers = values.shift();
  const tz = Session.getScriptTimeZone();
  return values
    .filter(function (r) { return r.some(function (v) { return v !== ''; }); })
    .map(function (r) {
      const obj = {};
      headers.forEach(function (h, i) {
        let v = r[i];
        if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        obj[h] = v;
      });
      return obj;
    });
}

function saveRow_(name, row) {
  if (!SHEETS[name] || name === 'Pengaturan') throw new Error('Sheet tidak dikenal.');
  const headers = SHEETS[name];
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!row.id) row.id = newId_();
  const values = headers.map(function (h) { return row[h] === undefined ? '' : row[h]; });
  const rowIndex = findRow_(sh, row.id);
  if (rowIndex) {
    sh.getRange(rowIndex, 1, 1, values.length).setValues([values]);
  } else {
    sh.appendRow(values);
  }
}

function deleteRow_(name, id) {
  if (!SHEETS[name] || name === 'Pengaturan') throw new Error('Sheet tidak dikenal.');
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  const rowIndex = findRow_(sh, id);
  if (rowIndex) sh.deleteRow(rowIndex);
  // Menghapus item anggaran juga menghapus semua pembayarannya.
  if (name === 'Anggaran') {
    const pay = SpreadsheetApp.getActive().getSheetByName('Pembayaran');
    const ids = pay.getDataRange().getValues();
    for (let i = ids.length - 1; i >= 1; i--) {
      if (String(ids[i][1]) === String(id)) pay.deleteRow(i + 1);
    }
  }
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
  const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (let i = 1; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 1;
  }
  return 0;
}

function newId_() {
  return Utilities.getUuid().slice(0, 8);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
