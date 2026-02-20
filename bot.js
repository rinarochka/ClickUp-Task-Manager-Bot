import dotenv from 'dotenv';
dotenv.config();
import TelegramBot from 'node-telegram-bot-api';
import { loadUserData, saveUserData, getUserData, updateUser, clearUserData } from './userData.js';
import { fetchClickUp, getTeams, getSpaces, getFolders, getLists } from './clickupApi.js';
import { parseTaskInput } from './taskParser.js';
import { getHelpMessage } from './helpContent.js';
import { getListsInSpace } from './clickupApi.js';
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
    const menu = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Set ClickUp API Token 🛠️', callback_data: 'set_api_token' },
                    { text: 'Fetch Teams 📋', callback_data: 'fetch_teams' },
                ],
                [
                    { text: 'Create Task ✏️', callback_data: 'create_task' },
                    { text: 'Current List 📄', callback_data: 'current_list' },
                ],
                [
                    { text: 'Clear Data 🗑️', callback_data: 'clear_data' },
                    { text: 'Help ❓', callback_data: 'help' },
                ],
            ],
        },
    };
    bot.sendMessage(chatId, 'What do you want to do?', menu);
}

function handleHelp(msg) {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, getHelpMessage(), { parse_mode: 'Markdown' });
}

async function handleCallbackQuery(query) {
    if (!query || !query.id || !query.message) return;

    const chatId = query.message.chat.id;
    const user = getUserData(chatId);
    const data = query.data;

    // ⚡ ОТВЕЧАЕМ МГНОВЕННО (самое важное)
    try {
        await bot.answerCallbackQuery(query.id);
    } catch (e) {
        return; // игнорируем старые кнопки
    }

    try {
        switch (data) {
            case 'set_api_token':
                updateUser(chatId, { state: 'awaiting_api_token' });
                bot.sendMessage(chatId, 'Please enter your ClickUp API token:');
                break;

            case 'fetch_teams':
                await fetchAndDisplayTeams(chatId, user.apiToken);
                break;

            case 'create_task':
                handleTaskCreation(chatId, user);
                break;

            case 'current_list':
                displayCurrentList(chatId, user);
                break;

            case 'clear_data':
                confirmClearData(chatId);
                break;

            case 'help':
                bot.sendMessage(chatId, getHelpMessage(), { parse_mode: 'Markdown' });
                break;

            case 'confirm_clear_data':
                clearUserData(chatId);
                bot.sendMessage(chatId, 'All your data has been cleared. Use /menu to start fresh.');
                break;

            case 'cancel_clear_data':
                bot.sendMessage(chatId, 'Your data was not cleared. Use /menu to continue.');
                break;

            default:
                await handleHierarchyNavigation(chatId, user, data);
        }
    } catch (error) {
        console.error(`Error handling callback: ${error.message}`);
        bot.sendMessage(chatId, `An error occurred: ${error.message}`);
    }
}

async function handleUserMessage(msg) {
    const chatId = msg.chat.id;
    const user = getUserData(chatId);

    // Check if the message contains text
    if (!msg.text) {
        bot.sendMessage(chatId, 'I can only process text messages. Please use text commands or menu options.');
        return;
    }

    try {
        // If the message starts with "/", treat it as a command
        if (msg.text.startsWith('/')) {
            const query = {
                message: { chat: { id: chatId } },
                data: msg.text, // Remove the leading "/"
            };
            await handleCallbackQuery(query);
            return;
        }

        if (user.state === 'awaiting_api_token') {
            updateUser(chatId, { apiToken: msg.text, state: null });
            bot.sendMessage(chatId, 'Your API token has been saved! Use /menu to continue.');
        } else if (user.state === 'awaiting_task_input') {
            const taskDetails = parseTaskInput(msg.text);
            if (!taskDetails.title) {
                bot.sendMessage(chatId, 'Invalid task format. Please try again.');
                return;
            }
            if (taskDetails.invalidCategories && taskDetails.invalidCategories.length) {
                bot.sendMessage(chatId, `Invalid Tech Categories: ${taskDetails.invalidCategories.join(', ')}`);
                return;
            }
            await createTask(chatId, user.apiToken, user.lastListId, taskDetails);
        }
    } catch (error) {
        console.error(`Error handling user message: ${error.message}`);
        bot.sendMessage(chatId, `An error occurred: ${error.message}`);
    }
}

// Additional Helper Functions
async function fetchAndDisplayTeams(chatId, apiToken) {
    if (!apiToken) {
        bot.sendMessage(chatId, 'Please set your API token first.');
        return;
    }
    const teams = await getTeams(apiToken);
    sendItemsInGrid(chatId, teams.teams, 'team');
}

