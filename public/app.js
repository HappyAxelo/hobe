/* Hobe PWA — vanilla JS, no framework. Total JS shipped to the phone: this file. */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const fmt = (n) => Number(n).toLocaleString('en-US');

// ---------- state ----------
let users = [];
let me = null; // current demo user
const state = { tab: 'watch' };

// ---------- api ----------
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (me) headers['X-User-Id'] = me.id;
  if (opts.json) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  const res = await fetch(path, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ---------- toast ----------
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- sheet ----------
function openSheet(html) {
  const s = $('#sheet');
  let bd = $('.backdrop');
  if (!bd) {
    bd = document.createElement('div');
    bd.className = 'backdrop';
    bd.onclick = closeSheet;
    document.body.appendChild(bd);
  }
  s.innerHTML = html;
  s.classList.remove('hidden');
  return s;
}
function closeSheet() {
  $('#sheet').classList.add('hidden');
  $('.backdrop')?.remove();
}

// ---------- user switcher (demo auth) ----------
async function loadUsers() {
  users = await api('/api/users');
  const saved = Number(localStorage.getItem('hobe_user'));
  me = users.find((u) => u.id === saved) || users.find((u) => u.role === 'viewer') || users[0];
  renderUserPill();
}
function renderUserPill() {
  $('#userpill').textContent = me ? `${me.name.split(' ')[0]} ▾` : 'Sign in';
}
$('#userpill').onclick = () => {
  openSheet(`
    <h2>Who are you?</h2>
    <p class="dim">Demo login — production uses OTP on your MoMo number.</p>
    <div id="userlist">${users.map((u) => `
      <button class="ghost" style="width:100%;margin:5px 0;display:flex;justify-content:space-between" data-uid="${u.id}">
        <span>${u.name} <span class="dim">@${u.handle}</span></span>
        <span class="dim">${u.role}</span>
      </button>`).join('')}
    </div>`);
  $('#userlist').onclick = (e) => {
    const id = e.target.closest('[data-uid]')?.dataset.uid;
    if (!id) return;
    me = users.find((u) => u.id === Number(id));
    localStorage.setItem('hobe_user', me.id);
    renderUserPill();
    closeSheet();
    render();
  };
};

// ---------- polling a transaction to completion ----------
function pollTxn(id, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const until = Date.now() + timeoutMs;
    const tick = async () => {
      try {
        const t = await api(`/api/transactions/${id}`);
        if (t.status !== 'pending') return resolve(t);
      } catch { /* keep polling */ }
      if (Date.now() > until) return resolve({ status: 'pending' });
      setTimeout(tick, 900);
    };
    tick();
  });
}

// ---------- feed (watch / learn) ----------
let observer = null;

async function renderFeed(kind) {
  const vids = await api(`/api/feed?kind=${kind}`);
  if (!vids.length) {
    view.innerHTML = `<div class="empty"><p>No videos yet.</p><p>Run <b>npm run seed</b> to load demo content.</p></div>`;
    return;
  }
  view.innerHTML = `<div class="feed">${vids.map((v) => slideHtml(v, kind)).join('')}</div>`;

  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const video = $('video', en.target);
      if (!video) continue;
      if (en.isIntersecting && en.intersectionRatio > 0.6) {
        video.play().catch(() => {});
        const id = en.target.dataset.vid;
        if (!en.target.dataset.viewed) {
          en.target.dataset.viewed = '1';
          api(`/api/videos/${id}/view`, { method: 'POST' }).catch(() => {});
        }
      } else {
        video.pause();
      }
    }
  }, { threshold: [0, 0.6] });
  view.querySelectorAll('.slide').forEach((s) => observer.observe(s));

  $('.feed').onclick = feedClick;
}

