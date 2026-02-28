import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Reply, Forward, Trash2, Star, Archive, FolderInput, Paperclip, Download, FileText, ShieldAlert, AlertTriangle, Clock, Bell, Printer, ZoomIn, ZoomOut, Code, Mail } from 'lucide-react';
import DOMPurify from 'dompurify';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { useTranslation } from 'react-i18next';
import { useEmailStore } from '../stores/emailStore';
import type { Attachment, EmailFull, EmailSummary, Tag } from '../stores/emailStore';
import { useThemeStore } from '../stores/themeStore';
import { ipcInvoke } from '../lib/ipc';
import { formatFileSize } from '../lib/formatFileSize';
import { detectPhishing } from '../lib/phishingDetector';
import DateTimePicker from './DateTimePicker';
import { MessageSourceDialog } from './MessageSourceDialog';
import styles from './ReadingPane.module.css';

// Track which emails the user has consented to show remote images for.
// Persists across email switches within the same app session.
const allowedRemoteImageEmails = new Set<string>();
/** @internal — exposed for test cleanup only */
// eslint-disable-next-line react-refresh/only-export-components
export function _resetAllowedRemoteImages() { allowedRemoteImageEmails.clear(); }

interface ReadingPaneProps {
    onReply?: (email: EmailFull) => void;
    onForward?: (email: EmailFull) => void;
    onToast?: (message: string, undo?: () => void) => void;
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

// DOMPurify configs — email HTML is rendered inside a sandboxed iframe for style isolation,
// so <style> tags are safe (cannot bleed into app chrome or exfiltrate via @import).
// <link> is still forbidden to prevent external stylesheet loading.
const PURIFY_CONFIG = {
    FORBID_TAGS: ['link'],
    FORBID_ATTR: ['onerror', 'onload'],
    ADD_URI_SAFE_ATTR: ['src'],
};

// Thread view uses same sanitization config
const PURIFY_CONFIG_THREAD = PURIFY_CONFIG;

function escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function processRemoteImages(html: string, block: boolean): { html: string; count: number } {
    let count = 0;
    if (!block) return { html, count };
    // Block remote src= URLs
    let processed = html.replace(/<img\s([^>]*?)src=["'](https?:\/\/[^"']+)["']([^>]*?)>/gi, (_full, before: string, url: string, after: string) => {
        count++;
        return `<img ${before}src="${PLACEHOLDER_SVG}" data-blocked-src="${escapeAttr(url)}"${after}>`;
    });
    // Block remote srcset= URLs
    processed = processed.replace(/(<img\s[^>]*?)srcset=["']([^"']+)["']/gi, (_full, before: string, srcset: string) => {
        const hasRemote = /https?:\/\//i.test(srcset);
        if (hasRemote) {
            count++;
            return `${before}data-blocked-srcset="${escapeAttr(srcset)}"`;
        }
        return _full;
    });
    return { html: processed, count };
}

// Wrap sanitized email HTML in a minimal document for iframe srcdoc.
// SECURITY: sandbox="allow-scripts" (no allow-same-origin) prevents parent DOM access.
// The only script is our injected ResizeObserver that posts height via postMessage.
// @param sanitizedBodyHtml — MUST be DOMPurify-sanitized before calling.
// @param allowRemoteImages — when true, adds https: to img-src CSP (user consented).
function buildIframeSrcdoc(sanitizedBodyHtml: string, allowRemoteImages = false): string {
    const imgSrc = allowRemoteImages ? 'img-src data: https:;' : 'img-src data:;';
    return [
        '<!DOCTYPE html><html><head>',
        '<meta charset="utf-8">',
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; ${imgSrc} frame-ancestors 'none';">`,
        '<style>',
        'body{margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;',
        'font-size:14px;line-height:1.6;color:#1a1a1a;background:#fff;',
        'word-wrap:break-word;overflow-wrap:break-word}',
        'img{max-width:100%;height:auto}table{max-width:100%}a{color:#4f46e5}',
        '</style>',
        '<script>new ResizeObserver(function(){',
        'window.parent.postMessage({type:"iframe-height",height:document.body.scrollHeight},"*");',
        '}).observe(document.body);</script>',
        '</head><body>',
        sanitizedBodyHtml,
        '</body></html>',
    ].join('');
}

// HTML-escape plain text for safe rendering inside iframe <pre> block
function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Sandboxed iframe for rendering email HTML — provides complete style isolation.
// Uses postMessage for height resize (no allow-same-origin needed).
const SandboxedEmailBody = React.memo(function SandboxedEmailBody({
    html,
    allowRemoteImages = false,
}: {
    html: string;
    allowRemoteImages?: boolean;
}) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [contentHeight, setContentHeight] = useState(0);

    const srcdoc = useMemo(
        () => buildIframeSrcdoc(html, allowRemoteImages),
        [html, allowRemoteImages],
    );

    useEffect(() => {
        function handleMessage(e: MessageEvent) {
            if (
                e.source === iframeRef.current?.contentWindow &&
                e.data?.type === 'iframe-height' &&
                typeof e.data.height === 'number'
            ) {
                setContentHeight(e.data.height + 16);
            }
        }
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Use the larger of content height or remaining viewport space
    // The iframe's top position determines available space below it
    const [minHeight, setMinHeight] = useState(300);
    useEffect(() => {
        function measure() {
            const el = iframeRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            // Fill from iframe top to bottom of viewport, minus 24px margin
            setMinHeight(Math.max(window.innerHeight - rect.top - 24, 200));
        }
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

    const height = Math.max(contentHeight, minHeight);

    return (
        <iframe
            ref={iframeRef}
            sandbox="allow-scripts"
            srcDoc={srcdoc}
            style={{ height }}
            className={styles['email-iframe']}
            title="Email content"
        />
    );
});

export const ReadingPane: React.FC<ReadingPaneProps> = ({ onReply, onForward, onToast }) => {
    const { t } = useTranslation();
    const selectedEmail = useEmailStore(s => s.selectedEmail);
    const folders = useEmailStore(s => s.folders);
    const tags = useEmailStore(s => s.tags);
    const { setSelectedEmail, setEmails } = useEmailStore();
    const readingPaneZoom = useThemeStore(s => s.readingPaneZoom);
    const setReadingPaneZoom = useThemeStore(s => s.setReadingPaneZoom);
    const [actionError, setActionError] = useState<string | null>(null);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [cidMap, setCidMap] = useState<Record<string, string>>({});
    const [remoteImagesBlocked, setRemoteImagesBlocked] = useState(true);
    const [snoozeOpen, setSnoozeOpen] = useState(false);
    const [reminderOpen, setReminderOpen] = useState(false);
    const [threadEmails, setThreadEmails] = useState<EmailFull[]>([]);
    const [emailTags, setEmailTags] = useState<Tag[]>([]);
    const [showTagPicker, setShowTagPicker] = useState(false);
    const tagPickerRef = useRef<HTMLDivElement | null>(null);
    const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
    const [emailSource, setEmailSource] = useState('');
    const [sourceLoading, setSourceLoading] = useState(false);
    const [unsubInfo, setUnsubInfo] = useState<{
        hasUnsubscribe: boolean;
        urls?: Array<{ type: 'mailto' | 'http'; url: string }>;
    } | null>(null);
    const [unsubCopied, setUnsubCopied] = useState(false);

    // Reset state on email change — restore remote image preference if previously allowed
    useEffect(() => {
        setAttachments([]);
        setCidMap({});
        setRemoteImagesBlocked(selectedEmail?.id ? !allowedRemoteImageEmails.has(selectedEmail.id) : true);
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

    // Load tags for the current email
    useEffect(() => {
        setEmailTags([]);
        setShowTagPicker(false);
        const emailId = selectedEmail?.id;
        if (!emailId) return;
        let cancelled = false;
        ipcInvoke<Tag[]>('emails:tags', emailId).then(result => {
            if (Array.isArray(result) && !cancelled) setEmailTags(result);
        });
        return () => { cancelled = true; };
    }, [selectedEmail?.id]);

    // Close tag picker on click outside
    useEffect(() => {
        if (!showTagPicker) return;
        function handleClick(e: MouseEvent) {
            if (tagPickerRef.current && !tagPickerRef.current.contains(e.target as Node)) {
                setShowTagPicker(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showTagPicker]);

    // Fetch unsubscribe info when email changes
    useEffect(() => {
        setUnsubInfo(null);
        setUnsubCopied(false);
        const emailId = selectedEmail?.id;
        if (!emailId) return;
        let cancelled = false;
        ipcInvoke<{ hasUnsubscribe: boolean; urls?: Array<{ type: 'mailto' | 'http'; url: string }> }>(
            'emails:unsubscribe-info', emailId
        ).then(result => {
            if (!cancelled && result) setUnsubInfo(result);
        });
        return () => { cancelled = true; };
    }, [selectedEmail?.id]);

    // Sanitize body_html once for CID extraction (ensures CIDs are extracted from safe HTML)
    const sanitizedBodyHtml = useMemo(() => {
        if (!selectedEmail?.body_html) return null;
        return DOMPurify.sanitize(selectedEmail.body_html, PURIFY_CONFIG);
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
                onToast?.(t('readingPane.emailDeleted'));
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
                onToast?.(t('readingPane.emailArchived'));
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
                onToast?.(t('readingPane.emailMoved'));
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

    // Phishing detection — run heuristics against the raw (pre-sanitize) HTML so
    // that all href URLs are still present before DOMPurify may remove them.
    const phishingResult = useMemo(() => {
        return detectPhishing(selectedEmail?.body_html ?? null);
    }, [selectedEmail?.body_html]);

    const handleLoadRemoteImages = () => {
        setRemoteImagesBlocked(false);
        if (selectedEmail?.id) {
            allowedRemoteImageEmails.add(selectedEmail.id);
        }
    };

    const handleViewSource = async () => {
        if (!selectedEmail) return;
        setSourceLoading(true);
        setEmailSource('');
        setSourceDialogOpen(true);
        try {
            const result = await ipcInvoke<{ source?: string; error?: string }>(
                'emails:source', selectedEmail.id, selectedEmail.account_id
            );
            if (result?.source) {
                setEmailSource(result.source);
            } else {
                setEmailSource(result?.error ?? t('messageSource.loading'));
            }
        } catch {
            setEmailSource('Failed to fetch message source');
        } finally {
            setSourceLoading(false);
        }
    };

    const handleUnsubscribeCopy = async (url: string) => {
        await navigator.clipboard.writeText(url);
        setUnsubCopied(true);
        setTimeout(() => setUnsubCopied(false), 2000);
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
        <>
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
                    <button
                        className={styles['icon-btn']}
                        title={t('readingPane.print')}
                        aria-label={t('readingPane.print')}
                        onClick={() => ipcInvoke('print:email')}
                    >
                        <Printer size={18} />
                    </button>
                    <button
                        className={styles['icon-btn']}
                        title={t('spam.reportSpam')}
                        aria-label={t('spam.reportSpam')}
                        onClick={async () => {
                            if (!selectedEmail) return;
                            await ipcInvoke('spam:train', selectedEmail.account_id, selectedEmail.id, true);
                            onToast?.(t('spam.trainedSpam'));
                        }}
                    >
                        <ShieldAlert size={18} />
                    </button>
                    <button
                        className={styles['icon-btn']}
                        title={t('readingPane.saveAsEml')}
                        aria-label={t('readingPane.saveAsEml')}
                        onClick={() => ipcInvoke('export:eml', selectedEmail.id)}
                    >
                        <Download size={18} />
                    </button>
                    <button
                        className={styles['icon-btn']}
                        title={t('messageSource.viewSource')}
                        aria-label={t('messageSource.viewSource')}
                        onClick={handleViewSource}
                        disabled={sourceLoading}
                    >
                        <Code size={18} />
                    </button>
                    <button
                        className={styles['icon-btn']}
                        onClick={() => setReadingPaneZoom(readingPaneZoom - 10)}
                        title={t('readingPane.zoomOut')}
                        aria-label={t('readingPane.zoomOut')}
                        disabled={readingPaneZoom <= 80}
                    >
                        <ZoomOut size={18} />
                    </button>
                    <span className={styles['zoom-label']}>{readingPaneZoom}%</span>
                    <button
                        className={styles['icon-btn']}
                        onClick={() => setReadingPaneZoom(readingPaneZoom + 10)}
                        title={t('readingPane.zoomIn')}
                        aria-label={t('readingPane.zoomIn')}
                        disabled={readingPaneZoom >= 150}
                    >
                        <ZoomIn size={18} />
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

                {(emailTags.length > 0 || tags.length > 0) && (
                    <div className={styles['rp-tags-row']} ref={tagPickerRef}>
                        {emailTags.map(tag => (
                            <span
                                key={tag.id}
                                className={styles['rp-tag-badge']}
                                style={{ backgroundColor: `${tag.color}20`, color: tag.color, borderColor: `${tag.color}40` }}
                            >
                                {tag.name}
                                <button
                                    type="button"
                                    className={styles['rp-tag-remove']}
                                    aria-label={t('tags.remove')}
                                    onClick={async () => {
                                        await ipcInvoke('tags:remove', selectedEmail!.id, tag.id);
                                        setEmailTags(emailTags.filter(et => et.id !== tag.id));
                                    }}
                                >
                                    &times;
                                </button>
                            </span>
                        ))}
                        {tags.length > 0 && (
                            <button
                                type="button"
                                className={styles['rp-tag-add']}
                                onClick={() => setShowTagPicker(!showTagPicker)}
                            >
                                + {t('tags.assign')}
                            </button>
                        )}
                        {showTagPicker && (
                            <div className={styles['rp-tag-picker']}>
                                {tags.filter(t => !emailTags.some(et => et.id === t.id)).map(tag => (
                                    <button
                                        key={tag.id}
                                        type="button"
                                        className={styles['rp-tag-option']}
                                        onClick={async () => {
                                            await ipcInvoke('tags:assign', selectedEmail!.id, tag.id);
                                            setEmailTags([...emailTags, tag]);
                                            setShowTagPicker(false);
                                        }}
                                    >
                                        <span className={styles['rp-tag-dot']} style={{ backgroundColor: tag.color }} />
                                        {tag.name}
                                    </button>
                                ))}
                                {tags.filter(t => !emailTags.some(et => et.id === t.id)).length === 0 && (
                                    <span className={styles['rp-tag-empty']}>{t('tags.noTags')}</span>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {detectedRemoteCount > 0 && remoteImagesBlocked && (
                    <div className={styles['remote-images-banner']} role="status">
                        <ShieldAlert size={16} />
                        <span>{t('readingPane.remoteImagesBlocked')}</span>
                        <button className={styles['load-images-btn']} onClick={handleLoadRemoteImages}>{t('readingPane.loadImages')}</button>
                    </div>
                )}

                {unsubInfo?.hasUnsubscribe && unsubInfo.urls && unsubInfo.urls.length > 0 && (
                    <div className={styles['unsubscribe-banner']} role="status">
                        <Mail size={16} aria-hidden="true" />
                        <span className={styles['unsubscribe-text']}>{t('unsubscribe.banner')}</span>
                        {unsubInfo.urls.map((urlObj, i) => {
                            if (urlObj.type === 'mailto') {
                                // Extract and validate email address from mailto: URL
                                const rawRecipient = urlObj.url.replace(/^mailto:/i, '').split('?')[0];
                                const recipient = rawRecipient.trim();
                                // Only copy if it looks like a valid email address
                                if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return null;
                                return (
                                    <button
                                        key={i}
                                        type="button"
                                        className={styles['unsubscribe-btn']}
                                        onClick={() => handleUnsubscribeCopy(recipient)}
                                        title={recipient}
                                    >
                                        {unsubCopied ? t('unsubscribe.copied') : t('unsubscribe.mailto')}
                                    </button>
                                );
                            }
                            // Only allow https: URLs; http: and other schemes are rejected
                            if (!urlObj.url.startsWith('https://')) return null;
                            return (
                                <button
                                    key={i}
                                    type="button"
                                    className={styles['unsubscribe-copy-btn']}
                                    onClick={() => handleUnsubscribeCopy(urlObj.url)}
                                >
                                    {unsubCopied ? t('unsubscribe.copied') : t('unsubscribe.copyLink')}
                                </button>
                            );
                        })}
                    </div>
                )}

                {phishingResult.isPhishing && (
                    <div className={styles['phishing-banner']} role="alert">
                        <AlertTriangle size={16} aria-hidden="true" />
                        <div>
                            <strong>{t('phishing.warning')}</strong>
                            <ul className={styles['phishing-reasons']}>
                                {phishingResult.reasons.slice(0, 3).map((r, i) => (
                                    <li key={i}>{r}</li>
                                ))}
                            </ul>
                        </div>
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
                                {te.body_html ? (
                                    <SandboxedEmailBody
                                        html={DOMPurify.sanitize(te.body_html, PURIFY_CONFIG_THREAD)}
                                    />
                                ) : te.body_text ? (
                                    <SandboxedEmailBody
                                        html={`<pre style="white-space:pre-wrap;margin:0">${escapeHtml(te.body_text)}</pre>`}
                                    />
                                ) : (
                                    <div className={styles['email-body']}>(no content)</div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className={styles['email-body']}>
                        {processedHtml ? (
                            <div style={{ zoom: readingPaneZoom / 100 }}>
                                <SandboxedEmailBody html={processedHtml} allowRemoteImages={!remoteImagesBlocked} />
                            </div>
                        ) : selectedEmail.body_text ? (
                            <div style={{ whiteSpace: 'pre-wrap' }}>
                                {selectedEmail.body_text}
                            </div>
                        ) : (
                            <div style={{ whiteSpace: 'pre-wrap', color: 'rgba(var(--color-text), 0.5)', fontStyle: 'italic' }}>
                                {selectedEmail.bodyFetchStatus === 'imap_disconnected'
                                    ? t('readingPane.imapDisconnected', 'Could not load email — IMAP disconnected. Reconnecting...')
                                    : selectedEmail.bodyFetchStatus === 'timeout'
                                        ? t('readingPane.bodyTimeout', 'Could not load email body — request timed out.')
                                        : selectedEmail.bodyFetchStatus === 'no_parts'
                                            ? t('readingPane.noParts', 'This email has no readable content.')
                                            : t('readingPane.noContent', '(no content)')}
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

        <MessageSourceDialog
            open={sourceDialogOpen}
            onOpenChange={setSourceDialogOpen}
            source={emailSource}
            subject={selectedEmail.subject ?? ''}
        />
        </>
    );
};
