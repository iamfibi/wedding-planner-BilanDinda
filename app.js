'use strict';

/* =========================================================
 * Wedding Planner — fokus keuangan
 * Data disimpan di Google Sheets lewat Apps Script (lihat apps-script/Code.gs).
 * Tanpa API_URL, web berjalan dalam mode coba dengan localStorage.
 * ========================================================= */

const CFG = window.CONFIG || {};
const DEMO = !CFG.API_URL;

const TABS = ['ringkasan', 'tabungan', 'anggaran', 'pengaturan'];

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } },
};

const state = {
  pin: store.get('wp_pin'),
  data: null,
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : (store.get('wp_tab') || 'ringkasan'),
  filter: 'semua',
  pocketFilter: 'semua',
  openCats: store.get('wp_open_cats') || {},
  busy: 0,
  loud: 0,
};

const PEOPLE = ['p1', 'p2', 'keluarga'];
const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- Format ---------- */
const num = (v) => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const neg = /^\s*-/.test(String(v || ''));
  const d = String(v || '').replace(/[^\d]/g, '');
  return d ? Number(d) * (neg ? -1 : 1) : 0;
};
const rp = (n) => (n < 0 ? '−Rp\u00a0' : 'Rp\u00a0') + Math.round(Math.abs(num(n))).toLocaleString('id-ID');
const rpShort = (n) => {
  const a = Math.abs(n);
  const f = (x, s) => 'Rp\u00a0' + x.toLocaleString('id-ID', { maximumFractionDigits: 1 }) + s;
  if (a >= 1e9) return f(n / 1e9, ' M');
  if (a >= 1e6) return f(n / 1e6, ' jt');
  if (a >= 1e3) return f(Math.round(n / 1e3), ' rb');
  return rp(n);
};
const moneyInput = (n) => (num(n) ? num(n).toLocaleString('id-ID') : '');
// Angka desimal untuk gram (menerima "2,5" atau "2.5").
const dec = (v) => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v || '').replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
};
const fmtGram = (g) => g.toLocaleString('id-ID', { maximumFractionDigits: 3 }) + ' gr';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayStr = () => toISO(new Date());
const parseDate = (s) => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const fmtDate = (s) => {
  const d = parseDate(s);
  return d ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
};
const monthLabel = (key, long) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('id-ID', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
};
const uid = () => Math.random().toString(36).slice(2, 10);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

function personName(k) {
  const s = state.data.Pengaturan;
  if (k === 'p1') return s.nama1 || 'Saya';
  if (k === 'p2') return s.nama2 || 'Pasangan';
  return 'Keluarga';
}

function pocketById(id) {
  return state.data.Pocket.find((p) => p.id === String(id));
}
function pocketName(id) {
  const p = pocketById(id);
  return p ? p.nama : 'Tanpa pocket';
}
const isGram = (id) => { const p = pocketById(id); return !!p && p.satuan === 'gram'; };

/* ---------- Mode coba (localStorage) ---------- */
const SEED_ITEMS = {
  'Lamaran': ['Dekorasi', 'Catering', 'Snack', 'Fotografi', 'MUA', 'Busana lamaran', 'Cincin', 'Seserahan'],
  'Pre-Wedding': ['Fotografi', 'Busana', 'MUA', 'Sewa studio', 'Konsumsi'],
  'Administrasi': ['Pre-marital check up', 'Vaksin (Puskesmas)', 'Pas foto', 'Dukcapil', 'Gereja'],
  'Resepsi': ['Wedding Organizer', 'Venue', 'Catering / FnB', 'Foto & video', 'Dekorasi', 'MC', 'Entertainment', 'Photobox'],
  'Busana & MUA': ['Busana pengantin wanita', 'Busana pengantin pria', 'Sepatu', 'MUA pengantin', 'Busana keluarga', 'MUA keluarga'],
  'Undangan & Souvenir': ['Undangan cetak', 'Undangan digital', 'Souvenir', 'Bridesmaid box'],
  'Transport & Akomodasi': ['Transport persiapan', 'Penginapan keluarga', 'Mobil pengantin', 'Mobil keluarga'],
};

function defaultPockets() {
  return [['Valas MyBCA', ''], ['Reksadana', ''], ['Logam Mulia', 'gram'], ['Perhiasan', 'gram']]
    .map(([nama, satuan]) => ({ id: uid(), nama, satuan, nilai_sekarang: '', tgl_nilai: '', catatan: '' }));
}

function seedDemo(withSamples) {
  const now = new Date();
  const wedding = new Date(now.getFullYear(), now.getMonth() + 8, 14);
  const d = {
    Pengaturan: withSamples
      ? { nama1: 'Saya', nama2: 'Pasangan', tanggal_nikah: toISO(wedding), target_tabungan: 150000000 }
      : { nama1: 'Saya', nama2: 'Pasangan', tanggal_nikah: '', target_tabungan: 0 },
    Pocket: defaultPockets(),
    Tabungan: [],
    Anggaran: [],
    Pembayaran: [],
  };
  Object.keys(SEED_ITEMS).forEach((kat) => {
    SEED_ITEMS[kat].forEach((item) => {
      d.Anggaran.push({ id: uid(), kategori: kat, item, vendor: '', estimasi: 0, harga_deal: '', jatuh_tempo: '', catatan: '' });
    });
  });
  if (!withSamples) return d;

  const find = (kat, item) => d.Anggaran.find((a) => a.kategori === kat && a.item === item);
  const setItem = (kat, item, fields) => Object.assign(find(kat, item), fields);
  const monthAgo = (m, day) => toISO(new Date(now.getFullYear(), now.getMonth() - m, day));
  const ahead = (days) => toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));

  setItem('Resepsi', 'Venue', { vendor: 'Gedung Serbaguna', estimasi: 35000000, harga_deal: 32000000, jatuh_tempo: ahead(20) });
  setItem('Resepsi', 'Catering / FnB', { vendor: 'Catering Ibu Sari', estimasi: 45000000, jatuh_tempo: ahead(60) });
  setItem('Resepsi', 'Foto & video', { estimasi: 12000000, harga_deal: 13500000, vendor: 'Studio Lensa' });
  setItem('Resepsi', 'Wedding Organizer', { estimasi: 10000000 });
  setItem('Lamaran', 'Cincin', { estimasi: 8000000, harga_deal: 7600000, vendor: 'Toko Emas' });
  setItem('Lamaran', 'Catering', { estimasi: 3500000 });
  setItem('Administrasi', 'Pre-marital check up', { estimasi: 1101500, harga_deal: 1101500, vendor: 'RSA UGM' });
  setItem('Busana & MUA', 'MUA pengantin', { estimasi: 7000000 });

  const [valas, reksa, emas] = d.Pocket;
  const pay = (kat, item, jumlah, m, catatan) => d.Pembayaran.push({ id: uid(), item_id: find(kat, item).id, tanggal: monthAgo(m, 10), jumlah, catatan, kantong: valas.id });
  pay('Resepsi', 'Venue', 10000000, 2, 'DP');
  pay('Resepsi', 'Foto & video', 5000000, 1, 'DP');
  pay('Lamaran', 'Cincin', 7600000, 3, 'Lunas');
  pay('Administrasi', 'Pre-marital check up', 1101500, 1, '');

  const tx = (fields) => d.Tabungan.push(Object.assign({ id: uid(), oleh: '', ke: '', gram: '', catatan: '' }, fields));
  for (let m = 5; m >= 0; m--) {
    tx({ tanggal: monthAgo(m, 25), oleh: 'p1', jenis: 'setor', jumlah: 4000000 + (m % 2) * 1000000, catatan: 'Gaji', kantong: valas.id });
    tx({ tanggal: monthAgo(m, 26), oleh: 'p2', jenis: 'setor', jumlah: 3500000, catatan: 'Gaji', kantong: valas.id });
  }
  tx({ tanggal: monthAgo(2, 5), oleh: 'keluarga', jenis: 'setor', jumlah: 10000000, catatan: 'Bantuan orang tua', kantong: valas.id });
  tx({ tanggal: monthAgo(1, 15), oleh: 'p1', jenis: 'tarik', jumlah: 1500000, catatan: 'Keperluan mendadak', kantong: valas.id });
  tx({ tanggal: monthAgo(3, 2), jenis: 'pindah', jumlah: 8000000, catatan: 'Beli reksadana', kantong: valas.id, ke: reksa.id });
  tx({ tanggal: monthAgo(2, 20), jenis: 'pindah', jumlah: 6400000, gram: 4, catatan: 'Beli Antam 4 gr', kantong: valas.id, ke: emas.id });
  Object.assign(reksa, { nilai_sekarang: 8350000, tgl_nilai: monthAgo(0, 1) });
  Object.assign(emas, { nilai_sekarang: 6900000, tgl_nilai: monthAgo(0, 1) });
  return d;
}

