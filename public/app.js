/* Hobe PWA — vanilla JS, no framework. Total JS shipped to the phone: this file. */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const fmt = (n) => Number(n).toLocaleString('en-US');
const icon = (id, cls = 'ic') => `<svg class="${cls}"><use href="#${id}"/></svg>`;
const statusIc = (kind, id) => `<div class="statusic ${kind}"><svg><use href="#${id}"/></svg></div>`;
function parseTags(text) {
  const tags = String(text ?? '').match(/#[\p{L}0-9_]+/gu) || [];
  const caption = String(text ?? '').replace(/#[\p{L}0-9_]+/gu, '').replace(/\s+/g, ' ').trim();
  return { caption, tags };
}

// ---------- video quality (adaptive renditions) ----------
function qualityPref() { return localStorage.getItem('hobe_quality') || 'auto'; }
function chosenRendition() {
  const pref = qualityPref();
  if (pref === 'high') return '1080';
  if (pref === 'low') return '480';
  const c = navigator.connection || {};
  if (c.saveData) return '480';
  const et = c.effectiveType || '';
  if (et === 'slow-2g' || et === '2g' || et === '3g') return '480';
  const small = Math.min(screen.width || 9999, screen.height || 9999) <= 480;
  return small ? '720' : '1080';
}
function videoSrc(v) {
  let r = null; try { r = v.renditions ? JSON.parse(v.renditions) : null; } catch {}
  if (!r || !r.length) return `/videos/${v.filename}`;
  const order = ['1080', '720', '480'];
  const want = chosenRendition();
  let pick = r.includes(want) ? want : null;
  if (!pick) { const wi = order.indexOf(want); pick = order.slice(wi).find((x) => r.includes(x)) || order.find((x) => r.includes(x)) || r[r.length - 1]; }
  return `/videos/${v.filename}_${pick}.mp4`;
}

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
    <button class="ghost" id="advertise" style="width:100%;margin-top:8px">Advertise on Hobe</button>
    ${me.is_admin ? '<button class="ghost" id="adadmin" style="width:100%;margin-top:8px">Ad review (admin)</button>' : ''}
    <div style="margin-top:12px">
      <label style="font-size:13px">Video quality</label>
      <div class="chips" id="qchips">
        <button class="chip" data-q="auto">Auto</button>
        <button class="chip" data-q="high">HD</button>
        <button class="chip" data-q="low">Data saver</button>
      </div>
    </div>
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
  const qc = $('#qchips'); if (qc) {
    const cur = qualityPref();
    qc.querySelectorAll('.chip').forEach((c) => { c.classList.toggle('on', c.dataset.q === cur); c.onclick = () => { localStorage.setItem('hobe_quality', c.dataset.q); qc.querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); c.classList.add('on'); toast('Quality set'); }; });
  }
  const advb = $('#advertise'); if (advb) advb.onclick = () => { closeSheet(); renderAdvertiser(); };
  const adm = $('#adadmin'); if (adm) adm.onclick = () => { closeSheet(); renderAdmin(); };
  void s;
}

$('#userpill').onclick = () => (me ? openAccountSheet() : openLoginSheet());
const __searchbtn = $('#searchbtn'); if (__searchbtn) __searchbtn.onclick = () => renderSearch();

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
  view.innerHTML = `<div class="feed">${vids.map((v) => v.is_ad ? adSlideHtml(v) : slideHtml(v, kind)).join('')}</div>`;

  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const video = $('video', en.target);
      if (!video) continue;
      if (en.isIntersecting && en.intersectionRatio > 0.6) {
        video.play().catch(() => {});
        video.ontimeupdate = () => {
          const bar = $('.vbar i', en.target);
          if (bar && video.duration) bar.style.width = `${(video.currentTime / video.duration) * 100}%`;
        };
        if (!en.target.dataset.viewed) {
          en.target.dataset.viewed = '1';
          if (en.target.dataset.ad) api(`/api/ads/${en.target.dataset.ad}/impression`, { method: 'POST' }).catch(() => {});
          else api(`/api/videos/${en.target.dataset.vid}/view`, { method: 'POST' }).catch(() => {});
        }
      } else {
        video.pause();
      }
    }
  }, { threshold: [0, 0.6] });
  view.querySelectorAll('.slide').forEach((s) => observer.observe(s));

  $('.feed').onclick = feedClick;
  document.onkeydown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const f = $('.feed'); if (!f) return;
    e.preventDefault();
    f.scrollBy({ top: (e.key === 'ArrowDown' ? 1 : -1) * f.clientHeight, behavior: 'smooth' });
  };
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

