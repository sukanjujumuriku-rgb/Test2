(() => {
  "use strict";

  const KEYS = ["d","f","g","h","j","k"];

  // D: FLICK上 = D→E OR D→R
  //    FLICK下 = D→X OR D→C
  // 以降もキーボードの物理配置に対応。
  const FLICK_TARGETS = {
    d: {up:["e","r"], down:["x","c"]},
    f: {up:["r","t"], down:["v","b"]},
    g: {up:["t","y"], down:["b","n"]},
    h: {up:["y","u"], down:["n","m"]},
    j: {up:["u","i"], down:["m",","]},
    k: {up:["i","o"], down:[",","."]}
  };

  const chartUrl = "charts/test.json";
  const TRAVEL_MS = 1700;
  const START_DELAY = 1800;
  const WINDOW = {perfect:45, great:85, good:135, miss:180};

  const game = document.getElementById("game");
  const lanesEl = document.getElementById("lanes");
  const startLayer = document.getElementById("start");
  const startButton = document.getElementById("startButton");
  const result = document.getElementById("result");
  const resultTitle = document.getElementById("result-title");
  const resultDetail = document.getElementById("result-detail");
  const scoreEl = document.getElementById("score");
  const comboEl = document.getElementById("combo");
  const accEl = document.getElementById("acc");

  const laneEls = KEYS.map((_, i) => {
    const el = document.createElement("div");
    el.className = "lane";
    el.dataset.lane = i;
    lanesEl.appendChild(el);
    return el;
  });

  let chart = null;
  let notes = [];
  let running = false;
  let startAt = 0;
  let raf = 0;

  // target key -> flick note
  const activeFlicks = new Map();
  const pressed = new Set();

  const state = {
    score:0, combo:0, maxCombo:0, judged:0,
    perfect:0, great:0, good:0, miss:0
  };

  function beatMs(beat) {
    return beat * 60000 / chart.bpm;
  }

  function resetState() {
    for (const k of Object.keys(state)) state[k] = 0;
    updateHUD();
  }

  function updateHUD() {
    const n = state.judged;
    const weighted = state.perfect + state.great * .8 + state.good * .5;
    const acc = n ? weighted / n * 100 : 100;
    scoreEl.textContent = `SCORE ${String(Math.floor(state.score)).padStart(6,"0")}`;
    comboEl.textContent = `COMBO ${state.combo}`;
    accEl.textContent = `${acc.toFixed(2)}%`;
  }

  function isSim(note) {
    return note.group !== null && note.group !== undefined;
  }

  function flickSVG(direction, sim) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.classList.add("flick-svg");

    const p = document.createElementNS("http://www.w3.org/2000/svg","polyline");
    // 画像のジグザグを上下FLICK用に簡略化
    p.setAttribute("points",
      direction === "up"
        ? "2,42 25,8 48,27 78,3"
        : "2,3 28,41 49,22 78,46"
    );
    p.setAttribute("stroke", sim ? "#ffe69d" : "#ed78eb");
    p.setAttribute("stroke-width","8");
    p.setAttribute("fill","none");
    svg.appendChild(p);
    return svg;
  }

  function createElement(note) {
    const el = document.createElement("div");
    const simClass = isSim(note) ? " sim" : "";

    if (note.type === "tap") {
      el.className = `note note-rect${simClass}`;
    } else if (note.type === "hold") {
      el.className = `note note-hold${simClass}`;
    } else if (note.type === "flick-up") {
      el.className = `note note-flick flick-up${simClass}`;
      el.appendChild(flickSVG("up", isSim(note)));
    } else if (note.type === "flick-down") {
      el.className = `note note-flick flick-down${simClass}`;
      el.appendChild(flickSVG("down", isSim(note)));
    }

    laneEls[note.lane].appendChild(el);
    note.el = el;
  }

  function normalizeType(type) {
    const t = String(type).toLowerCase();
    if (t === "flickup" || t === "flick_up") return "flick-up";
    if (t === "flickdown" || t === "flick_down") return "flick-down";
    return t;
  }

  function prepareNotes() {
    laneEls.forEach(lane => lane.querySelectorAll(".note").forEach(n => n.remove()));

    notes = (chart.notes || [])
      .map((n, id) => {
        const type = normalizeType(n.type);
        return {
          id,
          lane:Number(n.lane),
          type,
          direction:type === "flick-up" ? "up" : type === "flick-down" ? "down" : null,
          group:n.group ?? null,
          time:beatMs(Number(n.beat || 0)),
          endTime:type === "hold"
            ? beatMs(Number(n.beat || 0) + Number(n.durationBeats || 1))
            : null,
          state:"pending",
          el:null,
          flickStarted:false
        };
      })
      .filter(n =>
        Number.isInteger(n.lane) &&
        n.lane >= 0 && n.lane < 6 &&
        ["tap","hold","flick-up","flick-down"].includes(n.type)
      )
      .sort((a,b) => a.time - b.time);

    notes.forEach(createElement);
  }

  async function loadChart() {
    const res = await fetch(chartUrl, {cache:"no-store"});
    if (!res.ok) throw new Error("charts/test.json を読み込めませんでした。");
    chart = await res.json();
    prepareNotes();
  }

  function now() {
    return performance.now() - startAt - START_DELAY;
  }

  function classify(diff) {
    const a = Math.abs(diff);
    if (a <= WINDOW.perfect) return "PERFECT";
    if (a <= WINDOW.great) return "GREAT";
    if (a <= WINDOW.good) return "GOOD";
    if (a <= WINDOW.miss) return "MISS";
    return null;
  }

  function judge(note, judgement) {
    if (note.state !== "pending") return;

    note.state = judgement === "MISS" ? "miss" : "hit";
    state.judged++;
    state[judgement.toLowerCase()]++;

    if (judgement === "MISS") {
      state.combo = 0;
    } else {
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      state.score += ({PERFECT:1000,GREAT:750,GOOD:500}[judgement] || 0);
      state.score += Math.min(state.combo,100) * 2;
    }

    note.el?.classList.add("hit");
    setTimeout(() => note.el?.remove(), 100);
    updateHUD();
  }

  function startHold(note, judgement) {
    note.state = "holding";
    state.judged++;
    state[judgement.toLowerCase()]++;

    if (judgement === "MISS") {
      state.combo = 0;
    } else {
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      state.score += ({PERFECT:1000,GREAT:750,GOOD:500}[judgement] || 0);
    }

    updateHUD();
  }

  function findNote(lane, t, types) {
    let best = null;
    let bestAbs = Infinity;

    for (const n of notes) {
      if (n.lane !== lane || n.state !== "pending") continue;
      if (types && !types.includes(n.type)) continue;

      const a = Math.abs(t - n.time);
      if (a <= WINDOW.miss && a < bestAbs) {
        best = n;
        bestAbs = a;
      }
      if (n.time > t + WINDOW.miss) break;
    }
    return best;
  }

  function beginFlick(note, key) {
    const targets = FLICK_TARGETS[key]?.[note.direction];
    if (!targets) return;

    // 2つの終点のどちらでも成功。
    targets.forEach(target => activeFlicks.set(target, note));
    note.flickStarted = true;
  }

  function finishFlick(targetKey, t) {
    const note = activeFlicks.get(targetKey);
    if (!note || note.state !== "pending") return false;

    const j = classify(t - note.time);
    if (!j) return false;

    judge(note, j);

    for (const [key, same] of activeFlicks.entries()) {
      if (same === note) activeFlicks.delete(key);
    }
    return true;
  }

  function onKeyDown(e) {
    const key = e.key.toLowerCase();

    if (pressed.has(key)) return;
    pressed.add(key);

    if (!running) return;

    const t = now();

    // FLICK終点。途中の別キー入力はここでは無視される。
    if (finishFlick(key, t)) {
      e.preventDefault();
      return;
    }

    const lane = KEYS.indexOf(key);
    if (lane < 0) return;
    e.preventDefault();

    // FLICK開始
    const flick = findNote(lane, t, ["flick-up","flick-down"]);
    if (flick) {
      beginFlick(flick, key);
      return;
    }

    // TAP / HOLD
    const note = findNote(lane, t, ["tap","hold"]);
    if (!note) return;

    const j = classify(t - note.time);
    if (!j) return;

    if (note.type === "tap") judge(note, j);
    else startHold(note, j);
  }

  function onKeyUp(e) {
    const key = e.key.toLowerCase();
    pressed.delete(key);

    if (!running) return;

    const lane = KEYS.indexOf(key);
    if (lane < 0) return;

    const t = now();
    const hold = notes.find(n =>
      n.type === "hold" &&
      n.lane === lane &&
      n.state === "holding"
    );

    if (!hold) return;

    if (t < hold.endTime - 90) {
      hold.state = "miss";
      state.miss++;
      state.combo = 0;
      updateHUD();
    } else {
      hold.state = "hit";
      hold.el?.remove();
      state.score += 1200;
      updateHUD();
    }
  }

  function autoMiss(t) {
    for (const n of notes) {
      if (n.state === "pending" && t - n.time > WINDOW.miss) {
        judge(n, "MISS");
      }

      if (
        n.flickStarted &&
        n.state === "pending" &&
        t - n.time > 260
      ) {
        judge(n, "MISS");
        for (const [key, same] of activeFlicks.entries()) {
          if (same === n) activeFlicks.delete(key);
        }
      }
    }
  }

  function render(t) {
    const judgeY = game.clientHeight - 28;
    for (const n of notes) {
      if (!n.el || n.state === "hit" || n.state === "miss") continue;

      const delta = n.time - t;
      const y = judgeY - (delta / TRAVEL_MS) * (judgeY + 60);
      n.el.style.top = `${y}px`;
    }
  }

  function finish() {
    running = false;
    cancelAnimationFrame(raf);

    const acc = state.judged
      ? (state.perfect + state.great*.8 + state.good*.5) / state.judged * 100
      : 100;

    resultTitle.textContent = "RESULT";
    resultDetail.innerHTML =
      `SCORE ${String(Math.floor(state.score)).padStart(6,"0")}<br>` +
      `MAX COMBO ${state.maxCombo}<br>` +
      `PERFECT ${state.perfect} / GREAT ${state.great} / GOOD ${state.good} / MISS ${state.miss}<br>` +
      `${acc.toFixed(2)}%`;

    result.style.display = "block";
    startLayer.style.display = "grid";
    startButton.textContent = "RESTART";
  }

  function loop() {
    if (!running) return;

    const t = now();
    render(t);
    autoMiss(t);

    const last = notes[notes.length - 1];
    const end = last ? Math.max(last.time, last.endTime || 0) + 900 : 2000;

    if (t > end) {
      finish();
      return;
    }

    raf = requestAnimationFrame(loop);
  }

  async function start() {
    try {
      if (!chart) await loadChart();

      cancelAnimationFrame(raf);
      resetState();
      activeFlicks.clear();
      pressed.clear();
      prepareNotes();

      result.style.display = "none";
      startLayer.style.display = "none";

      running = true;
      startAt = performance.now();
      raf = requestAnimationFrame(loop);
    } catch (err) {
      result.style.display = "block";
      resultTitle.textContent = "ERROR";
      resultDetail.textContent = err.message;
    }
  }

  document.addEventListener("keydown", onKeyDown, {passive:false});
  document.addEventListener("keyup", onKeyUp, {passive:false});
  window.addEventListener("blur", () => {
    activeFlicks.clear();
    pressed.clear();
  });

  startButton.addEventListener("click", start);

  loadChart().catch(err => {
    result.style.display = "block";
    resultTitle.textContent = "ERROR";
    resultDetail.textContent = err.message;
  });

  resetState();
})();
