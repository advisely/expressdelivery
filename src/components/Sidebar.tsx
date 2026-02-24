import React, { useState, useEffect } from 'react';
import {
  Inbox,
  Send,
  FileText,
  Archive,
  Trash2,
  Settings,
  Plus,
  ChevronDown
} from 'lucide-react';
import { useEmailStore } from '../stores/emailStore';
import { getProviderIcon } from '../lib/providerIcons';
import { ipcInvoke, ipcOn } from '../lib/ipc';

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
  const { accounts, folders, selectedFolderId, selectFolder, selectedAccountId, selectAccount } = useEmailStore();
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [mcpCount, setMcpCount] = useState(0);

  const activeAccount = accounts.find(a => a.id === selectedAccountId) ?? accounts[0];

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
    loadCounts();

    const api = (window as unknown as { electronAPI?: { on: (ch: string, cb: (...args: unknown[]) => void) => () => void } }).electronAPI;
    const unsub = api?.on('email:new', () => { loadCounts(); });

    return () => { cancelled = true; unsub?.(); };
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

  return (
    <aside className="sidebar glass">
      <div className="sidebar-header">
        <button
          className="account-selector"
          onClick={() => { if (accounts.length > 1) setShowAccountPicker(!showAccountPicker); }}
          aria-expanded={accounts.length > 1 ? showAccountPicker : undefined}
          aria-label="Switch account"
        >
          <div className="avatar-icon">
            {React.createElement(getProviderIcon(activeAccount?.provider ?? 'custom'), { size: 20 })}
          </div>
          <div className="account-info">
            <span className="account-name">{activeAccount?.display_name ?? 'Personal'}</span>
            <span className="account-email">{activeAccount?.email ?? 'No account'}</span>
          </div>
          {accounts.length > 1 && <ChevronDown size={14} className="account-chevron" />}
        </button>

        {showAccountPicker && accounts.length > 1 && (
          <div className="account-picker">
            {accounts.map(acc => {
              const AccIcon = getProviderIcon(acc.provider);
              return (
                <button
                  key={acc.id}
                  className={`account-picker-item ${acc.id === selectedAccountId ? 'active' : ''}`}
                  onClick={() => {
                    selectAccount(acc.id);
                    setShowAccountPicker(false);
                  }}
                >
                  <div className="avatar-icon-sm"><AccIcon size={16} /></div>
                  <div className="account-info">
                    <span className="account-name">{acc.display_name ?? acc.email}</span>
                    <span className="account-email">{acc.email}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="compose-wrapper">
        <button className="compose-btn" onClick={onCompose}>
          <Plus size={18} />
          <span>New Message</span>
        </button>
      </div>

      <nav className="sidebar-nav">
        {folders.length > 0
          ? folders.map((folder) => {
              const Icon = FOLDER_ICONS[folder.type ?? ''] ?? Inbox;
              const count = unreadCounts[folder.id];
              return (
                <button
                  key={folder.id}
                  className={`nav-item ${selectedFolderId === folder.id ? 'active' : ''}`}
                  onClick={() => selectFolder(folder.id)}
                >
                  <Icon size={18} className="nav-icon" />
                  <span className="nav-label">{folder.name}</span>
                  {count != null && count > 0 && (
                    <span className="nav-badge">{count > 99 ? '99+' : count}</span>
                  )}
                </button>
              );
            })
          : DEFAULT_NAV.map((item) => (
              <button key={item.label} className="nav-item">
                <item.icon size={18} className="nav-icon" />
                <span className="nav-label">{item.label}</span>
              </button>
            ))
        }
      </nav>

      <div className="sidebar-footer">
        <div className="mcp-status" aria-label={`${mcpCount} AI agent${mcpCount !== 1 ? 's' : ''} connected`}>
          <div className={`mcp-dot ${mcpCount > 0 ? 'connected' : ''}`} />
          <span className="mcp-label">
            {mcpCount > 0 ? `${mcpCount} AI agent${mcpCount !== 1 ? 's' : ''}` : 'No AI connected'}
          </span>
        </div>
        <button className="nav-item" onClick={onSettings}>
          <Settings size={18} className="nav-icon" />
          <span className="nav-label">Settings</span>
        </button>
      </div>

      <style>{`
        .sidebar {
          width: var(--sidebar-width);
          height: 100vh;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--glass-border);
        }

        .sidebar-header {
          padding: 20px 16px;
        }

        .account-selector {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.2s ease;
          width: 100%;
          text-align: left;
        }

        .account-selector:hover {
          background: var(--hover-bg);
        }

        .avatar-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: var(--surface-overlay);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .avatar-icon-sm {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          background: var(--surface-overlay);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .account-info {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          flex: 1;
          min-width: 0;
        }

        .account-name {
          font-weight: 500;
          font-size: 14px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .account-email {
          font-size: 12px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .account-chevron {
          color: var(--text-secondary);
          flex-shrink: 0;
        }

        .account-picker {
          margin-top: 4px;
          padding: 4px;
          border-radius: 8px;
          background: var(--surface-overlay);
          border: 1px solid var(--glass-border);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .account-picker-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          border-radius: 6px;
          width: 100%;
          text-align: left;
          color: var(--text-primary);
        }

        .account-picker-item:hover {
          background: var(--hover-bg);
        }

        .account-picker-item.active {
          background: rgba(var(--color-accent), 0.1);
        }

        .compose-wrapper {
          padding: 0 16px 16px;
        }

        .compose-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: var(--accent-color);
          color: white;
          padding: 10px;
          border-radius: 8px;
          font-weight: 500;
        }

        .compose-btn:hover {
          background: var(--accent-hover);
          transform: translateY(-1px);
        }

        .sidebar-nav {
          flex: 1;
          padding: 0 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
          width: 100%;
          border-radius: 6px;
          color: var(--text-secondary);
        }

        .nav-item:hover {
          background: var(--hover-bg);
          color: var(--text-primary);
        }

        .nav-item.active {
          background: rgba(var(--color-accent), 0.15);
          color: var(--accent-color);
        }

        .nav-label {
          flex: 1;
          text-align: left;
          font-size: 14px;
          font-weight: 500;
        }

        .nav-badge {
          background: var(--accent-color);
          color: white;
          font-size: 11px;
          padding: 2px 6px;
          border-radius: 10px;
          font-weight: 600;
        }

        .sidebar-footer {
          padding: 16px 8px;
        }

        .mcp-status {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          margin-bottom: 4px;
          font-size: 12px;
          color: var(--text-muted);
        }

        .mcp-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-muted);
          transition: background 0.3s;
          flex-shrink: 0;
        }

        .mcp-dot.connected {
          background: rgb(var(--color-success));
        }

        .mcp-label {
          font-size: 12px;
        }
      `}</style>
    </aside>
  );
};