// ---------- search ----------
let searchTimer;
function renderSearch(initial = '') {
  observer?.disconnect();
  view.innerHTML = `
  <div class="panel">
    <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border-radius:12px;padding:11px 13px;margin:4px 0 14px">
      <svg class="ic" style="opacity:.55;flex:none"><use href="#i-search"/></svg>
      <input id="searchq" type="search" placeholder="Search videos, people, #tags" autocomplete="off" autocapitalize="off"
        style="flex:1;background:none;border:none;outline:none;color:inherit;font-size:16px" value="${esc(initial)}">
    </div>
    <div id="searchresults"><p class="dim center" style="margin-top:26px">Find creators and videos on Hobe.</p></div>
  </div>`;
  const input = $('#searchq');
  const box = $('#searchresults');
  const run = async () => {
    const q = input.value.trim();
    if (!q) { box.innerHTML = '<p class="dim center" style="margin-top:26px">Find creators and videos on Hobe.</p>'; return; }
    try {
      const { creators, videos } = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (!creators.length && !videos.length) {
        box.innerHTML = `<p class="dim center" style="margin-top:26px">No results for "${esc(q)}".</p>`;
        return;
      }
      const people = creators.length ? `<h3>People</h3>` + creators.map((c) => `
        <div class="card row searchuser" data-creator="${c.id}" style="cursor:pointer">
          <div class="who">${avatarHtml(c, 42)}
            <div><div style="display:flex;align-items:center;gap:4px">${esc(c.name)}${Number(c.verified) ? '<svg class="vrf"><use href="#i-verified"/></svg>' : ''}</div>
            <div class="dim">@${esc(c.handle)} · ${fmt(c.followers || 0)} followers</div></div></div>
        </div>`).join('') : '';
      const vids = videos.length ? `<h3>Videos</h3>` + videos.map((v) => {
        const { caption, tags } = parseTags(v.title);
        const label = caption || tags.join(' ') || 'Untitled';
        return `<div class="card row searchvid" data-vid="${v.id}" style="cursor:pointer">
          <div style="min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</div>
            <div class="dim">@${esc(v.creator_handle)} · ${fmt(v.likes)} likes · ${fmt(v.tip_count || 0)} tips</div></div>
          <span style="flex:none;color:var(--gold)">${icon('i-play')}</span>
        </div>`;
      }).join('') : '';
      box.innerHTML = people + vids;
      box.querySelectorAll('.searchuser').forEach((el) => { el.onclick = () => renderProfile(Number(el.dataset.creator)); });
      box.querySelectorAll('.searchvid').forEach((el) => { el.onclick = () => {
        const id = Number(el.dataset.vid);
        const ordered = [videos.find((x) => x.id === id), ...videos.filter((x) => x.id !== id)];
        mountFeed(ordered, 'watch', '');
      }; });
    } catch (err) { box.innerHTML = `<p class="dim center" style="margin-top:26px">${esc(err.message)}</p>`; }
  };
  input.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(run, 300); };
  input.onsearch = run;
  input.focus();
  if (initial) run();
}

