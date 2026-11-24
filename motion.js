/* Motion layer for every page: page transitions, dialogs that grow from their tile, line reveals on headings,
   and a deferred loader for the WebGL hero dissolve (motion-gl.js). Self-contained: it reads the markup site.js
   already builds and adds nothing a visitor depends on. With reduced motion it does nothing at all. */
(function(){
  var d=document, w=window, root=d.documentElement;
  if(w.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var base=(d.currentScript&&d.currentScript.src||'').replace(/[^\/]*$/,'');
  function each(sel,f,ctx){[].slice.call((ctx||d).querySelectorAll(sel)).forEach(f)}
  function inView(el){if(!el)return false;var r=el.getBoundingClientRect();return r.width>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}

  /* ---- 1. page to page. The page that leaves names the clip that was clicked "stage";
     the page that arrives names its hero footage "stage" in motion.css, so one flies into the other. ---- */
  var lastLink=null;
  d.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(a)lastLink=a},true);
  var named=[];
  function clearNames(){named.forEach(function(el){el.style.viewTransitionName=''});named=[];root.classList.remove('m-out')}
  function stageFor(a){
    if(!a) return null;
    var card=a.closest('.door, .case');
    if(card){var c=card.querySelector('.door-clip .clip, .case-clip .clip');return inView(c)?c:null}
    if(a.closest('.nav')){var h=d.querySelector('.hero .reel, .hero>.clip');return inView(h)?h:null}
    return null;
  }
  w.addEventListener('pageswap',function(e){
    if(!e.viewTransition) return;
    root.classList.add('m-out');
    var act=e.activation, to=act&&act.entry&&act.entry.url||'';
    /* back and forward, or a link to a spot further down a page: a plain dissolve, nothing flies */
    if(!act||act.navigationType==='traverse'||/#/.test(to)) return;
    var el=stageFor(lastLink); if(!el) return;
    el.style.viewTransitionName='stage'; named.push(el);
  });
  /* coming back from the history cache: the page must look exactly as it was left */
  w.addEventListener('pageshow',function(e){if(e.persisted)clearNames()});

  /* ---- 4. dialogs grow out of the tile that opened them and shrink back into it (same-document view transition) ---- */
  if(d.startViewTransition){
    root.classList.add('m-vt');
    var passing=false, from=new WeakMap();
    function tileFor(b){
      if(b.classList.contains('hl-row')) return b;
      var card=b.closest('.project, .case, .scene, .plate-row');
      var c=card&&card.querySelector('.clip');
      return inView(c)?c:(inView(b)?b:null);
    }
    function run(types,update){
      var t;
      try{t=d.startViewTransition({update:update,types:types})}
      catch(x){t=d.startViewTransition(update)} /* older engines take only the callback */
      t.ready.catch(function(){});              /* a skipped transition (a double click) still runs the update */
      return t;
    }
    function name(el,n){if(el) el.style.viewTransitionName=n}
    d.addEventListener('click',function(e){
      if(passing) return;
      var b=e.target.closest&&e.target.closest('[data-open]'); if(!b) return;
      var dl=d.getElementById(b.getAttribute('data-open'));
      if(!dl||dl.open||typeof dl.showModal!=='function') return;
      e.stopImmediatePropagation(); e.preventDefault();
      var t=tileFor(b); from.set(dl,t);
      root.classList.toggle('m-row',t===b);
      name(t,'pd');
      run(['pd-open'],function(){
        name(t,''); name(dl,'pd');
        passing=true; b.click(); passing=false;   /* site.js opens the dialog, sets focus and the hash */
      }).finished.then(function(){name(dl,'')},function(){name(dl,'')});
    },true);
    function shut(dl){
      if(!dl.open) return;
      var t=from.get(dl); if(t&&!t.isConnected) t=null;
      root.classList.toggle('m-row',!!t&&!!t.matches&&t.matches('[data-open]'));
      name(dl,'pd');
      run(['pd-close'],function(){
        name(dl,''); dl.close(); name(t,'pd');      /* site.js returns focus to the opener on close */
      }).finished.then(function(){name(t,'')},function(){name(t,'')});
    }
    /* the three ways a dialog closes: its Close button, a click on the dimmed page, and Esc */
    d.addEventListener('click',function(e){
      var x=e.target.closest&&e.target.closest('dialog.pd .pd-x');
      var dl=x?x.closest('dialog'):(e.target.matches&&e.target.matches('dialog.pd')?e.target:null);
      if(!dl) return;
      e.stopImmediatePropagation(); e.preventDefault(); shut(dl);
    },true);
    d.addEventListener('cancel',function(e){
      if(e.target.matches&&e.target.matches('dialog.pd')){e.preventDefault();shut(e.target)}
    },true);
  }

  /* ---- 2. headings rise line by line. Words are wrapped so the words of one line can move together. ---- */
  var SEL='main h2.display, main h3.display, main .chapter-main h2, .contact h2';
  var trig=w.CSS&&CSS.supports&&CSS.supports('timeline-trigger:--t view()')&&CSS.supports('animation-trigger:--t play-forwards');
  var heads=[];
  function wrap(h){
    var walker=d.createTreeWalker(h,NodeFilter.SHOW_TEXT), txt=[], n;
    while((n=walker.nextNode())) if(n.nodeValue.trim()) txt.push(n);
    txt.forEach(function(t){
      var f=d.createDocumentFragment();
      t.nodeValue.split(/(\s+)/).forEach(function(s){
        if(!s) return;
        if(/^\s+$/.test(s)){f.appendChild(d.createTextNode(s));return}
        var o=d.createElement('span'), i=d.createElement('span');
        o.className='ml'; i.className='ml-i'; i.textContent=s; o.appendChild(i); f.appendChild(o);
      });
      t.parentNode.replaceChild(f,t);
    });
  }
  function number(h){
    var top=null, l=-1;
    each('.ml',function(o){var y=Math.round(o.getBoundingClientRect().top);if(top===null||y>top+4){l++;top=y}o.style.setProperty('--l',l)},h);
  }
  function arm(){
    each(SEL,function(h){
      if(h.closest('dialog')||h.classList.contains('m-lines')) return;
      if(inView(h)) return;                 /* already on screen (a deep link, a reload): leave it be */
      wrap(h); h.classList.add('m-lines'); heads.push(h); number(h);
    });
    if(!trig&&'IntersectionObserver' in w){
      var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('ml-go');io.unobserve(e.target)}})},{rootMargin:'0px 0px -12% 0px'});
      heads.forEach(function(h){io.observe(h)});
    }else if(!trig){heads.forEach(function(h){h.classList.add('ml-go')})}
  }
  var rt; w.addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(function(){heads.forEach(number)},150)});
  if(d.fonts&&d.fonts.ready) d.fonts.ready.then(function(){heads.forEach(number)});

  /* ---- 3. the WebGL dissolve for the hero clip change, fetched only once the page is idle ---- */
  function gl(){
    if(!d.querySelector('.hero [data-reel]')||!('IntersectionObserver' in w)) return;
    var c=navigator.connection, weak=(c&&c.saveData)||(navigator.deviceMemory&&navigator.deviceMemory<4)||(navigator.hardwareConcurrency&&navigator.hardwareConcurrency<4);
    if(weak) return;
    var s=d.createElement('script'); s.src=base+'motion-gl.js'; s.async=true; d.head.appendChild(s);
  }
  function idle(f){(w.requestIdleCallback||function(f){setTimeout(f,1)})(f,{timeout:3000})}

  if(d.readyState==='loading') d.addEventListener('DOMContentLoaded',arm); else arm();
  if(d.readyState==='complete') idle(gl); else w.addEventListener('load',function(){idle(gl)});
})();
