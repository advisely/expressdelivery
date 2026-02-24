import { useState, useEffect, useMemo } from 'react';
import { Reply, Forward, Trash2, Star, Archive, FolderInput, Paperclip, Download, FileText, ShieldAlert } from 'lucide-react';
import DOMPurify from 'dompurify';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEmailStore } from '../stores/emailStore';
import type { Attachment, EmailFull, EmailSummary } from '../stores/emailStore';
import { ipcInvoke } from '../lib/ipc';
import { formatFileSize } from '../lib/formatFileSize';

interface ReadingPaneProps {
    onReply?: (email: EmailFull) => void;
    onForward?: (email: EmailFull) => void;
}

function extractCids(html: string): string[] {
    const cids: string[] = [];
    const regex = /src=["']cid:([^"']+)["']/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        cids.push(match[1]);
    }
    return [...new Set(cids)];
}

function replaceCids(html: string, cidMap: Record<string, string>): string {
    return html.replace(/src=["']cid:([^"']+)["']/gi, (_full, cid: string) => {
        const dataUrl = cidMap[cid];
        if (dataUrl) return `src="${dataUrl}"`;
        // HTML-encode fallback CID to prevent injection
        const safeCid = cid.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `src="cid:${safeCid}"`;
    });
}

const PLACEHOLDER_SVG = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22/%3E';

function escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function processRemoteImages(html: string, block: boolean): { html: string; count: number } {
    let count = 0;
    if (!block) return { html, count };
    const processed = html.replace(/<img\s([^>]*?)src=["'](https?:\/\/[^"']+)["']([^>]*?)>/gi, (_full, before: string, url: string, after: string) => {
        count++;
        return `<img ${before}src="${PLACEHOLDER_SVG}" data-blocked-src="${escapeAttr(url)}"${after}>`;
    });
    return { html: processed, count };
}

