import dotenv from 'dotenv';
dotenv.config();

import TelegramBot from 'node-telegram-bot-api';
import {
  loadUserData,
  getUserData,
  updateUser,
  clearUserData,
  resetUserToken
} from './userData.js';

import { parseTaskInput } from './taskParser.js';
import { getHelpMessage } from './helpContent.js';
import { startScheduler } from './scheduler.js';

import {
  fetchClickUp,
  getTeams,
  getSpaces,
  getFolders,
  getLists,
  getTasks,
  getListStatuses,
  getListsInSpace,
  getAuthorizedUser,
  getMyTasks
} from './clickupApi.js';

// Load Telegram Token from environment or constants
const TelegramToken = process.env.TELEGRAM_TOKEN || 'PASTE_YOUR_TOKEN';
const bot = new TelegramBot(TelegramToken, { polling: true });

(async function initializeBot() {
  await loadUserData();

  // ✅ запуск scheduler (daily/hourly)
  startScheduler(bot);

  bot.onText(/\/menu/, handleMenu);
  bot.onText(/\/help/, handleHelp);

  // ✅ hourly reminder toggle
  bot.onText(/\/reminder/, (msg) => {
    const uid = msg.from.id;
    const user = getUserData(uid);

    const next = !user.reminders?.hourly;

    updateUser(uid, {
      reminders: {
        ...user.reminders,
        hourly: next
      }
    });

    bot.sendMessage(msg.chat.id, `Hourly reminder ${next ? 'enabled' : 'disabled'}`);
  });

  bot.onText(/\/token_reset/, (msg) => {
    const uid = msg.from.id;
    resetUserToken(uid);
    bot.sendMessage(msg.chat.id, 'Token reset. Use /menu to set new token.');
  });

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(
      chatId,
      `👋 Welcome to ClickUp Task Manager Bot!

This bot allows you to:
• Connect your ClickUp account
• Browse Teams / Spaces / Lists
• Create tasks directly from Telegram

Use /menu to begin.`
    );

    handleMenu(msg);
  });

  bot.on('callback_query', handleCallbackQuery);
  bot.on('message', handleUserMessage);

  console.log('Bot is running...');
})();

/* =========================
   MENU (SMART)
========================= */
function handleMenu(msg) {
  const chatId = msg.chat.id;
  const uid = msg.from.id;
  const user = getUserData(uid);

  const hasToken = !!user.apiToken;
  const hasList = !!user.lastListId;

  const inline_keyboard = [];

  // Token row
  if (!hasToken) {
    inline_keyboard.push([{ text: 'Set ClickUp API Token 🛠️', callback_data: 'set_api_token' }]);
  } else {
    inline_keyboard.push([
      { text: 'Update Token 🛠️', callback_data: 'set_api_token' },
      { text: 'Reset Token ♻️', callback_data: 'token_reset_btn' }
    ]);
  }

  // Navigation
  inline_keyboard.push([{ text: 'Fetch Teams 📋', callback_data: 'fetch_teams' }]);

  // List actions only when list selected
  if (hasList) {
    inline_keyboard.push([
      { text: 'Show Tasks 📋', callback_data: 'show_tasks' },
      { text: 'My Tasks 👤', callback_data: 'my_tasks' }
    ]);
    inline_keyboard.push([
      { text: 'Filter by Status 🎯', callback_data: 'pick_status' },
      { text: 'Current List 📄', callback_data: 'current_list' }
    ]);
  } else {
    inline_keyboard.push([{ text: 'Current List 📄', callback_data: 'current_list' }]);
  }

  // Create
  inline_keyboard.push([{ text: 'Create Task ✏️', callback_data: 'create_task' }]);

  // Sync me
  if (hasToken) {
    inline_keyboard.push([{ text: 'Sync My ClickUp ID 👤', callback_data: 'get_me' }]);
  }

  // Other
  inline_keyboard.push([
    { text: 'Clear Data 🗑️', callback_data: 'clear_data' },
    { text: 'Help ❓', callback_data: 'help' }
  ]);

  bot.sendMessage(chatId, 'What do you want to do?', {
    reply_markup: { inline_keyboard }
  });
}