const demo = {
  load() {
    let d = store.get('wp_demo');
    if (!d) { d = seedDemo(false); store.set('wp_demo', d); }
    if (!d.Pocket) {
      // Data mode coba versi lama: catatan lama masuk ke pocket pertama.
      d.Pocket = defaultPockets();
      d.Tabungan.forEach((t) => { if (!t.kantong) t.kantong = d.Pocket[0].id; });
      d.Pembayaran.forEach((p) => { if (!p.kantong) p.kantong = d.Pocket[0].id; });
      store.set('wp_demo', d);
    }
    return d;
  },
  handle(p) {
    const d = this.load();
    if (p.action === 'save') {
      const row = Object.assign({}, p.row);
      if (!row.id) row.id = uid();
      const list = d[p.sheet];
      const i = list.findIndex((r) => r.id === row.id);
      if (i >= 0) list[i] = row; else list.push(row);
    } else if (p.action === 'delete') {
      if (p.sheet === 'Pocket' && d.Tabungan.concat(d.Pembayaran).some((r) => r.kantong === p.id || r.ke === p.id)) {
        return Promise.reject(new Error('Pocket ini masih punya catatan transaksi. Hapus atau pindahkan catatannya dulu.'));
      }
      d[p.sheet] = d[p.sheet].filter((r) => r.id !== p.id);
      if (p.sheet === 'Anggaran') d.Pembayaran = d.Pembayaran.filter((r) => r.item_id !== p.id);
    } else if (p.action === 'saveSettings') {
      Object.assign(d.Pengaturan, p.settings);
    }
    store.set('wp_demo', d);
    return new Promise((resolve) => setTimeout(() => resolve(JSON.parse(JSON.stringify(d))), 120));
  },
};

/* ---------- API ---------- */
async function api(payload) {
  if (DEMO) return demo.handle(payload);
  let res;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    // Tanpa header Content-Type agar tidak memicu CORS preflight.
    res = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(Object.assign({}, payload, { pin: state.pin })), signal: ctrl.signal });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Koneksi terlalu lama. Coba lagi.' : 'Tidak bisa terhubung. Periksa koneksi internet.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error('Server error (' + res.status + ').');
  let json;
  try { json = await res.json(); } catch (e) { throw new Error('Balasan server tidak valid. Periksa URL di config.js.'); }
  if (!json.ok) throw new Error(json.error || 'Terjadi kesalahan.');
  return json.data;
}

const str = (v) => (v == null ? '' : String(v));

function normalize(d) {
  return {
    // Script Google versi lama belum mengirim Pocket.
    serverOld: !DEMO && !Array.isArray(d.Pocket),
    Pengaturan: Object.assign({ nama1: 'Saya', nama2: 'Pasangan', tanggal_nikah: '', target_tabungan: 0 }, d.Pengaturan || {}),
    Pocket: (d.Pocket || []).map((r) => Object.assign({}, r, { id: str(r.id), satuan: str(r.satuan), tgl_nilai: str(r.tgl_nilai) })),
    Tabungan: (d.Tabungan || []).map((r) => Object.assign({}, r, { id: str(r.id), kantong: str(r.kantong), ke: str(r.ke), jenis: str(r.jenis) || 'setor', tanggal: str(r.tanggal) })),
    Anggaran: (d.Anggaran || []).map((r) => Object.assign({}, r, { id: str(r.id) })),
    Pembayaran: (d.Pembayaran || []).map((r) => Object.assign({}, r, { id: str(r.id), item_id: str(r.item_id), kantong: str(r.kantong), tanggal: str(r.tanggal) })),
  };
}

function setData(d) {
  state.data = normalize(d);
  if (!DEMO) store.set('wp_cache', d);
  render();
}

// quiet: pembaruan di latar belakang, hanya ikon ⟳ yang berputar (tanpa bar loading).
async function sync(payload, okMsg, quiet) {
  setBusy(1, quiet);
  try {
    setData(await api(payload));
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    toast(e.message, true);
    if (/PIN/i.test(e.message)) logout();
    return false;
  } finally {
    setBusy(-1, quiet);
  }
}

const refresh = (msg, quiet) => sync({ action: 'getAll' }, msg, quiet);

/* ---------- Perhitungan ---------- */
function calc() {
  const d = state.data;
  const s = d.Pengaturan;

  // Saldo per pocket = modal (uang masuk − keluar). Nilai perkiraan = nilai terakhir yang diisi
  // + transaksi setelah tanggal nilai itu.
  const pockets = d.Pocket.map((p) => Object.assign({}, p, { modal: 0, gram: 0, flowAfter: 0, txCount: 0 }));
  const pmap = {};
  pockets.forEach((p) => { pmap[p.id] = p; });
  const orphan = { id: '', nama: 'Tanpa pocket', satuan: '', nilai_sekarang: '', tgl_nilai: '', modal: 0, gram: 0, flowAfter: 0, txCount: 0 };
  const flow = (pid, amount, gram, tanggal) => {
    const p = pmap[pid] || orphan;
    p.modal += amount;
    p.txCount++;
    if (p.satuan === 'gram') p.gram += gram;
    if (p.tgl_nilai && String(tanggal) > p.tgl_nilai) p.flowAfter += amount;
  };

  const per = { p1: 0, p2: 0, keluarga: 0 };
  let masuk = 0, tarik = 0;
  d.Tabungan.forEach((t) => {
    const j = num(t.jumlah);
    const g = dec(t.gram);
    const who = PEOPLE.includes(t.oleh) ? t.oleh : 'keluarga';
    if (t.jenis === 'pindah') {
      flow(t.kantong, -j, -g, t.tanggal);
      flow(t.ke, j, g, t.tanggal);
    } else if (t.jenis === 'tarik') {
      tarik += j; per[who] -= j;
      flow(t.kantong, -j, -g, t.tanggal);
    } else {
      masuk += j; per[who] += j;
      flow(t.kantong, j, g, t.tanggal);
    }
  });
  const terkumpul = masuk - tarik;

  const paid = {};
  let totalBayar = 0;
  d.Pembayaran.forEach((p) => {
    const j = num(p.jumlah);
    paid[p.item_id] = (paid[p.item_id] || 0) + j;
    totalBayar += j;
    flow(p.kantong, -j, 0, p.tanggal);
  });

  if (orphan.txCount) pockets.push(orphan);
  pockets.forEach((p) => {
    p.hasNilai = !!p.tgl_nilai && p.nilai_sekarang !== '' && p.nilai_sekarang != null;
    p.nilai = p.hasNilai ? num(p.nilai_sekarang) + p.flowAfter : p.modal;
    p.selisih = p.nilai - p.modal;
  });
  const totalNilai = pockets.reduce((a, p) => a + p.nilai, 0);
  const adaNilai = pockets.some((p) => p.hasNilai);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const items = d.Anggaran.map((a) => {
    const est = num(a.estimasi);
    const hasDeal = a.harga_deal !== '' && a.harga_deal != null && num(a.harga_deal) > 0;
    const deal = hasDeal ? num(a.harga_deal) : null;
    const biaya = hasDeal ? deal : est;
    const dibayar = paid[a.id] || 0;
    const sisa = Math.max(0, biaya - dibayar);
    let status = 'belum';
    if (biaya === 0 && dibayar === 0) status = 'kosong';
    else if (dibayar > 0 && dibayar >= biaya) status = 'lunas';
    else if (dibayar > 0) status = 'sebagian';
    const due = parseDate(a.jatuh_tempo);
    const telat = !!due && sisa > 0 && due < today;
    return Object.assign({}, a, { est, deal, biaya, dibayar, sisa, status, telat, over: hasDeal && est > 0 && deal > est });
  });

  const cats = [];
  const catMap = {};
  items.forEach((it) => {
    const k = it.kategori || 'Lainnya';
    if (!catMap[k]) { catMap[k] = { nama: k, items: [], est: 0, biaya: 0, dibayar: 0, sisa: 0 }; cats.push(catMap[k]); }
    const c = catMap[k];
    c.items.push(it); c.est += it.est; c.biaya += it.biaya; c.dibayar += it.dibayar; c.sisa += it.sisa;
  });

  const totalBiaya = items.reduce((a, i) => a + i.biaya, 0);
  const totalEst = items.reduce((a, i) => a + i.est, 0);
  const totalSisa = items.reduce((a, i) => a + i.sisa, 0);
  const saldo = terkumpul - totalBayar;

  const targetManual = num(s.target_tabungan) > 0;
  const target = targetManual ? num(s.target_tabungan) : totalBiaya;

  const wedding = parseDate(s.tanggal_nikah);
  const hari = wedding ? Math.round((wedding - today) / 86400000) : null;
  const bulan = hari != null && hari > 0 ? Math.max(1, Math.ceil(hari / 30.44)) : null;
  const kurangTarget = Math.max(0, target - terkumpul);
  const perBulan = bulan ? kurangTarget / bulan : null;
  const kekurangan = totalSisa - saldo;

  const jatuhTempo = items
    .filter((i) => i.jatuh_tempo && i.sisa > 0)
    .sort((a, b) => String(a.jatuh_tempo).localeCompare(String(b.jatuh_tempo)));

  return { pockets, totalNilai, adaNilai, per, masuk, tarik, terkumpul, totalBayar, items, cats, totalBiaya, totalEst, totalSisa, saldo, target, targetManual, hari, bulan, kurangTarget, perBulan, kekurangan, jatuhTempo };
}

