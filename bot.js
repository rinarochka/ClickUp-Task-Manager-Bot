import dotenv from 'dotenv';
dotenv.config();
import TelegramBot from 'node-telegram-bot-api';
import { loadUserData, saveUserData, getUserData, updateUser, clearUserData } from './userData.js';
import { parseTaskInput } from './taskParser.js';
import { getHelpMessage } from './helpContent.js';
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
    getTasksWithStatuses,
    getMyTasksWithStatuses
} from './clickupApi.js';
// Load Telegram Token from environment or constants
const TelegramToken = process.env.TELEGRAM_TOKEN || '8011206836:AAHAMz1YLgBMUQwa42U4i5VZoWK-qR-evzE';
const bot = new TelegramBot(TelegramToken, { polling: true });

(async function initializeBot() {
    await loadUserData();

    bot.onText(/\/menu/, handleMenu);
    bot.onText(/\/help/, handleHelp);
    bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId,
`👋 Welcome to ClickUp Task Manager Bot!

This bot allows you to:
• Connect your ClickUp account
• Browse Teams / Spaces / Lists
• Create tasks directly from Telegram

Use /menu to begin.`);
    
    handleMenu(msg);
});
    bot.on('callback_query', handleCallbackQuery);
    bot.on('message', handleUserMessage);

    console.log('Bot is running...');
})();

// Handlers
function handleMenu(msg) {
    const chatId = msg.chat.id;
    const user = getUserData(chatId);

    const tokenRow = user.apiToken
        ? [
            { text: 'Update API Token 🔄', callback_data: 'update_api_token' },
            { text: 'Reset API Token 🗑️', callback_data: 'reset_api_token' }
          ]
        : [
            { text: 'Set ClickUp API Token 🛠️', callback_data: 'set_api_token' }
          ];

    const keyboard = [
        tokenRow,
        [
            { text: 'Fetch Teams 📋', callback_data: 'fetch_teams' }
        ],
        [
            { text: 'Create Task ✏️', callback_data: 'create_task' },
            { text: 'Show Tasks 📋', callback_data: 'show_tasks' }
        ],
        [
            { text: 'My Tasks 👤', callback_data: 'my_tasks' }
        ],
        [
            { text: 'Clear Data 🗑️', callback_data: 'clear_data' },
            { text: 'Help ❓', callback_data: 'help' }
        ]
    ];

    bot.sendMessage(chatId, 'What do you want to do?', {
        reply_markup: { inline_keyboard: keyboard }
    });
}

function handleHelp(msg) {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, getHelpMessage(), { parse_mode: 'Markdown' });
}

