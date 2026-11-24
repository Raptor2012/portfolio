/* The hero clip change as an ink dissolve: the next clip seeps through the current one along a soft noise front.
   Raw WebGL, no library. Loaded by motion.js after the page is idle. It watches the reel that site.js drives and,
   when a new clip becomes active, draws both clips (live video frames, or the poster if the video has not started)
   into one canvas over the reel for 2 s, then gets out of the way. Any failure falls back to the CSS crossfade. */
(function(){
  var d=document, reel=d.querySelector('.hero [data-reel]');
  if(!reel||reel.querySelector('.m-gl')) return;
  var clips=[].slice.call(reel.querySelectorAll('.clip'));
  if(clips.length<2) return;
  var cv=d.createElement('canvas'); cv.className='m-gl'; cv.setAttribute('aria-hidden','true');
  var gl=cv.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
  if(!gl) return;

  var VS='attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}';
  var FS=[
    'precision mediump float;varying vec2 v;',
    'uniform sampler2D A,B;uniform vec4 MA,MB;uniform vec2 S;uniform float P,R;',
    'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float n(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),u.x),mix(h(i+vec2(0.,1.)),h(i+1.),u.x),u.y);}',
    'float fb(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n(p);p=p*2.03+17.1;a*=.5;}return s;}',
    /* cover or contain mapping per clip, like object-fit with the clip's object-position */
    'vec3 tx(sampler2D t,vec4 m,vec2 u){vec2 q=u*m.xy+m.zw;float k=step(0.,q.x)*step(q.x,1.)*step(0.,q.y)*step(q.y,1.);return texture2D(t,clamp(q,0.,1.)).rgb*k;}',
    'void main(){',
    ' vec2 p=vec2(v.x*R,v.y);',
    ' float g=fb(p*1.8+S+fb(p*1.1+S.yx)*1.4);',          /* domain-warped noise: ink tendrils, not blotches */
    ' g=clamp((g-.28)/.44,0.,1.)*.78+(1.-v.x)*.14+v.y*.08;', /* spread the noise over 0..1, with a slight drift from right to left */
    ' float e=.07,t=P*(1.+2.*e)-e;',
    ' float m=smoothstep(t-e,t+e,g);',                       /* 1 = still the old clip, 0 = the new one */
    ' float b=1.-abs(m*2.-1.);',                            /* the front itself */
    ' vec2 o=(vec2(fb(p*5.+S),fb(p*5.+S+4.3))-.5)*.025*b;', /* the picture bends a little where the ink is moving */
    ' vec3 c=mix(tx(B,MB,v-o),tx(A,MA,v+o),m);',
    ' c*=1.-b*.28;',                                         /* the front reads as wet ink: a touch darker, never brighter */
    ' gl_FragColor=vec4(c,1.);',
    '}'].join('\n');
  function sh(t,s){var o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(o));return o}
  var pr;
  try{pr=gl.createProgram();gl.attachShader(pr,sh(gl.VERTEX_SHADER,VS));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,FS));gl.linkProgram(pr);
    if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw new Error('link')}catch(x){return}
  gl.useProgram(pr);
  var buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  var la=gl.getAttribLocation(pr,'a');gl.enableVertexAttribArray(la);gl.vertexAttribPointer(la,2,gl.FLOAT,false,0,0);
  var U={};['A','B','MA','MB','S','P','R'].forEach(function(k){U[k]=gl.getUniformLocation(pr,k)});
  gl.uniform1i(U.A,0);gl.uniform1i(U.B,1);
  function mk(){var t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t}
  var TA=mk(), TB=mk();

  /* what a clip shows right now: its video once it plays, its poster before that */
  function src(c){
    var v=c.querySelector('video'), i=c.querySelector('img');
    if(v&&c.classList.contains('is-playing')&&v.readyState>=2&&v.videoWidth) return v;
    return i&&i.complete&&i.naturalWidth?i:null;
  }
  function pos(c){
    var p=(getComputedStyle(c).getPropertyValue('--pos')||'50% 50%').trim().split(/\s+/);
    return [parseFloat(p[0])/100||0, parseFloat(p[1]==null?p[0]:p[1])/100||0];
  }
  function map(c,s,W,H){
    var sw=s.videoWidth||s.naturalWidth, shh=s.videoHeight||s.naturalHeight;
    var full=c.classList.contains('full'), k=full?Math.min(W/sw,H/shh):Math.max(W/sw,H/shh);
    var dw=sw*k, dh=shh*k, p=full?[.5,.5]:pos(c), ox=(W-dw)*p[0], oy=(H-dh)*p[1];
    return [W/dw,H/dh,-ox/dw,-oy/dh];
  }
  function up(unit,tex,s){gl.activeTexture(unit);gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,s)}

  function size(){
    var r=reel.getBoundingClientRect(), W=Math.max(2,Math.min(1920,Math.round(r.width*Math.min(window.devicePixelRatio||1,1.5))));
    var H=Math.max(2,Math.round(r.height*W/Math.max(1,r.width)));
    if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}
    gl.viewport(0,0,W,H);
  }

  var DUR=2000, run=null;
  function ease(t){return .5-Math.cos(Math.PI*t)/2}
  function frame(now){
    if(!run) return;
    var t=Math.min(1,(now-run.t0)/DUR);
    try{
      var sa=src(run.a)||run.sa, sb=src(run.b)||run.sb;
      if(sa){up(gl.TEXTURE0,TA,sa);gl.uniform4fv(U.MA,map(run.a,sa,cv.width,cv.height));run.sa=sa}
      if(sb){up(gl.TEXTURE1,TB,sb);gl.uniform4fv(U.MB,map(run.b,sb,cv.width,cv.height));run.sb=sb}
    }catch(x){return fail()}   /* a tainted frame (e.g. a page opened from disk) */
    gl.uniform1f(U.P,ease(t));
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    if(t<1) requestAnimationFrame(frame);
    else{run=null;cv.classList.remove('is-on')}
  }
  function fail(){run=null;cv.classList.remove('is-on');reel.classList.remove('m-gl-on');mo.disconnect()}

  var act=clips.filter(function(c){return c.classList.contains('is-active')})[0]||clips[0];
  /* site.js flips "is-active" from one clip to the next; this runs before the browser paints that change */
  var mo=new MutationObserver(function(){
    var now=clips.filter(function(c){return c.classList.contains('is-active')})[0];
    if(!now||now===act) return;
    var prev=act; act=now;
    var sa=src(prev), sb=src(now);
    if(!sa||!sb){reel.classList.remove('m-gl-on');return}    /* nothing to draw yet: the CSS crossfade takes this one */
    reel.classList.add('m-gl-on');
    size();
    gl.uniform2f(U.S,Math.random()*40,Math.random()*40);
    gl.uniform1f(U.R,cv.width/cv.height);
    run={a:prev,b:now,sa:sa,sb:sb,t0:performance.now()};
    cv.classList.add('is-on');
    frame(run.t0);
  });
  try{
    /* prove a frame can be read before taking over (file: pages taint video frames) */
    var probe=src(act); if(probe) up(gl.TEXTURE0,TA,probe);
    if(gl.getError()!==gl.NO_ERROR) return;
  }catch(x){return}
  reel.appendChild(cv);
  reel.classList.add('m-gl-on');
  mo.observe(reel,{subtree:true,attributes:true,attributeFilter:['class']});
})();