/* ---------- Render ---------- */
function render() {
  if (!state.data) return;
  const s = state.data.Pengaturan;
  const c = calc();
  $('#couple').textContent = (s.nama1 || 'Saya') + ' & ' + (s.nama2 || 'Pasangan');
  let cd = 'Atur tanggal pernikahan di Pengaturan';
  if (c.hari != null) {
    if (c.hari > 0) cd = c.hari + ' hari lagi · ' + fmtDate(s.tanggal_nikah);
    else if (c.hari === 0) cd = 'Hari ini hari bahagianya! 💍';
    else cd = 'Menikah ' + fmtDate(s.tanggal_nikah);
  }
  $('#countdown').textContent = cd;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  const views = { ringkasan: viewRingkasan, tabungan: viewTabungan, anggaran: viewAnggaran, pengaturan: viewPengaturan };
  $('#view').innerHTML = (views[state.tab] || viewRingkasan)(c);
}

function meter(value, total, opts = {}) {
  const w = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return `<div class="meter ${opts.thin ? 'thin' : ''} ${opts.over ? 'over' : ''}" role="img" aria-label="${esc(opts.label || pct(value, total) + '%')}"><span style="width:${w.toFixed(1)}%"></span></div>`;
}

function contribution(c) {
  const vals = PEOPLE.map((k) => ({ k, v: Math.max(0, c.per[k]) }));
  const total = vals.reduce((a, x) => a + x.v, 0);
  if (!total) return '<p class="empty">Belum ada tabungan yang dicatat.</p>';
  const bar = vals.filter((x) => x.v > 0)
    .map((x) => `<span style="width:${((x.v / total) * 100).toFixed(2)}%;background:var(--${x.k})" data-tip="${esc(personName(x.k) + '\n' + rp(x.v) + ' (' + pct(x.v, total) + '%)')}"></span>`).join('');
  const legend = vals.map((x) => `
    <div class="legend-row">
      <span class="sw" style="background:var(--${x.k})"></span>
      <span class="name">${esc(personName(x.k))}</span>
      <span class="num">${rp(c.per[x.k])}</span>
      <span class="pct num">${pct(x.v, total)}%</span>
    </div>`).join('');
  return `<div class="stack" role="img" aria-label="Kontribusi tabungan">${bar}</div><div class="legend">${legend}</div>`;
}

function selisihBadge(p) {
  if (!p.hasNilai || p.selisih === 0) return '';
  const up = p.selisih > 0;
  return `<span class="badge ${up ? 'lunas' : 'telat'}">${up ? '▲ untung' : '▼ rugi'} ${rpShort(Math.abs(p.selisih))}</span>`;
}

function pocketRows(c) {
  if (!c.pockets.length) return '<p class="empty">Belum ada pocket.</p>';
  return c.pockets.map((p) => {
    const sub = [];
    if (p.satuan === 'gram' && p.gram) sub.push(fmtGram(p.gram));
    sub.push(p.hasNilai ? 'Nilai per ' + fmtDate(p.tgl_nilai) + ' ≈ ' + rp(p.nilai) : 'Modal');
    return `
      <div class="row ${p.id ? 'clickable' : ''}" ${p.id ? `data-action="edit-pocket" data-id="${esc(p.id)}"` : ''}>
        <div class="row-main">
          <div class="row-title">${esc(p.nama)}</div>
          <div class="row-sub">${esc(sub.join(' · '))}</div>
        </div>
        <div class="row-end">
          <div class="row-amount num">${rp(p.modal)}</div>
          ${selisihBadge(p)}
        </div>
      </div>`;
  }).join('');
}

function serverOldNotice() {
  if (!state.data.serverOld) return '';
  return `<section class="card"><div class="status warning"><span class="dot"></span>Script Google belum diperbarui</div>
    <p class="hint" style="margin-top:6px">Fitur pocket belum aktif. Perbarui kode di Apps Script lalu buat versi deployment baru (lihat PANDUAN.md).</p></section>`;
}

function dueRow(it) {
  const badge = it.telat ? '<span class="badge telat">⚠ Lewat jatuh tempo</span>' : `<span class="badge">${fmtDate(it.jatuh_tempo)}</span>`;
  return `
    <div class="row clickable" data-action="edit-item" data-id="${esc(it.id)}">
      <div class="row-main">
        <div class="row-title">${esc(it.item)}</div>
        <div class="row-sub">${esc(it.kategori)}${it.vendor ? ' · ' + esc(it.vendor) : ''}</div>
      </div>
      <div class="row-end">
        <div class="row-amount num">${rp(it.sisa)}</div>
        ${badge}
      </div>
    </div>`;
}

