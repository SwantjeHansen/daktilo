const WORD_BANK = window.DAKTILO_WORDS || {};

function categoryObject(key) { return WORD_BANK[key] || { label: key, subcategories: {} }; }
function allItemsForCategory(key) {
  const obj = categoryObject(key);
  return [...new Set(Object.values(obj.subcategories || {}).flatMap((section) => section.items || []))];
}
function isEasyLength(item) {
  return String(item).replace(/\s+/g, "").length <= 8;
}
function itemsForCategory(key, subcategory = "all") {
  const obj = categoryObject(key);
  const items = subcategory === "all" ? allItemsForCategory(key) : [...new Set(obj.subcategories?.[subcategory]?.items || [])];
  // "Einfach" means genuinely short here. Long compounds belong in the harder categories.
  return key === "easy" ? items.filter(isEasyLength) : items;
}

const EASY_WORDS = allItemsForCategory("easy").filter(isEasyLength);
const HARD_WORDS = allItemsForCategory("hard");
const TECHNICAL_WORDS = allItemsForCategory("technical");
const ENGLISH_WORDS = allItemsForCategory("english");
const NAMES = allItemsForCategory("names");
const SENTENCES = allItemsForCategory("sentences");

const MIN_SIGN_MS = 50;

const SPEED_LEVELS = [
  { level: 1, ms: 2000 }, { level: 2, ms: 1600 }, { level: 3, ms: 1300 }, { level: 4, ms: 1000 },
  { level: 5, ms: 800 }, { level: 6, ms: 650 }, { level: 7, ms: 500 }, { level: 8, ms: 400 },
  { level: 9, ms: 320 }, { level: 10, ms: 250 }, { level: 11, ms: 200 }, { level: 12, ms: 160 },
  { level: 13, ms: 130 }, { level: 14, ms: 110 }, { level: 15, ms: 95 }, { level: 16, ms: 80 },
  { level: 17, ms: 70 }, { level: 18, ms: 60 }, { level: 19, ms: 55 }, { level: 20, ms: 50 }
];

const CATEGORY_INFO = {
  mixed: { label: "Alle Kategorien", multiplier: 1.0 },
  easy: { label: "Einfach", multiplier: 1.0 },
  hard: { label: "Schwierig", multiplier: 1.35 },
  technical: { label: "Fachwörter", multiplier: 1.7 },
  english: { label: "Englisch", multiplier: 1.4 },
  names: { label: "Namen", multiplier: 1.15 },
  nonsense: { label: "Quatsch", multiplier: 1.6 },
  sentences: { label: "Sätze", multiplier: 1.4 },
  weak: { label: "Problemtraining", multiplier: 1.0 }
};

const STORAGE_KEY = "fingerTrainerV2";
const PASSWORD_ITERATIONS = 150000;
const BETWEEN_SIGNS_MS = 0;
const WORD_GAP_MS = 260;
const IMAGE_VARIANTS = 5;
const IMAGE_EXTENSIONS = ["png", "webp"];
const RESPONSIVE_IMAGE_SIZES = [480, 800, 1200];
let sessionImageBucket = null;
const resolvedImageUrls = new Map();
const failedImageSigns = new Set();
const decodedImageCache = new Map();
const imageLoadPromises = new Map();
const NONSENSE_LENGTHS = [5, 6, 7, 8, 9]; // default random range; fixed 4–20 is selectable
const DISPLAY_SIGNS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "Ä", "Ö", "Ü", "ß", "SCH"];
const LETTERS = [...DISPLAY_SIGNS];
const VOWELS = [..."AEIOUÄÖÜ"];
const CONSONANTS = LETTERS.filter((l) => !VOWELS.includes(l));

const state = {
  player: "",
  mode: "training",
  category: "easy",
  subcategory: "all",
  inputMode: "memory",
  speedMode: "adaptive",
  fixedLevel: 4,
  adaptiveLevel: 4,
  adaptiveSuccesses: 0,
  challengeType: "points",
  thresholdSpeedMs: 800,
  thresholdCorrectRun: 0,
  thresholdDirection: null,
  thresholdReversals: [],
  thresholdTrials: 0,
  thresholdTrialSpeeds: [],
  thresholdEstimateMs: null,
  thresholdAutoFinish: false,
  sessionScore: 0,
  streak: 0,
  wordsAnswered: 0,
  correct: 0,
  replaysThisWord: 0,
  trainingHadMistake: false,
  trainingAttempts: 0,
  trainingAdaptivePenalized: false,
  totalReplays: 0,
  wordStartTime: 0,
  answerTimes: [],
  bestLevel: 1,
  currentItem: "",
  currentItemCategory: "easy",
  currentItemSubcategory: "all",
  sequenceRunning: false,
  sequenceFinished: false,
  sequenceToken: 0,
  pendingTimer: null,
  sessionStartedAt: null,
  active: false,
  lastOutcomeAt: 0,
  nonsenseLength: "random",
  sessionSeenItems: new Set(),
};

const $ = (id) => document.getElementById(id);
const setupCard = $("setupCard");
const gameCard = $("gameCard");
const resultsCard = $("resultsCard");
const setupForm = $("setupForm");
const answerForm = $("answerForm");
const answerInput = $("answerInput");
const submitAnswer = $("submitAnswer");
const replayButton = $("replayButton");
const solutionButton = $("solutionButton");
const feedback = $("feedback");
const fingerPhoto = $("fingerPhoto");
const photoPlaceholder = $("photoPlaceholder");
const placeholderLetter = $("placeholderLetter");
const wordGap = $("wordGap");
const progressBar = $("progressBar");
const leaderboardDialog = $("leaderboardDialog");
const statsDialog = $("statsDialog");
const imprintDialog = $("imprintDialog");
const privacyDialog = $("privacyDialog");

const zoomSelect = $("zoomSelect");
const ZOOM_STORAGE_KEY = "daktiloUiScale";
let cloudSyncChain = Promise.resolve();
function cloudConfigured() { return Boolean(window.DaktiloCloud?.configured); }
function queueCloud(task) {
  if (!cloudConfigured()) return;
  cloudSyncChain = cloudSyncChain.then(task).catch((err) => console.warn("Daktilo cloud sync:", err));
}
function updateCloudStatus() {
  const el = $("cloudStatus");
  if (!el) return;
  const online = cloudConfigured();
  el.classList.toggle("online", online);
  el.classList.toggle("local", !online);
  el.textContent = online ? "Online-Konto · Lernstand wird geräteübergreifend synchronisiert" : "Lokale Demo · Supabase noch nicht in config.js eingerichtet";
  const note = $("authNote");
  if (note) note.textContent = online
    ? "Beim ersten Start wird der Benutzername registriert. Danach kannst du dich auf anderen Geräten anmelden. Beta-Hinweis: Ein vergessenes Passwort kann derzeit noch nicht zurückgesetzt werden."
    : "Ohne Supabase bleibt dieses Profil nur auf diesem Gerät. Für die Online-Version config.js und Supabase einrichten.";
}


function autoZoomPercent() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w <= 820) return 100;
  if (h < 680) return 70;
  if (h < 760) return 80;
  if (h < 850) return 90;
  return 100;
}

function applyZoomSetting(setting) {
  const selected = setting || "auto";
  const percent = selected === "auto" ? autoZoomPercent() : Number(selected);
  const safePercent = Number.isFinite(percent) ? Math.min(130, Math.max(70, percent)) : 100;
  document.documentElement.style.setProperty("--ui-scale", String(safePercent / 100));
  document.documentElement.dataset.zoom = String(safePercent);
  if (zoomSelect) zoomSelect.value = selected;
}

function initZoomControl() {
  const saved = localStorage.getItem(ZOOM_STORAGE_KEY) || "auto";
  applyZoomSetting(saved);
  if (!zoomSelect) return;
  zoomSelect.addEventListener("change", () => {
    localStorage.setItem(ZOOM_STORAGE_KEY, zoomSelect.value);
    applyZoomSetting(zoomSelect.value);
  });
  window.addEventListener("resize", () => {
    if ((localStorage.getItem(ZOOM_STORAGE_KEY) || "auto") === "auto") applyZoomSetting("auto");
  }, { passive: true });
}


