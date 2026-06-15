/* Hobe PWA — vanilla JS, no framework. Total JS shipped to the phone: this file. */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const fmt = (n) => Number(n).toLocaleString('en-US');
const icon = (id, cls = 'ic') => `<svg class="${cls}"><use href="#${id}"/></svg>`;
const statusIc = (kind, id) => `<div class="statusic ${kind}"><svg><use href="#${id}"/></svg></div>`;

// ---------- state ----------
let me = null;
let token = localStorage.getItem('hobe_token') || null;
const state = { tab: 'watch' };

// ---------- api ----------
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.json) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  const res = await fetch(path, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ---------- helpers ----------
function avatarHtml(u, size = 36) {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px`;
  if (u.avatar) {
    return `<img class="avatar" style="${style};object-fit:cover" src="/avatars/${u.avatar}" alt="">`;
  }
  const name = u.name || '?';
  const init = name.split(' ').map((w) => w[0]).slice(0, 2).join('');
  return `<div class="avatar" style="background:${u.color || '#242936'};${style}">${esc(init)}</div>`;
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

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
window.__closeSheet = closeSheet;
const doneBtn = (label = 'Done') => `<button class="primary" style="margin-top:14px" onclick="window.__closeSheet()">${label}</button>`;

// ---------- auth ----------
async function fetchMe() {
  if (!token) { me = null; renderUserPill(); return; }
  try { me = await api('/api/me'); }
  catch { me = null; token = null; localStorage.removeItem('hobe_token'); }
  renderUserPill();
}
function setAuth(r) {
  token = r.token; me = r.user;
  localStorage.setItem('hobe_token', token);
  renderUserPill();
}
function renderUserPill() {
  $('#userpill').textContent = me ? me.name.split(' ')[0] : 'Sign in';
}

function openLoginSheet(afterLogin) {
  openSheet(`
    <h2>Sign in</h2>
    <p class="dim">Your number is your account — it's where your money goes.</p>
    <label>Phone number</label>
    <input id="lphone" inputmode="tel" placeholder="07XX XXX XXX" autocomplete="tel">
    <label>Password</label>
    <input id="lpass" type="password" autocomplete="current-password">
    <button class="primary" id="dologin" style="margin-top:10px">Sign in</button>
    <p class="dim center" style="margin-top:14px">New on Hobe? <a href="#" id="gosignup" style="color:var(--gold)">Create an account</a></p>
  `);
  $('#dologin').onclick = async () => {
    try {
      setAuth(await api('/api/auth/login', { method: 'POST', json: { phone: $('#lphone').value, password: $('#lpass').value } }));
      closeSheet(); toast(`Welcome back, ${me.name.split(' ')[0]}`);
      (afterLogin ?? render)();
    } catch (err) { toast(err.message); }
  };
  $('#gosignup').onclick = (e) => { e.preventDefault(); openSignupSheet(afterLogin); };
}

function openSignupSheet(afterLogin) {
  openSheet(`
    <h2>Create your account</h2>
    <p class="dim">Free. Your MoMo number becomes your payout wallet. You can add a profile photo right after.</p>
    <label>Your name</label>
    <input id="sname" placeholder="Name people will see" autocomplete="name">
    <label>Phone number (MTN or Airtel)</label>
    <input id="sphone" inputmode="tel" placeholder="07XX XXX XXX" autocomplete="tel">
    <label>Password</label>
    <input id="spass" type="password" placeholder="At least 6 characters" autocomplete="new-password">
    <button class="primary" id="dosignup" style="margin-top:10px">Create account</button>
    <p class="dim center" style="margin-top:14px">Already have one? <a href="#" id="gologin" style="color:var(--gold)">Sign in</a></p>
  `);
  $('#dosignup').onclick = async () => {
    try {
      setAuth(await api('/api/auth/signup', { method: 'POST', json: { name: $('#sname').value, phone: $('#sphone').value, password: $('#spass').value } }));
      closeSheet(); toast(`Karibu, ${me.name.split(' ')[0]}! Your wallet is ready.`);
      openAccountSheet(); // straight to the account sheet so they can add a photo
    } catch (err) { toast(err.message); }
  };
  $('#gologin').onclick = (e) => { e.preventDefault(); openLoginSheet(afterLogin); };
}

function openAccountSheet() {
  const s = openSheet(`
    <div class="row" style="justify-content:flex-start;gap:14px">
      <div style="position:relative" id="avwrap">
        ${avatarHtml(me, 64)}
        <button id="changephoto" class="photobtn" title="Change photo">${icon('i-camera')}</button>
      </div>
      <div>
        <h2 style="margin:0">${esc(me.name)}</h2>
        <p class="dim">@${me.handle} · ${esc(me.phone)}</p>
      </div>
    </div>
    <input type="file" id="avfile" accept="image/*" style="display:none">
    ${me.avatar ? '' : '<button class="primary" id="addphoto" style="width:100%;margin-top:14px">Add a profile photo</button>'}
    <button class="ghost" id="myprofile" style="width:100%;margin-top:10px">My videos & profile</button>
    <button class="ghost" id="savedvids" style="width:100%;margin-top:8px">Saved videos</button>
    <button class="ghost" id="dologout" style="width:100%;margin-top:8px">Log out</button>
    <p class="dim center" style="margin-top:14px"><a href="/privacy.html" style="color:var(--dim)">Privacy policy</a></p>
  `);
  $('#changephoto').onclick = () => $('#avfile').click();
  $('#avfile').onchange = async () => {
    const f = $('#avfile').files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('photo', f);
    $('#avwrap').style.opacity = '.4';
    try {
      const r = await api('/api/me/avatar', { method: 'POST', body: fd });
      me.avatar = r.avatar;
      toast('Profile photo updated');
      openAccountSheet(); // re-render with new photo
    } catch (err) {
      toast(err.message);
      $('#avwrap').style.opacity = '1';
    }
  };
  $('#addphoto')?.addEventListener('click', () => $('#avfile').click());
  $('#myprofile').onclick = () => { closeSheet(); renderProfile(me.id); };
  $('#savedvids').onclick = () => { closeSheet(); renderSaved(); };
  $('#dologout').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    token = null; me = null;
    localStorage.removeItem('hobe_token');
    renderUserPill(); closeSheet(); render();
  };
  void s;
}

$('#userpill').onclick = () => (me ? openAccountSheet() : openLoginSheet());

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

// ---------- feed ----------
let observer = null;

function mountFeed(vids, kind, emptyHtml) {
  if (!vids.length) { view.innerHTML = emptyHtml; return; }
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

async function renderFeed(kind) {
  mountFeed(await api(`/api/feed?kind=${kind}`), kind,
    `<div class="empty"><p>No videos yet.</p><p>Tap the + button to upload the first one.</p></div>`);
}

async function renderSaved() {
  if (!me) return openLoginSheet(() => renderSaved());
  mountFeed(await api('/api/saved'), 'watch',
    `<div class="empty"><p>No saved videos yet.</p><p>Tap the bookmark on any video to save it here.</p></div>`);
}

function slideHtml(v, kind) {
  const langNames = { rw: 'Kinyarwanda', en: 'English', fr: 'Français', sw: 'Kiswahili' };
  return `
  <section class="slide" data-vid="${v.id}" data-creator="${v.user_id}" data-cname="${esc(v.creator_name)}">
    <video src="/videos/${v.filename}" loop playsinline preload="${kind === 'watch' ? 'auto' : 'metadata'}" muted></video>
    <div class="overlay">
      <div class="who" data-act="profile">
        ${avatarHtml({ name: v.creator_name, color: v.creator_color, avatar: v.creator_avatar }, 36)}
        <div><div class="handle">@${v.creator_handle}</div></div>
      </div>
      <div class="vtitle">${esc(v.title)}</div>
      ${v.kind === 'learn' ? `<div class="lang"><span class="tagpill">${langNames[v.lang] || v.lang} · 60-sec lesson</span></div>` : ''}
    </div>
    <div class="rail">
      <button data-act="tip" class="tipbtn"><span>RWF</span><span class="cnt">tip</span></button>
      <button data-act="like">${icon('i-heart')}<span class="cnt">${fmt(v.likes)}</span></button>
      <button data-act="save" class="${v.saved ? 'on' : ''}">${icon('i-bookmark')}<span class="cnt">save</span></button>
      <button data-act="repost" class="${v.reposted ? 'on' : ''}">${icon('i-repost')}<span class="cnt">${fmt(v.repost_count || 0)}</span></button>
      <button data-act="sound">${icon('i-mute')}</button>
      <button data-act="share">${icon('i-share')}<span class="cnt">share</span></button>
      <button data-act="report" title="Report this video">${icon('i-flag')}</button>
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
    btn.classList.add('liked');
  } else if (act === 'save') {
    if (!me) return openLoginSheet();
    try {
      const r = await api(`/api/videos/${videoId}/save`, { method: 'POST' });
      btn.classList.toggle('on', r.saved);
      toast(r.saved ? 'Saved to your collection' : 'Removed from saved');
    } catch (err) { toast(err.message); }
  } else if (act === 'repost') {
    if (!me) return openLoginSheet();
    try {
      const r = await api(`/api/videos/${videoId}/repost`, { method: 'POST' });
      btn.classList.toggle('on', r.reposted);
      $('.cnt', btn).textContent = fmt(r.count);
      toast(r.reposted ? 'Reposted to your profile' : 'Repost removed');
    } catch (err) { toast(err.message); }
  } else if (act === 'sound') {
    const v = $('video', slide);
    v.muted = !v.muted;
    $('use', btn).setAttribute('href', v.muted ? '#i-mute' : '#i-sound');
  } else if (act === 'tip') {
    openTipSheet(videoId, slide.dataset.cname);
  } else if (act === 'share') {
    shareVideo(slide);
  } else if (act === 'report') {
    const reason = prompt('Why are you reporting this video?');
    if (reason !== null) {
      await api(`/api/videos/${videoId}/report`, { method: 'POST', json: { reason } }).catch(() => {});
      toast('Reported. Our team will review it.');
    }
  } else if (act === 'profile') {
    renderProfile(Number(slide.dataset.creator));
  }
}