function handleHelp(msg) {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, getHelpMessage(), { parse_mode: 'Markdown' });
}

/* =========================
   CALLBACKS
========================= */
async function handleCallbackQuery(query) {
  if (!query?.id || !query?.message) return;

  const chatId = query.message.chat.id;
  const uid = query.from.id; // ✅ user id
  const user = getUserData(uid);
  const data = query.data;

  // ✅ always try answering callback; ignore expired
  try {
    await bot.answerCallbackQuery(query.id);
  } catch (e) {
    return;
  }

  try {
    // ===== TOKEN RESET BUTTON =====
    if (data === 'token_reset_btn') {
      resetUserToken(uid);
      await bot.sendMessage(chatId, 'Token reset. Use /menu to set new token.');
      return;
    }

    // ===== SELECT TASK =====
    if (data.startsWith('task_')) {
      const taskId = data.replace('task_', '');
      updateUser(uid, { selectedTaskId: taskId });

      await bot.sendMessage(chatId, 'Task options:', {
        reply_markup: {
          inline_keyboard: [[{ text: 'Change Status 🔄', callback_data: 'change_status' }]]
        }
      });
      return;
    }

    // ===== SET STATUS (for selected task) =====
    if (data.startsWith('set_status_')) {
      if (!user.selectedTaskId) {
        await bot.sendMessage(chatId, 'Please select a task first.');
        return;
      }

      const newStatus = data.replace('set_status_', '');

      await fetchClickUp(`task/${user.selectedTaskId}`, user.apiToken, 'PUT', { status: newStatus });

      await bot.sendMessage(chatId, `✅ Status updated to: ${newStatus}`);
      return;
    }

    // ===== STATUS PICKER TOGGLE =====
    if (data.startsWith('toggle_track_status_')) {
      const statusId = data.replace('toggle_track_status_', '');

      const current = new Set(user.trackedStatuses || []);
      if (current.has(statusId)) current.delete(statusId);
      else current.add(statusId);

      updateUser(uid, { trackedStatuses: Array.from(current) });

      // reopen picker
      await openStatusPicker(chatId, uid);
      return;
    }

    if (data === 'save_status_picker') {
      // if nothing selected -> set default
      const u2 = getUserData(uid);
      if (!u2.trackedStatuses || u2.trackedStatuses.length === 0) {
        await ensureDefaultTrackedStatus(uid);
      }
      await bot.sendMessage(chatId, '✅ Status tracking saved.');
      await showListActions(chatId, uid);
      return;
    }

    // ===== STATIC CALLBACKS =====
    switch (data) {
      case 'set_api_token': {
        // ✅ If token exists - still allow update, but don’t “force” again
        updateUser(uid, { state: 'awaiting_api_token' });
        await bot.sendMessage(chatId, 'Please enter your ClickUp API token:');
        break;
      }

      case 'fetch_teams':
        await fetchAndDisplayTeams(chatId, uid);
        break;

      case 'create_task':
        handleTaskCreation(chatId, uid);
        break;

      case 'current_list':
        displayCurrentList(chatId, uid);
        break;

      case 'clear_data':
        confirmClearData(chatId);
        break;

      case 'help':
        await bot.sendMessage(chatId, getHelpMessage(), { parse_mode: 'Markdown' });
        break;

      case 'confirm_clear_data':
        clearUserData(uid);
        await bot.sendMessage(chatId, 'All your data has been cleared. Use /menu to start fresh.');
        break;

      case 'cancel_clear_data':
        await bot.sendMessage(chatId, 'Your data was not cleared. Use /menu to continue.');
        break;

      case 'get_me': {
        const u = getUserData(uid);
        if (!u.apiToken) {
          await bot.sendMessage(chatId, 'Please set API token first.');
          break;
        }

        const me = await getAuthorizedUser(u.apiToken);
        updateUser(uid, { clickupUserId: me.user.id });

        await bot.sendMessage(chatId, `✅ Your ClickUp ID synced.`);
        break;
      }

      case 'show_tasks': {
        const u = getUserData(uid);
        if (!u.apiToken || !u.lastListId) {
          await bot.sendMessage(chatId, 'Please set API token and select a list first.');
          break;
        }

        const response = await getTasks(u.apiToken, u.lastListId);
        const tasks = response.tasks;

        if (!tasks?.length) {
          await bot.sendMessage(chatId, 'No tasks in this list.');
          break;
        }

        updateUser(uid, { tasks });

        const taskButtons = tasks.map((t) => [
          { text: `${t.name} (${t.status.status})`, callback_data: `task_${t.id}` }
        ]);

        await bot.sendMessage(chatId, 'Select a task:', {
          reply_markup: { inline_keyboard: taskButtons }
        });

        break;
      }

      case 'my_tasks': {
        const u = getUserData(uid);

        if (!u.apiToken || !u.lastListId) {
          await bot.sendMessage(chatId, 'Please select a list first.');
          break;
        }

        if (!u.clickupUserId) {
          await bot.sendMessage(chatId, 'Please sync your ClickUp ID first.');
          break;
        }

        const myTasksResponse = await getMyTasks(u.apiToken, u.lastListId, u.clickupUserId);
        const myTasks = myTasksResponse.tasks;

        if (!myTasks?.length) {
          await bot.sendMessage(chatId, 'You have no assigned tasks in this list.');
          break;
        }

        const myTaskButtons = myTasks.map((t) => [
          { text: `${t.name} (${t.status.status})`, callback_data: `task_${t.id}` }
        ]);

        await bot.sendMessage(chatId, 'Your assigned tasks:', {
          reply_markup: { inline_keyboard: myTaskButtons }
        });

        break;
      }

      case 'change_status': {
        const u = getUserData(uid);

        if (!u.selectedTaskId) {
          await bot.sendMessage(chatId, 'Please select a task first.');
          break;
        }

        const statuses = await getListStatuses(u.apiToken, u.lastListId);
        statuses.sort((a, b) => a.orderindex - b.orderindex);

        const statusButtons = statuses.map((s) => [
          { text: s.status, callback_data: `set_status_${s.status}` }
        ]);

        await bot.sendMessage(chatId, 'Select new status:', {
          reply_markup: { inline_keyboard: statusButtons }
        });

        break;
      }

      case 'pick_status': {
        const u = getUserData(uid);
        if (!u.apiToken || !u.lastListId) {
          await bot.sendMessage(chatId, 'Select a list first.');
          break;
        }
        await openStatusPicker(chatId, uid);
        break;
      }

      default:
        await handleHierarchyNavigation(chatId, uid, data);
    }
  } catch (error) {
    console.error(`Error handling callback: ${error.message}`);

    // ✅ token invalid handling
    if (error.status === 401) {
      resetUserToken(uid);
      await bot.sendMessage(chatId, '❌ ClickUp token invalid/expired. Please set again via /menu.');
      return;
    }

    await bot.sendMessage(chatId, `An error occurred: ${error.message}`);
  }
}