function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function randomItem(items) { return items[Math.floor(Math.random() * items.length)]; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function canonicalPlayer(name) { return name.trim().replace(/\s+/g, " "); }
function playerKey(name) { return canonicalPlayer(name).toLocaleLowerCase("de-DE"); }
function normalizeAnswer(value) {
  // JavaScript converts ß to SS when uppercasing. Preserve it explicitly so ß remains a distinct sign.
  const sharpSMarker = "\uE000";
  return String(value)
    .replace(/[ßẞ]/g, sharpSMarker)
    .toUpperCase()
    .replaceAll(sharpSMarker, "ß")
    .replace(/[^A-ZÄÖÜß\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function compact(value) { return normalizeAnswer(value).replaceAll(" ", ""); }
function tokenizeSequence(value) {
  const text = normalizeAnswer(value);
  const tokens = [];
  for (let i = 0; i < text.length;) {
    if (text[i] === " ") {
      tokens.push(" ");
      i += 1;
    } else if (text.slice(i, i + 3) === "SCH") {
      tokens.push("SCH");
      i += 3;
    } else {
      tokens.push(text[i]);
      i += 1;
    }
  }
  return tokens;
}
function tokenizeSigns(value) { return tokenizeSequence(value).filter((token) => token !== " "); }
function accuracy(correct, total) { return total ? Math.round((correct / total) * 100) : 0; }
function isThresholdTest() { return state.mode === "challenge" && state.challengeType === "threshold"; }
function speedMsForLevel(level) {
  const safeLevel = clamp(Math.round(Number(level) || 1), 1, SPEED_LEVELS.length);
  return SPEED_LEVELS[safeLevel - 1].ms;
}
function nearestLevelForMs(ms) {
  let best = 1, bestDiff = Infinity;
  for (let level = 1; level <= Math.max(40, SPEED_LEVELS.length); level += 1) {
    const diff = Math.abs(Math.log(Math.max(1, speedMsForLevel(level))) - Math.log(Math.max(1, ms)));
    if (diff < bestDiff) { bestDiff = diff; best = level; }
  }
  return best;
}
function currentLevel() {
  if (isThresholdTest()) return nearestLevelForMs(state.thresholdSpeedMs);
  return state.speedMode === "adaptive" ? state.adaptiveLevel : state.fixedLevel;
}
function currentSpeed() { return isThresholdTest() ? Math.max(MIN_SIGN_MS, Math.round(state.thresholdSpeedMs)) : speedMsForLevel(currentLevel()); }
function speedLabel(level = currentLevel()) {
  if (isThresholdTest()) return `Test · ${currentSpeed()} ms`;
  return `L${level} · ${speedMsForLevel(level)} ms`;
}
function nowIso() { return new Date().toISOString(); }
function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function startOfWeek(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}
function weekKey(date = new Date()) { return localDateKey(startOfWeek(date)); }
function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((b) => binary += String.fromCharCode(b));
  return btoa(binary);
}
function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function passwordHash(password, saltBase64, iterations = PASSWORD_ITERATIONS) {
  if (!globalThis.crypto?.subtle) throw new Error("Dieser Browser unterstützt den lokalen Passwortschutz nicht.");
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(saltBase64), iterations }, material, 256);
  return bytesToBase64(new Uint8Array(bits));
}
async function createLocalCredential(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltBase64 = bytesToBase64(salt);
  return { salt: saltBase64, hash: await passwordHash(password, saltBase64), iterations: PASSWORD_ITERATIONS };
}
async function verifyLocalCredential(password, auth) {
  if (!auth?.salt || !auth?.hash) return false;
  const actual = await passwordHash(password, auth.salt, auth.iterations || PASSWORD_ITERATIONS);
  return actual === auth.hash;
}
async function unlockOrCreateLocalProfile(name, password) {
  const db = getDb();
  const key = playerKey(name);
  const existing = db.players[key];
  if (existing?.auth) {
    if (!(await verifyLocalCredential(password, existing.auth))) return { ok: false, reason: "Falsches Passwort für diesen Namen." };
    return { ok: true, created: false };
  }
  const player = ensurePlayer(db, name);
  player.auth = await createLocalCredential(password);
  player.trainingAdaptiveLevel ||= 4;
  saveDb(db);
  return { ok: true, created: true };
}

function emptyDb() { return { version: 2, players: {}, events: [], sessions: [] }; }
function getDb() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || parsed.version !== 2) return emptyDb();
    parsed.players ||= {};
    parsed.events ||= [];
    parsed.sessions ||= [];
    return parsed;
  } catch { return emptyDb(); }
}
function saveDb(db) {
  db.events = db.events.slice(-5000);
  db.sessions = db.sessions.slice(-1000);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}
function ensurePlayer(db, name) {
  const key = playerKey(name);
  if (!db.players[key]) {
    db.players[key] = {
      name: canonicalPlayer(name), challengePoints: 0, trainingWords: 0, totalWords: 0, totalCorrect: 0,
      totalReplays: 0, trainingMs: 0, bestChallengeWord: 0, bestStreak: 0, letters: {}, confusions: {}, combos: {},
      createdAt: nowIso(), lastPlayedAt: nowIso()
    };
  }
  db.players[key].name = canonicalPlayer(name);
  db.players[key].lastPlayedAt = nowIso();
  db.players[key].thresholdTests ||= [];
  db.players[key].bestThresholdMs ??= null;
  db.players[key].lastThresholdMs ??= null;
  db.players[key].trainingAdaptiveLevel ||= 4;
  db.players[key].weekKey ||= weekKey();
  db.players[key].weekPoints ||= 0;
  return db.players[key];
}

function hydrateFromCloud(name, remote, { preferLocal = false } = {}) {
  if (!remote) return;
  const db = getDb();
  const key = playerKey(name);
  const local = ensurePlayer(db, name);
  const remotePlayer = remote.player && typeof remote.player === "object" ? remote.player : null;
  if (!preferLocal && remotePlayer) {
    const clean = { ...remotePlayer, name: remote.profile?.username || name };
    delete clean.auth;
    db.players[key] = { ...local, ...clean };
  } else if (remote.profile && !preferLocal) {
    db.players[key] = {
      ...local,
      name: remote.profile.username || name,
      challengePoints: Number(remote.profile.challenge_points || 0),
      trainingWords: Number(remote.profile.training_words || 0),
      totalWords: Number(remote.profile.total_words || 0),
      totalCorrect: Number(remote.profile.total_correct || 0),
      totalReplays: Number(remote.profile.total_replays || 0),
      trainingMs: Number(remote.profile.training_ms || 0),
      bestChallengeWord: Number(remote.profile.best_challenge_word || 0),
      bestStreak: Number(remote.profile.best_streak || 0),
      bestThresholdMs: remote.profile.best_threshold_ms == null ? null : Number(remote.profile.best_threshold_ms),
      lastThresholdMs: remote.profile.last_threshold_ms == null ? null : Number(remote.profile.last_threshold_ms),
      trainingAdaptiveLevel: Math.max(1, Number(remote.profile.adaptive_level || 4)),
      weekKey: remote.profile.week_key || weekKey(),
      weekPoints: Number(remote.profile.week_points || 0)
    };
  }
  const player = db.players[key];
  delete player.auth;
  if (!preferLocal && Array.isArray(remote.events)) {
    const otherEvents = db.events.filter((e) => e.playerKey !== key);
    const onlineEvents = remote.events.map((e) => ({ ...e, playerKey: key, player: player.name }));
    db.events = [...otherEvents, ...onlineEvents].slice(-5000);
  }
  saveDb(db);
}

function letterStats(player, char) {
  player.letters[char] ||= { seen: 0, errors: 0 };
  return player.letters[char];
}

function alignment(expected, guessed) {
  const a = tokenizeSigns(expected);
  const b = tokenizeSigns(guessed);
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const ops = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      if (dp[i][j] === dp[i - 1][j - 1] + cost) {
        ops.push({ type: cost ? "sub" : "match", expected: a[i - 1], guessed: b[j - 1], expectedIndex: i - 1 });
        i -= 1; j -= 1; continue;
      }
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ type: "del", expected: a[i - 1], guessed: "", expectedIndex: i - 1 });
      i -= 1; continue;
    }
    ops.push({ type: "ins", expected: "", guessed: b[j - 1], expectedIndex: Math.max(0, i - 1) });
    j -= 1;
  }
  return ops.reverse();
}

function updateProblemStats(player, expected, guessed) {
  const target = tokenizeSigns(expected);
  target.forEach((symbol) => letterStats(player, symbol).seen += 1);
  const ops = alignment(expected, guessed);
  ops.forEach((op) => {
    if ((op.type === "sub" || op.type === "del") && op.expected) {
      letterStats(player, op.expected).errors += 1;
      const prev = target[op.expectedIndex - 1] || "";
      const next = target[op.expectedIndex + 1] || "";
      [[prev, op.expected], [op.expected, next]].filter((parts) => parts.every(Boolean)).forEach((parts) => {
        const combo = parts.join("·");
        player.combos[combo] ||= { seen: 0, errors: 0 };
        player.combos[combo].errors += 1;
      });
    }
    if (op.type === "sub" && op.expected && op.guessed) {
      const key = `${op.expected}→${op.guessed}`;
      player.confusions[key] = (player.confusions[key] || 0) + 1;
    }
    if (op.type === "del" && op.expected) {
      const key = `${op.expected}→∅`;
      player.confusions[key] = (player.confusions[key] || 0) + 1;
    }
  });
  for (let k = 0; k < target.length - 1; k += 1) {
    const combo = [target[k], target[k + 1]].join("·");
    player.combos[combo] ||= { seen: 0, errors: 0 };
    player.combos[combo].seen += 1;
  }
}

function weakTargetsForPlayer(name, limit = 6) {
  const db = getDb();
  const player = db.players[playerKey(name)];
  if (!player) return [];
  const letters = Object.entries(player.letters || {})
    .filter(([, s]) => s.seen >= 3 && s.errors > 0)
    .map(([symbol, s]) => ({ symbol, score: (s.errors / s.seen) * Math.log2(s.seen + 1) }))
    .sort((a, b) => b.score - a.score);
  const combos = Object.entries(player.combos || {})
    .filter(([, s]) => s.seen >= 3 && s.errors > 0)
    .map(([symbol, s]) => ({ symbol, score: (s.errors / s.seen) * Math.log2(s.seen + 1) * 0.9 }))
    .sort((a, b) => b.score - a.score);
  return [...letters, ...combos].sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.symbol);
}

function selectedNonsenseLength() {
  const raw = state.nonsenseLength;
  if (raw === "random") return randomItem(NONSENSE_LENGTHS);
  const fixed = Number(raw);
  return Number.isInteger(fixed) ? clamp(fixed, 4, 20) : randomItem(NONSENSE_LENGTHS);
}

function makeNonsense({ weak = false } = {}) {
  const length = selectedNonsenseLength();
  const targets = weak ? weakTargetsForPlayer(state.player, 5) : [];
  const tokens = [];
  let useVowel = Math.random() > 0.5;
  while (tokens.length < length) {
    const pool = useVowel ? VOWELS : CONSONANTS;
    tokens.push(randomItem(pool));
    useVowel = Math.random() > 0.2 ? !useVowel : useVowel;
  }
  if (targets.length) {
    const selected = randomItem(targets);
    const selectedTokens = selected.includes("·") ? selected.split("·") : [selected];
    const start = Math.floor(Math.random() * Math.max(1, length - selectedTokens.length + 1));
    selectedTokens.forEach((symbol, offset) => { if (start + offset < tokens.length) tokens[start + offset] = symbol; });
    if (Math.random() < 0.45 && targets.length > 1) {
      const second = randomItem(targets.filter((t) => t !== selected));
      const secondToken = second.includes("·") ? second.split("·")[0] : second;
      const pos = Math.floor(Math.random() * tokens.length);
      tokens[pos] = secondToken;
    }
  }
  return tokens.join("");
}

function rememberSessionItem(item) {
  const key = normalizeAnswer(item);
  if (key) state.sessionSeenItems.add(key);
  return item;
}