// ---------- tipping ----------
function openTipSheet(videoId, creatorName) {
  let amount = 500;
  const s = openSheet(`
    <h2>Tip ${esc(creatorName || 'this creator')}</h2>
    <p class="dim">80% goes to the creator, instantly into their Hobe wallet.</p>
    <div class="chips">
      ${[100, 200, 500, 1000, 2000].map((a) => `<button class="chip ${a === 500 ? 'on' : ''}" data-amt="${a}">${fmt(a)}</button>`).join('')}
    </div>
    <label>Pay from MoMo number</label>
    <input id="tipphone" inputmode="tel" value="${me?.phone ?? ''}" placeholder="07XX XXX XXX">
    <button class="primary" id="sendtip" style="margin-top:8px">Send ${fmt(amount)} RWF</button>
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
    s.innerHTML = `<div class="center"><div class="spin"></div><p style="margin-top:14px">Sending MoMo request…</p>
      <p class="dim">Approve the payment prompt on the payer's phone.</p></div>`;
    try {
      const txn = await api('/api/tips', { method: 'POST', json: { video_id: videoId, amount, payer_phone: phone } });
      const done = await pollTxn(txn.id);
      if (done.status === 'success') {
        const cut = amount - Math.floor(amount * 0.15) - Math.floor(amount * 0.05); // mirrors server split
        s.innerHTML = `<div class="center">${statusIc('s-ok', 'i-check')}
          <h2>Murakoze! Tip sent</h2>
          <p class="dim">${fmt(amount)} RWF sent — ${esc(creatorName || 'the creator')} receives <b class="ok">${fmt(cut)} RWF</b> in their wallet right now.</p>
          ${doneBtn()}</div>`;
      } else if (done.status === 'failed') {
        s.innerHTML = `<div class="center">${statusIc('s-bad', 'i-x')}<h2>Payment failed</h2>
          <p class="dim">${esc(done.fail_reason || 'The MoMo payment did not complete.')}</p>${doneBtn('Close')}</div>`;
      } else {
        s.innerHTML = `<div class="center">${statusIc('s-wait', 'i-clock')}<h2>Still pending</h2>
          <p class="dim">The payment prompt hasn't been approved yet. It will land automatically if approved.</p>${doneBtn('Close')}</div>`;
      }
    } catch (err) {
      s.innerHTML = `<div class="center">${statusIc('s-bad', 'i-x')}<h2>Error</h2><p class="dim">${esc(err.message)}</p>${doneBtn('Close')}</div>`;
    }
  };
}

