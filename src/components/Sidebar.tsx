import React, { useState, useEffect, useCallback } from 'react';
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
  Layers
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEmailStore } from '../stores/emailStore';
import { getProviderIcon } from '../lib/providerIcons';
import { ipcInvoke, ipcOn } from '../lib/ipc';
import styles from './Sidebar.module.css';

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
  const { accounts, folders, selectedFolderId, selectFolder, selectedAccountId, selectAccount } = useEmailStore();
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
    await ipcInvoke('emails:purge-trash', selectedAccountId);
  }, [selectedAccountId, t]);

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
    const unsub = api?.on('email:new', () => { loadCounts(); loadUnifiedCount(); });

    return () => { cancelled = true; unsub?.(); };
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
    <aside className={`${styles['sidebar']} glass`}>
      <div className={styles['sidebar-header']}>
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

        {showAccountPicker && accounts.length > 1 && (
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
      </div>

      <div className={styles['compose-wrapper']}>
        <button className={styles['compose-btn']} onClick={onCompose}>
          <Plus size={18} />
          <span>{t('sidebar.compose')}</span>
        </button>
      </div>

      <nav className={styles['sidebar-nav']}>
        {folders.length > 0
          ? folders.map((folder) => {
              const Icon = FOLDER_ICONS[folder.type ?? ''] ?? Inbox;
              const count = unreadCounts[folder.id];
              const isTrash = folder.type === 'trash';
              return (
                <div key={folder.id} className={styles['nav-item-row']}>
                  <button
                    className={`${styles['nav-item']} ${selectedFolderId === folder.id ? styles['active'] : ''} ${isTrash ? styles['nav-item-trash'] : ''}`}
                    onClick={() => selectFolder(folder.id)}
                  >
                    <Icon size={18} className={styles['nav-icon']} />
                    <span className={styles['nav-label']}>{folder.name}</span>
                    {count != null && count > 0 && (
                      <span className={styles['nav-badge']}>{count > 99 ? '99+' : count}</span>
                    )}
                  </button>
                  {isTrash && (
                    <button
                      className={styles['purge-btn']}
                      onClick={handlePurgeTrash}
                      title={t('sidebar.emptyTrash')}
                      aria-label={t('sidebar.emptyTrash')}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })
          : DEFAULT_NAV.map((item) => (
              <button key={item.label} className={styles['nav-item']}>
                <item.icon size={18} className={styles['nav-icon']} />
                <span className={styles['nav-label']}>{item.label}</span>
              </button>
            ))
        }
        {accounts.length >= 2 && (
          <button
            className={`${styles['nav-item']} ${selectedFolderId === '__unified' ? styles['active'] : ''}`}
            onClick={() => selectFolder('__unified')}
          >
            <Layers size={18} className={styles['nav-icon']} />
            <span className={styles['nav-label']}>{t('sidebar.allInboxes')}</span>
            {unifiedUnreadCount > 0 && (
              <span className={styles['nav-badge']}>{unifiedUnreadCount > 99 ? '99+' : unifiedUnreadCount}</span>
            )}
          </button>
        )}
        {snoozedCount > 0 && (
          <button className={`${styles['nav-item']} ${selectedFolderId === '__snoozed' ? styles['active'] : ''}`} onClick={() => selectFolder('__snoozed')}>
            <Clock size={18} className={styles['nav-icon']} />
            <span className={styles['nav-label']}>{t('sidebar.snoozed')}</span>
            <span className={styles['nav-badge']}>{snoozedCount}</span>
          </button>
        )}
        {scheduledCount > 0 && (
          <button className={`${styles['nav-item']} ${selectedFolderId === '__scheduled' ? styles['active'] : ''}`} onClick={() => selectFolder('__scheduled')}>
            <CalendarClock size={18} className={styles['nav-icon']} />
            <span className={styles['nav-label']}>{t('sidebar.scheduled')}</span>
            <span className={styles['nav-badge']}>{scheduledCount}</span>
          </button>
        )}
      </nav>

      <div className={styles['sidebar-footer']}>
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
        <button className={styles['nav-item']} onClick={onSettings}>
          <Settings size={18} className={styles['nav-icon']} />
          <span className={styles['nav-label']}>{t('sidebar.settings')}</span>
        </button>
      </div>
    </aside>
  );
};