/* =========================
   USER MESSAGES
========================= */
async function handleUserMessage(msg) {
  const chatId = msg.chat.id;
  const uid = msg.from.id;
  const user = getUserData(uid);

  if (!msg.text) {
    bot.sendMessage(chatId, 'I can only process text messages.');
    return;
  }

  try {
    // do not forward commands into callback system (it breaks)
    if (msg.text.startsWith('/')) return;

    if (user.state === 'awaiting_api_token') {
      updateUser(uid, { apiToken: msg.text.trim(), state: null });

      // ✅ BONUS: auto-detect clickup user id right after saving token
      try {
        const me = await getAuthorizedUser(msg.text.trim());
        updateUser(uid, { clickupUserId: me.user.id });
        bot.sendMessage(chatId, '✅ API token saved. ClickUp user detected automatically.');
      } catch (e) {
        resetUserToken(uid);
        bot.sendMessage(chatId, '❌ Invalid token. Try again via /menu.');
        return;
      }

      bot.sendMessage(chatId, 'Use /menu to continue.');
      return;
    }

    if (user.state === 'awaiting_task_input') {
      const taskDetails = parseTaskInput(msg.text);

      if (!taskDetails.title) {
        bot.sendMessage(chatId, 'Invalid task format. Please try again.');
        return;
      }

      if (taskDetails.invalidCategories?.length) {
        bot.sendMessage(chatId, `Invalid Tech Categories: ${taskDetails.invalidCategories.join(', ')}`);
        return;
      }

      await createTask(chatId, uid, taskDetails);
      return;
    }
  } catch (error) {
    console.error(`Error handling user message: ${error.message}`);
    bot.sendMessage(chatId, `An error occurred: ${error.message}`);
  }
}