function adSlideHtml(v) {
  const cap = (v.title || '').trim();
  return `
  <section class="slide ad" data-ad="${v.ad_id}" data-cta="${esc(v.cta_url || '')}">
    <video src="${videoSrc(v)}" loop playsinline preload="auto" muted></video>
    <div class="scrim"></div>
    <div class="rail">
      <button class="railbtn mutebtn" data-act="sound">${icon('i-mute')}</button>
    </div>
    <div class="creatorcard">
      <div class="cc-head">
        <span class="cc-id">
          <span class="cc-name">${esc(v.headline || 'Sponsored')} <span class="sponsored">Sponsored</span></span>
          <span class="cc-handle">Paid partnership</span>
        </span>
      </div>
      ${cap ? `<div class="cc-cap">${esc(cap)}</div>` : ''}
      ${v.cta_url ? `<button class="adcta" data-act="adcta">${esc(v.cta_label || 'Learn more')} \u2192</button>` : ''}
    </div>
    <div class="vbar"><i></i></div>
  </section>`;
}

function slideHtml(v, kind) {
  const langNames = { rw: 'Kinyarwanda', en: 'English', fr: 'Français', sw: 'Kiswahili' };
  const { caption, tags } = parseTags(v.title);
  const verified = Number(v.creator_verified) ? `<svg class="vrf"><use href="#i-verified"/></svg>` : '';
  return `
  <section class="slide" data-vid="${v.id}" data-creator="${v.user_id}" data-cname="${esc(v.creator_name)}">
    <video src="${videoSrc(v)}" loop playsinline preload="${kind === 'watch' ? 'auto' : 'metadata'}" muted></video>
    <div class="scrim"></div>
    <div class="rail">
      <button class="railbtn tipbtn" data-act="tip"><span class="ring">${icon('i-coin')}</span><span class="cnt">Tip</span></button>
      <button class="railbtn ${v.liked ? 'liked' : ''}" data-act="like">${icon('i-heart')}<span class="cnt">${fmt(v.likes)}</span></button>
      <button class="railbtn" data-act="comment">${icon('i-comment')}<span class="cnt">${fmt(v.comment_count || 0)}</span></button>
      <button class="railbtn ${v.saved ? 'on' : ''}" data-act="save">${icon('i-bookmark')}<span class="cnt">Save</span></button>
      <button class="railbtn ${v.reposted ? 'on' : ''}" data-act="repost">${icon('i-repost')}<span class="cnt">${fmt(v.repost_count || 0)}</span></button>
      <button class="railbtn" data-act="share">${icon('i-share')}<span class="cnt">Share</span></button>
      <button class="railbtn mutebtn" data-act="sound">${icon('i-mute')}</button>
      <button class="railbtn small" data-act="report" title="Report this video">${icon('i-flag')}</button>
    </div>
    <div class="creatorcard">
      <div class="cc-head">
        <span class="cc-av" data-act="profile">${avatarHtml({ name: v.creator_name, color: v.creator_color, avatar: v.creator_avatar }, 38)}</span>
        <span class="cc-id" data-act="profile">
          <span class="cc-name">${esc(v.creator_name)}${verified}</span>
          <span class="cc-handle">@${v.creator_handle}</span>
        </span>
        <button class="cc-follow ${v.following ? 'following' : ''}" data-act="follow">${v.following ? 'Following' : 'Follow'}</button>
      </div>
      ${caption ? `<div class="cc-cap">${esc(caption)}</div>` : ''}
      ${tags.length ? `<div class="cc-tags">${tags.map((t) => esc(t)).join(' ')}</div>` : ''}
      ${v.kind === 'learn' ? `<div class="cc-lesson">${langNames[v.lang] || v.lang} · 60-sec lesson</div>` : ''}
      <div class="cc-sound">${icon('i-music')}<span>${esc(v.sound || 'Original sound')}</span></div>
    </div>
    <div class="vbar"><i></i></div>
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

  if (act === 'adcta') {
    const adId = slide.dataset.ad; const url = slide.dataset.cta;
    if (adId) api(`/api/ads/${adId}/click`, { method: 'POST' }).catch(() => {});
    if (url) window.open(url, '_blank', 'noopener');
    return;
  }
  if (act === 'like') {
    if (!me) return openLoginSheet();
    try {
      const r = await api(`/api/videos/${videoId}/like`, { method: 'POST' });
      $('.cnt', btn).textContent = fmt(r.likes);
      btn.classList.toggle('liked', r.liked);
    } catch (err) { toast(err.message); }
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
  } else if (act === 'follow') {
    if (!me) return openLoginSheet();
    try {
      const r = await api(`/api/creators/${slide.dataset.creator}/follow`, { method: 'POST' });
      btn.classList.toggle('following', r.following);
      btn.textContent = r.following ? 'Following' : 'Follow';
    } catch (err) { toast(err.message); }
  } else if (act === 'comment') {
    openComments(videoId);
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
  const title = $('.cc-cap', slide)?.textContent || slide.dataset.cname || 'Hobe';
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
          <div><h2 style="margin:0;display:flex;align-items:center;gap:5px">${esc(c.name)}${Number(c.verified) ? '<svg class="vrf"><use href="#i-verified"/></svg>' : ''}</h2><div class="dim">@${c.handle}</div></div>
        </div>
        <div style="text-align:right"><div class="big" style="font-size:21px">${fmt(c.tips_total)}</div><div class="dim">RWF tipped</div></div>
      </div>
      <div class="row" style="margin-top:12px;gap:12px">
        <div style="font-size:14px"><b>${fmt(c.followers || 0)}</b> <span class="dim">followers</span></div>
        ${!mine ? `<button class="${c.following ? 'ghost' : 'primary'} pfollow" style="flex:1;max-width:200px">${c.following ? 'Following' : 'Follow'}</button>` : ''}
      </div>
      ${c.bio ? `<p style="margin-top:10px;font-size:14px">${esc(c.bio)}</p>` : ''}
    </div>
    ${c.products.length ? `<h3>Shop</h3>${c.products.map(productCard).join('')}` : ''}
    <h3>${mine ? 'My videos' : 'Videos'}</h3>
    ${c.videos.map((v) => `
      <div class="card row" data-mvid="${v.id}" data-mtitle="${esc(v.title)}">
        <div style="min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.title)}</div>
          <div class="dim">${v.status === 'processing' ? 'Processing…' : v.status === 'failed' ? 'Upload failed — delete and try again' : `${fmt(v.views)} views · ${fmt(v.likes)} likes`}</div></div>
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
  const pf = $('.pfollow', view);
  if (pf) pf.onclick = async () => {
    if (!me) return openLoginSheet(() => renderProfile(creatorId));
    try { await api(`/api/creators/${c.id}/follow`, { method: 'POST' }); renderProfile(creatorId); }
    catch (err) { toast(err.message); }
  };

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
    btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      const v = await api('/api/videos', { method: 'POST', body: fd });
      toast('Posted! Processing your video…');
      renderProfile(me.id); // they see it straight away, marked Processing
      pollProcessing(v.id);
    } catch (err) {
      toast(err.message);
      btn.disabled = false; btn.textContent = 'Post';
    }
  };
}