function viewRingkasan(c) {
  let dana;
  if (c.totalSisa === 0 && c.totalBiaya === 0) {
    dana = '<div class="tile-value">–</div><div class="tile-note">Isi harga di Anggaran</div>';
  } else if (c.kekurangan > 0) {
    dana = `<div class="tile-value num">${rp(c.kekurangan)}</div><div class="status critical small"><span class="dot"></span>Dana masih kurang</div>`;
  } else {
    dana = `<div class="tile-value num">${rp(-c.kekurangan)}</div><div class="status good small"><span class="dot"></span>Dana cukup, sisa lebih</div>`;
  }

  let plan;
  if (c.bulan == null) {
    plan = `<p class="muted small" style="margin:0">Isi <a href="#" class="link" data-action="goto" data-tab="pengaturan">tanggal pernikahan</a> untuk menghitung berapa yang perlu ditabung per bulan.</p>`;
  } else if (c.kurangTarget <= 0) {
    plan = `<div class="status good"><span class="dot"></span>Target tabungan sudah tercapai 🎉</div>`;
  } else {
    plan = `
      <div class="hero-label">Perlu ditabung per bulan</div>
      <div class="tile-value num" style="font-size:24px">${rp(c.perBulan)}</div>
      <div class="hero-sub">≈ ${rp(c.perBulan / 2)} per orang, selama ${c.bulan} bulan lagi</div>`;
  }

  const due = c.jatuhTempo.slice(0, 5);
  const catRows = c.cats.filter((k) => k.biaya > 0 || k.dibayar > 0).map((k) => `
    <div class="row clickable" data-action="goto-cat" data-cat="${esc(k.nama)}">
      <div class="row-main">
        <div class="row-title">${esc(k.nama)}</div>
        ${meter(k.dibayar, k.biaya, { thin: true, label: pct(k.dibayar, k.biaya) + '% terbayar' })}
      </div>
      <div class="row-end small">
        <div class="num" style="font-weight:600">${rpShort(k.dibayar)}</div>
        <div class="muted num">dari ${rpShort(k.biaya)}</div>
      </div>
    </div>`).join('');

  const nilaiLine = c.adaNilai
    ? `<div class="hero-sub" style="margin-top:2px">Perkiraan nilai sekarang <strong class="num">${rp(c.totalNilai)}</strong> (${c.totalNilai >= c.saldo ? '▲ untung' : '▼ rugi'} ${rp(Math.abs(c.totalNilai - c.saldo))} dari investasi)</div>`
    : '';

  return `
    ${serverOldNotice()}
    <section class="card">
      <div class="hero-label">Saldo tabungan saat ini</div>
      <div class="hero-value num">${rp(c.saldo)}</div>
      <div class="hero-sub">Terkumpul ${rp(c.terkumpul)} − sudah dibayar ke vendor ${rp(c.totalBayar)}</div>
      ${nilaiLine}
      <div style="margin-top:18px">
        ${meter(c.terkumpul, c.target, { label: 'Progres target ' + pct(c.terkumpul, c.target) + '%' })}
        <div class="meter-row">
          <span>Target ${c.targetManual ? '' : '(= total biaya) '}<span class="num">${rp(c.target)}</span></span>
          <span class="num"><strong>${pct(c.terkumpul, c.target)}%</strong></span>
        </div>
      </div>
    </section>

    <section class="tiles">
      <div class="card tile"><div class="tile-label">Total biaya</div><div class="tile-value num">${rp(c.totalBiaya)}</div><div class="tile-note">Harga deal atau estimasi</div></div>
      <div class="card tile"><div class="tile-label">Sudah dibayar</div><div class="tile-value num">${rp(c.totalBayar)}</div><div class="tile-note">${pct(c.totalBayar, c.totalBiaya)}% dari total</div></div>
      <div class="card tile"><div class="tile-label">Sisa tagihan</div><div class="tile-value num">${rp(c.totalSisa)}</div><div class="tile-note">Belum dibayar ke vendor</div></div>
      <div class="card tile"><div class="tile-label">Kekurangan dana</div>${dana}</div>
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Rencana menabung</h2></div>
        ${plan}
      </section>
      <section class="card">
        <div class="card-head"><h2>Kontribusi tabungan</h2><a href="#" class="link small" data-action="goto" data-tab="tabungan">Lihat semua</a></div>
        ${contribution(c)}
      </section>
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Saldo per pocket</h2><a href="#" class="link small" data-action="goto" data-tab="tabungan">Kelola</a></div>
        <div class="list">${pocketRows(c)}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Pembayaran terdekat</h2><span class="muted">${c.jatuhTempo.length} tagihan</span></div>
        <div class="list">${due.length ? due.map(dueRow).join('') : '<p class="empty">Tidak ada tagihan dengan jatuh tempo.<br>Isi tanggal jatuh tempo di item anggaran.</p>'}</div>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h2>Anggaran per kategori</h2><a href="#" class="link small" data-action="goto" data-tab="anggaran">Detail</a></div>
      <div class="list">${catRows || '<p class="empty">Belum ada harga yang diisi.</p>'}</div>
    </section>
  `;
}

function monthlyChart() {
  const rows = state.data.Tabungan.filter((t) => t.jenis === 'setor' && parseDate(t.tanggal));
  if (!rows.length) return '';
  const byMonth = {};
  rows.forEach((t) => {
    const d = parseDate(t.tanggal);
    const k = d.getFullYear() + '-' + pad(d.getMonth() + 1);
    byMonth[k] = byMonth[k] || { p1: 0, p2: 0, keluarga: 0 };
    const who = PEOPLE.includes(t.oleh) ? t.oleh : 'keluarga';
    byMonth[k][who] += num(t.jumlah);
  });
  const keys = Object.keys(byMonth).sort();
  const now = new Date();
  const nowKey = now.getFullYear() + '-' + pad(now.getMonth() + 1);
  const endKey = keys[keys.length - 1] > nowKey ? keys[keys.length - 1] : nowKey;
  let [ey, em] = endKey.split('-').map(Number);
  const months = [];
  for (let i = 0; i < 12; i++) {
    const k = ey + '-' + pad(em);
    if (k < keys[0] && months.length >= 6) break;
    months.unshift(k);
    em--; if (em === 0) { em = 12; ey--; }
  }
  const totals = months.map((k) => (byMonth[k] ? PEOPLE.reduce((a, p) => a + byMonth[k][p], 0) : 0));
  const max = Math.max(...totals, 1);
  const cols = months.map((k, i) => {
    const m = byMonth[k];
    const tip = monthLabel(k, true) + '\n' + (m
      ? PEOPLE.filter((p) => m[p] > 0).map((p) => personName(p) + ': ' + rp(m[p])).join('\n') + '\nTotal: ' + rp(totals[i])
      : 'Belum ada setoran');
    const segs = m ? PEOPLE.filter((p) => m[p] > 0)
      .map((p) => `<span style="height:calc(${((m[p] / max) * 100).toFixed(2)}% - 2px);background:var(--${p})"></span>`).join('') : '';
    return `<div class="bar-col" data-tip="${esc(tip)}">${segs}</div>`;
  }).join('');
  const labels = months.map((k) => `<span>${esc(monthLabel(k))}</span>`).join('');
  const legend = PEOPLE.map((p) => `<span class="legend-row"><span class="sw" style="background:var(--${p})"></span>${esc(personName(p))}</span>`).join('');
  return `
    <section class="card">
      <div class="card-head"><h2>Setoran per bulan</h2><span class="muted">${months.length} bulan terakhir</span></div>
      <div class="legend inline">${legend}</div>
      <div class="chart">
        <span class="chart-max">${rpShort(max)}</span>
        <div class="bars" role="img" aria-label="Grafik setoran tabungan per bulan">${cols}</div>
        <div class="bar-labels">${labels}</div>
      </div>
    </section>`;
}

function txRow(t) {
  const g = dec(t.gram);
  const gramText = g ? ' · ' + fmtGram(g) : '';
  const note = t.catatan ? ' · ' + esc(t.catatan) : '';
  let title, sub, amount, badge = '';
  if (t.jenis === 'pindah') {
    title = `${esc(pocketName(t.kantong))} → ${esc(pocketName(t.ke))}`;
    sub = fmtDate(t.tanggal) + gramText + note;
    amount = rp(num(t.jumlah));
    badge = '<span class="badge">⇄ Pindah</span>';
  } else {
    const who = PEOPLE.includes(t.oleh) ? t.oleh : 'keluarga';
    const tarik = t.jenis === 'tarik';
    title = `<span class="who"><span class="sw" style="background:var(--${who})"></span>${esc(personName(who))}</span>`;
    sub = fmtDate(t.tanggal) + ` · ${tarik ? 'dari' : 'ke'} ${esc(pocketName(t.kantong))}` + gramText + note;
    amount = (tarik ? '− ' : '+ ') + rp(num(t.jumlah));
    if (tarik) badge = '<span class="badge">Penarikan</span>';
  }
  return `
    <div class="row clickable" data-action="edit-saving" data-id="${esc(t.id)}">
      <div class="row-main">
        <div class="row-title">${title}</div>
        <div class="row-sub">${sub}</div>
      </div>
      <div class="row-end">
        <div class="row-amount num">${amount}</div>
        ${badge}
      </div>
    </div>`;
}

const byDateDesc = (a, b) => String(b.tanggal).localeCompare(String(a.tanggal));

