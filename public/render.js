/* ============================================================
   ESL LEARNER — shared rendering engine
   Turns a lesson object into the printable sheet, and builds
   the free local activities (word search + scramble).
   Used by lesson.html (library) and create.html (generator).

   A lesson object has this shape:
   {
     title, kicker, meta, levelTag,
     paras: ["...", "..."],            // <b> wraps vocab on first use
     vocab: [{w, p, d}],
     comprehension: ["..."],
     discussion: ["..."],
     note: ""                          // optional teacher note
   }
   ============================================================ */

/* ---------- site branding (shown on printed PDFs) ----------
   When you register your own domain, change this ONE line and every
   printed lesson updates automatically. */
var SITE_NAME = 'Teacher Lawrence';
var SITE_DOMAIN = 'teacherlawrence.com';

/* ---------- activities built locally from vocab ---------- */
function makeWordSearch(words, N){
  N = N || 12;
  const clean = words.map(w=>w.toUpperCase().replace(/[^A-Z]/g,'')).filter(w=>w.length<=N).slice(0,10);
  function attempt(size){
    const grid=Array.from({length:size},()=>Array(size).fill(null));
    const placements=[];
    const dirs=[[0,1],[1,0],[1,1],[1,-1]];
    function fits(w,r,c,dr,dc){for(let i=0;i<w.length;i++){const rr=r+dr*i,cc=c+dc*i;if(rr<0||rr>=size||cc<0||cc>=size)return false;if(grid[rr][cc]!==null&&grid[rr][cc]!==w[i])return false;}return true;}
    function place(w){for(let a=0;a<600;a++){const d=dirs[(Math.random()*dirs.length)|0];const r=(Math.random()*size)|0,c=(Math.random()*size)|0;if(fits(w,r,c,d[0],d[1])){const cells=[];for(let i=0;i<w.length;i++){const rr=r+d[0]*i,cc=c+d[1]*i;grid[rr][cc]=w[i];cells.push({r:rr,c:cc});}placements.push({word:w,cells});return true;}}return false;}
    let ok=true;[...clean].sort((a,b)=>b.length-a.length).forEach(w=>{if(!place(w))ok=false;});
    return ok?{grid,placements}:null;
  }
  let res=null, size=N;
  for(let tries=0; tries<8 && !res; tries++){ res=attempt(size); if(!res && tries===4) size=N+1; }
  if(!res){ size=N+2; while(!res){ res=attempt(size); } }
  const grid=res.grid;
  const A="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(grid[r][c]===null)grid[r][c]=A[(Math.random()*26)|0];
  return {grid, words:clean, placements:res.placements};
}
function scramble(word){
  const a=word.toUpperCase().replace(/[^A-Z]/g,'').split('');
  for(let i=a.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]];}
  const s=a.join('');
  return s===word.toUpperCase()?scramble(word):s;
}

/* ---------- render ---------- */
let keyShown=true;
function toggleKey(){keyShown=!keyShown;document.querySelectorAll('.teacher-block').forEach(el=>el.style.display=keyShown?'':'none');}

/* ---------- printable games (built from vocab) ----------
   The interactive games have paper versions too: a cut-out Memory game and
   a draw-a-line Match worksheet. `pairs` is [{word, face, pic}] where face
   is an emoji (pic:true) for flashcards or a definition (pic:false) for
   reading lessons. */
function pShuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]];} return a; }