export const ReadingPane: React.FC<ReadingPaneProps> = ({ onReply, onForward }) => {
    const selectedEmail = useEmailStore(s => s.selectedEmail);
    const folders = useEmailStore(s => s.folders);
    const { setSelectedEmail, setEmails } = useEmailStore();
    const [actionError, setActionError] = useState<string | null>(null);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [cidMap, setCidMap] = useState<Record<string, string>>({});
    const [remoteImagesBlocked, setRemoteImagesBlocked] = useState(true);
    const [remoteImageCount, setRemoteImageCount] = useState(0);

    // Reset state on email change
    useEffect(() => {
        setAttachments([]);
        setCidMap({});
        setRemoteImagesBlocked(true);
        setRemoteImageCount(0);
        const emailId = selectedEmail?.id;
        if (!emailId || !selectedEmail?.has_attachments) return;
        let cancelled = false;
        async function loadAttachments() {
            const result = await ipcInvoke<Attachment[]>('attachments:list', emailId);
            if (result && !cancelled) setAttachments(result);
        }
        loadAttachments();
        return () => { cancelled = true; };
    }, [selectedEmail]);

    // Sanitize body_html once for CID extraction (ensures CIDs are extracted from safe HTML)
    const sanitizedBodyHtml = useMemo(() => {
        if (!selectedEmail?.body_html) return null;
        return DOMPurify.sanitize(selectedEmail.body_html, {
            FORBID_TAGS: ['style'],
            FORBID_ATTR: ['onerror', 'onload'],
            ADD_URI_SAFE_ATTR: ['src'],
        });
    }, [selectedEmail?.body_html]);

    // Resolve CID images (from sanitized HTML)
    useEffect(() => {
        const html = sanitizedBodyHtml;
        const emailId = selectedEmail?.id;
        if (!html || !emailId) return;
        const cids = extractCids(html);
        if (cids.length === 0) return;
        let cancelled = false;
        async function resolveCids() {
            const result = await ipcInvoke<Record<string, string>>('attachments:by-cid', {
                emailId,
                contentIds: cids,
            });
            if (result && !cancelled) setCidMap(result);
        }
        resolveCids();
        return () => { cancelled = true; };
    }, [sanitizedBodyHtml, selectedEmail?.id]);

    const handleDownloadAttachment = async (att: Attachment) => {
        setDownloadingId(att.id);
        try {
            const result = await ipcInvoke<{
                filename: string; mimeType: string; content: string;
            }>('attachments:download', { attachmentId: att.id, emailId: att.email_id });
            if (result) {
                await ipcInvoke('attachments:save', {
                    filename: result.filename,
                    content: result.content,
                });
            }
        } catch {
            setActionError('Failed to download attachment');
        } finally {
            setDownloadingId(null);
        }
    };

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

    // Process HTML: sanitize -> CID replace -> remote image blocking
    const { processedHtml, detectedRemoteCount } = useMemo(() => {
        if (!sanitizedBodyHtml) return { processedHtml: null, detectedRemoteCount: 0 };
        const html = replaceCids(sanitizedBodyHtml, cidMap);
        const { html: blocked, count } = processRemoteImages(html, remoteImagesBlocked);
        return { processedHtml: blocked, detectedRemoteCount: count };
    }, [sanitizedBodyHtml, cidMap, remoteImagesBlocked]);

    // Sync detected remote image count to state (separate from useMemo)
    useEffect(() => {
        setRemoteImageCount(detectedRemoteCount);
    }, [detectedRemoteCount]);

    const handleLoadRemoteImages = () => {
        setRemoteImagesBlocked(false);
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

    const movableFolders = folders.filter(f => f.id !== selectedEmail.folder_id);

    // Filter out inline CID attachments from the download list
    const downloadableAttachments = attachments.filter(a => !a.content_id);

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

                {(selectedEmail.ai_category || selectedEmail.ai_priority != null || selectedEmail.ai_labels) && (
                    <div className="rp-ai-meta-row">
                        {selectedEmail.ai_priority != null && selectedEmail.ai_priority >= 1 && selectedEmail.ai_priority <= 4 && (
                            <span className={`rp-priority-badge rp-priority-${selectedEmail.ai_priority}`}>
                                {['', 'Low', 'Normal', 'High', 'Urgent'][selectedEmail.ai_priority]}
                            </span>
                        )}
                        {selectedEmail.ai_category && (
                            <span className="rp-category-badge">{selectedEmail.ai_category}</span>
                        )}
                        {selectedEmail.ai_labels && (() => {
                            try {
                                const labels = JSON.parse(selectedEmail.ai_labels) as string[];
                                return Array.isArray(labels) ? labels.slice(0, 5).map((label, i) => (
                                    <span key={`${label}-${i}`} className="rp-label-badge">{label}</span>
                                )) : null;
                            } catch { return null; }
                        })()}
                    </div>
                )}

                {remoteImageCount > 0 && remoteImagesBlocked && (
                    <div className="remote-images-banner" role="status">
                        <ShieldAlert size={16} />
                        <span>Remote images blocked for privacy.</span>
                        <button className="load-images-btn" onClick={handleLoadRemoteImages}>Load images</button>
                    </div>
                )}

                <div className="email-body">
                    {processedHtml ? (
                        <div
                            className="email-body-html"
                            dangerouslySetInnerHTML={{ __html: processedHtml }}
                        />
                    ) : (
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                            {selectedEmail.body_text || '(no content)'}
                        </div>
                    )}
                </div>

                {downloadableAttachments.length > 0 && (
                    <div className="attachments-section">
                        <div className="attachments-header">
                            <Paperclip size={14} />
                            <span>{downloadableAttachments.length} attachment{downloadableAttachments.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="attachments-list">
                            {downloadableAttachments.map(att => (
                                <button
                                    key={att.id}
                                    className="attachment-chip"
                                    onClick={() => handleDownloadAttachment(att)}
                                    disabled={downloadingId === att.id}
                                    title={`Download ${att.filename} (${formatFileSize(att.size)})`}
                                    aria-label={`Download attachment ${att.filename}`}
                                >
                                    <FileText size={14} />
                                    <span className="attachment-name">{att.filename}</span>
                                    <span className="attachment-size">{formatFileSize(att.size)}</span>
                                    {downloadingId === att.id ? (
                                        <span className="attachment-spinner" />
                                    ) : (
                                        <Download size={14} />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
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

        .rp-ai-meta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 16px;
        }

        .rp-priority-badge {
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 4px;
        }

        .rp-priority-1 { background: rgba(var(--color-text-muted), 0.1); color: var(--text-muted); }
        .rp-priority-2 { background: rgba(var(--color-accent), 0.1); color: var(--accent-color); }
        .rp-priority-3 { background: rgba(var(--color-flag), 0.15); color: rgb(var(--color-flag)); }
        .rp-priority-4 { background: rgba(var(--color-danger), 0.15); color: rgb(var(--color-danger)); }

        .rp-category-badge {
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 4px;
          background: rgba(var(--color-accent), 0.1);
          color: var(--accent-color);
        }

        .rp-label-badge {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          background: var(--surface-overlay);
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

        .remote-images-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          margin-bottom: 16px;
          border-radius: 8px;
          background: rgba(var(--color-flag), 0.1);
          border: 1px solid rgba(var(--color-flag), 0.3);
          color: var(--text-primary);
          font-size: 13px;
        }

        .load-images-btn {
          margin-left: auto;
          padding: 4px 12px;
          border-radius: 4px;
          background: var(--accent-color);
          color: white;
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        }

        .load-images-btn:hover {
          background: var(--accent-hover);
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

        .attachments-section {
          margin-top: 24px;
          padding-top: 16px;
          border-top: 1px solid var(--glass-border);
        }

        .attachments-header {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 8px;
        }

        .attachments-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .attachment-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border-radius: 8px;
          background: var(--bg-secondary);
          border: 1px solid var(--glass-border);
          color: var(--text-primary);
          font-size: 13px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
          max-width: 280px;
        }

        .attachment-chip:hover {
          background: var(--hover-bg);
          border-color: var(--accent-color);
        }

        .attachment-chip:disabled {
          opacity: 0.6;
          cursor: wait;
        }

        .attachment-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 160px;
        }

        .attachment-size {
          color: var(--text-secondary);
          font-size: 11px;
          white-space: nowrap;
        }

        .attachment-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid var(--glass-border);
          border-top-color: var(--accent-color);
          border-radius: 50%;
          animation: attachSpin 0.6s linear infinite;
        }

        @keyframes attachSpin {
          to { transform: rotate(360deg); }
        }

        @media (prefers-reduced-motion: reduce) {
          .move-menu {
            animation: none;
          }
          .attachment-spinner {
            animation: none;
          }
        }
      `}</style>
        </div>
    );
};
