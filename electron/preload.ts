import { ipcRenderer, contextBridge } from 'electron'

/**
 * Scoped, typed API exposed to the renderer process.
 * Only explicitly allowlisted channels are accessible.
 */

const ALLOWED_INVOKE_CHANNELS = [
  'accounts:list',
  'accounts:add',
  'accounts:remove',
  'accounts:test',
  'accounts:update',
  'emails:list',
  'emails:read',
  'emails:search',
  'emails:delete',
  'emails:toggle-flag',
  'email:send',
  'folders:list',
  'folders:unread-counts',
  'settings:get',
  'settings:set',
  'contacts:search',
  'contacts:upsert',
  'emails:move',
  'emails:archive',
  'drafts:list',
  'drafts:save',
  'drafts:get',
  'drafts:delete',
  'attachments:list',
  'attachments:download',
  'attachments:save',
  'attachments:by-cid',
  'dialog:open-file',
  'mcp:connected-count',
  'apikeys:get-openrouter',
  'apikeys:set-openrouter',
  // Phase 4: Snooze
  'emails:snooze',
  'emails:unsnooze',
  'snoozed:list',
  // Phase 4: Scheduled send
  'scheduled:create',
  'scheduled:cancel',
  'scheduled:list',
  'scheduled:update',
  // Phase 4: Reminders
  'reminders:create',
  'reminders:cancel',
  'reminders:list',
  // Phase 4: Mail rules
  'rules:list',
  'rules:create',
  'rules:update',
  'rules:delete',
  'rules:reorder',
  'rules:test',
  // Phase 4: Auto-update
  'update:check',
  'update:download',
  'update:install',
] as const

const ALLOWED_ON_CHANNELS = [
  'email:new',
  'sync:status',
  'mcp:status',
  // Phase 4
  'reminder:due',
  'notification:click',
  'update:available',
  'update:downloaded',
  'scheduled:sent',
  'scheduled:failed',
] as const

type InvokeChannel = typeof ALLOWED_INVOKE_CHANNELS[number]
type OnChannel = typeof ALLOWED_ON_CHANNELS[number]

contextBridge.exposeInMainWorld('electronAPI', {
  invoke(channel: InvokeChannel, ...args: unknown[]) {
    if (!ALLOWED_INVOKE_CHANNELS.includes(channel)) {
      throw new Error(`IPC channel not allowed: ${channel}`)
    }
    return ipcRenderer.invoke(channel, ...args)
  },

  on(channel: OnChannel, callback: (...args: unknown[]) => void) {
    if (!ALLOWED_ON_CHANNELS.includes(channel)) {
      throw new Error(`IPC channel not allowed: ${channel}`)
    }
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
})