function printMemorySection(n, pairs){
  let h = sec(n,'Memory Game','cut out &amp; match the pairs','game-sec');
  h += `<p class="game-note">✂️ Cut out the cards, turn them face down, and take turns finding the matching pairs.</p>`;
  h += `<div class="mem-cards">`;
  pairs.forEach(p=>{
    h += `<div class="mem-card mem-word">${esc(p.word)}</div>`;
    h += `<div class="mem-card ${p.pic?'mem-pic':'mem-mean'}">${p.pic?p.face:esc(p.face)}</div>`;
  });
  h += `</div></section>`;
  return h;
}
function printMatchSection(n, pairs, isPic){
  const right = pShuffle(pairs.map(p=>p.face));
  let h = sec(n,'Match', isPic?'draw a line from each word to its picture':'draw a line from each word to its meaning','game-sec');
  h += `<div class="match-print"><div class="mp-col">`;
  pairs.forEach(p=> h+=`<div class="mp-item mp-word">${esc(p.word)}<span class="mp-dot"></span></div>`);
  h += `</div><div class="mp-col">`;
  right.forEach(face=> h+=`<div class="mp-item ${isPic?'mp-pic':'mp-mean'}"><span class="mp-dot"></span>${isPic?face:esc(face)}</div>`);
  h += `</div></div></section>`;
  return h;
}

