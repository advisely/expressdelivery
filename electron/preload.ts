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
  'accounts:set-excluded',
  'emails:list',
  'emails:read',
  'emails:thread',
  'emails:search',
  'emails:search-global',
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
  // v1.18.3: trusted senders allowlist (bypass for senderRisk danger banner)
  'trusted-senders:list',
  'trusted-senders:add',
  'trusted-senders:remove',
  'trusted-senders:is-trusted',
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
  // Phase 4: Auto-update (online)
  'update:check',
  'update:download',
  'update:install',
  // File-based update (.expressdelivery packages)
  'update:pickFile',
  'update:validateFile',
  'update:apply',
  'update:getInfo',
  'update:cleanStaging',
  'update:postUpdateInfo',
  'update:clearPostUpdate',
  // Reply templates
  'templates:list',
  'templates:create',
  'templates:update',
  'templates:delete',
  // Phase 6: Folder CRUD + mark all read
  'folders:create',
  'folders:rename',
  'folders:delete',
  'folders:email-count',
  'emails:mark-all-read',
  'emails:mark-read',
  'emails:mark-unread',
  // Print
  'print:email',
  'print:email-pdf',
  // IMAP connection status
  'imap:status',
  'imap:apply-sync-settings',
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
  // Phase 11: Sender whitelist/blacklist
  'sender-list:add',
  'sender-list:remove',
  'sender-list:list',
  'sender-list:check',
  // Phase 7: Folder colors
  'folders:set-color',
  'folders:reorder',
  'folders:sync',
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
  // External link opener (exact-URL allowlisted in main process)
  'shell:open-external',
  // Email-body link opener — scheme-allowlisted (https/http/mailto) in
  // shellOpenEmailLink.ts. Invoked from the sandboxed iframe click
  // interceptor in ReadingPane.tsx (v1.18.8 bug 3 fix).
  'shell:open-email-link',
  // Phase 12.5: Window controls + app info (frameless window)
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:is-maximized',
  'window:toggle-fullscreen',
  'window:toggle-devtools',
  'app:get-version',
  'app:get-electron-version',
  // Phase 2 OAuth2: auth flow + reauth + state query (D9.6, Task 18)
  'auth:start-oauth-flow',
  'auth:start-reauth-flow',
  'auth:cancel-flow',
  'auth:flow-status',
  'auth:get-state',
  // Network online transition — renderer pokes main to short-circuit reconnect
  // backoff after Wi-Fi / VPN recovery. Fire-and-forget.
  'network:online',
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
  'update:error',
  'update:applyProgress',
  'update:fileOpened',
  'scheduled:sent',
  'scheduled:failed',
  // Phase 12.5: Window state changes (frameless window)
  'window:maximized-change',
  // Phase 2 OAuth2: renderer notification when refresh token is permanently
  // invalid — fired by imapEngine.setNeedsReauthCallback in main.ts (D8.4).
  'auth:needs-reauth',
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
