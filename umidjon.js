(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  // make canvas full width of container with devicePixelRatio scaling
  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * devicePixelRatio);
    canvas.height = Math.floor(rect.height * devicePixelRatio);
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  }
  window.addEventListener('resize', resize);
  resize();

  // UI refs
  const overlay = document.getElementById('overlay');
  const overlayBig = document.getElementById('overlay-big');
  const overlaySmall = document.getElementById('overlay-small');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const restartBtn = document.getElementById('restartBtn');
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const levelEl = document.getElementById('level');
  const highEl = document.getElementById('high');
  const soundBtn = document.getElementById('soundBtn');
  const leftTouch = document.getElementById('leftTouch');
  const rightTouch = document.getElementById('rightTouch');
  const shootTouch = document.getElementById('shootTouch');
  const touchControls = document.getElementById('touchControls');

  let width = () => canvas.width / devicePixelRatio;
  let height = () => canvas.height / devicePixelRatio;

  // Game state
  let running = false;
  let paused = false;
  let lastTime = 0;
  let dt = 0;
  let score = 0;
  let lives = 3;
  let level = 1;
  let high = Number(localStorage.getItem('star-high') || 0);
  highEl.textContent = high;
  let soundOn = true;

  // objects
  const player = { x: 0.5, y: 0.88, w: 48, h: 36, speed: 600, vx:0 };
  let stars = [];
  let meteors = [];
  let particles = [];
  let spawnTimer = 0;
  let spawnRate = 1.2; // seconds
  let difficultyTimer = 0;

  // input
  const keys = {};
  window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; e.key===' '&&e.preventDefault(); });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  // touch
  leftTouch && leftTouch.addEventListener('touchstart', e => { e.preventDefault(); keys['arrowleft']=true; });
  leftTouch && leftTouch.addEventListener('touchend', e => { e.preventDefault(); keys['arrowleft']=false; });
  rightTouch && rightTouch.addEventListener('touchstart', e => { e.preventDefault(); keys['arrowright']=true; });
  rightTouch && rightTouch.addEventListener('touchend', e => { e.preventDefault(); keys['arrowright']=false; });
  shootTouch && shootTouch.addEventListener('click', () => { /* future action */ });

  // sound (simple beep using WebAudio)
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = AudioCtx ? new AudioCtx() : null;
  function beep(freq=440, time=0.08, type='sine', vol=0.08) {
    if(!audioCtx || !soundOn) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + time);
  }

  // helpers
  function rand(a,b){ return Math.random()*(b-a)+a }
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)) }
  function px(x){ return x * (width()) } // normalized to pixel
  // spawn objects in normalized coords
  function spawnStar() {
    stars.push({
      x: Math.random(), y: -0.06,
      r: rand(8,14), vy: rand(90,160) + level*10,
      wob: rand(0.9,1.4), angle: Math.random()*Math.PI*2,
    });
  }
  function spawnMeteor(){
    meteors.push({
      x: Math.random(), y: -0.12,
      r: rand(18,36), vy: rand(160,260) + level*20,
      rot: rand(-1.5,1.5)
    });
  }

  // game reset
  function reset() {
    score = 0; lives = 3; level = 1;
    stars = []; meteors = []; particles = [];
    spawnRate = 1.2; difficultyTimer = 0;
    overlayBig.textContent = 'PRESS START';
    overlaySmall.textContent = 'Use ← → or A D keys';
    scoreEl.textContent = 0; livesEl.textContent = 3; levelEl.textContent = 1;
    running=false; paused=false;
  }
  reset();

  // start/pause/restart UI
  startBtn.addEventListener('click', startGame);
  pauseBtn.addEventListener('click', togglePause);
  restartBtn.addEventListener('click', ()=>{ reset(); startGame(); });

  soundBtn.addEventListener('click', ()=>{
    soundOn = !soundOn; soundBtn.textContent = `Sound: ${soundOn? 'On':'Off'}`;
    if(soundOn && audioCtx && audioCtx.state==='suspended') audioCtx.resume();
  });

  function startGame(){
    if(running) return;
    running = true; paused=false; spawnTimer=0; lastTime = performance.now();
    overlay.style.display='none';
    requestAnimationFrame(loop);
    beep(660,0.05,'square',0.06);
  }
  function togglePause(){
    if(!running) return;
    paused = !paused;
    overlay.style.display = paused? 'block':'none';
    overlayBig.textContent = paused? 'PAUSED':'';
    if(!paused) lastTime = performance.now();
  }

  // collision: simple circle vs rect approx
  function hitTest(obj){
    const pxp = player.x * width();
    const pyp = player.y * height();
    const hw = player.w*0.5, hh = player.h*0.5;
    // test circle rect
    const cx = obj.x * width(), cy = obj.y * height();
    const distX = Math.abs(cx - pxp);
    const distY = Math.abs(cy - pyp);
    if(distX > (hw + obj.r)) return false;
    if(distY > (hh + obj.r)) return false;
    if(distX <= hw || distY <= hh) return true;
    const dx = distX - hw, dy = distY - hh;
    return (dx*dx + dy*dy) <= (obj.r * obj.r);
  }

  // particle spark when collect
  function makeSpark(x,y){
    const el = document.createElement('div');
    el.className='spark';
    el.style.left = x + 'px'; el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(()=> el.remove(), 700);
  }

  // main loop
  function loop(now){
    if(!running) return;
    dt = (now - lastTime)/1000; lastTime = now;
    if(paused) { requestAnimationFrame(loop); return; }

    // update difficulty over time
    difficultyTimer += dt;
    if(difficultyTimer > 12) { difficultyTimer = 0; level++; levelEl.textContent = level; spawnRate = Math.max(0.45, spawnRate - 0.12); }

    // spawn logic
    spawnTimer += dt;
    if(spawnTimer >= spawnRate){
      spawnTimer = 0;
      // sometimes meteor, else star
      if(Math.random() < 0.25 + level*0.03) spawnMeteor(); else spawnStar();
    }

    // update player movement from keys
    const left = keys['arrowleft'] || keys['a'];
    const right= keys['arrowright'] || keys['d'];
    player.vx = 0;
    if(left) player.vx = -player.speed;
    if(right) player.vx = player.speed;
    // integrate
    player.x += (player.vx * dt) / width();
    player.x = clamp(player.x, 0.05, 0.95);

    // update stars
    for(let i=stars.length-1;i>=0;i--){
      const s = stars[i];
      s.y += (s.vy * dt) / height();
      s.angle += 3*dt;
      if(s.y > 1.2) stars.splice(i,1);
      else if(hitTest(s)){
        // collect
        score += 10;
        scoreEl.textContent = score;
        beep(880,0.04,'sine',0.06);
        makeSpark((s.x*width()),(s.y*height()));
        stars.splice(i,1);
        if(score > high){ high = score; localStorage.setItem('star-high', high); highEl.textContent = high; }
      }
    }
    // update meteors
    for(let i=meteors.length-1;i>=0;i--){
      const m = meteors[i];
      m.y += (m.vy * dt) / height();
      m.rot += dt;
      if(m.y > 1.4) meteors.splice(i,1);
      else if(hitTest(m)){
        // hit
        beep(120,0.12,'sawtooth',0.08);
        meteors.splice(i,1);
        lives--; livesEl.textContent = lives;
        overlay.style.display='block';
        overlayBig.textContent = 'OOP! HIT!';
        overlaySmall.textContent = 'Press Restart or Start to continue';
        running=false;
        if(lives <= 0){
          overlayBig.textContent = 'GAME OVER';
          overlaySmall.textContent = `Final score: ${score}`;
          if(score>high){ localStorage.setItem('star-high', score); high=score; highEl.textContent = high; }
        } else {
          // short pause
        }
      }
    }

    // clear canvas
    ctx.clearRect(0,0,width(),height());

    // draw background stars (parallax)
    for(let i=0;i<60;i++){
      ctx.fillStyle = i%7===0? 'rgba(255,255,255,0.06)':'rgba(255,255,255,0.02)';
      const x = (i*73.7 + now*0.02) % width();
      const y = (i*41.3) % height();
      ctx.fillRect(x, y, 1, 1);
    }

    // draw player (simple ship)
    const shipX = player.x * width(), shipY = player.y * height();
    ctx.save();
    ctx.translate(shipX, shipY);
    // ship body
    ctx.beginPath();
    ctx.moveTo(0, -player.h/2);
    ctx.lineTo(player.w/2, player.h/2);
    ctx.lineTo(-player.w/2, player.h/2);
    ctx.closePath();
    ctx.fillStyle = '#06d6a0';
    ctx.fill();
    // cockpit
    ctx.beginPath();
    ctx.arc(0, -2, 6, 0, Math.PI*2);
    ctx.fillStyle = '#072a2a';
    ctx.fill();
    ctx.restore();

    // draw stars
    for(const s of stars){
      ctx.save();
      ctx.translate(s.x * width(), s.y * height());
      ctx.rotate(s.angle);
      ctx.fillStyle = 'yellow';
      ctx.beginPath();
      for(let k=0;k<5;k++){
        ctx.lineTo( Math.cos(k* (Math.PI*2)/5 ) * s.r*0.5, Math.sin(k*(Math.PI*2)/5) * s.r*0.5 );
        ctx.lineTo( Math.cos((k+0.5)*(Math.PI*2)/5) * s.r, Math.sin((k+0.5)*(Math.PI*2)/5) * s.r );
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // draw meteors
    for(const m of meteors){
      ctx.save();
      ctx.translate(m.x*width(), m.y*height());
      ctx.rotate(m.rot);
      ctx.fillStyle = '#ff8b8b';
      ctx.beginPath();
      ctx.arc(0,0,m.r*0.8,0,Math.PI*2);
      ctx.fill();
      // tail
      ctx.fillStyle = 'rgba(255,140,140,0.3)';
      ctx.fillRect(-m.r*2, -m.r*0.3, m.r*2, m.r*0.6);
      ctx.restore();
    }

    // HUD small (score top-left)
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(8,8,120,28);
    ctx.fillStyle = '#fff';
    ctx.font = '14px Inter, Arial';
    ctx.fillText('Score: ' + score, 14, 28);

    requestAnimationFrame(loop);
  } // end loop

  // initial overlay highscore display
  overlayBig.textContent = 'STAR DODGER';
  overlaySmall.textContent = 'Press START to play';
  scoreEl.textContent = score; livesEl.textContent = lives; levelEl.textContent = level;

  // responsive resize: update player size
  function adaptPlayer(){
    player.w = Math.round(width()*0.08);
    player.h = Math.round(player.w*0.7);
  }
  adaptPlayer();
  window.addEventListener('resize', adaptPlayer);

  // expose restart from overlay when clicking overlay while dead/resumed
  overlay.addEventListener('click', () => {
    if(!running){ reset(); startGame(); overlay.style.display='none'; }
  });

  // keyboard convenience for start
  window.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ startGame(); overlay.style.display='none'; }
  });

})();