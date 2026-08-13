// games.js — self-contained vocabulary mini-games built entirely from a
// lesson's existing data. No server, no new content: every game generates
// itself from the same shapes the lessons already use —
//   reading lessons:   vocab:[{ w, p, d }]   (+ Korean from a translation)
//   flashcard lessons:  cards:[{ word, emoji, ko, letter }]
//
// Why it works on EVERY lesson, advanced included: the "Word ↔ Meaning"
// mode needs only the English definition that every vocab word already
// has, so even a C2 lesson with no picture and no translation still gets a
// full game. "Picture" and "Korean" modes light up automatically when a
// lesson actually has emojis or a loaded Korean translation.
//
// Public API (attached to window.DLGames):
//   buildItems(L, T)      -> { items, hasEmoji, hasKo, hasMeaning }
//   modesFor(info)        -> ['picture','korean','meaning'] (only supported)
//   play(el, game, items, mode) -> renders one game into element `el`
(function () {
  'use strict';

  /* ---------------- small helpers ---------------- */
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function esc(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // strips a part-of-speech tag like " (n)" or " (adj)" that occasionally
  // gets baked into generated article prose by mistake, anywhere in the
  // sentence (not just at the end) — it belongs only in the vocab list's
  // own `p` field, never in a sentence — see CLAUDE.md. Matched against a
  // fixed list of common POS abbreviations so a genuine parenthetical
  // aside is never accidentally stripped.
  function stripStrayPosTag(s) {
    return (s == null ? '' : String(s)).replace(/\s*\((?:n|v|vi|vt|adj|adv|prep|conj|pron|det|interj|aux)\.?\)/gi, '');
  }

  // say a bit of text aloud (free, built-in browser voice). Called when a
  // card/tile is tapped so the student hears what's on it — the English word,
  // its meaning, or the Korean, depending on the face. `lang` picks the voice
  // (defaults to English); a meaning is a full phrase, so speak it a touch
  // slower.
  function speakWord(w, lang) {
    try {
      if (!w || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(w));
      u.lang = lang || 'en-US'; u.rate = 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  // what a card face should say aloud, and in which voice. The word face always
  // speaks the English word; the "other" face speaks whatever it shows —
  // the word (picture mode), the English meaning, or the Korean.
  function faceSpeech(it, mode) {
    if (mode === 'korean') return { say: it.ko || it.word, lang: 'ko-KR' };
    if (mode === 'meaning') return { say: it.meaning || it.word, lang: 'en-US' };
    return { say: it.word, lang: 'en-US' };
  }

  /* ---- happy sounds (synthesized, no audio files needed) ----
     A short cheerful "ding-ding" when a pair is matched, and a little
     rising three-note flourish when a game is completed. Uses the Web
     Audio API, created lazily on the first tap (a user gesture, so the
     browser lets it play), and fails silently where audio isn't allowed. */
  var _actx = null;
  function audioCtx() {
    try {
      if (!_actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; _actx = new AC(); }
      if (_actx.state === 'suspended') _actx.resume();
      return _actx;
    } catch (e) { return null; }
  }
  function tone(ctx, freq, start, dur) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.28, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.start(start); o.stop(start + dur);
  }
  function playDing() {
    const ctx = audioCtx(); if (!ctx) return;
    const t = ctx.currentTime;
    tone(ctx, 880.0, t, 0.15);          // A5
    tone(ctx, 1174.66, t + 0.11, 0.22); // D6 — the second, higher "ding"
  }
  function playWin() {
    const ctx = audioCtx(); if (!ctx) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(ctx, f, t + i * 0.12, 0.22); }); // C-E-G-C
  }

  // translate a UI key, falling back to a plain-English default if the key
  // (or i18n itself) isn't available — keeps games working standalone.
  function T(key, fallback) {
    if (typeof dlT === 'function') { const v = dlT(key); if (v && v !== key) return v; }
    return fallback;
  }

  /* ---------------- turn a lesson into game items ---------------- */
  // Each item is a normalized { word, emoji, ko, meaning }. Missing fields
  // are empty strings; the mode pickers below only use items that actually
  // carry the field a given mode needs.
  function buildItems(L, Tr) {
    const items = [];
    if (!L) return { items: items, hasEmoji: false, hasKo: false, hasMeaning: false };
    if (L.type === 'flashcards') {
      (L.cards || []).forEach(function (c) {
        if (!c || !c.word) return;
        items.push({ word: c.word, emoji: c.emoji || '', ko: c.ko || '', meaning: '' });
      });
    } else {
      (L.vocab || []).forEach(function (v, i) {
        if (!v || !v.w) return;
        // reading-lesson Korean comes from a separately loaded translation.
        // Tr.vocab[i] is either a plain string (lessons translated before
        // word-level Korean existed — that string is the definition's
        // Korean, the best available for those older lessons) or a {w,d}
        // object (newer translations, w = the word's own Korean, d = the
        // definition's). The memory game shows the WORD, so it needs the
        // word's translation (.w), not the definition's (.d) — using .d
        // here previously showed Korean text for the wrong thing entirely
        // (e.g. "abundance" paired with the Korean for "a very large
        // quantity of something" instead of the Korean word itself).
        const trEntry = Tr && Tr.vocab && Tr.vocab[i];
        const ko = (typeof trEntry === 'string' ? trEntry : (trEntry && trEntry.w)) || v.ko || '';
        items.push({ word: v.w, emoji: v.emoji || '', ko: ko, meaning: v.d || '' });
      });
    }
    return {
      items: items,
      hasEmoji: items.some(function (x) { return !!x.emoji; }),
      hasKo: items.some(function (x) { return !!x.ko; }),
      hasMeaning: items.some(function (x) { return !!x.meaning; })
    };
  }

  // "Hard" memory mode: pairs are whole sentences (English article sentence
  // <-> its Korean translation) instead of single words, sourced from the
  // same sentence-level {en,ko} pairs already built for the Read the Article
  // step. Only available once a Korean translation is loaded (Tr.paras).
  function buildSentenceItems(L, Tr) {
    const items = [];
    if (Tr && Tr.paras) {
      Tr.paras.forEach(function (para) {
        (para || []).forEach(function (s) {
          if (s && s.en && s.ko) items.push({ word: stripStrayPosTag(s.en), emoji: '', ko: s.ko, meaning: '' });
        });
      });
    }
    return { items: items, hasEmoji: false, hasKo: items.length > 0, hasMeaning: false };
  }

  function modesFor(info) {
    const m = [];
    if (info.hasEmoji) m.push('picture');
    if (info.hasKo) m.push('korean');
    if (info.hasMeaning) m.push('meaning');
    if (!m.length) m.push('meaning'); // safety; should never be empty
    return m;
  }

  // human label for a mode (used by the page's toggle)
  function modeLabel(mode) {
    if (mode === 'picture') return T('games.modePicture', '🖼 Picture');
    if (mode === 'korean') return T('games.modeKorean', '🇰🇷 Korean');
    return T('games.modeMeaning', '📖 Meaning');
  }

  // items usable in a given mode (must carry that mode's matching field)
  function itemsForMode(items, mode) {
    return items.filter(function (it) {
      return mode === 'picture' ? it.emoji : mode === 'korean' ? it.ko : it.meaning;
    });
  }

  // the "other half" of a pair — what a word is matched against. `sentence`
  // adds a modifier class so long sentence text (Hard memory mode) gets a
  // smaller font instead of overflowing the card. Meaning-mode definitions
  // aren't sentence-mode but can still run long (dictionary-style
  // definitions), so those get their own length-based modifier — see
  // .dlg-mean.dlg-long in style.css.
  function otherFaceHtml(it, mode, sentence) {
    const suf = sentence ? ' dlg-sentence' : '';
    if (mode === 'picture') return '<span class="dlg-emoji' + suf + '">' + esc(it.emoji || '❓') + '</span>';
    if (mode === 'korean') return '<span class="dlg-ko' + suf + '">' + esc(it.ko) + '</span>';
    const meanCls = (it.meaning || '').length > 22 ? ' dlg-long' : '';
    return '<span class="dlg-mean' + suf + meanCls + '">' + esc(it.meaning) + '</span>';
  }

  function scrambleWord(word) {
    const clean = String(word || '');
    // shuffle the letters but keep any spaces/hyphens in their original spots
    const positions = [];
    clean.split('').forEach(function (ch, i) { if (/[A-Za-z]/.test(ch)) positions.push(i); });
    if (positions.length < 2) return clean.toUpperCase();
    let out = clean;
    for (let guard = 0; guard < 12 && out.toUpperCase() === clean.toUpperCase(); guard++) {
      const chars = clean.split('');
      const letters = shuffle(positions.map(function (i) { return chars[i]; }));
      positions.forEach(function (pos, k) { chars[pos] = letters[k]; });
      out = chars.join('');
    }
    return out.toUpperCase();
  }

  function banner(kind, text) {
    return '<div class="dlg-banner ' + kind + '">' + esc(text) + '</div>';
  }

  /* ---- practice-time timer, with a visible clock + Start/Stop ----
     Games have no recording/AI feedback (deliberately — game sound effects
     would bleed into a mic, and it's not worth the complexity), but time
     spent playing should still count toward the same streak/teacher-
     dashboard tracking as speaking practice does. Starting is a deliberate
     action (pressing Start) rather than something that just happens the
     moment a game renders — a silent background timer looked like nothing
     was happening at all. endTimer() logs the elapsed time via
     dlLogPracticeSeconds() (practice.js) and is called on Stop, on
     whichever host page (the in-lesson Games step, or the standalone
     /games page) knows the student has actually left, and unconditionally
     on page unload so closing the tab mid-game still counts what was
     played. */
  var _gameStart = null;
  var _timerTick = null;
  function startTimer() {
    if (_gameStart) return;
    _gameStart = Date.now();
  }
  function endTimer() {
    if (_timerTick) { clearInterval(_timerTick); _timerTick = null; }
    if (!_gameStart) return;
    const seconds = (Date.now() - _gameStart) / 1000;
    _gameStart = null;
    if (typeof dlLogPracticeSeconds === 'function') dlLogPracticeSeconds(seconds);
  }
  window.addEventListener('beforeunload', endTimer);

  function fmtClock(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  /* mountTimer(el) — renders the "⏱ 00:00 · Start/Stop" widget into `el`
     and wires it up; safe to call again (e.g. re-rendering the same step)
     since it clears any previous ticking interval first. */
  function mountTimer(el) {
    if (!el) return;
    el.innerHTML =
      '<div class="dlg-timer">' +
        '<span class="dlg-timer-clock" id="dlgTimerClock">00:00</span>' +
        '<button class="dlg-timer-btn" id="dlgTimerBtn"></button>' +
      '</div>';
    const clockEl = el.querySelector('#dlgTimerClock');
    const btnEl = el.querySelector('#dlgTimerBtn');
    function refresh() {
      const running = !!_gameStart;
      clockEl.textContent = fmtClock(running ? (Date.now() - _gameStart) / 1000 : 0);
      btnEl.textContent = running ? T('games.timerStop', '⏸ Stop') : T('games.timerStart', '▶ Start');
      btnEl.classList.toggle('on', running);
    }
    btnEl.onclick = function () {
      if (_gameStart) endTimer(); else startTimer();
      refresh();
    };
    if (_timerTick) clearInterval(_timerTick);
    _timerTick = setInterval(refresh, 1000);
    refresh();
  }

  /* ---- report a finished game to the server (homework tracking) ----
     Best-effort and silent: only means anything when the player is a class
     student with this lesson currently assigned as homework — the server
     decides that and no-ops otherwise, so this is safe to call for every
     player (independent students, guests, teachers previewing a lesson). */
  function submitScore(lessonId, activity, score, max) {
    // locked-path gate hook (public/lesson.html): "the Games step is passed"
    // the moment any one game type is completed once — independent of
    // whether the homework-tracking POST below actually fires.
    if (typeof window.dlOnGameActivityComplete === 'function') {
      try { window.dlOnGameActivityComplete(lessonId, activity, score, max); } catch (e) {}
    }
    try {
      if (!lessonId || typeof dlReadToken !== 'function') return;
      const token = dlReadToken();
      if (!token) return;
      fetch('/api/save-profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ submit: { lessonId: lessonId, activity: activity, score: score, max: max } })
      }).catch(function () {});
    } catch (e) {}
  }

  /* ================= MEMORY (concentration) =================
     opts: { players: 1-4, sentence: true for Hard/sentence-pair mode } */
  function playMemory(el, items, mode, lessonId, opts) {
    opts = opts || {};
    const players = Math.max(1, Math.min(4, opts.players || 1));
    const isMulti = players > 1;
    const pool = itemsForMode(items, mode);
    if (pool.length < 2) { el.innerHTML = banner('info', T('games.needMore', 'This lesson needs at least two words for this game.')); return; }
    // Sentence/hard mode is locked to 2 columns (the text is too wide for
    // more), so 8 pairs would mean 8 rows — no viewport-height budgeting
    // can make that fit a phone screen. Capping it at 4 pairs (2x4) keeps
    // the whole board on one screen; single-word mode keeps the full 8.
    const maxPairs = opts.sentence ? 4 : 8;
    const pairs = shuffle(pool).slice(0, Math.min(maxPairs, pool.length));
    let cards = [];
    pairs.forEach(function (it, idx) {
      const other = faceSpeech(it, mode);
      const frontCls = opts.sentence ? 'dlg-word dlg-sentence' : 'dlg-word';
      cards.push({ pairId: idx, say: it.word, lang: 'en-US', html: '<span class="' + frontCls + '">' + esc(it.word) + '</span>' });
      cards.push({ pairId: idx, say: other.say, lang: other.lang, html: otherFaceHtml(it, mode, opts.sentence) });
    });
    cards = shuffle(cards);

    const playerRow = isMulti
      ? '<div class="dlg-pchips" id="dlgPchips">' +
          Array.from({ length: players }, function (_, i) {
            return '<div class="dlg-pchip' + (i === 0 ? ' active' : '') + '" id="dlgP' + i + '">' +
              '<div class="dlg-pname">' + T('games.playerScore', 'P{n}').replace('{n}', i + 1) + '</div>' +
              '<div class="dlg-pscore">0</div>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div class="dlg-turn" id="dlgTurn"></div>' +
        '<div id="dlgPointToast"></div>'
      : '<div class="dlg-hud">' +
          '<span class="dlg-stat">' + T('games.moves', 'Moves') + ': <b id="dlgMoves">0</b></span>' +
          '<span class="dlg-stat">' + T('games.pairs', 'Pairs') + ': <b id="dlgFound">0</b>/' + pairs.length + '</span>' +
        '</div>';

    el.innerHTML =
      '<div class="dlg-game-area" id="dlgArea">' +
        playerRow +
        '<div class="dlg-memory' + (opts.sentence ? ' dlg-memory-sentence' : '') + '" id="dlgBoard"></div>' +
        '<div id="dlgWin"></div>' +
      '</div>';

    const board = el.querySelector('#dlgBoard');
    board.innerHTML = cards.map(function (c, i) {
      return '<button class="dlg-card" data-i="' + i + '" data-pair="' + c.pairId + '" data-say="' + esc(c.say) + '" data-lang="' + esc(c.lang) + '" aria-label="card">' +
        '<span class="dlg-card-face dlg-back">?</span>' +
        '<span class="dlg-card-face dlg-front">' + c.html + '</span>' +
      '</button>';
    }).join('');

    let first = null, lock = false, moves = 0, found = 0;
    let currentPlayer = 0;
    const scores = new Array(players).fill(0);
    const movesEl = el.querySelector('#dlgMoves');
    const foundEl = el.querySelector('#dlgFound');
    const turnEl = el.querySelector('#dlgTurn');

    function renderTurn() {
      if (!isMulti) return;
      turnEl.textContent = T('games.playerTurn', "Player {n}'s turn").replace('{n}', currentPlayer + 1);
      for (let i = 0; i < players; i++) {
        const chip = el.querySelector('#dlgP' + i);
        if (chip) chip.classList.toggle('active', i === currentPlayer);
      }
    }
    renderTurn();

    function showPointToast(playerIdx) {
      const box = el.querySelector('#dlgPointToast');
      if (!box) return;
      const msg = T('games.pointScored', 'Player {n} +1!').replace('{n}', String(playerIdx + 1));
      box.innerHTML = '<div class="dlg-point-toast">✓ ' + esc(msg) + '</div>';
      setTimeout(function () { box.innerHTML = ''; }, 1000);
    }

    board.querySelectorAll('.dlg-card').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (lock || btn.classList.contains('flipped') || btn.classList.contains('matched')) return;
        btn.classList.add('flipped');
        speakWord(btn.dataset.say, btn.dataset.lang);   // say the card's face aloud when it's turned
        if (!first) { first = btn; return; }
        moves++; if (movesEl) movesEl.textContent = moves;
        const isMatch = first.dataset.pair === btn.dataset.pair && first !== btn;
        if (isMatch) {
          first.classList.add('matched'); btn.classList.add('matched');
          first = null; found++;
          if (foundEl) {
            foundEl.textContent = found;
            foundEl.classList.remove('dlg-bump'); void foundEl.offsetWidth;
            foundEl.classList.add('dlg-bump');           // pop the score
          }
          playDing();                                    // happy "ding-ding"
          if (isMulti) {
            scores[currentPlayer]++;
            const pEl = el.querySelector('#dlgP' + currentPlayer);
            if (pEl) {
              const scoreEl = pEl.querySelector('.dlg-pscore');
              if (scoreEl) scoreEl.textContent = scores[currentPlayer];
              pEl.classList.remove('bump'); void pEl.offsetWidth;
              pEl.classList.add('bump');                 // pop the chip that just scored
            }
            showPointToast(currentPlayer);
            // a correct match earns the same player another turn
          }
          if (found === pairs.length) {
            playWin();
            submitScore(lessonId, 'memory', found, pairs.length);
            if (isMulti) {
              const top = Math.max.apply(null, scores);
              const winners = scores.reduce(function (acc, s, i) { if (s === top) acc.push(i + 1); return acc; }, []);
              const msg = winners.length > 1
                ? T('games.tie', "🎉 It's a tie!")
                : T('games.winner', '🎉 Player {n} wins!').replace('{n}', winners[0]);
              el.querySelector('#dlgWin').innerHTML = banner('win', msg);
            } else {
              el.querySelector('#dlgWin').innerHTML =
                banner('win', '🎉 ' + T('games.memoryWin', 'You matched them all!') +
                  ' (' + moves + ' ' + T('games.movesLower', 'moves') + ')');
            }
          }
        } else {
          lock = true;
          const a = first, b = btn;
          setTimeout(function () {
            a.classList.remove('flipped'); b.classList.remove('flipped');
            first = null; lock = false;
            if (isMulti && found < pairs.length) {
              currentPlayer = (currentPlayer + 1) % players;   // wrong pair passes the turn
              renderTurn();
            }
          }, 850);
        }
      });
    });
  }

  /* ================= MATCH-UP (tap word → tap match) ================= */
  function playMatch(el, items, mode, lessonId) {
    const pool = itemsForMode(items, mode);
    if (pool.length < 2) { el.innerHTML = banner('info', T('games.needMore', 'This lesson needs at least two words for this game.')); return; }
    const chosen = shuffle(pool).slice(0, Math.min(6, pool.length));
    const left = chosen.map(function (it, i) { return { i: i, word: it.word }; });
    const right = shuffle(chosen.map(function (it, i) {
      const other = faceSpeech(it, mode);
      return { i: i, html: otherFaceHtml(it, mode), say: other.say, lang: other.lang };
    }));

    el.innerHTML =
      '<div class="dlg-hint">' + T('games.matchHint', 'Tap a word, then tap its match.') + '</div>' +
      '<div class="dlg-match">' +
        '<div class="dlg-col" id="dlgLeft">' + left.map(function (o) {
          return '<button class="dlg-tile" data-i="' + o.i + '" data-word="' + esc(o.word) + '">' + esc(o.word) + '</button>';
        }).join('') + '</div>' +
        '<div class="dlg-col" id="dlgRight">' + right.map(function (o) {
          return '<button class="dlg-tile" data-i="' + o.i + '" data-say="' + esc(o.say) + '" data-lang="' + esc(o.lang) + '">' + o.html + '</button>';
        }).join('') + '</div>' +
      '</div>' +
      '<div id="dlgWin"></div>';

    let sel = null, done = 0;
    const total = chosen.length;
    const leftEl = el.querySelector('#dlgLeft');
    const rightEl = el.querySelector('#dlgRight');

    function clearSel() {
      leftEl.querySelectorAll('.dlg-tile').forEach(function (t) { t.classList.remove('sel'); });
    }
    leftEl.querySelectorAll('.dlg-tile').forEach(function (t) {
      t.addEventListener('click', function () {
        if (t.classList.contains('done')) return;
        speakWord(t.dataset.word);   // say the word aloud
        clearSel(); t.classList.add('sel'); sel = t;
      });
    });
    rightEl.querySelectorAll('.dlg-tile').forEach(function (t) {
      t.addEventListener('click', function () {
        if (t.classList.contains('done')) return;
        speakWord(t.dataset.say, t.dataset.lang);   // say this face aloud (word / meaning / Korean)
        if (!sel) return;
        if (sel.dataset.i === t.dataset.i) {
          sel.classList.add('done'); t.classList.add('done');
          sel.classList.remove('sel'); sel = null; done++;
          playDing();                                    // happy "ding-ding"
          if (done === total) {
            playWin();
            submitScore(lessonId, 'match', done, total);
            el.querySelector('#dlgWin').innerHTML = banner('win', '🎉 ' + T('games.matchWin', 'All matched — great job!'));
          }
        } else {
          const bad = t; bad.classList.add('wrong');
          setTimeout(function () { bad.classList.remove('wrong'); }, 500);
        }
      });
    });
  }

  /* ================= WORD SCRAMBLE (type the word) ================= */
  function playScramble(el, items, lessonId) {
    // any word of 2+ letters works; hint is picture > meaning > Korean
    const pool = items.filter(function (it) { return (it.word || '').replace(/[^A-Za-z]/g, '').length >= 2; });
    if (!pool.length) { el.innerHTML = banner('info', T('games.needMore', 'This lesson needs at least two words for this game.')); return; }
    const list = shuffle(pool).slice(0, Math.min(10, pool.length));
    let idx = 0, score = 0;

    function hintHtml(it) {
      if (it.emoji) return '<span class="dlg-emoji">' + esc(it.emoji) + '</span>';
      if (it.meaning) return '<span class="dlg-mean">' + esc(it.meaning) + '</span>';
      if (it.ko) return '<span class="dlg-ko">' + esc(it.ko) + '</span>';
      return '';
    }

    function draw() {
      if (idx >= list.length) {
        playWin();
        submitScore(lessonId, 'scramble', score, list.length);
        el.innerHTML = banner('win', '🎉 ' + T('games.scrambleDone', 'Finished!') + ' ' +
          T('games.score', 'Score') + ': ' + score + '/' + list.length) +
          '<div class="dlg-center"><button class="dlg-btn" id="dlgAgain">' + T('games.playAgain', 'Play again') + '</button></div>';
        el.querySelector('#dlgAgain').addEventListener('click', function () { idx = 0; score = 0; draw(); });
        return;
      }
      const it = list[idx];
      el.innerHTML =
        '<div class="dlg-hud"><span class="dlg-stat">' + T('games.word', 'Word') + ' ' + (idx + 1) + '/' + list.length +
          '</span><span class="dlg-stat">' + T('games.score', 'Score') + ': <b>' + score + '</b></span></div>' +
        '<div class="dlg-scramble">' +
          '<div class="dlg-hintbox">' + hintHtml(it) + '</div>' +
          '<div class="dlg-scrambled">' + esc(scrambleWord(it.word)) + '</div>' +
          '<input class="dlg-input" id="dlgAns" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
            'placeholder="' + esc(T('games.typeHere', 'Type the word…')) + '">' +
          '<div class="dlg-center">' +
            '<button class="dlg-btn ghost" id="dlgReveal">' + T('games.reveal', 'Show answer') + '</button>' +
            '<button class="dlg-btn" id="dlgCheck">' + T('games.check', 'Check') + '</button>' +
          '</div>' +
          '<div id="dlgFeed"></div>' +
        '</div>';
      const input = el.querySelector('#dlgAns');
      const feed = el.querySelector('#dlgFeed');
      let answered = false;
      input.focus();

      function check() {
        if (answered) return;
        const guess = (input.value || '').trim().toUpperCase();
        if (!guess) return;
        if (guess === it.word.toUpperCase()) {
          answered = true; score++;
          playDing();                                    // happy "ding-ding"
          feed.innerHTML = banner('win', '✓ ' + T('games.correct', 'Correct!'));
          setTimeout(function () { idx++; draw(); }, 700);
        } else {
          feed.innerHTML = banner('bad', '✗ ' + T('games.tryAgain', 'Try again'));
        }
      }
      el.querySelector('#dlgCheck').addEventListener('click', check);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') check(); });
      el.querySelector('#dlgReveal').addEventListener('click', function () {
        if (answered) return;
        answered = true;
        // show the real word in the scrambled box itself (not just a
        // feedback line below it) and wait for the student to press Next
        // themselves — auto-advancing after a fixed delay didn't give them
        // time to actually read it before it moved on.
        const box = el.querySelector('.dlg-scrambled');
        if (box) box.textContent = it.word.toUpperCase();
        feed.innerHTML = '<div class="dlg-center"><button class="dlg-btn" id="dlgNext">' + T('games.next', 'Next →') + '</button></div>';
        el.querySelector('#dlgNext').addEventListener('click', function () { idx++; draw(); });
      });
    }
    draw();
  }

  /* ---------------- public entry ---------------- */
  window.DLGames = {
    buildItems: buildItems,
    buildSentenceItems: buildSentenceItems,
    modesFor: modesFor,
    modeLabel: modeLabel,
    ding: playDing,
    win: playWin,
    submit: submitScore,
    startTimer: startTimer,
    endTimer: endTimer,
    mountTimer: mountTimer,
    play: function (el, game, items, mode, lessonId, opts) {
      if (!el) return;
      el.innerHTML = '';
      if (game === 'memory') return playMemory(el, items, mode, lessonId, opts);
      if (game === 'match') return playMatch(el, items, mode, lessonId);
      if (game === 'scramble') return playScramble(el, items, lessonId);
    }
  };
})();