// After an instant post, quietly check until the background encode finishes,
// then refresh the profile so the video flips from "Processing…" to live.
function pollProcessing(id, tries = 0) {
  if (tries > 40) return; // give up after ~2 min; a reload will still show it
  setTimeout(async () => {
    let v;
    try { v = await api(`/api/videos/${id}`); }
    catch { return pollProcessing(id, tries + 1); }
    if (v.status === 'processing') return pollProcessing(id, tries + 1);
    toast(v.status === 'ready' ? 'Your video is live' : 'That upload could not be processed — please try again');
  }, 3000);
}

// ---------- ads: advertiser portal + admin ----------
async function renderAdvertiser() {
  if (!me) return openLoginSheet(() => renderAdvertiser());
  observer?.disconnect();
  let data = { advertiser: null, campaigns: [] }, rate = { cpm_rate_rwf: 3000 };
  try { [data, rate] = await Promise.all([api('/api/ads/campaigns'), api('/api/ads/ratecard')]); } catch (err) { toast(err.message); }
  view.innerHTML = `
  <div class="panel">
    <button class="ghost" id="back" style="display:flex;align-items:center;gap:6px">${icon('i-back')} Back</button>
    <h2 style="margin:12px 0 4px">Advertise on Hobe</h2>
    <p class="dim" style="font-size:14px">Reach Hobe viewers in the feed. You pay per 1,000 views (CPM): ${fmt(rate.cpm_rate_rwf)} RWF per 1,000. Submit a campaign, we review it, then it goes live once billed.</p>
    <div class="card" style="margin-top:12px">
      <h3 style="margin-top:0">New campaign</h3>
      <label>Company name</label><input id="ccompany" placeholder="Your company" value="${esc(data.advertiser?.company_name || '')}">
      <label>Campaign name</label><input id="cname" placeholder="e.g. Launch promo">
      <label>Budget (RWF)</label><input id="cbudget" inputmode="numeric" placeholder="e.g. 50000">
      <button class="primary" id="createcamp" style="margin-top:10px">Create campaign</button>
    </div>
    <h3>Your campaigns</h3>
    <div id="camplist">${data.campaigns.length ? data.campaigns.map(campaignCard).join('') : '<p class="dim">None yet.</p>'}</div>
  </div>`;
  $('#back').onclick = () => setTab(state.tab);
  $('#createcamp').onclick = async () => {
    const name = $('#cname').value.trim(); const budget = Number($('#cbudget').value.replace(/[^0-9]/g, ''));
    if (!name || !budget) return toast('Enter a campaign name and budget');
    try { await api('/api/ads/campaigns', { method: 'POST', json: { company_name: $('#ccompany').value.trim(), name, budget_rwf: budget } }); toast('Campaign created \u2014 now add your ad'); renderAdvertiser(); }
    catch (err) { toast(err.message); }
  };
  bindCampaignCards();
}