/* =========================
   HELPERS
========================= */

async function fetchAndDisplayTeams(chatId, uid) {
  const user = getUserData(uid);
  if (!user.apiToken) {
    bot.sendMessage(chatId, 'Please set your API token first.');
    return;
  }
  const teams = await getTeams(user.apiToken);
  sendItemsInGrid(chatId, uid, teams.teams, 'team');
}

function handleTaskCreation(chatId, uid) {
  const user = getUserData(uid);
  if (!user.lastListId) {
    bot.sendMessage(chatId, 'Please select a list first using the menu.');
    return;
  }

  updateUser(uid, { state: 'awaiting_task_input' });

  bot.sendMessage(
    chatId,
    `📝 Напиши задачу обычным текстом.

Минимум:
Название

Можно добавить:
Описание (вторая строка)

Дополнительно:
tags: tag1, tag2
pr: low | normal | high | urgent
sp: число
tc: front, back

Пример:
Сделать авторизацию
через Google

tags: auth
pr: high`
  );
}

function displayCurrentList(chatId, uid) {
  const user = getUserData(uid);
  if (!user.lastListId) {
    bot.sendMessage(chatId, 'No list selected yet. Use Fetch Teams → select list.');
    return;
  }
  bot.sendMessage(chatId, `Current list: ${user.lastListName || user.lastListId}`);
}

function confirmClearData(chatId) {
  bot.sendMessage(chatId, 'Are you sure you want to clear your data?', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Yes', callback_data: 'confirm_clear_data' },
          { text: 'No', callback_data: 'cancel_clear_data' }
        ]
      ]
    }
  });
}

async function createTask(chatId, uid, taskDetails) {
  const user = getUserData(uid);

  if (!user.lastListId) {
    bot.sendMessage(chatId, 'No list selected. Please select a list using /menu.');
    return;
  }

  try {
    const response = await fetchClickUp(`list/${user.lastListId}/task`, user.apiToken, 'POST', {
      name: taskDetails.title,
      description: taskDetails.description,
      tags: taskDetails.tags
    });

    const taskUrl = `https://app.clickup.com/t/${response.id}`;
    bot.sendMessage(chatId, `Task "${response.name}" created successfully!\n\n${taskUrl}`);
    updateUser(uid, { state: null });
  } catch (error) {
    bot.sendMessage(chatId, `Failed to create the task: ${error.message}`);
  }
}

function sendItemsInGrid(chatId, uid, items, type) {
  // Save lists for later lookup if the type is 'list'
  if (type === 'list') {
    updateUser(uid, { lists: items });
  }

  const buttons = [];
  for (let i = 0; i < items.length; i += 2) {
    buttons.push(
      items.slice(i, i + 2).map((item) => ({
        text: item.name,
        callback_data: `${type}_${item.id}`
      }))
    );
  }

  bot.sendMessage(chatId, `Select a ${type}:`, {
    reply_markup: { inline_keyboard: buttons }
  });
}

