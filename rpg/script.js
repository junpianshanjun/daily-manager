"use strict";

// ===== ゲームデータ =====
const SAVE_KEY = "tinyHeroRpg_save";

const AREAS = {
  village: { name: "はじまりの村", minLevel: 1 },
  forest: { name: "緑の森", minLevel: 1 },
  cave: { name: "暗い洞窟", minLevel: 2 },
  castle: { name: "魔王城", minLevel: 4 },
};

const ENEMIES = {
  forest: [
    { name: "スライム", emoji: "🟢", hp: 30, atk: 6, def: 0, exp: 12, gold: 10 },
    { name: "ゴブリン", emoji: "👺", hp: 42, atk: 8, def: 1, exp: 18, gold: 16 },
    { name: "大きなクモ", emoji: "🕷️", hp: 38, atk: 9, def: 0, exp: 16, gold: 12 },
  ],
  cave: [
    { name: "洞窟コウモリ", emoji: "🦇", hp: 48, atk: 10, def: 1, exp: 24, gold: 20 },
    { name: "スケルトン", emoji: "💀", hp: 62, atk: 12, def: 2, exp: 32, gold: 28 },
    { name: "トロル", emoji: "👹", hp: 78, atk: 13, def: 2, exp: 40, gold: 35 },
  ],
  castle: [
    { name: "魔導士", emoji: "🧙", hp: 82, atk: 15, def: 2, exp: 50, gold: 45 },
    { name: "ダークナイト", emoji: "🗡️", hp: 100, atk: 17, def: 3, exp: 65, gold: 55 },
    { name: "ドラゴン", emoji: "🐉", hp: 115, atk: 18, def: 3, exp: 85, gold: 75 },
  ],
};

const BOSS = { name: "魔王", emoji: "👿", hp: 170, atk: 21, def: 3, exp: 200, gold: 300, boss: true };

function defaultState() {
  return {
    level: 1, exp: 0, gold: 30, potions: 2, weaponBonus: 0,
    hp: 40, maxHp: 40, mp: 10, maxMp: 10, atk: 10, def: 3,
    area: "village", cleared: false,
  };
}

let player = loadGame() || defaultState();
let enemy = null; // 戦闘中のみ

function nextExp() { return player.level * 20; }

function loadGame() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (data && typeof data.level === "number") return Object.assign(defaultState(), data);
  } catch { /* 保存データが壊れていたら無視 */ }
  return null;
}

function saveGame(silent) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(player));
  if (!silent) addLog("セーブしました。次もここから遊べます。");
}

// ===== 画面 =====
const $ = (id) => document.getElementById(id);
const logEl = $("log");
let logLines = [];

function addLog(text) {
  logLines.push(text);
  if (logLines.length > 7) logLines = logLines.slice(-7);
  logEl.textContent = logLines.join("\n");
}

function setLog(text) {
  logLines = [text];
  logEl.textContent = text;
}

function render() {
  $("level").textContent = `Lv ${player.level}`;
  $("gold").textContent = `${player.gold} G`;
  $("potion").textContent = `ポーション ×${player.potions}`;
  $("hpText").textContent = `${Math.max(0, player.hp)} / ${player.maxHp}`;
  $("mpText").textContent = `${player.mp} / ${player.maxMp}`;
  $("expText").textContent = `${player.exp} / ${nextExp()}`;
  $("hpBar").style.width = `${Math.max(0, player.hp) / player.maxHp * 100}%`;
  $("mpBar").style.width = `${player.mp / player.maxMp * 100}%`;
  $("expBar").style.width = `${Math.min(100, player.exp / nextExp() * 100)}%`;
  $("place").textContent = `場所：${AREAS[player.area].name}`;

  const visual = $("enemyVisual");
  if (enemy) {
    visual.hidden = false;
    $("enemyEmoji").textContent = enemy.emoji;
    $("enemyName").textContent = enemy.name;
    $("enemyHpBar").style.width = `${Math.max(0, enemy.hp) / enemy.maxHp * 100}%`;
    $("enemyHpText").textContent = `HP ${Math.max(0, enemy.hp)} / ${enemy.maxHp}`;
  } else {
    visual.hidden = true;
  }
  renderActions();
}

