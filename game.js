(() => {
  "use strict";

  /*
    DFGHJK
    6 lanes
    TAP / HOLD / FLICK
    同時押し = group が同じ → 黄色
    HOLD = 始点だけ表示
    FLICK = 始点キーを押してから指定方向のキーへ。
             途中で別キーに触れても無効扱いにはしない。
  */

  const KEYS = ["d","f","g","h","j","k"];

  const FLICK_KEYS = {
    d: {"up-left":"e","up-right":"r","down-left":"x","down-right":"c"},
    f: {"up-left":"r","up-right":"t","down-left":"v","down-right":"b"},
    g: {"up-left":"t","up-right":"y","down-left":"b","down-right":"n"},
    h: {"up-left":"y","up-right":"u","down-left":"n","down-right":"m"},
    j: {"up-left":"u","up-right":"i","down-left":"m","down-right":","},
    k: {"up-left":"i","up-right":"o","down-left":",","down-right":"."}
  };

  const BEATS_PER_MINUTE = 120;
  const START_DELAY = 1800;
  const TRAVEL_MS = 1700;

  const WINDOW = {
    perfect: 45,
    great: 85,
    good: 135,
    miss: 180
  };

  const game = document.getElementById("game");
  const lanesWrap = document.getElementById("lanes");
  const startLayer = document.getElementById("start");
  const startButton = document.getElementById("startButton");
  const result = document.getElementById("result");
  const resultTitle = document.getElementById("result-title");
  const resultDetail = document.getElementById("result-detail");
  const scoreEl = document.getElementById("score");
  const comboEl = document.getElementById("combo");
  const accEl = document.getElementById("acc");

  const laneEls = KEYS.map((key, i) => {
    const lane = document.createElement("div");
    lane.className = "lane";
    lane.dataset.lane = i;
    lanesWrap.appendChild(lane);
    return lane;
  });

  const chart = {
    title: "DFGHJK TEST",
    bpm: BEATS_PER_MINUTE,
    notes: [
      /* 通常TAP */
      {beat: 0, lane: 0, type: "tap"},
      {beat: 1, lane: 1, type: "tap"},
      {beat: 2, lane: 2, type: "tap"},
      {beat: 3, lane: 3, type: "tap"},
      {beat: 4, lane: 4, type: "tap"},
      {beat: 5, lane: 5, type: "tap"},

      /* 同時押し：黄色 */
      {beat: 6, lane: 0, type: "tap", group: 1},
      {beat: 6, lane: 5, type: "tap", group: 1},

      /* HOLD：始点だけ */
      {beat: 8, lane: 1, type: "hold", durationBeats: 3},

      /* 4方向FLICK */
      {beat: 12, lane: 0, type: "flick", direction: "up-left"},
      {beat: 13, lane: 0, type: "flick", direction: "up-right"},
      {beat: 14, lane: 0, type: "flick", direction: "down-left"},
      {beat: 15, lane: 0, type: "flick", direction: "down-right"},

      /* 6キー同時 */
      {beat: 17, lane: 0, type: "tap", group: 2},
      {beat: 17, lane: 1, type: "tap", group: 2},
      {beat: 17, lane: 2, type: "tap", group: 2},
      {beat: 17, lane: 3, type: "tap", group: 2},
      {beat: 17, lane: 4, type: "tap", group: 2},
      {beat: 17, lane: 5, type: "tap", group: 2},

      /* 実際のキーボードを使ったFLICK */
      {beat: 20, lane: 1, type: "flick", direction: "up-left"},
      {beat: 21, lane: 2, type: "flick", direction: "up-right"},
      {beat: 22, lane: 3, type: "flick", direction: "down-left"},
      {beat: 23, lane: 4, type: "flick", direction: "down-right"},

      {beat: 25, lane: 5, type: "hold", durationBeats: 2}
    ]
  };

  let notes = [];
  let running = false;
  let startAt = 0;
  let raf = 0;

  const activeFlicks = new Map();
  const pressed = new Set();

  const state = {
    score: 0,
    combo: 0,
    maxCombo: 0,
    judged: 0,
    perfect: 0,
    great: 0,
    good: 0,
    miss: 0
  };

  function beatMs(beat) {
    return beat * 60000 / chart.bpm;
  }

  function resetState() {
    for (const k of Object.keys(state)) state[k] = 0;
    updateHud();
  }

  function updateHud() {
    const total = state.judged;
    const weighted = state.perfect + state.great * .8 + state.good * .5;
    const accuracy = total ? weighted / total * 100 : 100;

    scoreEl.textContent = `SCORE ${String(Math.floor(state.score)).padStart(6, "0")}`;
    comboEl.textContent = `COMBO ${state.combo}`;
    accEl.textContent = `${accuracy.toFixed(2)}%`;
  }

  function isSimultaneous(note) {
    return note.group !== null && note.group !== undefined;
  }

  function createFlickSVG(direction, simultaneous) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("flick-svg");
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");

    let points;

    switch (direction) {
      case "up-left":
        points = "2,43 27,8 78,43";
        break;
      case "up-right":
        points = "2,8 53,43 78,8";
        break;
      case "down-left":
        points = "2,7 31,43 78,7";
        break;
      case "down-right":
        points = "2,7 49,43 78,7";
        break;
      default:
        points = "2,43 40,5 78,43";
    }

    poly.setAttribute("points", points);
    if (simultaneous) poly.style.stroke = "#ffe69d";
    svg.appendChild(poly);
    return svg;
  }

  function createElement(note) {
    const el = document.createElement("div");
    el.className = `note note-${note.type}`;

    if (note.type === "flick") {
      if (isSimultaneous(note)) el.classList.add("sim");
      el.appendChild(createFlickSVG(note.direction, isSimultaneous(note)));
    } else {
      el.classList.add(note.type === "hold" ? "note-hold" : "note-rect");
      if (isSimultaneous(note)) el.classList.add("sim");
    }

    laneEls[note.lane].appendChild(el);
    note.el = el;
  }

  function prepareNotes() {
    notes.forEach(n => n.el?.remove());

    notes = chart.notes
      .map((n, index) => ({
        id: index,
        lane: n.lane,
        type: n.type,
        direction: n.direction || null,
        group: n.group ?? null,
        time: beatMs(n.beat),
        endTime: n.type === "hold" ? beatMs(n.beat + (n.durationBeats || 1)) : null,
        state: "pending",
        el: null
      }))
      .sort((a,b) => a.time - b.time);

    notes.forEach(createElement);
  }

  function now() {
    return performance.now() - startAt - START_DELAY;
  }

  function judge(note, type) {
    if (note.state !== "pending") return;

    note.state = type === "MISS" ? "miss" : "hit";
    state.judged++;
    state[type.toLowerCase()]++;

    if (type === "MISS") {
      state.combo = 0;
    } else {
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      state.score += ({PERFECT:1000, GREAT:750, GOOD:500})[type] || 0;
      state.score += Math.min(state.combo, 100) * 2;
    }

    note.el?.classList.add("hit");
    setTimeout(() => note.el?.remove(), 100);

    updateHud();
  }

  function classify(diff) {
    const a = Math.abs(diff);
    if (a <= WINDOW.perfect) return "PERFECT";
    if (a <= WINDOW.great) return "GREAT";
    if (a <= WINDOW.good) return "GOOD";
    if (a <= WINDOW.miss) return "MISS";
    return null;
  }

  function findNote(lane, t, kind = null) {
    let best = null;
    let bestAbs = Infinity;

    for (const n of notes) {
      if (n.lane !== lane || n.state !== "pending") continue;
      if (kind && n.type !== kind) continue;

      const diff = t - n.time;
      const a = Math.abs(diff);

      if (a <= WINDOW.miss && a < bestAbs) {
        best = n;
        bestAbs = a;
      }

      if (n.time > t + WINDOW.miss) break;
    }

    return best;
  }

  function keyDown(event) {
    const key = event.key.toLowerCase();
    if (pressed.has(key)) return;
    pressed.add(key);

    if (!running) return;

    const t = now();

    /* FLICKの終点。
       始点から終点までの間に他キーを押しても問題なし。 */
    if (activeFlicks.has(key)) {
      const note = activeFlicks.get(key);
      const j = classify(t - note.time);
      if (j) {
        judge(note, j);
        activeFlicks.delete(key);
        return;
      }
    }

    const lane = KEYS.indexOf(key);
    if (lane < 0) return;

    event.preventDefault();

    /* FLICKの始点 */
    const flick = findNote(lane, t, "flick");
    if (flick) {
      const target = FLICK_KEYS[key]?.[flick.direction];
      if (target) {
        activeFlicks.set(target, flick);
        return;
      }
    }

    /* TAP / HOLD */
    const note = findNote(lane, t);
    if (!note) return;

    const j = classify(t - note.time);
    if (!j) return;

    if (note.type === "tap") {
      judge(note, j);
    } else if (note.type === "hold") {
      if (j === "MISS") {
        judge(note, j);
      } else {
        note.state = "holding";
        state.judged++;
        state[j.toLowerCase()]++;
        state.combo++;
        state.maxCombo = Math.max(state.maxCombo, state.combo);
        state.score += ({PERFECT:1000, GREAT:750, GOOD:500})[j] || 0;
        note.el?.classList.add("hit");
        updateHud();
      }
    }
  }

  function keyUp(event) {
    const key = event.key.toLowerCase();
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
      updateHud();
    } else {
      hold.state = "hit";
      hold.el?.remove();
      state.score += 1200;
      updateHud();
    }
  }

  function missOldNotes(t) {
    for (const n of notes) {
      if (n.state === "pending" && t - n.time > WINDOW.miss) {
        judge(n, "MISS");
      }

      if (n.type === "flick" && n.state === "pending") {
        let pending = false;
        for (const flick of activeFlicks.values()) {
          if (flick === n) {
            pending = true;
            break;
          }
        }
        if (pending && t - n.time > 230) {
          judge(n, "MISS");
          for (const [target, flick] of activeFlicks.entries()) {
            if (flick === n) activeFlicks.delete(target);
          }
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

    const accuracy = state.judged
      ? (state.perfect + state.great*.8 + state.good*.5) / state.judged * 100
      : 100;

    resultTitle.textContent = "RESULT";
    resultDetail.innerHTML =
      `SCORE ${String(Math.floor(state.score)).padStart(6,"0")}<br>` +
      `MAX COMBO ${state.maxCombo}<br>` +
      `PERFECT ${state.perfect} / GREAT ${state.great} / GOOD ${state.good} / MISS ${state.miss}<br>` +
      `${accuracy.toFixed(2)}%`;

    result.style.display = "block";
    startButton.textContent = "RESTART";
    startLayer.style.display = "grid";
  }

  function loop() {
    if (!running) return;

    const t = now();
    render(t);
    missOldNotes(t);

    const last = notes[notes.length - 1];
    const end = last ? Math.max(last.time, last.endTime || 0) + 900 : 2000;

    if (t > end) {
      finish();
      return;
    }

    raf = requestAnimationFrame(loop);
  }

  function start() {
    cancelAnimationFrame(raf);
    result.style.display = "none";
    startLayer.style.display = "none";
    activeFlicks.clear();
    pressed.clear();
    resetState();
    prepareNotes();

    running = true;
    startAt = performance.now();
    raf = requestAnimationFrame(loop);
  }

  document.addEventListener("keydown", keyDown, {passive:false});
  document.addEventListener("keyup", keyUp, {passive:false});

  window.addEventListener("blur", () => {
    activeFlicks.clear();
    pressed.clear();
  });

  startButton.addEventListener("click", start);

  resetState();
  prepareNotes();
})();
