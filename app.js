/* TestAnchor 핀 리뷰 보드
   - 두 탭(화면 시안 / 서버 흐름도)에 번호 핀을 꽂고 한 줄 의견을 남긴다.
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

  var S = {
    tab: 'screen',
    mode: 'move',
    reviewId: DEFAULT_REVIEW,
    pins: [],
    editing: null,     // {pin, isNew}
    zoom: 1,
    tx: 0,
    ty: 0,
    userZoomed: false,
    submitting: false
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var stageEls = { screen: $('#stage-screen'), flow: $('#stage-flow') };
  var pinHosts = { screen: $('#pins-screen'), flow: $('#pins-flow') };
  var scroller = $('#scroller-screen');
  var flowview = $('#flowview');
  var flowwrap = $('#flowwrap');

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
  function renderPins() {
    ['screen', 'flow'].forEach(function (tab) {
      var host = pinHosts[tab];
      host.innerHTML = '';
      pinsOf(tab).forEach(function (p) {
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

  /* ── 탭 / 모드 ────────────────────────── */
  function setTab(tab) {
    S.tab = tab;
    $$('.tab').forEach(function (b) {
      var on = b.dataset.tab === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#pane-screen').classList.toggle('is-on', tab === 'screen');
    $('#pane-flow').classList.toggle('is-on', tab === 'flow');
    $('#zoomBox').hidden = tab !== 'flow';
    updateHint();
    if (tab === 'flow' && !S.userZoomed) fitFlow();
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

  function updateHint() {
    var h = $('#hint');
    if (S.mode === 'pin') {
      h.innerHTML = S.tab === 'flow'
        ? '핀 모드입니다. <b>짧게 탭</b>하면 그 자리에 핀이 꽂히고, 끌면 화면이 움직입니다.'
        : '핀 모드입니다. 의견을 남길 자리를 <b>짧게 탭</b>하세요. 스크롤은 그대로 됩니다.';
    } else {
      h.innerHTML = S.tab === 'flow'
        ? '이동 모드입니다. 끌어서 옮기고, 두 손가락으로 확대·축소하세요.'
        : '핀을 남기려면 <b>📌 핀 찍기</b>로 바꾸고, 의견을 남길 자리를 톡 누르세요.';
    }
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
      no: nextNo(), tab: tab, x: x, y: y, label: label || null,
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
    var sw = stageEls.flow.offsetWidth || 436;
    var sh = stageEls.flow.offsetHeight || 1166;
    var z = Math.min((vw - 10) / sw, 1.45);
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
    var drag = null, pinch = null, tapStart = null, moved = false;

    function local(e) {
      var r = flowview.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

    flowview.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { flowview.setPointerCapture(e.pointerId); } catch (err) {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        drag = { x: e.clientX, y: e.clientY, tx: S.tx, ty: S.ty };
        tapStart = { x: e.clientX, y: e.clientY, t: Date.now() };
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
        tapStart = null;
        if (wasTap && S.mode === 'pin') {
          var lbl = e.target && e.target.closest ? e.target.closest('[data-label]') : null;
          placePin('flow', e.clientX, e.clientY, lbl ? lbl.dataset.label : null);
        }
      }
    }
    flowview.addEventListener('pointerup', end);
    flowview.addEventListener('pointercancel', function (e) { pts.delete(e.pointerId); pinch = null; drag = null; tapStart = null; });

    flowview.addEventListener('wheel', function (e) {
      e.preventDefault();
      var l = local(e);
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, l.x, l.y);
    }, { passive: false });
  }

  /* 화면 탭 스테이지 탭 감지(스크롤 방해 없이) */
  function bindScreenStage() {
    var start = null;
    stageEls.screen.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.pin')) return;
      start = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
    }, { passive: true });
    stageEls.screen.addEventListener('pointerup', function (e) {
      if (!start || start.id !== e.pointerId) return;
      var dx = Math.abs(e.clientX - start.x), dy = Math.abs(e.clientY - start.y);
      var dt = Date.now() - start.t;
      start = null;
      if (S.mode !== 'pin' || dx > 10 || dy > 10 || dt > 800) return;
      var lbl = e.target.closest ? e.target.closest('[data-label]') : null;
      placePin('screen', e.clientX, e.clientY, lbl ? lbl.dataset.label : null);
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
    if (S.tab !== p.tab) setTab(p.tab);
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
      v: 1,
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
  function changeReview() {
    var v = window.prompt('리뷰 ID (프로젝트·버전 구분용)', S.reviewId);
    if (v == null) return;
    v = v.trim();
    if (!v) return;
    if (!/^[A-Za-z0-9._-]{3,48}$/.test(v)) { toast('영문·숫자·-_. 3~48자로 적어 주세요', 'err'); return; }
    S.reviewId = v;
    var raw = null;
    try { raw = localStorage.getItem(LS_PINS + v); } catch (e) {}
    S.pins = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(S.pins)) S.pins = [];
    save(); renderPins(); renderList(); renderBadges();
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
    $('#reviewChip').addEventListener('click', changeReview);

    window.addEventListener('resize', function () {
      if (S.tab === 'flow' && !S.userZoomed) fitFlow();
    });
  }

  /* ── 시작 ─────────────────────────────── */
  load();
  bind();
  bindFlow();
  bindScreenStage();
  setTab('screen');
  setMode('move');
  renderPins();
  renderList();
  renderBadges();
  applyFlow();
  setTimeout(function () { if (S.tab === 'flow') fitFlow(); }, 60);

  // 테스트·검수용 최소 노출
  window.__taBoard = {
    pins: function () { return S.pins.slice(); },
    setMode: setMode,
    setTab: setTab,
    state: S
  };
})();
