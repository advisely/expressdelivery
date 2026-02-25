import { useState, useEffect, useMemo } from 'react';
import { Reply, Forward, Trash2, Star, Archive, FolderInput, Paperclip, Download, FileText, ShieldAlert, Clock, Bell } from 'lucide-react';
import DOMPurify from 'dompurify';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { useTranslation } from 'react-i18next';
import { useEmailStore } from '../stores/emailStore';
import type { Attachment, EmailFull, EmailSummary } from '../stores/emailStore';
import { ipcInvoke } from '../lib/ipc';
import { formatFileSize } from '../lib/formatFileSize';
import DateTimePicker from './DateTimePicker';
import styles from './ReadingPane.module.css';

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
    const { t } = useTranslation();
    const selectedEmail = useEmailStore(s => s.selectedEmail);
    const folders = useEmailStore(s => s.folders);
    const { setSelectedEmail, setEmails } = useEmailStore();
    const [actionError, setActionError] = useState<string | null>(null);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [cidMap, setCidMap] = useState<Record<string, string>>({});
    const [remoteImagesBlocked, setRemoteImagesBlocked] = useState(true);
    const [remoteImageCount, setRemoteImageCount] = useState(0);
    const [snoozeOpen, setSnoozeOpen] = useState(false);
    const [reminderOpen, setReminderOpen] = useState(false);
    const [threadEmails, setThreadEmails] = useState<EmailFull[]>([]);

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

    // Fetch thread messages when a threaded email is selected
    useEffect(() => {
        setThreadEmails([]);
        const threadId = selectedEmail?.thread_id;
        if (!threadId) return;
        let cancelled = false;
        ipcInvoke<EmailFull[]>('emails:thread', threadId).then(result => {
            if (!cancelled && result && result.length > 1) setThreadEmails(result);
        });
        return () => { cancelled = true; };
    }, [selectedEmail?.id, selectedEmail?.thread_id]);

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

    const handleSnooze = async (snoozeUntil: string) => {
        if (!selectedEmail) return;
        setActionError(null);
        setSnoozeOpen(false);
        try {
            const result = await ipcInvoke<{ success: boolean }>('emails:snooze', {
                emailId: selectedEmail.id,
                snoozeUntil,
            });
            if (result?.success) {
                setSelectedEmail(null);
                await refreshEmailList();
            }
        } catch {
            setActionError('Failed to snooze email');
        }
    };

    const handleReminder = async (remindAt: string) => {
        if (!selectedEmail) return;
        setActionError(null);
        setReminderOpen(false);
        try {
            await ipcInvoke<{ success: boolean }>('reminders:create', {
                emailId: selectedEmail.id,
                remindAt,
            });
        } catch {
            setActionError('Failed to set reminder');
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
            <div className={styles['reading-pane-empty']}>
                {t('readingPane.noSelection')}
            </div>
        );
    }

    const initial = (selectedEmail.from_name || selectedEmail.from_email || '?').charAt(0).toUpperCase() || '?';

    const movableFolders = folders.filter(f => f.id !== selectedEmail.folder_id);

    // Filter out inline CID attachments from the download list
    const downloadableAttachments = attachments.filter(a => !a.content_id);

    return (
        <div className={`${styles['reading-pane']} scrollable`}>
            <div className={`${styles['pane-header']} glass`}>
                {actionError && (
                    <div className={styles['reading-pane-error']} role="alert">{actionError}</div>
                )}
                <div className={styles.actions}>
                    <button
                        className={styles['icon-btn']}
                        title={t('readingPane.reply')}
                        aria-label={t('readingPane.reply')}
                        onClick={() => onReply?.(selectedEmail)}
                    >
                        <Reply size={18} />
                    </button>
                    <button
                        className={styles['icon-btn']}
                        title={t('readingPane.forward')}
                        aria-label={t('readingPane.forward')}
                        onClick={() => onForward?.(selectedEmail)}
                    >
                        <Forward size={18} />
                    </button>
                    <button
                        className={styles['icon-btn']}
                        title={t('readingPane.delete')}
                        aria-label={t('readingPane.delete')}
                        onClick={handleDelete}
                    >
                        <Trash2 size={18} />
                    </button>
                    <button className={styles['icon-btn']} title={t('readingPane.archive')} aria-label={t('readingPane.archive')} onClick={handleArchive}>
                        <Archive size={18} />
                    </button>
                    <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                            <button className={styles['icon-btn']} title={t('readingPane.moveTo')} aria-label={t('readingPane.moveTo')}>
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
                        className={`${styles['icon-btn']}${selectedEmail.is_flagged ? ` ${styles['flag-active']}` : ''}`}
                        title={selectedEmail.is_flagged ? t('readingPane.unstar') : t('readingPane.star')}
                        aria-label={selectedEmail.is_flagged ? t('readingPane.unstar') : t('readingPane.star')}
                        onClick={handleToggleFlag}
                    >
                        <Star
                            size={18}
                            fill={selectedEmail.is_flagged ? 'currentColor' : 'none'}
                        />
                    </button>
                    <Popover.Root open={snoozeOpen} onOpenChange={setSnoozeOpen}>
                        <Popover.Trigger asChild>
                            <button className={styles['icon-btn']} title={t('readingPane.snooze')} aria-label={t('readingPane.snooze')}>
                                <Clock size={18} />
                            </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                            <Popover.Content className="rp-popover" sideOffset={5} align="start">
                                <DateTimePicker
                                    label="Snooze until"
                                    onSelect={handleSnooze}
                                    onCancel={() => setSnoozeOpen(false)}
                                />
                            </Popover.Content>
                        </Popover.Portal>
                    </Popover.Root>
                    <Popover.Root open={reminderOpen} onOpenChange={setReminderOpen}>
                        <Popover.Trigger asChild>
                            <button className={styles['icon-btn']} title={t('readingPane.reminder')} aria-label={t('readingPane.reminder')}>
                                <Bell size={18} />
                            </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                            <Popover.Content className="rp-popover" sideOffset={5} align="start">
                                <DateTimePicker
                                    label="Remind me"
                                    onSelect={handleReminder}
                                    onCancel={() => setReminderOpen(false)}
                                />
                            </Popover.Content>
                        </Popover.Portal>
                    </Popover.Root>
                </div>
            </div>

            <div className={`${styles['email-content']} animate-fade-in`}>
                <h1 className={styles['subject-title']}>{selectedEmail.subject}</h1>

                <div className={styles['email-meta']}>
                    <div className={styles.avatar}>{initial}</div>
                    <div className={styles['meta-info']}>
                        <div className={styles['sender-row']}>
                            <span className={styles['sender-name']}>{selectedEmail.from_name}</span>
                            <span className={styles['sender-email']}>&lt;{selectedEmail.from_email}&gt;</span>
                        </div>
                        <div className={styles['to-row']}>
                            <span className={styles['to-label']}>to {selectedEmail.to_email}</span>
                        </div>
                    </div>
                    <div className={styles['date-time']}>
                        {selectedEmail.date ? new Date(selectedEmail.date).toLocaleString() : ''}
                    </div>
                </div>

                {(selectedEmail.ai_category || selectedEmail.ai_priority != null || selectedEmail.ai_labels) && (
                    <div className={styles['rp-ai-meta-row']}>
                        {selectedEmail.ai_priority != null && selectedEmail.ai_priority >= 1 && selectedEmail.ai_priority <= 4 && (
                            <span className={`${styles['rp-priority-badge']} ${styles[`rp-priority-${selectedEmail.ai_priority}`]}`}>
                                {['', 'Low', 'Normal', 'High', 'Urgent'][selectedEmail.ai_priority]}
                            </span>
                        )}
                        {selectedEmail.ai_category && (
                            <span className={styles['rp-category-badge']}>{selectedEmail.ai_category}</span>
                        )}
                        {selectedEmail.ai_labels && (() => {
                            try {
                                const labels = JSON.parse(selectedEmail.ai_labels) as string[];
                                return Array.isArray(labels) ? labels.slice(0, 5).map((label, i) => (
                                    <span key={`${label}-${i}`} className={styles['rp-label-badge']}>{label}</span>
                                )) : null;
                            } catch { return null; }
                        })()}
                    </div>
                )}

                {remoteImageCount > 0 && remoteImagesBlocked && (
                    <div className={styles['remote-images-banner']} role="status">
                        <ShieldAlert size={16} />
                        <span>{t('readingPane.remoteImagesBlocked')}</span>
                        <button className={styles['load-images-btn']} onClick={handleLoadRemoteImages}>{t('readingPane.loadImages')}</button>
                    </div>
                )}

                {threadEmails.length > 1 ? (
                    <div className={styles['thread-conversation']}>
                        {threadEmails.map((te, i) => (
                            <div
                                key={te.id}
                                className={styles['thread-message']}
                                style={i > 0 ? { borderTop: '1px solid var(--glass-border)' } : undefined}
                            >
                                <div className={styles['thread-message-header']}>
                                    <strong>{te.from_name || te.from_email}</strong>
                                    <span className={styles['thread-message-date']}>
                                        {te.date ? new Date(te.date).toLocaleString() : ''}
                                    </span>
                                </div>
                                <div
                                    className={styles['email-body']}
                                    dangerouslySetInnerHTML={{
                                        __html: DOMPurify.sanitize(te.body_html || te.body_text || '', {
                                            FORBID_TAGS: ['style'],
                                            FORBID_ATTR: ['onerror', 'onload'],
                                        }),
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className={styles['email-body']}>
                        {processedHtml ? (
                            <div
                                className={styles['email-body-html']}
                                dangerouslySetInnerHTML={{ __html: processedHtml }}
                            />
                        ) : (
                            <div style={{ whiteSpace: 'pre-wrap' }}>
                                {selectedEmail.body_text || '(no content)'}
                            </div>
                        )}
                    </div>
                )}

                {downloadableAttachments.length > 0 && (
                    <div className={styles['attachments-section']}>
                        <div className={styles['attachments-header']}>
                            <Paperclip size={14} />
                            <span>{downloadableAttachments.length} attachment{downloadableAttachments.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className={styles['attachments-list']}>
                            {downloadableAttachments.map(att => (
                                <button
                                    key={att.id}
                                    className={styles['attachment-chip']}
                                    onClick={() => handleDownloadAttachment(att)}
                                    disabled={downloadingId === att.id}
                                    title={`Download ${att.filename} (${formatFileSize(att.size)})`}
                                    aria-label={`Download attachment ${att.filename}`}
                                >
                                    <FileText size={14} />
                                    <span className={styles['attachment-name']}>{att.filename}</span>
                                    <span className={styles['attachment-size']}>{formatFileSize(att.size)}</span>
                                    {downloadingId === att.id ? (
                                        <span className={styles['attachment-spinner']} />
                                    ) : (
                                        <Download size={14} />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