function slideHtml(v, kind) {
  const init = v.creator_name.split(' ').map((w) => w[0]).slice(0, 2).join('');
  const langNames = { rw: 'Kinyarwanda', en: 'English', fr: 'Français', sw: 'Kiswahili' };
  return `
  <section class="slide" data-vid="${v.id}" data-creator="${v.user_id}">
    <video src="/videos/${v.filename}" loop playsinline preload="${kind === 'watch' ? 'auto' : 'metadata'}" muted></video>
    <div class="overlay">
      <div class="who" data-act="profile">
        <div class="avatar" style="background:${v.creator_color}">${init}</div>
        <div><div class="handle">@${v.creator_handle}</div></div>
      </div>
      <div class="vtitle">${esc(v.title)}</div>
      ${v.kind === 'learn' ? `<div class="lang">🎓 ${langNames[v.lang] || v.lang} · 60-sec lesson</div>` : ''}
    </div>
    <div class="rail">
      <button data-act="tip" class="tipbtn">RWF<span class="cnt" style="color:#1b1500">tip</span></button>
      <button data-act="like">♥<span class="cnt">${fmt(v.likes)}</span></button>
      <button data-act="sound">🔇</button>
      <button data-act="share">↗<span class="cnt">share</span></button>
      <button data-act="report" title="Report">⚑<span class="cnt">report</span></button>
    </div>
  </section>`;
}

async function feedClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) {
    const vid = e.target.closest('video');
    if (vid) vid.paused ? vid.play() : vid.pause();
    return;
  }
  const slide = btn.closest('.slide');
  const videoId = Number(slide.dataset.vid);
  const act = btn.dataset.act;

  if (act === 'like') {
    const r = await api(`/api/videos/${videoId}/like`, { method: 'POST' });
    $('.cnt', btn).textContent = fmt(r.likes);
  } else if (act === 'sound') {
    const v = $('video', slide);
    v.muted = !v.muted;
    btn.firstChild.textContent = v.muted ? '🔇' : '🔊';
  } else if (act === 'tip') {
    openTipSheet(videoId, slide.dataset.creator);
  } else if (act === 'share') {
    shareVideo(slide);
  } else if (act === 'report') {
    const reason = prompt('Why are you reporting this video?') ?? '';
    if (reason !== null) {
      await api(`/api/videos/${videoId}/report`, { method: 'POST', json: { reason } }).catch(() => {});
      toast('Reported. Our team will review it.');
    }
  } else if (act === 'profile') {
    renderProfile(Number(slide.dataset.creator));
  }
}

// ---------- tipping ----------
function openTipSheet(videoId, creatorId) {
  const creator = users.find((u) => u.id === Number(creatorId));
  let amount = 500;
  const s = openSheet(`
    <h2>Tip ${creator ? esc(creator.name) : 'creator'}</h2>
    <p class="dim">80% goes to the creator, instantly into their Hobe wallet.</p>
    <div class="chips">
      ${[100, 200, 500, 1000, 2000].map((a) => `<button class="chip ${a === 500 ? 'on' : ''}" data-amt="${a}">${fmt(a)}</button>`).join('')}
    </div>
    <label>Pay from MoMo number</label>
    <input id="tipphone" value="${me?.phone ?? ''}" inputmode="tel">
    <button class="primary" id="sendtip">Send ${fmt(amount)} RWF</button>
    <p class="dim center" style="margin-top:8px">Simulator: numbers ending 99 fail, ending 77 hang.</p>
  `);
  $('.chips', s).onclick = (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    s.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
    c.classList.add('on');
    amount = Number(c.dataset.amt);
    $('#sendtip').textContent = `Send ${fmt(amount)} RWF`;
  };
  $('#sendtip').onclick = async () => {
    const phone = $('#tipphone').value.trim();
    s.innerHTML = `<div class="center"><div class="spin"></div><p style="margin-top:12px">Sending MoMo request…</p>
      <p class="dim">Approve the payment prompt on the payer's phone.</p></div>`;
    try {
      const txn = await api('/api/tips', { method: 'POST', json: { video_id: videoId, amount, payer_phone: phone } });
      const done = await pollTxn(txn.id);
      if (done.status === 'success') {
        const cut = amount - Math.floor(amount * 0.15) - Math.floor(amount * 0.05); // mirrors server split
        s.innerHTML = `<div class="center"><div class="bigicon">🎉</div>
          <h2>Murakoze! Tip sent</h2>
          <p class="dim">${fmt(amount)} RWF sent — ${creator ? esc(creator.name) : 'the creator'} receives <b class="ok">${fmt(cut)} RWF</b> in their wallet right now.</p>
          <button class="primary" style="margin-top:14px" onclick="window.__closeSheet()">Done</button></div>`;
      } else if (done.status === 'failed') {
        s.innerHTML = `<div class="center"><div class="bigicon">😕</div><h2>Payment failed</h2>
          <p class="dim">${esc(done.fail_reason || 'The MoMo payment did not complete.')}</p>
          <button class="primary" style="margin-top:14px" onclick="window.__closeSheet()">Close</button></div>`;
      } else {
        s.innerHTML = `<div class="center"><div class="bigicon">⏳</div><h2>Still pending</h2>
          <p class="dim">The payment prompt hasn't been approved yet. It will land automatically if approved.</p>
          <button class="primary" style="margin-top:14px" onclick="window.__closeSheet()">Close</button></div>`;
      }
    } catch (err) {
      s.innerHTML = `<div class="center"><div class="bigicon">⚠️</div><h2>Error</h2><p class="dim">${esc(err.message)}</p>
        <button class="primary" style="margin-top:14px" onclick="window.__closeSheet()">Close</button></div>`;
    }
  };
}
window.__closeSheet = closeSheet;