function viewTabungan(c) {
  const pf = state.pocketFilter;
  const list = state.data.Tabungan
    .filter((t) => state.filter === 'semua' || (t.jenis !== 'pindah' && t.oleh === state.filter))
    .filter((t) => pf === 'semua' || t.kantong === pf || t.ke === pf)
    .slice()
    .sort(byDateDesc);
  let lastMonth = '';
  const rows = list.map((t) => {
    const d = parseDate(t.tanggal);
    const mk = d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) : '';
    const head = mk && mk !== lastMonth ? `<div class="month-head">${esc(monthLabel(mk, true))}</div>` : '';
    lastMonth = mk;
    return head + txRow(t);
  }).join('');

  const chips = ['semua'].concat(PEOPLE).map((k) =>
    `<button type="button" class="chip ${state.filter === k ? 'active' : ''}" data-action="filter" data-filter="${k}">${k === 'semua' ? 'Semua' : esc(personName(k))}</button>`).join('');
  const pocketSelect = state.data.Pocket.length ? `
    <select class="pocket-filter" data-change="pocket-filter" aria-label="Filter pocket">
      <option value="semua">Semua pocket</option>
      ${state.data.Pocket.map((p) => `<option value="${esc(p.id)}" ${pf === p.id ? 'selected' : ''}>${esc(p.nama)}</option>`).join('')}
    </select>` : '';

  return `
    ${serverOldNotice()}
    <section class="card">
      <div class="hero-label">Total tabungan terkumpul</div>
      <div class="hero-value num">${rp(c.terkumpul)}</div>
      <div class="hero-sub">Saldo setelah dipakai bayar vendor: <strong class="num">${rp(c.saldo)}</strong></div>
      <div style="margin-top:18px">${contribution(c)}</div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Pocket</h2>${state.data.serverOld ? '' : '<button type="button" class="btn ghost small" data-action="new-pocket">+ Pocket baru</button>'}</div>
      <div class="list">${pocketRows(c)}</div>
      ${c.adaNilai ? `<p class="hint" style="margin-top:8px">Total perkiraan nilai sekarang: <strong class="num">${rp(c.totalNilai)}</strong>. Klik pocket untuk memperbarui nilainya.</p>` : '<p class="hint" style="margin-top:8px">Klik pocket untuk mengisi nilai sekarang (misal nilai reksadana atau harga emas terbaru).</p>'}
    </section>

    ${monthlyChart()}

    <section class="card">
      <div class="toolbar" style="margin-bottom:10px">
        <div class="chips">${chips}</div>
        <button type="button" class="btn primary" data-action="new-saving">+ Catat transaksi</button>
      </div>
      ${pocketSelect}
      <div class="list">${rows || '<p class="empty">Belum ada catatan. Klik “+ Catat transaksi” untuk mulai.</p>'}</div>
    </section>
  `;
}

const STATUS_BADGE = {
  lunas: '<span class="badge lunas">✓ Lunas</span>',
  sebagian: '<span class="badge sebagian">◐ Sebagian</span>',
  belum: '<span class="badge">○ Belum bayar</span>',
  kosong: '<span class="badge">Belum ada harga</span>',
};

function viewAnggaran(c) {
  const cats = c.cats.map((k) => {
    const open = state.openCats[k.nama] ? 'open' : '';
    const rows = k.items.map((it) => `
      <div class="row clickable" data-action="edit-item" data-id="${esc(it.id)}">
        <div class="row-main">
          <div class="row-title">${esc(it.item)}</div>
          <div class="row-sub">${it.vendor ? esc(it.vendor) : 'Vendor belum dipilih'}${it.sisa > 0 && it.dibayar > 0 ? ' · sisa ' + rp(it.sisa) : ''}</div>
        </div>
        <div class="row-end">
          <div class="row-amount num">${it.biaya ? rp(it.biaya) : '–'}</div>
          ${it.telat ? '<span class="badge telat">⚠ Telat bayar</span>' : (it.over ? '<span class="badge sebagian">▲ Lewat estimasi</span>' : STATUS_BADGE[it.status])}
        </div>
      </div>`).join('');
    return `
      <details class="card cat" data-cat="${esc(k.nama)}" ${open}>
        <summary>
          <div class="cat-top">
            <span class="cat-name">${esc(k.nama)}</span>
            <span class="small num"><strong>${rpShort(k.dibayar)}</strong> <span class="muted">/ ${rpShort(k.biaya)}</span></span>
          </div>
          ${meter(k.dibayar, k.biaya, { thin: true, label: pct(k.dibayar, k.biaya) + '% terbayar' })}
        </summary>
        <div class="cat-body">
          <div class="list">${rows}</div>
          <div class="cat-foot"><button type="button" class="btn ghost small" data-action="new-item" data-cat="${esc(k.nama)}">+ Tambah item di ${esc(k.nama)}</button></div>
        </div>
      </details>`;
  }).join('');

  const overEst = c.totalBiaya - c.totalEst;
  return `
    <section class="tiles">
      <div class="card tile"><div class="tile-label">Total estimasi</div><div class="tile-value num">${rp(c.totalEst)}</div></div>
      <div class="card tile"><div class="tile-label">Total biaya</div><div class="tile-value num">${rp(c.totalBiaya)}</div><div class="tile-note">${overEst > 0 ? '▲ ' + rp(overEst) + ' di atas estimasi' : overEst < 0 ? '▼ ' + rp(-overEst) + ' di bawah estimasi' : 'Sesuai estimasi'}</div></div>
      <div class="card tile"><div class="tile-label">Sudah dibayar</div><div class="tile-value num">${rp(c.totalBayar)}</div></div>
      <div class="card tile"><div class="tile-label">Sisa tagihan</div><div class="tile-value num">${rp(c.totalSisa)}</div></div>
    </section>
    <div class="toolbar">
      <p class="hint">Klik item untuk mengisi harga, vendor, dan mencatat pembayaran (DP/cicilan).</p>
      <button type="button" class="btn primary" data-action="new-item">+ Item baru</button>
    </div>
    ${cats || '<section class="card"><p class="empty">Belum ada item anggaran.</p></section>'}
  `;
}

function viewPengaturan() {
  const s = state.data.Pengaturan;
  return `
    <section class="card">
      <div class="card-head"><h2>Data pernikahan</h2></div>
      <form class="form" data-form="settings">
        <div class="field-row">
          <label class="field"><span>Nama Anda</span><input type="text" name="nama1" value="${esc(s.nama1)}" maxlength="30" required></label>
          <label class="field"><span>Nama pasangan</span><input type="text" name="nama2" value="${esc(s.nama2)}" maxlength="30" required></label>
        </div>
        <label class="field"><span>Tanggal pernikahan</span><input type="date" name="tanggal_nikah" value="${esc(s.tanggal_nikah)}"></label>
        <label class="field"><span>Target tabungan (opsional)</span><input type="text" inputmode="numeric" data-money name="target_tabungan" value="${moneyInput(s.target_tabungan)}" placeholder="Kosongkan = pakai total biaya anggaran"></label>
        <p class="hint">Kalau target dikosongkan, target otomatis sama dengan total biaya di halaman Anggaran.</p>
        <div><button type="submit" class="btn primary">Simpan</button></div>
      </form>
    </section>

    <section class="card settings-list">
      <div class="card-head"><h2>Koneksi</h2></div>
      <div class="list">
        <div class="row">
          <div class="row-main">
            <div class="row-title">${DEMO ? 'Mode coba' : 'Tersambung ke Google Sheets'}</div>
            <div class="row-sub">${DEMO ? 'Data hanya di browser ini. Isi API_URL di config.js untuk menyimpan online.' : 'Perubahan tersimpan dan terlihat di semua perangkat.'}</div>
          </div>
          <span class="status ${DEMO ? 'warning' : 'good'} small"><span class="dot"></span>${DEMO ? 'Lokal' : 'Online'}</span>
        </div>
        ${DEMO ? `
        <div class="row">
          <div class="row-main"><div class="row-title">Data contoh</div><div class="row-sub">Mulai ulang dengan atau tanpa data contoh.</div></div>
          <div class="row-end" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            <button type="button" class="btn small" data-action="demo-reset" data-samples="1">Isi contoh</button>
            <button type="button" class="btn small danger" data-action="demo-reset" data-samples="0">Kosongkan</button>
          </div>
        </div>` : `
        <div class="row">
          <div class="row-main"><div class="row-title">Keluar dari perangkat ini</div><div class="row-sub">PIN dan data tersimpan di browser ini akan dihapus.</div></div>
          <button type="button" class="btn small danger" data-action="logout">Keluar</button>
        </div>`}
      </div>
    </section>
  `;
}

