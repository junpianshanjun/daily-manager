"use strict";
/* フィールド移動・タイトル・セーブ・メッセージ表示・入力統合 */
const Game = (() => {
  const SAVE_KEY = "commandRpg_save_v1";
  const TILE_PX = 24;
  let DATA = null;
  let player = null;
  let pos = { x: 2, y: 18 };
  let pix = { x: 2 * TILE_PX, y: 18 * TILE_PX };
  let moving = null; // {dx,dy,tx,ty,progress}
  let bossDefeated = false;
  let started = false;
  const held = new Set();

  /* ---------- メッセージ（タイプライター＋早送り） ---------- */
  const msgEl = () => document.getElementById("messageText");
  const cursorEl = () => document.getElementById("messageCursor");
  let msg = null; // {full, shown, timer, autoTimer, resolve}
  function showMessage(text) {
    return new Promise((resolve) => {
      if (msg && msg.resolve) msg.resolve();
      msg = { full: text, shown: 0, resolve, timer: null, autoTimer: null };
      cursorEl().classList.add("hidden");
      msgEl().textContent = "";
      msg.timer = setInterval(() => {
        if (!msg) return;
        msg.shown += 1;
        msgEl().textContent = msg.full.slice(0, msg.shown);
        if (msg.shown >= msg.full.length) finishTyping();
      }, 18);
    });
  }
  function finishTyping() {
    if (!msg) return;
    clearInterval(msg.timer);
    msgEl().textContent = msg.full;
    cursorEl().classList.remove("hidden");
    msg.autoTimer = setTimeout(() => resolveMsg(), 1400);
  }
  function resolveMsg() {
    if (!msg) return;
    clearInterval(msg.timer); clearTimeout(msg.autoTimer);
    cursorEl().classList.add("hidden");
    const r = msg.resolve; msg = null;
    if (r) r();
  }
  function pressConfirm() {
    if (msg) {
      if (msg.shown < msg.full.length) { msg.shown = msg.full.length; finishTyping(); }
      else resolveMsg();
      return true;
    }
    return false;
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /* ---------- ステータス ---------- */
  function expNext(level) {
    const h = DATA.characters.hero;
    return h.expNextBase + (level - 1) * h.expNextPerLevel;
  }
  function newPlayer() {
    const h = DATA.characters.hero;
    return {
      name: h.name, level: h.base.level, exp: 0, gold: 0, potions: h.startPotions,
      maxHp: h.base.maxHp, hp: h.base.maxHp, maxMp: h.base.maxMp, mp: h.base.maxMp,
      atk: h.base.atk, def: h.base.def, spd: h.base.spd,
    };
  }
  function updateHUD() {
    if (!player) return;
    document.getElementById("hudName").textContent = player.name;
    document.getElementById("hudLv").textContent = `Lv ${player.level}`;
    document.getElementById("hudHp").textContent = `HP ${player.hp}/${player.maxHp}`;
    document.getElementById("hudMp").textContent = `MP ${player.mp}/${player.maxMp}`;
    document.getElementById("hudGold").textContent = `${player.gold} G`;
    document.getElementById("hudPotion").textContent = `やくそう ${player.potions}`;
  }

  /* ---------- セーブ ---------- */
  function saveGame(auto) {
    if (!player) return;
    localStorage.setItem(SAVE_KEY, JSON.stringify({ player, pos, bossDefeated, savedAt: Date.now() }));
    if (!auto) { Sound.se.save(); showMessage("ぼうけんの書に 記録した！（セーブ完了）"); }
  }
  function loadSave() {
    try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); if (d && d.player) return d; } catch {}
    return null;
  }

  /* ---------- フィールド描画 ---------- */
  function tileAt(x, y) { return DATA.map.rows[y][x]; }
  function passable(x, y) {
    if (x < 0 || y < 0 || x >= DATA.map.width || y >= DATA.map.height) return false;
    const t = DATA.map.tiles[tileAt(x, y)];
    return t && t.passable;
  }
  function speckle(x, y, n) { return ((x * 31 + y * 17 + n * 7) % 5); }
  function drawField() {
    const cv = document.getElementById("fieldCanvas");
    const ctx = cv.getContext("2d");
    const tiles = DATA.map.tiles;
    for (let y = 0; y < DATA.map.height; y++) {
      for (let x = 0; x < DATA.map.width; x++) {
        const ch = tileAt(x, y), def = tiles[ch];
        const ox = x * TILE_PX, oy = y * TILE_PX;
        ctx.fillStyle = def.colors[0];
        ctx.fillRect(ox, oy, TILE_PX, TILE_PX);
        ctx.fillStyle = def.colors[1];
        if (ch === ".") {
          if (speckle(x, y, 1) < 2) ctx.fillRect(ox + 4 + speckle(x, y, 2) * 4, oy + 14, 5, 3);
          if (speckle(x, y, 3) < 2) ctx.fillRect(ox + 14, oy + 5 + speckle(x, y, 4) * 3, 5, 3);
        } else if (ch === "F") {
          ctx.fillRect(ox + 10, oy + 15, 4, 6);
          ctx.fillStyle = def.colors[1];
          ctx.beginPath(); ctx.moveTo(ox + 12, oy + 1); ctx.lineTo(ox + 22, oy + 16); ctx.lineTo(ox + 2, oy + 16); ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#3f7d46";
          ctx.beginPath(); ctx.moveTo(ox + 12, oy + 5); ctx.lineTo(ox + 19, oy + 15); ctx.lineTo(ox + 5, oy + 15); ctx.closePath(); ctx.fill();
        } else if (ch === "#") {
          ctx.fillStyle = def.colors[1];
          ctx.beginPath(); ctx.moveTo(ox + 12, oy + 3); ctx.lineTo(ox + 22, oy + 21); ctx.lineTo(ox + 2, oy + 21); ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#e8e8f0";
          ctx.beginPath(); ctx.moveTo(ox + 12, oy + 3); ctx.lineTo(ox + 16, oy + 9); ctx.lineTo(ox + 8, oy + 9); ctx.closePath(); ctx.fill();
        } else if (ch === "S") {
          ctx.fillStyle = def.colors[1];
          ctx.fillRect(ox + 3, oy + 6, 18, 12);
          ctx.fillStyle = "#dff3ff";
          if (speckle(x, y, 1) < 3) ctx.fillRect(ox + 6 + speckle(x, y, 2) * 4, oy + 9, 3, 3);
          ctx.fillRect(ox + 15, oy + 13, 3, 3);
        } else if (ch === "B") {
          if (!bossDefeated) {
            ctx.fillStyle = "#18060c"; ctx.fillRect(ox + 3, oy + 2, 18, 20);
            ctx.fillStyle = "#ffd23e"; ctx.fillRect(ox + 8, oy + 8, 3, 3); ctx.fillRect(ox + 14, oy + 8, 3, 3);
            ctx.fillStyle = "#e8e8f0"; ctx.fillRect(ox + 9, oy + 14, 7, 3);
          }
        }
      }
    }
    drawPixelSprite(ctx, DATA.characters.hero.sprite, pix.x, pix.y, TILE_PX / 16, false);
  }

  /* ---------- 移動とマス効果 ---------- */
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  async function onStep() {
    const ch = tileAt(pos.x, pos.y);
    if (ch === "S") {
      if (player.hp < player.maxHp || player.mp < player.maxMp) {
        player.hp = player.maxHp; player.mp = player.maxMp;
        Sound.se.spring(); updateHUD(); saveGame(true);
        await showMessage("回復の泉だ！ HPとMPが 全回復した！（オートセーブ）");
      }
      return;
    }
    if (ch === "B" && !bossDefeated) {
      const boss = DATA.enemies.enemies.find(e => e.boss);
      await Battle.start(boss, true);
      return;
    }
    const def = DATA.map.tiles[ch];
    if (def.encounterRate > 0 && Math.random() < def.encounterRate) {
      const pool = DATA.enemies.enemies.filter(e => !e.boss && e.areas.includes(def.area));
      const e = pool[Math.floor(Math.random() * pool.length)];
      await Battle.start(e, false);
    }
  }
  let lastTs = 0;
  function loop(ts) {
    if (!started) return;
    const dt = Math.min(50, ts - lastTs || 16); lastTs = ts;
    if (!Battle.isActive() && !msg) {
      if (moving) {
        moving.progress += dt / 140;
        if (moving.progress >= 1) {
          pos.x = moving.tx; pos.y = moving.ty;
          pix.x = pos.x * TILE_PX; pix.y = pos.y * TILE_PX;
          moving = null;
          onStep();
        } else {
          pix.x = (pos.x + moving.dx * moving.progress) * TILE_PX;
          pix.y = (pos.y + moving.dy * moving.progress) * TILE_PX;
        }
      } else {
        for (const dir of ["up", "down", "left", "right"]) {
          if (held.has(dir)) {
            const [dx, dy] = DIRS[dir];
            const tx = pos.x + dx, ty = pos.y + dy;
            if (passable(tx, ty)) moving = { dx, dy, tx, ty, progress: 0 };
            break;
          }
        }
      }
    }
    drawField();
    requestAnimationFrame(loop);
  }

  /* ---------- 勝敗・クリア ---------- */
  function onDefeat() {
    const start = DATA.map.start;
    pos = { x: start.x, y: start.y };
    pix = { x: pos.x * TILE_PX, y: pos.y * TILE_PX };
    player.hp = Math.ceil(player.maxHp / 2);
    player.mp = player.maxMp;
    player.gold = Math.floor(player.gold / 2);
    updateHUD(); saveGame(true);
    showMessage("教会で 目覚めた。所持金の半分を 失ったが、命は助かった。（オートセーブ）");
  }
  async function onBossDefeated() {
    bossDefeated = true;
    saveGame(true);
    await showMessage("魔王を 倒した！ 世界に 平和が もどった！ ―― ステップ1 クリア！ おめでとう！");
  }
  function afterBattle() { updateHUD(); drawField(); }

  /* ---------- 入力 ---------- */
  function confirmAction() {
    Sound.unlock();
    if (pressConfirm()) return;
    if (Battle.isActive()) Battle.handleInput("confirm");
  }
  function cancelAction() {
    if (Battle.isActive()) Battle.handleInput("cancel");
    else Sound.se.cancel();
  }
  function dirAction(dir) {
    if (Battle.isActive()) {
      if (dir === "up" || dir === "down") Battle.handleInput(dir);
    }
  }
  const KEYMAP = {
    ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
  };
  document.addEventListener("keydown", (e) => {
    if (!started) return;
    if (KEYMAP[e.code]) {
      e.preventDefault();
      const dir = KEYMAP[e.code];
      if (!held.has(dir)) dirAction(dir);
      held.add(dir);
    } else if (e.code === "Enter" || e.code === "KeyZ") { e.preventDefault(); confirmAction(); }
    else if (e.code === "Escape" || e.code === "KeyX") { e.preventDefault(); cancelAction(); }
    else if (e.code === "KeyM") { toggleMute(); }
  });
  document.addEventListener("keyup", (e) => { if (KEYMAP[e.code]) held.delete(KEYMAP[e.code]); });

  function bindPad() {
    document.querySelectorAll(".pad-btn").forEach(btn => {
      const dir = btn.dataset.dir;
      const on = (e) => { e.preventDefault(); Sound.unlock(); if (!held.has(dir)) dirAction(dir); held.add(dir); };
      const off = (e) => { e.preventDefault(); held.delete(dir); };
      btn.addEventListener("pointerdown", on);
      btn.addEventListener("pointerup", off);
      btn.addEventListener("pointerleave", off);
      btn.addEventListener("pointercancel", off);
    });
    document.getElementById("padA").addEventListener("click", confirmAction);
    document.getElementById("padB").addEventListener("click", cancelAction);
    document.getElementById("messageWindow").addEventListener("click", confirmAction);
  }
  function toggleMute() {
    const m = Sound.toggleMute();
    document.getElementById("muteBtn").textContent = m ? "音：OFF" : "音：ON";
  }

  /* ---------- 開始 ---------- */
  function startGame(fromSave) {
    const save = fromSave ? loadSave() : null;
    if (save) {
      player = save.player; pos = save.pos; bossDefeated = !!save.bossDefeated;
    } else {
      player = newPlayer();
      pos = { x: DATA.map.start.x, y: DATA.map.start.y };
      bossDefeated = false;
    }
    pix = { x: pos.x * TILE_PX, y: pos.y * TILE_PX };
    document.getElementById("titleScreen").classList.add("hidden");
    document.getElementById("gameScreen").classList.remove("hidden");
    started = true;
    updateHUD(); drawField();
    document.getElementById("muteBtn").textContent = Sound.isMuted() ? "音：OFF" : "音：ON";
    requestAnimationFrame(loop);
    showMessage(save ? "ぼうけんの書から 再開した。" : "旅が 始まった！ 森や平地では 魔物が あらわれる。北東の泉で 回復、東の魔王を 倒そう！");
  }
  async function init() {
    try {
      const [c, e, s, m] = await Promise.all([
        fetch("data/characters.json").then(r => r.json()),
        fetch("data/enemies.json").then(r => r.json()),
        fetch("data/skills.json").then(r => r.json()),
        fetch("data/map.json").then(r => r.json()),
      ]);
      DATA = { characters: c, enemies: e, skills: s, map: m };
    } catch {
      document.getElementById("loadError").classList.remove("hidden");
      return;
    }
    const save = loadSave();
    const cont = document.getElementById("continueBtn");
    if (save) {
      cont.disabled = false;
      document.getElementById("titleNote").textContent = `セーブデータ：Lv ${save.player.level}（タップで再開）`;
    } else {
      cont.disabled = true;
      document.getElementById("titleNote").textContent = "セーブデータは まだありません";
    }
    document.getElementById("newGameBtn").addEventListener("click", () => {
      Sound.unlock(); Sound.se.confirm();
      if (loadSave() && !confirm("セーブデータを 消して 最初から 始めますか？")) return;
      startGame(false);
    });
    cont.addEventListener("click", () => { Sound.unlock(); Sound.se.confirm(); startGame(true); });
    document.getElementById("saveBtn").addEventListener("click", () => { if (!Battle.isActive()) saveGame(false); });
    document.getElementById("muteBtn").addEventListener("click", toggleMute);
    document.getElementById("potionBtn").addEventListener("click", () => {
      if (Battle.isActive() || !player) return;
      if (player.potions <= 0) { showMessage("やくそうを 持っていない！"); return; }
      if (player.hp >= player.maxHp) { showMessage("HPは まんたんだ。"); return; }
      player.potions -= 1;
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + DATA.characters.hero.potionHeal);
      Sound.se.heal(); updateHUD();
      showMessage(`やくそうを つかった！ HPが ${player.hp - before} かいふくした！`);
    });
    bindPad();
  }
  document.addEventListener("DOMContentLoaded", init);

  return {
    get DATA() { return DATA; },
    get player() { return player; },
    showMessage, sleep, expNext, updateHUD, saveGame,
    onDefeat, onBossDefeated, afterBattle,
  };
})();
