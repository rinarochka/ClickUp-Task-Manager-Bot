import fs from 'fs';

const DB_FILE = './users.json';

let db = { users: {} };

// ====== LOAD / SAVE ======
export async function loadUserData() {
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) || { users: {} };
      if (!db.users) db.users = {};
    } catch {
      db = { users: {} };
    }
  } else {
    db = { users: {} };
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
}

export function saveUserData() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ====== INTERNAL ======
function ensureUser(id) {
  const uid = String(id);

  if (!db.users[uid]) {
    db.users[uid] = {
      apiToken: null,
      clickupUserId: null,

      lastTeamId: null,
      lastSpaceId: null,
      lastFolderId: null,
      lastListId: null,
      lastListName: null,

      lists: [],
      tasks: [],
      selectedTaskId: null,

      trackedStatuses: [],
      reminders: { daily: true, hourly: false },

      state: null
    };

    saveUserData();
  }

  // миграция на новые поля (если старые юзеры)
  db.users[uid].reminders ||= { daily: true, hourly: false };
  db.users[uid].trackedStatuses ||= [];
  db.users[uid].lists ||= [];
  db.users[uid].tasks ||= [];

  return db.users[uid];
}

// ====== PUBLIC API ======
export function getUserData(id) {
  return ensureUser(id);
}

export function updateUser(id, patch) {
  const user = ensureUser(id);
  Object.assign(user, patch);
  saveUserData();
  return user;
}

export function clearUserData(id) {
  const uid = String(id);
  delete db.users[uid];
  saveUserData();
}

export function resetUserToken(id) {
  return updateUser(id, {
    apiToken: null,
    clickupUserId: null,

    lastTeamId: null,
    lastSpaceId: null,
    lastFolderId: null,
    lastListId: null,
    lastListName: null,

    trackedStatuses: [],
    selectedTaskId: null,
    state: null
  });
}

// optional (если потом надо scheduler)
export function getAllUsers() {
  return Object.entries(db.users).map(([telegramId, u]) => ({
    telegramId,
    ...u
  }));
}