/* ---------- Modal ---------- */
const modal = $('#modal');

function openModal(title, body) {
  $('#modal-content').innerHTML = `
    <div class="modal-inner">
      <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn close" data-action="close-modal" aria-label="Tutup">×</button></div>
      ${body}
    </div>`;
  if (!modal.open) modal.showModal();
}
function closeModal() { if (modal.open) modal.close(); }
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

function whoOptions(selected) {
  return PEOPLE.map((k) => `<label><input type="radio" name="oleh" value="${k}" ${selected === k ? 'checked' : ''}><span>${esc(personName(k))}</span></label>`).join('');
}

function pocketOptions(selected) {
  const list = state.data.Pocket;
  if (!list.length) return '<option value="">(belum ada pocket)</option>';
  return list.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.nama)}${p.satuan === 'gram' ? ' (gram)' : ''}</option>`).join('');
}

const firstPocketId = () => (state.data.Pocket[0] ? state.data.Pocket[0].id : '');
const rememberedPocket = (key) => {
  const id = store.get(key);
  return pocketById(id) ? id : firstPocketId();
};

function savingForm(t) {
  const isNew = !t;
  t = t || { tanggal: todayStr(), oleh: store.get('wp_last_who') || 'p1', jenis: 'setor', jumlah: '', catatan: '', kantong: rememberedPocket('wp_last_pocket'), ke: '', gram: '' };
  const second = state.data.Pocket.find((p) => p.id !== t.kantong);
  const ke = t.ke || (second ? second.id : '');
  const jenisRadio = (v, label) => `<label><input type="radio" name="jenis" value="${v}" ${t.jenis === v ? 'checked' : ''}><span>${label}</span></label>`;
  openModal(isNew ? 'Catat transaksi' : 'Ubah catatan', `
    <form class="form" data-form="saving" data-id="${esc(t.id || '')}">
      <div class="field"><span>Jenis</span>
        <div class="seg">${jenisRadio('setor', 'Setor')}${jenisRadio('pindah', 'Pindah')}${jenisRadio('tarik', 'Tarik')}</div>
      </div>
      <p class="hint" data-show="setor">Uang masuk dari pendapatan ke salah satu pocket.</p>
      <p class="hint" data-show="pindah">Memindahkan uang antar pocket, misal dari Valas untuk beli emas. Total tabungan tidak berubah.</p>
      <p class="hint" data-show="tarik">Uang diambil dari pocket untuk keperluan lain (bukan bayar vendor).</p>
      <div class="field" data-show="setor tarik"><span data-label-who>Dari</span><div class="seg">${whoOptions(t.oleh)}</div></div>
      <div class="field-row">
        <label class="field"><span data-label-kantong>Masuk ke pocket</span><select name="kantong">${pocketOptions(t.kantong)}</select></label>
        <label class="field" data-show="pindah"><span>Ke pocket</span><select name="ke">${pocketOptions(ke)}</select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Jumlah (Rp)</span><input type="text" inputmode="numeric" data-money name="jumlah" value="${moneyInput(t.jumlah)}" placeholder="0" required autofocus></label>
        <label class="field"><span>Tanggal</span><input type="date" name="tanggal" value="${esc(t.tanggal)}" required></label>
      </div>
      <label class="field" data-gram-field><span>Jumlah emas (gram, opsional)</span><input type="text" inputmode="decimal" name="gram" value="${dec(t.gram) ? esc(String(dec(t.gram)).replace('.', ',')) : ''}" placeholder="mis. 2,5"></label>
      <label class="field"><span>Catatan</span><input type="text" name="catatan" value="${esc(t.catatan)}" placeholder="mis. gaji Oktober, beli Antam 5 gr" maxlength="80"></label>
      <div class="actions">
        ${isNew ? '<span></span>' : `<button type="button" class="btn danger" data-action="delete-saving" data-id="${esc(t.id)}">Hapus</button>`}
        <button type="submit" class="btn primary">Simpan</button>
      </div>
    </form>`);
  updateSavingForm($('form[data-form="saving"]'));
}

// Menampilkan kolom yang sesuai dengan jenis transaksi dan pocket yang dipilih.
function updateSavingForm(form) {
  if (!form) return;
  const jenis = form.jenis.value;
  form.querySelectorAll('[data-show]').forEach((el) => { el.hidden = !el.dataset.show.split(' ').includes(jenis); });
  form.querySelector('[data-label-who]').textContent = jenis === 'tarik' ? 'Diambil oleh' : 'Dari';
  form.querySelector('[data-label-kantong]').textContent = { setor: 'Masuk ke pocket', pindah: 'Dari pocket', tarik: 'Diambil dari pocket' }[jenis];
  const gramRelevant = isGram(form.kantong.value) || (jenis === 'pindah' && isGram(form.ke.value));
  form.querySelector('[data-gram-field]').hidden = !gramRelevant;
}

function pocketForm(p) {
  const isNew = !p;
  const c = calc();
  const full = p ? c.pockets.find((x) => x.id === p.id) : null;
  p = p || { nama: '', satuan: '', nilai_sekarang: '', tgl_nilai: '', catatan: '' };

  let detail = '';
  if (!isNew) {
    const tx = state.data.Tabungan.filter((t) => t.kantong === p.id || t.ke === p.id).slice().sort(byDateDesc);
    const pays = state.data.Pembayaran.filter((x) => x.kantong === p.id);
    const payRows = pays.slice().sort(byDateDesc).slice(0, 5).map((x) => {
      const it = state.data.Anggaran.find((a) => a.id === x.item_id);
      return `<div class="row"><div class="row-main"><div class="row-title">Bayar ${esc(it ? it.item : 'vendor')}</div><div class="row-sub">${fmtDate(x.tanggal)}${x.catatan ? ' · ' + esc(x.catatan) : ''}</div></div><div class="row-end"><div class="row-amount num">− ${rp(num(x.jumlah))}</div></div></div>`;
    }).join('');
    detail = `
      <div class="pay-summary">
        <div>Modal<strong class="num">${rp(full.modal)}</strong></div>
        <div>Nilai sekarang<strong class="num">${full.hasNilai ? rp(full.nilai) : '–'}</strong></div>
        <div>${full.selisih < 0 ? 'Rugi' : 'Untung'}<strong class="num">${full.hasNilai ? rp(Math.abs(full.selisih)) : '–'}</strong></div>
      </div>
      ${p.satuan === 'gram' ? `<p class="hint">Total emas: <strong>${fmtGram(full.gram)}</strong></p>` : ''}`;
    const txHtml = tx.slice(0, 8).map(txRow).join('');
    detail += `
      <div class="subsection">
        <h3>Transaksi terakhir</h3>
        <div class="list">${txHtml || '<p class="hint">Belum ada transaksi tabungan.</p>'}</div>
        ${payRows ? `<h3 style="margin-top:6px">Pembayaran vendor dari pocket ini</h3><div class="list">${payRows}</div>` : ''}
      </div>`;
  }

  openModal(isNew ? 'Pocket baru' : p.nama, `
    ${detail}
    <form class="form ${isNew ? '' : 'subsection'}" data-form="pocket" data-id="${esc(p.id || '')}">
      ${isNew ? '' : '<h3>Pengaturan pocket</h3>'}
      <label class="field"><span>Nama pocket</span><input type="text" name="nama" value="${esc(p.nama)}" required maxlength="40" placeholder="mis. Tabungan BCA, Emas Antam"></label>
      <label class="check"><input type="checkbox" name="satuan" value="gram" ${p.satuan === 'gram' ? 'checked' : ''}> Catat jumlah gram (untuk emas / perhiasan)</label>
      <div class="field-row">
        <label class="field"><span>Nilai sekarang (Rp)</span><input type="text" inputmode="numeric" data-money name="nilai_sekarang" value="${moneyInput(p.nilai_sekarang)}" placeholder="Kosongkan = sama dengan modal"></label>
        <label class="field"><span>Per tanggal</span><input type="date" name="tgl_nilai" value="${esc(p.tgl_nilai || todayStr())}"></label>
      </div>
      <p class="hint">Isi dengan nilai terbaru, misal dari aplikasi reksadana atau harga emas hari ini × jumlah gram. Setoran sesudah tanggal ini otomatis ditambahkan ke perkiraan nilainya.</p>
      <label class="field"><span>Catatan</span><input type="text" name="catatan" value="${esc(p.catatan)}" maxlength="80" placeholder="mis. nomor rekening, nama produk reksadana"></label>
      <div class="actions">
        ${isNew ? '<span></span>' : `<button type="button" class="btn danger" data-action="delete-pocket" data-id="${esc(p.id)}">Hapus pocket</button>`}
        <button type="submit" class="btn primary">Simpan</button>
      </div>
    </form>`);
}

function itemForm(it, presetCat) {
  const isNew = !it;
  const c = calc();
  const full = it ? c.items.find((x) => x.id === it.id) : null;
  it = it || { kategori: presetCat || '', item: '', vendor: '', estimasi: '', harga_deal: '', jatuh_tempo: '', catatan: '' };
  const catOptions = c.cats.map((k) => `<option value="${esc(k.nama)}">`).join('');

  let payments = '';
  if (!isNew) {
    const list = state.data.Pembayaran.filter((p) => p.item_id === it.id)
      .sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
    const rows = list.map((p, i) => `
      <div class="row">
        <div class="row-main">
          <div class="row-title num">${rp(num(p.jumlah))}</div>
          <div class="row-sub">${fmtDate(p.tanggal)} · ${esc(p.catatan || 'Pembayaran ' + (i + 1))}${state.data.Pocket.length ? ' · dari ' + esc(pocketName(p.kantong)) : ''}</div>
        </div>
        <button type="button" class="btn small danger" data-action="delete-payment" data-id="${esc(p.id)}" data-item="${esc(it.id)}">Hapus</button>
      </div>`).join('');
    payments = `
      <div class="subsection">
        <h3>Pembayaran</h3>
        <div class="pay-summary">
          <div>Biaya<strong class="num">${rp(full.biaya)}</strong></div>
          <div>Dibayar<strong class="num">${rp(full.dibayar)}</strong></div>
          <div>Sisa<strong class="num">${rp(full.sisa)}</strong></div>
        </div>
        <div class="list">${rows || '<p class="hint">Belum ada pembayaran.</p>'}</div>
        <form class="form" data-form="payment" data-item="${esc(it.id)}">
          <div class="field-row">
            <label class="field"><span>Jumlah bayar (Rp)</span><input type="text" inputmode="numeric" data-money name="jumlah" placeholder="0" required></label>
            <label class="field"><span>Tanggal</span><input type="date" name="tanggal" value="${todayStr()}" required></label>
          </div>
          <div class="field-row">
            <label class="field"><span>Keterangan</span><input type="text" name="catatan" placeholder="mis. DP, pelunasan" maxlength="60"></label>
            <label class="field"><span>Dibayar dari pocket</span><select name="kantong">${pocketOptions(rememberedPocket('wp_last_pay_pocket'))}</select></label>
          </div>
          <div class="actions">
            ${full.sisa > 0 ? `<button type="button" class="btn small" data-action="fill-lunas" data-amount="${full.sisa}">Isi sisa (lunas)</button>` : '<span></span>'}
            <button type="submit" class="btn primary">+ Catat pembayaran</button>
          </div>
        </form>
      </div>`;
  }

  openModal(isNew ? 'Item anggaran baru' : it.item, `
    <form class="form" data-form="item" data-id="${esc(it.id || '')}">
      <div class="field-row">
        <label class="field"><span>Nama item</span><input type="text" name="item" value="${esc(it.item)}" required maxlength="60"></label>
        <label class="field"><span>Kategori</span><input type="text" name="kategori" value="${esc(it.kategori)}" list="cat-list" required maxlength="40"></label>
      </div>
      <datalist id="cat-list">${catOptions}</datalist>
      <label class="field"><span>Vendor</span><input type="text" name="vendor" value="${esc(it.vendor)}" maxlength="60" placeholder="Nama vendor / toko"></label>
      <div class="field-row">
        <label class="field"><span>Estimasi (Rp)</span><input type="text" inputmode="numeric" data-money name="estimasi" value="${moneyInput(it.estimasi)}" placeholder="0"></label>
        <label class="field"><span>Harga deal (Rp)</span><input type="text" inputmode="numeric" data-money name="harga_deal" value="${moneyInput(it.harga_deal)}" placeholder="Belum deal"></label>
      </div>
      <label class="field"><span>Jatuh tempo pembayaran berikutnya</span><input type="date" name="jatuh_tempo" value="${esc(it.jatuh_tempo)}"></label>
      <label class="field"><span>Catatan</span><textarea name="catatan" maxlength="300" placeholder="Paket, isi, kontak vendor, dll.">${esc(it.catatan)}</textarea></label>
      <div class="actions">
        ${isNew ? '<span></span>' : `<button type="button" class="btn danger" data-action="delete-item" data-id="${esc(it.id)}">Hapus item</button>`}
        <button type="submit" class="btn primary">Simpan</button>
      </div>
    </form>
    ${payments}`);
}

/* ---------- Event ---------- */
const formData = (form) => Object.fromEntries(new FormData(form).entries());

const formHandlers = {
  async saving(form) {
    const f = formData(form);
    const pindah = f.jenis === 'pindah';
    const gramRelevant = isGram(f.kantong) || (pindah && isGram(f.ke));
    const row = {
      id: form.dataset.id || '',
      tanggal: f.tanggal,
      oleh: pindah ? '' : f.oleh,
      jenis: f.jenis,
      jumlah: num(f.jumlah),
      catatan: f.catatan.trim(),
      kantong: f.kantong || '',
      ke: pindah ? f.ke || '' : '',
      gram: gramRelevant && dec(f.gram) > 0 ? dec(f.gram) : '',
    };
    if (row.jumlah <= 0) return toast('Jumlah harus lebih dari 0.', true);
    if (state.data.Pocket.length && !row.kantong) return toast('Pilih pocket dulu.', true);
    if (pindah && (!row.ke || row.ke === row.kantong)) return toast('Pocket asal dan tujuan harus berbeda.', true);
    const src = row.kantong && calc().pockets.find((p) => p.id === row.kantong);
    if (f.jenis !== 'setor' && src) {
      const old = state.data.Tabungan.find((t) => t.id === row.id);
      const available = src.modal + (old && old.kantong === row.kantong && old.jenis !== 'setor' ? num(old.jumlah) : 0);
      if (row.jumlah > available && !confirm(`Saldo ${src.nama} hanya ${rp(available)}. Tetap simpan?`)) return;
    }
    if (!pindah) store.set('wp_last_who', row.oleh);
    if (f.jenis === 'setor') store.set('wp_last_pocket', row.kantong);
    if (await sync({ action: 'save', sheet: 'Tabungan', row }, 'Transaksi tersimpan')) closeModal();
  },
  async pocket(form) {
    const f = formData(form);
    const old = state.data.Pocket.find((p) => p.id === form.dataset.id) || {};
    const nilai = f.nilai_sekarang ? num(f.nilai_sekarang) : '';
    const row = Object.assign({}, old, {
      id: form.dataset.id || '',
      nama: f.nama.trim(),
      satuan: f.satuan === 'gram' ? 'gram' : '',
      nilai_sekarang: nilai,
      tgl_nilai: nilai === '' ? '' : (f.tgl_nilai || todayStr()),
      catatan: f.catatan.trim(),
    });
    if (!row.nama) return toast('Nama pocket wajib diisi.', true);
    if (await sync({ action: 'save', sheet: 'Pocket', row }, 'Pocket tersimpan')) closeModal();
  },
  async item(form) {
    const f = formData(form);
    const old = state.data.Anggaran.find((a) => a.id === form.dataset.id) || {};
    const row = Object.assign({}, old, {
      id: form.dataset.id || '',
      kategori: f.kategori.trim(),
      item: f.item.trim(),
      vendor: f.vendor.trim(),
      estimasi: num(f.estimasi),
      harga_deal: f.harga_deal ? num(f.harga_deal) : '',
      jatuh_tempo: f.jatuh_tempo,
      catatan: f.catatan.trim(),
    });
    state.openCats[row.kategori] = true;
    store.set('wp_open_cats', state.openCats);
    if (await sync({ action: 'save', sheet: 'Anggaran', row }, 'Item tersimpan')) closeModal();
  },
  async payment(form) {
    const f = formData(form);
    const row = { id: '', item_id: form.dataset.item, tanggal: f.tanggal, jumlah: num(f.jumlah), catatan: f.catatan.trim(), kantong: f.kantong || '' };
    if (row.jumlah <= 0) return toast('Jumlah harus lebih dari 0.', true);
    if (row.kantong) store.set('wp_last_pay_pocket', row.kantong);
    if (await sync({ action: 'save', sheet: 'Pembayaran', row }, 'Pembayaran dicatat')) reopenItem(row.item_id);
  },
  async settings(form) {
    const f = formData(form);
    const settings = { nama1: f.nama1.trim(), nama2: f.nama2.trim(), tanggal_nikah: f.tanggal_nikah, target_tabungan: num(f.target_tabungan) };
    await sync({ action: 'saveSettings', settings }, 'Pengaturan tersimpan');
  },
};

function reopenItem(id) {
  const it = state.data.Anggaran.find((a) => a.id === id);
  if (it) itemForm(it); else closeModal();
}

const actions = {
  goto(el) { setTab(el.dataset.tab); },
  'goto-cat'(el) {
    state.openCats[el.dataset.cat] = true;
    store.set('wp_open_cats', state.openCats);
    setTab('anggaran');
    const target = document.querySelector(`.cat[data-cat="${CSS.escape(el.dataset.cat)}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  filter(el) { state.filter = el.dataset.filter; render(); },
  'new-saving'() { savingForm(null); },
  'edit-saving'(el) { savingForm(state.data.Tabungan.find((t) => t.id === el.dataset.id)); },
  async 'delete-saving'(el) {
    if (!confirm('Hapus catatan ini?')) return;
    if (await sync({ action: 'delete', sheet: 'Tabungan', id: el.dataset.id }, 'Catatan dihapus')) closeModal();
  },
  'new-pocket'() { pocketForm(null); },
  'edit-pocket'(el) { pocketForm(state.data.Pocket.find((p) => p.id === el.dataset.id)); },
  async 'delete-pocket'(el) {
    if (!confirm('Hapus pocket ini?')) return;
    if (await sync({ action: 'delete', sheet: 'Pocket', id: el.dataset.id }, 'Pocket dihapus')) closeModal();
  },
  'new-item'(el) { itemForm(null, el.dataset.cat); },
  'edit-item'(el) { itemForm(state.data.Anggaran.find((a) => a.id === el.dataset.id)); },
  async 'delete-item'(el) {
    if (!confirm('Hapus item ini beserta semua catatan pembayarannya?')) return;
    if (await sync({ action: 'delete', sheet: 'Anggaran', id: el.dataset.id }, 'Item dihapus')) closeModal();
  },
  async 'delete-payment'(el) {
    if (!confirm('Hapus catatan pembayaran ini?')) return;
    if (await sync({ action: 'delete', sheet: 'Pembayaran', id: el.dataset.id }, 'Pembayaran dihapus')) reopenItem(el.dataset.item);
  },
  'fill-lunas'(el) {
    const form = el.closest('form');
    form.jumlah.value = moneyInput(el.dataset.amount);
    if (!form.catatan.value) form.catatan.value = 'Pelunasan';
  },
  'close-modal'() { closeModal(); },
  logout() { if (confirm('Keluar dari perangkat ini?')) logout(); },
  'demo-reset'(el) {
    const withSamples = el.dataset.samples === '1';
    if (!confirm(withSamples ? 'Ganti semua data dengan data contoh?' : 'Hapus semua data dan mulai dari kosong?')) return;
    store.set('wp_demo', seedDemo(withSamples));
    setData(demo.load());
    toast('Data diatur ulang');
  },
};

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.tabs button');
  if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  e.preventDefault();
  const fn = actions[el.dataset.action];
  if (fn) fn(el);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  if (state.busy) return;
  const fn = formHandlers[form.dataset.form];
  if (fn) fn(form);
});

