/* Treasure-hunt front end. All clues stay encrypted until the right team scans the right QR. */
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
  const saveRes = (room, res) => { const r = loadRes(); r[room] = res; store.set(resKey(), JSON.stringify(r)); };

  function view(inner) {
    const t = session ? `<span class="badge"><i></i>Team ${esc(session.team.name)}</span>` : '';
    app.innerHTML = `<header class="top"><h1>${esc(H.title)}</h1>${t}</header>${inner}`;
    if (session) document.documentElement.style.setProperty('--team', session.team.colour);
    window.scrollTo(0, 0);
  }

  /* ---------- login ---------- */
  function loginView(msg) {
    view(`<div class="card"><div class="kicker">Welcome</div><h2>Enter your team PIN</h2>
      <p class="dim">${esc(H.subtitle || '')}<br>The PIN is printed on your team card. You only need to enter it once on this phone.</p>
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
      session = { pin, team };
      store.set('hunt.pin', pin); store.set('hunt.team', JSON.stringify(team));
      route();
    };
  }
  function logout() { store.del('hunt.pin'); store.del('hunt.team'); session = null; route(); }
  const logoutBtn = `<p style="text-align:center;margin-top:30px"><button class="ghost" id="lo">Not your team? Switch team</button></p>`;
  const bindLogout = () => { const b = document.getElementById('lo'); if (b) b.onclick = logout; };

  /* ---------- progress board ---------- */
  function board() {
    const res = loadRes(), n = H.rooms.length;
    const digits = []; let all = true;
    for (let r = 1; r <= n; r++) { if (res[r]) digits.push(res[r].digit); else { digits.push('?'); all = false; } }
    const tiles = digits.map((d, i) => `<div class="tile ${d === '?' ? '' : 'got'}"><b>${esc(d)}</b><span>${esc(H.rooms[i])}</span></div>`).join('');
    let extra = '';
    if (all) extra = `<div class="card ok"><div class="kicker">All clues solved</div><h2>${esc(H.finalRoom)} is yours</h2>
      <div class="code">${digits.map(esc).join(' ')}</div><p class="dim">Combination for the lock of ${esc(H.finalRoom)}. Digits are ordered by room number.</p></div>`;
    else extra = `<p class="dim">Each room hides one digit. Collect all ${n}; they open ${esc(H.finalRoom)} when put in room-number order.
      If teammates scanned on other phones, combine your digits.</p>`;
    return `<div class="board">${tiles}</div>${extra}`;
  }

  function homeView() {
    view(`<div class="card"><div class="kicker">Team ${esc(session.team.name)}</div><h2>Ready to hunt</h2>
      <p>Go to the room named on your team card, find the QR code hidden for <b>your</b> team and scan it with your phone camera.</p></div>
      <div class="card"><div class="kicker">Your progress</div>${board()}</div>${logoutBtn}`);
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

    const saved = loadRes()[p.room];
    const puzzle = `<div class="puzzle">${p.html}${p.image ? `<img src="${esc(p.image)}" alt="">` : ''}</div>`;
    if (saved && saved.stage === p.stage) return solvedView(p, saved, puzzle);

    view(`<div class="card"><div class="kicker">${esc(p.roomName)} · clue ${p.stage} of ${p.of}</div><h2>${esc(p.title)}</h2>${puzzle}
      ${p.hint ? `<details><summary>Need a hint?</summary><p>${p.hint}</p></details>` : ''}</div>
      <div class="card"><form id="f"><div class="kicker">Your answer</div>
      <input id="ans" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Type the solution">
      <button id="go">Check answer</button></form><p class="msg" id="m"></p></div>${logoutBtn}`);
    bindLogout();
    document.getElementById('f').onsubmit = async e => {
      e.preventDefault();
      const a = C.normAnswer(document.getElementById('ans').value); if (!a) return;
      const b = document.getElementById('go'), m = document.getElementById('m');
      b.disabled = true; m.textContent = 'Checking…'; m.className = 'msg dim';
      let res = null;
      for (const u of p.unlock) { res = await C.open(a + '|' + token, u, H.iters); if (res) break; }
      if (!res) { b.disabled = false; m.textContent = 'Not quite. Think again and try once more.'; m.className = 'msg bad'; return; }
      saveRes(p.room, res);
      solvedView(p, res, puzzle);
    };
  }

  function solvedView(p, res, puzzle) {
    const dest = res.nextRoom ? `<p>Next stop</p><div class="big">${esc(res.nextName)}</div>` :
      `<p>Final destination</p><div class="big">${esc(H.finalRoom)}</div>`;
    view(`<div class="card ok"><div class="kicker">${esc(p.roomName)} · clue ${p.stage} of ${p.of} solved</div><h2>Correct!</h2>${dest}
      ${res.extra ? `<p>${res.extra}</p>` : ''}
      <p class="dim">Digit from ${esc(p.roomName)}: <b style="color:var(--gold);font-size:22px">${esc(res.digit)}</b> — write it down.</p></div>
      <div class="card"><div class="kicker">Your progress</div>${board()}</div>
      <details class="card"><summary>Show this puzzle again</summary>${puzzle}</details>${logoutBtn}`);
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
    route();
  })();
})();
