(function(){
'use strict';

/* =====================================================
   1) أدوات عامة
   ===================================================== */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s ?? '')
  .replace(/[\u064B-\u065F\u0670\u0640]/g,'')
  .replace(/[\u0623\u0625\u0622\u0671]/g,'\u0627').replace(/\u0629/g,'\u0647').replace(/\u0649/g,'\u064A')
  .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
  .toLowerCase().trim();
const fmt = n => Number(n||0).toLocaleString('ar-EG');
// Unified source line: book, then page / chapter. Date a card went live (shown to visitors).
const srcLine = o => [o && o.source, o && o.page].filter(Boolean).join('، ');
const fmtDate = ms => ms ? new Date(Number(ms)).toLocaleDateString('ar-EG', {dateStyle:'long'}) : '';
// A card whose sources are all filled in may not lose them; old incomplete cards stay editable.
const sourcesComplete = c => c.type === 'figure'
  ? (c.branches||[]).every(b => b.type !== 'hadith' || (b.items||[]).every(i => i && String(i.source||'').trim()))
  : !!String(c.source||'').trim();
const uid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);

const validImg = u => /^(https?:\/\/|data:image\/)/i.test(String(u||'').trim());
const cssUrl = u => String(u).trim().replace(/["'()\s<>\\]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2,'0'));


/* =====================================================
   3) الثوابت والبيانات الأولية
   ===================================================== */
const {ERAS, TYPES} = SIYAR_DATA;
const eraLabel = k => (ERAS.find(e=>e.key===k)||{}).label || '';
const TYPE_KEYS = Object.keys(TYPES);
// Static export (data-mode="static"): cards come from /data/*.json, no counter, no admin.
const STATIC = document.documentElement.getAttribute('data-mode') === 'static';

/* =====================================================
   4) إدارة البيانات والنقرات
   ===================================================== */
let db = {figures:[], stances:[], seerah:[]};
let clicks = {};   // views per card id, filled from /api/admin/stats

const allCards = () => TYPE_KEYS.flatMap(t => db[TYPES[t].coll]);
const findCard = id => allCards().find(c => c.id === id);
const cardTitle = c => c.type === 'figure' ? c.name : c.title;
const clickOf = id => Number(clicks[id]) || 0;
function addClick(id){ if(STATIC) return; try{ fetch('/api/cards/' + encodeURIComponent(id) + '/view', {method:'POST', keepalive:true}).catch(function(){}); }catch(e){} }

/* =====================================================
   5) إشعارات ونافذة تأكيد
   ===================================================== */
function toast(msg, isErr){
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(()=>{ el.style.transition='opacity .3s'; el.style.opacity='0'; setTimeout(()=>el.remove(),320); }, 3200);
}

const confirmOverlay = $('confirmOverlay'), confirmBox = $('confirmBox');
let pendingConfirm = null, confirmFocus = null;
function confirmDialog({title, message, ok='تأكيد'}){
  return new Promise(resolve=>{
    confirmFocus = document.activeElement;
    confirmBox.innerHTML = `<h3 id="cTitle">⚠️ ${esc(title)}</h3><p>${esc(message)}</p>
      <div class="btns"><button type="button" class="btn-s" id="cNo">إلغاء</button><button type="button" class="btn-danger" id="cYes">${esc(ok)}</button></div>`;
    confirmOverlay.classList.add('open'); confirmOverlay.setAttribute('aria-hidden','false');
    const done = v => {
      pendingConfirm = null;
      confirmOverlay.classList.remove('open'); confirmOverlay.setAttribute('aria-hidden','true');
      if(confirmFocus && confirmFocus.focus && document.contains(confirmFocus)) confirmFocus.focus();
      resolve(v);
    };
    pendingConfirm = done;
    $('cNo').onclick = () => done(false);
    $('cYes').onclick = () => done(true);
    $('cNo').focus();
  });
}
confirmOverlay.addEventListener('click', e => { if(e.target === confirmOverlay && pendingConfirm) pendingConfirm(false); });

/* =====================================================
   6) الواجهة العامة: بحث وفلترة وعرض البطاقات
   ===================================================== */
const state = { q:'', era:'all' };
const figGrid=$('figGrid'), stGrid=$('stGrid'), srGrid=$('srGrid'), searchEl=$('search'), clearBtn=$('clear');

function renderFilters(){
  $('filters').innerHTML = ERAS.map(e =>
    `<button type="button" class="chip${e.key===state.era?' active':''}" data-era="${e.key}" aria-pressed="${e.key===state.era}">${esc(e.label)}</button>`).join('');
}
$('filters').addEventListener('click', e=>{
  const b=e.target.closest('.chip'); if(!b) return;
  state.era=b.dataset.era; renderFilters(); update();
});

function searchText(c){
  const parts = [];
  if(c.type === 'figure'){
    parts.push(c.name,c.title,c.famousFor,c.summary,c.role,c.dates);
    (c.branches||[]).forEach(b => (b.items||[]).forEach(i => parts.push(typeof i==='string' ? i : i.text)));
  } else parts.push(c.title,c.owner,c.text,c.source,c.page);
  return norm(parts.join(' '));
}
const variant = i => ['','v2','v3'][((i % 3) + 3) % 3];
// CSP forbids inline style attributes in markup, so dynamic values travel in data-* attributes
// and are applied through the CSSOM by applyDynamicStyles() below.
const headStyle = c => (c.headerType==='image' && validImg(c.headerValue))
  ? ` data-bg="${esc(cssUrl(c.headerValue))}"` : '';
const delayClass = i => 'd' + Math.min(i, 6);
function applyDynamicStyles(root){
  const list = [];
  if(root.matches && root.matches('[data-bg],[data-w]')) list.push(root);
  if(root.querySelectorAll) list.push(...root.querySelectorAll('[data-bg],[data-w]'));
  for(const el of list){
    if(el.dataset.bg !== undefined){ el.style.backgroundImage = 'url("' + el.dataset.bg + '")'; delete el.dataset.bg; }
    if(el.dataset.w !== undefined){ el.style.width = Math.max(0, Math.min(100, Number(el.dataset.w) || 0)) + '%'; delete el.dataset.w; }
  }
}
new MutationObserver(muts => { for(const m of muts) for(const n of m.addedNodes) if(n.nodeType === 1) applyDynamicStyles(n); })
  .observe(document.documentElement, { childList: true, subtree: true });
const isImgHead = c => c.headerType==='image' && validImg(c.headerValue);

function figureCard(f,i){
  const img = isImgHead(f);
  return `<article class="card ${delayClass(i)}">
    <div class="card-head ${img?'':'t '+variant(i)}"${headStyle(f)}>
      <span class="era-tag">${esc(eraLabel(f.era))}</span>${img?'':`<div class="calli">${esc(f.headerValue||f.name)}</div>`}
    </div>
    <div class="card-body">
      <h3>${esc(f.name)}</h3>
      <div class="title">${esc(f.title)}</div>
      <div class="dates">${esc(f.dates)}</div>
      <p class="sum">${esc(f.summary)}</p>
      <button type="button" class="btn" data-open="${esc(f.id)}">عرض التفاصيل</button>
    </div>
  </article>`;
}
function noteCard(s,i){
  return `<article class="card stance ${s.type==='seerah'?'seerah':''} ${delayClass(i)}">
    <div class="who"><div class="avatar">${esc((s.owner||'؟').trim().charAt(0))}</div>
      <div><b>${esc(s.owner)}</b><small>${esc(eraLabel(s.era))}</small></div></div>
    <h3>${esc(s.title)}</h3>
    <blockquote>${esc(s.text)}</blockquote>
    ${srcLine(s)?`<div class="note">${esc(srcLine(s))}</div>`:''}
    <button type="button" class="btn" data-open="${esc(s.id)}">عرض التفاصيل</button>
  </article>`;
}

function update(){
  const q = norm(state.q);
  const pick = list => list.filter(c => (state.era==='all' || c.era===state.era) && (!q || searchText(c).includes(q) || (matchIds && matchIds.has(c.id))));
  const figs = pick(db.figures), sts = pick(db.stances), srs = pick(db.seerah);
  figGrid.innerHTML = figs.length ? figs.map(figureCard).join('') : `<div class="empty">لا توجد شخصيات مطابقة.</div>`;
  stGrid.innerHTML  = sts.length  ? sts.map(noteCard).join('')   : `<div class="empty">لا توجد مواقف مطابقة.</div>`;
  srGrid.innerHTML  = srs.length  ? srs.map(noteCard).join('')   : `<div class="empty">لا توجد بطاقات من السيرة مطابقة.</div>`;
  $('figCount').textContent = fmt(figs.length);
  $('stCount').textContent = fmt(sts.length);
  $('srCount').textContent = fmt(srs.length);
  const total = figs.length + sts.length + srs.length;
  $('resultInfo').textContent = (q || state.era!=='all') ? (total ? `عدد النتائج: ${fmt(total)}` : 'لا توجد نتائج. جرّب كلمات أخرى أو اختر «الكل».') : '';
  clearBtn.classList.toggle('show', !!state.q);
}
searchEl.addEventListener('input', ()=>{ state.q = searchEl.value; matchIds = null; update(); remoteSearch(); });
clearBtn.addEventListener('click', ()=>{ searchEl.value=''; state.q=''; matchIds = null; update(); searchEl.focus(); });

/* =====================================================
   7) النافذة المنبثقة (ملف الشخصية / تفاصيل الموقف)
   ===================================================== */
const overlay = $('overlay'), modal = $('modal');
let lastFocus = null;

function branchHTML(b, idx){
  let inner = '';
  if(b.type === 'hadith'){
    inner = (b.items||[]).map(h => {
      const plain = h.grade === 'ملاحظة';
      const ok = ['صحيح','حسن','متفق عليه'].includes(h.grade);
      const meta = [];
      if(h.narrator) meta.push(`<span class="badge">الراوي: ${esc(h.narrator)}</span>`);
      if(srcLine(h)) meta.push(`<span class="badge">التخريج: ${esc(srcLine(h))}</span>`);
      if(h.number) meta.push(`<span class="badge">رقم الحديث: ${esc(h.number)}</span>`);
      if(h.grade && !plain) meta.push(`<span class="badge ${ok?'ok':'warn'}">الدرجة: ${esc(h.grade)}</span>`);
      return `<div class="hadith${plain?' plain':''}"><q>${plain?esc(h.text):'«'+esc(h.text)+'»'}</q>${meta.length?`<div class="meta">${meta.join('')}</div>`:''}</div>`;
    }).join('') || '<p class="none">لا توجد أحاديث مسجّلة.</p>';
  } else {
    inner = (b.items && b.items.length) ? `<ul>${b.items.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="none">لا توجد معلومات مسجّلة.</p>';
  }
  const open = idx === 0;
  return `<div class="acc${open?' open':''}">
    <button type="button" class="acc-btn" aria-expanded="${open}" aria-controls="p-${esc(b.id)}">
      <span class="ic" aria-hidden="true">${esc(b.icon||'•')}</span><span>${esc(b.title)}</span><span class="chev" aria-hidden="true">▼</span>
    </button>
    <div class="acc-panel" id="p-${esc(b.id)}" role="region"><div class="acc-inner"><div class="acc-content">${inner}</div></div></div>
  </div>`;
}

function viewsBadge(c){ return `<span class="views-badge" title="عدد المشاهدات">👁 عدد المشاهدات: ${fmt(clickOf(c.id))} نقرة</span>`; }

function figureModalHTML(f, preview){
  const img = isImgHead(f);
  const idx = Math.max(0, db.figures.indexOf(f));
  return `
    <div class="m-head ${img?'':'t '+variant(idx)}"${headStyle(f)}>
      <button type="button" class="close" id="mClose" aria-label="إغلاق">✕</button>
      ${preview ? viewsBadge(f) : ''}
      ${img?'':`<div class="calli">${esc(f.headerValue||'')}</div>`}
      <h2 id="mName">${esc(f.name)}</h2>
      <span class="m-title">${esc(f.title)}</span>
    </div>
    <div class="m-body">
      <div class="facts">
        <div class="fact"><small>الحقبة</small><span>${esc(eraLabel(f.era))}</span></div>
        <div class="fact"><small>التواريخ</small><span>${esc(f.dates||'—')}</span></div>
        <div class="fact"><small>الدور</small><span>${esc(f.role||'—')}</span></div>
        <div class="fact"><small>أبرز المحطات</small><span>${esc(f.famousFor||'—')}</span></div>
        ${f.publishedAt?`<div class="fact"><small>تاريخ الإضافة</small><span>${esc(fmtDate(f.publishedAt))}</span></div>`:''}
      </div>
      <p class="m-summary">${esc(f.summary)}</p>
      ${(f.branches&&f.branches.length) ? `<div class="acc-tools"><h4>محاور السيرة</h4><button type="button" class="link-btn" id="toggleAll">فتح الكل</button></div>${f.branches.map(branchHTML).join('')}` : ''}
      ${shareBarHTML()}
    </div>`;
}
function noteModalHTML(s, preview){
  const idx = allCards().indexOf(s);
  return `
    <div class="m-head t ${variant(idx)}">
      <button type="button" class="close" id="mClose" aria-label="إغلاق">✕</button>
      ${preview ? viewsBadge(s) : ''}
      <div class="calli">${esc(TYPES[s.type].label)}</div>
      <h2 id="mName">${esc(s.title)}</h2>
      <span class="m-title">${esc(s.owner)}</span>
    </div>
    <div class="m-body">
      <div class="facts">
        <div class="fact"><small>الحقبة</small><span>${esc(eraLabel(s.era))}</span></div>
        <div class="fact"><small>${s.type==='seerah'?'صاحب الحدث':'صاحب الموقف'}</small><span>${esc(s.owner)}</span></div>
        ${s.publishedAt?`<div class="fact"><small>تاريخ الإضافة</small><span>${esc(fmtDate(s.publishedAt))}</span></div>`:''}
      </div>
      <div class="hadith"><q>${esc(s.text)}</q>${srcLine(s)?`<div class="meta"><span class="badge">المصدر: ${esc(srcLine(s))}</span></div>`:''}</div>
      ${shareBarHTML()}
    </div>`;
}

// Every card has its own address: /c/:id (the server returns the same page with that card's meta tags).
const CARD_PATH = /^\/c\/([\w-]{1,64})\/?$/;
const cardIdFromPath = () => { const m = CARD_PATH.exec(location.pathname); return m ? m[1] : null; };
let cardPushed = false, fromPop = false;

async function openCard(id, opts){
  const preview = !!(opts && opts.preview);
  const pushUrl = !preview && !(opts && opts.admin) && !fromPop && cardIdFromPath() !== id;
  let c = findCard(id);
  if(!c && opts && opts.admin){          // a card still in review: only the admin API can return it
    const ar = await api('GET', '/api/admin/cards/' + encodeURIComponent(id));
    if(!ar.ok || !ar.data || !ar.data.card){ toast(MSG_LOAD_FAIL, true); return; }
    c = ar.data.card;
  }
  if(!c) return;
  if(c.type === 'figure' && !c.branches){
    try{
      const r = await fetch(STATIC ? '/data/cards/' + encodeURIComponent(id) + '.json' : '/api/cards/' + encodeURIComponent(id));
      if(!r.ok) throw new Error('http ' + r.status);
      const full = await r.json();
      const coll = db[TYPES[full.type].coll], i = coll.findIndex(function(x){ return x.id === id; });
      if(i >= 0) coll[i] = full;
      c = full;
    }catch(e){ toast("\u062a\u0639\u0630\u0651\u0631 \u062a\u062d\u0645\u064a\u0644 \u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0628\u0637\u0627\u0642\u0629. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.", true); return; }
  }
  if(!preview){ addClick(id); }          // عدّاد المشاهدات: +1 عند فتح بطاقة من الواجهة العامة
  lastFocus = document.activeElement;
  modal.dataset.cardId = id;
  modal.innerHTML = c.type === 'figure' ? figureModalHTML(c, preview) : noteModalHTML(c, preview);
  overlay.classList.add('open'); overlay.setAttribute('aria-hidden','false');
  document.body.classList.add('lock');
  const mb = modal.querySelector('.m-body'); if(mb) mb.scrollTop = 0;
  $('mClose').focus();
  if(pushUrl){ history.pushState({card:id}, '', '/c/' + encodeURIComponent(id)); cardPushed = true; }
}
function closeModal(){
  if(!overlay.classList.contains('open')) return;
  overlay.classList.remove('open'); overlay.setAttribute('aria-hidden','true');
  document.body.classList.remove('lock');
  if(lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  if(!fromPop && cardIdFromPath()){
    if(cardPushed){ cardPushed = false; history.back(); }          // we pushed /c/:id ourselves: step back
    else history.replaceState(null, '', '/');                       // the page was opened directly on /c/:id
  }
}
// Back / forward buttons keep the modal and the address in sync.
window.addEventListener('popstate', async () => {
  const id = cardIdFromPath();
  fromPop = true;
  try{
    if(id) await openCard(id);
    else { cardPushed = false; closeModal(); }
  } finally { fromPop = false; }
});
['figGrid','stGrid','srGrid'].forEach(g => $(g).addEventListener('click', e=>{
  const b = e.target.closest('[data-open]'); if(b) openCard(b.dataset.open);
}));
overlay.addEventListener('click', e => { if(e.target === overlay) closeModal(); });
modal.addEventListener('click', e=>{
  if(e.target.closest('#mClose')) return closeModal();
  const sb = e.target.closest('[data-share]');
  if(sb){ handleShare(sb.dataset.share, modal.dataset.cardId); return; }
  const btn = e.target.closest('.acc-btn');
  if(btn){
    const acc = btn.parentElement, open = !acc.classList.contains('open');
    acc.classList.toggle('open', open); btn.setAttribute('aria-expanded', open); return;
  }
  const t = e.target.closest('#toggleAll');
  if(t){
    const accs = [...modal.querySelectorAll('.acc')];
    const openAll = accs.some(a => !a.classList.contains('open'));
    accs.forEach(a => { a.classList.toggle('open', openAll); a.querySelector('.acc-btn').setAttribute('aria-expanded', openAll); });
    t.textContent = openAll ? 'طي الكل' : 'فتح الكل';
  }
});
document.addEventListener('keydown', e=>{
  if(pendingConfirm){ if(e.key === 'Escape') pendingConfirm(false); return; }
  if(!overlay.classList.contains('open')) return;
  if(e.key === 'Escape'){ closeModal(); return; }
  if(e.key === 'Tab'){
    const f = [...modal.querySelectorAll('button')].filter(x => x.offsetParent !== null);
    if(!f.length) return;
    const first = f[0], last = f[f.length-1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
});

/* =====================================================
   7ب) تنزيل البطاقة ومشاركتها (للزوار)
   ===================================================== */
const cardUrl = id => /^https?:$/.test(location.protocol) ? location.origin + '/c/' + encodeURIComponent(id) : '';
function shareBarHTML(){
  return `<div class="share-bar" role="group" aria-label="حفظ ومشاركة البطاقة">
    <div class="share-title">حفظ ومشاركة هذه البطاقة</div>
    <div class="share-btns">
      <button type="button" class="btn-s" data-share="image">🖼️ تنزيل كصورة</button>
      <button type="button" class="btn-s" data-share="txt">📄 تنزيل كنص</button>
      <button type="button" class="btn-s" data-share="native">📤 مشاركة</button>
      <button type="button" class="btn-s" data-share="wa">💬 واتساب</button>
      <button type="button" class="btn-s" data-share="mail">✉️ بريد</button>
      <button type="button" class="btn-s" data-share="copy">📋 نسخ النص</button>
    </div></div>`;
}

function cardToText(c){
  const L = [];
  if(c.type === 'figure'){
    L.push(`${c.name} — ${c.title}`, `الحقبة: ${eraLabel(c.era)}`);
    if(c.dates) L.push(`التواريخ: ${c.dates}`);
    if(c.role) L.push(`الدور: ${c.role}`);
    if(c.famousFor) L.push(`أبرز المحطات: ${c.famousFor}`);
    L.push('', c.summary);
    (c.branches||[]).forEach(b => {
      L.push('', `■ ${b.title}`);
      (b.items||[]).forEach(i => {
        if(typeof i === 'string'){ L.push(`- ${i}`); return; }
        L.push(i.grade === 'ملاحظة' ? `- ${i.text}` : `- «${i.text}»`);
        const m = [i.narrator && `الراوي: ${i.narrator}`, srcLine(i) && `التخريج: ${srcLine(i)}`, i.number && `رقم الحديث: ${i.number}`, (i.grade && i.grade !== 'ملاحظة') && `الدرجة: ${i.grade}`].filter(Boolean);
        if(m.length) L.push(`  (${m.join(' | ')})`);
      });
    });
  } else {
    L.push(c.title, `${c.owner} — ${eraLabel(c.era)}`, '', c.text);
    if(srcLine(c)) L.push('', `المصدر: ${srcLine(c)}`);
  }
  if(c.publishedAt) L.push('', `تاريخ الإضافة: ${fmtDate(c.publishedAt)}`);
  L.push('', '— سِيَر: بطاقات التاريخ الإسلامي');
  const u = cardUrl(c.id); if(u) L.push(u);
  return L.join('\n');
}

function downloadBlob(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const fileSlug = c => 'siyar-' + String(c.id).replace(/[^\w-]/g,'');
async function copyText(t){
  try{ await navigator.clipboard.writeText(t); return true; }
  catch(e){
    try{
      const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0;top:0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    }catch(_){ return false; }
  }
}

/* رسم البطاقة كصورة PNG بالـ Canvas (بدون مكتبات) */
async function cardToBlob(c){
  try{
    await Promise.all([document.fonts.load('700 60px Amiri'), document.fonts.load('400 40px Amiri'),
                       document.fonts.load('500 34px Tajawal'), document.fonts.load('800 34px Tajawal')]);
  }catch(e){}
  const W = 1080, H = 1350, R = W - 90;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d'); if(!x) return null;
  x.direction = 'rtl';
  const rr = (px,py,w,h,r) => { x.beginPath(); x.moveTo(px+r,py); x.arcTo(px+w,py,px+w,py+h,r); x.arcTo(px+w,py+h,px,py+h,r); x.arcTo(px,py+h,px,py,r); x.arcTo(px,py,px+w,py,r); x.closePath(); };
  const wrap = (t, font, maxW) => {
    x.font = font; const out = [];
    String(t||'').split('\n').forEach(par => {
      if(!par.trim()){ out.push(''); return; }
      let line = '';
      par.split(/\s+/).forEach(w => {
        const test = line ? line + ' ' + w : w;
        if(x.measureText(test).width > maxW && line){ out.push(line); line = w; } else line = test;
      });
      if(line) out.push(line);
    });
    return out;
  };
  const draw = (lines, font, color, xx, y, lh, maxLines, align) => {
    x.font = font; x.fillStyle = color; x.textAlign = align || 'right';
    const n = Math.max(0, Math.min(lines.length, maxLines));
    for(let i = 0; i < n; i++){
      let l = lines[i];
      if(i === n-1 && lines.length > n) l = l.replace(/\s+\S*$/, '') + ' …';
      x.fillText(l, xx, y + i*lh);
    }
    return y + n*lh;
  };

  // الخلفية
  let g = x.createLinearGradient(0,0,0,H); g.addColorStop(0,'#0b0f19'); g.addColorStop(1,'#141c2e');
  x.fillStyle = g; x.fillRect(0,0,W,H);
  // الترويسة
  const pal = {prophetic:['#12324a','#0f5a4a'], rashidun:['#12324a','#0f5a4a'], conquests:['#3a2a12','#6b4710'], andalus:['#251c4a','#143f5e'], ayyubid:['#251c4a','#143f5e']}[c.era] || ['#12324a','#0f5a4a'];
  x.save(); rr(40,40,W-80,430,36); x.clip();
  g = x.createLinearGradient(40,40,W-40,470); g.addColorStop(0,pal[0]); g.addColorStop(1,pal[1]); x.fillStyle = g; x.fillRect(40,40,W-80,430);
  x.strokeStyle = 'rgba(255,255,255,0.10)'; x.lineWidth = 3;
  [80,150,220,290].forEach(r => { x.beginPath(); x.arc(W/2, 255, r, 0, Math.PI*2); x.stroke(); });
  x.restore();
  rr(40,40,W-80,H-80,36); x.strokeStyle = '#25314a'; x.lineWidth = 3; x.stroke();

  // وسم الحقبة والنوع
  draw([eraLabel(c.era)], '500 32px Tajawal', '#f59e0b', R, 112, 40, 1, 'right');
  draw([TYPES[c.type].label], '500 30px Tajawal', 'rgba(255,255,255,0.75)', 90, 112, 40, 1, 'left');
  // العنوان
  const tl = wrap(cardTitle(c), '700 92px Amiri', W - 220);
  const nT = Math.min(tl.length, 2);
  draw(tl, '700 92px Amiri', '#ffffff', W/2, 250 - (nT-1)*52, 104, 2, 'center');
  // الشارة الفرعية
  const sub = c.type === 'figure' ? c.title : c.owner;
  x.font = '800 36px Tajawal';
  const sw = Math.min(W - 200, x.measureText(sub).width + 70);
  rr((W - sw)/2, 372, sw, 62, 31); x.fillStyle = 'rgba(16,185,129,0.22)'; x.fill(); x.strokeStyle = 'rgba(16,185,129,0.6)'; x.lineWidth = 2; x.stroke();
  draw([sub], '800 36px Tajawal', '#6ee7b7', W/2, 415, 40, 1, 'center');

  // المحتوى
  let y = 560; const LIMIT = 1170;
  if(c.type === 'figure'){
    [['التواريخ', c.dates], ['أبرز المحطات', c.famousFor]].forEach(([lb, val]) => {
      if(!val) return;
      draw([lb], '800 28px Tajawal', '#f59e0b', R, y, 36, 1, 'right');
      y = draw(wrap(val, '500 34px Tajawal', W - 180), '500 34px Tajawal', '#e7ecf5', R, y + 44, 46, 2, 'right') + 8;
    });
    y += 20; x.strokeStyle = '#25314a'; x.lineWidth = 2; x.beginPath(); x.moveTo(90,y-26); x.lineTo(R,y-26); x.stroke();
    const lines = wrap(c.summary, '400 38px Tajawal', W - 180);
    draw(lines, '400 38px Tajawal', '#c7d0e1', R, y + 30, 62, Math.floor((LIMIT - y - 30)/62) + 1, 'right');
  } else {
    const reserve = srcLine(c) ? 120 : 0;
    const lines = wrap(c.text, '400 46px Amiri', W - 260);
    const maxL = Math.max(1, Math.floor((LIMIT - reserve - y)/80));
    const nL = Math.min(lines.length, maxL);
    x.fillStyle = '#10b981'; x.fillRect(R - 8, y - 52, 8, nL*80 - 10);
    const end = draw(lines, '400 46px Amiri', '#e7ecf5', R - 40, y, 80, maxL, 'right');
    if(srcLine(c)) draw(wrap('المصدر: ' + srcLine(c), '500 28px Tajawal', W - 180), '500 28px Tajawal', '#93a0b8', R, end + 24, 40, 2, 'right');
  }

  // التذييل
  x.strokeStyle = '#25314a'; x.lineWidth = 2; x.beginPath(); x.moveTo(90,1205); x.lineTo(R,1205); x.stroke();
  draw(['سِيَر'], '700 64px Amiri', '#f59e0b', R, 1275, 70, 1, 'right');
  draw(['بطاقات التاريخ الإسلامي'], '500 28px Tajawal', '#93a0b8', 90, 1270, 40, 1, 'left');
  return new Promise(res => cv.toBlob(res, 'image/png'));
}

async function handleShare(kind, id){
  const c = findCard(id); if(!c) return;
  const name = cardTitle(c);
  try{
    if(kind === 'native'){
      if(navigator.share){ await navigator.share({title: name + ' — سِيَر', text: cardToText(c).slice(0,1800)}); }
      else if(await copyText(cardToText(c))){ toast('المشاركة المباشرة غير مدعومة هنا؛ تم نسخ نص البطاقة'); }
      else toast('تعذّرت المشاركة', true);
      return;
    }
    const text = cardToText(c);
    if(kind === 'txt'){ downloadBlob(new Blob(['\ufeff' + text], {type:'text/plain;charset=utf-8'}), fileSlug(c) + '.txt'); toast('تم تنزيل النص'); }
    else if(kind === 'image'){
      toast('جارٍ تجهيز الصورة…');
      const b = await cardToBlob(c); if(!b) throw new Error('canvas');
      downloadBlob(b, fileSlug(c) + '.png'); toast('تم تنزيل صورة البطاقة');
    }
    else if(kind === 'copy'){ (await copyText(text)) ? toast('تم نسخ نص البطاقة') : toast('تعذّر النسخ', true); }
    else if(kind === 'wa'){ window.open('https://wa.me/?text=' + encodeURIComponent(text.slice(0,1800)), '_blank', 'noopener'); }
    else if(kind === 'mail'){ location.href = 'mailto:?subject=' + encodeURIComponent(name + ' — سِيَر') + '&body=' + encodeURIComponent(text.slice(0,1800)); }
  }catch(e){
    if(e && e.name === 'AbortError') return;   // ألغى المستخدم نافذة المشاركة
    toast('تعذّرت العملية، حاول مرة أخرى', true);
  }
}

/* =====================================================
   8) Admin session (login is checked by the server)
   ===================================================== */
const auth = { email:'', csrf:'', twofa:null };   // filled from the server session (cookie is HttpOnly)
const getSession = () => auth.csrf ? { email: auth.email } : null;
const isAuthed = () => !!getSession();
const MSG_FILL = "\u064a\u0631\u062c\u0649 \u0625\u062f\u062e\u0627\u0644 \u0627\u0644\u0628\u0631\u064a\u062f \u0648\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631.";
const MSG_OK = "\u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644 \u0628\u0646\u062c\u0627\u062d";
const MSG_TOO_MANY = "\u0645\u062d\u0627\u0648\u0644\u0627\u062a \u0643\u062b\u064a\u0631\u0629. \u0627\u0646\u062a\u0638\u0631 \u0642\u0644\u064a\u0644\u064b\u0627 \u062b\u0645 \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.";
const MSG_BAD = "\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u062f\u062e\u0648\u0644 \u063a\u064a\u0631 \u0635\u062d\u064a\u062d\u0629.";
const MSG_CARD_MISSING = 'هذه البطاقة غير متاحة.';
const MSG_FILL_CODE = 'أدخل الرمز.';
const MSG_ADDED_REVIEW = 'أُضيفت البطاقة وهي الآن قيد المراجعة. لن تظهر في الموقع قبل أن تؤكد نشرها بعد انتهاء المدة.';
const MSG_REVIEW_SAVED = 'تم حفظ التعديلات وأُعيدت مدة المراجعة من جديد.';
const MSG_PUBLISHED = 'تم نشر البطاقة وظهرت في الواجهة العامة.';
const MSG_NOT_READY = 'لم تنتهِ فترة المراجعة بعد.';
const MSG_REVIEW_FAIL = 'تعذّر تحميل قائمة المراجعة.';
const MSG_SRC = 'المصدر مطلوب: اكتب اسم الكتاب.';
const MSG_HSRC = 'أدخل مصدر كل حديث (اسم الكتاب).';
const MSG_NOT_IN_REVIEW = 'هذه البطاقة لم تعد قيد المراجعة.';
const MSG_BAD_CODE = 'الرمز غير صحيح أو انتهت صلاحيته.';
const MSG_BYE = "\u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c";
const MSG_EXPIRED = "\u0627\u0646\u062a\u0647\u062a \u0627\u0644\u062c\u0644\u0633\u0629. \u0633\u062c\u0651\u0644 \u0627\u0644\u062f\u062e\u0648\u0644 \u0645\u0646 \u062c\u062f\u064a\u062f.";
const MSG_COMPLETE = "\u064a\u0631\u062c\u0649 \u0627\u0633\u062a\u0643\u0645\u0627\u0644 \u0627\u0644\u062d\u0642\u0648\u0644 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629";
const MSG_INVALID = "\u0642\u064a\u0645\u0629 \u063a\u064a\u0631 \u0635\u0627\u0644\u062d\u0629";
const MSG_SAVE_FAIL = "\u062a\u0639\u0630\u0651\u0631 \u0627\u0644\u062d\u0641\u0638. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.";
const MSG_SAVED = "\u062a\u0645 \u062d\u0641\u0638 \u0627\u0644\u062a\u0639\u062f\u064a\u0644\u0627\u062a";
const MSG_ADDED = "\u062a\u0645\u062a \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0648\u0638\u0647\u0631\u062a \u0641\u064a \u0627\u0644\u0648\u0627\u062c\u0647\u0629";
const MSG_DELETED = "\u062a\u0645 \u062d\u0630\u0641 \u0627\u0644\u0628\u0637\u0627\u0642\u0629";
const MSG_LOAD_FAIL = "\u062a\u0639\u0630\u0651\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0628\u0637\u0627\u0642\u0629.";
const MSG_STATS_FAIL = "\u062a\u0639\u0630\u0651\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0625\u062d\u0635\u0627\u0626\u064a\u0627\u062a.";
const STATS_SUB = "\u062a\u064f\u062d\u062a\u0633\u0628 \u0645\u0634\u0627\u0647\u062f\u0629 \u0648\u0627\u062d\u062f\u0629 \u0644\u0643\u0644 \u0632\u0627\u0626\u0631 \u0641\u064a \u0627\u0644\u064a\u0648\u0645 \u0639\u0646\u062f \u0641\u062a\u062d \u0628\u0637\u0627\u0642\u0629 \u0645\u0646 \u0627\u0644\u0648\u0627\u062c\u0647\u0629 \u0627\u0644\u0639\u0627\u0645\u0629.";

// One place for every admin request: adds the CSRF header and handles an expired session.
async function api(method, url, body){
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if(body !== undefined){ opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  if(method !== 'GET' && auth.csrf) opt.headers['X-CSRF-Token'] = auth.csrf;
  let r;
  try{ r = await fetch(url, opt); }catch(e){ return { ok:false, status:0, data:null }; }
  let data = null; try{ data = await r.json(); }catch(e){ /* empty body */ }
  if(r.status === 401 && auth.csrf){
    auth.csrf = ''; auth.email = '';
    if(!adminApp.hidden) renderLogin(MSG_EXPIRED);
  }
  return { ok: r.ok, status: r.status, data };
}
function maskEmail(e){ const [u,d] = e.split('@'); return (u.charAt(0) + '***@' + (d||'')); }

const adminApp = $('adminApp');
const admin = { tab:'create', editing:null, reviewEditing:null, createType:'figure', filter:{q:'', type:'all'} };

function authShell(inner){
  return `<div class="auth-wrap"><div class="auth-card">
    <a href="#home" class="logo" aria-label="سِيَر"><div class="logo-mark">☪</div><div>سِ<span class="g">يَ</span>ر</div></a>${inner}</div></div>`;
}

function renderLogin(msg){
  clearInterval(auth.timer);
  adminApp.innerHTML = authShell(`
    <h1>تسجيل دخول المشرف</h1>
    <p class="sub">أدخل بيانات الحساب للوصول إلى لوحة الإدارة</p>
    <form id="loginForm" novalidate>
      <div class="fld"><label for="lEmail">البريد الإلكتروني</label>
        <input id="lEmail" type="email" dir="ltr" autocomplete="username" placeholder="name@example.com" value="${esc(auth.email)}" required></div>
      <div class="fld"><label for="lPass">كلمة المرور</label>
        <div class="pw"><input id="lPass" type="password" dir="ltr" autocomplete="current-password" required>
        <button type="button" id="pwToggle">إظهار</button></div></div>
      <div class="form-msg" id="lMsg" role="alert">${esc(msg||'')}</div>
      <button class="btn-p full" type="submit">متابعة</button>
    </form>
    <a class="back-link" href="#home">← العودة إلى الموقع</a>`);
  $('pwToggle').onclick = () => { const i=$('lPass'), s=i.type==='password'; i.type=s?'text':'password'; $('pwToggle').textContent=s?'إخفاء':'إظهار'; };
  $('loginForm').onsubmit = async e => {
    e.preventDefault();
    const em = $('lEmail').value.trim().toLowerCase(), pw = $('lPass').value;
    if(!em || !pw){ $('lMsg').textContent = MSG_FILL; return; }
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    const r = await api('POST', '/api/admin/login', { email: em, password: pw });
    btn.disabled = false;
    if(r.ok){ startSession(r.data); }
    else if(r.status === 401 && r.data && r.data.error === 'code_required') renderCodeStep(em, pw);
    else if(r.status === 429) $('lMsg').textContent = MSG_TOO_MANY;
    else $('lMsg').textContent = MSG_BAD;
  };
  $('lEmail').focus();
}

function startSession(d){
  auth.email = d.email; auth.csrf = d.csrf; auth.twofa = !!d.twofa;
  toast(MSG_OK); renderDashboard();
}

// Second login step, only for accounts with 2FA on. The password stays in this closure
// (never in storage) and is sent again together with the code.
function renderCodeStep(em, pw, msg){
  adminApp.innerHTML = authShell(`
    <h1>رمز التحقق</h1>
    <p class="sub">أدخل الرمز المكوّن من ٦ أرقام من تطبيق المصادقة، أو أحد رموز الاسترداد.</p>
    <form id="codeForm" novalidate>
      <div class="fld"><label for="lCode">الرمز</label>
        <input id="lCode" dir="ltr" inputmode="text" autocomplete="one-time-code" maxlength="12" placeholder="123456" required></div>
      <div class="form-msg" id="lMsg" role="alert">${esc(msg||'')}</div>
      <button class="btn-p full" type="submit">دخول</button>
    </form>
    <a class="back-link" href="#admin" id="codeBack">← البدء من جديد</a>`);
  $('codeBack').onclick = e => { e.preventDefault(); renderLogin(); };
  $('codeForm').onsubmit = async e => {
    e.preventDefault();
    const code = $('lCode').value.trim();
    if(!code){ $('lMsg').textContent = MSG_FILL_CODE; return; }
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    const r = await api('POST', '/api/admin/login', { email: em, password: pw, code });
    btn.disabled = false;
    if(r.ok) startSession(r.data);
    else if(r.status === 429) $('lMsg').textContent = MSG_TOO_MANY;
    else if(r.status === 401 && r.data && r.data.error === 'invalid_code'){ $('lMsg').textContent = MSG_BAD_CODE; $('lCode').select(); }
    else renderLogin(MSG_BAD);
  };
  $('lCode').focus();
}

async function logout(){
  await api('POST', '/api/admin/logout', {});
  auth.email = ''; auth.csrf = ''; auth.twofa = null;
  toast(MSG_BYE);
  location.hash = '#home';
}

/* =====================================================
   9) لوحة التحكم
   ===================================================== */
function renderDashboard(){
  const s = getSession(); if(!s){ renderLogin(); return; }
  adminApp.innerHTML = `
    <div class="adm-top"><div class="wrap">
      <div class="logo"><div class="logo-mark">☪</div><div>سِ<span class="g">يَ</span>ر <small>لوحة الإدارة</small></div></div>
      <div class="adm-actions">
        <span class="adm-user">${esc(s.email)}</span>
        <button type="button" class="btn-s warn" id="twofaChip"${auth.twofa === false ? '' : ' hidden'}>⚠ المصادقة الثنائية غير مفعّلة</button>
        <a class="btn-s plain-link" href="#home">عرض الموقع</a>
        <button type="button" class="btn-s btn-d" id="logoutBtn">تسجيل الخروج</button>
      </div>
    </div>
    <div class="wrap"><div class="adm-tabs" role="tablist" id="admTabs">
      <button class="adm-tab" role="tab" data-tab="create">➕ إضافة بطاقة</button>
      <button class="adm-tab" role="tab" data-tab="review">🕑 قيد المراجعة</button>
      <button class="adm-tab" role="tab" data-tab="manage">🗂️ إدارة البطاقات</button>
      <button class="adm-tab" role="tab" data-tab="stats">📊 الإحصائيات</button>
      <button class="adm-tab" role="tab" data-tab="security">🔐 الأمان</button>
      <button class="adm-tab" role="tab" data-tab="audit">📜 سجل الأحداث</button>
    </div></div></div>
    <div class="wrap adm-body" id="admBody"></div>`;
  $('logoutBtn').onclick = logout;
  $('twofaChip').onclick = () => setTab('security');
  $('admTabs').onclick = e => { const b = e.target.closest('.adm-tab'); if(b) setTab(b.dataset.tab); };
  setTab(admin.tab);
}
async function loadStats(){
  const r = await api('GET', '/api/admin/stats');
  if(!r.ok || !r.data || !Array.isArray(r.data.stats)){ toast(MSG_STATS_FAIL, true); return; }
  clicks = {};
  r.data.stats.forEach(x => { if(x.views > 0) clicks[x.id] = x.views; });
}
async function setTab(tab){
  stopReviewTimer();
  admin.tab = tab; if(tab !== 'manage') admin.editing = null; if(tab !== 'review') admin.reviewEditing = null;
  document.querySelectorAll('.adm-tab').forEach(b => {
    const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on);
  });
  if(tab === 'create'){ renderCreate(); return; }
  if(tab === 'review'){ renderReview(); return; }
  if(tab === 'security'){ renderSecurity(); return; }
  if(tab === 'audit'){ renderAudit(); return; }
  await loadStats();
  if(admin.tab !== tab || adminApp.hidden) return;   // the user moved on while loading
  if(tab === 'manage') renderManage(); else renderStats();
}

/* ---------- د) الأمان: كلمة المرور و2FA وسجل الأحداث ---------- */
const AUDIT_LABELS = {
  login:'تسجيل دخول', login_failed:'محاولة دخول فاشلة', logout:'تسجيل خروج',
  login_2fa_failed:'رمز ثنائي خاطئ عند الدخول', login_recovery_code:'دخول برمز احتياطي',
  card_create:'إضافة بطاقة', card_update:'تعديل بطاقة', card_delete:'حذف بطاقة', card_publish:'نشر بطاقة',
  password_changed:'تغيير كلمة المرور', password_change_failed:'محاولة فاشلة لتغيير كلمة المرور',
  '2fa_setup_started':'بدء إعداد المصادقة الثنائية', '2fa_enabled':'تفعيل المصادقة الثنائية',
  '2fa_enable_failed':'رمز خاطئ عند تفعيل المصادقة الثنائية', '2fa_disabled':'تعطيل المصادقة الثنائية',
  '2fa_disable_failed':'محاولة فاشلة لتعطيل المصادقة الثنائية', '2fa_reset_from_console':'تعطيل المصادقة الثنائية من الخادم'
};
const AUDIT_BAD = new Set(['login_failed','login_2fa_failed','password_change_failed','2fa_enable_failed','2fa_disable_failed']);

function fmtTime(s){
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return isNaN(d) ? String(s) : d.toLocaleString('ar-EG', {dateStyle:'medium', timeStyle:'short'});
}
const groupKey = k => String(k).replace(/(.{4})/g, '$1 ').trim();

async function renderAudit(){
  $('admBody').innerHTML = `<div class="panel"><h2>سجل الأحداث</h2><p class="sub">آخر ١٠٠ حدث: الدخول وتغيير كلمة المرور والمصادقة الثنائية وتعديل البطاقات. الأوقات بتوقيت جهازك.</p><div id="auditHost" class="empty">جارٍ التحميل…</div></div>`;
  const r = await api('GET', '/api/admin/audit');
  if(admin.tab !== 'audit' || adminApp.hidden) return;
  const host = $('auditHost'); if(!host) return;
  if(!r.ok || !r.data || !Array.isArray(r.data.entries)){ host.textContent = 'تعذّر تحميل السجل.'; return; }
  if(!r.data.entries.length){ host.textContent = 'لا توجد أحداث بعد.'; return; }
  host.className = 'audit-wrap'; host.textContent = '';
  host.innerHTML = `<table class="audit-table"><thead><tr><th>الوقت</th><th>الحدث</th><th>الحساب</th><th>التفاصيل</th><th>العنوان</th></tr></thead><tbody>${
    r.data.entries.map(e => `<tr class="${AUDIT_BAD.has(e.action) ? 'bad' : ''}">
      <td>${esc(fmtTime(e.at))}</td><td>${esc(AUDIT_LABELS[e.action] || e.action)}</td>
      <td dir="ltr">${esc(e.admin_email)}</td><td dir="ltr">${esc(e.detail)}</td><td dir="ltr">${esc(e.ip)}</td></tr>`).join('')}</tbody></table>`;
}

const PW_ERRORS = {
  wrong_password: 'كلمة المرور الحالية غير صحيحة.',
  same_password: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.',
  weak_password: 'كلمة المرور الجديدة يجب أن تكون بين ١٢ و٢٠٠ حرف.'
};
const TFA_ERRORS = {
  invalid_code: 'الرمز غير صحيح أو انتهت صلاحيته. أدخل الرمز الحالي من التطبيق.',
  wrong_password: 'كلمة المرور غير صحيحة.',
  not_pending: 'انتهت جلسة الإعداد. ابدأ من جديد.',
  already_enabled: 'المصادقة الثنائية مفعّلة بالفعل.',
  not_enabled: 'المصادقة الثنائية غير مفعّلة.'
};
const errText = (r, map) => r.status === 429 ? MSG_TOO_MANY : (r.data && map[r.data.error]) || MSG_SAVE_FAIL;

async function renderSecurity(){
  $('admBody').innerHTML = `<div class="panel"><h2>الأمان</h2><p class="sub">حماية حساب المشرف: كلمة المرور والمصادقة الثنائية.</p>
    <h3 class="sub-h">تغيير كلمة المرور</h3>
    <form id="pwForm" class="sec-form" novalidate>
      <div class="fld"><label for="pwCur">كلمة المرور الحالية</label><input id="pwCur" type="password" dir="ltr" autocomplete="current-password"></div>
      <div class="fld"><label for="pwNew">كلمة المرور الجديدة</label><input id="pwNew" type="password" dir="ltr" autocomplete="new-password"><small class="hint">١٢ حرفًا على الأقل. يُنصح بجملة طويلة لا ترتبط ببريدك. سيُسجَّل خروجك من الأجهزة الأخرى.</small></div>
      <div class="fld"><label for="pwAgain">أعد كتابة الجديدة</label><input id="pwAgain" type="password" dir="ltr" autocomplete="new-password"></div>
      <div class="form-msg" id="pwMsg" role="alert"></div>
      <button class="btn-p" type="submit">حفظ كلمة المرور</button>
    </form>
    <h3 class="sub-h">المصادقة الثنائية (2FA)</h3>
    <div id="tfaBox" class="empty">جارٍ التحميل…</div></div>`;

  $('pwForm').onsubmit = async e => {
    e.preventDefault();
    const cur = $('pwCur').value, next = $('pwNew').value, again = $('pwAgain').value, msg = $('pwMsg');
    msg.classList.remove('ok');
    if(!cur || !next){ msg.textContent = MSG_COMPLETE; return; }
    if(next !== again){ msg.textContent = 'كلمتا المرور الجديدتان غير متطابقتين.'; return; }
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    const r = await api('POST', '/api/admin/password', { current: cur, next });
    btn.disabled = false;
    if(r.ok){ e.target.reset(); msg.textContent = ''; toast('تم تغيير كلمة المرور وإنهاء الجلسات الأخرى'); }
    else msg.textContent = errText(r, PW_ERRORS);
  };

  const me = await api('GET', '/api/admin/me');
  if(admin.tab !== 'security' || adminApp.hidden || !$('tfaBox')) return;
  if(!me.ok){ $('tfaBox').textContent = 'تعذّر تحميل الحالة.'; return; }
  auth.twofa = !!me.data.twofa; syncTwofaChip();
  drawTfa(auth.twofa ? 'on' : 'off');
}

function drawTfa(state, extra){
  const box = $('tfaBox'); if(!box) return;
  box.className = 'tfa-box';
  if(state === 'off'){
    box.innerHTML = `<div class="sec-status off">غير مفعّلة</div>
      <p class="sub">تضيف المصادقة الثنائية رمزًا من ٦ أرقام يتغيّر كل ٣٠ ثانية عند كل دخول، فلا تكفي كلمة المرور وحدها. تحتاج تطبيق مصادقة على هاتفك (Google Authenticator أو Microsoft Authenticator أو Aegis أو غيرها).</p>
      <div class="form-msg" id="tfaMsg" role="alert"></div>
      <button class="btn-p" type="button" id="tfaStart">تفعيل المصادقة الثنائية</button>`;
    $('tfaStart').onclick = async () => {
      $('tfaStart').disabled = true;
      const r = await api('POST', '/api/admin/2fa/setup', {});
      if(r.ok) drawTfa('setup', r.data);
      else { $('tfaStart').disabled = false; $('tfaMsg').textContent = errText(r, TFA_ERRORS); }
    };
  }
  else if(state === 'setup'){
    box.innerHTML = `<div class="sec-status off">قيد الإعداد</div>
      <ol class="sec-steps">
        <li>في تطبيق المصادقة اختر <b>إضافة حساب</b> ثم <b>إدخال مفتاح الإعداد يدويًا</b>.</li>
        <li>اكتب أي اسم للحساب (مثلًا سِيَر)، وأدخل هذا المفتاح، واختر النوع <b>قائم على الوقت (Time-based)</b>:
          <div class="secret-box" dir="ltr" id="tfaSecret">${esc(groupKey(extra.secret))}</div>
          <button class="btn-s" type="button" id="tfaCopy">نسخ المفتاح</button></li>
        <li>أدخل الرمز المكوّن من ٦ أرقام الذي يعرضه التطبيق الآن:</li>
      </ol>
      <form id="tfaForm" class="sec-form" novalidate>
        <div class="fld"><label for="tfaCode">الرمز</label><input id="tfaCode" dir="ltr" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456"></div>
        <div class="form-msg" id="tfaMsg" role="alert"></div>
        <button class="btn-p" type="submit">تأكيد وتفعيل</button>
        <button class="btn-s" type="button" id="tfaCancel">إلغاء</button>
      </form>`;
    $('tfaCopy').onclick = async () => toast((await copyText(extra.secret)) ? 'تم نسخ المفتاح' : 'تعذّر النسخ', false);
    $('tfaCancel').onclick = () => drawTfa('off');
    $('tfaForm').onsubmit = async e => {
      e.preventDefault();
      const code = $('tfaCode').value.trim();
      if(!code){ $('tfaMsg').textContent = MSG_COMPLETE; return; }
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      const r = await api('POST', '/api/admin/2fa/enable', { code });
      btn.disabled = false;
      if(r.ok){ auth.twofa = true; syncTwofaChip(); drawTfa('codes', r.data.recoveryCodes); }
      else $('tfaMsg').textContent = errText(r, TFA_ERRORS);
    };
    $('tfaCode').focus();
  }
  else if(state === 'codes'){
    const text = 'رموز الاسترداد لموقع سِيَر (كل رمز يُستعمل مرة واحدة)\n\n' + extra.join('\n') + '\n';
    box.innerHTML = `<div class="sec-status on">تم التفعيل</div>
      <div class="notice">احفظ رموز الاسترداد هذه الآن في مكان آمن (مدير كلمات مرور أو ورقة). <b>لن تظهر مرة أخرى.</b> يعمل كل رمز مرة واحدة إذا ضاع هاتفك.</div>
      <div class="codes-grid" dir="ltr">${extra.map(c => `<code>${esc(c)}</code>`).join('')}</div>
      <div class="sec-actions">
        <button class="btn-s" type="button" id="codesCopy">نسخ الرموز</button>
        <button class="btn-s" type="button" id="codesSave">تنزيل ملف نصي</button>
        <button class="btn-p" type="button" id="codesDone">حفظتها، متابعة</button>
      </div>`;
    $('codesCopy').onclick = async () => toast((await copyText(text)) ? 'تم نسخ الرموز' : 'تعذّر النسخ', false);
    $('codesSave').onclick = () => downloadBlob(new Blob([text], {type:'text/plain;charset=utf-8'}), 'siyar-recovery-codes.txt');
    $('codesDone').onclick = () => drawTfa('on');
  }
  else {   // on
    box.innerHTML = `<div class="sec-status on">مفعّلة</div>
      <p class="sub">يُطلب رمز من التطبيق عند كل تسجيل دخول. لتعطيلها أدخل كلمة المرور ورمزًا حاليًا (أو رمز استرداد).</p>
      <form id="tfaOff" class="sec-form" novalidate>
        <div class="fld"><label for="offPw">كلمة المرور</label><input id="offPw" type="password" dir="ltr" autocomplete="current-password"></div>
        <div class="fld"><label for="offCode">الرمز</label><input id="offCode" dir="ltr" autocomplete="one-time-code" maxlength="12" placeholder="123456"></div>
        <div class="form-msg" id="tfaMsg" role="alert"></div>
        <button class="btn-s btn-d" type="submit">تعطيل المصادقة الثنائية</button>
      </form>`;
    $('tfaOff').onsubmit = async e => {
      e.preventDefault();
      const password = $('offPw').value, code = $('offCode').value.trim();
      if(!password || !code){ $('tfaMsg').textContent = MSG_COMPLETE; return; }
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      const r = await api('POST', '/api/admin/2fa/disable', { password, code });
      btn.disabled = false;
      if(r.ok){ auth.twofa = false; syncTwofaChip(); toast('تم تعطيل المصادقة الثنائية'); drawTfa('off'); }
      else $('tfaMsg').textContent = errText(r, TFA_ERRORS);
    };
  }
}

// Small reminder in the admin header while 2FA is off.
function syncTwofaChip(){
  const chip = $('twofaChip'); if(chip) chip.hidden = auth.twofa !== false;
}

/* ---------- أ) نموذج البطاقة (إضافة / تعديل) ---------- */
function eraOptions(sel){
  return `<option value="">— اختر الحقبة —</option>` + ERAS.filter(e=>e.key!=='all')
    .map(e=>`<option value="${e.key}"${e.key===sel?' selected':''}>${esc(e.label)}</option>`).join('');
}
function fld(label, name, val, o={}){
  const id = 'f-' + name;
  const control = o.select ? `<select id="${id}" data-f="${name}">${o.select}</select>`
    : o.area ? `<textarea id="${id}" data-f="${name}" rows="${o.rows||4}" placeholder="${esc(o.ph||'')}">${esc(val||'')}</textarea>`
    : `<input id="${id}" data-f="${name}" value="${esc(val||'')}" placeholder="${esc(o.ph||'')}" autocomplete="off">`;
  return `<div class="fld"><label for="${id}">${esc(label)}${o.req?'<b class="req">*</b>':''}</label>${control}${o.hint?`<small class="hint">${esc(o.hint)}</small>`:''}<small class="err" data-err="${name}"></small></div>`;
}
function hadithRow(h={}, req){
  const grades = ['صحيح','حسن','متفق عليه','ضعيف','ملاحظة'];
  return `<div class="h-row">
    <button type="button" class="rm" data-rm>حذف</button>
    <div class="fld"><label>نص الحديث</label><textarea data-h="text" rows="3">${esc(h.text||'')}</textarea></div>
    <div class="row2">
      <div class="fld"><label>الراوي</label><input data-h="narrator" value="${esc(h.narrator||'')}"></div>
      <div class="fld"><label>المصدر (اسم الكتاب)${req?'<b class="req">*</b>':''}</label><input data-h="source" value="${esc(h.source||'')}"></div>
    </div>
    <div class="row2">
      <div class="fld"><label>الصفحة / الباب</label><input data-h="page" value="${esc(h.page||'')}" placeholder="مثال: كتاب الإيمان، باب ..." autocomplete="off"></div>
      <div class="fld"><label>رقم الحديث</label><input data-h="number" value="${esc(h.number||'')}" autocomplete="off"></div>
    </div>
    <div class="fld no-mb"><label>الدرجة</label>
      <select data-h="grade">${grades.map(g=>`<option${g===(h.grade||'صحيح')?' selected':''}>${g}</option>`).join('')}</select></div>
  </div>`;
}
const branchItems = (c,id) => ((c.branches||[]).find(b=>b.id===id)||{items:[]}).items;

function fieldsHTML(type, c, req){
  c = c || {};
  if(type === 'figure'){
    const ht = c.headerType === 'image' ? 'image' : 'text';
    return `
      <div class="row2">${fld('الاسم','name',c.name,{req:1,ph:'مثال: سعد بن أبي وقاص'})}${fld('اللقب','title',c.title,{req:1,ph:'مثال: فاتح القادسية'})}</div>
      <div class="row2">${fld('الحقبة','era',c.era,{req:1,select:eraOptions(c.era)})}${fld('التواريخ','dates',c.dates,{ph:'مثال: ٢٣ ق.هـ – ٥٥ هـ'})}</div>
      <div class="row2">${fld('الدور','role',c.role)}${fld('أبرز المحطات','famousFor',c.famousFor)}</div>
      ${fld('النبذة','summary',c.summary,{req:1,area:1,rows:4})}
      <div class="fld"><label>نوع ترويسة البطاقة</label>
        <div class="radio-line">
          <label><input type="radio" name="htype" value="text"${ht==='text'?' checked':''}> نص فني</label>
          <label><input type="radio" name="htype" value="image"${ht==='image'?' checked':''}> صورة (رابط)</label>
        </div></div>
      ${fld('قيمة الترويسة','headerValue',c.headerValue && !(ht==='image' && String(c.headerValue).startsWith('data:')) ? c.headerValue : (ht==='image' && c.headerValue ? c.headerValue : ''),{ph: ht==='image' ? 'https://example.com/image.jpg' : 'عبارة قصيرة تظهر بالخط الفني'})}
      <h3 class="sub-h">فروع السيرة</h3>
      ${fld('النشأة والبدايات','origins',branchItems(c,'origins').join('\n'),{area:1,rows:4,hint:'اكتب كل نقطة في سطر مستقل.'})}
      ${fld('مواقف وبطولات','heroics',branchItems(c,'heroics').join('\n'),{area:1,rows:4,hint:'اكتب كل نقطة في سطر مستقل.'})}
      <div class="fld"><label>الأحاديث المروية بحقه وتخريجها</label>
        <div id="hList">${branchItems(c,'hadith').map(h => hadithRow(h, req)).join('')}</div><small class="err" data-err="hsrc"></small>
        <button type="button" class="btn-s start-self" id="addHadith">＋ إضافة حديث</button></div>`;
  }
  const ownerLbl = type === 'seerah' ? 'صاحب الحدث / الموقف' : 'صاحب الموقف';
  return `
    ${fld('العنوان','title',c.title,{req:1,ph: type==='seerah' ? 'مثال: غزوة أحد' : 'مثال: موقف عمر في فتح القدس'})}
    <div class="row2">${fld(ownerLbl,'owner',c.owner,{req:1, ph: type==='seerah' ? 'النبي محمد ﷺ' : ''})}${fld('الحقبة','era',c.era,{req:1,select:eraOptions(c.era)})}</div>
    ${fld('النص التفصيلي','text',c.text,{req:1,area:1,rows:7,hint:'يمكن كتابة عدة فقرات؛ تُحفظ الأسطر كما هي.'})}
    <div class="row2">${fld('المصدر (اسم الكتاب)','source',c.source,{req:req,ph:'مثال: صحيح البخاري، سيرة ابن هشام…'})}${fld('الصفحة / الباب','page',c.page,{ph:'مثال: ج٣ ص٤٥ أو كتاب المغازي'})}</div>`;
}

function collectForm(type, root, requireSource){
  const v = n => { const el = root.querySelector(`[data-f="${n}"]`); return el ? el.value.trim() : ''; };
  const errors = {};
  const need = (n, msg) => { if(!v(n)) errors[n] = msg || 'هذا الحقل مطلوب'; };
  let data;
  if(type === 'figure'){
    need('name'); need('title'); need('era','اختر الحقبة'); need('summary');
    const htype = (root.querySelector('input[name="htype"]:checked')||{}).value || 'text';
    let hv = v('headerValue');
    if(htype === 'image'){ if(!hv) errors.headerValue = 'أدخل رابط الصورة'; else if(!validImg(hv)) errors.headerValue = 'الرابط يجب أن يبدأ بـ https:// أو http://'; }
    const lines = s => s.split('\n').map(x=>x.trim()).filter(Boolean);
    const branches = [];
    const o = lines(v('origins')), h = lines(v('heroics'));
    if(o.length) branches.push({id:'origins', title:'النشأة والبدايات', icon:'🌱', type:'text', items:o});
    if(h.length) branches.push({id:'heroics', title:'مواقف وبطولات', icon:'⚔️', type:'text', items:h});
    const hs = [...root.querySelectorAll('.h-row')].map(r => {
      const g = n => (r.querySelector(`[data-h="${n}"]`)||{value:''}).value.trim();
      return {text:g('text'), narrator:g('narrator'), source:g('source'), page:g('page'), number:g('number'), grade:g('grade')||'صحيح'};
    }).filter(x => x.text);
    if(requireSource && hs.some(x => !x.source)) errors.hsrc = MSG_HSRC;
    if(hs.length) branches.push({id:'hadith', title:'الأحاديث المروية بحقه وتخريجها', icon:'📜', type:'hadith', items:hs});
    data = {type:'figure', name:v('name'), title:v('title'), era:v('era'), dates:v('dates'), role:v('role'), famousFor:v('famousFor'),
            summary:v('summary'), headerType:htype, headerValue: htype==='text' ? (hv || v('name')) : hv, branches};
  } else {
    need('title'); need('owner'); need('era','اختر الحقبة'); need('text');
    if(requireSource) need('source', MSG_SRC);
    data = {type, title:v('title'), owner:v('owner'), era:v('era'), text:v('text'), source:v('source'), page:v('page')};
  }
  return {data, errors};
}
function showErrors(root, errors){
  root.querySelectorAll('[data-err]').forEach(e => e.textContent = '');
  root.querySelectorAll('[aria-invalid]').forEach(e => e.removeAttribute('aria-invalid'));
  let first = null;
  Object.keys(errors).forEach(n => {
    const m = root.querySelector(`[data-err="${n}"]`); if(m) m.textContent = errors[n];
    const inp = root.querySelector(`[data-f="${n}"]`); if(inp){ inp.setAttribute('aria-invalid','true'); if(!first) first = inp; }
  });
  if(errors.hsrc){
    root.querySelectorAll('.h-row').forEach(r => {
      const t = r.querySelector('[data-h="text"]'), src = r.querySelector('[data-h="source"]');
      if(t && src && t.value.trim() && !src.value.trim()){ src.setAttribute('aria-invalid','true'); if(!first) first = src; }
    });
  }
  if(first) first.focus();
}

/* يبني النموذج داخل عنصر root. mode: create | edit */
function mountForm(root, {type, card, mode, from}){
  // sources are mandatory for new cards, cards in review, and cards that already have complete sources
  const requireSource = mode === 'create' || from === 'review' || (!!card && sourcesComplete(card));
  root.innerHTML = `<form id="cardForm" novalidate><div id="dyn">${fieldsHTML(type, card, requireSource)}</div>
    <div class="form-actions">
      <button type="submit" class="btn-p">${mode==='edit' ? '💾 حفظ التعديلات' : '✅ حفظ البطاقة'}</button>
      ${mode==='edit' ? '<button type="button" class="btn-s" id="cancelEdit">إلغاء</button>' : '<button type="reset" class="btn-s" id="resetForm">تفريغ الحقول</button>'}
    </div></form>`;
  const form = $('cardForm');
  const syncHeader = () => {
    const t = (form.querySelector('input[name="htype"]:checked')||{}).value;
    const inp = form.querySelector('[data-f="headerValue"]');
    if(inp) inp.placeholder = t === 'image' ? 'https://example.com/image.jpg' : 'عبارة قصيرة تظهر بالخط الفني';
  };
  form.addEventListener('change', e => { if(e.target.name === 'htype') syncHeader(); });
  form.addEventListener('click', e => {
    if(e.target.id === 'addHadith'){ $('hList').insertAdjacentHTML('beforeend', hadithRow({}, requireSource)); const rows = $('hList').querySelectorAll('.h-row'); rows[rows.length-1].querySelector('textarea').focus(); }
    const rm = e.target.closest('[data-rm]'); if(rm) rm.closest('.h-row').remove();
    if(e.target.id === 'cancelEdit'){
      if(from === 'review'){ admin.reviewEditing = null; renderReview(); } else { admin.editing = null; renderManage(); }
    }
    if(e.target.id === 'resetForm'){ e.preventDefault(); mountForm(root, {type, card:null, mode}); }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const {data, errors} = collectForm(type, form, requireSource);
    if(Object.keys(errors).length){ showErrors(form, errors); toast(MSG_COMPLETE, true); return; }
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    const r = mode === 'edit'
      ? await api('PUT', '/api/admin/cards/' + encodeURIComponent(card.id), Object.assign({}, data, {id: card.id, type}))
      : await api('POST', '/api/admin/cards', Object.assign({id: uid(type.charAt(0))}, data, {type}));
    btn.disabled = false;
    if(!r.ok){
      const f = String((r.data && r.data.error) || '').replace(/^bad_/, '');
      if(f === 'hadith_source') showErrors(form, {hsrc: MSG_HSRC});
      else if(f === 'source') showErrors(form, {source: MSG_SRC});
      else if(f && form.querySelector('[data-f="' + f + '"]')) showErrors(form, {[f]: MSG_INVALID});
      toast(r.status === 401 ? MSG_EXPIRED : MSG_SAVE_FAIL, true);
      return;
    }
    if(mode === 'edit' && from === 'review'){
      toast(MSG_REVIEW_SAVED);
      admin.reviewEditing = null; renderReview();
    } else if(mode === 'edit'){
      const coll = db[TYPES[type].coll], i = coll.findIndex(x => x.id === card.id);
      if(i >= 0) coll[i] = Object.assign({publishedAt: coll[i].publishedAt}, r.data);
      update(); toast(MSG_SAVED);
      admin.editing = null; renderManage();
    } else {
      // a new card goes to the review queue, not to the public site
      toast(MSG_ADDED_REVIEW);
      admin.filter = {q:'', type:'all'}; setTab('review');
    }
  });
  syncHeader();
}

function renderCreate(){
  const t = admin.createType;
  $('admBody').innerHTML = `<div class="panel">
    <h2>إضافة بطاقة جديدة</h2><p class="sub">اختر نوع البطاقة، ثم عبّئ الحقول التي تتغير تلقائيًا بحسب النوع.</p>
    <div class="type-pick" role="radiogroup" aria-label="نوع البطاقة">
      ${TYPE_KEYS.map(k=>`<label><input type="radio" name="ctype" value="${k}"${k===t?' checked':''}>
        <span class="tic">${TYPES[k].icon}</span><span><b>${TYPES[k].label}</b><small>${TYPES[k].hint}</small></span></label>`).join('')}
    </div>
    <div id="formHost"></div></div>`;
  const host = $('formHost');
  mountForm(host, {type:t, card:null, mode:'create'});
  document.querySelectorAll('input[name="ctype"]').forEach(r => r.addEventListener('change', () => {
    admin.createType = r.value; mountForm(host, {type:r.value, card:null, mode:'create'});
  }));
}

/* ---------- ب) إدارة البطاقات ---------- */
async function ensureFull(id){
  const c = findCard(id); if(!c) return false;
  if(c.type !== 'figure' || c.branches) return true;
  const r = await api('GET', '/api/cards/' + encodeURIComponent(id));
  if(!r.ok){ toast(MSG_LOAD_FAIL, true); return false; }
  const coll = db[TYPES[c.type].coll], i = coll.findIndex(x => x.id === id);
  if(i >= 0) coll[i] = r.data;
  return true;
}
function renderManage(){
  if(admin.editing){
    const c = findCard(admin.editing);
    if(c){
      $('admBody').innerHTML = `<div class="panel">
        <h2>تعديل: ${esc(cardTitle(c))}</h2><p class="sub"><span class="tbadge ${c.type}">${TYPES[c.type].label}</span> — يمكن تعديل أي حقل ثم حفظ التغييرات فورًا.</p>
        <div class="type-pick">${TYPE_KEYS.map(k=>`<label class="locked"><input type="radio" disabled ${k===c.type?'checked':''}><span class="tic">${TYPES[k].icon}</span><span><b>${TYPES[k].label}</b></span></label>`).join('')}</div>
        <div id="formHost"></div></div>`;
      mountForm($('formHost'), {type:c.type, card:c, mode:'edit'});
      window.scrollTo({top:0});
      return;
    }
    admin.editing = null;
  }
  const f = admin.filter;
  $('admBody').innerHTML = `<div class="panel">
    <h2>إدارة البطاقات</h2><p class="sub">البطاقات المنشورة في الموقع. البطاقات الجديدة تنتظر في تبويب «قيد المراجعة» حتى تنشرها.</p>
    <div class="toolbar">
      <div class="fld"><input id="mSearch" type="search" placeholder="ابحث في البطاقات…" value="${esc(f.q)}" aria-label="بحث في البطاقات"></div>
      <div class="fld mw220"><select id="mType" aria-label="تصفية بالنوع">
        <option value="all">كل الأنواع</option>${TYPE_KEYS.map(k=>`<option value="${k}"${f.type===k?' selected':''}>${TYPES[k].label}</option>`).join('')}</select></div>
    </div>
    <div class="list" id="mList"></div>
    <div class="panel-foot"><span id="mCount"></span>
    </div></div>`;
  const draw = () => {
    const q = norm(admin.filter.q);
    const rows = TYPE_KEYS.flatMap(k => db[TYPES[k].coll])
      .filter(c => (admin.filter.type==='all' || c.type===admin.filter.type) && (!q || searchText(c).includes(q)));
    $('mList').innerHTML = rows.length ? rows.map(c => `
      <div class="item" data-id="${esc(c.id)}">
        <div class="nm">${esc(cardTitle(c))}<small>${c.type==='figure' ? esc(c.title) : esc(c.owner)}</small></div>
        <div><span class="tbadge ${c.type}">${TYPES[c.type].short}</span></div>
        <div>${esc(eraLabel(c.era))}</div>
        <div class="vw">👁 ${fmt(clickOf(c.id))}</div>
        <div class="acts">
          <button type="button" class="btn-s" data-act="preview">معاينة</button>
          <button type="button" class="btn-s" data-act="edit">تعديل</button>
          <button type="button" class="btn-s btn-d" data-act="del">حذف</button>
        </div>
      </div>`).join('') : `<div class="empty">لا توجد بطاقات مطابقة.</div>`;
    $('mCount').textContent = `الإجمالي: ${fmt(allCards().length)} بطاقة • المعروض: ${fmt(rows.length)}`;
  };
  draw();
  $('mSearch').oninput = e => { admin.filter.q = e.target.value; draw(); };
  $('mType').onchange = e => { admin.filter.type = e.target.value; draw(); };
  $('mList').onclick = async e => {
    const b = e.target.closest('[data-act]'); if(!b) return;
    const id = b.closest('.item').dataset.id, c = findCard(id); if(!c) return;
    if(b.dataset.act === 'preview') openCard(id, {preview:true});
    else if(b.dataset.act === 'edit'){ if(!(await ensureFull(id))) return; admin.editing = id; renderManage(); }
    else if(b.dataset.act === 'del'){
      const ok = await confirmDialog({title:'تأكيد الحذف', message:`سيتم حذف «${cardTitle(c)}» نهائيًا مع عدّاد مشاهداتها، ولا يمكن التراجع عن ذلك.`, ok:'نعم، احذف'});
      if(!ok) return;
      const dr = await api('DELETE', '/api/admin/cards/' + encodeURIComponent(id));
      if(!dr.ok){ toast(dr.status === 401 ? MSG_EXPIRED : MSG_SAVE_FAIL, true); return; }
      const coll = db[TYPES[c.type].coll]; coll.splice(coll.findIndex(x=>x.id===id), 1);
      delete clicks[id]; update(); toast(MSG_DELETED); draw();
    }
  };
}

/* ---------- هـ) قيد المراجعة ---------- */
// A new card is locked for a fixed time (reviewMs, sent by the server). When the lock ends it is NOT
// published by itself: the admin must confirm. The server enforces both rules; this screen only shows them.
const fmtDur = ms => {
  const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
  return [h, m, sec].map(x => String(x).padStart(2, '0')).join(':');
};
const fmtMs = ms => ms ? new Date(ms).toLocaleString('ar-EG', {dateStyle:'medium', timeStyle:'short'}) : '—';
const reviewLabel = ms => {
  if(ms < 60000) return Math.max(1, Math.round(ms / 1000)) + ' ثانية';
  const m = Math.round(ms / 60000);
  return m === 120 ? 'ساعتين' : m === 60 ? 'ساعة' : (m % 60 === 0 ? (m / 60) + ' ساعات' : m + ' دقيقة');
};
let reviewTimer = null;
function stopReviewTimer(){ if(reviewTimer){ clearInterval(reviewTimer); reviewTimer = null; } }

async function renderReview(){
  stopReviewTimer();
  const body = $('admBody');
  if(admin.reviewEditing){
    const c = admin.reviewEditing;
    body.innerHTML = `<div class="panel">
      <h2>تعديل (قيد المراجعة): ${esc(cardTitle(c))}</h2>
      <p class="sub"><span class="tbadge ${c.type}">${TYPES[c.type].label}</span> — حفظ التعديلات يعيد مدة المراجعة من البداية.</p>
      <div id="formHost"></div></div>`;
    mountForm($('formHost'), {type:c.type, card:c, mode:'edit', from:'review'});
    window.scrollTo({top:0});
    return;
  }
  body.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
  const [rv, pb] = await Promise.all([api('GET', '/api/admin/cards?status=review'), api('GET', '/api/admin/cards?status=published')]);
  if(admin.tab !== 'review' || adminApp.hidden || admin.reviewEditing) return;   // the user moved on while loading
  if(rv.status === 401) return;
  if(!rv.ok || !pb.ok || !rv.data || !pb.data){ body.innerHTML = `<div class="empty">${esc(MSG_REVIEW_FAIL)}</div>`; return; }
  const skew = rv.data.now - Date.now();                 // server clock minus this browser's clock
  const pending = rv.data.cards, recent = pb.data.cards.slice(0, 10);
  const head = c => `<div class="nm">${esc(c.title)}<small>${esc(c.sub)}</small></div>
        <div><span class="tbadge ${c.type}">${TYPES[c.type].short}</span></div><div>${esc(eraLabel(c.era))}</div>`;
  body.innerHTML = `<div class="panel" id="rvRoot">
    <h2>قيد المراجعة</h2>
    <p class="sub">كل بطاقة جديدة تبقى هنا مقفلة ${esc(reviewLabel(rv.data.reviewMs))} ولا تظهر للزوار. بعد انتهاء المدة لا تُنشر تلقائيًا: راجعها ثم اضغط «تأكيد ونشر». أي تعديل على بطاقة هنا يعيد المدة من البداية.</p>
    <div class="list">${pending.length ? pending.map(c => `
      <div class="item rv" data-id="${esc(c.id)}" data-ready="${Number(c.readyAt) || 0}">
        ${head(c)}
        <div class="rv-st"></div>
        <div class="acts">
          <button type="button" class="btn-s" data-act="preview">معاينة</button>
          <button type="button" class="btn-s" data-act="edit">تعديل</button>
          <button type="button" class="btn-s btn-d" data-act="del">حذف</button>
          <button type="button" class="btn-p rv-pub" data-act="publish" disabled>نشر (مقفل)</button>
        </div>
      </div>`).join('') : '<div class="empty">لا توجد بطاقات قيد المراجعة. البطاقات الجديدة التي تضيفها تظهر هنا.</div>'}</div>
    <h3 class="sec-title rv-sec">✔ آخر ما نُشر</h3>
    <div class="list">${recent.length ? recent.map(c => `
      <div class="item rv" data-id="${esc(c.id)}">
        ${head(c)}
        <div class="rv-st ready">نُشرت: ${esc(fmtMs(c.publishedAt))}</div>
        <div class="acts"><button type="button" class="btn-s" data-act="preview">معاينة</button></div>
      </div>`).join('') : '<div class="empty">لم تُنشر أي بطاقة بعد.</div>'}</div>
    <div class="panel-foot"><span>قيد المراجعة: ${fmt(pending.length)} • المنشورة: ${fmt(pb.data.cards.length)}</span></div></div>`;

  const root = $('rvRoot');
  const tick = () => {
    if(admin.tab !== 'review' || adminApp.hidden || !root.isConnected){ stopReviewTimer(); return; }
    const now = Date.now() + skew;
    root.querySelectorAll('.item[data-ready]').forEach(el => {
      const left = Number(el.dataset.ready) - now;
      const st = el.querySelector('.rv-st'), btn = el.querySelector('[data-act="publish"]');
      if(left > 0){ st.className = 'rv-st lock'; st.textContent = '🔒 مقفلة: ' + fmtDur(left); btn.disabled = true; btn.textContent = 'نشر (مقفل)'; }
      else { st.className = 'rv-st ready'; st.textContent = '✅ جاهزة لتأكيدك'; btn.disabled = false; btn.textContent = '✔ تأكيد ونشر'; }
    });
  };
  tick(); reviewTimer = setInterval(tick, 1000);

  root.onclick = async e => {
    const b = e.target.closest('[data-act]'); if(!b || b.disabled) return;
    const id = b.closest('.item').dataset.id, c = pending.find(x => x.id === id) || recent.find(x => x.id === id);
    if(!c) return;
    const act = b.dataset.act;
    if(act === 'preview') openCard(id, {preview:true, admin:true});
    else if(act === 'edit'){
      const r = await api('GET', '/api/admin/cards/' + encodeURIComponent(id));
      if(!r.ok || !r.data || !r.data.card){ if(r.status !== 401) toast(MSG_LOAD_FAIL, true); return; }
      admin.reviewEditing = r.data.card; renderReview();
    }
    else if(act === 'del'){
      const ok = await confirmDialog({title:'تأكيد الحذف', message:`سيتم حذف «${c.title}» نهائيًا، ولا يمكن التراجع عن ذلك.`, ok:'نعم، احذف'});
      if(!ok) return;
      const dr = await api('DELETE', '/api/admin/cards/' + encodeURIComponent(id));
      if(dr.status === 401) return;
      if(!dr.ok){ toast(MSG_SAVE_FAIL, true); return; }
      toast(MSG_DELETED); renderReview();
    }
    else if(act === 'publish'){
      const ok = await confirmDialog({title:'تأكيد النشر', message:`هل راجعت «${c.title}» وتأكدت أنها سليمة وجاهزة؟ ستظهر فورًا للزوار في الواجهة العامة.`, ok:'نعم، انشرها'});
      if(!ok) return;
      b.disabled = true;
      const r = await api('POST', '/api/admin/cards/' + encodeURIComponent(id) + '/publish', {confirm:true});
      if(r.status === 401) return;
      if(!r.ok){
        const err = r.data && r.data.error;
        toast(err === 'still_in_review' ? MSG_NOT_READY : err === 'not_in_review' ? MSG_NOT_IN_REVIEW : MSG_SAVE_FAIL, true);
        renderReview(); return;
      }
      toast(MSG_PUBLISHED);
      await loadCards();                                  // the public lists now include it
      renderReview();
    }
  };
}

/* ---------- ج) الإحصائيات ---------- */
function renderStats(){
  const per = TYPE_KEYS.map(k => {
    const list = db[TYPES[k].coll];
    return {k, count:list.length, total:list.reduce((s,c)=>s+clickOf(c.id),0)};
  });
  const grand = per.reduce((s,p)=>s+p.total,0);
  const maxT = Math.max(1, ...per.map(p=>p.total));
  const cls = {figure:'e', stance:'g', seerah:'b'}, meter = {figure:'', stance:'g', seerah:'b'};
  const ranked = allCards().map(c => ({c, n:clickOf(c.id)})).filter(x=>x.n>0)
    .sort((a,b)=> b.n-a.n || cardTitle(a.c).localeCompare(cardTitle(b.c),'ar')).slice(0,10);
  const maxR = ranked.length ? ranked[0].n : 1;
  $('admBody').innerHTML = `<div class="panel">
    <h2>إحصائيات التفاعل</h2><p class="sub">${esc(STATS_SUB)}</p>
    <div class="stat-grid">
      <div class="stat"><small>إجمالي النقرات</small><div class="n">${fmt(grand)}</div><div class="cnt">${fmt(allCards().length)} بطاقة في المنصة</div></div>
      ${per.map(p=>`<div class="stat"><small>${TYPES[p.k].portal}</small><div class="n ${cls[p.k]}">${fmt(p.total)} <span class="unit">نقرة</span></div>
        <div class="cnt">${fmt(p.count)} بطاقة</div><div class="meter ${meter[p.k]}"><i data-w="${Math.round(p.total/maxT*100)}"></i></div></div>`).join('')}
    </div>
    <h3 class="sec-title">🏆 الأكثر قراءة وزيارة</h3>
    <div id="rankList">${ranked.length ? ranked.map((x,i)=>`
      <div class="rank"><div class="no">${fmt(i+1)}</div>
        <div><div class="nm">${esc(cardTitle(x.c))}<span class="tbadge ${x.c.type}">${TYPES[x.c.type].short}</span></div>
        <div class="meter ${meter[x.c.type]}"><i data-w="${Math.round(x.n/maxR*100)}"></i></div></div>
        <div class="v">${fmt(x.n)} نقرة</div></div>`).join('') : '<div class="empty">لا توجد نقرات بعد. افتح بعض البطاقات من الواجهة العامة لتظهر الإحصائيات.</div>'}</div>
    </div>`;
}

/* =====================================================
   10) التوجيه (SPA) والتنقل
   ===================================================== */
const publicApp = $('publicApp');
function showPublic(){
  const wasAdmin = !adminApp.hidden;
  clearInterval(auth.timer);
  adminApp.hidden = true; publicApp.hidden = false;
  if(wasAdmin){ update(); }
}
function showAdmin(){
  closeModal();
  publicApp.hidden = true; adminApp.hidden = false;
  window.scrollTo(0,0);
  if(isAuthed()) renderDashboard();
  else renderLogin();
}
async function enterAdmin(){
  if(!auth.csrf){
    const r = await api('GET', '/api/admin/me');
    if(r.ok){ auth.email = r.data.email; auth.csrf = r.data.csrf; auth.twofa = !!r.data.twofa; }
  }
  if(location.hash === '#admin' || location.hash.startsWith('#admin/')) showAdmin();
}
function showStaticAdmin(){
  closeModal();
  clearInterval(auth.timer);
  publicApp.hidden = true; adminApp.hidden = false;
  adminApp.innerHTML = authShell('<h1>\u0627\u0644\u0625\u062f\u0627\u0631\u0629 \u0645\u062a\u0627\u062d\u0629 \u0645\u062d\u0644\u064a\u064b\u0627 \u0641\u0642\u0637</h1>' +
    '<p class="sub">\u0647\u0630\u0647 \u0627\u0644\u0646\u0633\u062e\u0629 \u0645\u0646 \u0627\u0644\u0645\u0648\u0642\u0639 \u0644\u0644\u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637\u060c \u0648\u062a\u062a\u0645 \u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0628\u0637\u0627\u0642\u0627\u062a \u0645\u0646 \u0627\u0644\u0646\u0633\u062e\u0629 \u0627\u0644\u0645\u062d\u0644\u064a\u0629.</p>' +
    '<a class="back-link" href="#home">\u2190 \u0627\u0644\u0639\u0648\u062f\u0629 \u0625\u0644\u0649 \u0627\u0644\u0645\u0648\u0642\u0639</a>');
  window.scrollTo(0,0);
}
function route(){
  const h = location.hash;
  if(h === '#admin' || h.startsWith('#admin/')){ if(STATIC){ showStaticAdmin(); return; } enterAdmin(); return; }
  const wasAdmin = !adminApp.hidden;
  showPublic();
  if(wasAdmin){
    const el = h.length > 1 ? document.getElementById(h.slice(1)) : null;
    setTimeout(()=> el ? el.scrollIntoView() : window.scrollTo(0,0), 0);
  }
}
window.addEventListener('hashchange', route);


// تمييز القسم الحالي في الشريط العلوي
const navLinks = [...document.querySelectorAll('nav.main-nav a')];
if('IntersectionObserver' in window){
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if(en.isIntersecting) navLinks.forEach(a => a.classList.toggle('active', a.dataset.sec === en.target.id)); });
  }, {rootMargin:'-35% 0px -55% 0px'});
  ['home','figures','stances','seerah'].forEach(id => io.observe($(id)));
}

/* ========= تشغيل ========= */
let matchIds = null, searchTimer = null, searchSeq = 0, searchIndex = null;
function loadSearchIndex(){
  if(!searchIndex){
    searchIndex = fetch('/data/search.json').then(function(r){ if(!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .catch(function(e){ searchIndex = null; throw e; });
  }
  return searchIndex;
}

function remoteSearch(){
  clearTimeout(searchTimer);
  const raw = state.q.trim();
  if(!raw){ matchIds = null; return; }
  searchTimer = setTimeout(async function(){
    const seq = ++searchSeq;
    try{
      if(STATIC){
        const idx = await loadSearchIndex();
        if(seq !== searchSeq) return;
        const needle = norm(raw.slice(0, 100));
        matchIds = new Set(idx.filter(function(e){ return e.t.indexOf(needle) !== -1; }).map(function(e){ return e.id; }));
        update();
        return;
      }
      const r = await fetch('/api/cards?q=' + encodeURIComponent(raw.slice(0, 100)));
      if(!r.ok) return;
      const data = await r.json();
      if(seq !== searchSeq) return;
      matchIds = new Set((data.cards || []).map(function(c){ return c.id; }));
      update();
    }catch(e){ /* keep local results */ }
  }, 250);
}

async function loadCards(){
  const msg = function(t, cls){ return '<div class="' + cls + '">' + esc(t) + '</div>'; };
  const loading = msg("\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0628\u0637\u0627\u0642\u0627\u062a\u2026", 'empty');
  figGrid.innerHTML = loading; stGrid.innerHTML = loading; srGrid.innerHTML = loading;
  try{
    const r = await fetch(STATIC ? '/data/cards.json' : '/api/cards');
    if(!r.ok) throw new Error('http ' + r.status);
    const data = await r.json();
    const next = {figures:[], stances:[], seerah:[]};
    (data.cards || []).forEach(function(c){ const t = TYPES[c.type]; if(t) next[t.coll].push(c); });
    db = next;
    update();
  }catch(e){
    const err = msg("\u062a\u0639\u0630\u0651\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0628\u0637\u0627\u0642\u0627\u062a. \u062a\u0623\u0643\u062f \u0645\u0646 \u0627\u0644\u0627\u062a\u0635\u0627\u0644 \u062b\u0645 \u0623\u0639\u062f \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0635\u0641\u062d\u0629.", 'empty');
    figGrid.innerHTML = err; stGrid.innerHTML = err; srGrid.innerHTML = err;
  }
}

renderFilters();
route();
loadCards().then(async function(){
  const id = cardIdFromPath();                      // the page was opened on /c/:id
  if(!id) return;
  await openCard(id);
  if(!overlay.classList.contains('open')){ toast(MSG_CARD_MISSING, true); history.replaceState(null, '', '/'); }
});
})();