// Format angka rupiah saat mengetik (1000000 -> 1.000.000)
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.matches('[data-money]')) return;
  const digits = el.value.replace(/[^\d]/g, '');
  el.value = digits ? Number(digits).toLocaleString('id-ID') : '';
});

document.addEventListener('change', (e) => {
  const el = e.target;
  const savingFormEl = el.closest && el.closest('form[data-form="saving"]');
  if (savingFormEl) updateSavingForm(savingFormEl);
  if (el.matches('[data-change="pocket-filter"]')) { state.pocketFilter = el.value; render(); }
});

// Ingat kategori yang dibuka/ditutup
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d.matches || !d.matches('details.cat')) return;
  state.openCats[d.dataset.cat] = d.open;
  store.set('wp_open_cats', state.openCats);
}, true);

/* ---------- Tooltip grafik ---------- */
const tip = $('#tip');
function showTip(el, x, y) {
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
  const top = y - r.height - 14 < 8 ? y + 18 : y - r.height - 14;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (el) showTip(el, e.clientX, e.clientY); else tip.hidden = true;
});
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (el && e.pointerType !== 'mouse') showTip(el, e.clientX, e.clientY);
  else if (!el) tip.hidden = true;
});
window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

/* ---------- UI helpers ---------- */
function setTab(tab) {
  state.tab = tab;
  store.set('wp_tab', tab);
  history.replaceState(null, '', '#' + tab);
  render();
  window.scrollTo({ top: 0 });
}

