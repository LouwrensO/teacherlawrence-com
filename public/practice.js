// practice.js — shared logic for "Practice Speaking" mode:
//   1. building a word-by-word / line-by-line / question-by-question
//      practice queue out of a lesson's existing data
//   2. a local daily practice-time log (minutes per day), used to show a
//      streak/calendar — no server, no accounts required, matches the
//      "5 minutes a day" habit-building goal without any privacy cost
//
// IMPORTANT: raw audio from the microphone in Practice Speaking mode is
// never uploaded or stored anywhere. TIME SPENT practicing is always
// logged (as a date + seconds). If a student turns on the optional
// whole-session Record button (soloRecorder/articleRecorder in
// lesson.html), the browser's own speech-to-text TRANSCRIPT — text only,
// never audio — is sent to /api/speak-chat for one overall score.

function dlStripTags(s){ return (s||'').replace(/<[^>]+>/g,''); }
function dlSentences(t){ return (t.match(/[^.!?]+[.!?]*\s*/g) || [t]).map(s=>s.trim()).filter(Boolean); }

/* build the practice queue: vocab words, then reading sentences, then
   comprehension questions — matches the site's existing task order.
   Beginner "flashcard" lessons use a different data shape (cards/read/
   practise instead of vocab/paras/comprehension), so both are handled. */
function dlBuildPracticeQueue(L, T){
  const items = [];
  if(L.type==='flashcards'){
    (L.cards||[]).forEach(c => items.push({ type:'word', text:(c.letter?c.letter+'. ':'')+capFirst(c.word), emoji:c.emoji||'', ko:c.ko||'' }));
    (L.read||[]).forEach(s => items.push({ type:'line', text: s.say || dlStripTags(s.html||''), html: s.html||'', ko:s.ko||'' }));
    // practise entries are either a plain string (older lessons) or
    // {q, options, correct} (upgraded via upgrade-discussion.html) —
    // Practice Speaking just reads the question text either way.
    (L.practise||[]).forEach(q => items.push({ type:'question', text: (q && typeof q==='object') ? q.q : q }));
  } else {
    (L.vocab||[]).forEach((v,i) => {
      const trEntry = T&&T.vocab&&T.vocab[i];
      const ko = (typeof trEntry==='string' ? trEntry : (trEntry&&trEntry.d)) || '';
      items.push({ type:'word', text:capFirst(v.w), sub:v.d, emoji:v.emoji||'', ko: ko });
    });
    (L.paras||[]).forEach((p,pi) => {
      const trPara = T&&T.paras&&T.paras[pi];
      dlSentences(dlStripTags(p)).forEach((s,si) => items.push({ type:'line', text:stripStrayPosTag(s), ko: (trPara&&trPara[si]&&trPara[si].ko)||'' }));
    });
    // comprehension entries are either a plain string (older lessons) or
    // {q, options, correct} (newer, multiple-choice — see api/make.js /
    // api/generate.js) — Practice Speaking just reads the question text
    // either way, it doesn't need the choices here. Its Korean
    // translation follows the SAME dual shape (see choiceForTranslate()/
    // choiceFromTranslated() in api/translate.js) — a multiple-choice
    // question's translation is {q,options}, not a plain string, so this
    // needs the same typeof guard the English text already gets a few
    // lines up, or ko ends up as a stringified object ("[object Object]").
    (L.comprehension||[]).forEach((q,i) => {
      const trEntry = T&&T.comprehension&&T.comprehension[i];
      const ko = (typeof trEntry==='string' ? trEntry : (trEntry&&trEntry.q)) || '';
      items.push({ type:'question', text: (q && typeof q==='object') ? q.q : q, ko });
    });
  }
  return items;
}