function campaignCard(c) {
  const pct = c.budget_rwf ? Math.min(100, Math.round(((c.spent_rwf || 0) / c.budget_rwf) * 100)) : 0;
  const ready = c.ad && c.ad.status === 'ready';
  return `<div class="card" data-camp="${c.id}">
    <div class="row"><b>${esc(c.name)}</b><span class="dim">${esc(c.status)}</span></div>
    <div class="dim" style="font-size:13px;margin-top:4px">${fmt(c.impressions || 0)} views \u00b7 ${fmt(c.clicks || 0)} clicks \u00b7 ${c.ctr || 0}% CTR</div>
    <div class="dim" style="font-size:13px">Spent ${fmt(c.spent_rwf || 0)} / ${fmt(c.budget_rwf)} RWF</div>
    <div style="height:6px;background:rgba(255,255,255,.1);border-radius:3px;margin:6px 0"><i style="display:block;height:100%;width:${pct}%;background:var(--gold);border-radius:3px"></i></div>
    ${ready ? `<div class="dim" style="font-size:13px">Ad ready ${c.ad.headline ? '\u00b7 ' + esc(c.ad.headline) : ''}</div>` : `<input type="file" accept="video/*,image/*" class="adfile" style="display:none"><button class="ghost upcreative" style="width:100%">${c.ad ? 'Ad ' + esc(c.ad.status) + ' \u2014 replace' : 'Upload ad creative'}</button>`}
  </div>`;
}

function bindCampaignCards() {
  view.querySelectorAll('[data-camp]').forEach((card) => {
    const id = card.dataset.camp;
    const btn = card.querySelector('.upcreative'); const file = card.querySelector('.adfile');
    if (btn && file) {
      btn.onclick = () => file.click();
      file.onchange = async () => {
        const fl = file.files[0]; if (!fl) return;
        const headline = prompt('Ad headline (brand or product):', '') || '';
        const cta_url = prompt('Where should the button send people? (https://...):', 'https://') || '';
        const fd = new FormData();
        fd.append(fl.type.startsWith('image') ? 'image' : 'video', fl);
        fd.append('headline', headline); fd.append('cta_url', cta_url);
        btn.textContent = 'Uploading...'; btn.disabled = true;
        try { await api(`/api/ads/campaigns/${id}/creative`, { method: 'POST', body: fd }); toast('Ad uploaded \u2014 processing'); setTimeout(renderAdvertiser, 1500); }
        catch (err) { toast(err.message); btn.disabled = false; }
      };
    }
  });
}

