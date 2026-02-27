import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Inbox,
  Send,
  FileText,
  Archive,
  Trash2,
  Settings,
  Plus,
  ChevronDown,
  Clock,
  CalendarClock,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  MoreVertical,
  FolderPlus,
  Pencil,
  FolderX,
  CheckCheck
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useTranslation } from 'react-i18next';
import { useEmailStore, type EmailSummary } from '../stores/emailStore';
import { useThemeStore } from '../stores/themeStore';
import { getProviderIcon } from '../lib/providerIcons';
import { ipcInvoke, ipcOn } from '../lib/ipc';
import styles from './Sidebar.module.css';

const SYSTEM_FOLDER_TYPES = new Set(['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive']);

const FOLDER_ICONS: Record<string, React.ElementType> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  trash: Trash2,
};

const DEFAULT_NAV = [
  { icon: Inbox, label: 'Inbox' },
  { icon: Send, label: 'Sent' },
  { icon: FileText, label: 'Drafts' },
  { icon: Archive, label: 'Archive' },
  { icon: Trash2, label: 'Trash' },
];

interface SidebarProps {
  onCompose: () => void;
  onSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onCompose, onSettings }) => {
  const { t } = useTranslation();
  const { accounts, folders, selectedFolderId, selectFolder, selectedAccountId, selectAccount, appVersion, setEmails, setSelectedEmail } = useEmailStore();
  const { sidebarCollapsed, toggleSidebar } = useThemeStore();
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [mcpCount, setMcpCount] = useState(0);
  const [snoozedCount, setSnoozedCount] = useState(0);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [unifiedUnreadCount, setUnifiedUnreadCount] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [imapStatus, setImapStatus] = useState<'none' | 'error' | 'connecting' | 'connected'>('none');
  const [lastCheckLabel, setLastCheckLabel] = useState('');

  const activeAccount = accounts.find(a => a.id === selectedAccountId) ?? accounts[0];

  const handlePurgeTrash = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedAccountId) return;
    if (!window.confirm(t('sidebar.emptyTrashConfirm'))) return;
    const result = await ipcInvoke<{ success: boolean }>('emails:purge-trash', selectedAccountId);
    if (result?.success) {
      setSelectedEmail(null);
      if (selectedFolderId) {
        const refreshed = await ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId);
        if (refreshed) setEmails(refreshed);
      }
      const counts = await ipcInvoke<Array<{ folder_id: string; count: number }>>('folders:unread-counts', selectedAccountId);
      if (counts) {
        const map: Record<string, number> = {};
        for (const row of counts) map[row.folder_id] = row.count;
        setUnreadCounts(map);
      }
    }
  }, [selectedAccountId, selectedFolderId, t, setEmails, setSelectedEmail]);

  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [creatingSubfolder, setCreatingSubfolder] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingFolderId && renameInputRef.current) renameInputRef.current.focus();
  }, [renamingFolderId]);

  useEffect(() => {
    if (creatingSubfolder && createInputRef.current) createInputRef.current.focus();
  }, [creatingSubfolder]);

  const { setFolders } = useEmailStore();

  const refreshFolders = useCallback(async () => {
    if (!selectedAccountId) return;
    const result = await ipcInvoke<Array<{ id: string; name: string; path: string; type: string }>>('folders:list', selectedAccountId);
    if (result) setFolders(result);
  }, [selectedAccountId, setFolders]);

  const handleRenameFolder = useCallback(async (folderId: string) => {
    if (!renameValue.trim()) { setRenamingFolderId(null); return; }
    const result = await ipcInvoke<{ success: boolean; error?: string }>('folders:rename', folderId, renameValue.trim());
    if (result?.success) {
      await refreshFolders();
    }
    setRenamingFolderId(null);
    setRenameValue('');
  }, [renameValue, refreshFolders]);

  const handleDeleteFolder = useCallback(async (folderId: string, folderName: string) => {
    if (!window.confirm(t('sidebar.deleteFolderConfirm', { name: folderName }))) return;
    const result = await ipcInvoke<{ success: boolean; error?: string }>('folders:delete', folderId);
    if (result?.success) {
      await refreshFolders();
      if (selectedFolderId === folderId) selectFolder(null);
    } else if (result?.error) {
      window.alert(result.error);
    }
  }, [t, refreshFolders, selectedFolderId, selectFolder]);

  const handleCreateSubfolder = useCallback(async (parentPath: string) => {
    if (!newFolderName.trim() || !selectedAccountId) { setCreatingSubfolder(null); return; }
    const result = await ipcInvoke<{ success: boolean; error?: string }>('folders:create', selectedAccountId, newFolderName.trim(), parentPath);
    if (result?.success) {
      await refreshFolders();
    }
    setCreatingSubfolder(null);
    setNewFolderName('');
  }, [newFolderName, selectedAccountId, refreshFolders]);

  const handleMarkAllRead = useCallback(async (folderId: string) => {
    const result = await ipcInvoke<{ success: boolean }>('emails:mark-all-read', folderId);
    if (result?.success) {
      if (selectedFolderId === folderId) {
        const refreshed = await ipcInvoke<EmailSummary[]>('emails:list', folderId);
        if (refreshed) setEmails(refreshed);
      }
      const counts = await ipcInvoke<Array<{ folder_id: string; count: number }>>('folders:unread-counts', selectedAccountId);
      if (counts) {
        const map: Record<string, number> = {};
        for (const row of counts) map[row.folder_id] = row.count;
        setUnreadCounts(map);
      }
    }
  }, [selectedFolderId, selectedAccountId, setEmails]);

  const handleCreateTopLevelFolder = useCallback(async () => {
    if (!newFolderName.trim() || !selectedAccountId) { setCreatingSubfolder(null); return; }
    const result = await ipcInvoke<{ success: boolean; error?: string }>('folders:create', selectedAccountId, newFolderName.trim());
    if (result?.success) {
      await refreshFolders();
    }
    setCreatingSubfolder(null);
    setNewFolderName('');
  }, [newFolderName, selectedAccountId, refreshFolders]);

  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    async function loadCounts() {
      const result = await ipcInvoke<Array<{ folder_id: string; count: number }>>('folders:unread-counts', selectedAccountId);
      if (result && !cancelled) {
        const counts: Record<string, number> = {};
        for (const row of result) {
          counts[row.folder_id] = row.count;
        }
        setUnreadCounts(counts);
      }
    }
    async function loadUnifiedCount() {
      const result = await ipcInvoke<{ count: number }>('folders:unified-unread-count');
      if (result && !cancelled) setUnifiedUnreadCount(result.count);
    }
    loadCounts();
    loadUnifiedCount();

    const api = (window as unknown as { electronAPI?: { on: (ch: string, cb: (...args: unknown[]) => void) => () => void } }).electronAPI;
    const unsubNew = api?.on('email:new', () => { loadCounts(); loadUnifiedCount(); });
    const unsubRead = api?.on('email:read', () => { loadCounts(); loadUnifiedCount(); });

    return () => { cancelled = true; unsubNew?.(); unsubRead?.(); };
  }, [selectedAccountId]);

  // Unified inbox unread count (only relevant with 2+ accounts)
  useEffect(() => {
    if (accounts.length < 2) return;
    let cancelled = false;
    async function loadUnifiedCount() {
      const result = await ipcInvoke<{ count: number }>('folders:unified-unread-count');
      if (result && !cancelled) setUnifiedUnreadCount(result.count);
    }
    loadUnifiedCount();
    return () => { cancelled = true; };
  }, [accounts.length]);

  // Snoozed & scheduled counts
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    async function loadCounts() {
      const snoozed = await ipcInvoke<Array<unknown>>('snoozed:list', selectedAccountId);
      const scheduled = await ipcInvoke<Array<unknown>>('scheduled:list', selectedAccountId);
      if (!cancelled) {
        setSnoozedCount(snoozed?.length ?? 0);
        setScheduledCount(scheduled?.length ?? 0);
      }
    }
    loadCounts();
    return () => { cancelled = true; };
  }, [selectedAccountId]);

  // MCP connection status
  useEffect(() => {
    let cancelled = false;
    ipcInvoke<{ count: number }>('mcp:connected-count').then(result => {
      if (result && !cancelled) setMcpCount(result.count);
    });
    const cleanup = ipcOn('mcp:status', (...args: unknown[]) => {
      const data = args[0] as { connectedAgents: number } | undefined;
      if (data && !cancelled) setMcpCount(data.connectedAgents);
    });
    return () => { cancelled = true; cleanup?.(); };
  }, []);

  // IMAP connection status — poll every 5 seconds + listen for push events
  useEffect(() => {
    let cancelled = false;

    function pollStatus() {
      if (!selectedAccountId || cancelled) return;
      ipcInvoke<{ status: string; lastSync: number | null }>('imap:status', selectedAccountId).then(result => {
        if (result && !cancelled) {
          setImapStatus(result.status as 'none' | 'error' | 'connecting' | 'connected');
          if (result.lastSync) setLastSyncTime(result.lastSync);
        }
      });
    }

    // Initial poll + 5s interval
    pollStatus();
    const pollTimer = setInterval(pollStatus, 5_000);

    // Also listen for push events for immediate updates
    const cleanupSync = ipcOn('sync:status', (...args: unknown[]) => {
      const data = args[0] as { accountId?: string; status?: string; timestamp?: number } | undefined;
      if (data && !cancelled && data.accountId === selectedAccountId) {
        if (data.status) setImapStatus(data.status as 'none' | 'error' | 'connecting' | 'connected');
        if (data.timestamp) setLastSyncTime(data.timestamp);
      }
    });

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      cleanupSync?.();
      setImapStatus('none');
      setLastSyncTime(null);
    };
  }, [selectedAccountId]);

  // Update "last check" label every 5 seconds (matches poll interval)
  useEffect(() => {
    function updateLabel() {
      if (!lastSyncTime) { setLastCheckLabel(''); return; }
      const diffSec = Math.floor((Date.now() - lastSyncTime) / 1000);
      if (diffSec < 60) setLastCheckLabel(`${diffSec}s ago`);
      else if (diffSec < 3600) setLastCheckLabel(`${Math.floor(diffSec / 60)}m ago`);
      else if (diffSec < 86400) setLastCheckLabel(`${Math.floor(diffSec / 3600)}h ago`);
      else setLastCheckLabel(`${Math.floor(diffSec / 86400)}d ago`);
    }
    updateLabel();
    const timer = setInterval(updateLabel, 5_000);
    return () => clearInterval(timer);
  }, [lastSyncTime]);

  return (
    <aside className={`${styles['sidebar']} ${sidebarCollapsed ? styles['collapsed'] : ''} glass`}>
      <div className={styles['sidebar-header']}>
        {!sidebarCollapsed && (
          <button
            className={styles['account-selector']}
            onClick={() => { if (accounts.length > 1) setShowAccountPicker(!showAccountPicker); }}
            aria-expanded={accounts.length > 1 ? showAccountPicker : undefined}
            aria-label="Switch account"
          >
            <div className={styles['avatar-icon']}>
              {React.createElement(getProviderIcon(activeAccount?.provider ?? 'custom'), { size: 20 })}
            </div>
            <div className={styles['account-info']}>
              <span className={styles['account-name']}>{activeAccount?.display_name ?? 'Personal'}</span>
              <span className={styles['account-email']}>{activeAccount?.email ?? 'No account'}</span>
            </div>
            {accounts.length > 1 && <ChevronDown size={14} className={styles['account-chevron']} />}
          </button>
        )}

        {sidebarCollapsed && (
          <button
            className={styles['avatar-icon']}
            onClick={() => { if (accounts.length > 1) setShowAccountPicker(!showAccountPicker); }}
            aria-label="Switch account"
            title={activeAccount?.email ?? 'No account'}
          >
            {React.createElement(getProviderIcon(activeAccount?.provider ?? 'custom'), { size: 20 })}
          </button>
        )}

        {showAccountPicker && accounts.length > 1 && !sidebarCollapsed && (
          <div className={styles['account-picker']}>
            {accounts.map(acc => {
              const AccIcon = getProviderIcon(acc.provider);
              return (
                <button
                  key={acc.id}
                  className={`${styles['account-picker-item']} ${acc.id === selectedAccountId ? styles['active'] : ''}`}
                  onClick={() => {
                    selectAccount(acc.id);
                    setShowAccountPicker(false);
                  }}
                >
                  <div className={styles['avatar-icon-sm']}><AccIcon size={16} /></div>
                  <div className={styles['account-info']}>
                    <span className={styles['account-name']}>{acc.display_name ?? acc.email}</span>
                    <span className={styles['account-email']}>{acc.email}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <button
          className={styles['collapse-btn']}
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <div className={styles['compose-wrapper']}>
        <button className={styles['compose-btn']} onClick={onCompose} title={sidebarCollapsed ? t('sidebar.compose') : undefined}>
          <Plus size={18} />
          {!sidebarCollapsed && <span>{t('sidebar.compose')}</span>}
        </button>
      </div>

      <nav className={styles['sidebar-nav']}>
        {folders.length > 0
          ? folders.map((folder) => {
              const Icon = FOLDER_ICONS[folder.type ?? ''] ?? Inbox;
              const count = unreadCounts[folder.id];
              const isTrash = folder.type === 'trash';
              const isSystem = SYSTEM_FOLDER_TYPES.has(folder.type ?? '');
              const isRenaming = renamingFolderId === folder.id;
              return (
                <div key={folder.id} className={styles['nav-item-row']}>
                  {isRenaming ? (
                    <form
                      className={styles['rename-form']}
                      onSubmit={(e) => { e.preventDefault(); handleRenameFolder(folder.id); }}
                    >
                      <input
                        ref={renameInputRef}
                        className={styles['rename-input']}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => handleRenameFolder(folder.id)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { setRenamingFolderId(null); setRenameValue(''); } }}
                        maxLength={100}
                      />
                    </form>
                  ) : (
                    <button
                      className={`${styles['nav-item']} ${selectedFolderId === folder.id ? styles['active'] : ''} ${isTrash ? styles['nav-item-trash'] : ''}`}
                      onClick={() => selectFolder(folder.id)}
                      title={sidebarCollapsed ? folder.name : undefined}
                    >
                      <Icon size={18} className={styles['nav-icon']} />
                      {!sidebarCollapsed && <span className={styles['nav-label']}>{folder.name}</span>}
                      {!sidebarCollapsed && count != null && count > 0 && (
                        <span className={styles['nav-badge']}>{count > 99 ? '99+' : count}</span>
                      )}
                      {sidebarCollapsed && count != null && count > 0 && (
                        <span className={styles['nav-badge-dot']} />
                      )}
                    </button>
                  )}
                  {!sidebarCollapsed && !isRenaming && (
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button
                          className={styles['folder-menu-btn']}
                          aria-label={t('sidebar.folderActions')}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical size={14} />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content className="folder-ctx-menu" sideOffset={4} align="start">
                          <DropdownMenu.Item
                            className="folder-ctx-item"
                            onSelect={() => handleMarkAllRead(folder.id)}
                          >
                            <CheckCheck size={14} />
                            <span>{t('sidebar.markAllRead')}</span>
                          </DropdownMenu.Item>
                          {!isSystem && (
                            <DropdownMenu.Item
                              className="folder-ctx-item"
                              onSelect={() => { setRenamingFolderId(folder.id); setRenameValue(folder.name); }}
                            >
                              <Pencil size={14} />
                              <span>{t('sidebar.renameFolder')}</span>
                            </DropdownMenu.Item>
                          )}
                          <DropdownMenu.Item
                            className="folder-ctx-item"
                            onSelect={() => { setCreatingSubfolder(folder.path); setNewFolderName(''); }}
                          >
                            <FolderPlus size={14} />
                            <span>{t('sidebar.createSubfolder')}</span>
                          </DropdownMenu.Item>
                          {isTrash && (
                            <DropdownMenu.Item
                              className="folder-ctx-item folder-ctx-danger"
                              onSelect={(e) => handlePurgeTrash(e as unknown as React.MouseEvent)}
                            >
                              <Trash2 size={14} />
                              <span>{t('sidebar.emptyTrash')}</span>
                            </DropdownMenu.Item>
                          )}
                          {!isSystem && (
                            <DropdownMenu.Item
                              className="folder-ctx-item folder-ctx-danger"
                              onSelect={() => handleDeleteFolder(folder.id, folder.name)}
                            >
                              <FolderX size={14} />
                              <span>{t('sidebar.deleteFolder')}</span>
                            </DropdownMenu.Item>
                          )}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  )}
                </div>
              );
            })
          : DEFAULT_NAV.map((item) => (
              <button key={item.label} className={styles['nav-item']} title={sidebarCollapsed ? item.label : undefined}>
                <item.icon size={18} className={styles['nav-icon']} />
                {!sidebarCollapsed && <span className={styles['nav-label']}>{item.label}</span>}
              </button>
            ))
        }
        {/* Inline new subfolder input */}
        {creatingSubfolder !== null && !sidebarCollapsed && (
          <form
            className={styles['rename-form']}
            onSubmit={(e) => {
              e.preventDefault();
              if (creatingSubfolder === '__top') handleCreateTopLevelFolder();
              else handleCreateSubfolder(creatingSubfolder);
            }}
          >
            <FolderPlus size={14} className={styles['nav-icon']} />
            <input
              ref={createInputRef}
              className={styles['rename-input']}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={() => { setCreatingSubfolder(null); setNewFolderName(''); }}
              onKeyDown={(e) => { if (e.key === 'Escape') { setCreatingSubfolder(null); setNewFolderName(''); } }}
              placeholder={t('sidebar.newFolderName')}
              maxLength={100}
            />
          </form>
        )}
        {accounts.length >= 2 && (
          <button
            className={`${styles['nav-item']} ${selectedFolderId === '__unified' ? styles['active'] : ''}`}
            onClick={() => selectFolder('__unified')}
            title={sidebarCollapsed ? t('sidebar.allInboxes') : undefined}
          >
            <Layers size={18} className={styles['nav-icon']} />
            {!sidebarCollapsed && <span className={styles['nav-label']}>{t('sidebar.allInboxes')}</span>}
            {!sidebarCollapsed && unifiedUnreadCount > 0 && (
              <span className={styles['nav-badge']}>{unifiedUnreadCount > 99 ? '99+' : unifiedUnreadCount}</span>
            )}
            {sidebarCollapsed && unifiedUnreadCount > 0 && (
              <span className={styles['nav-badge-dot']} />
            )}
          </button>
        )}
        {snoozedCount > 0 && (
          <button
            className={`${styles['nav-item']} ${selectedFolderId === '__snoozed' ? styles['active'] : ''}`}
            onClick={() => selectFolder('__snoozed')}
            title={sidebarCollapsed ? t('sidebar.snoozed') : undefined}
          >
            <Clock size={18} className={styles['nav-icon']} />
            {!sidebarCollapsed && <span className={styles['nav-label']}>{t('sidebar.snoozed')}</span>}
            {!sidebarCollapsed && <span className={styles['nav-badge']}>{snoozedCount}</span>}
            {sidebarCollapsed && <span className={styles['nav-badge-dot']} />}
          </button>
        )}
        {scheduledCount > 0 && (
          <button
            className={`${styles['nav-item']} ${selectedFolderId === '__scheduled' ? styles['active'] : ''}`}
            onClick={() => selectFolder('__scheduled')}
            title={sidebarCollapsed ? t('sidebar.scheduled') : undefined}
          >
            <CalendarClock size={18} className={styles['nav-icon']} />
            {!sidebarCollapsed && <span className={styles['nav-label']}>{t('sidebar.scheduled')}</span>}
            {!sidebarCollapsed && <span className={styles['nav-badge']}>{scheduledCount}</span>}
            {sidebarCollapsed && <span className={styles['nav-badge-dot']} />}
          </button>
        )}
      </nav>

      <div className={styles['sidebar-footer']}>
        {!sidebarCollapsed && (
          <>
            <div className={styles['sync-status']} aria-label={`IMAP: ${imapStatus}, Last sync: ${lastCheckLabel || 'never'}`}>
              <div className={`${styles['sync-dot']} ${styles[`sync-${imapStatus}`]}`} />
              <span className={styles['sync-label']}>
                {accounts.length === 0
                  ? 'No account'
                  : imapStatus === 'connecting'
                    ? 'Connecting...'
                    : imapStatus === 'error'
                      ? 'Connection error'
                      : lastCheckLabel
                        ? `Last check: ${lastCheckLabel}`
                        : imapStatus === 'connected'
                          ? 'Connected'
                          : 'Not synced'}
              </span>
            </div>
            <div className={styles['mcp-status']} aria-label={`${mcpCount} AI agent${mcpCount !== 1 ? 's' : ''} connected`}>
              <div className={`${styles['mcp-dot']} ${mcpCount > 0 ? styles['connected'] : ''}`} />
              <span className={styles['mcp-label']}>
                {mcpCount > 0 ? `${mcpCount} AI agent${mcpCount !== 1 ? 's' : ''}` : t('sidebar.mcpDisconnected')}
              </span>
            </div>
          </>
        )}
        {sidebarCollapsed && (
          <div className={styles['collapsed-status']}>
            <div
              className={`${styles['sync-dot']} ${styles[`sync-${imapStatus}`]}`}
              title={imapStatus === 'connected' ? `Last check: ${lastCheckLabel}` : imapStatus}
            />
            <div
              className={`${styles['mcp-dot']} ${mcpCount > 0 ? styles['connected'] : ''}`}
              title={mcpCount > 0 ? `${mcpCount} AI agent${mcpCount !== 1 ? 's' : ''}` : 'No AI agents'}
            />
          </div>
        )}
        <button className={styles['nav-item']} onClick={onSettings} title={sidebarCollapsed ? t('sidebar.settings') : undefined}>
          <Settings size={18} className={styles['nav-icon']} />
          {!sidebarCollapsed && <span className={styles['nav-label']}>{t('sidebar.settings')}</span>}
          {!sidebarCollapsed && appVersion && <span className={styles['version-label']}>v{appVersion}</span>}
        </button>
      </div>
    </aside>
  );
};
