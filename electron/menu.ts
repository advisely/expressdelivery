import { BrowserWindow, Menu, app, dialog } from 'electron'

const isDev = !!process.env['VITE_DEV_SERVER_URL']

/**
 * Build the application menu bar.
 *
 * Actions that are main-process-only (quit, devtools, zoom, fullscreen) use
 * Electron's built-in `role` system.  Actions that need renderer state
 * (compose, reply, settings, layout, density) send a single `menu:action`
 * IPC event to the renderer, which dispatches via a switch statement.
 */
export function buildAppMenu(win: BrowserWindow): Menu {
  /** Send an action string to the renderer (guards destroyed window). */
  function send(action: string) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('menu:action', action)
    }
  }

  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // ── File ──────────────────────────────────────────────────────────
    {
      label: 'File',
      submenu: [
        { label: 'New Message', accelerator: 'CmdOrCtrl+N', click: () => send('compose') },
        { type: 'separator' },
        { label: 'Import Emails...', click: () => send('import-emails') },
        { label: 'Export Emails...', click: () => send('export-emails') },
        { type: 'separator' },
        { label: 'Import Contacts...', click: () => send('import-contacts') },
        { label: 'Export Contacts...', click: () => send('export-contacts') },
        { type: 'separator' },
        { label: 'Print', accelerator: 'CmdOrCtrl+P', click: () => send('print') },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => send('settings') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },

    // ── Edit ──────────────────────────────────────────────────────────
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
      ],
    },

    // ── View ──────────────────────────────────────────────────────────
    {
      label: 'View',
      submenu: [
        {
          label: 'Layout',
          submenu: [
            { label: 'Vertical Split', click: () => send('layout-vertical') },
            { label: 'Horizontal Split', click: () => send('layout-horizontal') },
          ],
        },
        {
          label: 'Density',
          submenu: [
            { label: 'Compact', click: () => send('density-compact') },
            { label: 'Comfortable', click: () => send('density-comfortable') },
            { label: 'Relaxed', click: () => send('density-relaxed') },
          ],
        },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => send('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => send('zoom-reset') },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: () => send('toggle-sidebar') },
        { role: 'togglefullscreen' },
      ],
    },

    // ── Message ───────────────────────────────────────────────────────
    // Note: R, F, E, Delete are already renderer-side shortcuts.
    // Adding Electron accelerators would intercept them globally (even in
    // text inputs), so we show hints in the label but do NOT register
    // accelerators for single-key shortcuts.
    {
      label: 'Message',
      submenu: [
        { label: 'Reply                R', click: () => send('reply') },
        { label: 'Forward              F', click: () => send('forward') },
        { type: 'separator' },
        { label: 'Archive              E', click: () => send('archive') },
        { label: 'Delete', click: () => send('delete-email') },
        { type: 'separator' },
        { label: 'Mark as Read', click: () => send('mark-read') },
        { label: 'Toggle Star', click: () => send('star') },
        { type: 'separator' },
        { label: 'Next Message', accelerator: 'CmdOrCtrl+J', click: () => send('next-email') },
        { label: 'Previous Message', accelerator: 'CmdOrCtrl+K', click: () => send('prev-email') },
      ],
    },

    // ── Window ────────────────────────────────────────────────────────
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },

    // ── Help ──────────────────────────────────────────────────────────
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: () => send('shortcuts-help') },
        { type: 'separator' },
        { label: 'Check for Updates', click: () => send('check-updates') },
        { type: 'separator' },
        ...(isDev
          ? [{ role: 'toggleDevTools' as const }, { type: 'separator' as const }]
          : []),
        {
          label: 'About ExpressDelivery',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About ExpressDelivery',
              message: `ExpressDelivery v${app.getVersion()}`,
              detail: 'AI-powered email client with MCP integration.\nElectron ' + process.versions.electron,
            })
          },
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