function makeButton(label, onClick, options = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  if (options.className) btn.className = options.className;
  if (options.disabled) btn.disabled = true;
  btn.addEventListener("click", onClick);
  return btn;
}

function renderActions() {
  const box = $("actions");
  box.innerHTML = "";

  if (enemy) {
    box.append(
      makeButton("⚔️ 攻撃する", playerAttack),
      makeButton("🔥 魔法（MP4）", playerMagic, { disabled: player.mp < 4 }),
      makeButton(`🧪 ポーション（×${player.potions}）`, usePotion, { disabled: player.potions <= 0, className: "secondary" }),
      makeButton("逃げる", runAway, { className: "secondary", disabled: !!enemy.boss }),
    );
    return;
  }

  if (player.area === "village") {
    box.append(
      makeButton("🏠 宿屋（10G・全回復）", restAtInn, { disabled: player.gold < 10 }),
      makeButton("🧪 ポーションを買う（15G）", buyPotion, { disabled: player.gold < 15 }),
      makeButton("🗡️ 武器を強化（50G）", upgradeWeapon, { disabled: player.gold < 50 }),
      makeButton("🌲 緑の森へ", () => moveTo("forest")),
      makeButton("🕳️ 暗い洞窟へ（Lv2〜）", () => moveTo("cave"), { disabled: player.level < 2 }),
      makeButton("🏰 魔王城へ（Lv4〜）", () => moveTo("castle"), { disabled: player.level < 4 }),
    );
    return;
  }

  // 村以外の場所
  box.append(
    makeButton("敵を探す", encounter),
    makeButton("🏠 村へ戻る", () => moveTo("village"), { className: "secondary" }),
  );
  if (player.area === "castle") {
    box.append(
      makeButton("👿 魔王に挑む", startBoss, { className: "danger" }),
    );
  }
  box.append(
    makeButton(`🧪 ポーション（×${player.potions}）`, usePotion, { disabled: player.potions <= 0, className: "secondary" }),
  );
}

// ===== 行動 =====
function moveTo(area) {
  player.area = area;
  const messages = {
    village: "村に戻ってきた。少し落ち着く。",
    forest: "緑の森に入った。何かうごめいている…",
    cave: "暗い洞窟に入った。奥から音がする…",
    castle: "魔王城に着いた。魔王は最奥にいる。",
  };
  setLog(messages[area]);
  saveGame(true);
  render();
}

function restAtInn() {
  player.gold -= 10;
  player.hp = player.maxHp;
  player.mp = player.maxMp;
  setLog("宿屋でぐっすり眠った。HPとMPが全回復！");
  saveGame(true);
  render();
}

function buyPotion() {
  player.gold -= 15;
  player.potions++;
  setLog(`ポーションを買った。（所持：${player.potions}個）`);
  saveGame(true);
  render();
}

function upgradeWeapon() {
  player.gold -= 50;
  player.weaponBonus += 3;
  player.atk += 3;
  setLog(`武器を強化した！ 攻撃力が ${player.atk} になった。`);
  saveGame(true);
  render();
}

function encounter() {
  const list = ENEMIES[player.area];
  const base = list[Math.floor(Math.random() * list.length)];
  startBattle(base);
  setLog(`${base.name} が現れた！`);
}

function startBoss() {
  startBattle({ ...BOSS });
  setLog("魔王「よく来たな、勇者よ…！」\n決戦のはじまりだ！");
}

function startBattle(base) {
  enemy = { ...base, maxHp: base.hp };
  render();
}