// A Comprehension or Let's Talk/Practise question entry is either a plain
// string (older lessons, or a Let's Talk question never run through
// upgrade-discussion.html) or {q, options, correct} (newer, multiple-
// choice — see api/make.js/api/generate.js). Printed as a lettered list
// of options for the choice shape, since there's nothing to hand-write;
// `plainLi` renders the older plain-string shape however the caller's
// section wants it (Comprehension leaves a blank answer line, Let's Talk
// doesn't).
function printQuestionLi(q, plainLi){
  if(q && typeof q==='object' && Array.isArray(q.options)){
    const letters = 'ABCDEFGH';
    return `<li>${esc(q.q)}<div style="margin-top:6px;">${q.options.map((opt,oi)=>
      `<span style="display:inline-block;margin:2px 14px 2px 0;">${letters[oi]||oi+1}) ${esc(opt)}</span>`).join('')}</div></li>`;
  }
  return plainLi(q);
}
function renderLesson(L, targetId){
  const ws = makeWordSearch(L.vocab.map(v=>v.w));
  const scrambleWords = L.vocab.slice(0,6);
  let h = '';
  const hero = L.image ? `<img class="lesson-hero" src="${escAttr(L.image)}" alt="${escAttr(L.imageAlt||L.title)}">` : '';
  const credit = (L.image && L.imageCredit && L.imageCredit.name)
    ? `<div class="photo-credit">Photo: ${esc(L.imageCredit.name)} / Unsplash</div>` : '';
  h += hero + `<div class="masthead">
    <div class="brand-band"><span class="bb-name">${esc(SITE_NAME)}</span><span class="bb-url">${esc(SITE_DOMAIN)}</span></div>
    <div class="kicker">${esc(L.kicker)}</div>
    <h1>${esc(L.title)}</h1>
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:var(--muted);margin-bottom:8px;">${esc(L.meta)}</div>
    <span class="level-tag">${esc(L.levelTag)}</span>${credit}
  </div><div class="body">`;

  // vocab (with Listen button that reads each word AND its meaning) — taught before the reading
  const vocabText = L.vocab.map(v=>`${v.w}. ${v.d}.`).join(' ');
  h += sec(1,'Key Vocabulary','words from the text')+`<div class="vocab">`;
  h += `<button class="listen-btn" data-speak="${escAttr(vocabText)}" onclick="speak(this)">🔊 Listen to the words &amp; meanings</button>`;
  L.vocab.forEach(v=> h+=`<div><strong>${esc(v.w)}</strong> — ${esc(v.d)}</div>`);
  h += `</div></section>`;

  // article (with Listen button)
  const articleText = stripTags(L.paras.join(' '));
  h += sec(2,'Read the Article','~'+wordCount(L.paras)+' words','sec-article')+`<div class="article">`;
  h += `<button class="listen-btn" data-speak="${escAttr(articleText)}" onclick="speak(this)">🔊 Listen</button>`;
  L.paras.forEach((p,i)=> h += `<p${i===0?' class="lead"':''}>${p}</p>`);
  h += `</div></section>`;

  // comprehension — either a plain string (write a full-sentence answer on
  // the blank line below) or {q, options, correct} for newer multiple-
  // choice lessons (see api/make.js / api/generate.js), printed as a
  // lettered list instead of a blank line since there's nothing to write.
  h += sec(3,'Comprehension','full sentences')+`<ol class="q">`;
  L.comprehension.forEach(q=> h += printQuestionLi(q, q=>
    `<li>${esc(q)}<span style="display:block;height:20px;border-bottom:1px solid var(--rule);margin-top:8px;"></span></li>`));
  h += `</ol></section>`;

  // word search
  h += sec(4,'Word Search','find the words')+`<div class="ws-wrap"><table class="ws">`;
  ws.grid.forEach(row=>{h+='<tr>';row.forEach(ch=>h+=`<td>${ch}</td>`);h+='</tr>';});
  h += `</table><div class="ws-words"><h3>Find these</h3><ul>`;
  ws.words.forEach(w=>h+=`<li>${w}</li>`); h+=`</ul></div></div></section>`;

  // scramble
  h += sec(5,'Word Scramble','unscramble the words')+`<ol class="q scramble">`;
  scrambleWords.forEach(v=> h+=`<li><span class="scrambled">${scramble(v.w)}</span><span class="ans-line"></span></li>`);
  h += `</ol></section>`;

  // 6 & 7 — printable games (cut-out memory + draw-a-line match), built
  // from the vocab. Reading lessons have no pictures, so pairs match each
  // word to its meaning.
  const gamePairs = L.vocab.slice(0,8).map(v=>({word:v.w, face:v.d, pic:false}));
  if(gamePairs.length>=2){
    h += printMemorySection(6, gamePairs);
    h += printMatchSection(7, gamePairs, false);
  }

  // discussion
  h += sec(8,"Let's Talk",'pairs or groups')+`<ol class="q discuss">`;
  L.discussion.forEach(q=> h += printQuestionLi(q, q=>`<li>${esc(q)}</li>`));
  h += `</ol></section>`;

  // answer key + teacher (hideable)
  h += `<section id="answerkey" class="teacher-block"><div class="teacher"><h3>Answer Key</h3>`;
  h += `<p><b>Scramble:</b> ${scrambleWords.map(v=>v.w).join(', ')}</p>`;
  h += `<p><b>Word search:</b> all ${ws.words.length} words placed in the grid (horizontal, vertical, diagonal).</p>`;
  if(L.compAnswers && L.compAnswers.length){
    h += `<p><b>Comprehension (sample answers):</b></p><ol style="margin:4px 0 4px 18px;">`;
    L.compAnswers.forEach(a=> h+=`<li style="margin-bottom:4px;">${esc(a)}</li>`);
    h += `</ol>`;
  }
  h += `<p><b>Discussion:</b> answers will vary; accept any answer supported by the text.</p></div></section>`;
  h += `<section class="teacher-block"><div class="teacher"><h3>Teacher's Notes</h3>
    <p><b>Warm-up:</b> Ask what students already know about the topic. Pre-teach 2–3 vocabulary words.</p>
    <p><b>Reading:</b> Silent read, then pair-read aloud.</p>
    <p><b>Activities:</b> Vocabulary → comprehension → word search/scramble → discussion.</p>
    ${L.note?`<p style="color:var(--muted)">${esc(L.note)}</p>`:''}</div></section>`;

  h += `</div>`;
  document.getElementById(targetId||'sheet').innerHTML = h;

  // small site URL that repeats on every printed page (advertising)
  let pf=document.getElementById('printFooter');
  if(!pf){ pf=document.createElement('div'); pf.id='printFooter'; pf.className='print-footer'; document.body.appendChild(pf); }
  pf.textContent = SITE_NAME + ' · ' + SITE_DOMAIN;

  keyShown=true;
}
/* ---------- printable sheet for BEGINNER flashcard lessons ---------- */
function renderFlashcardLesson(L, targetId){
  const cards = L.cards || [];
  let h = '';
  const hero = L.image ? `<img class="lesson-hero" src="${escAttr(L.image)}" alt="${escAttr(L.imageAlt||L.title)}">` : '';
  h += hero + `<div class="masthead">
    <div class="brand-band"><span class="bb-name">${esc(SITE_NAME)}</span><span class="bb-url">${esc(SITE_DOMAIN)}</span></div>
    <div class="kicker">${esc(L.kicker)}</div>
    <h1>${esc(L.title)}</h1>
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:var(--muted);margin-bottom:8px;">${esc(L.meta)}</div>
    <span class="level-tag">${esc(L.levelTag)}</span>
  </div><div class="body">`;

  // 1 — new words (picture + word grid)
  h += sec(1,'New Words','say each word')+`<div class="fc-print-grid">`;
  cards.forEach(c=> h+=`<div class="fc-print"><div class="fc-print-emoji">${c.emoji||''}</div><div class="fc-print-word">${c.letter?`<b>${esc(c.letter)} ${esc(c.letter.toLowerCase())}</b> · `:''}${esc(c.word)}</div></div>`);
  h += `</div></section>`;

  // 2 — read together (picture sentences)
  let n=2;
  if(L.read && L.read.length){
    h += sec(n++,'Read Together','read each sentence')+`<div class="fc-read">`;
    L.read.forEach(s=> h+=`<div class="fc-read-row">${s.html}</div>`);
    h += `</div></section>`;
  }

  // trace / write the words
  h += sec(n++,'Write the Words','copy each word on the line')+`<div class="fc-write">`;
  cards.forEach(c=> h+=`<div class="fc-write-row"><span class="fc-write-emoji">${c.emoji||''}</span><span class="fc-write-word">${esc(c.word)}</span><span class="fc-write-line"></span></div>`);
  h += `</div></section>`;

  // let's talk / practise
  if(L.practise && L.practise.length){
    h += sec(n++,"Let's Practise",'say it out loud')+`<ol class="q discuss">`;
    L.practise.forEach(q=> h += printQuestionLi(q, q=>`<li>${esc(q)}</li>`));
    h += `</ol></section>`;
  }

  // printable games — cut-out Memory cards + draw-a-line Match, built from
  // the picture cards (word ↔ picture).
  const fcPairs = cards.filter(c=>c.emoji).map(c=>({word:c.word, face:c.emoji, pic:true})).slice(0,10);
  if(fcPairs.length>=2){
    h += printMemorySection(n++, fcPairs);
    h += printMatchSection(n++, fcPairs, true);
  }

  // teacher notes
  h += `<section class="teacher-block"><div class="teacher"><h3>Teacher's Notes</h3>
    <p><b>Warm-up:</b> Show each picture and say the word. Ask the class to repeat.</p>
    <p><b>Practice:</b> Point to pictures at random and ask "What is this?"</p>
    <p><b>Game:</b> Say a word and have students point to (or hold up) the matching picture.</p></div></section>`;

  h += `</div>`;
  document.getElementById(targetId||'sheet').innerHTML = h;

  let pf=document.getElementById('printFooter');
  if(!pf){ pf=document.createElement('div'); pf.id='printFooter'; pf.className='print-footer'; document.body.appendChild(pf); }
  pf.textContent = SITE_NAME + ' · ' + SITE_DOMAIN;
  keyShown=true;
}