/* ---------------- daily practice log (localStorage, dates -> seconds) ---------------- */
function dlTodayKey(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
// Kept per-user, same pattern as public/path.html's dlProgressKey() —
// this used to be one shared 'dl_practice_log' key for the whole device,
// so a second account signing in on the same browser/phone saw (and could
// overwrite) whichever account's log happened to already be sitting there.
function dlPracticeLogKey(){ return 'dl_practice_log_' + (localStorage.getItem('dl_uid')||'guest'); }
function dlGetPracticeLog(){
  try {
    const key = dlPracticeLogKey();
    let raw = localStorage.getItem(key);
    if(raw==null){
      // one-time migration from the old shared key so whoever was already
      // using this device doesn't just lose their streak the moment this
      // ships — removed right after so a DIFFERENT account signing into
      // this same device later doesn't also inherit it (the original bug)
      const legacy = localStorage.getItem('dl_practice_log');
      raw = legacy || '{}';
      localStorage.setItem(key, raw);
      if(legacy) localStorage.removeItem('dl_practice_log');
    }
    return JSON.parse(raw||'{}');
  } catch(e){ return {}; }
}
/* all-time total, not just the streak's recent window — dlPullPracticeFromServer()
   already merges a student's FULL server-side history into this same log
   (see below), so summing every key here needs no extra network call. */
function dlGetTotalPracticeSeconds(){
  const log = dlGetPracticeLog();
  return Object.values(log).reduce((sum,s)=>sum+(s||0), 0);
}
/* shared "N min" / "H hr M min" formatter — matches teacher.html's fmtTime() */
function dlFormatPracticeTime(seconds){
  const mins = Math.round((seconds||0)/60);
  if(mins < 60) return mins+' min';
  const h = Math.floor(mins/60), m = mins%60;
  return h+' hr'+(m?' '+m+' min':'');
}
function dlLogPracticeSeconds(seconds){
  if(!seconds || seconds < 1) return;
  try {
    const log = dlGetPracticeLog();
    const key = dlTodayKey();
    log[key] = (log[key]||0) + Math.round(seconds);
    localStorage.setItem(dlPracticeLogKey(), JSON.stringify(log));
    dlSyncPracticeToServer();   // keep the account's streak in sync (best-effort)
  } catch(e){}
}
/* push today's cumulative practice seconds to the account so the streak
   follows the user across devices and feeds the teacher's dashboard.
   Best-effort and keepalive so it still fires when the tab is closing. */
function dlSyncPracticeToServer(){
  try {
    if(typeof dlReadToken !== 'function') return;
    const token = dlReadToken();
    if(!token) return;
    const day = dlTodayKey();
    const seconds = dlGetPracticeLog()[day] || 0;
    if(!seconds) return;
    fetch('/api/save-profile', {
      method:'POST', keepalive:true,
      headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+token },
      body: JSON.stringify({ day, seconds })
    }).catch(()=>{});
  } catch(e){}
}
/* pull the account's practice days and merge them into the local log, so a
   fresh device shows the real streak. Takes the larger value per day. */
async function dlPullPracticeFromServer(){
  try {
    if(typeof dlReadToken !== 'function') return;
    const token = dlReadToken();
    if(!token) return;
    const r = await fetch('/api/save-profile?streak=1', { headers:{ Authorization:'Bearer '+token } });
    if(!r.ok) return;
    const j = await r.json();
    if(!j || !Array.isArray(j.days)) return;
    const log = dlGetPracticeLog();
    j.days.forEach(row => { log[row.day] = Math.max(log[row.day]||0, row.seconds||0); });
    localStorage.setItem(dlPracticeLogKey(), JSON.stringify(log));
  } catch(e){}
}
/* streak = consecutive days up to and including today with any practice logged */
function dlGetStreakInfo(days){
  const log = dlGetPracticeLog();
  const out = [];
  const today = new Date();
  for(let i=(days||14)-1; i>=0; i--){
    const d = new Date(today); d.setDate(d.getDate()-i);
    const key = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    out.push({ date:key, seconds: log[key]||0, isToday: i===0 });
  }
  // count consecutive practiced days ending today; if today has no
  // practice yet, don't let that alone drop the streak to zero — start
  // counting from yesterday instead (today still has a chance)
  let streak = 0;
  let i = out.length - 1;
  if(out[i] && out[i].seconds === 0) i--;
  while(i >= 0 && out[i].seconds > 0){ streak++; i--; }
  return { days: out, streak, todaySeconds: log[dlTodayKey()]||0 };
}