function setBusy(delta, quiet) {
  state.busy = Math.max(0, state.busy + delta);
  if (!quiet) state.loud = Math.max(0, state.loud + delta);
  const on = state.busy > 0;
  $('#busy').hidden = state.loud === 0;
  $('#refresh').classList.toggle('spin', on);
  document.querySelectorAll('form[data-form] button[type="submit"]').forEach((b) => { b.disabled = on; });
}

let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 4500 : 2200);
}

function logout() {
  store.del('wp_pin');
  store.del('wp_cache');
  state.pin = null;
  state.data = null;
  closeModal();
  showLogin();
}

function showLogin(errMsg) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  const err = $('#login-error');
  err.hidden = !errMsg;
  err.textContent = errMsg || '';
  setTimeout(() => $('#pin').focus(), 50);
}

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#demo-banner').hidden = !DEMO;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  state.pin = $('#pin').value.trim();
  try {
    const data = await api({ action: 'getAll' });
    store.set('wp_pin', state.pin);
    $('#pin').value = '';
    showApp();
    setData(data);
  } catch (err) {
    state.pin = null;
    showLogin(err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#refresh').addEventListener('click', () => refresh('Data diperbarui'));

// Ambil data terbaru saat aplikasi dibuka kembali (mis. pasangan baru saja mengubah data).
// Dibatasi paling sering 20 detik sekali, dan tidak saat sedang mengisi form.
let lastAutoRefresh = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.data || DEMO || state.busy || modal.open) return;
  if (document.activeElement && document.activeElement.closest('form')) return;
  if (Date.now() - lastAutoRefresh < 20000) return;
  lastAutoRefresh = Date.now();
  refresh(null, true);
});

/* ---------- Mulai ---------- */
(function init() {
  if (DEMO) {
    showApp();
    setData(demo.load());
    return;
  }
  if (!state.pin) { showLogin(); return; }
  showApp();
  const cached = store.get('wp_cache');
  if (cached) setData(cached);
  else $('#view').innerHTML = '<section class="card"><p class="empty">Memuat data…</p></section>';
  refresh(null, !!cached);
})();