function chooseUnseenFromPool(pool) {
  const uniquePool = [...new Set(pool)].filter(Boolean);
  if (!uniquePool.length) return "";
  const unseen = uniquePool.filter((item) => !state.sessionSeenItems.has(normalizeAnswer(item)));
  if (unseen.length) return rememberSessionItem(randomItem(unseen));
  // Infinite training can eventually exhaust a small pool. Only then allow a new cycle.
  uniquePool.forEach((item) => state.sessionSeenItems.delete(normalizeAnswer(item)));
  return rememberSessionItem(randomItem(uniquePool));
}

function chooseUnseenNonsense({ weak = false } = {}) {
  for (let tries = 0; tries < 80; tries += 1) {
    const item = makeNonsense({ weak });
    if (!state.sessionSeenItems.has(normalizeAnswer(item))) return rememberSessionItem(item);
  }
  return rememberSessionItem(makeNonsense({ weak }));
}

function nextItem() {
  let category = state.category;
  let subcategory = state.subcategory;

  if (category === "mixed") {
    const categories = ["easy", "hard", "technical", "english", "names", "sentences", "nonsense"];
    for (let tries = 0; tries < categories.length * 2; tries += 1) {
      const candidateCategory = randomItem(categories);
      if (candidateCategory === "nonsense") {
        state.currentItemCategory = candidateCategory;
        state.currentItemSubcategory = "all";
        return chooseUnseenNonsense();
      }
      const candidatePool = itemsForCategory(candidateCategory, "all");
      const unseen = candidatePool.filter((item) => !state.sessionSeenItems.has(normalizeAnswer(item)));
      if (unseen.length) {
        state.currentItemCategory = candidateCategory;
        state.currentItemSubcategory = "all";
        return rememberSessionItem(randomItem(unseen));
      }
    }
    category = "easy";
    subcategory = "all";
  }

  state.currentItemCategory = category;
  state.currentItemSubcategory = subcategory;

  if (["easy", "hard", "technical", "english", "names", "sentences"].includes(category)) {
    const pool = itemsForCategory(category, subcategory);
    return chooseUnseenFromPool(pool.length ? pool : allItemsForCategory(category));
  }
  if (category === "nonsense") return chooseUnseenNonsense();
  return chooseUnseenNonsense({ weak: true });
}

function populateSubcategories() {
  const wrap = $("subcategoryWrap");
  const select = $("subcategorySelect");
  const category = $("categorySelect").value;
  if (!["easy", "hard", "technical", "english", "names", "sentences"].includes(category)) {
    wrap.classList.add("hidden");
    select.innerHTML = "";
    return;
  }
  const obj = categoryObject(category);
  const sections = Object.entries(obj.subcategories || {});
  wrap.classList.remove("hidden");
  select.innerHTML = `<option value="all">Alle Bereiche</option>` + sections.map(([key, section]) =>
    `<option value="${escapeHtml(key)}">${escapeHtml(section.label)}</option>`
  ).join("");
}


function populateNonsenseLengths() {
  const select = $("nonsenseLengthSelect");
  if (!select) return;
  const previous = select.value || "random";
  select.innerHTML = `<option value="random">Zufällig · 5 bis 9 Buchstaben</option>` +
    Array.from({ length: 17 }, (_, i) => i + 4).map((n) => `<option value="${n}">${n} Buchstaben</option>`).join("");
  select.value = [...select.options].some((option) => option.value === previous) ? previous : "random";
}

function updateNonsenseLengthVisibility() {
  const wrap = $("nonsenseLengthWrap");
  const select = $("nonsenseLengthSelect");
  const category = $("categorySelect")?.value;
  if (!wrap || !select) return;

  const active = category === "nonsense";
  wrap.hidden = !active;
  select.disabled = !active;
}


function populateSpeeds() {
  const select = $("speedSelect");
  select.innerHTML = `<option value="adaptive">Adaptiv</option>` + SPEED_LEVELS.map((s) =>
    `<option value="${s.level}">Level ${s.level} · ${s.ms} ms</option>`).join("");
  select.value = "adaptive";
}

function updateSetupConstraints() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const challengeWrap = $("challengeTypeWrap");
  const challengeType = $("challengeTypeSelect")?.value || "points";
  const threshold = mode === "challenge" && challengeType === "threshold";
  const speedSelect = $("speedSelect");
  const adaptive = speedSelect.querySelector('option[value="adaptive"]');
  const weakCategory = $("categorySelect").querySelector('option[value="weak"]');
  challengeWrap?.classList.toggle("hidden", mode !== "challenge");
  $("thresholdExplainer")?.classList.toggle("hidden", !threshold);
  $("speedWrap")?.classList.toggle("hidden", threshold);
  adaptive.disabled = mode === "challenge";
  weakCategory.disabled = mode === "challenge";
  if (mode === "challenge" && !threshold && speedSelect.value === "adaptive") speedSelect.value = "4";
  if (mode === "challenge" && $("categorySelect").value === "weak") $("categorySelect").value = "easy";
  updateNonsenseLengthVisibility();
  if (threshold) {
    $("inputModeSelect").value = "memory";
    $("inputModeSelect").disabled = true;
  } else {
    $("inputModeSelect").disabled = false;
  }
}

function setControls() {
  const locked = feedback.classList.contains("locked");
  const canType = state.active && (state.inputMode === "live" || state.sequenceFinished) && !locked;
  answerInput.disabled = !canType;
  submitAnswer.disabled = !state.active || !state.sequenceFinished || locked;
  replayButton.disabled = !state.active || state.sequenceRunning || locked || isThresholdTest();
  if (solutionButton) {
    const canReveal = state.active && state.mode === "training" && state.trainingHadMistake && state.sequenceFinished && !state.sequenceRunning && !locked;
    solutionButton.classList.toggle("hidden", !canReveal);
    solutionButton.disabled = !canReveal;
  }
}

function hideVisual() {
  fingerPhoto.style.display = "none";
  fingerPhoto.classList.remove("is-duplicate");
  fingerPhoto.dataset.sign = "";
  photoPlaceholder.style.display = "none";
  wordGap.classList.add("hidden");
}

function preferredImageBucket() {
  if (sessionImageBucket) return sessionImageBucket;

  const available = Array.isArray(window.DAKTILO_IMAGE_VARIANTS?.sizes)
    ? window.DAKTILO_IMAGE_VARIANTS.sizes.filter((n) => Number.isFinite(Number(n))).map(Number).sort((a, b) => a - b)
    : RESPONSIVE_IMAGE_SIZES;

  // Estimate the real rendered stimulus size. DPR is capped deliberately:
  // beyond ~1.5x there is little perceptual benefit here, but decoding/memory costs rise sharply.
  const viewportWidth = Math.max(280, window.innerWidth - 32);
  const viewportHeight = Math.max(320, window.innerHeight);
  const cssTarget = Math.min(860, viewportWidth, viewportHeight * 0.72);
  const effectiveDpr = Math.min(1.5, Math.max(1, Number(window.devicePixelRatio) || 1));
  const targetPixels = cssTarget * effectiveDpr;

  sessionImageBucket = available.find((size) => size >= targetPixels) || available[available.length - 1] || 800;
  document.documentElement.dataset.imageBucket = String(sessionImageBucket);
  return sessionImageBucket;
}

function responsiveImageCandidates(sign, { variants = true } = {}) {
  const manifest = window.DAKTILO_IMAGE_VARIANTS;
  if (!manifest?.enabled || !manifest.files) return [];

  const bucket = preferredImageBucket();
  const available = new Set(manifest.files[String(bucket)] || []);
  if (!available.size) return [];

  const names = imageBaseNames(sign);
  const candidates = [];

  if (variants && IMAGE_VARIANTS > 0) {
    const firstVariant = 1 + Math.floor(Math.random() * IMAGE_VARIANTS);
    for (let offset = 0; offset < IMAGE_VARIANTS; offset += 1) {
      const variant = 1 + ((firstVariant - 1 + offset) % IMAGE_VARIANTS);
      const suffix = `_${String(variant).padStart(2, "0")}`;
      for (const name of names) {
        const stem = `${name}${suffix}`;
        if (available.has(stem)) candidates.push(`images/${bucket}/${encodeURIComponent(stem)}.webp`);
      }
    }
  }

  for (const name of names) {
    if (available.has(name)) candidates.push(`images/${bucket}/${encodeURIComponent(name)}.webp`);
  }

  return [...new Set(candidates)];
}

function imageBaseNames(sign) {
  const aliases = {
    "Ä": ["Ä", "ä", "AE", "ae"],
    "Ö": ["Ö", "ö", "OE", "oe"],
    "Ü": ["Ü", "ü", "UE", "ue"],
    "ß": ["ß", "ẞ", "SS", "ss"],
    "SCH": ["SCH", "sch"]
  };
  const lower = sign.toLocaleLowerCase("de-DE");
  return [...new Set(aliases[sign] || [sign, lower])];
}

function imageCandidates(sign, { variants = true } = {}) {
  const names = imageBaseNames(sign);
  const candidates = [];
  for (const extension of IMAGE_EXTENSIONS) {
    if (variants && IMAGE_VARIANTS > 0) {
      const firstVariant = 1 + Math.floor(Math.random() * IMAGE_VARIANTS);
      for (const name of names) candidates.push(`images/${encodeURIComponent(name)}_${String(firstVariant).padStart(2, "0")}.${extension}`);
    }
    for (const name of names) candidates.push(`images/${encodeURIComponent(name)}.${extension}`);
  }
  return [...new Set(candidates)];
}

function preloadUrl(url) {
  if (decodedImageCache.has(url)) return Promise.resolve(true);
  if (imageLoadPromises.has(url)) return imageLoadPromises.get(url);

  const promise = new Promise((resolve) => {
    const probe = new Image();
    probe.decoding = "async";

    probe.onload = async () => {
      try {
        if (typeof probe.decode === "function") await probe.decode();
      } catch {
        // onload already proves the image is usable; decode() may reject on some browsers.
      }
      decodedImageCache.set(url, probe);
      resolve(true);
    };

    probe.onerror = () => resolve(false);
    probe.src = url;
  }).finally(() => imageLoadPromises.delete(url));

  imageLoadPromises.set(url, promise);
  return promise;
}