// ---------- share (offline P2P, honest version) ----------
async function shareVideo(slide) {
  const src = $('video', slide).getAttribute('src');
  const title = $('.vtitle', slide).textContent;
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const file = new File([blob], src.split('/').pop(), { type: 'video/mp4' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return;
    }
  } catch { /* fall through */ }
  // Fallback: save for offline playback in this app
  try {
    const cache = await caches.open('hobe-videos');
    await cache.add(src);
    toast('Saved for offline. Wi-Fi Direct phone-to-phone needs the native wrapper — see README.');
  } catch {
    toast('Sharing not available in this browser.');
  }
}

// ---------- profile + storefront ----------
async function renderProfile(creatorId) {
  const c = await api(`/api/creators/${creatorId}`);
  const init = c.name.split(' ').map((w) => w[0]).slice(0, 2).join('');
  view.innerHTML = `
  <div class="panel">
    <button class="ghost" id="back">← Back</button>
    <div class="card" style="margin-top:10px">
      <div class="row">
        <div class="who">
          <div class="avatar" style="background:${c.color};width:48px;height:48px;font-size:18px">${init}</div>
          <div><h2 style="margin:0">${esc(c.name)}</h2><div class="dim">@${c.handle}</div></div>
        </div>
        <div style="text-align:right"><div class="big" style="font-size:20px">${fmt(c.tips_total)}</div><div class="dim">RWF tipped</div></div>
      </div>
      <p style="margin-top:10px;font-size:14px">${esc(c.bio)}</p>
    </div>
    ${c.products.length ? `<h3>Shop</h3>${c.products.map(productCard).join('')}` : ''}
    <h3>Videos</h3>
    ${c.videos.map((v) => `<div class="card row"><span>${esc(v.title)}</span><span class="dim">${fmt(v.views)} views</span></div>`).join('') || '<p class="dim">None yet.</p>'}
  </div>`;
  $('#back').onclick = () => setTab(state.tab);
  bindBuyButtons();
}

function productCard(p) {
  return `<div class="card row" data-pid="${p.id}">
    <div class="row" style="gap:12px">
      <div class="product-thumb" style="background:${p.creator_color || '#241f33'}">🛍</div>
      <div><b>${esc(p.title)}</b><div class="dim">${esc(p.description || '')}</div></div>
    </div>
    <div style="text-align:right">
      <div style="font-weight:800">${fmt(p.price)} RWF</div>
      <button class="ghost buybtn" style="margin-top:6px">Buy</button>
    </div>
  </div>`;
}

async function renderMarket() {
  const products = await api('/api/products');
  let orders = [];
  try { orders = await api('/api/orders'); } catch { /* not signed in */ }
  view.innerHTML = `
  <div class="panel">
    <h2>Market</h2>
    <p class="dim">Buy directly from creators. Your money sits in escrow until you confirm delivery — then the creator is paid, minus 4%.</p>
    ${products.map(productCard).join('') || '<p class="dim">No products yet.</p>'}
    ${orders.length ? `<h3>Your orders</h3>${orders.map(orderCard).join('')}` : ''}
  </div>`;
  bindBuyButtons();
  bindOrderButtons();
}