async function renderAdmin() {
  if (!me) return openLoginSheet(() => renderAdmin());
  observer?.disconnect();
  let camps = [];
  try { camps = await api('/api/admin/ads/campaigns'); } catch (err) { toast(err.message); return setTab(state.tab); }
  view.innerHTML = `
  <div class="panel">
    <button class="ghost" id="back" style="display:flex;align-items:center;gap:6px">${icon('i-back')} Back</button>
    <h2 style="margin:12px 0">Ad review</h2>
    ${camps.length ? camps.map(adminCard).join('') : '<p class="dim">No campaigns yet.</p>'}
  </div>`;
  $('#back').onclick = () => setTab(state.tab);
  view.querySelectorAll('[data-acamp]').forEach((card) => {
    const id = card.dataset.acamp;
    card.querySelectorAll('[data-status]').forEach((b) => { b.onclick = async () => {
      try { await api(`/api/admin/ads/campaigns/${id}`, { method: 'POST', json: { status: b.dataset.status, paid: b.dataset.status === 'active' ? true : undefined } }); toast('Updated'); renderAdmin(); }
      catch (err) { toast(err.message); }
    }; });
  });
}

function adminCard(c) {
  return `<div class="card" data-acamp="${c.id}">
    <div class="row"><b>${esc(c.company_name || '')} \u00b7 ${esc(c.name)}</b><span class="dim">${esc(c.status)}</span></div>
    <div class="dim" style="font-size:13px;margin-top:4px">Budget ${fmt(c.budget_rwf)} RWF @ ${fmt(c.cpm_rate_rwf)} CPM \u00b7 ${fmt(c.impressions||0)} views \u00b7 due ${fmt(c.amount_due_rwf||0)} RWF \u00b7 paid: ${c.paid ? 'yes' : 'no'}</div>
    ${c.ad ? `<div class="dim" style="font-size:13px">Creative: ${esc(c.ad.kind)} ${esc(c.ad.status)} ${c.ad.headline ? '\u00b7 ' + esc(c.ad.headline) : ''}</div>` : '<div class="dim" style="font-size:13px">No creative yet</div>'}
    <div class="chips" style="margin-top:8px">
      <button class="chip" data-status="active">Approve &amp; activate</button>
      <button class="chip" data-status="paused">Pause</button>
      <button class="chip" data-status="rejected">Reject</button>
    </div>
  </div>`;
}

// ---------- comments ----------
function timeAgo(ts) {
  const sec = Math.max(1, Math.floor(Date.now() / 1000 - Number(ts)));
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60); if (m < 60) return m + 'm';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h';
  const d = Math.floor(h / 24); if (d < 7) return d + 'd';
  const w = Math.floor(d / 7); if (w < 5) return w + 'w';
  return Math.floor(d / 30) + 'mo';
}

let commentCtx = null;

async function openComments(videoId) {
  commentCtx = { videoId, replyTo: null };
  openSheet(`
    <div class="csheet">
      <div class="chead">Comments</div>
      <div class="clist" id="clist"><p class="dim center" style="padding:22px">Loading...</p></div>
      <div class="cbar">
        <div id="creplyhint" class="creplyhint hidden"></div>
        <div class="cinputrow">
          <input id="cinput" placeholder="Add a comment..." maxlength="500" ${me ? '' : 'disabled'}>
          <button id="csend" class="csend">${me ? 'Post' : 'Sign in'}</button>
        </div>
      </div>
    </div>`);
  await loadComments();
  const input = $('#cinput'); const send = $('#csend');
  send.onclick = async () => {
    if (!me) { closeSheet(); return openLoginSheet(() => openComments(videoId)); }
    const body = input.value.trim(); if (!body) return;
    send.disabled = true;
    try {
      await api(`/api/videos/${videoId}/comments`, { method: 'POST', json: { body, parent_id: commentCtx.replyTo?.id || undefined } });
      input.value = ''; clearReply();
      await loadComments();
    } catch (err) { toast(err.message); }
    send.disabled = false;
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); send.onclick(); } };
}