// ---------- share ----------
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
  try {
    const cache = await caches.open('hobe-videos');
    await cache.add(src);
    toast('Saved for offline watching on this phone.');
  } catch {
    toast('Sharing not available in this browser.');
  }
}

// ---------- profile (with own-video management) ----------
async function renderProfile(creatorId) {
  const c = await api(`/api/creators/${creatorId}`);
  const mine = me && Number(me.id) === Number(c.id);
  view.innerHTML = `
  <div class="panel">
    <button class="ghost" id="back" style="display:flex;align-items:center;gap:6px">${icon('i-back')} Back</button>
    <div class="card" style="margin-top:10px">
      <div class="row">
        <div class="who">
          ${avatarHtml(c, 50)}
          <div><h2 style="margin:0">${esc(c.name)}</h2><div class="dim">@${c.handle}</div></div>
        </div>
        <div style="text-align:right"><div class="big" style="font-size:21px">${fmt(c.tips_total)}</div><div class="dim">RWF tipped</div></div>
      </div>
      <p style="margin-top:10px;font-size:14px">${esc(c.bio)}</p>
    </div>
    ${c.products.length ? `<h3>Shop</h3>${c.products.map(productCard).join('')}` : ''}
    <h3>${mine ? 'My videos' : 'Videos'}</h3>
    ${c.videos.map((v) => `
      <div class="card row" data-mvid="${v.id}" data-mtitle="${esc(v.title)}">
        <div style="min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.title)}</div>
          <div class="dim">${fmt(v.views)} views · ${fmt(v.likes)} likes</div></div>
        ${mine ? `<div style="display:flex;gap:8px;flex:none">
          <button class="ghost editvid" title="Edit caption">${icon('i-edit')}</button>
          <button class="ghost delvid" title="Delete video" style="color:var(--bad)">${icon('i-trash')}</button>
        </div>` : ''}
      </div>`).join('') || '<p class="dim">None yet.</p>'}
    ${c.reposts && c.reposts.length ? `<h3>Reposts</h3>${c.reposts.map((v) => `
      <div class="card row repost-row" data-rcreator="${v.user_id}">
        <div style="min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.title)}</div>
          <div class="dim">@${v.creator_handle}</div></div>
        <span style="flex:none;color:var(--gold)">${icon('i-repost')}</span>
      </div>`).join('')}` : ''}
  </div>`;
  $('#back').onclick = () => setTab(state.tab);
  bindBuyButtons();
  view.querySelectorAll('.repost-row').forEach((r) => { r.onclick = () => renderProfile(Number(r.dataset.rcreator)); });

  if (mine) {
    view.querySelectorAll('.editvid').forEach((b) => {
      b.onclick = async () => {
        const card = b.closest('[data-mvid]');
        const newTitle = prompt('New caption:', card.dataset.mtitle);
        if (newTitle === null || !newTitle.trim()) return;
        try {
          await api(`/api/videos/${card.dataset.mvid}/edit`, { method: 'POST', json: { title: newTitle.trim() } });
          toast('Caption updated');
          renderProfile(creatorId);
        } catch (err) { toast(err.message); }
      };
    });
    view.querySelectorAll('.delvid').forEach((b) => {
      b.onclick = async () => {
        const card = b.closest('[data-mvid]');
        if (!confirm(`Delete "${card.dataset.mtitle}"? This cannot be undone.`)) return;
        try {
          await api(`/api/videos/${card.dataset.mvid}/delete`, { method: 'POST' });
          toast('Video deleted');
          renderProfile(creatorId);
        } catch (err) { toast(err.message); }
      };
    });
  }
}