async function resolveImageUrl(letter) {
  if (resolvedImageUrls.has(letter)) return resolvedImageUrls.get(letter);
  if (failedImageSigns.has(letter)) return null;

  // If optimized variants exist, use exactly one size class for the whole page session.
  // Otherwise fall back to the original PNG/WebP files with no extra 404 probes.
  const responsive = [
    ...responsiveImageCandidates(letter, { variants: false }),
    ...responsiveImageCandidates(letter, { variants: true })
  ];
  const originals = [
    ...imageCandidates(letter, { variants: false }),
    ...imageCandidates(letter, { variants: true })
  ];
  const candidates = [...new Set([...responsive, ...originals])];

  for (const url of candidates) {
    if (await preloadUrl(url)) {
      resolvedImageUrls.set(letter, url);
      return url;
    }
  }
  failedImageSigns.add(letter);
  return null;
}

function prepareSequenceImages(chars) {
  const signs = [...new Set(chars.filter((sign) => sign !== " "))];
  return Promise.all(signs.map((sign) => resolveImageUrl(sign)));
}

function preloadSignImages() {
  // Do not start 30+ large photo decodes at once. Warm the cache gradually
  // while the browser is idle so active training keeps priority.
  let index = 0;
  const warmNext = () => {
    if (index >= DISPLAY_SIGNS.length) return;
    const sign = DISPLAY_SIGNS[index++];
    resolveImageUrl(sign).finally(() => {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(warmNext, { timeout: 250 });
      } else {
        setTimeout(warmNext, 40);
      }
    });
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(warmNext, { timeout: 250 });
  } else {
    setTimeout(warmNext, 40);
  }
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function showSign(letter, { duplicate = false } = {}) {
  photoPlaceholder.style.display = "none";
  wordGap.classList.add("hidden");

  if (letter === " ") {
    fingerPhoto.style.display = "none";
    fingerPhoto.classList.remove("is-duplicate");
    fingerPhoto.dataset.sign = "";
    await nextPaint();
    return;
  }

  const url = await resolveImageUrl(letter);
  if (!url) {
    fingerPhoto.style.display = "none";
    fingerPhoto.classList.remove("is-duplicate");
    fingerPhoto.dataset.sign = "";
    placeholderLetter.textContent = letter;
    photoPlaceholder.querySelector("small").textContent = `Foto fehlt · ${letter}`;
    photoPlaceholder.style.display = "grid";
    await nextPaint();
    return;
  }

  // Stimuluswechsel absichtlich ohne Fade: genau ein Handbild gleichzeitig.
  if (fingerPhoto.src !== new URL(url, document.baseURI).href) {
    fingerPhoto.src = url;
  }
  fingerPhoto.dataset.sign = letter;
  fingerPhoto.classList.toggle("is-duplicate", duplicate);
  fingerPhoto.style.display = "block";

  // Der Timer startet erst, nachdem der Browser den neuen Stimulus malen konnte.
  await nextPaint();
}

async function playSequence({ replay = false } = {}) {
  if (state.sequenceRunning || !state.active) return;
  if (replay && isThresholdTest()) return;
  state.sequenceRunning = true;
  state.sequenceFinished = false;
  state.sequenceToken += 1;
  const token = state.sequenceToken;
  feedback.className = "feedback hidden";
  feedback.innerHTML = "";
  if (replay) {
    state.replaysThisWord += 1;
    state.totalReplays += 1;
    if (state.speedMode === "adaptive") state.adaptiveSuccesses = 0;
  } else {
    state.wordStartTime = performance.now();
  }
  updateStats();
  setControls();
  const chars = tokenizeSequence(state.currentItem);

  // Resolve and decode exactly the signs needed for this word before playback.
  // A short wait before the word is preferable to a hitch in the middle of it.
  await prepareSequenceImages(chars);
  if (token !== state.sequenceToken || !state.active) return;

  for (let i = 0; i < chars.length; i += 1) {
    if (token !== state.sequenceToken || !state.active) return;
    const char = chars[i];
    const duplicate = char !== " " && i > 0 && chars[i - 1] === char;
    progressBar.style.transform = `scaleX(${(i + 1) / chars.length})`;
    await showSign(char, { duplicate });
    await sleep(char === " " ? WORD_GAP_MS : currentSpeed());
    if (i < chars.length - 1) {
      if (BETWEEN_SIGNS_MS > 0) {
        hideVisual();
        await sleep(BETWEEN_SIGNS_MS);
      }
    } else {
      hideVisual();
    }
  }
  if (token !== state.sequenceToken || !state.active) return;
  progressBar.style.transform = "scaleX(1)";
  state.sequenceRunning = false;
  state.sequenceFinished = true;
  setControls();
}

function categoryMultiplier() { return CATEGORY_INFO[state.currentItemCategory || state.category]?.multiplier || 1; }
function speedMultiplier(level = currentLevel()) { return 0.5 + level * 0.125; }
function streakMultiplier() {
  if (state.streak >= 20) return 1.30;
  if (state.streak >= 10) return 1.20;
  if (state.streak >= 5) return 1.10;
  return 1;
}
function replayMultiplier() {
  if (state.replaysThisWord === 0) return 1;
  if (state.replaysThisWord === 1) return 0.8;
  if (state.replaysThisWord === 2) return 0.6;
  return 0.4;
}
function pointsForCorrect() {
  if (isThresholdTest()) return 0;
  if (state.mode !== "challenge") return 100 + Math.min(100, state.streak * 5);
  return Math.round(100 * categoryMultiplier() * speedMultiplier() * streakMultiplier() * replayMultiplier());
}

function thresholdStepFactor() {
  // Coarse-to-fine multiplicative staircase in milliseconds.
  // The first successful runs move very aggressively so the test reaches the useful range quickly.
  // After reversals the step size shrinks progressively for a stable threshold estimate.
  const reversals = state.thresholdReversals.length;
  if (reversals === 0 && state.thresholdTrials < 7) return 0.60; // 40% faster / ~67% slower
  if (reversals < 2) return 0.72;                               // 28% / ~39%
  if (reversals < 4) return 0.82;                               // 18% / ~22%
  if (reversals < 6) return 0.90;                               // 10% / ~11%
  if (reversals < 8) return 0.95;                               // 5% / ~5%
  return 0.975;                                                  // 2.5% final adjustment
}
function thresholdEstimate() {
  const values = state.thresholdReversals.slice(-6).map((x) => x.ms).filter((x) => x > 0);
  const fallback = state.thresholdTrialSpeeds.slice(-8).filter((x) => x > 0);
  const sample = values.length >= 4 ? values : fallback;
  if (!sample.length) return null;
  const logMean = sample.reduce((sum, value) => sum + Math.log(value), 0) / sample.length;
  return Math.round(Math.exp(logMean));
}
function updateThresholdAfterOutcome(correct) {
  if (!isThresholdTest()) return { changed: false, finished: false };
  const before = state.thresholdSpeedMs;
  state.thresholdTrials += 1;
  state.thresholdTrialSpeeds.push(before);
  let direction = null;
  const factor = thresholdStepFactor();
  if (correct) {
    state.thresholdCorrectRun += 1;
    if (state.thresholdCorrectRun >= 3) {
      direction = "faster";
      state.thresholdCorrectRun = 0;
      state.thresholdSpeedMs = Math.max(MIN_SIGN_MS, before * factor);
    }
  } else {
    direction = "slower";
    state.thresholdCorrectRun = 0;
    state.thresholdSpeedMs = Math.min(4000, before / factor);
  }
  if (direction) {
    if (state.thresholdDirection && direction !== state.thresholdDirection) {
      state.thresholdReversals.push({ ms: Math.round(before), trial: state.thresholdTrials });
    }
    state.thresholdDirection = direction;
  }
  state.thresholdEstimateMs = thresholdEstimate();
  const finished = (state.thresholdReversals.length >= 8 && state.thresholdTrials >= 20) || state.thresholdTrials >= 30;
  if (finished) state.thresholdAutoFinish = true;
  return { changed: direction !== null, direction, before: Math.round(before), after: Math.round(state.thresholdSpeedMs), finished };
}

function adaptAfterOutcome({ correct, firstTry }) {
  if (state.speedMode !== "adaptive") return null;
  const before = state.adaptiveLevel;
  if (!correct) {
    state.adaptiveLevel = Math.max(1, state.adaptiveLevel - 1);
    state.adaptiveSuccesses = 0;
  } else if (firstTry) {
    state.adaptiveSuccesses += 1;
    if (state.adaptiveSuccesses >= 3) {
      state.adaptiveLevel = Math.min(SPEED_LEVELS.length, state.adaptiveLevel + 1);
      state.adaptiveSuccesses = 0;
    }
  } else {
    state.adaptiveSuccesses = 0;
  }
  state.bestLevel = Math.max(state.bestLevel, state.adaptiveLevel);
  if (state.adaptiveLevel > before) return "schneller";
  if (state.adaptiveLevel < before) return "langsamer";
  return null;
}

function recordOutcome({ guess, correct, points, elapsed, skipped = false, speedMs = null, analyzeProblems = true, attempts = 1, hadMistake = false, firstTryCorrect = null, solvedBySolution = false }) {
  const db = getDb();
  const player = ensurePlayer(db, state.player);
  if (analyzeProblems) updateProblemStats(player, state.currentItem, guess || "");
  player.totalWords += 1;
  player.totalCorrect += correct ? 1 : 0;
  player.totalReplays += state.replaysThisWord;
  player.bestStreak = Math.max(player.bestStreak || 0, state.streak);
  if (state.mode === "training") {
    player.trainingWords += 1;
    if (state.speedMode === "adaptive") player.trainingAdaptiveLevel = state.adaptiveLevel;
  }
  if (state.mode === "challenge") {
    player.challengePoints += points;
    player.bestChallengeWord = Math.max(player.bestChallengeWord || 0, points);
    const wk = weekKey();
    if (player.weekKey !== wk) { player.weekKey = wk; player.weekPoints = 0; }
    player.weekPoints = (player.weekPoints || 0) + points;
  }
  const event = {
    clientId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    playerKey: playerKey(state.player), player: state.player, at: nowIso(), date: localDateKey(), week: weekKey(), mode: state.mode,
    category: state.category, itemCategory: state.currentItemCategory, subcategory: state.currentItemSubcategory, speedMode: state.speedMode, challengeType: state.challengeType, level: currentLevel(), speedMs: speedMs ?? currentSpeed(), item: state.currentItem, correct, skipped,
    replays: state.replaysThisWord, attempts: Math.max(1, Number(attempts) || 1), hadMistake: Boolean(hadMistake), firstTryCorrect: firstTryCorrect == null ? Boolean(correct && state.replaysThisWord === 0) : Boolean(firstTryCorrect), solvedBySolution: Boolean(solvedBySolution),
    points, elapsed: Number(elapsed.toFixed(2))
  };
  db.events.push(event);
  saveDb(db);
  queueCloud(() => window.DaktiloCloud.syncOutcome(player, event));
}

