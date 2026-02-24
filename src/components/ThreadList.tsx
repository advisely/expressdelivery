import { useEffect, useCallback, useRef } from 'react';
import { Search, Paperclip } from 'lucide-react';
import { useEmailStore } from '../stores/emailStore';
import type { EmailSummary, EmailFull } from '../stores/emailStore';
import { ipcInvoke, ipcOn } from '../lib/ipc';

export const ThreadList: React.FC = () => {
    const emails = useEmailStore(s => s.emails);
    const selectedFolderId = useEmailStore(s => s.selectedFolderId);
    const selectedEmailId = useEmailStore(s => s.selectedEmailId);
    const searchQuery = useEmailStore(s => s.searchQuery);
    const setSearchQuery = useEmailStore(s => s.setSearchQuery);
    const setEmails = useEmailStore(s => s.setEmails);
    const selectEmail = useEmailStore(s => s.selectEmail);
    const setSelectedEmail = useEmailStore(s => s.setSelectedEmail);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => {
        return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
    }, []);

    useEffect(() => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        if (!selectedFolderId) return;
        ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId)
            .then(result => { if (result) setEmails(result); });
    }, [selectedFolderId, setEmails]);

    useEffect(() => {
        const cleanup = ipcOn('email:new', () => {
            if (selectedFolderId) {
                ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId)
                    .then(result => { if (result) setEmails(result); });
            }
        });
        return () => { cleanup?.(); };
    }, [selectedFolderId, setEmails]);

    const handleSearch = useCallback((query: string) => {
        setSearchQuery(query);
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(async () => {
            if (query.trim().length > 1) {
                const results = await ipcInvoke<EmailSummary[]>('emails:search', query);
                if (results) setEmails(results);
            } else if (selectedFolderId) {
                const result = await ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId);
                if (result) setEmails(result);
            }
        }, 300);
    }, [selectedFolderId, setEmails, setSearchQuery]);

    const handleSelectEmail = useCallback(async (emailId: string) => {
        selectEmail(emailId);
        const full = await ipcInvoke<EmailFull>('emails:read', emailId);
        if (full) setSelectedEmail(full);
    }, [selectEmail, setSelectedEmail]);

    return (
        <div className="thread-list scrollable">
            <div className="thread-list-header glass">
                <div className="search-bar">
                    <Search size={16} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search emails..."
                        className="search-input"
                        value={searchQuery}
                        onChange={(e) => handleSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className="thread-items animate-fade-in">
                {emails.length === 0 && (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                        {selectedFolderId ? 'No emails in this folder' : 'Select a folder'}
                    </div>
                )}
                {emails.map((thread) => (
                    <div
                        key={thread.id}
                        role="button"
                        tabIndex={0}
                        className={`thread-item ${!thread.is_read ? 'unread' : ''} ${selectedEmailId === thread.id ? 'selected' : ''}`}
                        onClick={() => handleSelectEmail(thread.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectEmail(thread.id); } }}
                    >
                        <div className="thread-item-header">
                            <span className="sender">{thread.from_name || thread.from_email}</span>
                            <span className="thread-meta">
                                {thread.ai_priority != null && thread.ai_priority >= 3 && (
                                    <span
                                        className={`tl-priority-badge tl-priority-${thread.ai_priority}`}
                                        aria-label={thread.ai_priority === 4 ? 'Urgent priority' : 'High priority'}
                                    >
                                        {thread.ai_priority === 4 ? '!!' : '!'}
                                    </span>
                                )}
                                {thread.ai_category && (
                                    <span className="tl-category-badge" aria-label={`Category: ${thread.ai_category}`}>
                                        {thread.ai_category}
                                    </span>
                                )}
                                {thread.has_attachments === 1 && (
                                    <Paperclip size={12} className="attachment-indicator" aria-label="Has attachments" />
                                )}
                                <span className="date">{thread.date ? new Date(thread.date).toLocaleDateString() : ''}</span>
                            </span>
                        </div>
                        <div className="subject">{thread.subject}</div>
                        <div className="snippet">{thread.snippet}</div>
                        {!thread.is_read && <div className="unread-dot" />}
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
          background: var(--hover-bg-subtle);
        }

        .thread-item.selected {
          background: rgba(var(--color-accent), 0.08);
          border-left: 3px solid var(--accent-color);
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

        .thread-meta {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .attachment-indicator {
          color: var(--text-secondary);
          flex-shrink: 0;
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

        .tl-priority-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 4px;
          line-height: 1;
          flex-shrink: 0;
        }

        .tl-priority-3 {
          background: rgba(var(--color-flag), 0.15);
          color: rgb(var(--color-flag));
        }

        .tl-priority-4 {
          background: rgba(var(--color-danger), 0.15);
          color: rgb(var(--color-danger));
        }

        .tl-category-badge {
          font-size: 10px;
          font-weight: 600;
          padding: 1px 6px;
          border-radius: 4px;
          background: rgba(var(--color-accent), 0.1);
          color: var(--accent-color);
          text-transform: lowercase;
          max-width: 80px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex-shrink: 0;
        }
      `}</style>
        </div>
    );
};
