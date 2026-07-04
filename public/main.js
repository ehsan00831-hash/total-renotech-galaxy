/* ===================================================================
   Total Réno-Tech — premium site interactions
   Lightweight vanilla JS: forms, reviews, reveal. No dependencies.
   =================================================================== */
(function () {
  'use strict';

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ================================================================
     1. Sticky header state
     ================================================================ */
  var header = document.getElementById('siteHeader');
  function onScroll() {
    if (header) header.classList.toggle('scrolled', window.scrollY > 8);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ================================================================
     2. Reveal on scroll
     ================================================================ */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

  /* ================================================================
     3. Modal forms — quote / comment / specification / emergency
        (same backend endpoints as before)
     ================================================================ */
  var FORMS = {
    quote: {
      endpoint: '/api/lead',
      title: 'Request your free estimate',
      sub: 'We keep your details private and reach out shortly.',
      submit: 'Send my request',
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
      submit: 'Send comment',
      fields: [
        { name: 'name', label: 'Name', type: 'text', auto: 'name' },
        { name: 'email', label: 'Email', type: 'email', auto: 'email' },
        { name: 'comment', label: 'Your comment', type: 'textarea' }
      ]
    },
    specification: {
      endpoint: '/api/specification',
      title: 'Project specifications',
      sub: 'Share your project details and we will prepare a tailored plan.',
      submit: 'Send specifications',
      fields: [
        { name: 'name', label: 'Name', type: 'text', auto: 'name' },
        { name: 'email', label: 'Email', type: 'email', auto: 'email' },
        { name: 'phone', label: 'Phone', type: 'tel', auto: 'tel' },
        { name: 'projectType', label: 'Project type', type: 'text', placeholder: 'Kitchen, bathroom, plumbing…', optional: true },
        { name: 'details', label: 'Project details', type: 'textarea' }
      ]
    },
    emergency: {
      endpoint: '/api/specification',
      title: '🚨 Request emergency service',
      sub: 'Flood or water damage? Send your details — we respond fast, 24/7.',
      submit: 'Request emergency service',
      prefill: { projectType: 'EMERGENCY — Flood / Water damage' },
      fields: [
        { name: 'name', label: 'Name', type: 'text', auto: 'name' },
        { name: 'email', label: 'Email', type: 'email', auto: 'email' },
        { name: 'phone', label: 'Phone', type: 'tel', auto: 'tel' },
        { name: 'projectType', label: 'Emergency type', type: 'text' },
        { name: 'details', label: 'What happened? (address + situation)', type: 'textarea' }
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

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

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
    // Honeypot: hidden "website" field — bots fill it, real users never see it.
    html += '<input name="website" type="text" value="" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;" />';
    fieldsBox.innerHTML = html;
    if (def.prefill) {
      Object.keys(def.prefill).forEach(function (k) {
        if (form[k]) form[k].value = def.prefill[k];
      });
    }
  }

  function setMsg(text, kind) {
    formMsg.textContent = text;
    formMsg.className = 'form-msg' + (kind ? ' ' + kind : '');
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

  function validate(def) {
    var data = {}, bad = [];
    def.fields.forEach(function (f) {
      var input = form[f.name];
      var val = (input.value || '').trim();
      data[f.name] = val;
      var ok = f.optional ? true : !!val;
      if (ok && val && f.type === 'email') ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val);
      if (ok && val && f.type === 'tel') ok = val.replace(/[^0-9]/g, '').length >= 6;
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
    submitBtn.querySelector('span').textContent = 'Sending…';

    // Include the honeypot value so the server can reject bot submissions.
    var hp = form['website'];
    var payload = Object.assign({}, v.data, { website: hp ? hp.value : '' });

    fetch(current.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j.ok) {
          setMsg('✔ Received! Our team will be in touch shortly.', 'ok');
          form.reset();
          setTimeout(closeModal, 1800);
        } else {
          setMsg('Something went wrong. Please call us at (514) 581-3015.', 'err');
        }
      })
      .catch(function () { setMsg('Network error — please call us at (514) 581-3015.', 'err'); })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.querySelector('span').textContent = label;
      });
  });

  /* ================================================================
     4. Google Reviews — live data with graceful fallback
     ================================================================ */
  var FALLBACK_URL = 'https://www.google.com/search?q=Total+R%C3%A9no-Tech+Inc.+reviews';
  var gdata = { rating: 5.0, count: null, url: FALLBACK_URL, writeUrl: FALLBACK_URL, reviews: [], live: false };

  function applyGoogleLinks() {
    document.querySelectorAll('[data-glink]').forEach(function (a) {
      a.href = a.getAttribute('data-glink') === 'write' ? gdata.writeUrl : gdata.url;
    });
  }

  function starsFor(n) {
    var full = Math.round(n || 5);
    return '★★★★★'.slice(0, Math.max(0, Math.min(5, full)));
  }

  function renderReviews() {
    // Hero card
    var gRating = document.getElementById('gRating');
    var gCount = document.getElementById('gCount');
    if (gRating && gdata.rating) gRating.textContent = Number(gdata.rating).toFixed(1);
    if (gCount) {
      gCount.textContent = gdata.count
        ? Number(gdata.rating).toFixed(1) + ' from ' + gdata.count + ' Google reviews'
        : 'Rated ' + Number(gdata.rating).toFixed(1) + ' by our clients on Google';
    }
    var sub = document.getElementById('reviewsSub');
    if (sub && gdata.count) sub.textContent = gdata.count + ' verified Google reviews and counting — built one project at a time since 2002.';
    applyGoogleLinks();
    buildReviewSlider();
    buildWidget();
  }

  /* ================================================================
     4b. Google Reviews slider — one review at a time, same gdata source.
         Auto-rotates, supports manual prev/next + dots, pauses on
         hover/focus. Never invents reviews: shows a safe fallback slide
         (Read/Leave buttons only) when no real reviews are available.
     ================================================================ */
  function buildReviewSlider() {
    var slider = document.getElementById('revSlider');
    var track = document.getElementById('revTrack');
    var dotsBox = document.getElementById('revDots');
    var prevBtn = document.getElementById('revPrev');
    var nextBtn = document.getElementById('revNext');
    if (!slider || !track || !dotsBox) return;

    var reviews = gdata.reviews.slice(0, 8);
    var slideHTML;

    if (reviews.length) {
      slideHTML = reviews.map(function (r) {
        return '<div class="rev-slide" role="group" aria-roledescription="slide">' +
          '<span class="stars">' + starsFor(r.rating) + '</span>' +
          '<p class="rev-text">“' + esc(r.text || '') + '”</p>' +
          '<div class="rev-meta"><div class="rev-name">' + esc(r.name || 'Google user') + '</div>' +
          (r.when ? '<div class="rev-date">' + esc(r.when) + '</div>' : '') + '</div>' +
          '<div class="rev-slide-actions">' +
            '<a class="btn btn-primary btn-sm" href="' + esc(gdata.url) + '" target="_blank" rel="noopener">Read Google Reviews</a>' +
            '<a class="btn btn-goldline btn-sm" href="' + esc(gdata.writeUrl) + '" target="_blank" rel="noopener">★ Leave a Google Review</a>' +
          '</div></div>';
      }).join('');
    } else {
      // Safe fallback — no fabricated review text/count, just the trust badge + CTAs.
      reviews = [{}]; // one fallback "slide"
      slideHTML = '<div class="rev-slide rev-fallback" role="group" aria-roledescription="slide">' +
        '<span class="stars">' + starsFor(gdata.rating) + '</span>' +
        '<p class="rev-text">Rated ' + Number(gdata.rating).toFixed(1) + ' by our clients on Google. Be one of the first to share your experience.</p>' +
        '<div class="rev-slide-actions">' +
          '<a class="btn btn-primary btn-sm" href="' + esc(gdata.url) + '" target="_blank" rel="noopener">Read Google Reviews</a>' +
          '<a class="btn btn-goldline btn-sm" href="' + esc(gdata.writeUrl) + '" target="_blank" rel="noopener">★ Leave a Google Review</a>' +
        '</div></div>';
    }

    track.innerHTML = slideHTML;
    slider.setAttribute('data-count', String(reviews.length));
    dotsBox.innerHTML = reviews.length > 1
      ? reviews.map(function (_r, i) { return '<button type="button" class="rev-dot' + (i === 0 ? ' active' : '') + '" aria-label="Go to review ' + (i + 1) + '"></button>'; }).join('')
      : '';
    dotsBox.hidden = reviews.length <= 1;

    var dots = dotsBox.querySelectorAll('.rev-dot');
    var idx = 0;
    var timer = null;

    function goTo(i) {
      idx = (i + reviews.length) % reviews.length;
      track.style.transform = 'translateX(-' + (idx * 100) + '%)';
      dots.forEach(function (d, di) { d.classList.toggle('active', di === idx); });
    }
    function next() { goTo(idx + 1); }
    function prev() { goTo(idx - 1); }
    function startAuto() {
      if (reviews.length <= 1) return;
      stopAuto();
      timer = setInterval(next, 6000);
    }
    function stopAuto() { if (timer) { clearInterval(timer); timer = null; } }

    prevBtn.addEventListener('click', function () { prev(); startAuto(); });
    nextBtn.addEventListener('click', function () { next(); startAuto(); });
    dots.forEach(function (d, i) { d.addEventListener('click', function () { goTo(i); startAuto(); }); });
    slider.addEventListener('mouseenter', stopAuto);
    slider.addEventListener('mouseleave', startAuto);
    slider.addEventListener('focusin', stopAuto);
    slider.addEventListener('focusout', startAuto);

    goTo(0);
    startAuto();
  }

  /* ================================================================
     5. Floating Google review widget
     ================================================================ */
  function buildWidget() {
    var mount = document.getElementById('gWidget');
    if (!mount || mount.childNodes.length) return;
    try { if (sessionStorage.getItem('trt-gw-dismissed')) return; } catch (e) {}

    var gw = document.createElement('div');
    gw.className = 'gw';
    gw.innerHTML =
      '<div class="gw-card" role="dialog" aria-label="Google reviews">' +
        '<button class="gw-x" aria-label="Dismiss">×</button>' +
        '<span class="glogo"><b class="g1">G</b><b class="g2">o</b><b class="g3">o</b><b class="g1">g</b><b class="g4">l</b><b class="g2">e</b></span>' +
        '<div class="gw-review" id="gwReview">' +
          '<span class="stars">★★★★★</span>' +
          '<p>' + (gdata.count ? esc(Number(gdata.rating).toFixed(1) + ' from ' + gdata.count + ' reviews on Google.') : 'Rated 5.0 by our clients on Google.') + '</p>' +
        '</div>' +
        '<div class="gw-actions">' +
          '<a class="btn btn-primary" href="' + esc(gdata.url) + '" target="_blank" rel="noopener">Read on Google</a>' +
          '<a class="btn btn-goldline" href="' + esc(gdata.writeUrl) + '" target="_blank" rel="noopener">★ Leave a Review</a>' +
        '</div>' +
      '</div>' +
      '<button class="gw-pill" aria-expanded="false">' +
        '<span class="stars">★★★★★</span> ' + Number(gdata.rating).toFixed(1) + ' on Google' +
      '</button>';
    mount.appendChild(gw);

    var pill = gw.querySelector('.gw-pill');
    pill.addEventListener('click', function () {
      var open = gw.classList.toggle('open');
      pill.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    gw.querySelector('.gw-x').addEventListener('click', function () {
      gw.remove();
      try { sessionStorage.setItem('trt-gw-dismissed', '1'); } catch (e) {}
    });

    // Rotate real reviews when available
    if (gdata.reviews.length) {
      var box = gw.querySelector('#gwReview');
      var i = Math.floor(Math.random() * gdata.reviews.length);
      var show = function (idx) {
        var r = gdata.reviews[idx];
        box.innerHTML =
          '<span class="stars">' + starsFor(r.rating) + '</span>' +
          '<p>“' + esc((r.text || '').slice(0, 150)) + '”</p>' +
          '<div class="rev-name">' + esc(r.name || 'Google user') + '</div>';
      };
      show(i);
      setInterval(function () { i = (i + 1) % gdata.reviews.length; show(i); }, 6000);
    }
  }

  applyGoogleLinks(); // safe defaults immediately

  fetch('/api/reviews')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (d && d.rating) {
        gdata = {
          rating: d.rating,
          count: d.count || null,
          url: d.url || FALLBACK_URL,
          writeUrl: d.writeUrl || d.url || FALLBACK_URL,
          reviews: Array.isArray(d.reviews) ? d.reviews.filter(function (r) { return r && r.text; }) : [],
          live: !!d.live
        };
      }
      renderReviews();
    })
    .catch(function () { renderReviews(); });
})();