function recordPracticeAttempt(guess) {
  const db = getDb();
  const player = ensurePlayer(db, state.player);
  updateProblemStats(player, state.currentItem, guess || "");
  saveDb(db);
  queueCloud(() => window.DaktiloCloud.syncPlayer(player));
}

function updateStats() {
  $("statPlayer").textContent = state.player || "—";
  if (isThresholdTest()) {
    $("scoreLabel").textContent = "Richtungswechsel";
    $("statScore").textContent = `${state.thresholdReversals.length}/8`;
  } else {
    $("scoreLabel").textContent = state.mode === "challenge" ? "Challenge-Punkte" : "Trainings-XP";
    $("statScore").textContent = state.sessionScore.toLocaleString("de-DE");
  }
  $("statStreak").textContent = state.streak;
  $("statWords").textContent = state.wordsAnswered;
  $("statSpeed").textContent = speedLabel();
  $("statAccuracy").textContent = state.wordsAnswered ? `${accuracy(state.correct, state.wordsAnswered)} %` : "—";
  $("replayCount").textContent = state.replaysThisWord;
  $("modePill").textContent = isThresholdTest() ? "Challenge · 80%-Test" : (state.mode === "challenge" ? "Challenge" : "Training");
  {
    if (state.category === "mixed") {
      const itemLabel = CATEGORY_INFO[state.currentItemCategory]?.label || "Gemischt";
      $("categoryPill").textContent = `Alle Kategorien · ${itemLabel}`;
    } else {
      const baseLabel = CATEGORY_INFO[state.category].label;
      if (["easy", "hard", "technical", "english", "names", "sentences"].includes(state.category) && state.subcategory !== "all") {
        const subLabel = categoryObject(state.category).subcategories?.[state.subcategory]?.label || "";
        $("categoryPill").textContent = subLabel ? `${baseLabel} · ${subLabel}` : baseLabel;
      } else {
        $("categoryPill").textContent = baseLabel;
      }
    }
  }
  if (isThresholdTest()) {
    const estimate = state.thresholdEstimateMs ? ` · Schätzung ${state.thresholdEstimateMs} ms` : "";
    $("adaptivePill").textContent = `80%-Test · ${state.thresholdTrials}/30 Wörter${estimate}`;
    $("adaptivePill").classList.add("threshold-live");
  } else {
    $("adaptivePill").textContent = state.speedMode === "adaptive" ? `Adaptiv · ${state.adaptiveSuccesses}/3 bis schneller` : "";
    $("adaptivePill").classList.remove("threshold-live");
  }
}

function showFeedback(type, html) {
  feedback.className = `feedback ${type} locked`;
  feedback.innerHTML = html;
}

function scheduleNext(delay = 1150) {
  clearTimeout(state.pendingTimer);
  state.pendingTimer = setTimeout(prepareNextItem, delay);
}

function prepareNextItem() {
  if (!state.active) return;
  state.currentItem = nextItem();
  state.replaysThisWord = 0;
  state.trainingHadMistake = false;
  state.trainingAttempts = 0;
  state.trainingAdaptivePenalized = false;
  state.sequenceFinished = false;
  answerInput.value = "";
  progressBar.style.transform = "scaleX(0)";
  feedback.className = "feedback hidden";
  feedback.innerHTML = "";
  hideVisual();
  updateStats();
  setControls();
  state.pendingTimer = setTimeout(() => playSequence(), 250);
}

function handleAnswer(event) {
  event.preventDefault();
  if (!state.active || state.sequenceRunning || !state.sequenceFinished || feedback.classList.contains("locked")) return;
  const guess = normalizeAnswer(answerInput.value);
  if (!guess) return;
  const expected = normalizeAnswer(state.currentItem);
  const elapsed = (performance.now() - state.wordStartTime) / 1000;
  const correct = guess === expected;
  const trialSpeed = currentSpeed();

  if (isThresholdTest()) {
    state.wordsAnswered += 1;
    state.answerTimes.push(elapsed);
    if (correct) { state.streak += 1; state.correct += 1; } else { state.streak = 0; }
    const testChange = updateThresholdAfterOutcome(correct);
    recordOutcome({ guess, correct, points: 0, elapsed, speedMs: trialSpeed, firstTryCorrect: correct });
    const directionText = testChange.direction === "faster" ? ` · schneller: ${testChange.after} ms` : (testChange.direction === "slower" ? ` · langsamer: ${testChange.after} ms` : "");
    if (correct) showFeedback("correct", `<strong>Richtig.</strong> ${escapeHtml(state.currentItem)}${directionText}`);
    else showFeedback("incorrect", `<strong>Nicht ganz.</strong> Richtig war <strong>${escapeHtml(state.currentItem)}</strong>${directionText}`);
    state.lastOutcomeAt = Date.now();
    updateStats();
    setControls();
    if (testChange.finished) {
      showFeedback(correct ? "correct" : "neutral", `${feedback.innerHTML}<br><strong>Test abgeschlossen.</strong> Geschätztes 80%-Tempo: ${thresholdEstimate()} ms pro Zeichen.`);
      scheduleNextThresholdFinish(1500);
    } else {
      scheduleNext(1050);
    }
    return;
  }

  // Im Training bleibt ein falsches Wort aktiv. Die Lösung wird nicht automatisch verraten.
  if (state.mode === "training" && !correct) {
    state.trainingAttempts += 1;
    state.trainingHadMistake = true;
    state.streak = 0;
    recordPracticeAttempt(guess);
    let adaptText = "";
    if (!state.trainingAdaptivePenalized) {
      const adaptiveChange = adaptAfterOutcome({ correct: false, firstTry: false });
      state.trainingAdaptivePenalized = true;
      adaptText = adaptiveChange ? ` · nächstes Tempo ${adaptiveChange}: ${speedLabel()}` : "";
    }
    answerInput.value = "";
    feedback.className = "feedback incorrect";
    feedback.innerHTML = `<strong>Noch nicht.</strong> Versuch es noch einmal oder sieh dir das Wort mit „Wiederholen“ erneut an. Die Lösung erscheint nur, wenn du „Lösung anzeigen“ wählst.${adaptText}`;
    state.bestLevel = Math.max(state.bestLevel, currentLevel());
    state.lastOutcomeAt = Date.now();
    updateStats();
    setControls();
    return;
  }

  state.wordsAnswered += 1;
  state.answerTimes.push(elapsed);

  if (correct) {
    const hadMistake = state.mode === "training" && state.trainingHadMistake;
    if (state.mode === "training") state.trainingAttempts += 1;
    state.streak = hadMistake ? 0 : state.streak + 1;
    state.correct += 1;

    let points = pointsForCorrect();
    let adaptiveChange = null;
    if (state.mode === "training" && hadMistake) {
      points = Math.max(25, Math.round(points * 0.5));
    } else {
      adaptiveChange = adaptAfterOutcome({ correct: true, firstTry: state.replaysThisWord === 0 });
    }
    state.sessionScore += points;
    recordOutcome({
      guess,
      correct: true,
      points,
      elapsed,
      attempts: state.mode === "training" ? Math.max(1, state.trainingAttempts) : 1,
      hadMistake,
      firstTryCorrect: !hadMistake && state.replaysThisWord === 0
    });
    const label = state.mode === "challenge" ? "Punkte" : "XP";
    const adaptText = adaptiveChange ? ` · jetzt ${adaptiveChange}: ${speedLabel()}` : "";
    const prefix = hadMistake ? "<strong>Jetzt richtig.</strong>" : "<strong>Richtig.</strong>";
    const practiceText = hadMistake ? " · der Fehlversuch bleibt in deiner Fehleranalyse gespeichert" : "";
    showFeedback("correct", `${prefix} ${escapeHtml(state.currentItem)} · +${points.toLocaleString("de-DE")} ${label}${practiceText}${adaptText}`);
  } else {
    // Challenge bleibt streng: ein falscher Versuch beendet dieses Wort.
    state.streak = 0;
    const adaptiveChange = adaptAfterOutcome({ correct: false, firstTry: state.replaysThisWord === 0 });
    recordOutcome({ guess, correct: false, points: 0, elapsed, firstTryCorrect: false });
    const adaptText = adaptiveChange ? ` · jetzt ${adaptiveChange}: ${speedLabel()}` : "";
    showFeedback("incorrect", `<strong>Nicht ganz.</strong> Richtig war <strong>${escapeHtml(state.currentItem)}</strong>${adaptText}`);
  }

  state.bestLevel = Math.max(state.bestLevel, currentLevel());
  state.lastOutcomeAt = Date.now();
  updateStats();
  setControls();
  scheduleNext(1250);
}

function revealTrainingSolution() {
  if (!state.active || state.mode !== "training" || !state.trainingHadMistake || state.sequenceRunning || !state.sequenceFinished || feedback.classList.contains("locked")) return;
  clearTimeout(state.pendingTimer);
  const elapsed = state.wordStartTime ? (performance.now() - state.wordStartTime) / 1000 : 0;
  state.wordsAnswered += 1;
  state.answerTimes.push(elapsed);
  state.streak = 0;
  recordOutcome({
    guess: "",
    correct: false,
    points: 0,
    elapsed,
    analyzeProblems: false,
    attempts: Math.max(1, state.trainingAttempts),
    hadMistake: true,
    firstTryCorrect: false,
    solvedBySolution: true
  });
  showFeedback("incorrect", `<strong>Lösung:</strong> ${escapeHtml(state.currentItem)}. Nimm dir kurz Zeit zum Einprägen.`);
  state.lastOutcomeAt = Date.now();
  updateStats();
  setControls();
  scheduleNext(2200);
}