function orderCard(o) {
  const mine = o.buyer_user_id === me?.id;
  const badge = {
    pending_payment: '<span class="warn">payment pending…</span>',
    in_escrow: '<span class="warn">in escrow — awaiting delivery</span>',
    released: '<span class="ok">delivered · paid out</span>',
    refunded: '<span class="dim">refunded</span>',
    failed: '<span class="bad">payment failed</span>',
  }[o.status] || o.status;
  return `<div class="card" data-oid="${o.id}">
    <div class="row"><b>${esc(o.product_title)}</b><span>${fmt(o.amount)} RWF</span></div>
    <div class="row" style="margin-top:8px">${badge}
      ${o.status === 'in_escrow' && mine ? '<button class="ghost confirmbtn">📦 I received it</button>' : ''}
    </div>
  </div>`;
}

function bindBuyButtons() {
  view.querySelectorAll('.buybtn').forEach((b) => {
    b.onclick = async () => {
      const pid = Number(b.closest('[data-pid]').dataset.pid);
      const s = openSheet(`
        <h2>Confirm purchase</h2>
        <p class="dim">Payment is held in escrow until you confirm delivery.</p>
        <label>Pay from MoMo number</label>
        <input id="buyphone" value="${me?.phone ?? ''}" inputmode="tel">
        <button class="primary" id="dobuy">Pay with MoMo</button>`);
      $('#dobuy').onclick = async () => {
        const phone = $('#buyphone').value.trim();
        s.innerHTML = '<div class="center"><div class="spin"></div><p style="margin-top:12px">Requesting MoMo payment…</p></div>';
        try {
          const order = await api('/api/orders', { method: 'POST', json: { product_id: pid, payer_phone: phone } });
          const done = await pollTxn(order.txn_id);
          if (done.status === 'success') {
            s.innerHTML = `<div class="center"><div class="bigicon">📦</div><h2>Paid — held in escrow</h2>
              <p class="dim">The creator ships your order. Confirm delivery in Market → Your orders to release their money.</p>
              <button class="primary" style="margin-top:14px" onclick="window.__closeSheet()">Done</button></div>`;
          } else {
            s.innerHTML = `<div class="center"><div class="bigicon">😕</div><h2>Payment ${done.status}</h2>
              <button class="primary" style="margin-top:14px" onclick="window.__closeSheet()">Close</button></div>`;
          }
          if (state.tab === 'market') renderMarket();
        } catch (err) {
          s.innerHTML = `<div class="center"><h2>Error</h2><p class="dim">${esc(err.message)}</p>
            <button class="primary" style="margin-top:14px" onclick="window.__closeSheet()">Close</button></div>`;
        }
      };
    };
  });
}

function bindOrderButtons() {
  view.querySelectorAll('.confirmbtn').forEach((b) => {
    b.onclick = async () => {
      const oid = Number(b.closest('[data-oid]').dataset.oid);
      try {
        await api(`/api/orders/${oid}/confirm-delivery`, { method: 'POST' });
        toast('Delivery confirmed — creator paid (minus 4% commission)');
        renderMarket();
      } catch (err) { toast(err.message); }
    };
  });
}