function productCard(p) {
  return `<div class="card row" data-pid="${p.id}">
    <div class="row" style="gap:12px">
      <div class="product-thumb" style="background:${p.creator_color || '#242936'}">${icon('i-bag', '')}</div>
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
  if (me) { try { orders = await api('/api/orders'); } catch { /* session expired */ } }
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
      ${o.status === 'in_escrow' && mine ? '<button class="ghost confirmbtn">I received it</button>' : ''}
    </div>
  </div>`;
}

function bindBuyButtons() {
  view.querySelectorAll('.buybtn').forEach((b) => {
    b.onclick = async () => {
      if (!me) return openLoginSheet(() => renderMarket());
      const pid = Number(b.closest('[data-pid]').dataset.pid);
      const s = openSheet(`
        <h2>Confirm purchase</h2>
        <p class="dim">Payment is held in escrow until you confirm delivery.</p>
        <label>Pay from MoMo number</label>
        <input id="buyphone" inputmode="tel" value="${me?.phone ?? ''}">
        <button class="primary" id="dobuy" style="margin-top:8px">Pay with MoMo</button>`);
      $('#dobuy').onclick = async () => {
        const phone = $('#buyphone').value.trim();
        s.innerHTML = '<div class="center"><div class="spin"></div><p style="margin-top:14px">Requesting MoMo payment…</p></div>';
        try {
          const order = await api('/api/orders', { method: 'POST', json: { product_id: pid, payer_phone: phone } });
          const done = await pollTxn(order.txn_id);
          if (done.status === 'success') {
            s.innerHTML = `<div class="center">${statusIc('s-ok', 'i-check')}<h2>Paid — held in escrow</h2>
              <p class="dim">The creator ships your order. Confirm delivery in Market → Your orders to release their money.</p>${doneBtn()}</div>`;
          } else {
            s.innerHTML = `<div class="center">${statusIc('s-bad', 'i-x')}<h2>Payment ${done.status}</h2>${doneBtn('Close')}</div>`;
          }
          if (state.tab === 'market') renderMarket();
        } catch (err) {
          s.innerHTML = `<div class="center">${statusIc('s-bad', 'i-x')}<h2>Error</h2><p class="dim">${esc(err.message)}</p>${doneBtn('Close')}</div>`;
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
  if (!me) {
    view.innerHTML = `<div class="empty"><p>Your wallet lives behind your account.</p>
      <button class="primary" id="walletlogin" style="max-width:280px;margin:16px auto 0">Sign in</button></div>`;
    $('#walletlogin').onclick = () => openLoginSheet(() => renderWallet());
    return;
  }
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
      </div>`).join('') || '<p class="dim">No activity yet. Tips on your videos land here instantly.</p>'}
    </div>
  </div>`;
  $('#wdbtn')?.addEventListener('click', async () => {
    const amount = Number($('#wdamount').value);
    const btn = $('#wdbtn');
    btn.disabled = true; btn.textContent = 'Sending to MoMo…';
    try {
      const txn = await api('/api/withdrawals', { method: 'POST', json: { amount } });
      const done = await pollTxn(txn.id);
      if (done.status === 'success') toast(`${fmt(amount)} RWF sent to ${me.phone}`);
      else toast(`Cashout ${done.status}${done.fail_reason ? ': ' + done.fail_reason : ''}`);
    } catch (err) { toast(err.message); }
    renderWallet();
  });
}

// ---------- upload ----------
async function renderUpload() {
  if (!me) {
    view.innerHTML = `<div class="empty"><p>Sign in to post — tips on your videos go straight to your MoMo number.</p>
      <button class="primary" id="uploadlogin" style="max-width:280px;margin:16px auto 0">Sign in</button></div>`;
    $('#uploadlogin').onclick = () => openLoginSheet(() => renderUpload());
    return;
  }
  const tracks = await api('/api/tracks').catch(() => []);
  let mtype = 'video';
  let preview = null;
  view.innerHTML = `
  <div class="panel">
    <h2>Create a post</h2>
    <div class="card">
      <label>What are you posting?</label>
      <div class="seg" id="mtype">
        <button data-mt="video" class="on" type="button">Video</button>
        <button data-mt="image" type="button">Photo</button>
      </div>
      <label id="filelabel">Video file (camera or gallery)</label>
      <input type="file" id="vfile" accept="video/*">

      <label>Caption</label>
      <input id="vtitle" placeholder="Give it a caption people will tip for">

      <label>Sound (optional)</label>
      <select id="vtrack">
        <option value="">No music — keep original sound</option>
        ${tracks.map((t) => `<option value="${t.id}" data-file="${esc(t.filename)}">${esc(t.title)} · ${esc(t.artist)}</option>`).join('')}
      </select>
      <div class="row" style="gap:10px;margin-top:8px;justify-content:flex-start">
        <button class="ghost" id="preview" type="button">▶ Preview track</button>
        <span class="dim" style="font-size:12px">or</span>
        <label class="ghost" id="audiopick" style="cursor:pointer">Upload a song<input type="file" id="afile" accept="audio/*" style="display:none"></label>
      </div>
      <div class="dim" id="audioname" style="font-size:12px;margin-top:6px"></div>

      <label style="margin-top:6px">Feed</label>
      <select id="vkind">
        <option value="watch">Watch — entertainment feed</option>
        <option value="learn">Learn — 60-second lesson</option>
      </select>
      <label>Language</label>
      <select id="vlang">
        <option value="rw">Kinyarwanda</option><option value="en">English</option>
        <option value="fr">Français</option><option value="sw">Kiswahili</option>
      </select>
      <button class="primary" id="upbtn" style="margin-top:12px">Post</button>
      <p class="dim" style="margin-top:8px">Posts are compressed for 3G so viewers spend less data. A photo becomes a short video; add a song to make it move. You can edit the caption or delete a post later from your profile.</p>
    </div>
  </div>`;

  const stopPreview = () => { if (preview) { preview.pause(); preview = null; $('#preview').textContent = '▶ Preview track'; } };

  $('#mtype').onclick = (e) => {
    const b = e.target.closest('[data-mt]');
    if (!b) return;
    mtype = b.dataset.mt;
    $('#mtype').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    $('#vfile').setAttribute('accept', mtype === 'image' ? 'image/*' : 'video/*');
    $('#vfile').value = '';
    $('#filelabel').textContent = mtype === 'image' ? 'Photo (camera or gallery)' : 'Video file (camera or gallery)';
  };

  $('#preview').onclick = () => {
    const opt = $('#vtrack').selectedOptions[0];
    const file = opt?.dataset.file;
    if (!file) return toast('Pick a track first');
    if (preview) return stopPreview();
    preview = new Audio(`/tracks/${file}`);
    preview.play().then(() => { $('#preview').textContent = '■ Stop'; }).catch(() => toast('Could not play preview'));
    preview.onended = stopPreview;
  };

  $('#vtrack').onchange = () => { stopPreview(); if ($('#vtrack').value) { $('#afile').value = ''; $('#audioname').textContent = ''; } };
  $('#afile').onchange = () => {
    const f = $('#afile').files[0];
    $('#audioname').textContent = f ? `Using your song: ${f.name}` : '';
    if (f) { $('#vtrack').value = ''; stopPreview(); }
  };

  $('#upbtn').onclick = async () => {
    const f = $('#vfile').files[0];
    if (!f) return toast(mtype === 'image' ? 'Choose a photo first' : 'Choose a video first');
    stopPreview();
    const fd = new FormData();
    fd.append('title', $('#vtitle').value || f.name);
    fd.append('kind', $('#vkind').value);
    fd.append('lang', $('#vlang').value);
    fd.append(mtype, f);
    const audio = $('#afile').files[0];
    if (audio) fd.append('audio', audio);
    else if ($('#vtrack').value) fd.append('track_id', $('#vtrack').value);
    const btn = $('#upbtn');
    btn.disabled = true; btn.textContent = 'Posting & compressing…';
    try {
      const v = await api('/api/videos', { method: 'POST', body: fd });
      toast('Posted');
      setTab(v.kind);
    } catch (err) {
      toast(err.message);
      btn.disabled = false; btn.textContent = 'Post';
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
fetchMe().finally(() => render());