function scheduleNextThresholdFinish(delay = 1200) {
  clearTimeout(state.pendingTimer);
  state.pendingTimer = setTimeout(finishSession, delay);
}

function skipCurrent() {
  if (!state.active || feedback.classList.contains("locked")) return;
  if (isThresholdTest()) {
    clearTimeout(state.pendingTimer);
    state.sequenceToken += 1;
    state.sequenceRunning = false;
    state.sequenceFinished = false;
    state.streak = 0;
    state.wordsAnswered += 1;
    const elapsed = state.wordStartTime ? (performance.now() - state.wordStartTime) / 1000 : 0;
    const testChange = updateThresholdAfterOutcome(false);
    recordOutcome({ guess: "", correct: false, points: 0, elapsed, skipped: true, analyzeProblems: false, firstTryCorrect: false });
    showFeedback("incorrect", `<strong>Übersprungen.</strong> Richtig war <strong>${escapeHtml(state.currentItem)}</strong>${testChange.direction ? ` · langsamer: ${testChange.after} ms` : ""}`);
    updateStats(); setControls();
    if (testChange.finished) scheduleNextThresholdFinish(1300); else scheduleNext(950);
    return;
  }

  clearTimeout(state.pendingTimer);
  state.sequenceToken += 1;
  state.sequenceRunning = false;
  state.sequenceFinished = false;
  state.streak = 0;
  state.wordsAnswered += 1;
  const elapsed = state.wordStartTime ? (performance.now() - state.wordStartTime) / 1000 : 0;

  if (state.mode === "training" && !state.trainingAdaptivePenalized) {
    adaptAfterOutcome({ correct: false, firstTry: false });
    state.trainingAdaptivePenalized = true;
  }
  recordOutcome({
    guess: "",
    correct: false,
    points: 0,
    elapsed,
    skipped: true,
    analyzeProblems: false,
    attempts: Math.max(1, state.trainingAttempts),
    hadMistake: state.trainingHadMistake,
    firstTryCorrect: false
  });
  showFeedback("incorrect", `<strong>Übersprungen.</strong> Richtig war <strong>${escapeHtml(state.currentItem)}</strong>.`);
  updateStats();
  setControls();
  scheduleNext(1200);
}

function startSession() {
  state.mode = document.querySelector('input[name="mode"]:checked').value;
  state.challengeType = state.mode === "challenge" ? ($("challengeTypeSelect")?.value || "points") : "points";
  state.category = $("categorySelect").value;
  state.subcategory = state.category === "mixed" ? "all" : ($("subcategorySelect")?.value || "all");
  state.currentItemCategory = state.category === "mixed" ? "easy" : state.category;
  state.currentItemSubcategory = state.subcategory;
  state.nonsenseLength = $("nonsenseLengthSelect")?.value || "random";
  state.inputMode = $("inputModeSelect").value;
  const speedValue = $("speedSelect").value;
  state.speedMode = isThresholdTest() ? "threshold" : (speedValue === "adaptive" ? "adaptive" : "fixed");
  state.fixedLevel = speedValue === "adaptive" ? 4 : Number(speedValue);
  const savedProfile = getDb().players[playerKey(state.player)];
  state.adaptiveLevel = state.speedMode === "adaptive" ? Math.min(SPEED_LEVELS.length, Math.max(1, (Number(savedProfile?.trainingAdaptiveLevel) || 4) - 3)) : 4;
  state.adaptiveSuccesses = 0;
  state.thresholdCorrectRun = 0;
  state.thresholdDirection = null;
  state.thresholdReversals = [];
  state.thresholdTrials = 0;
  state.thresholdTrialSpeeds = [];
  state.thresholdEstimateMs = null;
  state.thresholdAutoFinish = false;
  if (isThresholdTest()) {
    const dbForStart = getDb();
    const existing = dbForStart.players[playerKey(state.player)];
    const previous = Number(existing?.lastThresholdMs);
    state.thresholdSpeedMs = Number.isFinite(previous) && previous > 0 ? clamp(previous, MIN_SIGN_MS, 2000) : 800;
    state.inputMode = "live";
  }
  state.sessionScore = 0;
  state.streak = 0;
  state.wordsAnswered = 0;
  state.correct = 0;
  state.replaysThisWord = 0;
  state.trainingHadMistake = false;
  state.trainingAttempts = 0;
  state.trainingAdaptivePenalized = false;
  state.totalReplays = 0;
  state.answerTimes = [];
  state.sessionSeenItems = new Set();
  state.bestLevel = currentLevel();
  state.sequenceToken += 1;
  state.sequenceRunning = false;
  state.sequenceFinished = false;
  state.sessionStartedAt = Date.now();
  state.active = true;
  clearTimeout(state.pendingTimer);
  const db = getDb(); ensurePlayer(db, state.player); saveDb(db);
  setupCard.classList.add("hidden");
  resultsCard.classList.add("hidden");
  gameCard.classList.remove("hidden");
  updateStats();
  prepareNextItem();
}

function finishSession() {
  if (!state.active) return;
  state.active = false;
  clearTimeout(state.pendingTimer);
  state.sequenceToken += 1;
  state.sequenceRunning = false;
  const endedAt = Date.now();
  const durationMs = Math.max(0, endedAt - state.sessionStartedAt);
  const db = getDb();
  const player = ensurePlayer(db, state.player);
  player.trainingMs = (player.trainingMs || 0) + durationMs;
  const thresholdMs = isThresholdTest() ? thresholdEstimate() : null;
  if (isThresholdTest() && thresholdMs && state.wordsAnswered >= 10) {
    const result = { at: nowIso(), thresholdMs, words: state.wordsAnswered, correct: state.correct, category: state.category, subcategory: state.subcategory, inputMode: state.inputMode };
    player.thresholdTests ||= [];
    player.thresholdTests.push(result);
    player.thresholdTests = player.thresholdTests.slice(-50);
    player.lastThresholdMs = thresholdMs;
    player.bestThresholdMs = player.bestThresholdMs ? Math.min(player.bestThresholdMs, thresholdMs) : thresholdMs;
  }
  db.sessions.push({ playerKey: playerKey(state.player), player: state.player, at: nowIso(), week: weekKey(), mode: state.mode, challengeType: state.challengeType, category: state.category, score: state.sessionScore, thresholdMs, words: state.wordsAnswered, correct: state.correct, replays: state.totalReplays, durationMs, bestLevel: state.bestLevel });
  saveDb(db);
  queueCloud(() => window.DaktiloCloud.syncPlayer(player));

  gameCard.classList.add("hidden");
  resultsCard.classList.remove("hidden");
  const avg = state.answerTimes.length ? state.answerTimes.reduce((a, b) => a + b, 0) / state.answerTimes.length : 0;
  $("resultsHeadline").textContent = `${state.player}, Session gespeichert.`;
  if (isThresholdTest()) {
    $("resultScoreLabel").textContent = "80%-Tempo";
    $("resultScore").textContent = thresholdEstimate() ? `${thresholdEstimate()} ms` : "—";
  } else {
    $("resultScoreLabel").textContent = state.mode === "challenge" ? "Challenge-Punkte" : "Trainings-XP";
    $("resultScore").textContent = state.sessionScore.toLocaleString("de-DE");
  }
  $("resultAccuracy").textContent = state.wordsAnswered ? `${accuracy(state.correct, state.wordsAnswered)} %` : "—";
  $("resultWords").textContent = state.wordsAnswered;
  $("resultReplays").textContent = state.totalReplays;
  $("resultTime").textContent = `${avg.toFixed(1).replace(".", ",")} s`;
  $("resultSpeed").textContent = isThresholdTest() ? `${currentSpeed()} ms aktuell` : speedLabel(state.bestLevel);
}

function aggregatePlayers() {
  const db = getDb();
  return Object.entries(db.players).map(([key, p]) => ({ key, ...p }));
}

function populateAccuracyLeaderboardFilters() {
  const categorySelect = $("accuracyCategorySelect");
  const speedSelect = $("accuracySpeedSelect");
  if (!categorySelect || !speedSelect) return;

  const categories = ["easy", "hard", "technical", "english", "names", "nonsense", "sentences"];
  categorySelect.innerHTML = categories.map((key) => `<option value="${key}">${escapeHtml(CATEGORY_INFO[key].label)}</option>`).join("");
  speedSelect.innerHTML = SPEED_LEVELS.map((s) => `<option value="${s.ms}">Level ${s.level} · ${s.ms} ms</option>`).join("");

  if (!categorySelect.value) categorySelect.value = "easy";
  const preferredSpeed = state.speedMode === "fixed" ? currentSpeed() : 1000;
  speedSelect.value = String(SPEED_LEVELS.some((s) => s.ms === preferredSpeed) ? preferredSpeed : 1000);
}

function accuracyLeaderboardOptions() {
  return {
    category: $("accuracyCategorySelect")?.value || "easy",
    speedMs: Number($("accuracySpeedSelect")?.value || 1000),
    minAttempts: 20,
    limit: 15
  };
}

