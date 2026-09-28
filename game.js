(() => {
  "use strict";

  const KEYS = ["d","f","g","h","j","k"];

  /*
    FLICK:
      D の FLICK上 = D→E または D→R
      D の FLICK下 = D→X または D→C

    途中で他のキーに触れてもOK。
    有効な2つの終点のどちらかを押せば成功。
  */
  const FLICK_TARGETS = {
    d:{up:["e","r"],down:["x","c"]},
    f:{up:["r","t"],down:["v","b"]},
    g:{up:["t","y"],down:["b","n"]},
    h:{up:["y","u"],down:["n","m"]},
    j:{up:["u","i"],down:["m",","]},
    k:{up:["i","o"],down:[",","."]}
  };

  const chartUrl = "charts/test.json";
  const TRAVEL_MS = 1700;
  const START_DELAY = 1800;
  const WINDOW = {perfect:45, great:85, good:135, miss:180};

  const game = document.getElementById("game");
  const lanesWrap = document.getElementById("lanes");
  const startLayer = document.getElementById("start");
  const startButton = document.getElementById("startButton");
  const result = document.getElementById("result");
  const resultTitle = document.getElementById("resultTitle");
  const resultDetail = document.getElementById("resultDetail");
  const scoreEl = document.getElementById("score");
  const comboEl = document.getElementById("combo");
  const accuracyEl = document.getElementById("accuracy");

  const laneEls = KEYS.map((_, i) => {
    const lane = document.createElement("div");
    lane.className = "lane";
    lane.dataset.lane = i;
    lanesWrap.appendChild(lane);
    return lane;
  });

  let chart = null;
  let notes = [];
  let running = false;
  let raf = 0;
  let startedAt = 0;

  const pressed = new Set();
  // target key -> flick note
  const activeFlicks = new Map();

  const state = {
    score:0, combo:0, maxCombo:0, judged:0,
    perfect:0, great:0, good:0, miss:0
  };

  function beatMs(beat){
    return beat * 60000 / (chart.bpm || 120);
  }

  function resetState(){
    for(const k of Object.keys(state)) state[k] = 0;
    updateHUD();
  }

  function updateHUD(){
    const total = state.judged;
    const weighted = state.perfect + state.great*0.8 + state.good*0.5;
    const acc = total ? weighted/total*100 : 100;
    scoreEl.textContent = `SCORE ${String(Math.floor(state.score)).padStart(6,"0")}`;
    comboEl.textContent = `COMBO ${state.combo}`;
    accuracyEl.textContent = `${acc.toFixed(2)}%`;
  }

  function normalizeType(t){
    const s = String(t).toLowerCase();
    if(s === "flickup" || s === "flick_up") return "flick-up";
    if(s === "flickdown" || s === "flick_down") return "flick-down";
    return s;
  }

  function simultaneous(note){
    return note.group !== null && note.group !== undefined;
  }

  function createFlickSVG(direction, sim){
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns,"svg");
    svg.classList.add("flick-svg");

    const line = document.createElementNS(ns,"line");
    const arrow = document.createElementNS(ns,"polygon");

    if(direction === "up"){
      // 紫の ↑
      line.setAttribute("x1","24");
      line.setAttribute("y1","46");
      line.setAttribute("x2","24");
      line.setAttribute("y2","12");
      arrow.setAttribute("points","24,2 8,18 40,18");
    }else{
      // 紫の ↓
      line.setAttribute("x1","24");
      line.setAttribute("y1","8");
      line.setAttribute("x2","24");
      line.setAttribute("y2","42");
      arrow.setAttribute("points","24,52 8,36 40,36");
    }

    if(sim){
      line.style.stroke = "#ffe69d";
      arrow.style.fill = "#ffe69d";
    }

    svg.append(line, arrow);
    return svg;
  }

  /*
    HOLDの見た目:
      ┌────────┐  ← 頭
      │ ピンク │
      └────────┘
           ⋮
           ⋮       ← 黒い点線
           ⋮
      ┌────────┐
      │ ピンク │  ← 終端
      └────────┘

    画像左側のデザインをそのままゲームノート化。
  */
  function createHoldElement(note){
    const el = document.createElement("div");
    el.className = "note note-hold" + (simultaneous(note) ? " sim" : "");

    const head = document.createElement("div");
    head.className = "hold-head";

    const dotted = document.createElement("div");
    dotted.className = "hold-dotted-line";

    const tail = document.createElement("div");
    tail.className = "hold-tail";

    el.append(head, dotted, tail);
    laneEls[note.lane].appendChild(el);
    note.el = el;
  }

  function createElement(note){
    if(note.type === "hold"){
      createHoldElement(note);
      return;
    }

    const el = document.createElement("div");

    if(note.type === "tap"){
      el.className = "note note-rect" + (simultaneous(note) ? " sim" : "");
    }else if(note.type === "flick-up" || note.type === "flick-down"){
      el.className =
        `note note-flick ${note.type}` +
        (simultaneous(note) ? " sim" : "");
      el.appendChild(createFlickSVG(note.direction, simultaneous(note)));
    }

    laneEls[note.lane].appendChild(el);
    note.el = el;
  }

  function prepareNotes(){
    laneEls.forEach(lane => {
      lane.querySelectorAll(".note").forEach(el => el.remove());
    });

    notes = (chart.notes || [])
      .map((n,id) => {
        const type = normalizeType(n.type);
        return {
          id,
          lane:Number(n.lane),
          type,
          direction:type === "flick-up" ? "up" :
                   type === "flick-down" ? "down" : null,
          group:n.group ?? null,
          time:beatMs(Number(n.beat || 0)),
          endTime:type === "hold"
            ? beatMs(Number(n.beat || 0) + Number(n.durationBeats || 1))
            : null,
          state:"pending",
          flickStarted:false,
          el:null
        };
      })
      .filter(n =>
        Number.isInteger(n.lane) && n.lane >= 0 && n.lane < 6 &&
        ["tap","hold","flick-up","flick-down"].includes(n.type)
      )
      .sort((a,b) => a.time - b.time);

    notes.forEach(createElement);
  }

  async function loadChart(){
    const res = await fetch(chartUrl,{cache:"no-store"});
    if(!res.ok) throw new Error("charts/test.json を読み込めませんでした。");
    chart = await res.json();
    prepareNotes();
  }

  function now(){
    return performance.now() - startedAt - START_DELAY;
  }

  function classify(diff){
    const a = Math.abs(diff);
    if(a <= WINDOW.perfect) return "PERFECT";
    if(a <= WINDOW.great) return "GREAT";
    if(a <= WINDOW.good) return "GOOD";
    if(a <= WINDOW.miss) return "MISS";
    return null;
  }

  function judge(note, judgement){
    if(note.state !== "pending") return;

    note.state = judgement === "MISS" ? "miss" : "hit";
    state.judged++;
    state[judgement.toLowerCase()]++;

    if(judgement === "MISS"){
      state.combo = 0;
    }else{
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo,state.combo);
      state.score += ({PERFECT:1000,GREAT:750,GOOD:500}[judgement] || 0);
      state.score += Math.min(state.combo,100)*2;
    }

    note.el?.classList.add("hit");
    setTimeout(() => note.el?.remove(),100);
    updateHUD();
  }

  function startHold(note, judgement){
    if(note.state !== "pending") return;

    note.state = "holding";
    state.judged++;
    state[judgement.toLowerCase()]++;

    if(judgement === "MISS"){
      state.combo = 0;
    }else{
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo,state.combo);
      state.score += ({PERFECT:1000,GREAT:750,GOOD:500}[judgement] || 0);
    }

    updateHUD();
  }

  function findNote(lane,t,types){
    let best = null;
    let bestAbs = Infinity;

    for(const n of notes){
      if(n.lane !== lane || n.state !== "pending") continue;
      if(types && !types.includes(n.type)) continue;

      const a = Math.abs(t-n.time);
      if(a <= WINDOW.miss && a < bestAbs){
        best = n;
        bestAbs = a;
      }
      if(n.time > t + WINDOW.miss) break;
    }

    return best;
  }

  function beginFlick(note,startKey){
    const targets = FLICK_TARGETS[startKey]?.[note.direction];
    if(!targets) return;

    // 上なら2キー、下なら2キーのどちらでも終点として認める。
    for(const key of targets) activeFlicks.set(key,note);
    note.flickStarted = true;
  }

  function finishFlick(targetKey,t){
    const note = activeFlicks.get(targetKey);
    if(!note || note.state !== "pending") return false;

    const judgement = classify(t-note.time);
    if(!judgement) return false;

    judge(note,judgement);

    for(const [key,same] of activeFlicks.entries()){
      if(same === note) activeFlicks.delete(key);
    }
    return true;
  }

  function keyDown(event){
    const key = event.key.toLowerCase();
    if(pressed.has(key)) return;
    pressed.add(key);

    if(!running) return;

    const t = now();

    // FLICK終点を先に見る。
    if(finishFlick(key,t)){
      event.preventDefault();
      return;
    }

    const lane = KEYS.indexOf(key);
    if(lane < 0) return;

    event.preventDefault();

    // FLICK開始
    const flick = findNote(lane,t,["flick-up","flick-down"]);
    if(flick){
      beginFlick(flick,key);
      return;
    }

    // TAP / HOLD
    const note = findNote(lane,t,["tap","hold"]);
    if(!note) return;

    const judgement = classify(t-note.time);
    if(!judgement) return;

    if(note.type === "tap"){
      judge(note,judgement);
    }else{
      startHold(note,judgement);
    }
  }

  function keyUp(event){
    const key = event.key.toLowerCase();
    pressed.delete(key);

    if(!running) return;

    const lane = KEYS.indexOf(key);
    if(lane < 0) return;

    const t = now();
    const hold = notes.find(n =>
      n.type === "hold" &&
      n.lane === lane &&
      n.state === "holding"
    );
    if(!hold) return;

    if(t < hold.endTime - 90){
      hold.state = "miss";
      state.miss++;
      state.combo = 0;
      updateHUD();
    }else{
      hold.state = "hit";
      hold.el?.remove();
      state.score += 1200;
      updateHUD();
    }
  }

  function autoMiss(t){
    for(const n of notes){
      if(n.state === "pending" && t-n.time > WINDOW.miss){
        judge(n,"MISS");
      }

      if(
        (n.type === "flick-up" || n.type === "flick-down") &&
        n.flickStarted &&
        n.state === "pending" &&
        t-n.time > 260
      ){
        judge(n,"MISS");

        for(const [key,same] of activeFlicks.entries()){
          if(same === n) activeFlicks.delete(key);
        }
      }
    }
  }

  function render(t){
    const judgeY = game.clientHeight - 28;

    for(const n of notes){
      if(!n.el || n.state === "hit" || n.state === "miss") continue;

      if(n.type === "hold"){
        // 頭が判定ラインへ向かい、終端は duration 分だけ下に残る。
        const headY = judgeY - ((n.time-t)/TRAVEL_MS)*(judgeY+60);
        const tailY = judgeY - ((n.endTime-t)/TRAVEL_MS)*(judgeY+60);
        const top = Math.min(headY,tailY);
        const bottom = Math.max(headY,tailY);

        n.el.style.top = `${top}px`;
        n.el.style.height = `${Math.max(30,bottom-top)}px`;

        const dotted = n.el.querySelector(".hold-dotted-line");
        dotted.style.top = "15px";
        dotted.style.bottom = "15px";
      }else{
        const y = judgeY - ((n.time-t)/TRAVEL_MS)*(judgeY+60);
        n.el.style.top = `${y}px`;
      }
    }
  }

  function finish(){
    running = false;
    cancelAnimationFrame(raf);

    const acc = state.judged
      ? (state.perfect + state.great*.8 + state.good*.5)/state.judged*100
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

  function loop(){
    if(!running) return;

    const t = now();
    render(t);
    autoMiss(t);

    const last = notes[notes.length-1];
    const end = last ? Math.max(last.time,last.endTime || 0)+900 : 2000;

    if(t > end){
      finish();
      return;
    }

    raf = requestAnimationFrame(loop);
  }

  async function start(){
    try{
      if(!chart) await loadChart();

      cancelAnimationFrame(raf);
      resetState();
      pressed.clear();
      activeFlicks.clear();
      prepareNotes();

      result.style.display = "none";
      startLayer.style.display = "none";

      running = true;
      startedAt = performance.now();
      raf = requestAnimationFrame(loop);
    }catch(error){
      result.style.display = "block";
      resultTitle.textContent = "ERROR";
      resultDetail.textContent = error.message;
    }
  }

  document.addEventListener("keydown",keyDown,{passive:false});
  document.addEventListener("keyup",keyUp,{passive:false});
  window.addEventListener("blur",() => {
    pressed.clear();
    activeFlicks.clear();
  });
  startButton.addEventListener("click",start);

  resetState();
  loadChart().catch(error => {
    result.style.display = "block";
    resultTitle.textContent = "ERROR";
    resultDetail.textContent = error.message;
  });
})();
