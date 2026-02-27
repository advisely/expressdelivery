import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { Search, Paperclip, Trash2, Reply, Forward, Star, FolderInput, Mail, MailOpen, Inbox as InboxIcon, CheckCircle2, Send as SendIcon, CheckSquare, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEmailStore } from '../stores/emailStore';
import type { EmailSummary, EmailFull } from '../stores/emailStore';
import { ipcInvoke, ipcOn } from '../lib/ipc';
import styles from './ThreadList.module.css';

interface ThreadItemProps {
    thread: EmailSummary;
    isSelected: boolean;
    isChecked: boolean;
    hasAnyChecked: boolean;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    onToggleCheck: (id: string, e: React.MouseEvent) => void;
    onContextMenu: (e: React.MouseEvent, thread: EmailSummary) => void;
}

const ThreadItem = memo<ThreadItemProps>(({ thread, isSelected, isChecked, hasAnyChecked, onSelect, onDelete, onToggleCheck, onContextMenu }) => (
    <div
        role="button"
        tabIndex={0}
        className={`${styles['thread-item']} ${!thread.is_read ? styles['unread'] : ''} ${isSelected ? styles['selected'] : ''} ${isChecked ? styles['checked'] : ''} ${hasAnyChecked ? styles['show-checks'] : ''}`}
        onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey) { onToggleCheck(thread.id, e); } else { onSelect(thread.id); } }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(thread.id); } }}
        onContextMenu={(e) => onContextMenu(e, thread)}
    >
        <button
            type="button"
            className={styles['check-btn']}
            onClick={(e) => { e.stopPropagation(); onToggleCheck(thread.id, e); }}
            aria-label={isChecked ? 'Deselect email' : 'Select email'}
        >
            {isChecked ? <CheckSquare size={16} /> : <Square size={16} />}
        </button>
        <div className={styles['thread-item-body']}>
            <div className={styles['thread-item-header']}>
                <span className={styles['sender']}>{thread.from_name || thread.from_email}</span>
                <span className={styles['thread-meta']}>
                    {thread.ai_priority != null && thread.ai_priority >= 3 && (
                        <span
                            className={`${styles['tl-priority-badge']} ${styles[`tl-priority-${thread.ai_priority}`]}`}
                            aria-label={thread.ai_priority === 4 ? 'Urgent priority' : 'High priority'}
                        >
                            {thread.ai_priority === 4 ? '!!' : '!'}
                        </span>
                    )}
                    {thread.ai_category && (
                        <span className={styles['tl-category-badge']} aria-label={`Category: ${thread.ai_category}`}>
                            {thread.ai_category}
                        </span>
                    )}
                    {thread.has_attachments === 1 && (
                        <Paperclip size={12} className={styles['attachment-indicator']} aria-label="Has attachments" />
                    )}
                    <span className={styles['date-col']}>
                        <span className={styles['date']}>{thread.date ? new Date(thread.date).toLocaleDateString() : ''}</span>
                        <button
                            className={styles['thread-delete-btn']}
                            onClick={(e) => { e.stopPropagation(); onDelete(thread.id); }}
                            title="Delete"
                            aria-label="Delete email"
                            type="button"
                        >
                            <Trash2 size={14} />
                        </button>
                    </span>
                </span>
            </div>
            <div className={styles['subject']}>
                {thread.subject}
                {thread.thread_count != null && thread.thread_count > 1 && (
                    <span className={styles['thread-badge']} aria-label={`${thread.thread_count} messages in thread`}>
                        {thread.thread_count}
                    </span>
                )}
            </div>
            {thread.snippet && thread.snippet !== thread.subject && (
                <div className={styles['snippet']}>{thread.snippet}</div>
            )}
        </div>
        {!thread.is_read && <div className={styles['unread-dot']} />}
    </div>
));

interface ContextMenuState {
    x: number;
    y: number;
    email: EmailSummary;
}

interface ThreadListProps {
    onReply?: (email: EmailFull) => void;
    onForward?: (email: EmailFull) => void;
}