async function handleCallbackQuery(query) {
    if (!query?.id || !query?.message) return;

    const chatId = query.message.chat.id;
    const user = getUserData(chatId);
    const data = query.data;

    try {
        await bot.answerCallbackQuery(query.id);
    } catch {
        return;
    }

    try {

        // ===============================
        // TASK SELECT
        // ===============================
        if (data.startsWith('task_')) {
            const taskId = data.replace('task_', '');

            updateUser(chatId, { selectedTaskId: taskId });

            await bot.sendMessage(chatId, 'Task options:', {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔄 Change Status', callback_data: 'list_change_status' }
                        ]
                    ]
                }
            });

            return;
        }

        // ===============================
        // STATUS UPDATE
        // ===============================
        if (data.startsWith('toggle_status_')) {

    const status = data.replace('toggle_status_', '');
    const current = user.tempStatusSelection || [];

    let updated;

    if (current.includes(status)) {
        updated = current.filter(s => s !== status);
    } else {
        updated = [...current, status];
    }

    updateUser(chatId, { tempStatusSelection: updated });

    await showStatusFilter(chatId);
    return;
}
        if (data.startsWith('set_status_')) {

            if (!user.selectedTaskId) {
                await bot.sendMessage(chatId, 'Select a task first.');
                return;
            }

            const newStatus = data.replace('set_status_', '');

            await safeClickUpCall(chatId, () =>
                fetchClickUp(
                    `task/${user.selectedTaskId}`,
                    user.apiToken,
                    'PUT',
                    { status: newStatus }
                )
            );

            await bot.sendMessage(chatId, `✅ Status updated to: ${newStatus}`);
            return;
        }

        // ===============================
        // SWITCH HANDLER
        // ===============================
        switch (data) {

            // TOKEN
            case 'set_api_token':
            case 'update_api_token':
                updateUser(chatId, { state: 'awaiting_api_token' });
                await bot.sendMessage(chatId, 'Enter ClickUp API token:');
                break;

            case 'reset_api_token':
                updateUser(chatId, {
                    apiToken: null,
                    clickupUserId: null
                });
                await bot.sendMessage(chatId, '✅ API token reset.');
                handleMenu(query.message);
                break;
                case 'apply_status_filter':

    const selected = user.tempStatusSelection || [];

    let finalStatuses = selected;

    if (!selected.length) {

        const statuses = user.availableStatuses || [];

        const openStatus = statuses.find(s => s.type === 'open');

        const inProgress = statuses.find(s =>
            s.status.toLowerCase().includes('progress')
        );

        if (openStatus) {
            finalStatuses = [openStatus.status];
        } else if (inProgress) {
            finalStatuses = [inProgress.status];
        } else if (statuses.length) {
            finalStatuses = [statuses[0].status];
        }
    }

    updateUser(chatId, {
        selectedStatuses: finalStatuses,
        tempStatusSelection: []
    });

    await bot.sendMessage(
        chatId,
        `✅ Status filter saved:\n${finalStatuses.join(', ')}`
    );

    break;
            // NAVIGATION
            case 'fetch_teams':
            case 'change_list':
                await fetchAndDisplayTeams(chatId, user.apiToken);
                break;

            // LIST CONTEXT ACTIONS
            case 'list_show_tasks':
                await showTasks(chatId);
                break;

            case 'list_my_tasks':
                await showMyTasks(chatId);
                break;

            case 'list_filter_status':
                await showStatusFilter(chatId);
                break;

            case 'list_change_status':
                await showStatusChanger(chatId);
                break;

            case 'list_assign_user':
                await bot.sendMessage(chatId, 'Assign user feature coming next.');
                break;

            case 'list_add_comment':
                await bot.sendMessage(chatId, 'Add comment feature coming next.');
                break;

            // CREATE TASK
            case 'create_task':
                handleTaskCreation(chatId, user);
                break;

            // CLEAR DATA
            case 'clear_data':
                confirmClearData(chatId);
                break;

            case 'confirm_clear_data':
                clearUserData(chatId);
                await bot.sendMessage(chatId, 'All data cleared.');
                break;

            case 'cancel_clear_data':
                await bot.sendMessage(chatId, 'Cancelled.');
                break;

            case 'help':
                await bot.sendMessage(chatId, getHelpMessage(), { parse_mode: 'Markdown' });
                break;

            default:
                await handleHierarchyNavigation(chatId, user, data);
        }

    } catch (error) {

        if (error.message !== 'TOKEN_INVALID') {
            console.error(error);
            await bot.sendMessage(chatId, `Error: ${error.message}`);
        }
    }
}
   
