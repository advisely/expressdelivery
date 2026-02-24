import { useState } from 'react';
import { Reply, Forward, Trash2, Star, Archive, FolderInput } from 'lucide-react';
import DOMPurify from 'dompurify';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEmailStore } from '../stores/emailStore';
import type { EmailFull, EmailSummary } from '../stores/emailStore';
import { ipcInvoke } from '../lib/ipc';

interface ReadingPaneProps {
    onReply?: (email: EmailFull) => void;
    onForward?: (email: EmailFull) => void;
}

export const ReadingPane: React.FC<ReadingPaneProps> = ({ onReply, onForward }) => {
    const selectedEmail = useEmailStore(s => s.selectedEmail);
    const folders = useEmailStore(s => s.folders);
    const { setSelectedEmail, setEmails } = useEmailStore();
    const [actionError, setActionError] = useState<string | null>(null);

    const refreshEmailList = async () => {
        const folderId = useEmailStore.getState().selectedFolderId;
        if (folderId) {
            const emails = await ipcInvoke<EmailSummary[]>('emails:list', folderId);
            if (emails) setEmails(emails);
        }
    };

    const handleDelete = async () => {
        if (!selectedEmail) return;
        setActionError(null);
        try {
            const result = await ipcInvoke<{ success: boolean }>('emails:delete', selectedEmail.id);
            if (result?.success) {
                setSelectedEmail(null);
                await refreshEmailList();
            }
        } catch {
            setActionError('Failed to delete email');
        }
    };

    const handleToggleFlag = async () => {
        if (!selectedEmail) return;
        setActionError(null);
        try {
            const newFlagged = !selectedEmail.is_flagged;
            await ipcInvoke('emails:toggle-flag', selectedEmail.id, newFlagged);
            setSelectedEmail({ ...selectedEmail, is_flagged: newFlagged ? 1 : 0 });
        } catch {
            setActionError('Failed to toggle flag');
        }
    };

    const handleArchive = async () => {
        if (!selectedEmail) return;
        setActionError(null);
        try {
            const result = await ipcInvoke<{ success: boolean }>('emails:archive', selectedEmail.id);
            if (result?.success) {
                setSelectedEmail(null);
                await refreshEmailList();
            }
        } catch {
            setActionError('Failed to archive email');
        }
    };

    const handleMove = async (destFolderId: string) => {
        if (!selectedEmail) return;
        setActionError(null);
        try {
            const result = await ipcInvoke<{ success: boolean }>('emails:move', {
                emailId: selectedEmail.id,
                destFolderId,
            });
            if (result?.success) {
                setSelectedEmail(null);
                await refreshEmailList();
            }
        } catch {
            setActionError('Failed to move email');
        }
    };

    if (!selectedEmail) {
        return (
            <div className="reading-pane" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)', fontSize: 16
            }}>
                Select an email to read
                <style>{`
                    .reading-pane {
                      flex: 1;
                      display: flex;
                      flex-direction: column;
                      background: var(--bg-primary);
                    }
                `}</style>
            </div>
        );
    }

    const initial = (selectedEmail.from_name || selectedEmail.from_email || '?').charAt(0).toUpperCase() || '?';

    const sanitizedHtml = selectedEmail.body_html
        ? DOMPurify.sanitize(selectedEmail.body_html, {
              FORBID_TAGS: ['style'],
              FORBID_ATTR: ['onerror', 'onload'],
          })
        : null;

    const movableFolders = folders.filter(f => f.id !== selectedEmail.folder_id);

    return (
        <div className="reading-pane scrollable">
            <div className="pane-header glass">
                {actionError && (
                    <div className="reading-pane-error" role="alert">{actionError}</div>
                )}
                <div className="actions">
                    <button
                        className="icon-btn"
                        title="Reply"
                        aria-label="Reply"
                        onClick={() => onReply?.(selectedEmail)}
                    >
                        <Reply size={18} />
                    </button>
                    <button
                        className="icon-btn"
                        title="Forward"
                        aria-label="Forward"
                        onClick={() => onForward?.(selectedEmail)}
                    >
                        <Forward size={18} />
                    </button>
                    <button
                        className="icon-btn"
                        title="Delete"
                        aria-label="Delete"
                        onClick={handleDelete}
                    >
                        <Trash2 size={18} />
                    </button>
                    <button className="icon-btn" title="Archive (E)" aria-label="Archive" onClick={handleArchive}>
                        <Archive size={18} />
                    </button>
                    <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                            <button className="icon-btn" title="Move to folder" aria-label="Move to folder">
                                <FolderInput size={18} />
                            </button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                            <DropdownMenu.Content className="move-menu" sideOffset={5} align="start">
                                {movableFolders.map(folder => (
                                    <DropdownMenu.Item
                                        key={folder.id}
                                        className="move-menu-item"
                                        onSelect={() => handleMove(folder.id)}
                                    >
                                        {folder.name}
                                    </DropdownMenu.Item>
                                ))}
                                {movableFolders.length === 0 && (
                                    <DropdownMenu.Item className="move-menu-item" disabled>
                                        No other folders
                                    </DropdownMenu.Item>
                                )}
                            </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                    <button
                        className={`icon-btn${selectedEmail.is_flagged ? ' flag-active' : ''}`}
                        title={selectedEmail.is_flagged ? 'Unflag' : 'Flag'}
                        aria-label={selectedEmail.is_flagged ? 'Unflag' : 'Flag'}
                        onClick={handleToggleFlag}
                    >
                        <Star
                            size={18}
                            fill={selectedEmail.is_flagged ? 'currentColor' : 'none'}
                        />
                    </button>
                </div>
            </div>

            <div className="email-content animate-fade-in">
                <h1 className="subject-title">{selectedEmail.subject}</h1>

                <div className="email-meta">
                    <div className="avatar">{initial}</div>
                    <div className="meta-info">
                        <div className="sender-row">
                            <span className="sender-name">{selectedEmail.from_name}</span>
                            <span className="sender-email">&lt;{selectedEmail.from_email}&gt;</span>
                        </div>
                        <div className="to-row">
                            <span className="to-label">to {selectedEmail.to_email}</span>
                        </div>
                    </div>
                    <div className="date-time">
                        {selectedEmail.date ? new Date(selectedEmail.date).toLocaleString() : ''}
                    </div>
                </div>

                <div className="email-body">
                    {sanitizedHtml ? (
                        <div
                            className="email-body-html"
                            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                        />
                    ) : (
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                            {selectedEmail.body_text || '(no content)'}
                        </div>
                    )}
                </div>
            </div>

            <style>{`
        .reading-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg-primary);
        }

        .pane-header {
          padding: 12px 24px;
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          border-bottom: 1px solid var(--glass-border);
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .actions {
          display: flex;
          gap: 8px;
        }

        .icon-btn {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          color: var(--text-secondary);
          transition: background 0.15s, color 0.15s;
        }

        .icon-btn:hover {
          background: var(--hover-bg);
          color: var(--text-primary);
        }

        .flag-active {
          color: rgb(var(--color-flag));
          fill: rgb(var(--color-flag));
        }

        .reading-pane-error {
          padding: 6px 24px;
          color: rgb(var(--color-danger));
          font-size: 13px;
        }

        .email-content {
          padding: 32px 48px;
          max-width: 800px;
        }

        .subject-title {
          font-size: 24px;
          font-weight: 600;
          margin-bottom: 24px;
          color: var(--text-primary);
        }

        .email-meta {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 32px;
        }

        .avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: var(--bg-tertiary);
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          font-weight: 500;
        }

        .meta-info {
          flex: 1;
        }

        .sender-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }

        .sender-name {
          font-weight: 600;
          font-size: 15px;
        }

        .sender-email {
          color: var(--text-secondary);
          font-size: 13px;
        }

        .to-row {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .date-time {
          font-size: 13px;
          color: var(--text-secondary);
        }

        .email-body {
          font-size: 15px;
          line-height: 1.6;
          color: var(--text-primary);
        }

        .email-body-html {
          font-size: 14px;
          line-height: 1.6;
          color: var(--text-primary);
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        .email-body-html a {
          color: var(--accent-color);
        }

        .email-body-html img {
          max-width: 100%;
          height: auto;
        }

        .email-body-html table {
          max-width: 100%;
          overflow-x: auto;
        }

        .action-button {
          background: var(--accent-color);
          color: white;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 500;
          font-size: 14px;
        }

        .action-button:hover {
          background: var(--accent-hover);
        }

        .move-menu {
          min-width: 180px;
          background: rgb(var(--color-bg-elevated));
          border-radius: 8px;
          padding: 4px;
          box-shadow: 0 10px 38px -10px rgba(0,0,0,0.35), 0 10px 20px -15px rgba(0,0,0,0.2);
          border: 1px solid var(--glass-border);
          z-index: 100;
          animation: menuFadeIn 0.15s ease-out;
        }

        .move-menu-item {
          padding: 8px 12px;
          border-radius: 4px;
          font-size: 13px;
          color: var(--text-primary);
          cursor: pointer;
          outline: none;
          user-select: none;
        }

        .move-menu-item[data-highlighted] {
          background: var(--hover-bg);
          color: var(--text-primary);
        }

        .move-menu-item[data-disabled] {
          color: var(--text-muted);
          cursor: default;
        }

        @keyframes menuFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .move-menu {
            animation: none;
          }
        }
      `}</style>
        </div>
    );
};
