import { ipcRenderer, contextBridge } from 'electron'

/**
 * Scoped, typed API exposed to the renderer process.
 * Only explicitly allowlisted channels are accessible.
 */

const ALLOWED_INVOKE_CHANNELS = [
  'startup:load',
  'accounts:list',
  'accounts:add',
  'accounts:remove',
  'accounts:test',
  'accounts:update',
  'emails:list',
  'emails:read',
  'emails:thread',
  'emails:search',
  'emails:delete',
  'emails:purge-trash',
  'emails:toggle-flag',
  'email:send',
  'folders:list',
  'folders:unread-counts',
  'folders:unified-unread-count',
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
  // Reply templates
  'templates:list',
  'templates:create',
  'templates:update',
  'templates:delete',
  // Phase 6: Folder CRUD + mark all read
  'folders:create',
  'folders:rename',
  'folders:delete',
  'emails:mark-all-read',
  'emails:mark-read',
  'emails:mark-unread',
  // Print
  'print:email',
  'print:email-pdf',
  // IMAP connection status
  'imap:status',
  // Email body repair
  'emails:refetch-body',
  'emails:repair-bodies',
  // Error logging
  'log:error',
  // Phase 7: Tags
  'tags:list',
  'tags:create',
  'tags:update',
  'tags:delete',
  'tags:assign',
  'tags:remove',
  'tags:emails',
  'emails:tags',
  // Phase 7: Export/Import
  'export:eml',
  'export:mbox',
  'import:eml',
  'import:mbox',
  // Phase 7: Contacts
  'contacts:list',
  'contacts:update',
  'contacts:export-vcard',
  'contacts:export-csv',
  'contacts:import-vcard',
  'contacts:import-csv',
  // Phase 7: Saved searches
  'searches:list',
  'searches:create',
  'searches:delete',
  'searches:run',
  // Phase 7: Message source + Unsubscribe
  'emails:source',
  'emails:unsubscribe-info',
  // Phase 7: Spam
  'spam:train',
  'spam:classify',
  // Phase 7: Folder colors
  'folders:set-color',
  // Phase 8: AI compose + analytics
  'ai:suggest-reply',
  'analytics:busiest-hours',
  // Phase 8: MCP / Agentic settings
  'mcp:get-status',
  'mcp:get-token',
  'mcp:regenerate-token',
  'mcp:set-port',
  'mcp:toggle',
  'mcp:get-tools',
] as const

const ALLOWED_ON_CHANNELS = [
  'email:new',
  'email:read',
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
