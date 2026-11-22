"use strict";
/* フィールド/街・会話・メニュー・装備・ショップ・セーブ・入力統合（ステップ2） */
const Game = (() => {
  const SAVE_KEY = "commandRpg_save_v1";
  const TILE_PX = 24;
  let DATA = null;
  let player = null;
  let currentMap = "field";
  let pos = { x: 2, y: 18 };
  let pix = { x: 2 * TILE_PX, y: 18 * TILE_PX };
  let facing = "down";
  let moving = null;
  let bossDefeated = false;
  let started = false;
  let panelOpen = false;
  const held = new Set();

  const mapData = () => DATA.maps[currentMap];
  const npcsHere = () => (DATA.npcs[currentMap] || []);
  const npcAt = (x, y) => npcsHere().find(n => n.x === x && n.y === y) || null;

  /* ---------- メッセージ（タイプライター＋早送り） ---------- */
  const msgEl = () => document.getElementById("messageText");
  const cursorEl = () => document.getElementById("messageCursor");
  let msg = null;
  function showMessage(text, artKey) {
    const port = document.getElementById("msgPortrait");
    if (artKey && window.CC0_ART && CC0_ART[artKey]) {
      port.src = CC0_ART[artKey]; port.classList.remove("hidden");
    } else {
      port.classList.add("hidden"); port.removeAttribute("src");
    }
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
      }, 14);
    });
  }
  function finishTyping() {
    if (!msg) return;
    clearInterval(msg.timer);
    msgEl().textContent = msg.full;
    cursorEl().classList.remove("hidden");
    msg.autoTimer = setTimeout(() => resolveMsg(), 1100);
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

  /* ---------- 確認ダイアログ（2段階確認） ---------- */
  let confirmState = null;
  function showConfirm(text) {
    return new Promise((resolve) => {
      confirmState = { resolve };
      document.getElementById("confirmText").textContent = text;
      document.getElementById("confirmOverlay").classList.remove("hidden");
    });
  }
  function answerConfirm(yes) {
    if (!confirmState) return;
    document.getElementById("confirmOverlay").classList.add("hidden");
    const r = confirmState.resolve; confirmState = null;
    Sound.se[yes ? "confirm" : "cancel"]();
    r(yes);
  }

  /* ---------- アイテム・装備 ---------- */
  function itemDef(id) {
    if (!DATA) return null;
    return DATA.items.weapons.find(w => w.id === id)
      || DATA.items.armors.find(a => a.id === id)
      || DATA.items.consumables.find(c => c.id === id) || null;
  }
  function countItem(id) { return (player && player.inventory[id]) || 0; }
  function addItem(id, n) {
    player.inventory[id] = countItem(id) + n;
    if (id === "potion") player.potions = player.inventory[id];
  }
  function removeItem(id, n) {
    player.inventory[id] = Math.max(0, countItem(id) - n);
    if (id === "potion") player.potions = player.inventory[id];
  }
  function weaponBonus() { const w = itemDef(player.equipment.weapon); return w ? w.bonus : 0; }
  function armorBonus() { const a = itemDef(player.equipment.armor); return a ? a.bonus : 0; }
  function effAtk() { return player.atk + weaponBonus(); }
  function effDef() { return player.def + armorBonus(); }

  function migratePlayer(p) {
    const h = DATA.characters.hero;
    if (!p.equipment) p.equipment = { weapon: "stick", armor: "cloth" };
    if (!p.ownedWeapons) p.ownedWeapons = ["stick"];
    if (!p.ownedArmors) p.ownedArmors = ["cloth"];
    if (!p.inventory) p.inventory = { potion: p.potions ?? h.startPotions, hipotion: 0, ether: 0, antidote: 0 };
    if (typeof p.inventory.potion !== "number") p.inventory.potion = p.potions ?? h.startPotions;
    p.potions = p.inventory.potion;
    return p;
  }
  function newPlayer() {
    const h = DATA.characters.hero;
    return migratePlayer({
      name: h.name, level: h.base.level, exp: 0, gold: 30, potions: h.startPotions,
      maxHp: h.base.maxHp, hp: h.base.maxHp, maxMp: h.base.maxMp, mp: h.base.maxMp,
      atk: h.base.atk, def: h.base.def, spd: h.base.spd,
    });
  }
  function expNext(level) {
    const h = DATA.characters.hero;
    return h.expNextBase + (level - 1) * h.expNextPerLevel;
  }

  /* ---------- HUD・ガイド ---------- */
  function updateHUD() {
    if (!player) return;
    document.getElementById("hudName").textContent = player.name;
    document.getElementById("hudLv").textContent = `Lv ${player.level}`;
    document.getElementById("hudHp").textContent = `HP ${player.hp}/${player.maxHp}`;
    document.getElementById("hudMp").textContent = `MP ${player.mp}/${player.maxMp}`;
    document.getElementById("hudGold").textContent = `${player.gold} G`;
    document.getElementById("hudPotion").textContent = `やくそう ${player.potions}`;
    updateGuide();
  }
  function updateGuide() {
    const el = document.getElementById("guideLine");
    if (!player) return;
    if (bossDefeated) el.textContent = "目標達成！ 魔王を倒した。街やフィールドを自由に冒険しよう";
    else if (currentMap === "town") el.textContent = "街：青い屋根＝宿屋（全回復10G）、赤い屋根＝ショップ、人はAボタンで話しかける。南の出口でフィールドへ";
    else if (player.level < 3) el.textContent = `目標：街（スタート地点の北）で装備を整え、森でレベルを上げよう（現在Lv ${player.level}）`;
    else el.textContent = "目標：フィールド東の赤いマスにいる魔王を倒そう（推奨Lv5〜6・上やくそう持参）";
  }

  /* ---------- セーブ ---------- */
  function saveGame(auto) {
    if (!player) return;
    localStorage.setItem(SAVE_KEY, JSON.stringify({ player, pos, map: currentMap, bossDefeated, savedAt: Date.now() }));
    if (!auto) { Sound.se.save(); showMessage("ぼうけんの書に 記録した！（セーブ完了）"); }
  }
  function loadSave() {
    try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); if (d && d.player) return d; } catch {}
    return null;
  }

  /* ---------- マップ・描画 ---------- */
  function tileAt(x, y) { return mapData().rows[y][x]; }
  function tileDef(ch) { return mapData().tiles[ch] || DATA.maps.field.tiles[ch]; }
  function passable(x, y) {
    const m = mapData();
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return false;
    if (npcAt(x, y)) return false;
    const t = tileDef(tileAt(x, y));
    return t && t.passable;
  }
  function speckle(x, y, n) { return ((x * 31 + y * 17 + n * 7) % 5); }
  function drawField() {
    const cv = document.getElementById("fieldCanvas");
    const ctx = cv.getContext("2d");
    const m = mapData();
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const ch = tileAt(x, y), def = tileDef(ch);
        if (!def) continue;
        const ox = x * TILE_PX, oy = y * TILE_PX;
        ctx.fillStyle = def.colors[0]; ctx.fillRect(ox, oy, TILE_PX, TILE_PX);
        ctx.fillStyle = def.colors[1];
        if (ch === ".") {
          if (speckle(x, y, 1) < 2) ctx.fillRect(ox + 4 + speckle(x, y, 2) * 4, oy + 14, 5, 3);
          if (speckle(x, y, 3) < 2) ctx.fillRect(ox + 14, oy + 5 + speckle(x, y, 4) * 3, 5, 3);
        } else if (ch === "F") {
          ctx.fillRect(ox + 10, oy + 15, 4, 6);
          ctx.beginPath(); ctx.moveTo(ox + 12, oy + 1); ctx.lineTo(ox + 22, oy + 16); ctx.lineTo(ox + 2, oy + 16); ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#3f7d46";
          ctx.beginPath(); ctx.moveTo(ox + 12, oy + 5); ctx.lineTo(ox + 19, oy + 15); ctx.lineTo(ox + 5, oy + 15); ctx.closePath(); ctx.fill();
        } else if (ch === "#") {
          ctx.beginPath(); ctx.moveTo(ox + 12, oy + 3); ctx.lineTo(ox + 22, oy + 21); ctx.lineTo(ox + 2, oy + 21); ctx.closePath(); ctx.fill();
          ctx.fillStyle = currentMap === "town" ? "#c8b8a0" : "#e8e8f0";
          ctx.beginPath(); ctx.moveTo(ox + 12, oy + 3); ctx.lineTo(ox + 16, oy + 9); ctx.lineTo(ox + 8, oy + 9); ctx.closePath(); ctx.fill();
        } else if (ch === "S") {
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
        } else if (ch === "H" || ch === "Y" || ch === "W") {
          ctx.fillRect(ox + 2, oy + 8, 20, 13);
          ctx.fillStyle = "#fff";
          ctx.font = "bold 11px monospace"; ctx.textAlign = "center";
          ctx.fillText(ch === "H" ? "店" : ch === "Y" ? "宿" : "井", ox + 12, oy + 18);
        } else if (ch === "T" || ch === "E") {
          ctx.fillStyle = def.colors[1]; ctx.fillRect(ox + 4, oy + 10, 16, 4); ctx.fillRect(ox + 10, oy + 4, 4, 16);
        }
      }
    }
    for (const n of npcsHere()) drawPixelSprite(ctx, n.sprite, n.x * TILE_PX, n.y * TILE_PX, TILE_PX / 16, false);
    drawPixelSprite(ctx, DATA.characters.hero.sprite, pix.x, pix.y, TILE_PX / 16, false);
  }
  function switchMap(id, x, y) {
    currentMap = id; pos = { x, y };
    pix = { x: x * TILE_PX, y: y * TILE_PX };
    moving = null; held.clear();
    updateGuide(); drawField();
  }

  /* ---------- マス効果・移動 ---------- */
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  async function onStep() {
    const ch = tileAt(pos.x, pos.y);
    if (ch === "T") { switchMap("town", DATA.maps.town.entrance.x, DATA.maps.town.entrance.y); await showMessage("街に 着いた。"); return; }
    if (ch === "E") { const t = DATA.maps.town.exitTo; switchMap(t.map, t.x, t.y); await showMessage("フィールドに 出た。"); return; }
    if (ch === "S") {
      if (player.hp < player.maxHp || player.mp < player.maxMp) {
        player.hp = player.maxHp; player.mp = player.maxMp;
        Sound.se.spring(); updateHUD(); saveGame(true);
        await showMessage("回復の泉だ！ HPとMPが 全回復した！（オートセーブ）");
      }
      return;
    }
    if (ch === "B" && !bossDefeated) {
      await Battle.start(DATA.enemies.enemies.find(e => e.boss), true);
      return;
    }
    const def = tileDef(ch);
    if (def && def.encounterRate > 0 && Math.random() < def.encounterRate) {
      const pool = DATA.enemies.enemies.filter(e => !e.boss && e.areas.includes(def.area));
      await Battle.start(pool[Math.floor(Math.random() * pool.length)], false);
    }
  }
  let lastTs = 0;
  function loop(ts) {
    if (!started) return;
    const dt = Math.min(50, ts - lastTs || 16); lastTs = ts;
    if (!Battle.isActive() && !msg && !panelOpen && !confirmState) {
      if (moving) {
        moving.progress += dt / 140;
        if (moving.progress >= 1) {
          pos.x = moving.tx; pos.y = moving.ty;
          pix.x = pos.x * TILE_PX; pix.y = pos.y * TILE_PX;
          moving = null; onStep();
        } else {
          pix.x = (pos.x + moving.dx * moving.progress) * TILE_PX;
          pix.y = (pos.y + moving.dy * moving.progress) * TILE_PX;
        }
      } else {
        for (const dir of ["up", "down", "left", "right"]) {
          if (held.has(dir)) {
            facing = dir;
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

  /* ---------- インタラクト（話しかけ・店・宿） ---------- */
  async function interact() {
    if (Battle.isActive() || msg || panelOpen || confirmState) return;
    const [dx, dy] = DIRS[facing];
    const tx = pos.x + dx, ty = pos.y + dy;
    const npc = npcAt(tx, ty);
    if (npc) {
      Sound.se.confirm();
      for (const line of npc.lines) await showMessage(`${npc.name}「${line}」`, npc.portraitKey);
      return;
    }
    const def = tileDef(tileAt(tx, ty));
    if (def && def.interact === "shop") openShop();
    else if (def && def.interact === "inn") {
      const ok = await showConfirm("宿屋に 泊まりますか？\n（10Gで HP・MP 全回復）");
      if (ok) {
        if (player.gold < 10) { await showMessage("ゴールドが 足りない！"); return; }
        player.gold -= 10; player.hp = player.maxHp; player.mp = player.maxMp;
        Sound.se.spring(); updateHUD(); saveGame(true);
        await showMessage("ぐっすり 眠った！ HPとMPが 全回復した！（オートセーブ）");
      }
    }
  }

  /* ---------- パネル（メニュー共通） ---------- */
  function openPanel(title) {
    panelOpen = true;
    document.getElementById("panelTitle").textContent = title;
    document.getElementById("panelBody").innerHTML = "";
    document.getElementById("panelOverlay").classList.remove("hidden");
    return document.getElementById("panelBody");
  }
  function closePanel() {
    panelOpen = false;
    document.getElementById("panelOverlay").classList.add("hidden");
  }
  function row(body, main, sub, onTap, disabled) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "menu-row" + (disabled ? " disabled" : "");
    const l = document.createElement("span"); l.textContent = main;
    const r = document.createElement("span"); r.className = "sub"; r.textContent = sub || "";
    b.appendChild(l); b.appendChild(r);
    if (!disabled && onTap) b.addEventListener("click", onTap);
    body.appendChild(b);
    return b;
  }

  function openMenu() {
    if (!player || Battle.isActive()) return;
    Sound.se.confirm();
    const body = openPanel("メニュー");
    row(body, "ステータス", `Lv ${player.level}`, () => openStatus());
    row(body, "そうび", `${itemDef(player.equipment.weapon).name} / ${itemDef(player.equipment.armor).name}`, () => openEquip());
    row(body, "アイテム", `やくそう ×${player.potions} など`, () => openItems());
    row(body, "セーブ", loadSave() ? "上書きします" : "新規保存", async () => {
      closePanel();
      if (loadSave()) { if (!(await showConfirm("セーブデータを 上書きしますか？"))) return; }
      saveGame(false);
    });
    row(body, "とじる", "", () => closePanel());
  }
  function openStatus() {
    const body = openPanel("ステータス");
    const rows = [
      ["名前", player.name], ["レベル", player.level],
      ["HP", `${player.hp} / ${player.maxHp}`], ["MP", `${player.mp} / ${player.maxMp}`],
      ["攻撃力", `${effAtk()}（素 ${player.atk} ＋ 武器 ${weaponBonus()}）`],
      ["防御力", `${effDef()}（素 ${player.def} ＋ 防具 ${armorBonus()}）`],
      ["素早さ", player.spd],
      ["武器", itemDef(player.equipment.weapon).name], ["防具", itemDef(player.equipment.armor).name],
      ["経験値", `${player.exp} / 次まで ${expNext(player.level) - player.exp}`],
      ["ゴールド", `${player.gold} G`],
    ];
    const t = document.createElement("table"); t.className = "stat-table";
    for (const [k, v] of rows) {
      const tr = document.createElement("tr");
      const a = document.createElement("td"); a.textContent = k;
      const b = document.createElement("td"); b.textContent = v;
      tr.appendChild(a); tr.appendChild(b); t.appendChild(tr);
    }
    body.appendChild(t);
  }
  function openEquip() {
    const body = openPanel("そうび変更（タップで即装備）");
    const h1 = document.createElement("div"); h1.textContent = "― 武器 ―"; body.appendChild(h1);
    for (const id of player.ownedWeapons) {
      const w = itemDef(id);
      const now = player.equipment.weapon === id;
      const preview = now ? "装備中" : `攻撃 ${effAtk()} → ${player.atk + w.bonus}`;
      row(body, w.name, preview, () => { player.equipment.weapon = id; Sound.se.confirm(); updateHUD(); openEquip(); });
    }
    const h2 = document.createElement("div"); h2.textContent = "― 防具 ―"; body.appendChild(h2);
    for (const id of player.ownedArmors) {
      const a = itemDef(id);
      const now = player.equipment.armor === id;
      const preview = now ? "装備中" : `防御 ${effDef()} → ${player.def + a.bonus}`;
      row(body, a.name, preview, () => { player.equipment.armor = id; Sound.se.confirm(); updateHUD(); openEquip(); });
    }
  }
  function openItems() {
    const body = openPanel("アイテム（タップ→確認して使用）");
    let any = false;
    for (const c of DATA.items.consumables) {
      const n = countItem(c.id);
      if (n <= 0) continue;
      any = true;
      row(body, c.name, `×${n}｜${c.description}`, async () => {
        closePanel();
        if (!(await showConfirm(`${c.name}を 使いますか？\n（${c.description}）`))) { openItems(); return; }
        useConsumable(c, false);
      });
    }
    if (!any) { const d = document.createElement("div"); d.textContent = "アイテムを持っていません。"; body.appendChild(d); }
  }
  function useConsumable(c, inBattle) {
    if (c.effect === "heal") {
      if (player.hp >= player.maxHp) { showMessage("HPは まんたんだ。"); return false; }
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + c.amount);
      removeItem(c.id, 1); Sound.se.heal(); updateHUD();
      showMessage(`${c.name}を つかった！ HPが ${player.hp - before} かいふくした！`);
      return true;
    }
    if (c.effect === "mp") {
      if (player.mp >= player.maxMp) { showMessage("MPは まんたんだ。"); return false; }
      const before = player.mp;
      player.mp = Math.min(player.maxMp, player.mp + c.amount);
      removeItem(c.id, 1); Sound.se.heal(); updateHUD();
      showMessage(`${c.name}を つかった！ MPが ${player.mp - before} かいふくした！`);
      return true;
    }
    if (c.effect === "antidote") {
      showMessage("今は 毒に かかっていない。");
      return false;
    }
    return false;
  }

  /* ---------- ショップ ---------- */
  function openShop() {
    Sound.se.confirm();
    let tab = "buy";
    const render = () => {
      const body = openPanel(`ショップ（所持金 ${player.gold} G）`);
      if (window.CC0_ART) {
        const img = document.createElement("img");
        img.src = CC0_ART.wink; img.alt = "看板娘ハチ"; img.className = "shop-art";
        body.appendChild(img);
      }
      const tabs = document.createElement("div"); tabs.className = "shop-tabs";
      const b1 = document.createElement("button"); b1.type = "button"; b1.textContent = "買う"; if (tab === "buy") b1.className = "active";
      const b2 = document.createElement("button"); b2.type = "button"; b2.textContent = "売る"; if (tab === "sell") b2.className = "active";
      b1.addEventListener("click", () => { tab = "buy"; render(); });
      b2.addEventListener("click", () => { tab = "sell"; render(); });
      tabs.appendChild(b1); tabs.appendChild(b2); body.appendChild(tabs);
      if (tab === "buy") {
        for (const id of DATA.items.shop) {
          const it = itemDef(id);
          const isW = DATA.items.weapons.includes(it), isA = DATA.items.armors.includes(it);
          const owned = isW ? player.ownedWeapons.includes(id) : isA ? player.ownedArmors.includes(id) : countItem(id) > 0;
          const sub = isW ? `攻撃＋${it.bonus}` : isA ? `防御＋${it.bonus}` : it.description;
          row(body, it.name, `${it.price} G｜${sub}${owned ? "｜所持済" : ""}`, async () => {
            closePanel();
            if (!(await showConfirm(`${it.name}を ${it.price} Gで 買いますか？\n（所持金 ${player.gold} G）`))) { openShop(); return; }
            if (player.gold < it.price) { await showMessage("ゴールドが 足りない！"); openShop(); return; }
            if ((isW && player.ownedWeapons.includes(id)) || (isA && player.ownedArmors.includes(id))) { await showMessage("もう 持っている！"); openShop(); return; }
            player.gold -= it.price;
            if (isW) player.ownedWeapons.push(id); else if (isA) player.ownedArmors.push(id); else addItem(id, 1);
            Sound.se.save(); updateHUD();
            await showMessage(`${it.name}を 買った！`);
            openShop();
          }, player.gold < it.price);
        }
      } else {
        let any = false;
        for (const c of DATA.items.consumables) {
          const n = countItem(c.id); if (n <= 0) continue; any = true;
          const price = Math.floor(c.price * DATA.items.sellRate);
          row(body, c.name, `×${n}｜${price} Gで売れる`, async () => {
            closePanel();
            if (!(await showConfirm(`${c.name}を ${price} Gで 売りますか？`))) { openShop(); return; }
            removeItem(c.id, 1); player.gold += price; Sound.se.save(); updateHUD();
            await showMessage(`${c.name}を 売った！`); openShop();
          });
        }
        for (const [list, key] of [[player.ownedWeapons, "weapon"], [player.ownedArmors, "armor"]]) {
          for (const id of [...list]) {
            if (player.equipment[key] === id) continue;
            const it = itemDef(id); if (!it || it.price <= 0) continue; any = true;
            const price = Math.floor(it.price * DATA.items.sellRate);
            row(body, it.name, `${price} Gで売れる`, async () => {
              closePanel();
              if (!(await showConfirm(`${it.name}を ${price} Gで 売りますか？`))) { openShop(); return; }
              list.splice(list.indexOf(id), 1); player.gold += price; Sound.se.save(); updateHUD();
              await showMessage(`${it.name}を 売った！`); openShop();
            });
          }
        }
        if (!any) { const d = document.createElement("div"); d.textContent = "売れるものが ありません。"; body.appendChild(d); }
      }
    };
    render();
  }

  /* ---------- 勝敗・クリア ---------- */
  function onDefeat() {
    switchMap("town", DATA.maps.town.entrance.x, DATA.maps.town.entrance.y);
    player.hp = Math.ceil(player.maxHp / 2);
    player.mp = player.maxMp;
    player.gold = Math.floor(player.gold / 2);
    updateHUD(); saveGame(true);
    showMessage("街の宿屋で 目覚めた。所持金の半分を 失ったが、命は助かった。（オートセーブ）");
  }
  async function onBossDefeated() {
    bossDefeated = true; saveGame(true);
    await showMessage("魔王を 倒した！ 世界に 平和が もどった！ ―― クリア！ おめでとう！");
  }
  function afterBattle() { updateHUD(); drawField(); }

  /* ---------- 入力 ---------- */
  function confirmAction() {
    Sound.unlock();
    if (confirmState) { answerConfirm(true); return; }
    if (pressConfirm()) return;
    if (Battle.isActive()) { Battle.handleInput("confirm"); return; }
    if (panelOpen) return;
    interact();
  }
  function cancelAction() {
    if (confirmState) { answerConfirm(false); return; }
    if (Battle.isActive()) { Battle.handleInput("cancel"); return; }
    if (panelOpen) { closePanel(); Sound.se.cancel(); return; }
    openMenu();
  }
  function dirAction(dir) {
    if (Battle.isActive() && (dir === "up" || dir === "down")) Battle.handleInput(dir);
  }
  const KEYMAP = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
  document.addEventListener("keydown", (e) => {
    if (!started) return;
    if (KEYMAP[e.code]) { e.preventDefault(); const dir = KEYMAP[e.code]; if (!held.has(dir)) dirAction(dir); held.add(dir); }
    else if (e.code === "Enter" || e.code === "KeyZ") { e.preventDefault(); confirmAction(); }
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
    document.getElementById("panelClose").addEventListener("click", () => { closePanel(); Sound.se.cancel(); });
    document.getElementById("confirmYes").addEventListener("click", () => answerConfirm(true));
    document.getElementById("confirmNo").addEventListener("click", () => answerConfirm(false));
    const cv = document.getElementById("fieldCanvas");
    cv.addEventListener("click", (e) => {
      if (!started || Battle.isActive() || panelOpen) return;
      const r = cv.getBoundingClientRect();
      const tx = Math.floor((e.clientX - r.left) / r.width * mapData().width);
      const ty = Math.floor((e.clientY - r.top) / r.height * mapData().height);
      const dx = tx - pos.x, dy = ty - pos.y;
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        facing = dx === 1 ? "right" : dx === -1 ? "left" : dy === 1 ? "down" : "up";
        interact();
      }
    });
  }
  function toggleMute() {
    const m = Sound.toggleMute();
    document.getElementById("muteBtn").textContent = m ? "音：OFF" : "音：ON";
  }

  /* ---------- 開始 ---------- */
  function startGame(fromSave) {
    const save = fromSave ? loadSave() : null;
    if (save) {
      player = migratePlayer(save.player);
      currentMap = save.map && DATA.maps[save.map] ? save.map : "field";
      pos = save.pos; bossDefeated = !!save.bossDefeated;
    } else {
      player = newPlayer(); currentMap = "field";
      pos = { x: DATA.maps.field.start.x, y: DATA.maps.field.start.y };
      bossDefeated = false;
    }
    pix = { x: pos.x * TILE_PX, y: pos.y * TILE_PX };
    document.getElementById("titleScreen").classList.add("hidden");
    document.getElementById("gameScreen").classList.remove("hidden");
    started = true;
    updateHUD(); drawField();
    document.getElementById("muteBtn").textContent = Sound.isMuted() ? "音：OFF" : "音：ON";
    requestAnimationFrame(loop);
    showMessage(save ? "ぼうけんの書から 再開した。" : "旅が 始まった！ すぐ北に 街がある。街で装備を整え、東の魔王を 倒そう！");
  }
  async function init() {
    if (window.CC0_ART) document.getElementById("titleArt").src = CC0_ART.title;
    try {
      const [c, e, s, m, t, it, np] = await Promise.all([
        fetch("data/characters.json").then(r => r.json()),
        fetch("data/enemies.json").then(r => r.json()),
        fetch("data/skills.json").then(r => r.json()),
        fetch("data/map.json").then(r => r.json()),
        fetch("data/town.json").then(r => r.json()),
        fetch("data/items.json").then(r => r.json()),
        fetch("data/npcs.json").then(r => r.json()),
      ]);
      DATA = { characters: c, enemies: e, skills: s, maps: { field: m, town: t }, items: it, npcs: np };
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
    document.getElementById("saveBtn").addEventListener("click", async () => {
      if (Battle.isActive() || panelOpen) return;
      if (loadSave()) { if (!(await showConfirm("セーブデータを 上書きしますか？"))) return; }
      saveGame(false);
    });
    document.getElementById("menuBtn").addEventListener("click", () => { if (!panelOpen) openMenu(); });
    document.getElementById("muteBtn").addEventListener("click", toggleMute);
    document.getElementById("potionBtn").addEventListener("click", () => {
      if (Battle.isActive() || !player || panelOpen) return;
      const c = DATA.items.consumables.find(x => x.id === "potion");
      if (countItem("potion") <= 0) { showMessage("やくそうを 持っていない！"); return; }
      useConsumable(c, false);
    });
    bindPad();
  }
  document.addEventListener("DOMContentLoaded", init);

  return {
    get DATA() { return DATA; },
    get player() { return player; },
    showMessage, sleep, expNext, updateHUD, saveGame,
    onDefeat, onBossDefeated, afterBattle,
    effAtk, effDef, itemDef, countItem, removeItem,
  };
})();
