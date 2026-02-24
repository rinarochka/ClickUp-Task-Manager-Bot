import cron from 'node-cron'
import { getAllUsers } from './userData.js'
import { getListTasks } from './clickupApi.js'

export function startScheduler(bot) {

  cron.schedule('0 10 * * *', async () => {

    const users = getAllUsers()

    for (const u of users) {

      if (!u.reminders.daily) continue
      if (!u.token || !u.listId) continue

      try {
        const res = await getListTasks(
          u.token,
          u.listId,
          {
            assignees: u.clickupUserId,
            statuses: u.trackedStatuses
          }
        )

        const tasks = res.tasks || []
        if (!tasks.length) continue

        const text = tasks
          .slice(0, 20)
          .map(t => `• ${t.name}`)
          .join('\n')

        await bot.sendMessage(
          u.telegramId,
          `📅 Tasks for today:\n\n${text}`
        )

      } catch (e) {
        console.log('Daily scheduler error', e.message)
      }
    }

  })

  cron.schedule('0 * * * *', async () => {

    const users = getAllUsers()

    for (const u of users) {

      if (!u.reminders.hourly) continue
      if (!u.token || !u.listId) continue

      try {
        const res = await getListTasks(
          u.token,
          u.listId,
          {
            assignees: u.clickupUserId,
            statuses: u.trackedStatuses
          }
        )

        const tasks = res.tasks || []
        if (!tasks.length) continue

        const text = tasks
          .slice(0, 20)
          .map(t => `• ${t.name}`)
          .join('\n')

        await bot.sendMessage(
          u.telegramId,
          `⏰ Reminder:\n\n${text}`
        )

      } catch (e) {
        console.log('Hourly scheduler error', e.message)
      }
    }

  })

}