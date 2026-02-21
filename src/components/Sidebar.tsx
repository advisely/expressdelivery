import React from 'react';
import {
  Inbox,
  Send,
  FileText,
  Archive,
  Trash2,
  Settings,
  Plus
} from 'lucide-react';

const navItems = [
  { icon: Inbox, label: 'Inbox', count: 12, active: true },
  { icon: Send, label: 'Sent', count: 0 },
  { icon: FileText, label: 'Drafts', count: 3 },
  { icon: Archive, label: 'Archive', count: 0 },
  { icon: Trash2, label: 'Trash', count: 0 },
];

interface SidebarProps {
  onCompose: () => void;
  onSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onCompose, onSettings }) => {
  return (
    <aside className="sidebar glass">
      <div className="sidebar-header">
        <div className="account-selector">
          <div className="avatar">A</div>
          <div className="account-info">
            <span className="account-name">Personal</span>
            <span className="account-email">alex@example.com</span>
          </div>
        </div>
      </div>

      <div className="compose-wrapper">
        <button className="compose-btn" onClick={onCompose}>
          <Plus size={18} />
          <span>New Message</span>
        </button>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.label}
            className={`nav-item ${item.active ? 'active' : ''}`}
          >
            <item.icon size={18} className="nav-icon" />
            <span className="nav-label">{item.label}</span>
            {item.count > 0 && (
              <span className="nav-badge">{item.count}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
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
        }
        
        .account-selector:hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--accent-color);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
        }

        .account-info {
          display: flex;
          flex-direction: column;
        }

        .account-name {
          font-weight: 500;
          font-size: 14px;
        }

        .account-email {
          font-size: 12px;
          color: var(--text-secondary);
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
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
        }

        .nav-item.active {
          background: rgba(59, 130, 246, 0.15);
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
      `}</style>
    </aside>
  );
};
