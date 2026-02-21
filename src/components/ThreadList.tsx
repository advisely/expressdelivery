import React from 'react';
import { Search } from 'lucide-react';

const mockThreads = [
    {
        id: 1,
        sender: 'GitHub',
        subject: '[expressdelivery] Action Required',
        snippet: 'You have a new mention in the PR #42...',
        date: '10:42 AM',
        unread: true,
    },
    {
        id: 2,
        sender: 'Vite Team',
        subject: 'Release 5.0 is out!',
        snippet: 'Read about the new features in Vite 5.0...',
        date: 'Yesterday',
        unread: false,
    },
    {
        id: 3,
        sender: 'Alice Cooper',
        subject: 'Project Sync',
        snippet: 'Hey, are we still on for the sync tomorrow?',
        date: 'Oct 12',
        unread: false,
    },
];

export const ThreadList: React.FC = () => {
    return (
        <div className="thread-list scrollable">
            <div className="thread-list-header glass">
                <div className="search-bar">
                    <Search size={16} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search emails..."
                        className="search-input"
                    />
                </div>
            </div>

            <div className="thread-items animate-fade-in">
                {mockThreads.map((thread) => (
                    <div key={thread.id} className={`thread-item ${thread.unread ? 'unread' : ''}`}>
                        <div className="thread-item-header">
                            <span className="sender">{thread.sender}</span>
                            <span className="date">{thread.date}</span>
                        </div>
                        <div className="subject">{thread.subject}</div>
                        <div className="snippet">{thread.snippet}</div>
                        {thread.unread && <div className="unread-dot" />}
                    </div>
                ))}
            </div>

            <style>{`
        .thread-list {
          width: var(--thread-list-width);
          border-right: 1px solid var(--glass-border);
          background: var(--bg-secondary);
          display: flex;
          flex-direction: column;
          position: relative;
        }

        .thread-list-header {
          padding: 16px;
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .search-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-primary);
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--glass-border);
        }

        .search-icon {
          color: var(--text-secondary);
        }

        .search-input {
          border: none;
          background: transparent;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 14px;
          width: 100%;
          outline: none;
        }

        .search-input::placeholder {
          color: var(--text-secondary);
        }

        .thread-item {
          padding: 16px;
          border-bottom: 1px solid var(--glass-border);
          cursor: pointer;
          position: relative;
          transition: background 0.2s ease;
        }

        .thread-item:hover {
          background: rgba(255, 255, 255, 0.02);
        }

        .thread-item.unread .sender {
          font-weight: 700;
          color: var(--text-primary);
        }

        .thread-item.unread .subject {
          font-weight: 600;
          color: var(--text-primary);
        }

        .thread-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }

        .sender {
          font-size: 14px;
          color: var(--text-secondary);
        }

        .date {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .subject {
          font-size: 14px;
          color: var(--text-secondary);
          margin-bottom: 4px;
        }

        .snippet {
          font-size: 13px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .unread-dot {
          position: absolute;
          top: 20px;
          left: 6px;
          width: 6px;
          height: 6px;
          background: var(--accent-color);
          border-radius: 50%;
        }
      `}</style>
        </div>
    );
};
