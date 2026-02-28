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
  CheckCheck,
  Palette,
  Tags,
  Search,
  Download,
  Upload,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useTranslation } from 'react-i18next';
import { useEmailStore, type EmailSummary, type Tag, type SavedSearch } from '../stores/emailStore';
import { useThemeStore } from '../stores/themeStore';
import { getProviderIcon } from '../lib/providerIcons';
import { ipcInvoke, ipcOn } from '../lib/ipc';
import styles from './Sidebar.module.css';
import { ConfirmDialog } from './ConfirmDialog';

const SYSTEM_FOLDER_TYPES = new Set(['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive']);

const FOLDER_ICONS: Record<string, React.ElementType> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  trash: Trash2,
};

const DEFAULT_NAV = [
  { icon: Inbox, labelKey: 'sidebar.inbox' },
  { icon: Send, labelKey: 'sidebar.sent' },
  { icon: FileText, labelKey: 'sidebar.drafts' },
  { icon: Archive, labelKey: 'sidebar.archive' },
  { icon: Trash2, labelKey: 'sidebar.trash' },
];

const FOLDER_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1'];

interface SidebarProps {
  onCompose: () => void;
  onSettings: () => void;
  onToast?: (message: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onCompose, onSettings, onToast }) => {
  const { t } = useTranslation();
  const { accounts, folders, selectedFolderId, selectFolder, selectedAccountId, selectAccount, appVersion, setEmails, setSelectedEmail } = useEmailStore();
  const tags = useEmailStore(s => s.tags);
  const setTags = useEmailStore(s => s.setTags);
  const savedSearches = useEmailStore(s => s.savedSearches);
  const setSavedSearches = useEmailStore(s => s.setSavedSearches);
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
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; description?: string; variant?: 'default' | 'danger'; onConfirm: () => void }>({ open: false, title: '', onConfirm: () => {} });

  const activeAccount = accounts.find(a => a.id === selectedAccountId) ?? accounts[0];

  const doPurgeTrash = useCallback(async () => {
    if (!selectedAccountId) return;
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
  }, [selectedAccountId, selectedFolderId, setEmails, setSelectedEmail]);

  const handlePurgeTrash = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedAccountId) return;
    setConfirmDialog({
      open: true,
      title: t('sidebar.emptyTrashConfirm'),
      variant: 'danger',
      onConfirm: doPurgeTrash,
    });
  }, [selectedAccountId, t, doPurgeTrash]);

  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [creatingSubfolder, setCreatingSubfolder] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [colorPickerFolderId, setColorPickerFolderId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const draggedEmailIds = useEmailStore(s => s.draggedEmailIds);
  const setDraggedEmailIds = useEmailStore(s => s.setDraggedEmailIds);

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

  const handleSetFolderColor = useCallback(async (folderId: string, color: string | null) => {
    await ipcInvoke('folders:set-color', folderId, color);
    if (selectedAccountId) {
      const updated = await ipcInvoke<Array<{ id: string; name: string; path: string; type: string; color?: string | null }>>('folders:list', selectedAccountId);
      if (updated) setFolders(updated);
    }
    setColorPickerFolderId(null);
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

  const handleDeleteFolder = useCallback((folderId: string, folderName: string) => {
    setConfirmDialog({
      open: true,
      title: t('sidebar.deleteFolderConfirm', { name: folderName }),
      variant: 'danger',
      onConfirm: async () => {
        const result = await ipcInvoke<{ success: boolean; error?: string }>('folders:delete', folderId);
        if (result?.success) {
          await refreshFolders();
          if (selectedFolderId === folderId) selectFolder(null);
        } else if (result?.error) {
          onToast?.(result.error);
        }
      },
    });
  }, [t, refreshFolders, selectedFolderId, selectFolder, onToast]);

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

  const handleFolderDrop = useCallback(async (e: React.DragEvent, folderId: string, folderName: string) => {
    e.preventDefault();
    setDragOverFolderId(null);
    const EMAIL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
    const rawIds = draggedEmailIds.length > 0
      ? draggedEmailIds
      : e.dataTransfer.getData('text/plain').split(',').filter(Boolean);
    // Validate each ID against expected format and cap array length to 500
    const ids = rawIds.slice(0, 500).filter(id => EMAIL_ID_PATTERN.test(id));
    if (ids.length === 0) return;
    setDraggedEmailIds([]);
    for (const emailId of ids) {
      await ipcInvoke('emails:move', { emailId, destFolderId: folderId });
    }
    onToast?.(t('dragDrop.moveToFolder', { count: ids.length, folder: folderName }));
    if (selectedFolderId) {
      const refreshed = await ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId);
      if (Array.isArray(refreshed)) setEmails(refreshed);
    }
  }, [draggedEmailIds, setDraggedEmailIds, selectedFolderId, setEmails, onToast, t]);

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

  // Load tags and saved searches when account changes
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    ipcInvoke<Tag[]>('tags:list', selectedAccountId).then(result => {
      if (Array.isArray(result) && !cancelled) setTags(result);
    });
    ipcInvoke<SavedSearch[]>('searches:list', selectedAccountId).then(result => {
      if (Array.isArray(result) && !cancelled) setSavedSearches(result);
    });
    return () => { cancelled = true; };
  }, [selectedAccountId, setTags, setSavedSearches]);

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
            aria-label={t('sidebar.switchAccount')}
          >
            <div className={styles['avatar-icon']}>
              {React.createElement(getProviderIcon(activeAccount?.provider ?? 'custom'), { size: 20 })}
            </div>
            <div className={styles['account-info']}>
              <span className={styles['account-name']}>{activeAccount?.display_name ?? t('sidebar.personal')}</span>
              <span className={styles['account-email']}>{activeAccount?.email ?? t('sidebar.noAccount')}</span>
            </div>
            {accounts.length > 1 && <ChevronDown size={14} className={styles['account-chevron']} />}
          </button>
        )}

        {sidebarCollapsed && (
          <button
            className={styles['avatar-icon']}
            onClick={() => { if (accounts.length > 1) setShowAccountPicker(!showAccountPicker); }}
            aria-label={t('sidebar.switchAccount')}
            title={activeAccount?.email ?? t('sidebar.noAccount')}
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
          aria-label={sidebarCollapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
          title={sidebarCollapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
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
                      className={`${styles['nav-item']} ${selectedFolderId === folder.id ? styles['active'] : ''} ${isTrash ? styles['nav-item-trash'] : ''} ${dragOverFolderId === folder.id ? styles['drag-over'] : ''}`}
                      onClick={() => selectFolder(folder.id)}
                      title={sidebarCollapsed ? folder.name : undefined}
                      style={folder.color ? { borderLeftColor: folder.color, borderLeftWidth: '3px', borderLeftStyle: 'solid' } : undefined}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverFolderId(folder.id); }}
                      onDragLeave={() => setDragOverFolderId(null)}
                      onDrop={(e) => handleFolderDrop(e, folder.id, folder.name)}
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
                  {colorPickerFolderId === folder.id && !sidebarCollapsed && (
                    <div className={styles['color-picker-grid']}>
                      {FOLDER_COLORS.map(c => (
                        <button
                          key={c}
                          type="button"
                          className={styles['color-swatch']}
                          style={{ background: c }}
                          onClick={() => handleSetFolderColor(folder.id, c)}
                          aria-label={c}
                        />
                      ))}
                      <button
                        type="button"
                        className={styles['color-swatch-clear']}
                        onClick={() => handleSetFolderColor(folder.id, null)}
                        aria-label={t('sidebar.clearColor')}
                      >
                        &times;
                      </button>
                    </div>
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
                          <DropdownMenu.Item
                            className="folder-ctx-item"
                            onSelect={(e) => { e.preventDefault(); setColorPickerFolderId(folder.id); }}
                          >
                            <Palette size={14} />
                            <span>{t('sidebar.setColor')}</span>
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            className="folder-ctx-item"
                            onSelect={async () => {
                              const result = await ipcInvoke<{ success: boolean; count?: number; error?: string }>('export:mbox', folder.id);
                              if (result?.success) onToast?.(t('export.success', { count: result.count }));
                            }}
                          >
                            <Download size={14} />
                            <span>{t('sidebar.exportMbox')}</span>
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            className="folder-ctx-item"
                            onSelect={async () => {
                              const result = await ipcInvoke<{ success: boolean; count?: number; error?: string }>('import:eml', folder.id);
                              if (result?.success) {
                                onToast?.(t('import.success', { count: result.count }));
                                if (selectedFolderId === folder.id) {
                                  const emails = await ipcInvoke<EmailSummary[]>('emails:list', folder.id);
                                  if (Array.isArray(emails)) setEmails(emails);
                                }
                              }
                            }}
                          >
                            <Upload size={14} />
                            <span>{t('sidebar.importEmails')}</span>
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
              <button key={item.labelKey} className={styles['nav-item']} title={sidebarCollapsed ? t(item.labelKey) : undefined}>
                <item.icon size={18} className={styles['nav-icon']} />
                {!sidebarCollapsed && <span className={styles['nav-label']}>{t(item.labelKey)}</span>}
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

        {tags.length > 0 && (
          <>
            {!sidebarCollapsed && (
              <div className={styles['nav-section-label']}>
                <Tags size={11} />
                {t('tags.title')}
              </div>
            )}
            {tags.map(tag => (
              <button
                key={tag.id}
                className={`${styles['nav-item']} ${selectedFolderId === `__tag_${tag.id}` ? styles['active'] : ''}`}
                onClick={() => selectFolder(`__tag_${tag.id}`)}
                title={sidebarCollapsed ? tag.name : undefined}
              >
                <span className={styles['tag-dot']} style={{ backgroundColor: tag.color }} />
                {!sidebarCollapsed && <span className={styles['nav-label']}>{tag.name}</span>}
              </button>
            ))}
          </>
        )}

        {savedSearches.length > 0 && (
          <>
            {!sidebarCollapsed && (
              <div className={styles['nav-section-label']}>
                <Search size={11} />
                {t('sidebar.savedSearches')}
              </div>
            )}
            {savedSearches.map(search => (
              <div key={search.id} className={styles['nav-item-row']}>
                <button
                  className={`${styles['nav-item']} ${selectedFolderId === `__search_${search.id}` ? styles['active'] : ''}`}
                  onClick={() => selectFolder(`__search_${search.id}`)}
                  title={sidebarCollapsed ? search.name : undefined}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Search size={16} className={styles['nav-icon']} />
                  {!sidebarCollapsed && <span className={styles['nav-label']}>{search.name}</span>}
                </button>
                {!sidebarCollapsed && (
                  <button
                    className={styles['nav-delete-btn']}
                    onClick={async () => {
                      if (!selectedAccountId) return;
                      await ipcInvoke('searches:delete', search.id, selectedAccountId);
                      setSavedSearches(savedSearches.filter(s => s.id !== search.id));
                    }}
                    title={t('sidebar.deleteSavedSearch')}
                    type="button"
                    aria-label={t('sidebar.deleteSavedSearch')}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </nav>

      <div className={styles['sidebar-footer']}>
        {!sidebarCollapsed && (
          <>
            <div className={styles['sync-status']} aria-label={`IMAP: ${imapStatus}, Last sync: ${lastCheckLabel || 'never'}`}>
              <div className={`${styles['sync-dot']} ${styles[`sync-${imapStatus}`]}`} />
              <span className={styles['sync-label']}>
                {accounts.length === 0
                  ? t('sidebar.noAccount')
                  : imapStatus === 'connecting'
                    ? t('sidebar.connecting')
                    : imapStatus === 'error'
                      ? t('sidebar.connectionError')
                      : lastCheckLabel
                        ? t('sidebar.lastCheck', { time: lastCheckLabel })
                        : imapStatus === 'connected'
                          ? t('sidebar.connected')
                          : t('sidebar.notSynced')}
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
              title={imapStatus === 'connected' ? t('sidebar.lastCheck', { time: lastCheckLabel }) : imapStatus}
            />
            <div
              className={`${styles['mcp-dot']} ${mcpCount > 0 ? styles['connected'] : ''}`}
              title={mcpCount > 0 ? `${mcpCount} AI agent${mcpCount !== 1 ? 's' : ''}` : t('sidebar.noAiAgents')}
            />
          </div>
        )}
        <button className={styles['nav-item']} onClick={onSettings} title={sidebarCollapsed ? t('sidebar.settings') : undefined}>
          <Settings size={18} className={styles['nav-icon']} />
          {!sidebarCollapsed && <span className={styles['nav-label']}>{t('sidebar.settings')}</span>}
          {!sidebarCollapsed && appVersion && <span className={styles['version-label']}>v{appVersion}</span>}
        </button>
      </div>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        variant={confirmDialog.variant}
        confirmLabel={t('confirm.delete')}
        onConfirm={confirmDialog.onConfirm}
      />
    </aside>
  );
};