function handleTaskCreation(chatId, user) {
    if (!user.lastListId) {
        bot.sendMessage(chatId, 'Please select a list first using the menu.');
        return;
    }
    updateUser(chatId, { state: 'awaiting_task_input' });
    bot.sendMessage(chatId, 'Enter task details:\n\nTitle\nDescription\ntags: tag1, tag2\npr: high\nsp: 2\ntc: front, back');
}

function displayCurrentList(chatId, user) {
    if (user.lastListName && user.lastListId && user.lastTeamId) {
        const listUrl = `https://app.clickup.com/${user.lastTeamId}/v/li/${user.lastListId}`;
        bot.sendMessage(chatId, `Your current list is: [${user.lastListName}](${listUrl})`, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, 'No list selected. Use /menu to select one.');
    }
}

function confirmClearData(chatId) {
    bot.sendMessage(chatId, 'Are you sure you want to clear your data?', {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Yes', callback_data: 'confirm_clear_data' },
                    { text: 'No', callback_data: 'cancel_clear_data' },
                ],
            ],
        },
    });
}

async function createTask(chatId, apiToken, listId, taskDetails) {
    if (!listId) {
        bot.sendMessage(chatId, 'No list selected. Please select a list using /menu.');
        return;
    }
    try {
       const response = await fetchClickUp(`list/${listId}/task`, apiToken, 'POST', {
       name: taskDetails.title,
       description: taskDetails.description,
       tags: taskDetails.tags
        });

        // Construct the task URL
        const taskUrl = `https://app.clickup.com/t/${response.id}`;

        // Send success message with the task URL
        bot.sendMessage(chatId, `Task "${response.name}" created successfully!\n\n${taskUrl}`, {
            parse_mode: 'Markdown',
        });
    } catch (error) {
        bot.sendMessage(chatId, `Failed to create the task: ${error.message}`);
    }
}

function sendItemsInGrid(chatId, items, type) {
    const user = getUserData(chatId);

    // Save lists for later lookup if the type is 'list'
    if (type === 'list') {
        updateUser(chatId, { lists: items });
    }

    const buttons = [];
    for (let i = 0; i < items.length; i += 2) {
        buttons.push(
            items.slice(i, i + 2).map(item => ({
                text: item.name,
                callback_data: `${type}_${item.id}`,
            }))
        );
    }

    bot.sendMessage(chatId, `Select a ${type}:`, {
        reply_markup: { inline_keyboard: buttons },
    });
}

async function handleHierarchyNavigation(chatId, user, data) {

    // TEAM → SPACES
    if (data.startsWith('team_')) {
        const teamId = data.split('_')[1];
        updateUser(chatId, { lastTeamId: teamId });

        const spaces = await getSpaces(user.apiToken, teamId);
        sendItemsInGrid(chatId, spaces.spaces, 'space');
    }

    // SPACE → (FOLDERS or LISTS)
    else if (data.startsWith('space_')) {
        const spaceId = data.split('_')[1];
        updateUser(chatId, { lastSpaceId: spaceId });

        const folders = await getFolders(user.apiToken, spaceId);

        // если есть папки → показываем папки
        if (folders?.folders?.length > 0) {
            sendItemsInGrid(chatId, folders.folders, 'folder');
        } 
        // если папок нет → списки лежат прямо в Space
        else {
            const lists = await getListsInSpace(user.apiToken, spaceId);
            sendItemsInGrid(chatId, lists.lists, 'list');
        }
    }

    // FOLDER → LISTS
    else if (data.startsWith('folder_')) {
        const folderId = data.split('_')[1];
        updateUser(chatId, { lastFolderId: folderId });

        const lists = await getLists(user.apiToken, folderId);
        sendItemsInGrid(chatId, lists.lists, 'list');
    }

    // LIST → SELECT
    else if (data.startsWith('list_')) {
        const listId = data.split('_')[1];

        if (!user.lists || user.lists.length === 0) {
            bot.sendMessage(chatId, 'Error: No lists available. Please fetch lists again using /menu.');
            return;
        }

        const selectedList = user.lists.find(list => list.id === listId);

        if (!selectedList) {
            bot.sendMessage(chatId, 'Error: Could not find the selected list.');
            return;
        }

        updateUser(chatId, { lastListId: listId, lastListName: selectedList.name });

        bot.sendMessage(
            chatId,
            `List selected: *${selectedList.name}*. You can now create tasks in this list.`,
            { parse_mode: 'Markdown' }
        );
    }
}