async function renderLeaderboard(board = "total") {
  const host = $("leaderboardList");
  const filters = $("accuracyLeaderboardFilters");
  filters?.classList.toggle("hidden", board !== "accuracy");
  const accuracyOptions = accuracyLeaderboardOptions();

  if (cloudConfigured()) {
    host.innerHTML = '<div class="empty-state">Bestenliste wird geladen …</div>';
    try {
      const rows = await window.DaktiloCloud.fetchLeaderboard(board, accuracyOptions);
      if (!rows?.length) {
        const message = board === "accuracy"
          ? "Noch keine Platzierung für diese Kombination. Für die Trefferquote sind mindestens 20 Challenge-Wörter nötig."
          : `Noch keine passenden Online-Ergebnisse. ${board === "total" || board === "week" || board === "best" ? "Spiele eine passende Challenge." : "Starte ein Training."}`;
        host.innerHTML = `<div class="empty-state">${message}</div>`;
        return;
      }
      host.innerHTML = rows.map((r, i) => `<div class="leader-row"><div class="leader-rank">#${i + 1}</div><div><strong>${escapeHtml(r.name)}</strong><div class="leader-meta">${escapeHtml(r.meta)}</div></div><div class="leader-score">${Number(r.value).toLocaleString("de-DE", { maximumFractionDigits: board === "accuracy" ? 1 : 0 })}${r.suffix || ""}</div></div>`).join("");
      return;
    } catch (err) {
      console.warn("Online-Bestenliste:", err);
      host.innerHTML = '<div class="empty-state">Online-Bestenliste konnte nicht geladen werden. Lokale Daten werden angezeigt.</div>';
    }
  }

  const db = getDb();
  const players = aggregatePlayers();
  const currentWeek = weekKey();
  const weekly = {};
  db.events.filter((e) => e.mode === "challenge" && e.week === currentWeek).forEach((e) => { weekly[e.playerKey] = (weekly[e.playerKey] || 0) + e.points; });
  let rows = [];

  if (board === "accuracy") {
    const { category, speedMs, minAttempts, limit } = accuracyOptions;
    const map = new Map();
    db.events
      .filter((e) => e.mode === "challenge" && e.challengeType === "points" && (e.itemCategory || e.category) === category && Number(e.speedMs) === speedMs)
      .forEach((e) => {
        const key = e.playerKey || playerKey(e.player || "");
        const row = map.get(key) || { name: e.player || db.players[key]?.name || "—", total: 0, correct: 0 };
        row.total += 1;
        const firstTryCorrect = e.firstTryCorrect == null ? Boolean(e.correct && Number(e.replays || 0) === 0 && !e.skipped) : Boolean(e.firstTryCorrect);
        row.correct += firstTryCorrect ? 1 : 0;
        map.set(key, row);
      });
    rows = [...map.values()]
      .filter((r) => r.total >= minAttempts)
      .map((r) => ({ name: r.name, value: Math.round((r.correct / r.total) * 1000) / 10, meta: `${r.correct}/${r.total} Ersttreffer · mindestens ${minAttempts} Wörter`, suffix: " %", total: r.total }))
      .sort((a, b) => b.value - a.value || b.total - a.total || a.name.localeCompare(b.name, "de"))
      .slice(0, limit);
  }

  if (board === "total") rows = players.map((p) => ({ name: p.name, value: p.challengePoints || 0, meta: `${p.totalWords || 0} Wörter · ${accuracy(p.totalCorrect || 0, p.totalWords || 0)} % korrekt` }));
  if (board === "training") rows = players.map((p) => ({ name: p.name, value: p.trainingWords || 0, meta: `${Math.round((p.trainingMs || 0) / 60000)} min gespeichert · ${p.totalReplays || 0} Replays`, suffix: " Wörter" }));
  if (board === "week") rows = players.map((p) => ({ name: p.name, value: weekly[p.key] || 0, meta: `Woche ab ${new Date(startOfWeek()).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}` }));
  if (board === "best") rows = players.map((p) => ({ name: p.name, value: p.bestChallengeWord || 0, meta: `Längste Serie: ${p.bestStreak || 0}` }));
  if (board === "threshold") rows = players.map((p) => ({ name: p.name, value: p.bestThresholdMs || 0, meta: `${(p.thresholdTests || []).length} abgeschlossene Tests`, suffix: " ms", lowerIsBetter: true }));

  if (board !== "accuracy") {
    rows = rows.filter((r) => r.value > 0).sort((a, b) => board === "threshold" ? a.value - b.value : b.value - a.value).slice(0, 20);
  }

  if (!rows.length) {
    const message = board === "accuracy"
      ? "Noch keine Platzierung für diese Kombination. Für die Trefferquote sind mindestens 20 Challenge-Wörter nötig."
      : `Noch keine passenden Ergebnisse. ${board === "total" || board === "week" || board === "best" ? "Spiele eine passende Challenge." : "Starte ein Training."}`;
    host.innerHTML = `<div class="empty-state">${message}</div>`;
    return;
  }

  host.innerHTML = rows.map((r, i) => `<div class="leader-row"><div class="leader-rank">#${i + 1}</div><div><strong>${escapeHtml(r.name)}</strong><div class="leader-meta">${escapeHtml(r.meta)}</div></div><div class="leader-score">${Number(r.value).toLocaleString("de-DE", { maximumFractionDigits: board === "accuracy" ? 1 : 0 })}${r.suffix || ""}</div></div>`).join("");
}

function openLeaderboard(board = "total") {
  document.querySelectorAll("#leaderboardTabs button").forEach((b) => b.classList.toggle("active", b.dataset.board === board));
  renderLeaderboard(board);
  leaderboardDialog.showModal();
}

function playerWeakRows(player) {
  const letterRows = Object.entries(player.letters || {}).filter(([, s]) => s.seen >= 3).map(([symbol, s]) => ({ symbol, seen: s.seen, errors: s.errors, type: "Buchstabe" }));
  const comboRows = Object.entries(player.combos || {}).filter(([, s]) => s.seen >= 4 && s.errors > 0).map(([symbol, s]) => ({ symbol, seen: s.seen, errors: s.errors, type: "Kombi" }));
  return [...letterRows, ...comboRows].map((x) => ({ ...x, rate: x.seen ? 1 - x.errors / x.seen : 1 })).sort((a, b) => a.rate - b.rate || b.seen - a.seen).slice(0, 10);
}

function hardestWordRows(playerKeyValue) {
  const db = getDb();
  const events = db.events.filter((e) => e.playerKey === playerKeyValue && e.item && !e.skipped);
  const map = new Map();
  events.forEach((e) => {
    const key = normalizeAnswer(e.item);
    if (!key) return;
    const row = map.get(key) || { item: e.item, seen: 0, errors: 0, replays: 0, elapsed: 0, signs: Math.max(1, tokenizeSigns(e.item).length) };
    row.seen += 1; row.errors += (e.correct && !e.hadMistake) ? 0 : 1; row.replays += e.replays || 0; row.elapsed += Number(e.elapsed) || 0;
    map.set(key, row);
  });
  const all = [...map.values()];
  const stableExists = all.some((x) => x.seen >= 2);
  return all.filter((x) => stableExists ? x.seen >= 2 : x.seen >= 1).map((x) => {
    const errorRate = x.errors / x.seen;
    const replayRate = x.replays / x.seen;
    const avgSeconds = x.elapsed / x.seen;
    const secondsPerSign = avgSeconds / Math.max(1, x.signs);
    const score = errorRate * 70 + Math.min(1, replayRate) * 20 + Math.min(1, secondsPerSign / 2.5) * 10;
    return { ...x, errorRate, replayRate, avgSeconds, score };
  }).sort((a,b) => b.score - a.score || b.seen - a.seen).slice(0,10);
}

function renderConfusions(player) {
  const host = $("confusionList");
  const rows = Object.entries(player?.confusions || {}).sort((a,b) => b[1]-a[1]).slice(0,10);
  host.innerHTML = rows.length ? rows.map(([pair,count]) => {
    const [from,to] = pair.split("→");
    const omission = to === "∅";
    return `<div class="confusion-row"><div class="confusion-pair">${escapeHtml(from || "?")} → ${escapeHtml(to || "?")}</div><div class="confusion-meta">${omission ? "Zielzeichen wurde ausgelassen" : "Zielzeichen wurde als anderes Zeichen eingegeben"}</div><div class="confusion-count">${count}×</div></div>`;
  }).join("") : '<div class="empty-state">Noch keine stabilen Verwechslungsmuster erkannt.</div>';
}

function renderThresholdHistory(player) {
  const host = $("thresholdHistory");
  const tests = [...(player?.thresholdTests || [])].reverse().slice(0,8);
  host.innerHTML = tests.length ? tests.map((t) => {
    const date = new Date(t.at);
    const cat = CATEGORY_INFO[t.category]?.label || t.category || "Test";
    return `<div class="threshold-row"><strong>${date.toLocaleDateString("de-DE")}</strong><div class="threshold-meta">${escapeHtml(cat)} · ${t.words} Wörter · ${accuracy(t.correct,t.words)} % im Test</div><div class="threshold-value">${Math.round(t.thresholdMs)} ms</div></div>`;
  }).join("") : '<div class="empty-state">Noch kein adaptiver 80%-Test abgeschlossen.</div>';
}

