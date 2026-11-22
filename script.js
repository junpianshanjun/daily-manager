"use strict";

// ===== データの保存先（ブラウザの localStorage） =====
const TASK_KEY = "dailyManager_tasks";
const HABIT_KEY = "dailyManager_habits";

let tasks = load(TASK_KEY, []);
let habits = load(HABIT_KEY, []);

function load(key, fallback) {
  try {
    const data = JSON.parse(localStorage.getItem(key));
    return Array.isArray(data) ? data : fallback;
  } catch {
    return fallback;
  }
}

function save() {
  localStorage.setItem(TASK_KEY, JSON.stringify(tasks));
  localStorage.setItem(HABIT_KEY, JSON.stringify(habits));
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 端末のローカル日付を YYYY-MM-DD で返す（UTCにしないのがポイント）
function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayKey() {
  return dateKey(new Date());
}

// 習慣の継続日数：今日（未チェックなら昨日）からさかのぼって連続した日数
function streakOf(habit) {
  const done = new Set(habit.dates);
  const cursor = new Date();
  if (!done.has(dateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (done.has(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ===== 画面の要素 =====
const todayEl = document.getElementById("today");
const percentEl = document.getElementById("achievementPercent");
const barEl = document.getElementById("achievementBar");
const detailEl = document.getElementById("achievementDetail");
const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const taskList = document.getElementById("taskList");
const taskEmpty = document.getElementById("taskEmpty");
const habitForm = document.getElementById("habitForm");
const habitInput = document.getElementById("habitInput");
const habitList = document.getElementById("habitList");
const habitEmpty = document.getElementById("habitEmpty");

function showToday() {
  const now = new Date();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  todayEl.textContent =
    `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${weekdays[now.getDay()]}）`;
}

// ===== 表示の更新 =====
function render() {
  // タスク一覧
  taskList.innerHTML = "";
  taskEmpty.style.display = tasks.length ? "none" : "block";
  for (const task of tasks) {
    const li = document.createElement("li");
    li.className = "item" + (task.done ? " done" : "");

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      save();
      render();
    });
    const text = document.createElement("span");
    text.className = "item-text";
    text.textContent = task.text;
    label.append(checkbox, text);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-btn";
    del.textContent = "削除";
    del.addEventListener("click", () => {
      tasks = tasks.filter((t) => t.id !== task.id);
      save();
      render();
    });

    li.append(label, del);
    taskList.appendChild(li);
  }

  // 習慣一覧
  habitList.innerHTML = "";
  habitEmpty.style.display = habits.length ? "none" : "block";
  const today = todayKey();
  for (const habit of habits) {
    const li = document.createElement("li");
    li.className = "item" + (habit.dates.includes(today) ? " done" : "");

    const main = document.createElement("div");
    main.className = "item-main";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = habit.dates.includes(today);
    checkbox.setAttribute("aria-label", `${habit.name}を今日できたことにする`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        if (!habit.dates.includes(today)) habit.dates.push(today);
      } else {
        habit.dates = habit.dates.filter((d) => d !== today);
      }
      save();
      render();
    });
    const text = document.createElement("span");
    text.className = "item-text";
    text.textContent = habit.name;
    const streak = document.createElement("span");
    streak.className = "streak";
    const days = streakOf(habit);
    streak.textContent = days > 0 ? `${days}日連続` : "";
    main.append(checkbox, text, streak);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-btn";
    del.textContent = "削除";
    del.addEventListener("click", () => {
      habits = habits.filter((h) => h.id !== habit.id);
      save();
      render();
    });

    li.append(main, del);
    habitList.appendChild(li);
  }

  renderAchievement();
}

function renderAchievement() {
  const doneTasks = tasks.filter((t) => t.done).length;
  const today = todayKey();
  const doneHabits = habits.filter((h) => h.dates.includes(today)).length;
  const total = tasks.length + habits.length;
  const done = doneTasks + doneHabits;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  percentEl.textContent = `${percent}%`;
  barEl.style.width = `${percent}%`;
  detailEl.textContent = `タスク ${doneTasks} / ${tasks.length} ・ 習慣 ${doneHabits} / ${habits.length}`;
}

// ===== 追加フォーム =====
taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = taskInput.value.trim();
  if (!text) return;
  tasks.push({ id: newId(), text, done: false });
  taskInput.value = "";
  save();
  render();
});

habitForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = habitInput.value.trim();
  if (!name) return;
  habits.push({ id: newId(), name, dates: [] });
  habitInput.value = "";
  save();
  render();
});

// ===== 起動 =====
showToday();
render();
