import fs from 'fs'

const DB_FILE = './users.json'

let db = { users: {} }

if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE))
}

function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

function ensureUser(id) {
  if (!db.users[id]) {
    db.users[id] = {
      token: null,
      clickupUserId: null,
      teamId: null,
      spaceId: null,
      folderId: null,
      listId: null,
      trackedStatuses: [],
      reminders: {
        daily: true,
        hourly: false
      },
      state: { step: 'idle' }
    }
    save()
  }
  return db.users[id]
}

export function getUserData(id) {
  return ensureUser(id)
}

export function updateUser(id, patch) {
  const user = ensureUser(id)
  Object.assign(user, patch)
  save()
  return user
}

export function resetUserToken(id) {
  return updateUser(id, {
    token: null,
    clickupUserId: null,
    teamId: null,
    spaceId: null,
    folderId: null,
    listId: null,
    trackedStatuses: [],
    state: { step: 'idle' }
  })
}

export function getAllUsers() {
  return Object.entries(db.users).map(([id, user]) => ({
    telegramId: id,
    ...user
  }))
}