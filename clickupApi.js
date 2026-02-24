import fetch from 'node-fetch';

// Reusable API agent configuration for IPv4
const agentOptions = {
    agentClass: undefined,
    agentOptions: { family: 4 }, // Force IPv4
};
export async function getListsInSpace(token, spaceId) {
    return await fetchClickUp(`space/${spaceId}/list`, token);
}
export async function fetchClickUp(endpoint, apiToken, method = 'GET', body = null) {
    const url = `https://api.clickup.com/api/v2/${endpoint}`;
    const headers = {
        'Authorization': apiToken,
        'Content-Type': 'application/json',
    };
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    try {
        const response = await fetch(url, options);
        const data = await response.json();

        if (!response.ok) {
            console.error(`Error fetching from ClickUp: ${JSON.stringify(data)}`);
            throw new Error(data.err || `HTTP ${response.status}: ${response.statusText}`);
        }

        return data;
    } catch (error) {
        console.error(`Error fetching from ClickUp: ${error.message}`);
        throw error;
    }
}

// Fetch Teams
export async function getTeams(apiToken) {
    return await fetchClickUp('team', apiToken);
}

// Fetch Spaces
export async function getSpaces(apiToken, teamId) {
    return await fetchClickUp(`team/${teamId}/space`, apiToken);
}

// Fetch Folders
export async function getFolders(apiToken, spaceId) {
    return await fetchClickUp(`space/${spaceId}/folder`, apiToken);
}

// Fetch Lists
export async function getLists(apiToken, folderId) {
    return await fetchClickUp(`folder/${folderId}/list`, apiToken);
}
//status
export async function getTasks(apiToken, listId) {
    return fetchClickUp(`list/${listId}/task`, apiToken);
}

export async function getListStatuses(apiToken, listId) {
    const response = await fetchClickUp(`list/${listId}`, apiToken);
    return response.statuses;
}
//TASKS
export async function getAuthorizedUser(apiToken) {
    return fetchClickUp('user', apiToken);
}
export async function getMyTasks(apiToken, listId, userId) {
    return fetchClickUp(
        `list/${listId}/task?assignees[]=${userId}`,
        apiToken
    );
}
const BASE = 'https://api.clickup.com/api/v2'

async function request(token, method, path, body) {

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })

  const text = await res.text()
  const data = text ? JSON.parse(text) : {}

  if (!res.ok) {
    const error = new Error(data?.err || 'ClickUp API error')
    error.status = res.status
    throw error
  }

  return data
}
export async function getListStatuses(token, listId) {
  const list = await request(token, 'GET', `/list/${listId}`)
  return list.statuses || []
}