function renderStats(playerKeyValue) {
  const db = getDb();
  const player = db.players[playerKeyValue];
  if (!player) {
    $("profileSummary").innerHTML = '<div class="empty-state">Noch keine Daten.</div>';
    $("weakLettersList").innerHTML = "";
    $("hardestWordsList").innerHTML = "";
    $("confusionList").innerHTML = "";
    $("thresholdHistory").innerHTML = "";
    $("weeklyHistory").innerHTML = "";
    return;
  }
  $("profileSummary").innerHTML = [
    ["Wörter", player.totalWords || 0], ["Genauigkeit", `${accuracy(player.totalCorrect || 0, player.totalWords || 0)} %`],
    ["Challenge-Punkte", (player.challengePoints || 0).toLocaleString("de-DE")], ["Training", `${player.trainingWords || 0} Wörter`],
    ["Beste Serie", player.bestStreak || 0], ["Replays", player.totalReplays || 0],
    ["Bestes 80%-Tempo", player.bestThresholdMs ? `${Math.round(player.bestThresholdMs)} ms` : "—"]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");

  const weak = playerWeakRows(player);
  $("weakLettersList").innerHTML = weak.length ? weak.map((x) => `<div class="weak-row"><div class="weak-symbol">${escapeHtml(x.symbol)}</div><div><strong>${x.type}</strong><div class="weak-meta">${x.errors} Fehler bei ${x.seen} Vorkommen</div></div><div class="weak-rate">${Math.round(x.rate * 100)} %</div></div>`).join("") : '<div class="empty-state">Noch zu wenig Daten. Nach einigen Wörtern werden hier Muster sichtbar.</div>';

  const hardWords = hardestWordRows(playerKeyValue);
  $("hardestWordsList").innerHTML = hardWords.length ? hardWords.map((x) => `<div class="word-difficulty-row"><div class="word-name">${escapeHtml(x.item)}</div><div class="word-meta">${x.errors}/${x.seen} falsch · ${x.replays} Replays · Ø ${x.avgSeconds.toFixed(1).replace(".",",")} s</div><div class="word-score">${Math.round(x.score)} P</div></div>`).join("") : '<div class="empty-state">Noch nicht genug Wörter gespielt.</div>';
  renderConfusions(player);
  renderThresholdHistory(player);

  const weeks = [];
  const start = startOfWeek();
  for (let i = 5; i >= 0; i -= 1) { const d = new Date(start); d.setDate(d.getDate() - i * 7); weeks.push({ key: localDateKey(d), date: d }); }
  const events = db.events.filter((e) => e.playerKey === playerKeyValue);
  const data = weeks.map((w) => {
    const es = events.filter((e) => e.week === w.key);
    return { ...w, words: es.length, correct: es.filter((e) => e.correct).length, avgLevel: es.length ? es.reduce((s, e) => s + (e.level || 0), 0) / es.length : 0 };
  });
  const maxWords = Math.max(1, ...data.map((x) => x.words));
  $("weeklyHistory").innerHTML = data.map((x) => `<div class="week-row"><div>${x.date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}</div><div class="week-bar"><div style="width:${Math.round((x.words / maxWords) * 100)}%"></div></div><div class="week-value">${x.words} · ${x.words ? accuracy(x.correct, x.words) + "%" : "—"}</div></div>`).join("");
}

function openStats() {
  const db = getDb();
  const select = $("statsPlayerSelect");

  if (cloudConfigured()) {
    const key = playerKey(state.player);
    const player = db.players[key];
    if (!state.player || !player) {
      select.innerHTML = '<option value="">Bitte zuerst anmelden</option>';
      renderStats("");
    } else {
      select.innerHTML = `<option value="${escapeHtml(key)}">${escapeHtml(player.name)}</option>`;
      select.value = key;
      renderStats(key);
    }
    select.disabled = true;
    statsDialog.showModal();
    return;
  }

  select.disabled = false;
  const players = Object.entries(db.players).sort((a, b) => a[1].name.localeCompare(b[1].name, "de"));
  if (!players.length) {
    select.innerHTML = '<option value="">Noch keine Spieler</option>';
    renderStats("");
  } else {
    select.innerHTML = players.map(([key, p]) => `<option value="${escapeHtml(key)}">${escapeHtml(p.name)}</option>`).join("");
    const preferred = db.players[playerKey(state.player)] ? playerKey(state.player) : players[0][0];
    select.value = preferred;
    renderStats(preferred);
  }
  statsDialog.showModal();
}

function freshPlayerProgress(name, existing = {}) {
  const clean = canonicalPlayer(name);
  const fresh = {
    name: clean, challengePoints: 0, trainingWords: 0, totalWords: 0, totalCorrect: 0,
    totalReplays: 0, trainingMs: 0, bestChallengeWord: 0, bestStreak: 0,
    letters: {}, confusions: {}, combos: {}, thresholdTests: [], bestThresholdMs: null,
    lastThresholdMs: null, trainingAdaptiveLevel: 4, weekKey: weekKey(), weekPoints: 0,
    createdAt: existing.createdAt || nowIso(), lastPlayedAt: nowIso()
  };
  if (existing.auth) fresh.auth = existing.auth;
  return fresh;
}

async function resetCurrentScores() {
  const targetName = state.player || $("playerName")?.value;
  if (!targetName) return;
  if (!confirm("Wirklich alle Spielstände und Lernstatistiken für dieses Konto löschen? Benutzername und Passwort bleiben erhalten.")) return;
  try {
    if (cloudConfigured()) await window.DaktiloCloud.resetProgress();
    const db = getDb();
    const key = playerKey(targetName);
    const existing = db.players[key] || {};
    db.players[key] = freshPlayerProgress(targetName, existing);
    db.events = db.events.filter((e) => e.playerKey !== key);
    db.sessions = db.sessions.filter((session) => session.playerKey !== key);
    saveDb(db);
    state.adaptiveLevel = 4;
    state.adaptiveSuccesses = 0;
    state.sessionScore = 0;
    state.streak = 0;
    state.wordsAnswered = 0;
    state.correct = 0;
    state.totalReplays = 0;
    if ($("statsDialog")?.open) renderStats(key);
    alert("Spielstände und Lernstatistik wurden gelöscht.");
  } catch (err) {
    alert(err?.message || "Die Spielstände konnten nicht vollständig gelöscht werden.");
  }
}

function resetToSetup() {
  clearTimeout(state.pendingTimer);
  state.active = false;
  state.sequenceToken += 1;
  gameCard.classList.add("hidden");
  resultsCard.classList.add("hidden");
  setupCard.classList.remove("hidden");
  $("playerName").value = state.player;
  if ($("playerPassword")) $("playerPassword").value = "";
  populateSubcategories();
  updateSetupConstraints();
}

initZoomControl();
populateNonsenseLengths();
populateSpeeds();
populateAccuracyLeaderboardFilters();
populateSubcategories();
updateSetupConstraints();
updateNonsenseLengthVisibility();
preloadSignImages();
updateCloudStatus();

setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = canonicalPlayer($("playerName").value);
  const password = $("playerPassword")?.value || "";
  const error = $("authError");
  if (error) { error.textContent = ""; error.classList.add("hidden"); }
  if (!name) return;
  if (password.length < 8) {
    if (error) { error.textContent = "Bitte mindestens 8 Zeichen als Passwort verwenden."; error.classList.remove("hidden"); }
    return;
  }
  try {
    if (cloudConfigured()) {
      const existingLocal = getDb().players[playerKey(name)];
      const result = await window.DaktiloCloud.loginOrRegister(name, password);
      if (!result.ok) {
        if (error) { error.textContent = result.reason || "Anmeldung fehlgeschlagen."; error.classList.remove("hidden"); }
        return;
      }
      const actualName = result.username || name;
      // On a brand-new online account, existing local learning data can be migrated once.
      const migrateLocal = result.created && Boolean(existingLocal?.totalWords);
      hydrateFromCloud(actualName, result.state, { preferLocal: migrateLocal });
      state.player = actualName;
      $("playerName").value = actualName;
      $("logoutButton")?.classList.remove("hidden");
      if (migrateLocal) {
        const db = getDb();
        const localPlayer = db.players[playerKey(actualName)];
        if (localPlayer) {
          queueCloud(() => window.DaktiloCloud.syncPlayer(localPlayer));
          const localEvents = db.events.filter((e) => e.playerKey === playerKey(actualName));
          if (localEvents.length) queueCloud(() => window.DaktiloCloud.syncEventBatch(localEvents));
        }
      }
      startSession();
      return;
    }

    // Local fallback while Supabase is not configured.
    const result = await unlockOrCreateLocalProfile(name, password);
    if (!result.ok) {
      if (error) { error.textContent = result.reason; error.classList.remove("hidden"); }
      return;
    }
    state.player = name;
    startSession();
  } catch (err) {
    if (error) { error.textContent = err?.message || "Anmeldung konnte nicht abgeschlossen werden."; error.classList.remove("hidden"); }
  }
});
document.querySelectorAll('input[name="mode"]').forEach((el) => el.addEventListener("change", updateSetupConstraints));
$("challengeTypeSelect")?.addEventListener("change", updateSetupConstraints);
$("categorySelect").addEventListener("change", () => {
  populateSubcategories();
  updateSetupConstraints();
  updateNonsenseLengthVisibility();
});
$("speedSelect").addEventListener("change", updateSetupConstraints);
answerForm.addEventListener("submit", handleAnswer);
replayButton.addEventListener("click", () => playSequence({ replay: true }));
solutionButton?.addEventListener("click", revealTrainingSolution);
$("skipButton").addEventListener("click", skipCurrent);
$("stopButton").addEventListener("click", finishSession);
$("playAgain").addEventListener("click", resetToSetup);
$("openLeaderboard").addEventListener("click", () => openLeaderboard("total"));
$("resultsLeaderboard").addEventListener("click", () => openLeaderboard("total"));
$("openStats").addEventListener("click", openStats);
$("openImprint").addEventListener("click", () => imprintDialog.showModal());
$("openPrivacy")?.addEventListener("click", () => privacyDialog.showModal());
$("logoutButton")?.addEventListener("click", async () => {
  await window.DaktiloCloud?.logout?.().catch(() => {});
  state.player = "";
  state.active = false;
  $("playerName").value = "";
  $("playerPassword").value = "";
  $("logoutButton").classList.add("hidden");
  gameCard.classList.add("hidden");
  resultsCard.classList.add("hidden");
  setupCard.classList.remove("hidden");
});
$("leaderboardTabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-board]");
  if (!button) return;
  document.querySelectorAll("#leaderboardTabs button").forEach((b) => b.classList.toggle("active", b === button));
  renderLeaderboard(button.dataset.board);
});
$("accuracyCategorySelect")?.addEventListener("change", () => renderLeaderboard("accuracy"));
$("accuracySpeedSelect")?.addEventListener("change", () => renderLeaderboard("accuracy"));
$("statsPlayerSelect").addEventListener("change", (event) => renderStats(event.target.value));
$("resetScores")?.addEventListener("click", resetCurrentScores);
$("clearData").addEventListener("click", () => {
  if (!confirm("Lokalen Cache auf diesem Gerät löschen? Dein Online-Konto bleibt erhalten.")) return;
  localStorage.removeItem(STORAGE_KEY);
  renderLeaderboard(document.querySelector("#leaderboardTabs button.active")?.dataset.board || "total");
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => $(button.dataset.close).close()));
[leaderboardDialog, statsDialog, imprintDialog, privacyDialog].forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));

document.addEventListener("keydown", (event) => {
  if (!state.active || event.code !== "Space" || state.sequenceRunning || feedback.classList.contains("locked")) return;
  if (document.activeElement === answerInput && answerInput.value.length > 0) return;
  event.preventDefault();
  if (!replayButton.disabled) playSequence({ replay: true });
});