export const ThreadList: React.FC<ThreadListProps> = ({ onReply, onForward }) => {
    const { t } = useTranslation();
    const emails = useEmailStore(s => s.emails);
    const folders = useEmailStore(s => s.folders);
    const selectedFolderId = useEmailStore(s => s.selectedFolderId);
    const selectedEmailId = useEmailStore(s => s.selectedEmailId);
    const selectedEmailIds = useEmailStore(s => s.selectedEmailIds);
    const searchQuery = useEmailStore(s => s.searchQuery);
    const setSearchQuery = useEmailStore(s => s.setSearchQuery);
    const setEmails = useEmailStore(s => s.setEmails);
    const selectEmail = useEmailStore(s => s.selectEmail);
    const setSelectedEmail = useEmailStore(s => s.setSelectedEmail);
    const toggleSelectEmail = useEmailStore(s => s.toggleSelectEmail);
    const selectEmailRange = useEmailStore(s => s.selectEmailRange);
    const selectAllEmails = useEmailStore(s => s.selectAllEmails);
    const clearSelection = useEmailStore(s => s.clearSelection);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
    const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);
    const [showBulkMove, setShowBulkMove] = useState(false);
    const ctxRef = useRef<HTMLDivElement>(null);

    const hasSelection = selectedEmailIds.size > 0;

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
        // Optimistic mark-as-read update so the unread dot disappears immediately
        const target = emails.find(e => e.id === emailId);
        if (target && !target.is_read) {
            setEmails(emails.map(e => e.id === emailId ? { ...e, is_read: 1 } : e));
        }
        const full = await ipcInvoke<EmailFull>('emails:read', emailId);
        if (full) setSelectedEmail(full);
    }, [emails, selectEmail, setEmails, setSelectedEmail]);

    // Close context menu on click outside or Escape
    useEffect(() => {
        if (!ctxMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
        };
        const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null); };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEsc);
        return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', handleEsc); };
    }, [ctxMenu]);

    const handleToggleCheck = useCallback((id: string, e: React.MouseEvent) => {
        if (e.shiftKey) {
            selectEmailRange(id);
        } else {
            toggleSelectEmail(id);
        }
    }, [toggleSelectEmail, selectEmailRange]);

    const refreshList = useCallback(async () => {
        if (selectedFolderId) {
            const refreshed = await ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId);
            if (refreshed) setEmails(refreshed);
        }
    }, [selectedFolderId, setEmails]);

    const handleBulkDelete = useCallback(async () => {
        const ids = [...selectedEmailIds];
        if (ids.length === 0) return;
        for (const id of ids) {
            await ipcInvoke('emails:delete', id);
        }
        if (selectedEmailIds.has(useEmailStore.getState().selectedEmailId ?? '')) {
            setSelectedEmail(null);
        }
        clearSelection();
        await refreshList();
    }, [selectedEmailIds, setSelectedEmail, clearSelection, refreshList]);

    const handleBulkMarkRead = useCallback(async () => {
        const ids = [...selectedEmailIds];
        if (ids.length === 0) return;
        for (const id of ids) {
            await ipcInvoke('emails:mark-read', id);
        }
        setEmails(emails.map(e => selectedEmailIds.has(e.id) ? { ...e, is_read: 1 } : e));
        clearSelection();
    }, [selectedEmailIds, emails, setEmails, clearSelection]);

    const handleBulkMarkUnread = useCallback(async () => {
        const ids = [...selectedEmailIds];
        if (ids.length === 0) return;
        for (const id of ids) {
            await ipcInvoke('emails:mark-unread', id);
        }
        setEmails(emails.map(e => selectedEmailIds.has(e.id) ? { ...e, is_read: 0 } : e));
        clearSelection();
    }, [selectedEmailIds, emails, setEmails, clearSelection]);

    const handleBulkStar = useCallback(async () => {
        const ids = [...selectedEmailIds];
        if (ids.length === 0) return;
        for (const id of ids) {
            await ipcInvoke('emails:toggle-flag', id, true);
        }
        setEmails(emails.map(e => selectedEmailIds.has(e.id) ? { ...e, is_flagged: 1 } : e));
        clearSelection();
    }, [selectedEmailIds, emails, setEmails, clearSelection]);

    const handleBulkMove = useCallback(async (destFolderId: string) => {
        const ids = [...selectedEmailIds];
        if (ids.length === 0) return;
        for (const id of ids) {
            await ipcInvoke('emails:move', { emailId: id, destFolderId });
        }
        if (selectedEmailIds.has(useEmailStore.getState().selectedEmailId ?? '')) {
            setSelectedEmail(null);
        }
        clearSelection();
        setShowBulkMove(false);
        await refreshList();
    }, [selectedEmailIds, setSelectedEmail, clearSelection, refreshList]);

    const handleContextMenu = useCallback((e: React.MouseEvent, thread: EmailSummary) => {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, email: thread });
        setShowMoveSubmenu(false);
    }, []);

    const ctxAction = useCallback(async (action: string) => {
        if (!ctxMenu) return;
        const { email } = ctxMenu;
        setCtxMenu(null);

        switch (action) {
            case 'reply':
            case 'forward': {
                const full = await ipcInvoke<EmailFull>('emails:read', email.id);
                if (full) {
                    setSelectedEmail(full);
                    selectEmail(email.id);
                    if (action === 'reply' && onReply) onReply(full);
                    if (action === 'forward' && onForward) onForward(full);
                }
                break;
            }
            case 'delete': {
                const result = await ipcInvoke<{ success: boolean }>('emails:delete', email.id);
                if (result?.success) {
                    if (useEmailStore.getState().selectedEmailId === email.id) setSelectedEmail(null);
                    if (selectedFolderId) {
                        const refreshed = await ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId);
                        if (refreshed) setEmails(refreshed);
                    }
                }
                break;
            }
            case 'star': {
                await ipcInvoke('emails:toggle-flag', email.id, !email.is_flagged);
                setEmails(emails.map(e => e.id === email.id ? { ...e, is_flagged: email.is_flagged ? 0 : 1 } : e));
                break;
            }
            case 'toggle-read': {
                if (email.is_read) {
                    await ipcInvoke('emails:mark-unread', email.id);
                } else {
                    await ipcInvoke('emails:mark-read', email.id);
                }
                setEmails(emails.map(e => e.id === email.id ? { ...e, is_read: email.is_read ? 0 : 1 } : e));
                break;
            }
        }
    }, [ctxMenu, emails, selectedFolderId, setEmails, setSelectedEmail, selectEmail, onReply, onForward]);

    const handleMoveToFolder = useCallback(async (destFolderId: string) => {
        if (!ctxMenu) return;
        const result = await ipcInvoke<{ success: boolean }>('emails:move', { emailId: ctxMenu.email.id, destFolderId });
        setCtxMenu(null);
        if (result?.success && selectedFolderId) {
            const refreshed = await ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId);
            if (refreshed) setEmails(refreshed);
        }
    }, [ctxMenu, selectedFolderId, setEmails]);

    const movableFolders = folders.filter(f => f.id !== selectedFolderId);

    const handleDeleteEmail = useCallback(async (emailId: string) => {
        const result = await ipcInvoke<{ success: boolean }>('emails:delete', emailId);
        if (result?.success) {
            if (useEmailStore.getState().selectedEmailId === emailId) {
                setSelectedEmail(null);
            }
            if (selectedFolderId) {
                const refreshed = await ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId);
                if (refreshed) setEmails(refreshed);
            }
        }
    }, [selectedFolderId, setEmails, setSelectedEmail]);

    return (
        <div className={`${styles['thread-list']} scrollable`}>
            <div className={`${styles['thread-list-header']} glass`}>
                {hasSelection ? (
                    <div className={styles['bulk-toolbar']}>
                        <span className={styles['bulk-count']}>
                            {t('threadList.selected', { count: selectedEmailIds.size })}
                        </span>
                        <button
                            type="button"
                            className={styles['bulk-btn']}
                            onClick={() => selectAllEmails()}
                            title={t('threadList.selectAll')}
                        >
                            <CheckSquare size={14} /> {t('threadList.selectAll')}
                        </button>
                        <button
                            type="button"
                            className={styles['bulk-btn']}
                            onClick={handleBulkMarkRead}
                            title={t('threadList.markRead')}
                        >
                            <MailOpen size={14} />
                        </button>
                        <button
                            type="button"
                            className={styles['bulk-btn']}
                            onClick={handleBulkMarkUnread}
                            title={t('threadList.markUnread')}
                        >
                            <Mail size={14} />
                        </button>
                        <button
                            type="button"
                            className={styles['bulk-btn']}
                            onClick={handleBulkStar}
                            title={t('threadList.star')}
                        >
                            <Star size={14} />
                        </button>
                        <div className={styles['bulk-move-wrap']}>
                            <button
                                type="button"
                                className={styles['bulk-btn']}
                                onClick={() => setShowBulkMove(!showBulkMove)}
                                title={t('readingPane.moveTo')}
                            >
                                <FolderInput size={14} />
                            </button>
                            {showBulkMove && (
                                <div className={styles['bulk-move-dropdown']}>
                                    {movableFolders.map(f => (
                                        <button key={f.id} className={styles['ctx-item']} onClick={() => handleBulkMove(f.id)}>
                                            {f.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            className={`${styles['bulk-btn']} ${styles['bulk-danger']}`}
                            onClick={handleBulkDelete}
                            title={t('readingPane.delete')}
                        >
                            <Trash2 size={14} />
                        </button>
                        <button
                            type="button"
                            className={styles['bulk-btn']}
                            onClick={clearSelection}
                            title={t('threadList.clearSelection')}
                        >
                            &times;
                        </button>
                    </div>
                ) : (
                    <div className={styles['search-bar']}>
                        <Search size={16} className={styles['search-icon']} />
                        <input
                            type="text"
                            placeholder={t('threadList.search')}
                            className={styles['search-input']}
                            value={searchQuery}
                            onChange={(e) => handleSearch(e.target.value)}
                        />
                    </div>
                )}
            </div>

            <div className={`${styles['thread-items']} animate-fade-in`}>
                {emails.length === 0 && (
                    <div className={styles['empty-state']}>
                        {(() => {
                            const folder = folders.find(f => f.id === selectedFolderId);
                            const ftype = folder?.type ?? '';
                            const icon = ftype === 'inbox' ? <InboxIcon size={40} /> :
                                          ftype === 'trash' ? <Trash2 size={40} /> :
                                          ftype === 'sent' ? <SendIcon size={40} /> :
                                          <CheckCircle2 size={40} />;
                            const msg = ftype === 'inbox' ? t('threadList.emptyInbox') :
                                        ftype === 'trash' ? t('threadList.emptyTrash') :
                                        ftype === 'sent' ? t('threadList.emptySent') :
                                        ftype === 'drafts' ? t('threadList.emptyDrafts') :
                                        searchQuery ? t('threadList.noResults') :
                                        t('threadList.noEmails');
                            return (
                                <>
                                    <div className={styles['empty-icon']}>{icon}</div>
                                    <p>{msg}</p>
                                </>
                            );
                        })()}
                    </div>
                )}
                {emails.map((thread) => (
                    <ThreadItem
                        key={thread.id}
                        thread={thread}
                        isSelected={selectedEmailId === thread.id}
                        isChecked={selectedEmailIds.has(thread.id)}
                        hasAnyChecked={hasSelection}
                        onSelect={handleSelectEmail}
                        onDelete={handleDeleteEmail}
                        onToggleCheck={handleToggleCheck}
                        onContextMenu={handleContextMenu}
                    />
                ))}
            </div>

            {/* Right-click context menu */}
            {ctxMenu && (
                <div
                    ref={ctxRef}
                    className={styles['ctx-menu']}
                    style={{ top: ctxMenu.y, left: ctxMenu.x }}
                >
                    <button className={styles['ctx-item']} onClick={() => ctxAction('reply')}>
                        <Reply size={14} /> <span>{t('readingPane.reply')}</span>
                    </button>
                    <button className={styles['ctx-item']} onClick={() => ctxAction('forward')}>
                        <Forward size={14} /> <span>{t('readingPane.forward')}</span>
                    </button>
                    <div className={styles['ctx-separator']} />
                    <button className={styles['ctx-item']} onClick={() => ctxAction('star')}>
                        <Star size={14} /> <span>{ctxMenu.email.is_flagged ? t('threadList.unstar') : t('threadList.star')}</span>
                    </button>
                    <button className={styles['ctx-item']} onClick={() => ctxAction('toggle-read')}>
                        {ctxMenu.email.is_read ? <Mail size={14} /> : <MailOpen size={14} />}
                        <span>{ctxMenu.email.is_read ? t('threadList.markUnread') : t('threadList.markRead')}</span>
                    </button>
                    <div className={styles['ctx-separator']} />
                    <button
                        className={styles['ctx-item']}
                        onClick={() => setShowMoveSubmenu(!showMoveSubmenu)}
                    >
                        <FolderInput size={14} /> <span>{t('readingPane.moveTo')}</span>
                    </button>
                    {showMoveSubmenu && movableFolders.length > 0 && (
                        <div className={styles['ctx-submenu']}>
                            {movableFolders.map(f => (
                                <button key={f.id} className={styles['ctx-item']} onClick={() => handleMoveToFolder(f.id)}>
                                    {f.name}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className={styles['ctx-separator']} />
                    <button className={`${styles['ctx-item']} ${styles['ctx-danger']}`} onClick={() => ctxAction('delete')}>
                        <Trash2 size={14} /> <span>{t('readingPane.delete')}</span>
                    </button>
                </div>
            )}
        </div>
    );
};
