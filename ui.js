/* Nav state, project dialogs and the Watch player. Runs on every page, with or without WebGL
   and with reduced motion. engine.js listens for dlg:open and dlg:close to light the room
   with the dialog's video. */
(function () {
  var d = document, w = window, root = d.documentElement;
  var reduce = root.classList.contains('rm');
  var small = w.matchMedia('(max-width: 760px)').matches;
  var arr = function (s, r) { return [].slice.call((r || d).querySelectorAll(s)); };

  /* nav: transparent over the hero, a dark glass bar once the page is over content */
  var nav = d.querySelector('.top'), heroBox = d.querySelector('.hero');
  /* solid once the hero's bottom passes 55% of the window, or past the first 40 px on pages without a hero.
     An IntersectionObserver reports it, so neither scrolling nor start-up ever forces a layout. */
  function setSolid(s) { if (nav) nav.classList.toggle('is-solid', s) }
  if (nav && 'IntersectionObserver' in w) {
    var mark = heroBox;
    if (!mark) { mark = d.createElement('div'); mark.setAttribute('aria-hidden', 'true'); mark.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:40px;pointer-events:none'; d.body.prepend(mark) }
    new IntersectionObserver(function (es) { setSolid(!es[es.length - 1].isIntersecting) }, { rootMargin: heroBox ? '-55% 0px 0px 0px' : '0px' }).observe(mark);
  } else if (nav) {
    w.addEventListener('scroll', function () { setSolid(w.scrollY > 40) }, { passive: true });
  }

  /* a "·" separator never starts a line */
  function below(a, b) { return a.getBoundingClientRect().top > b.getBoundingClientRect().top + 4 }
  function seps() {
    arr('.play-i').forEach(function (s) {
      var p = s.previousElementSibling; s.classList.remove('play-nl');
      if (p && below(s, p)) s.classList.add('play-nl');
    });
  }
  seps(); w.addEventListener('resize', seps);
  if (d.fonts && d.fonts.ready) d.fonts.ready.then(seps);

  /* ---- Watch player: one video, custom controls, key sections. Loads when its dialog opens. ---- */
  function fmtT(t) { t = Math.max(0, Math.round(t || 0)); return Math.floor(t / 60) + ':' + ('0' + t % 60).slice(-2) }
  function setupWatch(wt) {
    var v = wt.querySelector('.w-video'), stage = wt.querySelector('.w-stage'), big = wt.querySelector('.w-big'),
        pb = wt.querySelector('.w-play'), seek = wt.querySelector('.w-seek'), cur = wt.querySelector('.w-cur'),
        len = wt.querySelector('.w-len'), rep = wt.querySelector('.w-replay'), mute = wt.querySelector('.w-mute'),
        fs = wt.querySelector('.w-fs'), cc = wt.querySelector('.w-cc'), ccb = wt.querySelector('.w-ccb'), ccOn = true, trk = null,
        secs = arr('.w-sec', wt), idx = -1, dur = 0, scrub = false, wantSound = false;
    function play() { var p = v.play(); if (p && p.catch) p.catch(function () {}) }
    function showCues() {
      var t = trk && trk.track, lines = [];
      if (ccOn && t && t.activeCues) for (var k = 0; k < t.activeCues.length; k++) lines = lines.concat(String(t.activeCues[k].text).split('\n'));
      var key = lines.join('\n'); if (cc.dataset.k === key) return; cc.dataset.k = key;
      while (cc.firstChild) cc.removeChild(cc.firstChild);
      lines.forEach(function (l) { var s = d.createElement('span'); s.textContent = l; cc.appendChild(s) });
    }
    function addTrack(src, cues) {
      var e = d.createElement('track'); e.kind = 'captions'; e.srclang = 'en'; e.label = 'English'; e.default = true; e.src = src;
      e.addEventListener('error', function () { if (cues && trk === e) { v.removeChild(e); addTrack(URL.createObjectURL(new Blob([cues], { type: 'text/vtt' })), '') } });
      v.appendChild(e); trk = e; e.track.mode = 'hidden'; e.track.addEventListener('cuechange', showCues);
    }
    function load(i, t, auto) {
      var b = secs[i]; if (!b) return;
      var fresh = i !== idx;
      if (fresh) {
        idx = i;
        secs.forEach(function (s) { s.removeAttribute('aria-current') }); b.setAttribute('aria-current', 'true');
        v.pause(); while (v.firstChild) v.removeChild(v.firstChild);
        var base = b.dataset.src;
        function add(src, type) { var s = d.createElement('source'); s.src = src; s.type = type; v.appendChild(s) }
        if (small && b.dataset.mobile) add(base + '-mobile.mp4', 'video/mp4');
        else { if (b.dataset.webm) add(base + '.webm', 'video/webm'); add(base + '.mp4', 'video/mp4'); }
        trk = null; if (b.dataset.vtt) addTrack(location.protocol === 'file:' && b.dataset.cues ? URL.createObjectURL(new Blob([b.dataset.cues], { type: 'text/vtt' })) : b.dataset.vtt, b.dataset.cues);
        ccb.hidden = !b.dataset.vtt; showCues();
        if (b.dataset.poster) v.poster = b.dataset.poster;
        v.setAttribute('aria-label', b.dataset.title);
        dur = +b.dataset.dur || 0; len.textContent = fmtT(dur);
        mute.hidden = !b.dataset.audio; v.muted = !(b.dataset.audio && wantSound);
        syncMute(); v.load(); syncTime();
      }
      if (t != null && (t > 0 || !fresh)) { var go = function () { try { v.currentTime = t } catch (e) {} }; if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true }) }
      if (auto) play();
    }
    function toggle() { if (idx < 0) load(0, null, false); if (v.paused || v.ended) play(); else v.pause() }
    function syncPlay() { var on = !v.paused && !v.ended; wt.classList.toggle('is-playing', on); pb.setAttribute('aria-label', on ? 'Pause' : 'Play'); big.hidden = on }
    function syncMute() { mute.setAttribute('aria-pressed', String(!v.muted)); wt.classList.toggle('is-sound', !v.muted) }
    function syncTime() {
      var D = (v.duration && isFinite(v.duration)) ? v.duration : dur;
      if (!scrub) seek.value = D ? Math.round(v.currentTime / D * 1000) : 0;
      seek.style.setProperty('--p', (seek.value / 10) + '%');
      cur.textContent = fmtT(v.currentTime); len.textContent = fmtT(D);
      seek.setAttribute('aria-valuetext', fmtT(v.currentTime) + ' of ' + fmtT(D));
    }
    ['play', 'pause', 'ended'].forEach(function (e) { v.addEventListener(e, syncPlay) });
    /* the screen takes the shape of each key section */
    v.addEventListener('loadedmetadata', function () { var f = stage.closest('.pd-stage'); if (f && v.videoWidth) f.style.setProperty('--ar', v.videoWidth + '/' + v.videoHeight) });
    ['timeupdate', 'loadedmetadata', 'seeked'].forEach(function (e) { v.addEventListener(e, syncTime) });
    ['timeupdate', 'seeked', 'ended'].forEach(function (e) { v.addEventListener(e, showCues) });
    ccb.addEventListener('click', function () { ccOn = !ccOn; ccb.setAttribute('aria-pressed', String(ccOn)); showCues() });
    v.addEventListener('volumechange', syncMute);
    v.addEventListener('click', toggle);
    big.addEventListener('click', toggle); pb.addEventListener('click', toggle);
    rep.addEventListener('click', function () { if (idx < 0) load(0, null, false); try { v.currentTime = 0 } catch (e) {} play() });
    mute.addEventListener('click', function () { v.muted = !v.muted; wantSound = !v.muted; if (!v.muted && v.volume === 0) v.volume = 1 });
    seek.addEventListener('input', function () { scrub = true; var D = (v.duration && isFinite(v.duration)) ? v.duration : dur; if (idx < 0) load(0, null, false); try { v.currentTime = seek.value / 1000 * D } catch (e) {} seek.style.setProperty('--p', (seek.value / 10) + '%'); cur.textContent = fmtT(seek.value / 1000 * D) });
    seek.addEventListener('change', function () { scrub = false });
    fs.addEventListener('click', function () {
      var fe = d.fullscreenElement || d.webkitFullscreenElement;
      if (fe) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return }
      if (stage.requestFullscreen) stage.requestFullscreen(); else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen(); else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
    });
    stage.addEventListener('keydown', function (e) {
      if (e.target === seek) return;
      var k = e.key;
      if ((k === ' ' && e.target === stage) || k === 'k') { e.preventDefault(); toggle() }
      else if (k === 'm' && !mute.hidden) mute.click();
      else if (k === 'f') fs.click();
      else if (k === 'c' && !ccb.hidden) ccb.click();
      else if ((k === 'ArrowRight' || k === 'ArrowLeft') && e.target === stage) { e.preventDefault(); try { v.currentTime = Math.max(0, v.currentTime + (k === 'ArrowRight' ? 5 : -5)) } catch (x) {} }
    });
    secs.forEach(function (b, i) { b.addEventListener('click', function () { load(i, 0, true) }) });
    wt.watchOpen = function () { if (idx < 0) load(0, null, !reduce) };
    wt.watchClose = function () { v.pause() };
  }
  arr('[data-watch]').forEach(setupWatch);

  /* ---- project dialogs: native <dialog> with showModal, so Esc, focus and the top layer come from the browser ---- */
  var last = null;
  function openDlg(id, from) {
    var dl = d.getElementById(id);
    if (!dl || typeof dl.showModal !== 'function' || dl.open) return;
    last = from || d.activeElement;
    dl.showModal();
    root.classList.add('has-dialog');
    seps();
    dl.scrollTop = 0;
    var x = dl.querySelector('.pd-x'); if (x) x.focus({ preventScroll: true });
    var wt = dl.querySelector('[data-watch]'); if (wt && wt.watchOpen) wt.watchOpen();
    dl.__from = from || null;   /* engine.js flies the dialog's screen out of this control's screen */
    d.dispatchEvent(new CustomEvent('dlg:open', { detail: dl }));
    if (history.replaceState) history.replaceState(null, '', '#' + id);
  }
  d.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-open]');
    if (b) openDlg(b.getAttribute('data-open'), b);
  });
  arr('dialog.pd').forEach(function (dl) {
    dl.addEventListener('click', function (e) { if (e.target === dl) dl.close() });
    dl.addEventListener('close', function () {
      root.classList.remove('has-dialog');
      arr('video', dl).forEach(function (v) { v.pause() });
      var wt = dl.querySelector('[data-watch]'); if (wt && wt.watchClose) wt.watchClose();
      d.dispatchEvent(new CustomEvent('dlg:close', { detail: dl }));
      if (location.hash === '#' + dl.id && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
      if (last && last.focus) last.focus({ preventScroll: true });
      last = null;
    });
  });
  if (/^#p-/.test(location.hash)) w.addEventListener('load', function () { openDlg(location.hash.slice(1), null) });
})();