function clearReply() {
  if (commentCtx) commentCtx.replyTo = null;
  const h = $('#creplyhint'); if (h) { h.classList.add('hidden'); h.textContent = ''; }
  const i = $('#cinput'); if (i) i.placeholder = 'Add a comment...';
}

async function loadComments() {
  const list = $('#clist'); if (!list) return;
  let rows = [];
  try { rows = await api(`/api/videos/${commentCtx.videoId}/comments`); }
  catch (err) { list.innerHTML = `<p class="dim center">${esc(err.message)}</p>`; return; }
  list.innerHTML = rows.length ? rows.map((c) => commentHtml(c)).join('') : '<p class="dim center" style="padding:24px">No comments yet. Be the first.</p>';
  bindComments(list);
}

function commentHtml(c, isReply = false) {
  return `<div class="citem ${isReply ? 'cisreply' : ''}" data-cid="${c.id}" data-cname="${esc(c.user.name)}">
    ${avatarHtml(c.user, isReply ? 30 : 36)}
    <div class="cmain">
      <div class="cname">${esc(c.user.name)}${Number(c.user.verified) ? '<svg class="vrf"><use href="#i-verified"/></svg>' : ''}</div>
      <div class="ctext">${esc(c.body)}</div>
      <div class="cmeta">
        <span>${timeAgo(c.created_at)}</span>
        <button data-cact="reply">Reply</button>
        ${c.reply_count ? `<button data-cact="viewreplies" data-rc="${c.reply_count}">View ${c.reply_count} ${c.reply_count > 1 ? 'replies' : 'reply'}</button>` : ''}
      </div>
      <div class="creplies" data-repliesfor="${c.id}"></div>
    </div>
    <button class="clike ${c.liked ? 'liked' : ''}" data-cact="like">${icon('i-heart')}<span class="cnt">${c.likes ? fmt(c.likes) : ''}</span></button>
  </div>`;
}

function bindComments(scope) {
  scope.querySelectorAll('[data-cact]').forEach((b) => {
    if (b.dataset.bound) return; b.dataset.bound = '1';
    const item = b.closest('[data-cid]'); const cid = item.dataset.cid;
    b.onclick = async () => {
      const act = b.dataset.cact;
      if (act === 'like') {
        if (!me) { closeSheet(); return openLoginSheet(() => openComments(commentCtx.videoId)); }
        try { const r = await api(`/api/comments/${cid}/like`, { method: 'POST' }); b.classList.toggle('liked', r.liked); $('.cnt', b).textContent = r.likes ? fmt(r.likes) : ''; }
        catch (err) { toast(err.message); }
      } else if (act === 'reply') {
        if (!me) { closeSheet(); return openLoginSheet(() => openComments(commentCtx.videoId)); }
        commentCtx.replyTo = { id: cid, name: item.dataset.cname };
        const h = $('#creplyhint'); h.textContent = `Replying to ${item.dataset.cname}`; h.classList.remove('hidden');
        const i = $('#cinput'); i.placeholder = `Reply to ${item.dataset.cname}...`; i.focus();
      } else if (act === 'viewreplies') {
        const box = item.querySelector(`[data-repliesfor="${cid}"]`);
        if (box.dataset.open) { box.innerHTML = ''; delete box.dataset.open; b.textContent = `View ${b.dataset.rc} ${Number(b.dataset.rc) > 1 ? 'replies' : 'reply'}`; return; }
        try {
          const reps = await api(`/api/comments/${cid}/replies`);
          box.innerHTML = reps.map((r) => commentHtml(r, true)).join('');
          box.dataset.open = '1'; b.textContent = 'Hide replies';
          bindComments(box);
        } catch (err) { toast(err.message); }
      }
    };
  });
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
