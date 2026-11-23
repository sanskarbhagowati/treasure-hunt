/* The Alchemist's Advent: front end. Every clue and every piece of the seal stays encrypted
   until the right team scans the right QR and answers correctly. */
(function () {
  const H = window.HUNT, C = window.HuntCore, app = document.getElementById('app');
  document.title = H.title;

  // localStorage with in-memory fallback (private browsing / in-app browsers)
  const mem = {};
  const store = {
    get(k) { try { const v = localStorage.getItem(k); if (v !== null) return v; } catch (e) {} return mem[k] ?? null; },
    set(k, v) { mem[k] = v; try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} }
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let session = null; // {pin, team:{i,name,colour}}
  const resKey = () => 'hunt.res.' + session.pin;
  const loadRes = () => { try { return JSON.parse(store.get(resKey()) || '{}'); } catch (e) { return {}; } };
  const saveRes = (room, res) => { const r = loadRes(); r[room] = Object.assign({ t: Date.now() }, res); store.set(resKey(), JSON.stringify(r)); };
  const N = H.rooms.length;

  /* ---------- live progress (anonymous proof tokens; queued while offline) ---------- */
  const L = H.live; let flushing = false;
  const jget = (k, d) => { try { return JSON.parse(store.get(k) || d); } catch (e) { return JSON.parse(d); } };
  function ping(k) {
    if (!L || !k) return;
    const sent = jget('hunt.sent', '{}'), q = jget('hunt.q', '[]');
    if (sent[k] || q.some(e => e.k === k)) return;
    q.push({ k, ts: Math.floor(Date.now() / 1000) }); store.set('hunt.q', JSON.stringify(q));
    flush();
  }
  async function flush() {
    if (!L || flushing) return; flushing = true;
    const rest = [], sent = jget('hunt.sent', '{}');
    for (const e of jget('hunt.q', '[]')) {
      try {
        const r = await fetch(`${L.server}/${L.topic}`, { method: 'POST', body: `${e.k}.${e.ts}` });
        if (!r.ok) throw new Error('http'); sent[e.k] = 1;
      } catch (err) { rest.push(e); }
    }
    store.set('hunt.q', JSON.stringify(rest)); store.set('hunt.sent', JSON.stringify(sent)); flushing = false;
  }
  window.addEventListener('online', flush); setInterval(flush, 15000);

  function view(inner) {
    const t = session ? `<span class="badge"><i></i>Team ${esc(session.team.name)}</span>` : '';
    app.innerHTML = `<header class="top"><h1>${esc(H.title)}</h1>${t}</header>${inner}`;
    if (session) document.documentElement.style.setProperty('--team', session.team.colour);
    window.scrollTo(0, 0);
  }

  const storyHtml = () => H.story.intro.map(p => `<p>${p}</p>`).join('') +
    `<p class="verse">${H.story.prologue.map(esc).join('<br>')}</p>`;

  /* ---------- login ---------- */
  function loginView(msg) {
    view(`<div class="card story"><div class="kicker">The legend</div>${storyHtml()}</div>
      <div class="card"><div class="kicker">Apprentice, identify yourself</div><h2>Enter your team PIN</h2>
      <p class="dim">The PIN is printed on your team card. You only need to enter it once on this phone.</p>
      <form id="f"><input id="pin" class="pin" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="•••••" maxlength="12">
      <button id="go">Continue</button></form><p class="msg bad" id="m">${msg || ''}</p></div>`);
    document.getElementById('f').onsubmit = async e => {
      e.preventDefault();
      const pin = C.normPin(document.getElementById('pin').value);
      if (!pin) return;
      const b = document.getElementById('go'), m = document.getElementById('m');
      b.disabled = true; m.textContent = 'Checking…'; m.className = 'msg dim';
      const hits = await Promise.all(H.teams.map(t => C.open(pin, t, H.iters)));
      const team = hits.find(Boolean);
      if (!team) { b.disabled = false; m.textContent = 'That PIN is not valid. Check your team card.'; m.className = 'msg bad'; return; }
      session = { pin, team }; ping(team.login);
      store.set('hunt.pin', pin); store.set('hunt.team', JSON.stringify(team));
      route();
    };
  }
  function logout() { store.del('hunt.pin'); store.del('hunt.team'); session = null; route(); }
  const logoutBtn = `<p style="text-align:center;margin-top:30px"><button class="ghost" id="lo">Not your team? Switch team</button></p>`;
  const bindLogout = () => { const b = document.getElementById('lo'); if (b) b.onclick = logout; };

  /* ---------- the seal (4-piece picture) ---------- */
  function seal() {
    const res = loadRes();
    const got = []; for (let r = 1; r <= N; r++) got.push(!!res[r]);
    const whole = got.every(Boolean);
    const cells = got.map((g, i) => g
      ? `<img src="${res[i + 1].img}" alt="piece ${i + 1}">`
      : `<div class="empty"><span>?</span><small>${esc(H.rooms[i])}</small></div>`).join('');
    let extra;
    if (whole) {
      const verses = [...Array(N).keys()].map(i => `<li><b>${esc(res[i + 1].verse[0])}.</b> ${esc(res[i + 1].verse[1])}</li>`).join('');
      const done = Math.max(...Object.values(res).map(r => r.t || 0));
      const hhmm = d => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      extra = `<div class="card ok"><div class="kicker">The seal is whole</div><h2>The Owl lets you pass</h2>
        <p class="stamp">Team ${esc(session.team.name)} · sealed at ${done ? hhmm(done) : '—'}<br><span id="clk"></span></p>
        <p>Show this to the <b>Keeper of the Door</b>. First, read the Master's riddle in order:</p><ol class="verses">${verses}</ol>
        <p class="dim">Your destination: <b>${esc(H.finalRoom)}</b>.</p></div>`;
      setTimeout(() => { const c = document.getElementById('clk'); if (!c) return;
        const tick = () => { if (document.getElementById('clk')) { c.textContent = 'Now ' + new Date().toLocaleTimeString(); setTimeout(tick, 1000); } }; tick(); }, 0);
    } else {
      const verses = [...Array(N).keys()].filter(i => got[i])
        .map(i => `<li><b>${esc(res[i + 1].verse[0])}.</b> ${esc(res[i + 1].verse[1])}</li>`).join('');
      extra = `<p class="dim">${got.filter(Boolean).length} of ${N} pieces found. Win all four to complete the seal.</p>` +
        (verses ? `<p class="kicker" style="margin-top:14px">The Master's riddle so far</p><ol class="verses">${verses}</ol>` : '');
    }
    return `<div class="owl ${whole ? 'whole' : ''}">${cells}</div>${extra}`;
  }

  function homeView() {
    view(`<div class="card story"><div class="kicker">Team ${esc(session.team.name)}</div><h2>The trials await</h2>
      <p>Go to the room named on your team card, find the QR code hidden for <b>your</b> team and scan it with your phone camera.</p></div>
      <div class="card"><div class="kicker">The Owl's seal</div>${seal()}</div>${logoutBtn}`);
    bindLogout();
  }

  /* ---------- stage (a QR was scanned) ---------- */
  async function stageView(token) {
    view(`<div class="card"><p class="dim">Opening…</p></div>`);
    const entry = H.stages[await C.stageId(token)];
    if (!entry) return view(`<div class="card bad"><h2>Unknown QR code</h2><p>This code is not part of the hunt, or the link is incomplete. Try scanning it again.</p></div>${logoutBtn}`), bindLogout();
    const p = await C.open(token + '|' + session.pin, entry, H.iters);
    if (!p) return view(`<div class="card bad"><div class="kicker">Not for you</div><h2>This QR belongs to another team</h2>
      <p>Leave it where it is and keep searching. Your own code is hidden somewhere else in this room.</p></div>${logoutBtn}`), bindLogout();

    ping(p.arrive);
    const saved = loadRes()[p.room];
    const puzzle = `<div class="puzzle">${p.html}${p.image ? `<img src="${esc(p.image)}" alt="">` : ''}</div>`;
    if (saved && saved.stage === p.stage) { ping(saved.proof); return solvedView(p, saved, puzzle); }

    view(`<div class="card"><div class="kicker">${esc(p.roomName)} · trial ${p.stage} of ${p.of}</div><h2>${esc(p.title)}</h2>${puzzle}
      ${p.hint ? `<details><summary>Need a hint?</summary><p>${p.hint}</p></details>` : ''}</div>
      <div class="card"><form id="f"><div class="kicker">Your answer</div>
      <input id="ans" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Type the solution">
      <button id="go">Offer it to the Owl</button></form><p class="msg" id="m"></p></div>${logoutBtn}`);
    bindLogout();
    document.getElementById('f').onsubmit = async e => {
      e.preventDefault();
      const a = C.normAnswer(document.getElementById('ans').value); if (!a) return;
      const b = document.getElementById('go'), m = document.getElementById('m');
      b.disabled = true; m.textContent = 'The Owl considers…'; m.className = 'msg dim';
      let res = null;
      for (const u of p.unlock) { res = await C.open(a + '|' + token, u, H.iters); if (res) break; }
      if (!res) { b.disabled = false; m.textContent = 'The Owl blinks. Not quite. Think again.'; m.className = 'msg bad'; return; }
      saveRes(p.room, res); ping(res.proof);
      solvedView(p, res, puzzle);
    };
  }

  function solvedView(p, res, puzzle) {
    const left = N - Object.keys(loadRes()).length;
    const dest = res.nextRoom ? `<p>Your next trial awaits in</p><div class="big">${esc(res.nextName)}</div>` :
      (left === 0 ? `<p>All four trials are won. Open the seal below.</p>` : `<p>Look at the seal below.</p>`);
    view(`<div class="card ok"><div class="kicker">${esc(p.roomName)} · trial ${p.stage} of ${p.of} won</div><h2>Correct!</h2>
      <div class="piece"><img src="${res.img}" alt="your piece"></div>
      <p>A piece of the Owl's seal is yours.</p>
      <p class="verseLine"><b>${esc(res.verse[0])}.</b> ${esc(res.verse[1])}</p>
      ${dest}${res.extra ? `<p>${res.extra}</p>` : ''}</div>
      <div class="card"><div class="kicker">The Owl's seal</div>${seal()}</div>
      <details class="card"><summary>Show this trial again</summary>${puzzle}</details>${logoutBtn}`);
    bindLogout();
  }

  /* ---------- routing ---------- */
  function route() {
    const token = decodeURIComponent(location.hash.slice(1)).trim();
    if (!session) return loginView();
    return token ? stageView(token) : homeView();
  }
  window.addEventListener('hashchange', route);

  (function init() {
    const pin = store.get('hunt.pin'), team = store.get('hunt.team');
    if (pin && team) { try { session = { pin, team: JSON.parse(team) }; } catch (e) { session = null; } }
    if (session) ping(session.team.login);
    route();
  })();
})();