// ✅ after list selected show actions
async function showListActions(chatId, uid) {
  const user = getUserData(uid);

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Show Tasks 📋', callback_data: 'show_tasks' },
          { text: 'My Tasks 👤', callback_data: 'my_tasks' }
        ],
        [
          { text: 'Filter by Status 🎯', callback_data: 'pick_status' },
          { text: 'Current List 📄', callback_data: 'current_list' }
        ],
        [{ text: 'Menu', callback_data: 'go_menu' }]
      ]
    }
  };

  await bot.sendMessage(chatId, `✅ List selected: *${user.lastListName || user.lastListId}*`, {
    parse_mode: 'Markdown'
  });
  await bot.sendMessage(chatId, 'Choose action:', keyboard);
}

async function ensureDefaultTrackedStatus(uid) {
  const user = getUserData(uid);
  if (!user.apiToken || !user.lastListId) return;
  if (user.trackedStatuses?.length) return;

  const statuses = await getListStatuses(user.apiToken, user.lastListId);
  if (!statuses?.length) return;

  const candidate =
    statuses.find((s) => s.type === 'open') ||
    statuses.find((s) => s.type === 'custom') ||
    statuses[0];

  if (candidate?.id) {
    updateUser(uid, { trackedStatuses: [candidate.id] });
  }
}

async function openStatusPicker(chatId, uid) {
  const user = getUserData(uid);

  const statuses = await getListStatuses(user.apiToken, user.lastListId);
  if (!statuses?.length) {
    await bot.sendMessage(chatId, 'No statuses found in this list.');
    return;
  }

  const picked = new Set(user.trackedStatuses || []);

  const rows = statuses.map((s) => {
    const isOn = picked.has(s.id);
    return [{
      text: `${isOn ? '✅' : '⬜'} ${s.status}`,
      callback_data: `toggle_track_status_${s.id}`
    }];
  });

  rows.push([{ text: 'Save ✅', callback_data: 'save_status_picker' }]);

  await bot.sendMessage(chatId, 'Select statuses to track:', {
    reply_markup: { inline_keyboard: rows }
  });
}

async function handleHierarchyNavigation(chatId, uid, data) {
  const user = getUserData(uid);

  // TEAM → SPACES
  if (data.startsWith('team_')) {
    const teamId = data.split('_')[1];
    updateUser(uid, { lastTeamId: teamId, lastSpaceId: null, lastFolderId: null, lastListId: null });

    const spaces = await getSpaces(user.apiToken, teamId);
    sendItemsInGrid(chatId, uid, spaces.spaces, 'space');
  }

  // SPACE → (FOLDERS or LISTS)
  else if (data.startsWith('space_')) {
    const spaceId = data.split('_')[1];
    updateUser(uid, { lastSpaceId: spaceId, lastFolderId: null, lastListId: null });

    const folders = await getFolders(user.apiToken, spaceId);

    if (folders?.folders?.length > 0) {
      sendItemsInGrid(chatId, uid, folders.folders, 'folder');
    } else {
      const lists = await getListsInSpace(user.apiToken, spaceId);
      sendItemsInGrid(chatId, uid, lists.lists, 'list');
    }
  }

  // FOLDER → LISTS
  else if (data.startsWith('folder_')) {
    const folderId = data.split('_')[1];
    updateUser(uid, { lastFolderId: folderId, lastListId: null });

    const lists = await getLists(user.apiToken, folderId);
    sendItemsInGrid(chatId, uid, lists.lists, 'list');
  }

  // LIST → SELECT (and show actions)
  else if (data.startsWith('list_')) {
    const listId = data.split('_')[1];

    if (!user.lists?.length) {
      bot.sendMessage(chatId, 'Error: No lists available. Please fetch lists again using /menu.');
      return;
    }

    const selectedList = user.lists.find((list) => list.id === listId);
    if (!selectedList) {
      bot.sendMessage(chatId, 'Error: Could not find the selected list.');
      return;
    }

    updateUser(uid, {
      lastListId: listId,
      lastListName: selectedList.name,
      trackedStatuses: [] // reset per list
    });

    // default tracked status if user didn’t pick
    await ensureDefaultTrackedStatus(uid);

    // ✅ auto show actions (no need /menu)
    await showListActions(chatId, uid);
  }

  else if (data === 'go_menu') {
    handleMenu({ chat: { id: chatId }, from: { id: uid } });
  }
}