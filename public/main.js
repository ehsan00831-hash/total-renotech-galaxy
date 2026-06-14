/* ===================================================================
   Total — Plomberie & Construction — galaxy interactions
   =================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ================================================================
     1. STARFIELD — layered depth for a 3D, in-motion galaxy
     ================================================================ */
  var canvas = document.getElementById('space');
  var ctx = canvas.getContext('2d');
  var stars = [];
  var shooting = [];
  var W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
  var pointer = { x: 0, y: 0 };

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildStars();
  }

  function buildStars() {
    stars = [];
    var count = Math.min(260, Math.floor((W * H) / 6500));
    for (var i = 0; i < count; i++) {
      var depth = Math.random();
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: depth,
        r: 0.4 + depth * 1.8,
        tw: Math.random() * Math.PI * 2,
        hue: Math.random() < 0.5 ? '#bcd4ff' : (Math.random() < 0.5 ? '#9ad7ff' : '#fff6d6')
      });
    }
  }

  function spawnShooting() {
    if (reduceMotion) return;
    shooting.push({
      x: Math.random() * W * 0.7,
      y: Math.random() * H * 0.4,
      len: 120 + Math.random() * 160,
      sp: 7 + Math.random() * 6,
      life: 1
    });
  }

  var scrollY = 0, lastScroll = 0;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    var px = (pointer.x - W / 2) * 0.012;
    var py = (pointer.y - H / 2) * 0.012;
    var sShift = (scrollY - lastScroll);
    lastScroll += sShift * 0.08;

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.x += (0.04 + s.z * 0.10) * (reduceMotion ? 0 : 1);
      if (s.x > W + 4) s.x = -4;
      var ox = px * (s.z * 2.4 + 0.4);
      var oy = py * (s.z * 2.4 + 0.4) - lastScroll * (s.z * 0.6 + 0.1) * 0.04;
      var yy = ((s.y + oy) % H + H) % H;
      s.tw += 0.02 + s.z * 0.03;
      var a = 0.4 + Math.sin(s.tw) * 0.35 + s.z * 0.25;
      ctx.beginPath();
      ctx.globalAlpha = Math.max(0.05, Math.min(1, a));
      ctx.fillStyle = s.hue;
      ctx.arc(s.x + ox, yy, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (var j = shooting.length - 1; j >= 0; j--) {
      var sh = shooting[j];
      sh.x += sh.sp; sh.y += sh.sp * 0.5; sh.life -= 0.012;
      if (sh.life <= 0) { shooting.splice(j, 1); continue; }
      var grad = ctx.createLinearGradient(sh.x, sh.y, sh.x - sh.len, sh.y - sh.len * 0.5);
      grad.addColorStop(0, 'rgba(255,255,255,' + sh.life + ')');
      grad.addColorStop(1, 'rgba(67,231,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(sh.x - sh.len, sh.y - sh.len * 0.5);
      ctx.stroke();
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', function (e) { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });
  resize();
  draw();
  setInterval(function () { if (Math.random() < 0.5) spawnShooting(); }, 2600);

  /* ================================================================
     2. WINDING ROAD — comet travels along path with scroll
     ================================================================ */
  var roadProgress = document.getElementById('roadProgress');
  var comet = document.getElementById('comet');
  var progressPct = document.getElementById('progressPct');
  var pathLen = roadProgress.getTotalLength();
  roadProgress.style.strokeDasharray = pathLen;
  roadProgress.style.strokeDashoffset = pathLen;

  function onScroll() {
    scrollY = window.scrollY || window.pageYOffset;
    var max = document.body.scrollHeight - window.innerHeight;
    var pct = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    roadProgress.style.strokeDashoffset = pathLen * (1 - pct);
    var pt = roadProgress.getPointAtLength(pathLen * pct);
    comet.setAttribute('transform', 'translate(' + pt.x + ',' + pt.y + ')');
    if (progressPct) progressPct.textContent = Math.round(pct * 100);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ================================================================
     3. REVEAL panels on scroll
     ================================================================ */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) en.target.classList.add('in'); });
  }, { threshold: 0.18 });
  document.querySelectorAll('.panel').forEach(function (p) { io.observe(p); });

  /* ================================================================
     4. 3D tilt on planets
     ================================================================ */
  if (!reduceMotion && window.matchMedia('(pointer:fine)').matches) {
    document.querySelectorAll('.planet').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var rx = ((e.clientY - r.top) / r.height - 0.5) * -8;
        var ry = ((e.clientX - r.left) / r.width - 0.5) * 10;
        card.style.transform = 'translateY(-8px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg)';
      });
      card.addEventListener('pointerleave', function () { card.style.transform = ''; });
    });
  }

  /* ================================================================
     5. WARP transition to external sites
     ================================================================ */
  var warp = document.getElementById('warp');
  var warpCanvas = document.getElementById('warpCanvas');
  var warpLabel = document.getElementById('warpLabel');
  var wctx = warpCanvas.getContext('2d');
  var warpStars = [];

  function startWarp(url, label) {
    warpLabel.textContent = label || 'Entering hyperspace…';
    warp.classList.add('on');
    warpCanvas.width = window.innerWidth;
    warpCanvas.height = window.innerHeight;
    var cx = warpCanvas.width / 2, cy = warpCanvas.height / 2;
    warpStars = [];
    for (var i = 0; i < 320; i++) {
      warpStars.push({ a: Math.random() * Math.PI * 2, r: Math.random() * 30, sp: 2 + Math.random() * 8, len: 0 });
    }
    var t0 = performance.now();
    function step(now) {
      var k = (now - t0) / 1000;
      wctx.fillStyle = 'rgba(2,3,10,0.35)';
      wctx.fillRect(0, 0, warpCanvas.width, warpCanvas.height);
      for (var i = 0; i < warpStars.length; i++) {
        var s = warpStars[i];
        s.r += s.sp * (1 + k * 3);
        s.len = s.sp * (2 + k * 6);
        var x1 = cx + Math.cos(s.a) * s.r, y1 = cy + Math.sin(s.a) * s.r;
        var x2 = cx + Math.cos(s.a) * (s.r - s.len), y2 = cy + Math.sin(s.a) * (s.r - s.len);
        var hue = i % 3 === 0 ? '124,92,255' : (i % 3 === 1 ? '67,231,255' : '255,206,92');
        wctx.strokeStyle = 'rgba(' + hue + ',0.9)';
        wctx.lineWidth = 1.6;
        wctx.beginPath();
        wctx.moveTo(x1, y1);
        wctx.lineTo(x2, y2);
        wctx.stroke();
        if (s.r > Math.max(warpCanvas.width, warpCanvas.height)) s.r = 0;
      }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
    setTimeout(function () { window.location.href = url; }, reduceMotion ? 150 : 1050);
  }

  document.querySelectorAll('[data-url]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      var url = el.getAttribute('data-url');
      var title = el.querySelector('h3') || el.querySelector('b');
      startWarp(url, title ? 'Travelling to ' + title.textContent + '…' : 'Entering hyperspace…');
    });
  });

  /* ================================================================
     6. DYNAMIC MODAL — quote / comment / specification -> Excel
     ================================================================ */
  var FORMS = {
    quote: {
      endpoint: '/api/lead',
      title: 'Request your free quote',
      sub: 'We keep your details private and reach out shortly.',
      submit: 'Launch my request 🚀',
      fields: [
        { name: 'firstName', label: 'First name', type: 'text', auto: 'given-name', half: true },
        { name: 'lastName', label: 'Last name', type: 'text', auto: 'family-name', half: true },
        { name: 'location', label: 'Location', type: 'text', auto: 'address-level2', placeholder: 'City / Address' },
        { name: 'email', label: 'Email', type: 'email', auto: 'email' },
        { name: 'phone', label: 'Phone', type: 'tel', auto: 'tel' }
      ]
    },
    comment: {
      endpoint: '/api/comment',
      title: 'Comments for us',
      sub: 'Tell us how we did — we read every message.',
      submit: 'Send comment 🚀',
      fields: [
        { name: 'name', label: 'Name', type: 'text', auto: 'name' },
        { name: 'email', label: 'Email', type: 'email', auto: 'email' },
        { name: 'comment', label: 'Your comment', type: 'textarea' }
      ]
    },
    specification: {
      endpoint: '/api/specification',
      title: 'Client specifications',
      sub: 'Share your project details and we will prepare a tailored plan.',
      submit: 'Send specifications 🚀',
      fields: [
        { name: 'name', label: 'Name', type: 'text', auto: 'name' },
        { name: 'email', label: 'Email', type: 'email', auto: 'email' },
        { name: 'phone', label: 'Phone', type: 'tel', auto: 'tel' },
        { name: 'projectType', label: 'Project type', type: 'text', placeholder: 'Kitchen, bathroom, plumbing…', optional: true },
        { name: 'details', label: 'Project details', type: 'textarea' }
      ]
    }
  };

  var modal = document.getElementById('leadModal');
  var form = document.getElementById('leadForm');
  var fieldsBox = document.getElementById('modalFields');
  var titleEl = document.getElementById('modalTitle');
  var subEl = document.getElementById('modalSub');
  var formMsg = document.getElementById('formMsg');
  var submitBtn = document.getElementById('submitBtn');
  var current = FORMS.quote;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function fieldHTML(f) {
    var control = f.type === 'textarea'
      ? '<textarea name="' + f.name + '" rows="4"' + (f.optional ? '' : ' required') + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + '></textarea>'
      : '<input name="' + f.name + '" type="' + f.type + '"' + (f.auto ? ' autocomplete="' + f.auto + '"' : '') + (f.optional ? '' : ' required') + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + ' />';
    return '<label class="field"><span>' + esc(f.label) + (f.optional ? ' <i>(optional)</i>' : '') + '</span>' + control + '</label>';
  }

  function buildFields(def) {
    var html = '';
    for (var i = 0; i < def.fields.length; i++) {
      var f = def.fields[i], next = def.fields[i + 1];
      if (f.half && next && next.half) {
        html += '<div class="field-row">' + fieldHTML(f) + fieldHTML(next) + '</div>';
        i++;
      } else {
        html += fieldHTML(f);
      }
    }
    fieldsBox.innerHTML = html;
  }

  function openModal(type) {
    current = FORMS[type] || FORMS.quote;
    titleEl.textContent = current.title;
    subEl.textContent = current.sub;
    submitBtn.querySelector('span').textContent = current.submit;
    setMsg('', '');
    buildFields(current);
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    var first = form.querySelector('input, textarea');
    if (first) setTimeout(function () { first.focus(); }, 120);
  }
  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('[data-form]').forEach(function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); openModal(el.getAttribute('data-form')); });
  });
  modal.querySelectorAll('[data-close]').forEach(function (el) { el.addEventListener('click', closeModal); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  function setMsg(text, kind) {
    formMsg.textContent = text;
    formMsg.className = 'form-msg' + (kind ? ' ' + kind : '');
  }

  function validate(def) {
    var data = {}, bad = [];
    def.fields.forEach(function (f) {
      var input = form[f.name];
      var val = (input.value || '').trim();
      data[f.name] = val;
      var ok = f.optional ? true : !!val;
      if (ok && f.type === 'email') ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val);
      if (ok && f.type === 'tel') ok = val.replace(/[^0-9]/g, '').length >= 6;
      input.classList.toggle('invalid', !ok);
      if (!ok) bad.push(f.name);
    });
    return { data: data, ok: bad.length === 0 };
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setMsg('', '');
    var v = validate(current);
    if (!v.ok) { setMsg('Please check the highlighted fields.', 'err'); return; }

    submitBtn.disabled = true;
    var label = submitBtn.querySelector('span').textContent;
    submitBtn.querySelector('span').textContent = 'Launching…';

    fetch(current.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v.data)
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j.ok) {
          setMsg('🚀 Received! Our team will be in touch shortly.', 'ok');
          form.reset();
          setTimeout(closeModal, 1800);
        } else {
          setMsg('Something went wrong. Please call us at +1 (514) 581-3015.', 'err');
        }
      })
      .catch(function () { setMsg('Network error — please call us at +1 (514) 581-3015.', 'err'); })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.querySelector('span').textContent = label;
      });
  });
})();