function sec(n,title,hint,cls){return `<section class="${cls||''}"><div class="ex-head"><span class="ex-num">${n}</span><h2>${title}</h2><span style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:var(--muted);font-style:italic;margin-left:auto;">${hint}</span></div>`;}
function wordCount(paras){return paras.join(' ').replace(/<[^>]+>/g,'').split(/\s+/).length;}
function stripTags(s){return (s||'').replace(/<[^>]+>/g,'');}
function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escAttr(s){return esc(s).replace(/"/g,'&quot;');}
// strips a part-of-speech tag like " (n)." or " (adj)" that occasionally
// gets baked into generated article prose by mistake (it belongs only in
// the vocab list's own `p` field, never in a sentence) — see CLAUDE.md.
function stripStrayPosTag(s){return (s||'').replace(/\s*\([a-z]{1,6}\.?\)(?=[.!?]?\s*$)/i,'');}

/* ---------- read aloud: play / pause (free, built-in browser voice) ----------
   One button toggles play <-> pause and RESUMES from where it paused
   (great for listen-and-repeat). The text is read sentence by sentence,
   which keeps Chrome reliable and makes pauses land between sentences.
   Clicking a different Listen button stops the first and starts fresh. */
var SPK = { btn:null, queue:[], idx:0, status:'idle', watchdog:null, curU:null, boundaries:[], pauseRemainder:null };  // status: idle | playing | paused

// choose the right label/icon for a button in a given state
function spkLabel(btn, state){
  const iconOnly = btn.classList.contains('play-btn') || btn.classList.contains('word-play');
  if(state==='pause')  return iconOnly ? '⏸' : '⏸ Pause';
  if(state==='resume') return iconOnly ? '▶' : '▶ Resume';
  return btn.dataset.idleLabel || (iconOnly ? '▶' : '🔊 Listen');
}
// update the progress bar (if the active player has one on screen)
function speakProgress(){
  const fill = document.getElementById('speakFill');
  const time = document.getElementById('speakTime');
  const len = SPK.queue.length;
  const pct = len ? Math.min(100, Math.round((SPK.idx/len)*100)) : 0;
  if(fill) fill.style.width = pct + '%';
  if(time) time.textContent = len ? (Math.min(SPK.idx+1,len) + ' / ' + len) : '';
}
function speakReset(){
  if(SPK.watchdog){ clearTimeout(SPK.watchdog); }
  if('speechSynthesis' in window) window.speechSynthesis.cancel();
  if(SPK.btn){ SPK.btn.classList.remove('on','paused'); SPK.btn.innerHTML = spkLabel(SPK.btn,'idle'); }
  SPK = { btn:null, queue:[], idx:0, status:'idle', watchdog:null, curU:null, boundaries:[], pauseRemainder:null };
  const fill=document.getElementById('speakFill'); if(fill) fill.style.width='0%';
  const time=document.getElementById('speakTime'); if(time) time.textContent='';
}
function speakSentences(t){ return (t.match(/[^.!?]+[.!?]*\s*/g) || [t]).map(s=>s.trim()).filter(Boolean); }
// Speaks one utterance (a full sentence, or — via speak()'s resume path — the
// tail of one left over from a pause) and wires up the shared onend/watchdog
// recovery. `onSentenceDone` runs once this utterance's *sentence slot* is
// fully spoken (whether that took one utterance or several resumed pieces).
function speakUtterance(text, onSentenceDone){
  const u = new SpeechSynthesisUtterance(text);
  u.lang='en-US'; u.rate=0.95; u.pitch=1;
  SPK.curU = u;
  SPK.boundaries = [];
  // Word-boundary positions (chars into THIS utterance's own text) — lets a
  // pause mid-sentence resume from near where it stopped instead of always
  // restarting the whole sentence. Not universally supported (notably spotty
  // on iOS Safari); when it never fires, pauseRemainder just stays null and
  // resume falls back to the old re-read-the-sentence behavior below.
  u.onboundary = (e)=>{ if(typeof e.charIndex === 'number') SPK.boundaries.push(e.charIndex); };
  // advance() is shared by onend/onerror and the watchdog below. Guarding on
  // SPK.curU===u (not just SPK.status) makes it safe even after the user has
  // since paused, reset, or switched to a different Listen button — a stale
  // callback for an abandoned utterance can no longer touch the new session.
  const advance = ()=>{
    if(SPK.curU !== u) return;
    if(SPK.watchdog){ clearTimeout(SPK.watchdog); SPK.watchdog = null; }
    if(SPK.status==='playing') onSentenceDone();
  };
  u.onend = advance;
  u.onerror = advance;
  // Watchdog: speechSynthesis is known to silently stop firing onend/onerror
  // (tab backgrounded, phone screen locked, OS audio-focus loss) while
  // .speaking stays stuck true — that used to leave the play button frozen
  // (progress bar stuck, unresponsive to clicks) until the page was reloaded.
  // If neither event fires within a generous margin over the sentence's
  // expected speaking time, force the same recovery path onerror takes.
  SPK.watchdog = setTimeout(()=>{
    if(SPK.curU !== u || SPK.status !== 'playing') return;
    if('speechSynthesis' in window) window.speechSynthesis.cancel();
    advance();
  }, Math.max(5000, Math.min(30000, text.length * 130)));
  window.speechSynthesis.speak(u);
}
function speakNext(){
  if(SPK.idx >= SPK.queue.length){ speakReset(); return; }
  speakProgress();
  const text = SPK.queue[SPK.idx];
  speakUtterance(text, ()=>{ SPK.idx++; speakNext(); });
}
function speak(btn){
  if(!('speechSynthesis' in window)){ alert('Sorry, your browser does not support read-aloud.'); return; }
  // Clicking the SAME active button toggles pause / resume.
  // NOTE: Chrome's speechSynthesis.pause()/resume() is unreliable (often
  // refuses to resume), so instead we stop and re-speak. Where onboundary
  // gave us word positions for the piece that was playing, resume picks up
  // from one word back (a little context, not the mid-word cliff-edge the
  // pause landed on) instead of the whole sentence — better for listen-and-
  // repeat, where hearing the sentence over again each pause defeats the
  // point. Falls back to re-reading the whole sentence when boundaries
  // aren't available (e.g. iOS Safari, which doesn't reliably fire them).
  if(SPK.btn === btn && SPK.status !== 'idle'){
    if(SPK.status === 'playing'){
      SPK.status='paused';
      if(SPK.watchdog){ clearTimeout(SPK.watchdog); SPK.watchdog = null; }
      const spoken = SPK.curU ? SPK.curU.text : '';
      const b = SPK.boundaries;
      const resumeAt = b.length >= 2 ? b[b.length-2] : (b.length === 1 ? b[0] : 0);
      SPK.pauseRemainder = (resumeAt > 0 && resumeAt < spoken.length) ? spoken.slice(resumeAt).trim() : null;
      window.speechSynthesis.cancel();   // onend won't advance (status is 'paused')
      btn.classList.add('paused'); btn.innerHTML=spkLabel(btn,'resume');
    } else {
      SPK.status='playing';
      btn.classList.remove('paused'); btn.innerHTML=spkLabel(btn,'pause');
      if(SPK.pauseRemainder){
        const remainder = SPK.pauseRemainder;
        SPK.pauseRemainder = null;
        speakUtterance(remainder, ()=>{ SPK.idx++; speakNext(); });
      } else {
        speakNext();                     // no boundary data — re-read from the current sentence
      }
    }
    return;
  }
  // Otherwise stop anything else and start this one fresh.
  speakReset();
  if(!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.innerHTML;
  SPK.btn = btn;
  SPK.queue = speakSentences(btn.getAttribute('data-speak') || '');
  SPK.idx = 0; SPK.status = 'playing';
  btn.classList.add('on'); btn.innerHTML = spkLabel(btn,'pause');
  speakNext();
}
// stop reading if the user leaves the page
window.addEventListener('beforeunload', speakReset);
// ...or if the tab is backgrounded / phone screen locks mid-playback:
// speechSynthesis is known to silently hang in that situation (no
// onend/onerror ever fires, .speaking stays stuck true) — reset cleanly
// instead of leaving the button/progress bar frozen. This also unblocks
// lesson.html's createSessionRecorder() TTS watch, which polls .speaking
// to resume the mic after the article finishes playing — cancel() (inside
// speakReset) reliably flips that back to false.
document.addEventListener('visibilitychange', () => {
  if(document.hidden && SPK.status !== 'idle') speakReset();
});
window.addEventListener('pagehide', speakReset);