function damageToEnemy(amount) {
  enemy.hp -= amount;
  const visual = $("enemyVisual");
  visual.classList.remove("shake");
  void visual.offsetWidth;
  visual.classList.add("shake");
}

function playerAttack() {
  if (!enemy) return;
  const dmg = Math.max(1, player.atk + rand(0, 5) - enemy.def);
  damageToEnemy(dmg);
  addLog(`勇者の攻撃！ ${enemy.name} に ${dmg} のダメージ。`);
  afterPlayerTurn();
}

function playerMagic() {
  if (!enemy || player.mp < 4) return;
  player.mp -= 4;
  const dmg = 16 + rand(0, 8);
  damageToEnemy(dmg);
  addLog(`ファイアの魔法！ ${enemy.name} に ${dmg} のダメージ。`);
  afterPlayerTurn();
}

function usePotion() {
  if (player.potions <= 0) return;
  player.potions--;
  const heal = 30;
  player.hp = Math.min(player.maxHp, player.hp + heal);
  addLog(`ポーションを使った。HPが ${heal} 回復！`);
  if (enemy) afterPlayerTurn(false);
  else render();
}

function runAway() {
  if (!enemy || enemy.boss) return;
  if (Math.random() < 0.7) {
    addLog("うまく逃げ切った！");
    enemy = null;
    render();
  } else {
    addLog("逃げられなかった！");
    enemyTurn();
  }
}

function afterPlayerTurn(checkWin = true) {
  if (checkWin && enemy && enemy.hp <= 0) { winBattle(); return; }
  render();
  enemyTurn();
}

function enemyTurn() {
  if (!enemy) return;
  const dmg = Math.max(1, enemy.atk + rand(0, 4) - player.def);
  player.hp -= dmg;
  addLog(`${enemy.name} の攻撃！ 勇者は ${dmg} のダメージを受けた。`);
  if (player.hp <= 0) {
    player.hp = 0;
    gameOver();
    return;
  }
  render();
}

function winBattle() {
  const wasBoss = !!enemy.boss;
  addLog(`${enemy.name} を倒した！`);
  addLog(`${enemy.exp} EXP と ${enemy.gold} G を手に入れた。`);
  player.exp += enemy.exp;
  player.gold += enemy.gold;
  enemy = null;
  while (player.exp >= nextExp()) {
    player.exp -= nextExp();
    player.level++;
    player.maxHp += 8;
    player.maxMp += 2;
    player.atk += 3;
    player.def += 1;
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    addLog(`レベルアップ！ Lv ${player.level} になった。全回復した！`);
  }
  if (wasBoss) {
    player.cleared = true;
    addLog("🎉 魔王を倒した！ 村に平和が戻った。ゲームクリア！\nそのまま遊び続けることもできます。");
  }
  saveGame(true);
  render();
}

function gameOver() {
  addLog("勇者は倒れてしまった…\n村の宿屋で目覚めた。ゴールドが半分になった。");
  player.gold = Math.floor(player.gold / 2);
  player.hp = player.maxHp;
  player.mp = player.maxMp;
  player.area = "village";
  enemy = null;
  saveGame(true);
  render();
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ===== 下のボタン =====
$("saveBtn").addEventListener("click", () => { saveGame(); render(); });
$("resetBtn").addEventListener("click", () => {
  if (!confirm("最初からやり直しますか？ セーブデータは消えます。")) return;
  localStorage.removeItem(SAVE_KEY);
  player = defaultState();
  enemy = null;
  setLog(introText());
  render();
});

function introText() {
  return "ここは、はじまりの村。魔王に脅かされている。\nまずは「緑の森へ」進んで、敵を倒してレベルを上げよう。\nLv2で洞窟、Lv4で魔王城に行けるようになる。";
}

// ===== 起動 =====
setLog(player.cleared ? "おかえり、勇者。村は今日も平和だ。そのまま冒険を続けられる。" : introText());
render();
