/* Shared by every page: nav state, project dialogs, one slow reveal, lazy footage, hero reel. */
(function(){
  var d=document, w=window;
  var reduce=w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var small=w.matchMedia('(max-width: 720px)').matches;
  var hasIO='IntersectionObserver' in w;

  var nav=d.querySelector('.nav');
  function onScroll(){nav.classList.toggle('is-solid',w.scrollY>48)}
  if(nav){w.addEventListener('scroll',onScroll,{passive:true});onScroll()}

  /* a "·" separator never starts a line: when the heading or a link row wraps, the dot on the new line is hidden */
  function below(a,b){return a.getBoundingClientRect().top>b.getBoundingClientRect().top+4}
  function seps(){
    [].slice.call(d.querySelectorAll('h1 .h1-sec')).forEach(function(s){
      var h=s.parentNode, n=h.querySelector('.h1-name'); h.classList.remove('h1-wrap');
      if(n&&below(s,n)) h.classList.add('h1-wrap');
    });
    [].slice.call(d.querySelectorAll('.play-i')).forEach(function(s){
      var p=s.previousElementSibling; s.classList.remove('play-nl');
      if(p&&below(s,p)) s.classList.add('play-nl');
    });
  }
  /* front door: "About" is marked current while the About section fills the middle of the window */
  var abt=d.getElementById('about'), abl=d.querySelector('.nav-links a[href$="#about"]');
  if(abt&&abl&&hasIO){
    new IntersectionObserver(function(es){es.forEach(function(e){
      if(e.isIntersecting) abl.setAttribute('aria-current','location'); else abl.removeAttribute('aria-current');
      abl.parentNode.classList.toggle('at-about',e.isIntersecting);
    })},{rootMargin:'-45% 0px -45% 0px'}).observe(abt);
  }

  seps(); w.addEventListener('resize',seps);
  if(d.fonts&&d.fonts.ready) d.fonts.ready.then(seps);

  /* Watch player: one video, custom controls, key sections and chapters. Loads when its dialog opens. */
  /* one rounding rule with the build: whole seconds, rounded to the nearest */
  function fmtT(t){t=Math.max(0,Math.round(t||0));return Math.floor(t/60)+':'+('0'+t%60).slice(-2)}
  function setupWatch(w){
    var v=w.querySelector('.w-video'), stage=w.querySelector('.w-stage'), big=w.querySelector('.w-big'),
        pb=w.querySelector('.w-play'), seek=w.querySelector('.w-seek'), cur=w.querySelector('.w-cur'),
        len=w.querySelector('.w-len'), rep=w.querySelector('.w-replay'), mute=w.querySelector('.w-mute'),
        fs=w.querySelector('.w-fs'), cc=w.querySelector('.w-cc'), ccb=w.querySelector('.w-ccb'), ccOn=true, trk=null,
        secs=[].slice.call(w.querySelectorAll('.w-sec')), idx=-1, dur=0, scrub=false, wantSound=false;
    function play(){var p=v.play();if(p&&p.catch)p.catch(function(){})}
    /* captions: a hidden text track drawn into .w-cc, so they sit above the control bar in the site's type.
       The track points at the .vtt beside the video. A page opened from disk cannot load it (file: URLs are cross-origin),
       so there, or if the file fails, the inline copy in data-cues is used. */
    function showCues(){
      var t=trk&&trk.track, lines=[];
      if(ccOn&&t&&t.activeCues) for(var k=0;k<t.activeCues.length;k++) lines=lines.concat(String(t.activeCues[k].text).split('\n'));
      var key=lines.join('\n'); if(cc.dataset.k===key) return; cc.dataset.k=key;
      while(cc.firstChild) cc.removeChild(cc.firstChild);
      lines.forEach(function(l){var s=d.createElement('span');s.textContent=l;cc.appendChild(s)});
    }
    function addTrack(src,cues){
      var e=d.createElement('track'); e.kind='captions'; e.srclang='en'; e.label='English'; e.default=true; e.src=src;
      e.addEventListener('error',function(){ if(cues&&trk===e){ v.removeChild(e); addTrack(URL.createObjectURL(new Blob([cues],{type:'text/vtt'})),'') } });
      v.appendChild(e); trk=e; e.track.mode='hidden'; e.track.addEventListener('cuechange',showCues);
    }
    function load(i,t,auto){
      var b=secs[i]; if(!b) return;
      var fresh=i!==idx;
      if(fresh){
        idx=i;
        secs.forEach(function(s){s.removeAttribute('aria-current')}); b.setAttribute('aria-current','true');
        v.pause(); while(v.firstChild) v.removeChild(v.firstChild);
        var base=b.dataset.src;
        function add(src,type){var s=d.createElement('source');s.src=src;s.type=type;v.appendChild(s)}
        if(small&&b.dataset.mobile) add(base+'-mobile.mp4','video/mp4');
        else{ if(b.dataset.webm) add(base+'.webm','video/webm'); add(base+'.mp4','video/mp4'); }
        trk=null; if(b.dataset.vtt) addTrack(location.protocol==='file:'&&b.dataset.cues?URL.createObjectURL(new Blob([b.dataset.cues],{type:'text/vtt'})):b.dataset.vtt,b.dataset.cues);
        ccb.hidden=!b.dataset.vtt; showCues();
        if(b.dataset.poster) v.poster=b.dataset.poster;
        v.setAttribute('aria-label',b.dataset.title);
        dur=+b.dataset.dur||0; len.textContent=fmtT(dur);
        mute.hidden=!b.dataset.audio; v.muted=!(b.dataset.audio&&wantSound);
        syncMute(); v.load(); syncTime();
      }
      /* picking the section that is already loaded (or a 0:00 chapter in it) starts it again from the top */
      if(t!=null&&(t>0||!fresh)){var go=function(){try{v.currentTime=t}catch(e){}};if(v.readyState>=1)go();else v.addEventListener('loadedmetadata',go,{once:true})}
      if(auto) play();
    }
    function toggle(){ if(idx<0) load(0,null,false); if(v.paused||v.ended) play(); else v.pause() }
    function syncPlay(){var on=!v.paused&&!v.ended; w.classList.toggle('is-playing',on); pb.setAttribute('aria-label',on?'Pause':'Play'); big.hidden=on}
    function syncMute(){mute.setAttribute('aria-pressed',String(!v.muted)); w.classList.toggle('is-sound',!v.muted)}
    function syncTime(){
      var D=(v.duration&&isFinite(v.duration))?v.duration:dur;
      if(!scrub) seek.value=D?Math.round(v.currentTime/D*1000):0;
      seek.style.setProperty('--p',(seek.value/10)+'%');
      cur.textContent=fmtT(v.currentTime); len.textContent=fmtT(D);
      seek.setAttribute('aria-valuetext',fmtT(v.currentTime)+' of '+fmtT(D));
    }
    ['play','pause','ended'].forEach(function(e){v.addEventListener(e,syncPlay)});
    ['timeupdate','loadedmetadata','seeked'].forEach(function(e){v.addEventListener(e,syncTime)});
    ['timeupdate','seeked','ended'].forEach(function(e){v.addEventListener(e,showCues)});
    ccb.addEventListener('click',function(){ ccOn=!ccOn; ccb.setAttribute('aria-pressed',String(ccOn)); showCues() });
    v.addEventListener('volumechange',syncMute);
    v.addEventListener('click',toggle);
    big.addEventListener('click',toggle); pb.addEventListener('click',toggle);
    rep.addEventListener('click',function(){ if(idx<0) load(0,null,false); try{v.currentTime=0}catch(e){} play() });
    mute.addEventListener('click',function(){ v.muted=!v.muted; wantSound=!v.muted; if(!v.muted&&v.volume===0) v.volume=1 });
    seek.addEventListener('input',function(){ scrub=true; var D=(v.duration&&isFinite(v.duration))?v.duration:dur; if(idx<0) load(0,null,false); try{v.currentTime=seek.value/1000*D}catch(e){} seek.style.setProperty('--p',(seek.value/10)+'%'); cur.textContent=fmtT(seek.value/1000*D) });
    seek.addEventListener('change',function(){ scrub=false });
    fs.addEventListener('click',function(){
      var fe=d.fullscreenElement||d.webkitFullscreenElement;
      if(fe){ (d.exitFullscreen||d.webkitExitFullscreen).call(d); return }
      if(stage.requestFullscreen) stage.requestFullscreen(); else if(stage.webkitRequestFullscreen) stage.webkitRequestFullscreen(); else if(v.webkitEnterFullscreen) v.webkitEnterFullscreen();
    });
    stage.addEventListener('keydown',function(e){
      if(e.target===seek) return;
      var k=e.key;
      if((k===' '&&e.target===stage)||k==='k'){e.preventDefault();toggle()}
      else if(k==='m'&&!mute.hidden) mute.click();
      else if(k==='f') fs.click();
      else if(k==='c'&&!ccb.hidden) ccb.click();
      else if((k==='ArrowRight'||k==='ArrowLeft')&&e.target===stage){e.preventDefault();try{v.currentTime=Math.max(0,v.currentTime+(k==='ArrowRight'?5:-5))}catch(x){}}
    });
    secs.forEach(function(b,i){ b.addEventListener('click',function(){ load(i,0,true) }) });
    [].slice.call(w.querySelectorAll('.w-ch button')).forEach(function(b){ b.addEventListener('click',function(){ load(+b.dataset.i,+b.dataset.t,true) }) });
    w.watchOpen=function(){ if(idx<0) load(0,null,!reduce) };
    w.watchClose=function(){ v.pause() };
  }
  [].slice.call(d.querySelectorAll('[data-watch]')).forEach(setupWatch);

  /* project dialogs: a native <dialog> opened with showModal, so Esc, focus and the top layer come from the browser */
  var root=d.documentElement, last=null;
  function openDlg(id,from){
    var dl=d.getElementById(id);
    if(!dl||typeof dl.showModal!=='function'||dl.open) return;
    last=from||d.activeElement;
    dl.showModal();
    root.classList.add('has-dialog');
    seps();
    dl.scrollTop=0;
    var x=dl.querySelector('.pd-x'); if(x) x.focus();
    var wt=dl.querySelector('[data-watch]'); if(wt&&wt.watchOpen) wt.watchOpen();
    if(history.replaceState) history.replaceState(null,'','#'+id);
  }
  [].slice.call(d.querySelectorAll('[data-open]')).forEach(function(b){
    b.addEventListener('click',function(){openDlg(b.getAttribute('data-open'),b)});
  });
  [].slice.call(d.querySelectorAll('dialog.pd')).forEach(function(dl){
    dl.addEventListener('click',function(e){if(e.target===dl) dl.close()});
    dl.addEventListener('close',function(){
      root.classList.remove('has-dialog');
      [].slice.call(dl.querySelectorAll('video')).forEach(function(v){v.pause()});
      var wt=dl.querySelector('[data-watch]'); if(wt&&wt.watchClose) wt.watchClose();
      if(location.hash==='#'+dl.id&&history.replaceState) history.replaceState(null,'',location.pathname+location.search);
      if(last&&last.focus) last.focus();
      last=null;
    });
  });
  if(/^#p-/.test(location.hash)) openDlg(location.hash.slice(1),null);

  var rv=[].slice.call(d.querySelectorAll('[data-reveal]'));
  if(reduce||!hasIO){rv.forEach(function(e){e.classList.add('in')})}
  else{
    var ro=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');ro.unobserve(e.target)}})},{rootMargin:'0px 0px -10% 0px',threshold:.01});
    rv.forEach(function(e){ro.observe(e)});
  }
  /* reduced motion: posters only, no video is ever requested */
  if(reduce||!hasIO) return;

  /* sources are added on first view: WebM then MP4, or the mobile MP4 on narrow screens */
  function arm(v){
    if(v.dataset.armed) return; v.dataset.armed='1';
    var base=v.dataset.src;
    function add(src,type){var s=d.createElement('source');s.src=src;s.type=type;v.appendChild(s)}
    if(small){add(base+'-mobile.mp4','video/mp4')}
    else{add(base+'.webm','video/webm');add(base+'.mp4','video/mp4')}
    if(v.dataset.start){v.addEventListener('loadedmetadata',function(){try{v.currentTime=+v.dataset.start}catch(e){}},{once:true})}
    v.addEventListener('playing',function(){v.parentNode.classList.add('is-playing')});
    v.load();
  }
  function play(v){arm(v);var p=v.play();if(p&&p.catch)p.catch(function(){})}
  function wanted(v){var c=v.parentNode;return !c.parentNode.hasAttribute('data-reel')||c.classList.contains('is-active')}
  var vo=new IntersectionObserver(function(es){es.forEach(function(e){
    var v=e.target;
    if(e.isIntersecting){v.dataset.inview='1';if(wanted(v))play(v)}
    else{delete v.dataset.inview;v.pause()}
  })},{threshold:.15});
  [].slice.call(d.querySelectorAll('.clip video')).forEach(function(v){vo.observe(v)});

  /* hero reel: slow cross-fade, the slate changes with the picture */
  var reel=d.querySelector('[data-reel]');
  if(reel){
    var clips=[].slice.call(reel.querySelectorAll('.clip')), slates=[].slice.call(d.querySelectorAll('.slates .slate')), i=0;
    setInterval(function(){
      var cur=clips[i].querySelector('video');
      if(d.hidden||!cur.dataset.inview) return;
      var n=(i+1)%clips.length, nv=clips[n].querySelector('video');
      clips[n].classList.add('is-active');clips[i].classList.remove('is-active');
      if(slates[n]){slates[n].classList.add('is-active');slates[i].classList.remove('is-active')}
      play(nv);
      setTimeout(function(){if(!cur.parentNode.classList.contains('is-active'))cur.pause()},2600);
      i=n;
    },9000);
  }
})();