async function handleUserMessage(msg) {
    const chatId = msg.chat.id;
    const user = getUserData(chatId);

    if (!msg.text) return;

    try {

        // =========================
        // API TOKEN INPUT
        // =========================
        if (user.state === 'awaiting_api_token') {

            const newToken = msg.text.trim();

            try {
                const me = await safeClickUpCall(chatId, () =>
                    getAuthorizedUser(newToken)
                );

                updateUser(chatId, {
                    apiToken: newToken,
                    clickupUserId: me.user.id,
                    state: null
                });

                await bot.sendMessage(chatId, '✅ Token saved and synced.');
                handleMenu(msg);

            } catch (err) {
                if (err.message !== 'TOKEN_INVALID') {
                    await bot.sendMessage(chatId, '❌ Invalid API token. Try again.');
                }
            }

            return;
        }

        // =========================
        // TASK CREATION INPUT
        // =========================
        if (user.state === 'awaiting_task_input') {

            const taskDetails = parseTaskInput(msg.text);

            if (!taskDetails.title) {
                await bot.sendMessage(chatId, 'Invalid task format.');
                return;
            }

            await createTask(
                chatId,
                user.apiToken,
                user.lastListId,
                taskDetails
            );

            updateUser(chatId, { state: null });
            return;
        }

    } catch (error) {
        console.error(error);
        await bot.sendMessage(chatId, `Error: ${error.message}`);
    }
}
function buildListActionsKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📋 Show Tasks', callback_data: 'list_show_tasks' },
                    { text: '👤 My Tasks', callback_data: 'list_my_tasks' }
                ],
                [
                    { text: '🔎 Filter by Status', callback_data: 'list_filter_status' },
                    { text: '🔄 Change Status', callback_data: 'list_change_status' }
                ],
                [
                    { text: '👥 Assign User', callback_data: 'list_assign_user' },
                    { text: '💬 Add Comment', callback_data: 'list_add_comment' }
                ],
                [
                    { text: '🔙 Change List', callback_data: 'change_list' }
                ]
            ]
        }
    };
}
async function showTasks(chatId) {
    const user = getUserData(chatId);

    const response = await safeClickUpCall(chatId, () =>
        getTasksWithStatuses(
            user.apiToken,
            user.lastListId,
            user.selectedStatuses || []
        )
    );

    const tasks = response.tasks || [];

    if (!tasks.length) {
        await bot.sendMessage(chatId, 'No tasks for selected statuses.');
        return;
    }

    const buttons = tasks.map(t => [{
        text: `${t.name} (${t.status.status})`,
        callback_data: `task_${t.id}`
    }]);

    await bot.sendMessage(chatId, 'Tasks:', {
        reply_markup: { inline_keyboard: buttons }
    });
}

async function showMyTasks(chatId) {
    const user = getUserData(chatId);

    const response = await safeClickUpCall(chatId, () =>
        getMyTasksWithStatuses(
            user.apiToken,
            user.lastListId,
            user.clickupUserId,
            user.selectedStatuses || []
        )
    );

    const tasks = response.tasks || [];

    if (!tasks.length) {
        await bot.sendMessage(chatId, 'No tasks for selected statuses.');
        return;
    }

    const buttons = tasks.map(t => [{
        text: `${t.name} (${t.status.status})`,
        callback_data: `task_${t.id}`
    }]);

    await bot.sendMessage(chatId, 'Your tasks:', {
        reply_markup: { inline_keyboard: buttons }
    });
}
async function showStatusFilter(chatId) {
    const user = getUserData(chatId);

    const listData = await safeClickUpCall(chatId, () =>
        fetchClickUp(`list/${user.lastListId}`, user.apiToken)
    );

    const statuses = listData.statuses;

    if (!statuses?.length) {
        await bot.sendMessage(chatId, 'No statuses found.');
        return;
    }

    const selected = user.tempStatusSelection || [];

    updateUser(chatId, {
        availableStatuses: statuses
    });

    const buttons = statuses.map(s => [{
        text: selected.includes(s.status)
            ? `✅ ${s.status}`
            : `⬜ ${s.status}`,
        callback_data: `toggle_status_${s.status}`
    }]);

    buttons.push([
        { text: '💾 Apply', callback_data: 'apply_status_filter' }
    ]);

    await bot.sendMessage(chatId, 'Select statuses:', {
        reply_markup: { inline_keyboard: buttons }
    });
}

async function showStatusChanger(chatId) {
    const user = getUserData(chatId);

    if (!user.selectedTaskId) {
        await bot.sendMessage(chatId, 'Select a task first.');
        return;
    }

    const statuses = await safeClickUpCall(chatId, () =>
        getListStatuses(user.apiToken, user.lastListId)
    );

    const buttons = statuses.map(s => [{
        text: s.status,
        callback_data: `set_status_${s.status}`
    }]);

    await bot.sendMessage(chatId, 'Change status:', {
        reply_markup: { inline_keyboard: buttons }
    });
}