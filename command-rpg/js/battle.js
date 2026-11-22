"use strict";
/* ターン制コマンドバトル：演出（点滅・シェイク・ポップアップ・会心）を含む */
function drawPixelSprite(ctx, sprite, ox, oy, scale, white) {
  const px = sprite.pixels, pal = sprite.palette;
  for (let y = 0; y < px.length; y++) {
    for (let x = 0; x < px[y].length; x++) {
      const c = px[y][x];
      if (c === "." || c === " ") continue;
      ctx.fillStyle = white ? "#ffffff" : (pal[c] || "#f0f");
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}

const Battle = (() => {
  let active = false;
  let enemy = null;
  let isBoss = false;
  let guarding = false;
  let menuResolve = null;
  let menuItems = [];
  let menuIndex = 0;
  let menuMode = "command"; // command | skill
  let poisonTurns = 0;   // プレイヤーの毒（残りターン）
  let defDownTurns = 0;  // プレイヤーの防御ダウン（残りターン）
  let defDownVal = 0;
  let enemyCharging = false; // 敵が力を溜めている

  const stage = () => document.getElementById("battleStage");
  const cmdWin = () => document.getElementById("commandWindow");
  const enemyCtx = () => document.getElementById("enemyCanvas").getContext("2d");

  function drawEnemy(white) {
    const ctx = enemyCtx();
    ctx.clearRect(0, 0, 192, 192);
    drawPixelSprite(ctx, enemy.sprite, 0, 0, 12, white);
  }
  function enemyInfo() {
    document.getElementById("enemyInfo").textContent =
      `${enemy.name}  HP ${Math.max(0, enemy.hp)}/${enemy.maxHp}`;
  }
  function popup(text, cls) {
    const el = document.getElementById("dmgPopup");
    el.textContent = text;
    el.className = "dmg-popup" + (cls ? " " + cls : "");
    setTimeout(() => el.classList.add("hidden"), 900);
  }
  function critPopup() {
    const el = document.getElementById("critPopup");
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 900);
  }
  function shake(big) {
    const s = stage();
    s.classList.remove("shake", "shake-big");
    void s.offsetWidth;
    s.classList.add(big ? "shake-big" : "shake");
    setTimeout(() => s.classList.remove("shake", "shake-big"), 500);
  }
  async function flashEnemy() {
    for (let i = 0; i < 3; i++) {
      drawEnemy(true);
      await Game.sleep(70);
      drawEnemy(false);
      await Game.sleep(70);
    }
  }

  function calcDamage(atk, def, power, critRate, critMul, variance) {
    const f = Game.DATA.characters.damageFormula;
    const crit = Math.random() < (critRate ?? f.criticalRate);
    let dmg = atk * (power ?? 2) - (power ? def : def);
    if (!power) dmg = atk * 2 - def;
    dmg = dmg * (variance ? (variance[0] + Math.random() * (variance[1] - variance[0])) : (0.85 + Math.random() * 0.3));
    if (crit) dmg *= (critMul ?? f.criticalMultiplier);
    return { dmg: Math.max(1, Math.floor(dmg)), crit };
  }

  function renderMenu() {
    const win = cmdWin();
    win.innerHTML = "";
    menuItems.forEach((item, i) => {
      const div = document.createElement("div");
      div.className = "cmd" + (i === menuIndex ? " selected" : "") + (item.disabled ? " disabled" : "");
      div.textContent = (i === menuIndex ? "▶ " : "　") + item.label;
      div.addEventListener("click", () => {
        if (menuIndex !== i) { menuIndex = i; Sound.se.cursor(); renderMenu(); }
        else chooseMenu();
      });
      win.appendChild(div);
    });
  }
  function chooseMenu() {
    const item = menuItems[menuIndex];
    if (!item || item.disabled) { Sound.se.cancel(); return; }
    Sound.se.confirm();
    cmdWin().classList.add("hidden");
    const r = menuResolve; menuResolve = null;
    if (r) r(item);
  }
  function waitMenu(items, mode) {
    return new Promise((resolve) => {
      menuItems = items; menuIndex = 0; menuMode = mode; menuResolve = resolve;
      cmdWin().classList.remove("hidden");
      renderMenu();
    });
  }
  function handleInput(action) {
    if (!active || !menuResolve) return false;
    if (action === "up" || action === "down") {
      const d = action === "up" ? -1 : 1;
      menuIndex = (menuIndex + d + menuItems.length) % menuItems.length;
      Sound.se.cursor(); renderMenu(); return true;
    }
    if (action === "confirm") { chooseMenu(); return true; }
    if (action === "cancel" && menuMode === "skill") {
      Sound.se.cancel();
      cmdWin().classList.add("hidden");
      const r = menuResolve; menuResolve = null;
      if (r) r({ id: "back" });
      return true;
    }
    return false;
  }

  async function playerAttack(power, label, critRate) {
    const p = Game.player;
    await Game.showMessage(`${p.name}の ${label}！`);
    const { dmg, crit } = calcDamage(Game.effAtk(), enemy.def, power, critRate, undefined, power ? [0.9, 1.1] : undefined);
    enemy.hp -= dmg;
    if (crit) { Sound.se.critical(); critPopup(); shake(true); } else { Sound.se.hit(); shake(false); }
    popup(String(dmg));
    await flashEnemy();
    enemyInfo();
    await Game.showMessage(crit ? `かいしんの いちげき！ ${enemy.name}に ${dmg}の ダメージ！` : `${enemy.name}に ${dmg}の ダメージ！`);
  }
  async function enemyAttack() {
    const p = Game.player;
    const effDef = Math.max(0, Game.effDef() - (defDownTurns > 0 ? defDownVal : 0));
    const applyHit = async (dmg, label) => {
      if (guarding) dmg = Math.max(1, Math.floor(dmg * Game.DATA.characters.damageFormula.guardMultiplier));
      p.hp -= dmg;
      Sound.se.playerHit(); shake(false);
      Game.updateHUD();
      await Game.showMessage(`${enemy.name}の ${label}！ ${p.name}は ${dmg}の ダメージを うけた！`);
      return dmg;
    };
    // 力を溜めた次のターンは大ダメージ
    if (enemyCharging) {
      enemyCharging = false;
      await applyHit(calcDamage(enemy.atk, effDef, 2.3, 0, 1, [0.95, 1.05]).dmg, "渾身の いちげき");
      return;
    }
    const pat = enemy.pattern || "normal";
    const roll = Math.random();
    if ((pat === "charge" || pat === "mixed") && roll < 0.3) {
      enemyCharging = true;
      Sound.se.encounter();
      await Game.showMessage(`${enemy.name}は 力を 溜めている！ 次のターンは 大ダメージの予感…『ぼうぎょ』で備えよう！`);
      return;
    }
    if (pat === "poison" && roll < 0.45) {
      await applyHit(calcDamage(enemy.atk, effDef, null, 0, 1, undefined).dmg, "どくのキバ");
      if (p.hp > 0 && poisonTurns <= 0) {
        poisonTurns = 3;
        await Game.showMessage(`${p.name}は 毒に かかった！（3ターン、毎ターン4ダメージ）`);
      }
      return;
    }
    if ((pat === "debuff" || pat === "mixed") && roll < 0.35) {
      defDownTurns = 3; defDownVal = 3;
      await Game.showMessage(`${enemy.name}の ねばねば攻撃！ ${p.name}の 防御が 3 下がった！（3ターン）`);
      return;
    }
    if (enemy.skill && Math.random() < enemy.skill.rate) {
      await applyHit(calcDamage(enemy.atk, effDef, enemy.skill.power, 0, 1, [0.9, 1.1]).dmg, enemy.skill.name);
      return;
    }
    await applyHit(calcDamage(enemy.atk, effDef, null, 0, 1, undefined).dmg, "こうげき");
  }
  async function statusTick() {
    const p = Game.player;
    if (defDownTurns > 0) defDownTurns -= 1;
    if (poisonTurns > 0 && p.hp > 0) {
      poisonTurns -= 1;
      p.hp -= 4;
      Sound.se.playerHit(); Game.updateHUD();
      await Game.showMessage(`毒の ダメージ！ ${p.name}は 4の ダメージを うけた！`);
    }
  }

  async function start(enemyData, boss) {
    active = true; isBoss = boss; guarding = false;
    poisonTurns = 0; defDownTurns = 0; defDownVal = 0; enemyCharging = false;
    enemy = JSON.parse(JSON.stringify(enemyData));
    enemy.hp = enemy.maxHp;
    document.getElementById("fieldWrap").classList.add("hidden");
    document.getElementById("battleWrap").classList.remove("hidden");
    drawEnemy(false); enemyInfo();
    Sound.se.encounter();
    await Game.showMessage(boss ? `まおうが あらわれた！` : `${enemy.name}が あらわれた！`);

    let result = null;
    while (!result) {
      guarding = false;
      // プレイヤーのターン
      let acted = false;
      while (!acted && !result) {
        const p = Game.player;
        const cmd = await waitMenu([
          { id: "attack", label: "たたかう" },
          { id: "skill", label: "スキル" },
          { id: "guard", label: "ぼうぎょ" },
          { id: "item", label: "アイテム", disabled: Game.DATA.items.consumables.every(c => Game.countItem(c.id) <= 0) },
          { id: "flee", label: "にげる" },
        ], "command");
        if (cmd.id === "attack") { await playerAttack(null, "こうげき"); acted = true; }
        else if (cmd.id === "skill") {
          const skills = Game.DATA.skills.skills.filter(s => p.level >= s.unlockLevel);
          const sk = await waitMenu(skills.map(s => ({
            id: s.id, label: `${s.name}（MP${s.mp}）${p.mp < s.mp ? " MP不足" : ""}`, skill: s, disabled: p.mp < s.mp,
          })).concat([{ id: "back", label: "もどる" }]), "skill");
          if (sk.id === "back") continue;
          const s = sk.skill;
          p.mp -= s.mp; Game.updateHUD();
          if (s.type === "heal") {
            const before = p.hp;
            p.hp = Math.min(p.maxHp, p.hp + s.heal);
            Sound.se.heal(); popup(`+${p.hp - before}`, "heal"); Game.updateHUD();
            await Game.showMessage(`${p.name}は ${s.name}を となえた！ HPが ${p.hp - before} かいふくした！`);
          } else {
            await playerAttack(s.power, `${s.name}（${s.element}）`, s.critRate);
          }
          acted = true;
        }
        else if (cmd.id === "guard") {
          guarding = true;
          await Game.showMessage(`${p.name}は みをまもっている。`);
          acted = true;
        }
        else if (cmd.id === "item") {
          const owned = Game.DATA.items.consumables.filter(c => Game.countItem(c.id) > 0);
          const it = await waitMenu(owned.map(c => ({
            id: c.id, label: `${c.name} ×${Game.countItem(c.id)}（${c.description}）`, item: c,
          })).concat([{ id: "back", label: "もどる" }]), "skill");
          if (it.id === "back") continue;
          const c = it.item;
          if (c.effect === "heal") {
            if (p.hp >= p.maxHp) { await Game.showMessage("HPは まんたんだ。"); continue; }
            const before = p.hp;
            p.hp = Math.min(p.maxHp, p.hp + c.amount);
            Game.removeItem(c.id, 1);
            Sound.se.heal(); popup(`+${p.hp - before}`, "heal"); Game.updateHUD();
            await Game.showMessage(`${c.name}を つかった！ HPが ${p.hp - before} かいふくした！`);
          } else if (c.effect === "mp") {
            if (p.mp >= p.maxMp) { await Game.showMessage("MPは まんたんだ。"); continue; }
            const before = p.mp;
            p.mp = Math.min(p.maxMp, p.mp + c.amount);
            Game.removeItem(c.id, 1);
            Sound.se.heal(); Game.updateHUD();
            await Game.showMessage(`${c.name}を つかった！ MPが ${p.mp - before} かいふくした！`);
          } else if (c.effect === "antidote") {
            if (poisonTurns <= 0) { await Game.showMessage("今は 毒に かかっていない。"); continue; }
            poisonTurns = 0;
            Game.removeItem(c.id, 1);
            Sound.se.heal(); Game.updateHUD();
            await Game.showMessage(`${c.name}を つかった！ 毒が 治った！`);
          }
          acted = true;
        }
        else if (cmd.id === "flee") {
          if (isBoss) { await Game.showMessage(`まおうからは にげられない！`); continue; }
          if (Math.random() < 0.6) {
            Sound.se.flee();
            await Game.showMessage(`${p.name}は にげだした！`);
            result = "fled";
          } else {
            await Game.showMessage(`まわりこまれてしまった！`);
            acted = true;
          }
        }
      }
      if (result) break;
      if (enemy.hp <= 0) { result = "win"; break; }
      await enemyAttack();
      if (Game.player.hp <= 0) { Game.player.hp = 0; Game.updateHUD(); result = "lose"; break; }
      await statusTick();
      if (Game.player.hp <= 0) { Game.player.hp = 0; Game.updateHUD(); result = "lose"; break; }
    }

    document.getElementById("battleWrap").classList.add("hidden");
    document.getElementById("fieldWrap").classList.remove("hidden");
    active = false;
    if (result === "win") {
      Sound.se.victory();
      const p = Game.player;
      p.gold += enemy.gold;
      await Game.showMessage(`${enemy.name}を たおした！ ${enemy.exp}の 経験値と ${enemy.gold} Gを てにいれた！`);
      p.exp += enemy.exp;
      while (p.exp >= Game.expNext(p.level)) {
        p.exp -= Game.expNext(p.level);
        p.level += 1;
        const g = Game.DATA.characters.hero.growthPerLevel;
        p.maxHp += g.maxHp; p.maxMp += g.maxMp; p.atk += g.atk; p.def += g.def; p.spd += g.spd;
        p.hp = Math.min(p.maxHp, p.hp + g.maxHp);
        p.mp = Math.min(p.maxMp, p.mp + g.maxMp);
        Sound.se.levelup(); Game.updateHUD();
        await Game.showMessage(`レベルが ${p.level}に あがった！ HP・攻撃力・防御力が 上昇した！`);
      }
      Game.updateHUD();
      Game.saveGame(true);
      if (isBoss) Game.onBossDefeated();
    } else if (result === "lose") {
      await Game.showMessage(`${Game.player.name}は ちからつきた……`);
      Game.onDefeat();
    }
    Game.afterBattle();
  }

  return { start, handleInput, isActive: () => active };
})();
