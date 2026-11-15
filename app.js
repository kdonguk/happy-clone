/* TestAnchor 핀 리뷰 보드
   - 두 탭(화면 시안 / 서버 흐름도)에 번호 핀을 꽂고 한 줄 의견을 남긴다.
   - 화면 시안 ↔ 서버 흐름도는 양방향 연결 칩으로 이어진다(넓은 화면은 나란히 보기).
   - [의견 제출] 은 ntfy 채널로 JSON 을 POST 한다(로그인 없음).
   - 제출 기록은 같은 채널에서 되읽어 확인할 수 있다.
*/
(function () {
  'use strict';

  var APP_ID = 'ta-review-board';
  var TOPIC = 'pk-ta-rb-9f24c1d7a3be5e60';
  var ENDPOINT = 'https://ntfy.sh/' + TOPIC;
  var LS_REVIEW = 'taRB.reviewId';
  var LS_PINS = 'taRB.pins.v1:';
  var DEFAULT_REVIEW = 'testanchor-sample-v1';
  var SPLIT_MIN = 1024;

  /* 화면 이름 — 흐름도 노드의 칩 문구에 쓴다 */
  var SCREEN_META = {
    S1: 'S1 실행 대상',
    S2: 'S2 직접 연결',
    S3: 'S3 14단계',
    S4: 'S4 검증 결과'
  };

  var S = {
    tab: 'screen',
    mode: 'move',
    split: false,
    reviewId: DEFAULT_REVIEW,
    pins: [],
    editing: null,     // {pin, isNew}
    zoom: 1,
    tx: 0,
    ty: 0,
    userZoomed: false,
    submitting: false,
    flowChips: false
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var stageEls = { screen: $('#stage-screen'), flow: $('#stage-flow') };
  var pinHosts = { screen: $('#pins-screen'), flow: $('#pins-flow') };
  var scroller = $('#scroller-screen');
  var flowview = $('#flowview');
  var flowwrap = $('#flowwrap');
  var flowSvg = $('#flowSvg');
  var xlinkFlow = $('#xlinkFlow');

  /* ── 저장 ─────────────────────────────── */
  function load() {
    try {
      var rid = localStorage.getItem(LS_REVIEW);
      if (rid) S.reviewId = rid;
      var raw = localStorage.getItem(LS_PINS + S.reviewId);
      S.pins = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(S.pins)) S.pins = [];
    } catch (e) { S.pins = []; }
  }
  function save() {
    try {
      localStorage.setItem(LS_REVIEW, S.reviewId);
      localStorage.setItem(LS_PINS + S.reviewId, JSON.stringify(S.pins));
    } catch (e) { /* 저장 공간이 없어도 화면은 계속 동작 */ }
  }

  /* ── 토스트 ───────────────────────────── */
  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast is-on' + (kind ? ' is-' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
  }

  /* ── 핀 계산 ──────────────────────────── */
  function nextNo() {
    var m = 0;
    S.pins.forEach(function (p) { if (p.no > m) m = p.no; });
    return m + 1;
  }
  function pinsOf(tab) {
    return S.pins.filter(function (p) { return p.tab === tab; });
  }
  function pendingPins() {
    return S.pins.filter(function (p) { return !p.submittedAt || p.updatedAt > p.submittedAt; });
  }

  /* ── 렌더 ─────────────────────────────── */
  /* 이전 판의 핀은 화면 구조가 바뀌면 위치가 어긋난다.
     라벨로 붙잡을 수 있는 핀은 그 요소를 따라가게 다시 붙인다. */
  var LABEL_ALIAS = { 'S1 대상 카드 · 개발 DB': 'S1 대상 카드 · 정산 개발 DB' };

  function anchorEl(label) {
    if (!label) return null;
    var sel = '[data-label="' + label.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  function bindLegacyAnchors() {
    var changed = false;
    S.pins.forEach(function (p) {
      if (p.v === 2) return;
      var label = LABEL_ALIAS[p.label] || p.label;
      var el = anchorEl(label);
      p.v = 2;
      if (!el) return;
      p.label = label;
      p.anchor = label;
      changed = true;
    });
    if (changed) save();
  }

  function placeOnAnchor(p) {
    if (!p.anchor) return false;
    var el = anchorEl(p.anchor);
    if (!el) return false;
    var st = stageEls[p.tab];
    var sr = st.getBoundingClientRect(), er = el.getBoundingClientRect();
    if (!sr.width || !sr.height) return false;      // 판이 아직 안 보임 → 보일 때 다시
    p.x = Math.min(Math.max((er.left + er.width / 2 - sr.left) / sr.width, 0.012), 0.988);
    p.y = Math.min(Math.max((er.top + er.height / 2 - sr.top) / sr.height, 0.008), 0.992);
    return true;
  }

  function renderPins() {
    var moved = false;
    ['screen', 'flow'].forEach(function (tab) {
      var host = pinHosts[tab];
      host.innerHTML = '';
      pinsOf(tab).forEach(function (p) {
        if (placeOnAnchor(p)) moved = true;
        var b = document.createElement('button');
        b.className = 'pin' + (p.comment ? ' is-saved' : '');
        b.style.left = (p.x * 100).toFixed(3) + '%';
        b.style.top = (p.y * 100).toFixed(3) + '%';
        b.dataset.id = p.id;
        b.setAttribute('aria-label', '핀 ' + p.no + ' 의견 수정');
        b.innerHTML = '<span class="p-body"><span class="p-no">' + p.no + '</span></span><span class="p-dot"></span>';
        b.addEventListener('click', function (ev) { ev.stopPropagation(); openEdit(p.id); });
        host.appendChild(b);
      });
    });
    if (moved) save();                 // 붙잡은 위치를 그대로 기억
    renderBadges();
  }

  function renderBadges() {
    var sc = pinsOf('screen').length, fl = pinsOf('flow').length;
    var cs = $('.tab-count[data-count="screen"]'), cf = $('.tab-count[data-count="flow"]');
    cs.textContent = sc; cf.textContent = fl;
    cs.dataset.zero = sc ? '0' : '1'; cf.dataset.zero = fl ? '0' : '1';
    $('#pinTotal').textContent = S.pins.length;
    var pend = pendingPins().length;
    $('#pendingLabel').textContent = pend ? '제출 전 ' + pend + '건' : (S.pins.length ? '모두 제출됨' : '제출 전 0건');
    $('#abCount').textContent = '의견 ' + S.pins.length + '건' + (pend ? ' · 제출 전 ' + pend + '건' : '');
    $('#submitBtn').disabled = pend === 0 || S.submitting;
    $('#submitBtn').textContent = S.submitting ? '보내는 중…' : (pend ? '의견 ' + pend + '건 제출' : '의견 제출');
    $('#reviewIdText').textContent = S.reviewId;
    var total = pinsOf(S.tab).length;
    document.title = (total ? '(' + total + ') ' : '') + 'TestAnchor 핀 리뷰 보드';
  }

  function renderList() {
    var ul = $('#pinList');
    ul.innerHTML = '';
    var sorted = S.pins.slice().sort(function (a, b) { return a.no - b.no; });
    $('#emptyMsg').hidden = sorted.length > 0;
    sorted.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'pin-row' + (p.comment ? ' is-saved' : '');
      li.dataset.id = p.id;
      var where = p.label || (p.tab === 'flow' ? '흐름도 ' + Math.round(p.x * 100) + '%, ' + Math.round(p.y * 100) + '%'
        : '시안 ' + Math.round(p.x * 100) + '%, ' + Math.round(p.y * 100) + '%');
      li.innerHTML =
        '<span class="pr-no">' + p.no + '</span>' +
        '<div class="pr-main">' +
        '<div class="pr-top"><span class="pr-tab">' + (p.tab === 'screen' ? '화면 시안' : '서버 흐름도') + '</span>' +
        '<span class="pr-where">' + esc(where) + '</span></div>' +
        '<div class="pr-text' + (p.comment ? '' : ' empty') + '">' + esc(p.comment || '의견을 입력하세요') + '</div>' +
        '</div>' +
        '<div class="pr-tools">' +
        '<button class="iconbtn" data-act="edit" aria-label="수정">✏️</button>' +
        '<button class="iconbtn" data-act="del" aria-label="삭제">🗑</button>' +
        '</div>';
      li.addEventListener('click', function (ev) {
        var act = ev.target.closest('[data-act]');
        if (act && act.dataset.act === 'edit') { openEdit(p.id); return; }
        if (act && act.dataset.act === 'del') { removePin(p.id); return; }
        jumpTo(p.id);
      });
      ul.appendChild(li);
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── 화면 ↔ 흐름 연결 맵 ──────────────────
     매핑의 원본은 index.html 이다.
       · 화면 카드 : data-screen="S1" data-nodes="n1 n2 n5"
       · 화면 영역 : data-region="n3 n4"      (카드 안 세부 영역)
       · 흐름 노드 : g.node[data-node][data-screens][data-chip]
     여기서는 그 데이터를 읽어 양방향 칩을 만든다.
  ───────────────────────────────────────── */
  function nodeEl(id) { return flowSvg && flowSvg.querySelector('g.node[data-node="' + id + '"]'); }
  function nodeMeta(id) {
    var g = nodeEl(id);
    return { chip: (g && g.dataset.chip) || id, label: (g && g.dataset.label) || id };
  }
  function nodeIds(el) { return (el.dataset.nodes || '').split(/\s+/).filter(Boolean); }
  function screenIds(el) { return (el.dataset.screens || '').split(/\s+/).filter(Boolean); }

  function makeNodeChip(id, compact) {
    var m = nodeMeta(id);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'xlink';
    b.dataset.node = id;
    b.innerHTML = '<span class="xlink-ic">🔗</span>' + (compact ? esc(m.chip) : ' 서버 흐름: <b>' + esc(m.chip) + '</b>');
    b.title = m.chip + ' 서버 단계로 이동';
    b.setAttribute('aria-label', m.chip + ' 서버 단계로 이동');
    b.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      focusFlow(id);
    });
    return b;
  }

  function makeScreenChip(sid) {
    var name = SCREEN_META[sid] || sid;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'xlink';
    b.dataset.screen = sid;
    b.innerHTML = '<span class="xlink-ic">🖥️</span> 화면: <b>' + esc(name) + '</b>';
    b.title = '화면 ' + name + '(으)로 이동';
    b.setAttribute('aria-label', '화면 ' + name + '(으)로 이동');
    b.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      focusScreen(sid);
    });
    return b;
  }

  function buildScreenLinks() {
    $$('.screen[data-screen]').forEach(function (card) {
      if (card.querySelector(':scope > .xlink-bar')) return;
      var ids = nodeIds(card);
      if (!ids.length) return;
      var bar = document.createElement('div');
      bar.className = 'xlink-bar';
      var lab = document.createElement('span');
      lab.className = 'xlink-lab';
      lab.textContent = '서버 흐름';
      bar.appendChild(lab);
      ids.forEach(function (id) {
        if (!nodeEl(id)) { console.warn('[review-board] 없는 흐름 노드:', id); return; }
        bar.appendChild(makeNodeChip(id, false));
      });
      card.appendChild(bar);
    });

    $$('[data-region]').forEach(function (el) {
      if (el.nextElementSibling && el.nextElementSibling.classList.contains('xlink-row')) return;
      var ids = (el.dataset.region || '').split(/\s+/).filter(Boolean);
      if (!ids.length) return;
      var row = document.createElement('div');
      row.className = 'xlink-row inline';
      ids.forEach(function (id) {
        if (!nodeEl(id)) { console.warn('[review-board] 없는 흐름 노드:', id); return; }
        row.appendChild(makeNodeChip(id, true));
      });
      if (row.children.length) el.parentNode.insertBefore(row, el.nextSibling);
    });
  }

  function buildFlowLinks() {
    if (!xlinkFlow || !flowSvg) return false;
    var sr = stageEls.flow.getBoundingClientRect(), vr = flowSvg.getBoundingClientRect();
    if (!vr.width) return false;              // 아직 숨겨져 있음 → 보일 때 만든다
    var z = S.zoom || 1;
    // .stage-flow 는 padding:8px, 절대 위치는 패딩 박스 기준 → SVG 오프셋을 실측해 더한다
    var ox = (vr.left - sr.left) / z, oy = (vr.top - sr.top) / z;
    xlinkFlow.innerHTML = '';
    $$('#flowSvg g.node[data-node]').forEach(function (g) {
      var r = g.querySelector('rect.n-rect');
      if (!r) return;
      var x = +r.getAttribute('x'), y = +r.getAttribute('y');
      var w = +r.getAttribute('width'), hh = +r.getAttribute('height');
      var ids = screenIds(g);
      if (!ids.length) return;
      var compact = w < 250;
      var row = document.createElement('div');
      row.className = 'xlink-row flow-row' + (compact ? ' is-compact' : '');
      row.dataset.forNode = g.dataset.node;
      row.style.left = (ox + x + 10).toFixed(1) + 'px';
      row.style.top = (oy + y + hh - 32).toFixed(1) + 'px';
      row.style.width = (w - 20) + 'px';
      ids.forEach(function (sid) {
        var chip = makeScreenChip(sid);
        if (compact) {
          chip.innerHTML = '<span class="xlink-ic">🖥️</span> ' + esc(sid);
          chip.setAttribute('aria-label', '화면 ' + (SCREEN_META[sid] || sid) + '(으)로 이동');
          chip.title = '화면 ' + (SCREEN_META[sid] || sid) + '(으)로 이동';
        }
        row.appendChild(chip);
      });
      xlinkFlow.appendChild(row);
    });
    S.flowChips = true;
    return true;
  }

  function ensureFlowLinks() { if (!S.flowChips) buildFlowLinks(); }

  function flowRowOf(id) { return xlinkFlow && xlinkFlow.querySelector('.flow-row[data-for-node="' + id + '"]'); }

  /* ── 강조 / 이동 ──────────────────────── */
  function flash(el, ms) {
    if (!el) return;
    el.classList.remove('is-hit');
    void (el.offsetWidth || el.getBoundingClientRect().width);   // 애니메이션 재시작
    el.classList.add('is-hit');
    clearTimeout(el.__hitTimer);
    el.__hitTimer = setTimeout(function () { el.classList.remove('is-hit'); }, ms || 2200);
  }

  function centerFlowNode(id) {
    var g = nodeEl(id);
    if (!g) return false;
    var r = g.querySelector('rect.n-rect');
    if (!r) return false;
    var z = S.zoom || 1;
    var sr = stageEls.flow.getBoundingClientRect(), rr = r.getBoundingClientRect();
    if (!flowview.clientWidth) return false;
    var cx = (rr.left + rr.width / 2 - sr.left) / z;
    var cy = (rr.top + rr.height / 2 - sr.top) / z;
    S.tx = flowview.clientWidth / 2 - cx * z;
    S.ty = flowview.clientHeight / 2 - cy * z;
    S.userZoomed = true;
    applyFlow();
    return true;
  }

  function focusFlow(id) {
    if (!S.split && S.tab !== 'flow') setTab('flow');
    ensureFlowLinks();
    var run = function () {
      centerFlowNode(id);
      flash(nodeEl(id));
      flash(flowRowOf(id), 2200);
    };
    requestAnimationFrame(run);
  }

  function scrollScreenTo(card, smooth) {
    if (!card) return;
    var sr = scroller.getBoundingClientRect(), cr = card.getBoundingClientRect();
    var target = scroller.scrollTop + (cr.top - sr.top) - Math.max((scroller.clientHeight - card.offsetHeight) / 2, 12);
    scroller.scrollTo({ top: Math.max(target, 0), behavior: smooth === false ? 'auto' : 'smooth' });
  }

  function focusScreen(sid) {
    if (!S.split && S.tab !== 'screen') setTab('screen');
    var card = $('.screen[data-screen="' + sid + '"]');
    requestAnimationFrame(function () {
      scrollScreenTo(card, true);
      flash(card, 2600);
    });
  }

  /* 나란히 보기 : 반대쪽도 함께 반응 */
  function allNodeIds(card) {
    var ids = nodeIds(card).slice();
    $$('[data-region]', card).forEach(function (el) {
      (el.dataset.region || '').split(/\s+/).filter(Boolean).forEach(function (id) {
        if (ids.indexOf(id) === -1) ids.push(id);
      });
    });
    return ids;
  }

  function syncFromCard(card) {
    var ids = allNodeIds(card);
    if (!ids.length) return;
    ensureFlowLinks();
    ids.forEach(function (id) { flash(nodeEl(id), 1500); flash(flowRowOf(id), 1500); });
    centerFlowNode(ids[0]);
  }
  function syncFromNode(g) {
    var ids = screenIds(g);
    if (!ids.length) return;
    ids.forEach(function (sid) { flash($('.screen[data-screen="' + sid + '"]'), 1500); });
    scrollScreenTo($('.screen[data-screen="' + ids[0] + '"]'), true);
  }

  /* ── 탭 / 모드 / 나란히 보기 ────────────── */
  function syncChrome() {
    $('#zoomBox').hidden = !(S.split || S.tab === 'flow');
    $('#splitBtn').hidden = !canSplit();
  }

  function setTab(tab) {
    S.tab = tab;
    $$('.tab').forEach(function (b) {
      var on = b.dataset.tab === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#pane-screen').classList.toggle('is-on', tab === 'screen');
    $('#pane-flow').classList.toggle('is-on', tab === 'flow');
    syncChrome();
    updateHint();
    if (tab === 'flow' || S.split) {
      ensureFlowLinks();
      if (!S.userZoomed) fitFlow();
    }
    if (S.pins.some(function (p) { return p.anchor; })) requestAnimationFrame(renderPins);
  }

  function setMode(mode) {
    S.mode = mode;
    $$('.seg-btn').forEach(function (b) {
      var on = b.dataset.mode === mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    updateHint();
  }

  function canSplit() { return window.innerWidth >= SPLIT_MIN || window.matchMedia('(min-width:' + SPLIT_MIN + 'px)').matches; }

  function setSplit(on) {
    if (on && !canSplit()) on = false;
    S.split = on;
    document.body.classList.toggle('is-split', on);
    var btn = $('#splitBtn');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? '⇹ 나란히 보기 끄기' : '⇹ 나란히 보기';
    syncChrome();
    updateHint();
    if (on) {
      ensureFlowLinks();
      S.userZoomed = false;
      requestAnimationFrame(function () { buildFlowLinks(); fitFlow(); });
    } else {
      requestAnimationFrame(function () {
        if (S.tab === 'flow') { ensureFlowLinks(); if (!S.userZoomed) fitFlow(); }
      });
    }
  }

  function updateHint() {
    var h = $('#hint');
    if (S.mode === 'pin') {
      if (S.split) h.innerHTML = '핀 모드입니다. 어느 쪽이든 <b>짧게 탭</b>하면 그 자리에 핀이 꽂힙니다. 연결 칩을 누르면 핀 대신 이동합니다.';
      else if (S.tab === 'flow') h.innerHTML = '핀 모드입니다. <b>짧게 탭</b>하면 그 자리에 핀이 꽂히고, 끌면 화면이 움직입니다.';
      else h.innerHTML = '핀 모드입니다. 의견을 남길 자리를 <b>짧게 탭</b>하세요. 연결 칩(🔗)을 누르면 핀 대신 서버 흐름으로 이동합니다.';
      return;
    }
    if (S.split) h.innerHTML = '나란히 보기입니다. <b>🔗 서버 흐름</b> 칩을 누르면 오른쪽 해당 단계가, <b>🖥️ 화면</b> 칩을 누르면 왼쪽 해당 화면이 강조됩니다.';
    else if (S.tab === 'flow') h.innerHTML = '이동 모드입니다. 끌거나 휠로 옮기고, 두 손가락·Ctrl+휠로 확대·축소하세요. <b>🖥️ 화면</b> 칩을 누르면 그 화면으로 이동합니다.';
    else h.innerHTML = '이동 모드입니다. <b>🔗 서버 흐름</b> 칩을 누르면 서버 흐름도 해당 단계로 이동합니다. 핀은 <b>📌 핀 찍기</b>에서.';
  }

  /* ── 시트(핀 입력) ────────────────────── */
  function openSheet(o) {
    S.editing = o;
    var p = o.pin;
    $('#sheetNo').textContent = p.no;
    $('#sheetTitle').textContent = o.isNew ? '여기에 의견 남기기' : '의견 고치기';
    var where = p.label || (p.tab === 'flow' ? '흐름도 ' + Math.round(p.x * 100) + '%, ' + Math.round(p.y * 100) + '%'
      : '시안 ' + Math.round(p.x * 100) + '%, ' + Math.round(p.y * 100) + '%');
    $('#sheetWhere').textContent = (p.tab === 'screen' ? '화면 시안' : '서버 흐름도') + ' · ' + where;
    $('#commentInput').value = p.comment || '';
    $('#deleteBtn').hidden = !!o.isNew;
    $('#modal').hidden = false;
    setTimeout(function () { $('#commentInput').focus({ preventScroll: true }); }, 60);
  }
  function closeSheet() {
    S.editing = null;
    $('#modal').hidden = true;
  }

  function saveSheet() {
    if (!S.editing) return;
    var text = $('#commentInput').value.trim();
    if (!text) { toast('의견을 한 줄 적어 주세요', 'err'); $('#commentInput').focus(); return; }
    var p = S.editing.pin;
    var isNew = S.editing.isNew;
    if (isNew) {
      p.comment = text; p.updatedAt = Date.now(); p.createdAt = Date.now();
      S.pins.push(p);
    } else {
      p.comment = text; p.updatedAt = Date.now();
    }
    save(); closeSheet(); renderPins(); renderList(); renderBadges();
    toast(isNew ? '핀 ' + p.no + '에 의견을 남겼습니다' : '핀 ' + p.no + ' 의견을 고쳤습니다', 'ok');
  }

  function openEdit(id) {
    var p = S.pins.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    highlight(id);
    openSheet({ pin: p, isNew: false });
  }

  function removePin(id) {
    var i = S.pins.findIndex(function (x) { return x.id === id; });
    if (i < 0) return;
    var no = S.pins[i].no;
    S.pins.splice(i, 1);
    save(); closeSheet(); renderPins(); renderList(); renderBadges();
    toast('핀 ' + no + '을(를) 삭제했습니다');
  }

  function placePin(tab, clientX, clientY, label) {
    var st = stageEls[tab];
    var r = st.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var x = (clientX - r.left) / r.width;
    var y = (clientY - r.top) / r.height;
    x = Math.min(Math.max(x, 0.012), 0.988);
    y = Math.min(Math.max(y, 0.008), 0.992);
    var p = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      no: nextNo(), tab: tab, x: x, y: y, label: label || null, v: 2,
      comment: '', createdAt: Date.now(), updatedAt: 0, submittedAt: 0
    };
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    openSheet({ pin: p, isNew: true });
  }

  /* ── 이동 / 확대 ──────────────────────── */
  function applyFlow() {
    flowwrap.style.transform = 'translate(' + S.tx.toFixed(2) + 'px,' + S.ty.toFixed(2) + 'px) scale(' + S.zoom.toFixed(3) + ')';
    stageEls.flow.style.setProperty('--pinScale', (1 / S.zoom).toFixed(3));
    $('#zoomVal').textContent = Math.round(S.zoom * 100) + '%';
  }

  function fitFlow() {
    var vw = flowview.clientWidth, vh = flowview.clientHeight;
    if (!vw) return;
    var sw = stageEls.flow.offsetWidth || 436;
    var sh = stageEls.flow.offsetHeight || 1372;
    var z = Math.min((vw - 10) / sw, 1.3);
    z = Math.max(z, Math.min((vh - 10) / sh, 1));
    S.zoom = z;
    S.tx = (vw - sw * z) / 2;
    S.ty = 6;
    applyFlow();
  }

  function zoomAt(factor, cx, cy) {
    var vw = flowview.clientWidth, vh = flowview.clientHeight;
    var px = (cx == null ? vw / 2 : cx), py = (cy == null ? vh / 2 : cy);
    var z0 = S.zoom;
    var z1 = Math.min(Math.max(z0 * factor, 0.35), 3.2);
    if (z1 === z0) return;
    S.tx = px - (px - S.tx) * (z1 / z0);
    S.ty = py - (py - S.ty) * (z1 / z0);
    S.zoom = z1;
    S.userZoomed = true;
    applyFlow();
  }

  /* 흐름도 포인터(드래그·핀치·탭) */
  function bindFlow() {
    var pts = new Map();
    var drag = null, pinch = null, tapStart = null, moved = false, tapTarget = null;

    function local(e) {
      var r = flowview.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

    flowview.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest && e.target.closest('.xlink')) return;   // 연결 칩은 칩이 처리
      try { flowview.setPointerCapture(e.pointerId); } catch (err) {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        drag = { x: e.clientX, y: e.clientY, tx: S.tx, ty: S.ty };
        tapStart = { x: e.clientX, y: e.clientY, t: Date.now() };
        tapTarget = e.target;
        moved = false;
      } else if (pts.size === 2) {
        var v = Array.from(pts.values());
        pinch = { d: dist(v[0], v[1]), z: S.zoom, l: mid(v[0], v[1]) };
        drag = null;
      }
    });

    flowview.addEventListener('pointermove', function (e) {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pts.size >= 2 && pinch) {
        var v = Array.from(pts.values()).slice(0, 2);
        var d = dist(v[0], v[1]);
        if (pinch.d > 4) {
          var z1 = Math.min(Math.max(pinch.z * (d / pinch.d), 0.35), 3.2);
          var l0 = local({ clientX: pinch.l.x, clientY: pinch.l.y });
          S.tx = l0.x - (l0.x - S.tx) * (z1 / S.zoom);
          S.ty = l0.y - (l0.y - S.ty) * (z1 / S.zoom);
          S.zoom = z1;
          S.userZoomed = true;
          applyFlow();
        }
        moved = true;
        return;
      }

      if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
        S.tx = drag.tx + dx;
        S.ty = drag.ty + dy;
        applyFlow();
      }
    });

    function end(e) {
      var had = pts.has(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) drag = null;
      if (!had) return;
      if (tapStart && pts.size === 0) {
        var dx = Math.abs(e.clientX - tapStart.x), dy = Math.abs(e.clientY - tapStart.y);
        var dt = Date.now() - tapStart.t;
        var wasTap = !moved && dx < 10 && dy < 10 && dt < 700;
        var target = tapTarget;
        tapStart = null;
        if (!wasTap) return;
        if (S.mode === 'pin') {
          var lbl = target && target.closest ? target.closest('[data-label]') : null;
          placePin('flow', e.clientX, e.clientY, lbl ? lbl.dataset.label : null);
        } else if (S.split) {
          var g = target && target.closest ? target.closest('g.node[data-node]') : null;
          if (g) syncFromNode(g);
        }
      }
    }
    flowview.addEventListener('pointerup', end);
    flowview.addEventListener('pointercancel', function (e) { pts.delete(e.pointerId); pinch = null; drag = null; tapStart = null; });

    flowview.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        var l = local(e);
        zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, l.x, l.y);
        return;
      }
      S.tx -= e.deltaX;   // 휠 = 화면 이동, Ctrl/⌘ + 휠 = 확대
      S.ty -= e.deltaY;
      applyFlow();
    }, { passive: false });
  }

  /* 화면 탭 스테이지 탭 감지(스크롤 방해 없이) */
  function bindScreenStage() {
    var start = null;
    stageEls.screen.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.pin') || e.target.closest('.xlink')) return;
      start = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
    }, { passive: true });
    stageEls.screen.addEventListener('pointerup', function (e) {
      if (!start || start.id !== e.pointerId) return;
      var dx = Math.abs(e.clientX - start.x), dy = Math.abs(e.clientY - start.y);
      var dt = Date.now() - start.t;
      start = null;
      if (dx > 10 || dy > 10 || dt > 800) return;
      if (e.target.closest && e.target.closest('.xlink')) return;
      if (S.mode === 'pin') {
        var lbl = e.target.closest ? e.target.closest('[data-label]') : null;
        placePin('screen', e.clientX, e.clientY, lbl ? lbl.dataset.label : null);
        return;
      }
      if (S.split) {
        var card = e.target.closest ? e.target.closest('.screen[data-screen]') : null;
        if (card) syncFromCard(card);
      }
    });
    stageEls.screen.addEventListener('pointercancel', function () { start = null; });
  }

  /* ── 핀으로 이동 · 강조 ───────────────── */
  function highlight(id) {
    var el = pinHosts[S.tab].querySelector('[data-id="' + id + '"]');
    $$('.pin').forEach(function (n) { n.classList.remove('is-sel'); });
    $$('.pin-row').forEach(function (n) { n.classList.remove('is-sel'); });
    if (el) {
      el.classList.add('is-sel');
      setTimeout(function () { el.classList.remove('is-sel'); }, 1600);
    }
    var row = $('#pinList').querySelector('[data-id="' + id + '"]');
    if (row) row.classList.add('is-sel');
  }

  function jumpTo(id) {
    var p = S.pins.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    if (!S.split && S.tab !== p.tab) setTab(p.tab);
    highlight(id);
    if (p.tab === 'screen') {
      var el = pinHosts.screen.querySelector('[data-id="' + id + '"]');
      if (el) {
        var r = el.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
        var target = scroller.scrollTop + (r.top - sr.top) - scroller.clientHeight / 2 + 20;
        scroller.scrollTo({ top: Math.max(target, 0), behavior: 'smooth' });
      }
    } else {
      var sw = stageEls.flow.offsetWidth, sh = stageEls.flow.offsetHeight;
      S.tx = flowview.clientWidth / 2 - p.x * sw * S.zoom;
      S.ty = flowview.clientHeight / 2 - p.y * sh * S.zoom;
      S.userZoomed = true;
      applyFlow();
    }
  }

  /* ── 제출 ─────────────────────────────── */
  function payloadFor(pins) {
    return {
      app: APP_ID,
      v: 2,
      review_id: S.reviewId,
      submitted_at: new Date().toISOString(),
      tz: 'Asia/Seoul',
      count: pins.length,
      total: S.pins.length,
      page: location.href.split('?')[0],
      pins: pins.map(function (p) {
        return {
          no: p.no,
          tab: p.tab,
          target: p.label || null,
          x: +p.x.toFixed(3),
          y: +p.y.toFixed(3),
          comment: p.comment
        };
      })
    };
  }

  function submit() {
    if (S.submitting) return;
    var pend = pendingPins();
    if (!pend.length) { toast('제출할 새 의견이 없습니다'); return; }
    S.submitting = true; renderBadges();
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 14000);

    fetch(ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(payloadFor(pend)),
      signal: ctrl.signal
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok || !j.id) throw new Error((j && j.error) || ('HTTP ' + res.status));
        return j;
      });
    }).then(function (j) {
      var now = Date.now();
      pend.forEach(function (p) { p.submittedAt = now; });
      save(); renderPins(); renderList(); renderBadges();
      var hh = new Date().toTimeString().slice(0, 5);
      toast('피클에 전달했습니다 (' + hh + ') · 의견 ' + pend.length + '건', 'ok');
    }).catch(function (err) {
      toast('전송 실패: ' + (err && err.name === 'AbortError' ? '응답이 없습니다' : err.message) + ' · 다시 시도해 주세요', 'err');
    }).then(function () {
      clearTimeout(timer); S.submitting = false; renderBadges();
    });
  }

  /* ── 제출 기록 확인 ───────────────────── */
  function checkRecords() {
    toast('제출 기록을 확인하는 중…');
    fetch(ENDPOINT + '/json?poll=1&since=12h')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (txt) {
        var lines = txt.split('\n').filter(function (l) { return l.trim(); });
        var mine = [];
        lines.forEach(function (l) {
          try {
            var m = JSON.parse(l);
            if (m.event !== 'message' || !m.message) return;
            var pl = JSON.parse(m.message);
            if (pl && pl.app === APP_ID) mine.push(pl);
          } catch (e) {}
        });
        var forReview = mine.filter(function (pl) { return pl.review_id === S.reviewId; });
        if (!forReview.length) { toast('이 리뷰(' + S.reviewId + ')로 도착한 기록이 아직 없습니다'); return; }
        var last = forReview[0];
        var when = new Date(last.submitted_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        toast('서버 기록 ' + forReview.length + '건 · 마지막 ' + when + ' (' + last.count + '개 핀)', 'ok');
      })
      .catch(function (e) { toast('확인 실패: ' + e.message, 'err'); });
  }

  /* ── 리뷰 ID ───────────────────────────── */
  function openRidEditor() {
    $('#ridInput').value = S.reviewId;
    $('#ridEditor').hidden = false;
    $('#ridInput').focus();
    $('#ridInput').select();
  }
  function closeRidEditor() { $('#ridEditor').hidden = true; }

  function applyReview() {
    var v = $('#ridInput').value.trim();
    if (!v) { closeRidEditor(); return; }
    if (!/^[A-Za-z0-9._-]{3,48}$/.test(v)) { toast('영문·숫자·-_. 3~48자로 적어 주세요', 'err'); return; }
    S.reviewId = v;
    var raw = null;
    try { raw = localStorage.getItem(LS_PINS + v); } catch (e) {}
    try { S.pins = raw ? JSON.parse(raw) : []; } catch (e) { S.pins = []; }
    if (!Array.isArray(S.pins)) S.pins = [];
    save(); renderPins(); renderList(); renderBadges(); closeRidEditor();
    toast('리뷰를 "' + v + '"(으)로 바꿨습니다');
  }

  /* ── 이벤트 연결 ──────────────────────── */
  function bind() {
    $$('.tab').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); });
    });
    $$('.seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode); });
    });
    $('#splitBtn').addEventListener('click', function () { setSplit(!S.split); });
    $('#zoomIn').addEventListener('click', function () { zoomAt(1.25); });
    $('#zoomOut').addEventListener('click', function () { zoomAt(1 / 1.25); });
    $('#zoomVal').addEventListener('click', function () { S.userZoomed = false; fitFlow(); });
    $('#zoomFit').addEventListener('click', function () { S.userZoomed = false; fitFlow(); });

    $('#sheetClose').addEventListener('click', closeSheet);
    $('#cancelBtn').addEventListener('click', closeSheet);
    $('#modalScrim').addEventListener('click', closeSheet);
    $('#saveBtn').addEventListener('click', saveSheet);
    $('#deleteBtn').addEventListener('click', function () { if (S.editing && !S.editing.isNew) removePin(S.editing.pin.id); });
    $('#commentInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveSheet(); }
    });
    $$('#quickChips button').forEach(function (b) {
      b.addEventListener('click', function () {
        var ta = $('#commentInput');
        var add = b.dataset.t;
        if (ta.value.trim()) {
          if (ta.value.indexOf(add) === -1) ta.value = ta.value.trim() + ' ' + add;
        } else { ta.value = add; }
        ta.focus();
      });
    });

    $('#panelHead').addEventListener('click', function () {
      var p = $('#panel');
      var open = !p.classList.contains('is-open');
      p.classList.toggle('is-open', open);
      $('#panelHead').setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    $('#submitBtn').addEventListener('click', submit);
    $('#checkBtn').addEventListener('click', checkRecords);
    $('#reviewChip').addEventListener('click', openRidEditor);
    $('#ridSave').addEventListener('click', applyReview);
    $('#ridCancel').addEventListener('click', closeRidEditor);
    $('#ridInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); applyReview(); }
      if (e.key === 'Escape') { e.preventDefault(); closeRidEditor(); }
    });

    var rz = null;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () {
        $('#splitBtn').hidden = !canSplit();
        if (S.split && !canSplit()) setSplit(false);
        syncChrome();
        if ((S.tab === 'flow' || S.split) && !S.userZoomed) fitFlow();
      }, 120);
    });
  }

  /* ── 시작 ─────────────────────────────── */
  load();
  bind();
  bindFlow();
  bindScreenStage();
  buildScreenLinks();
  bindLegacyAnchors();
  setTab('screen');
  setMode('move');
  if (location.hash === '#flow') setTab('flow');
  else if (location.hash === '#screen') setTab('screen');
  renderPins();
  renderList();
  renderBadges();
  applyFlow();
  setTimeout(function () {
    if (S.tab === 'flow') { ensureFlowLinks(); if (!S.userZoomed) fitFlow(); }
  }, 60);

  /* 연결 맵 점검 — 양방향이 서로를 가리키는지 확인한다 */
  function linkAudit() {
    var issues = [], pairs = [];
    var nodes = {};
    $$('#flowSvg g.node[data-node]').forEach(function (g) { nodes[g.dataset.node] = g; });
    var screenNodes = {};
    $$('.screen[data-screen]').forEach(function (card) {
      var sid = card.dataset.screen;
      screenNodes[sid] = {};
      nodeIds(card).forEach(function (id) {
        if (!nodes[id]) issues.push('화면 ' + sid + ' → 없는 노드 ' + id);
        screenNodes[sid][id] = '카드';
      });
      $$('[data-region]', card).forEach(function (el) {
        (el.dataset.region || '').split(/\s+/).filter(Boolean).forEach(function (id) {
          if (!nodes[id]) issues.push('화면 ' + sid + ' 영역 → 없는 노드 ' + id);
          screenNodes[sid][id] = el.dataset.label || '영역';
        });
      });
    });
    Object.keys(nodes).forEach(function (id) {
      screenIds(nodes[id]).forEach(function (sid) {
        if (!screenNodes[sid] || !screenNodes[sid][id]) issues.push('노드 ' + id + ' → 화면 ' + sid + ' 가 화면 쪽 매핑에 없음');
        else pairs.push(id + ' ↔ ' + sid);
      });
      if (!screenIds(nodes[id]).length) issues.push('노드 ' + id + ' 에 연결된 화면이 없음');
    });
    return { ok: issues.length === 0, issues: issues, pairCount: pairs.length, pairs: pairs, chips: {
      screen: $$('.xlink-bar .xlink, .xlink-row.inline .xlink').length,
      flow: $$('#xlinkFlow .xlink').length } };
  }

  // 테스트·검수용 최소 노출
  window.__taBoard = {
    pins: function () { return S.pins.slice(); },
    setMode: setMode,
    setTab: setTab,
    setSplit: setSplit,
    focusFlow: focusFlow,
    focusScreen: focusScreen,
    audit: linkAudit,
    state: S
  };
})();