// ---------- wallet ----------
async function renderWallet() {
  if (!me) { view.innerHTML = '<div class="empty">Pick a user first.</div>'; return; }
  let w;
  try { w = await api('/api/wallet'); } catch (err) {
    view.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return;
  }
  const kindLabel = {
    tip_split: 'Tip received', escrow_release: 'Sale (escrow released)',
    withdrawal: 'Cashout to MoMo', commission: 'Commission', refund: 'Refund',
  };
  view.innerHTML = `
  <div class="panel">
    <h2>${esc(me.name)} — Wallet</h2>
    <div class="card center">
      <div class="dim">Available</div>
      <div class="big">${fmt(w.available)} <span style="font-size:15px">RWF</span></div>
      <div class="dim">MoMo ${w.momo_number}${w.pending_withdrawals ? ` · ${fmt(w.pending_withdrawals)} RWF cashing out…` : ''}</div>
      <div style="margin-top:12px">
        <label style="display:block;text-align:left">Withdraw to my MoMo — arrives today</label>
        <input id="wdamount" inputmode="numeric" placeholder="Amount in RWF" value="${w.available > 0 ? w.available : ''}">
        <button class="primary" id="wdbtn" ${w.available < 100 ? 'disabled' : ''}>Cash out now</button>
      </div>
    </div>
    <h3>Activity</h3>
    <div class="card">
      ${w.entries.map((e) => `<div class="entry">
        <span>${kindLabel[e.kind] || e.kind}<br><span class="dim">${new Date(e.created_at * 1000).toLocaleString()}</span></span>
        <b class="${e.amount > 0 ? 'ok' : ''}">${e.amount > 0 ? '+' : ''}${fmt(e.amount)}</b>
      </div>`).join('') || '<p class="dim">No activity yet. Tips land here instantly.</p>'}
    </div>
  </div>`;
  $('#wdbtn')?.addEventListener('click', async () => {
    const amount = Number($('#wdamount').value);
    const btn = $('#wdbtn');
    btn.disabled = true; btn.textContent = 'Sending to MoMo…';
    try {
      const txn = await api('/api/withdrawals', { method: 'POST', json: { amount } });
      const done = await pollTxn(txn.id);
      if (done.status === 'success') toast(`✅ ${fmt(amount)} RWF sent to ${me.phone}`);
      else toast(`Cashout ${done.status}${done.fail_reason ? ': ' + done.fail_reason : ''}`);
    } catch (err) { toast(err.message); }
    renderWallet();
  });
}

// ---------- upload ----------
function renderUpload() {
  view.innerHTML = `
  <div class="panel">
    <h2>Upload</h2>
    <div class="card">
      <label>Video file (from your phone camera or gallery)</label>
      <input type="file" id="vfile" accept="video/*">
      <label>Title</label>
      <input id="vtitle" placeholder="e.g. Intore routine, maize spacing lesson…">
      <label>Feed</label>
      <select id="vkind">
        <option value="watch">Watch — entertainment feed</option>
        <option value="learn">Learn — 60-second lesson</option>
      </select>
      <label>Language</label>
      <select id="vlang">
        <option value="rw">Kinyarwanda</option><option value="en">English</option>
        <option value="fr">Français</option><option value="sw">Kiswahili</option>
      </select>
      <button class="primary" id="upbtn" style="margin-top:10px">Upload</button>
      <p class="dim" style="margin-top:8px">The server recompresses every upload to H.264 480p ≈450 kbps so it streams on 3G.</p>
    </div>
  </div>`;
  $('#upbtn').onclick = async () => {
    const f = $('#vfile').files[0];
    if (!f) return toast('Choose a video first');
    const fd = new FormData();
    fd.append('title', $('#vtitle').value || f.name);
    fd.append('kind', $('#vkind').value);
    fd.append('lang', $('#vlang').value);
    fd.append('video', f);
    const btn = $('#upbtn');
    btn.disabled = true; btn.textContent = 'Uploading & compressing…';
    try {
      const v = await api('/api/videos', { method: 'POST', body: fd });
      toast(v.transcoded ? '✅ Uploaded and compressed for 3G' : '⚠️ Uploaded (ffmpeg missing — stored uncompressed)');
      setTab(v.kind);
    } catch (err) {
      toast(err.message);
      btn.disabled = false; btn.textContent = 'Upload';
    }
  };
}

// ---------- tabs ----------
function setTab(tab) {
  state.tab = tab === 'upload' ? state.tab : tab;
  document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  observer?.disconnect();
  render(tab);
}
function render(tab = state.tab) {
  if (tab === 'watch' || tab === 'learn') renderFeed(tab);
  else if (tab === 'market') renderMarket();
  else if (tab === 'wallet') renderWallet();
  else if (tab === 'upload') renderUpload();
}
$('#tabs').onclick = (e) => {
  const b = e.target.closest('.tab');
  if (b) setTab(b.dataset.tab);
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
loadUsers().then(() => render()).catch(() => {
  view.innerHTML = '<div class="empty">Cannot reach the server. Is it running?</div>';
});
