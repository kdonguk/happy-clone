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
  var DEFAULT_REVIEW = 'testanchor-real-v1';
  /* 구조를 전면 교체한 이전 판 — 이 ID로 저장된 화면이 새 판을 덮지 않게 한다 */
  var LEGACY_REVIEWS = ['testanchor-sample-v1'];
  var SPLIT_MIN = 1024;

  /* 화면 이름 — 흐름도 노드의 칩 문구에 쓴다 */
  var SCREEN_META = {
    S1: 'S1 요구사항 · 분석',
    S2: 'S2 14단계 · 승인',
    S3: 'S3 연결 · 안전장치',
    S4: 'S4 테스트 실행',
    S5: 'S5 완료 다이어그램'
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
      // 이전 판(샘플 구조)으로 저장된 리뷰는 새 판으로 넘긴다 — 저장된 핀은 그 키에 그대로 남는다.
      if (rid && LEGACY_REVIEWS.indexOf(rid) !== -1) {
        rid = null;
        try { localStorage.removeItem(LS_REVIEW); } catch (e) {}
      }
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
  var LABEL_ALIAS = {};

  function anchorEl(label) {
    if (!label) return null;
    var els = document.querySelectorAll('[data-label]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].dataset.label === label) return els[i];
    }
    return null;
  }

  function bindLegacyAnchors() {
    var changed = false;
    S.pins.forEach(function (p) {
      if (p.v === 2) return;
      var label = LABEL_ALIAS[p.label] || p.label;
      if (!label) { p.v = 2; return; }        // 라벨이 없으면 좌표 그대로
      var el = anchorEl(label);
      if (!el) return;                        // 판이 아직 안 보일 수 있음 → 다음에 다시
      p.label = label;
      p.anchor = label;
      p.v = 2;
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
  /* 강조 표시는 다음 선택이 일어날 때까지 남긴다(탭을 오가며 봐도 방금 고른 곳이 보이도록). */
  function clearMarks() {
    $$('.is-hit').forEach(function (el) { el.classList.remove('is-hit'); });
  }
  function mark(el) {
    if (!el) return;
    el.classList.remove('is-hit');
    void (el.offsetWidth || el.getBoundingClientRect().width);   // 애니메이션 재시작
    el.classList.add('is-hit');
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
      clearMarks();
      mark(nodeEl(id));
      mark(flowRowOf(id));
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
      clearMarks();
      mark(card);
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
    clearMarks();
    ids.forEach(function (id) { mark(nodeEl(id)); mark(flowRowOf(id)); });
    centerFlowNode(ids[0]);
  }
  function syncFromNode(g) {
    var ids = screenIds(g);
    if (!ids.length) return;
    clearMarks();
    ids.forEach(function (sid) { mark($('.screen[data-screen="' + sid + '"]')); });
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
    if (mode !== 'info') closeInfo();
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
    btn.title = on ? '나란히 보기 끄기 (탭 하나씩 보기)' : '화면 시안과 서버 흐름도를 나란히 보기';
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
    if (S.mode === 'info') {
      if (S.split) h.innerHTML = '<b>📖 설명 모드</b>입니다. 왼쪽 화면 카드나 오른쪽 서버 단계를 <b>톡 누르면</b> 이곳의 역할과 서버 동작을 설명해 드립니다. 핀은 <b>📌 핀 찍기</b>에서.';
      else if (S.tab === 'flow') h.innerHTML = '<b>📖 설명 모드</b>입니다. 서버 단계를 <b>톡 누르면</b> 무슨 일을 하는 곳인지 설명해 드립니다.';
      else h.innerHTML = '<b>📖 설명 모드</b>입니다. 궁금한 카드나 항목을 <b>톡 누르면</b> 이곳의 역할과 서버 동작을 설명해 드립니다. 핀 찍기는 <b>📌 핀 찍기</b>.';
      return;
    }
    if (S.mode === 'pin') {
      if (S.split) h.innerHTML = '핀 모드입니다. 어느 쪽이든 <b>짧게 탭</b>하면 그 자리에 핀이 꽂힙니다. 연결 칩을 누르면 핀 대신 이동합니다.';
      else if (S.tab === 'flow') h.innerHTML = '핀 모드입니다. <b>짧게 탭</b>하면 그 자리에 핀이 꽂히고, 끌면 화면이 움직입니다.';
      else h.innerHTML = '핀 모드입니다. 의견을 남길 자리를 <b>짧게 탭</b>하세요. 연결 칩(🔗)을 누르면 핀 대신 서버 흐름으로 이동합니다.';
      return;
    }
    if (S.split) h.innerHTML = '나란히 보기입니다. <b>🔗 서버 흐름</b> 칩을 누르면 오른쪽 해당 단계가, <b>🖥️ 화면</b> 칩을 누르면 왼쪽 해당 화면이 강조됩니다.';
    else if (S.tab === 'flow') h.innerHTML = '이동 모드입니다. 끌어서 옮기고, 두 손가락(PC는 Ctrl+휠)으로 확대·축소하세요. <b>🖥️ 화면</b> 칩을 누르면 그 화면으로 이동합니다.';
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
        if (S.mode === 'info') { openInfoFrom(target); return; }
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
      if (S.mode === 'info') { openInfoFrom(e.target); return; }
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

  /* ── 📖 설명 데이터 ──────────────────────
     data-label 하나에 한 항목. 화면 카드·세부 영역·서버 단계를 같은 방식으로 설명한다.
       t      = 시트 제목
       role   = 이곳의 역할 (1~2줄)
       user   = 사용자가 여기서 하는 일
       server = 서버에서 일어나는 일
       result = 나오는 결과
       next   = 다음으로 할 수 있는 것
     모든 문구는 범용 표현만 쓴다(특정 회사·업무 도메인 없음).
  ───────────────────────────────────────── */
  var INFO = {
    /* ── S1 ─────────────────────────── */
    'S1 요구사항 · 분석 방향 확인': {
      t: 'S1 · 요구사항과 분석 방향',
      role: '새로 검증할 내용을 처음 적고, AI가 찾아온 분석 결과를 보고 "이 방향으로 가자"를 정하는 첫 화면입니다.',
      user: '제목과 본문에 무엇을 확인하고 싶은지 적고 [분석 시작]을 누릅니다. 결과를 읽고 맞으면 [방향 확정]을 누릅니다.',
      server: '본문에서 화면·API·서비스 메소드·도메인 같은 기준점을 뽑아 실제로 있는지 대조하고, 확인할 조건 초안을 만듭니다.',
      result: '기준점 목록, 제안 변경, 차단 결함 0건 여부가 카드로 돌아옵니다.',
      next: '아래 제목·본문·기준점·제안 변경 카드를 눌러 자세히 볼 수 있습니다. 확정하면 2단계(14단계 라이프사이클)로 넘어갑니다.'
    },
    'S1 요구사항 제목': {
      t: '요구사항 제목',
      role: '이번에 검증할 일을 한 줄로 부르는 이름입니다.',
      user: '확인하고 싶은 기능과 조건을 짧게 적습니다 (예: 대상 기능 조합 검증 — 조건 A · 조건 B).',
      server: '제목은 목록에서 이 작업을 구분하는 이름으로 저장하고, 기준점 찾기는 본문 문장으로 합니다.',
      result: '작업 목록과 이력에 이 이름이 남습니다.',
      next: '본문을 적고 [분석 시작]으로 넘어가면 됩니다.'
    },
    'S1 요구사항 본문': {
      t: '요구사항 본문',
      role: '무엇을 어떤 조건으로 확인할지 풀어 쓰는 칸입니다.',
      user: '어떤 화면과 API를 기준으로, 어떤 조건에서 어떤 결과가 나와야 하는지를 평소 말로 적습니다.',
      server: '문장을 읽어 화면·API·메소드·도메인 후보를 뽑고, 코드 인덱스와 DB 스키마에 있는지 대조합니다(실재성 검사).',
      result: '"화면 1 · API 1 · 메소드 1 · 도메인 1 — 앵커 실재성 검사 통과"처럼 몇 개를 찾았는지 나옵니다.',
      next: '기준점 카드가 의도한 곳인지 확인하고 [방향 확정]으로 갑니다.'
    },
    'S1 기준점 검색': {
      t: '기준점 검색 (선택)',
      role: 'AI가 찾을 위치를 미리 콕 집어 주는 선택 칸입니다.',
      user: '비워 두면 본문에서 알아서 찾습니다. 정확한 화면이나 API를 알고 있으면 적어 줍니다.',
      server: '적어 준 기준점을 우선으로 삼아 그 위치부터 확인합니다.',
      result: '엉뚱한 곳을 기준점으로 잡는 일이 줄어듭니다.',
      next: '비워 두어도 됩니다. 바로 [분석 시작]을 눌러도 좋습니다.'
    },
    'S1 분석 기준점': {
      t: '분석 기준점',
      role: 'AI가 본문에서 찾아낸 "확인 기준"입니다.',
      user: '가리키는 화면·API·메소드·도메인이 의도한 곳이 맞는지 눈으로 확인합니다.',
      server: '후보를 코드와 DB에 대조해 실제로 있는 것만 남깁니다.',
      result: '찾은 개수와 실재성 검사 통과 여부가 보입니다.',
      next: '틀린 곳이 있으면 본문을 고쳐 다시 분석하고, 맞으면 [방향 확정]으로 갑니다.'
    },
    'S1 제안 변경': {
      t: '제안 변경',
      role: '이 요구사항을 어떤 조건으로 확인할지 AI가 만든 초안입니다.',
      user: '조건과 기대값(예: 결과 금액이 0원)이 말이 되는지 확인합니다.',
      server: '기준점과 문장을 바탕으로 "무엇을 조회하고 무엇과 비교할지"를 조건 카드로 만듭니다.',
      result: '조건 A · 기대값 결과 금액 = 0 · 판정 가능처럼 판정할 수 있는 형태로 나옵니다.',
      next: '마음에 들면 [방향 확정], 고칠 점이 있으면 [수정 요청]을 누릅니다.'
    },
    'S1 방향 확정': {
      t: '방향 확정',
      role: '사람이 "이 방향으로 진행해도 된다"고 처음 승인하는 자리입니다.',
      user: '분석 결과를 다 읽고 [방향 확정]을 누릅니다.',
      server: '확정을 기록하고 개발 트랙(제안 코드·3축 해설)과 테스트 트랙(케이스 생성·실행)을 엽니다.',
      result: '2단계 라이프사이클로 넘어갈 준비가 됩니다.',
      next: '사람이 정하는 세 번의 승인 중 첫 번째입니다. 다음 승인은 S2의 3·5·10단계입니다.'
    },

    /* ── S2 ─────────────────────────── */
    'S2 14단계 라이프사이클 · 사람 승인': {
      t: 'S2 · 14단계 라이프사이클',
      role: '요구사항부터 완료 다이어그램까지 14단계를 5개 관문으로 묶어, 지금 어디쯤인지 보여 주는 화면입니다.',
      user: '진행률과 게이트 상태를 보고, 사람이 결정해야 하는 지점에서 [승인하고 진행]을 누릅니다.',
      server: '단계를 차례로 실행하고 게이트 잠금·통과 여부를 계산해 진행률과 메트릭을 기록합니다.',
      result: '11/14 · 진행 중 79% · 사람 확정 3곳처럼 서버가 계산한 상태가 보입니다.',
      next: '아래 레일·실시간 진행·결함 사유·메트릭을 눌러 자세히 볼 수 있습니다.'
    },
    'S2 라이프사이클 레일': {
      t: '라이프사이클 레일 (G1~G5)',
      role: '5개 게이트와 14단계를 한눈에 보는 진행 지도입니다.',
      user: '초록(통과)·파랑(진행 중)·회색(대기)을 보고 어디까지 왔는지 확인합니다.',
      server: '단계가 끝날 때마다 게이트 통과 여부를 다시 계산합니다.',
      result: 'G1~G5 게이트 상태와 1~14단계의 완료·진행·대기 표시가 갱신됩니다.',
      next: '사람 표시(人)가 붙은 3·5·10단계에서 승인이 필요합니다.'
    },
    'S2 실시간 진행': {
      t: '실시간 진행',
      role: '지금 서버가 무엇을 하고 있는지 실시간으로 보여 주는 줄입니다.',
      user: '기다리면 됩니다. 오래 걸리면 [다음 게이트까지]로 어디까지 자동인지 확인합니다.',
      server: '1초마다 상태를 갱신하고, 실행 중인 작업·남은 양·LLM 호출 횟수를 함께 보냅니다.',
      result: '"승인된 케이스 12건을 SQL 러너로 실행하는 중 — 7/12"처럼 진행 상황이 나옵니다.',
      next: '끝나면 결과 카드와 판정이 이어집니다.'
    },
    'S2 결함 · 거절 사유': {
      t: '결함 · 거절 사유',
      role: 'AI가 만들 수 없다고 거절한 이유와, 결과 계약에서 빠진 것을 모아 보여 줍니다.',
      user: '사유를 읽고 근거를 보강하거나 빠진 판정 규칙을 채워 다시 요청합니다.',
      server: '근거가 없으면 케이스를 만들지 않고 거절 사유와 규칙 키를 남깁니다.',
      result: '「조건 B 케이스는 기준 컬럼의 근거가 없어 만들 수 없습니다」처럼 이유가 그대로 보입니다.',
      next: '고친 뒤 다시 실행하면 이 목록에서 사라집니다.'
    },
    'S2 단계 메트릭': {
      t: '단계 메트릭',
      role: '이번 단계에 얼마나 걸렸고 몇 번 다시 했는지 기록한 줄입니다.',
      user: '느린 단계나 재시도가 많은 단계를 찾아볼 때 봅니다.',
      server: '회차별 소요 시간·토큰·재시도를 저장하고 합계를 계산합니다.',
      result: '⏱ 4.82s · 재시도 1 · 토큰 12,480 같은 숫자와 회차별 기록이 보입니다.',
      next: '결과가 이상하면 이 숫자를 근거로 되짚어 볼 수 있습니다.'
    },

    /* ── S3 ─────────────────────────── */
    'S3 연결 상태 · 실행 안전장치': {
      t: 'S3 · 연결 상태와 안전장치',
      role: '무엇에 연결되어 있고, 실행해도 안전한지 확인하는 화면입니다.',
      user: '상단 배지로 연결 상태를 보고, 안전장치 목록에서 쓰기·시간대·LIVE 키가 어떻게 막히는지 확인합니다.',
      server: '연결 정보를 읽어 러너를 고르고, 규칙에 걸리면 실행하지 않고 사유를 돌려줍니다.',
      result: 'direct · 읽기전용 · allowWrite 꺼짐 같은 상태와 규칙별 차단 사유가 보입니다.',
      next: '이상이 없으면 S4 테스트 트랙으로 넘어가 케이스를 실행합니다.'
    },
    'S3 상단 모드 배지': {
      t: '상단 모드 배지',
      role: '지금 어느 시스템·환경에 붙어 있는지 알려 주는 배지입니다.',
      user: '[대상 시스템 (개발계)]를 눌러 연결 대상을 바꾸고, 배지로 LLM·연결 방식·저장 방식을 확인합니다.',
      server: '선택한 대상과 러너 설정을 읽어 요청마다 함께 기록합니다.',
      result: '실제 LLM · 직접 연결 · 읽기전용 · 파일 영속 저장처럼 한눈에 보입니다.',
      next: '운영(LIVE) 키가 잡히면 실행하지 않으므로, 개발계에서 마음 놓고 시험할 수 있습니다.'
    },
    'S3 안전장치 목록': {
      t: '안전장치 목록',
      role: '실행 전에 자동으로 검사하는 규칙을 모아 둔 표입니다.',
      user: '쓰기 허용이 꺼져 있는지, 차단 시간대가 언제인지 확인합니다.',
      server: '요청마다 allowWrite · WHERE 조건 · 허용 테이블 · 차단 시간대 · LIVE 키를 검사합니다.',
      result: '걸리면 실행 대신 blocked와 규칙 키가 돌아옵니다.',
      next: '막힌 사유는 서버 흐름 ⑥ 거절 · 사유 반환 단계에서 그대로 확인할 수 있습니다.'
    },

    /* ── S4 ─────────────────────────── */
    'S4 테스트 트랙 · 실행과 검증 결과': {
      t: 'S4 · 테스트 트랙과 결과',
      role: '승인된 케이스를 실제로 실행하고, 결과가 약속대로 나왔는지 판정하는 화면입니다.',
      user: '[승인 케이스 실행]을 누르고 통과·실패·차단 숫자와 판정 사유를 확인합니다.',
      server: '케이스마다 SQL·배치·HTTP를 실행해 결과를 모으고 결과 계약과 비교합니다.',
      result: '9 통과 · 1 실패 · 2 차단처럼 요약과 케이스별 판정이 나옵니다.',
      next: '실패는 자가 치유 판정으로 이어지고, 최종 결과는 S5 완료 다이어그램에 남습니다.'
    },
    'S4 실행 헤더': {
      t: '실행 헤더',
      role: '이번 실행이 실제 실행인지, 어떤 연결로 도는지 알려 주는 머리말입니다.',
      user: '배지를 보고 실제 실행인지 모의인지 확인합니다.',
      server: '실행 모드(direct 등)와 연결 상태를 함께 기록합니다.',
      result: '실제 실행 · 직접 연결 · 읽기전용 배지가 보입니다.',
      next: '아래 케이스 카드에서 무엇을 확인하는지 볼 수 있습니다.'
    },
    'S4 케이스 카드': {
      t: '케이스 카드',
      role: '이번에 실행하는 확인 항목 한 건을 보여 줍니다.',
      user: '무엇을 어떤 조건으로 확인하고 무엇과 비교하는지 읽어 봅니다.',
      server: '케이스에 적힌 실행 수단(SQL 조회·배치 호출·HTTP)을 차례로 호출합니다.',
      result: '결과 값과 기대값을 3필드 부분 일치로 비교한 판정이 나옵니다.',
      next: '실행 수단이 없는 케이스는 실행하지 않고 차단으로 남깁니다.'
    },
    'S4 결과 요약': {
      t: '결과 요약 (통과·실패·차단)',
      role: '이번 실행의 결론을 세 숫자로 보여 줍니다.',
      user: '통과·실패·차단의 비율을 보고 다음 행동을 정합니다.',
      server: '케이스별 판정을 모아 집계합니다.',
      result: '9 · 1 · 2 같은 숫자가 크게 보입니다.',
      next: '실패·차단의 이유는 아래 판정 영역에서 확인합니다.'
    },
    'S4 결과 계약 점검': {
      t: '결과 계약 점검',
      role: '결과가 약속한 모양대로 왔는지 항목별로 점검한 표입니다.',
      user: '스키마·건수·골든 비교·실행 모드·모의 여부를 확인합니다.',
      server: '응답 스키마와 건수, 기대값 일치, 실제/모의 여부, 실행에 박힌 커밋·코드맵 버전을 대조합니다.',
      result: '일치 · 3/3 · actual(모의 아님) · commit a1b2c3d처럼 근거가 함께 남습니다.',
      next: '이 근거가 있으면 결과를 그대로 믿고 다음 판단에 쓸 수 있습니다.'
    },

    /* ── S5 ─────────────────────────── */
    'S5 완료 다이어그램 · 산출물': {
      t: 'S5 · 완료 다이어그램',
      role: '끝난 작업을 그림과 표로 정리해 남기는 마지막 화면입니다.',
      user: '토폴로지·데이터 시퀀스·DB Before/After를 보고 결과를 확인합니다.',
      server: '실행에 쓰인 코드 기준과 결과를 모아 산출물(JSON·Markdown)로 저장합니다.',
      result: '게이트 G5 통과와 함께 완료 다이어그램이 만들어집니다.',
      next: '산출물은 파일로 남아 다시 열어도 그대로 확인할 수 있습니다.'
    },
    'S5 완료 헤더': {
      t: '완료 헤더',
      role: '이 작업이 마지막 관문까지 통과했는지 알려 줍니다.',
      user: '게이트 G5 통과 배지를 확인합니다.',
      server: '마지막 게이트 판정을 기록합니다.',
      result: '14. 완료 다이어그램과 게이트 G5 통과가 보입니다.',
      next: '아래 세 그림에서 결과를 자세히 볼 수 있습니다.'
    },
    'S5 토폴로지': {
      t: '아키텍처 토폴로지',
      role: '화면 → API → DB → 배치가 어떻게 이어지는지 그린 구조 그림입니다.',
      user: '어느 상자가 이번 검증의 중심인지 확인합니다(진하게 표시된 상자).',
      server: '실제 코드에서 확인한 연결 관계를 상자와 화살표로 그립니다.',
      result: '대상 화면 → 대상 API → 대상 DB, 배치 스케줄러 → 대상 DB 두 줄이 보입니다.',
      next: '상자를 누르면 그 코드와 3축 해설로 이동합니다.'
    },
    'S5 데이터 시퀀스': {
      t: '데이터 시퀀스',
      role: '실행 → 조회 → 비교 → 기록의 순서를 적은 목록입니다.',
      user: '어떤 순서로 무엇을 했는지 따라 읽습니다.',
      server: '케이스 실행 기록에서 순서를 뽑아 정리합니다.',
      result: '① 실행 ② 조회 ③ 비교 ④ 기록 네 줄로 보입니다.',
      next: '각 줄이 궁금하면 서버 흐름도에서 해당 단계를 눌러 보세요.'
    },
    'S5 DB Before After': {
      t: 'DB Before / After',
      role: '실행 전과 후에 데이터가 어떻게 달라졌는지 비교하는 표입니다.',
      user: '바뀐 컬럼과 값이 기대와 맞는지 확인합니다.',
      server: '실행 전 값을 미리 읽어 두고, 실행 뒤 값과 나란히 놓습니다.',
      result: '대상 키 K-0007 · 결과 금액 0 · 처리 상태 처리완료처럼 Before/After가 보입니다.',
      next: 'PASS 표시가 있으면 기대한 변화가 실제로 일어난 것입니다.'
    },

    /* ── 서버 흐름 단계 ──────────────── */
    '흐름 1 · 요청 접수': {
      t: '① 요청 접수',
      role: '사용자가 누른 동작이 서버에 처음 도착하는 곳입니다.',
      user: '화면에서 [분석 시작]·[승인하고 진행]·[승인 케이스 실행] 같은 버튼을 누릅니다.',
      server: 'POST /api/lifecycle 로 요청을 받고, MCP 도구로 온 요청도 같은 오케스트레이터로 넘깁니다.',
      result: '요청이 접수되면 다음 단계(입력 검증)로 넘어갑니다.',
      next: '요청이 형식에 맞는지 ② 입력 검증에서 확인합니다.'
    },
    '흐름 2 · 입력 검증': {
      t: '② 입력 검증',
      role: '요청이 형식에 맞고 지금 해도 되는 일인지 확인하는 곳입니다.',
      user: '따로 할 일은 없습니다. 화면에서 필요한 값을 채워 보내면 됩니다.',
      server: '요청 스키마(Zod)와 단계 상태를 검사하고, 사람 단계인데 결정이 없으면 거절합니다.',
      result: '통과하면 다음 단계로, 아니면 사유와 함께 거절됩니다.',
      next: '사람 승인이 필요한 단계는 ④ 사람 승인 게이트에서 결정을 받습니다.'
    },
    '흐름 3 · 단계 오케스트레이션': {
      t: '③ 단계 오케스트레이션',
      role: '14단계 중 지금 무엇을 할지 정하고 차례로 진행시키는 중심부입니다.',
      user: '화면에서는 진행 상황만 봅니다(자동). 필요하면 [다음 게이트까지]로 연속 진행을 겁니다.',
      server: '단계를 하나씩 실행하고 게이트 잠금을 확인하며, run-to-gate면 다음 사람 게이트까지 이어서 돕니다.',
      result: '지금 단계와 진행률이 갱신됩니다.',
      next: '사람이 정해야 하는 지점에 닿으면 ④ 사람 승인 게이트에서 멈춥니다.'
    },
    '흐름 4 · 사람 승인 게이트': {
      t: '④ 사람 승인 게이트',
      role: 'AI가 대신할 수 없는, 사람이 직접 결정하는 지점입니다.',
      user: '의도 컨펌 · 계획 리뷰 · 설계 리뷰 세 곳에서 [승인하고 진행]을 누릅니다.',
      server: '결정이 없으면 다음 단계로 넘어가지 않고 기다립니다.',
      result: '승인하면 다음 단계가 열리고, 수정 요청이면 앞 단계로 돌아갑니다.',
      next: '승인이 끝나면 ⑤ 실행 준비 · 안전장치에서 실행 조건을 검사합니다.'
    },
    '흐름 5 · 실행 준비 · 안전장치': {
      t: '⑤ 실행 준비 · 안전장치',
      role: '실행해도 되는지 규칙으로 막아 보는 곳입니다.',
      user: '쓰기 허용·차단 시간대 같은 조건을 확인합니다(보통 기본값 그대로).',
      server: '러너를 고르고(sandbox·bridge·direct·local-sqlite) allowWrite · WHERE · 허용 테이블 · 차단 시간대 · LIVE 키를 검사합니다.',
      result: '하나라도 걸리면 실행하지 않고 사유를 돌려줍니다.',
      next: '걸리면 ⑥ 거절 · 사유 반환, 통과하면 ⑦ 실행 분기로 갑니다.'
    },
    '흐름 6 · 거절 사유 반환': {
      t: '⑥ 거절 · 사유 반환',
      role: '규칙에 걸렸을 때 왜 실행하지 않았는지 알려 주는 곳입니다.',
      user: '사유와 규칙 키를 읽고 설정이나 요청을 고칩니다.',
      server: '규칙 키와 실패 분류(blocked · runner_unconfigured / env)를 담아 돌려줍니다.',
      result: '실패가 아니라 blocked로 기록되어 작업이 망가지지 않습니다.',
      next: '고친 뒤 다시 실행하면 ⑦ 실행 분기로 넘어갑니다.'
    },
    '흐름 7 · 실행 분기': {
      t: '⑦ 실행 분기',
      role: '케이스에 적힌 방식대로 실행을 나눠 보내는 갈림길입니다.',
      user: '케이스를 만들 때 고른 방식에 따라 이 갈래가 정해집니다.',
      server: 'HTTP 호출 · SQL 조회 · 배치 실행 · 화면 조작(M2) 중 맞는 길로 보냅니다.',
      result: '각 실행의 결과가 모입니다.',
      next: '조회는 ⑦a 대상 DB 조회, 배치는 ⑦b 배치 스케줄러 실행으로 이어집니다.'
    },
    '흐름 7a · 대상 DB 조회': {
      t: '⑦a 대상 DB 조회',
      role: 'DB에서 필요한 값만 읽어 오는 단계입니다.',
      user: '케이스에 조회 조건(예: 대상 키)만 적습니다.',
      server: 'SELECT 전용으로 실행하고, WHERE 없는 조회·변경은 막습니다.',
      result: '조회 결과가 다음 비교 단계로 전달됩니다.',
      next: '읽어 온 값을 ⑧ 결과 계약 검증에서 기대값과 비교합니다.'
    },
    '흐름 7b · 배치 스케줄러 실행': {
      t: '⑦b 배치 스케줄러 실행',
      role: '정해진 시간에 도는 일(배치)을 대신 돌려 보고 기다리는 단계입니다.',
      user: '케이스에 배치 실행을 적어 두면 자동으로 돌아갑니다.',
      server: '스케줄러를 호출하고 완료될 때까지 기다리며, 차단 시간대는 피합니다.',
      result: '배치가 끝난 시각과 결과가 기록됩니다.',
      next: '끝난 뒤 값은 ⑧ 결과 계약 검증에서 확인합니다.'
    },
    '흐름 8 · 결과 계약 검증': {
      t: '⑧ 결과 계약 검증',
      role: '나온 결과가 약속한 모양과 값인지 대조하는 곳입니다.',
      user: '화면에서 통과·실패·차단과 그 근거를 확인합니다.',
      server: '스키마·건수·골든 부분 일치를 확인하고, 모의인지 실제인지 배지로 남깁니다.',
      result: '판정과 실패 분류가 함께 나옵니다.',
      next: '실패하면 ⑧b 자가 치유 판정으로, 통과하면 ⑨ 관문 기록 · 영속화로 갑니다.'
    },
    '흐름 8b · 자가 치유 판정': {
      t: '⑧b 자가 치유 판정',
      role: '실패했을 때 스스로 고칠 수 있는 실패인지 가르는 곳입니다.',
      user: '사람이 할 일은 없습니다. 결과만 확인하면 됩니다.',
      server: '코드 결함·스펙 결함만 앞 단계로 되돌려 다시 시도하고(최대 3회), 모의 판정·미연결·환경·미분류·혼합은 차단으로 남깁니다.',
      result: '치유 경로와 차단 사유가 기록됩니다.',
      next: '다시 돈 결과도 ⑧ 결과 계약 검증을 거쳐 ⑨ 관문 기록 · 영속화로 모입니다.'
    },
    '흐름 9 · 관문 기록 · 영속화': {
      t: '⑨ 관문 기록 · 영속화',
      role: '게이트 통과·차단과 숫자를 파일에 남겨 두는 곳입니다.',
      user: '따로 할 일은 없습니다. 서버를 다시 켜도 기록이 남습니다.',
      server: '게이트 결과와 메트릭을 회차별로 저장하고, 1초 하트비트로 상태를 유지합니다.',
      result: '재시작해도 진행 상황과 산출물이 그대로 복원됩니다.',
      next: '⑩ 보고 · 응답에서 사용자에게 정리해 보여 줍니다.'
    },
    '흐름 10 · 보고 응답': {
      t: '⑩ 보고 · 응답',
      role: '요청 하나의 결론을 화면에 돌려주는 마지막 단계입니다.',
      user: '결과·사유·다음에 할 일을 확인합니다.',
      server: '단계 상태·산출물·실패 사유와 nextAction, 완료 다이어그램을 담아 응답합니다.',
      result: '화면의 결과 카드와 S5 완료 다이어그램이 갱신됩니다.',
      next: '결과가 마음에 들면 그대로 배포·검증 근거로 쓰고, 아니면 요구사항으로 돌아가 다시 시작합니다.'
    }
  };

  /* ── 📖 설명 시트 / 🗺️ 전체 동작 안내 ───────── */
  function infoHref(kind, id) {
    return kind === 'node' ? nodeMeta(id).chip : (SCREEN_META[id] || id);
  }

  function openInfoModal() { $('#infoModal').hidden = false; }
  function closeInfo() { $('#infoModal').hidden = true; }
  function closeGuide() { $('#guideModal').hidden = true; }

  function renderInfo(d, where, jumps) {
    $('#infoTitle').textContent = d.t || '설명';
    $('#infoWhere').textContent = where;
    var html = '';
    html += '<div class="info-sec"><span class="info-k">이곳의 역할</span>' +
            '<p class="info-role">' + esc(d.role) + '</p></div>';
    html += '<div class="info-sec">' +
      '<div class="info-step"><span class="st s-user">사용자가 여기서 하는 일</span><p>' + esc(d.user) + '</p></div>' +
      '<div class="info-step"><span class="st s-server">서버에서 일어나는 일</span><p>' + esc(d.server) + '</p></div>' +
      '<div class="info-step"><span class="st s-result">나오는 결과</span><p>' + esc(d.result) + '</p></div>' +
      '</div>';
    html += '<div class="info-sec"><span class="info-k">다음으로 할 수 있는 것</span>' +
            '<p class="info-next">' + esc(d.next) + '</p>';
    if (jumps && jumps.length) {
      html += '<div class="info-jumps">';
      jumps.forEach(function (j) {
        html += '<button class="info-jump" data-jump="' + j.kind + ':' + j.id + '">' +
          (j.kind === 'node' ? '🔗 ' : '🖥️ ') + esc(infoHref(j.kind, j.id)) + ' 보기 →</button>';
      });
      html += '</div>';
    }
    html += '</div>';
    var body = $('#infoBody');
    body.innerHTML = html;
    body.scrollTop = 0;
    $$('[data-jump]', body).forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.dataset.jump.split(':');
        closeInfo();
        if (v[0] === 'node') focusFlow(v[1]); else focusScreen(v[1]);
      });
    });
  }

  function showInfoScreen(card, regionEl) {
    var regionKey = regionEl && regionEl.dataset ? regionEl.dataset.label : null;
    var key = (regionKey && INFO[regionKey]) ? regionKey : card.dataset.label;
    var d = INFO[key];
    if (!d) return false;
    var sid = card.dataset.screen;
    var where = '화면 시안 · ' + (regionKey && regionKey !== card.dataset.label ? regionKey : (SCREEN_META[sid] || key));
    renderInfo(d, where, nodeIds(card).map(function (id) { return { kind: 'node', id: id }; }));
    openInfoModal();
    return true;
  }

  function showInfoNode(g) {
    var d = INFO[g.dataset.label] || INFO[g.dataset.chip];
    if (!d) return false;
    renderInfo(d, '서버 흐름도 · ' + (g.dataset.chip || g.dataset.label),
      screenIds(g).map(function (sid) { return { kind: 'screen', id: sid }; }));
    openInfoModal();
    return true;
  }

  /* 📖 설명 보기 에서 누른 곳 → 설명 시트 */
  function openInfoFrom(el) {
    if (!el || !el.closest) return false;
    var g = el.closest('g.node[data-node]');
    if (g) return showInfoNode(g);
    var card = el.closest('.screen[data-screen]');
    if (card) return showInfoScreen(card, el.closest('[data-label]'));
    var reg = el.closest('[data-label]');
    if (reg && INFO[reg.dataset.label]) return false;
    toast('설명이 있는 카드나 단계를 눌러 주세요');
    return false;
  }

  /* 모든 화면·영역·단계에 설명이 있는지 점검 */
  function infoAudit() {
    var missing = [], seen = {};
    $$('[data-label]').forEach(function (el) {
      var k = el.dataset.label;
      if (!INFO[k]) missing.push(k); else seen[k] = 1;
    });
    var screens = $$('.screen[data-screen]');
    screens.forEach(function (c) { if (!INFO[c.dataset.label]) missing.push(c.dataset.label); else seen[c.dataset.label] = 1; });
    var nodes = $$('#flowSvg g.node[data-node]');
    nodes.forEach(function (g) { if (!INFO[g.dataset.label]) missing.push(g.dataset.label); else seen[g.dataset.label] = 1; });
    return {
      ok: missing.length === 0,
      missing: missing,
      labels: Object.keys(seen).length,
      entries: Object.keys(INFO).length,
      screens: screens.length,
      nodes: nodes.length
    };
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

    $('#guideBtn').addEventListener('click', function () { $('#guideBody').scrollTop = 0; $('#guideModal').hidden = false; });
    $('#guideClose').addEventListener('click', closeGuide);
    $('#guideDone').addEventListener('click', closeGuide);
    $('#guideScrim').addEventListener('click', closeGuide);
    $$('#guideBody [data-go-screen], #guideBody [data-go-node]').forEach(function (b) {
      b.addEventListener('click', function () {
        closeGuide();
        if (b.dataset.goScreen) focusScreen(b.dataset.goScreen);
        else focusFlow(b.dataset.goNode);
      });
    });
    $('#infoClose').addEventListener('click', closeInfo);
    $('#infoDone').addEventListener('click', closeInfo);
    $('#infoScrim').addEventListener('click', closeInfo);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#infoModal').hidden) closeInfo();
      if (!$('#guideModal').hidden) closeGuide();
    });

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
    infoAudit: infoAudit,
    openInfoFrom: openInfoFrom,
    openGuide: function () { $('#guideBody').scrollTop = 0; $('#guideModal').hidden = false; },
    reanchor: function () {           // 레이아웃이 바뀐 뒤 핀을 요소에 다시 붙인다
      S.pins.forEach(function (p) { p.v = 0; });
      bindLegacyAnchors();
      renderPins();
      save();
      return S.pins.map(function (p) { return { no: p.no, x: +p.x.toFixed(3), y: +p.y.toFixed(3), anchor: p.anchor || null }; });
    },
    state: S
  };
})();
