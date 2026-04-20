import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { Search, Paperclip, Trash2, Reply, Forward, Star, FolderInput, Mail, MailOpen, Inbox as InboxIcon, CheckCircle2, Send as SendIcon, CheckSquare, Square, Bookmark } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEmailStore } from '../stores/emailStore';
import type { EmailSummary, EmailFull, SavedSearch, Account } from '../stores/emailStore';
import { useThemeStore } from '../stores/themeStore';
import { ipcInvoke, ipcOn } from '../lib/ipc';
import { getProviderIcon } from '../lib/providerIcons';
import styles from './ThreadList.module.css';

interface ThreadItemProps {
    thread: EmailSummary;
    isSelected: boolean;
    isChecked: boolean;
    hasAnyChecked: boolean;
    isUnified: boolean;
    showPreview: boolean;
    isEntering: boolean;
    isExiting: boolean;
    accounts: Account[];
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    onToggleCheck: (id: string, e: React.MouseEvent) => void;
    onContextMenu: (e: React.MouseEvent, thread: EmailSummary) => void;
    onDragStart: (e: React.DragEvent, threadId: string) => void;
    onDragEnd: () => void;
}

const ThreadItem = memo<ThreadItemProps>(({ thread, isSelected, isChecked, hasAnyChecked, isUnified, showPreview, isEntering, isExiting, accounts, onSelect, onDelete, onToggleCheck, onContextMenu, onDragStart, onDragEnd }) => (
    <div
        role="button"
        tabIndex={0}
        draggable
        data-thread-id={thread.id}
        className={`${styles['thread-item']} ${!thread.is_read ? styles['unread'] : ''} ${isSelected ? styles['selected'] : ''} ${isChecked ? styles['checked'] : ''} ${hasAnyChecked ? styles['show-checks'] : ''} ${isEntering ? styles['thread-item-entering'] : ''} ${isExiting ? styles['thread-item-exiting'] : ''}`}
        onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey) { onToggleCheck(thread.id, e); } else { onSelect(thread.id); } }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(thread.id); } }}
        onContextMenu={(e) => onContextMenu(e, thread)}
        onDragStart={(e) => onDragStart(e, thread.id)}
        onDragEnd={onDragEnd}
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
                <span className={styles['sender']}>
                    {thread.from_name || thread.from_email}
                    {isUnified && thread.account_id && (() => {
                        const acct = accounts.find(a => a.id === thread.account_id);
                        if (!acct) return null;
                        const ProviderIcon = getProviderIcon(acct.provider);
                        return (
                            <span
                                className={styles['tl-account-badge']}
                                title={acct.email}
                                aria-label={`From account: ${acct.email}`}
                            >
                                <ProviderIcon size={12} />
                            </span>
                        );
                    })()}
                </span>
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
            {showPreview && thread.snippet && thread.snippet !== thread.subject && (
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
    const isLoading = useEmailStore(s => s.isLoading);
    const setLoading = useEmailStore(s => s.setLoading);
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
    const accounts = useEmailStore(s => s.accounts);
    const selectedAccountId = useEmailStore(s => s.selectedAccountId);
    const setContextAccountId = useEmailStore(s => s.setContextAccountId);
    const savedSearches = useEmailStore(s => s.savedSearches);
    const setSavedSearches = useEmailStore(s => s.setSavedSearches);
    const setDraggedEmailIds = useEmailStore(s => s.setDraggedEmailIds);
    const showThreadPreview = useThemeStore(s => s.showThreadPreview);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
    const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);
    const [showBulkMove, setShowBulkMove] = useState(false);
    const [enteringIds, setEnteringIds] = useState<Set<string>>(() => new Set());
    const exitingEmailIds = useEmailStore(s => s.exitingEmailIds);
    const markEmailsExiting = useEmailStore(s => s.markEmailsExiting);
    const unmarkEmailsExiting = useEmailStore(s => s.unmarkEmailsExiting);
    const enterTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
    const ctxRef = useRef<HTMLDivElement>(null);

    const hasSelection = selectedEmailIds.size > 0;

    // Cleanup outstanding animation timers on unmount. No folder-switch reset
    // is needed: stale IDs from a previous folder never match the new folder's
    // email IDs (so no class is applied) and self-clean via the 400ms timer.
    useEffect(() => {
        const timers = enterTimersRef.current;
        return () => { timers.forEach(clearTimeout); timers.clear(); };
    }, []);

    // Apply a brief enter-animation pulse to a freshly-arrived set of email IDs.
    // Called from the email:new IPC handler (an async event callback, not an
    // effect body) so it doesn't trip react-hooks/set-state-in-effect.
    const flagAsEntering = useCallback((newIds: string[]) => {
        if (newIds.length === 0) return;
        setEnteringIds(prev => {
            const next = new Set(prev);
            newIds.forEach(id => next.add(id));
            return next;
        });
        const timer = setTimeout(() => {
            enterTimersRef.current.delete(timer);
            setEnteringIds(prev => {
                const next = new Set(prev);
                newIds.forEach(id => next.delete(id));
                return next;
            });
        }, 400);
        enterTimersRef.current.add(timer);
    }, []);

    useEffect(() => {
        return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
    }, []);

    useEffect(() => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        if (!selectedFolderId) return;
        setLoading(true);
        ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId)
            .then(result => {
                if (Array.isArray(result)) setEmails(result);
                // Trigger background IMAP sync for this folder, then refresh if new emails arrived
                ipcInvoke<{ success: boolean; synced?: number }>('folders:sync', selectedFolderId)
                    .then(syncResult => {
                        if (syncResult?.synced && syncResult.synced > 0) {
                            ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId)
                                .then(fresh => { if (Array.isArray(fresh)) setEmails(fresh); });
                        }
                    })
                    .catch(() => { /* sync failure is non-blocking */ });
            })
            .finally(() => setLoading(false));
    }, [selectedFolderId, setEmails, setLoading]);

    useEffect(() => {
        const cleanup = ipcOn('email:new', async () => {
            if (selectedFolderId) {
                const result = await ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId);
                if (Array.isArray(result)) {
                    // Diff against the current store BEFORE swapping the list so
                    // newcomer rows can animate in.
                    const priorIds = new Set(useEmailStore.getState().emails.map(e => e.id));
                    const newcomers = result.filter(e => !priorIds.has(e.id)).map(e => e.id);
                    setEmails(result);
                    flagAsEntering(newcomers);
                }
            }
            const soundEnabled = await ipcInvoke<string>('settings:get', 'sound_enabled');
            if (soundEnabled === 'true') {
                try {
                    const audio = new Audio('/sounds/notification.wav');
                    audio.volume = 0.5;
                    audio.play().catch(() => {});
                } catch { /* silent fail */ }
            }
        });
        return () => { cleanup?.(); };
    }, [selectedFolderId, setEmails, flagAsEntering]);

    const [isSearching, setIsSearching] = useState(false);

    const handleSearch = useCallback((query: string) => {
        setSearchQuery(query);
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        if (query.trim().length === 0) {
            // Immediately restore folder contents when search is cleared
            setIsSearching(false);
            if (selectedFolderId) {
                ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId)
                    .then(result => { if (Array.isArray(result)) setEmails(result); });
            }
            return;
        }
        setIsSearching(true);
        searchTimerRef.current = setTimeout(async () => {
            if (query.trim().length >= 1) {
                const response = await ipcInvoke<{ results: EmailSummary[]; error?: string }>(
                    'emails:search', query, selectedAccountId ?? undefined
                );
                if (response && Array.isArray(response.results)) {
                    setEmails(response.results);
                }
            }
            setIsSearching(false);
        }, 200);
    }, [selectedFolderId, selectedAccountId, setEmails, setSearchQuery]);

    const dynamicFolderSwitch = useThemeStore(s => s.dynamicFolderSwitch);

    const handleSelectEmail = useCallback(async (emailId: string) => {
        selectEmail(emailId);
        // Optimistic mark-as-read update so the unread dot disappears immediately
        const target = emails.find(e => e.id === emailId);
        if (target && !target.is_read) {
            setEmails(emails.map(e => e.id === emailId ? { ...e, is_read: 1 } : e));
        }
        // Dynamic folder switching: when in All Accounts mode, switch folder list
        // to the clicked email's account for contextual navigation
        if (selectedAccountId === '__all' && dynamicFolderSwitch && target?.account_id) {
            setContextAccountId(target.account_id);
        }
        const full = await ipcInvoke<EmailFull>('emails:read', emailId);
        if (full) setSelectedEmail(full);
    }, [emails, selectEmail, setEmails, setSelectedEmail, selectedAccountId, dynamicFolderSwitch, setContextAccountId]);

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
            if (Array.isArray(refreshed)) setEmails(refreshed);
        }
    }, [selectedFolderId, setEmails]);

    const handleBulkDelete = useCallback(async () => {
        const ids = [...selectedEmailIds];
        if (ids.length === 0) return;
        // v1.18.5: animate every selected row's exit in parallel with the
        // IPC deletes so the user sees the bulk action visually.
        markEmailsExiting(ids);
        await Promise.all([
            (async () => {
                for (const id of ids) {
                    await ipcInvoke('emails:delete', id);
                }
            })(),
            new Promise<void>(resolve => setTimeout(resolve, 250)),
        ]);
        if (selectedEmailIds.has(useEmailStore.getState().selectedEmailId ?? '')) {
            useEmailStore.getState().clearActiveEmail();
        }
        clearSelection();
        await refreshList();
        unmarkEmailsExiting(ids);
    }, [selectedEmailIds, clearSelection, refreshList, markEmailsExiting, unmarkEmailsExiting]);

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

    const handleDragStart = useCallback((e: React.DragEvent, threadId: string) => {
        e.dataTransfer.effectAllowed = 'move';
        // If the dragged email is part of the current selection, drag the whole selection
        const ids = selectedEmailIds.has(threadId) ? [...selectedEmailIds] : [threadId];
        setDraggedEmailIds(ids);
        e.dataTransfer.setData('text/plain', ids.join(','));
    }, [selectedEmailIds, setDraggedEmailIds]);

    const handleDragEnd = useCallback(() => {
        setDraggedEmailIds([]);
    }, [setDraggedEmailIds]);

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
                // v1.18.5: animate via the store-level exiting set.
                markEmailsExiting([email.id]);
                const [result] = await Promise.all([
                    ipcInvoke<{ success: boolean }>('emails:delete', email.id),
                    new Promise<void>(resolve => setTimeout(resolve, 250)),
                ]);
                if (result?.success) {
                    if (useEmailStore.getState().selectedEmailId === email.id) {
                        useEmailStore.getState().clearActiveEmail();
                    }
                    if (selectedFolderId) {
                        const refreshed = await ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId);
                        if (Array.isArray(refreshed)) setEmails(refreshed);
                    }
                }
                unmarkEmailsExiting([email.id]);
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
    }, [ctxMenu, emails, selectedFolderId, setEmails, setSelectedEmail, selectEmail, onReply, onForward, markEmailsExiting, unmarkEmailsExiting]);

    const handleMoveToFolder = useCallback(async (destFolderId: string) => {
        if (!ctxMenu) return;
        const result = await ipcInvoke<{ success: boolean }>('emails:move', { emailId: ctxMenu.email.id, destFolderId });
        setCtxMenu(null);
        if (result?.success && selectedFolderId) {
            const refreshed = await ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId);
            if (Array.isArray(refreshed)) setEmails(refreshed);
        }
    }, [ctxMenu, selectedFolderId, setEmails]);

    const movableFolders = folders.filter(f => f.id !== selectedFolderId);

    const handleDeleteEmail = useCallback(async (emailId: string) => {
        // Apply exit animation in parallel with the IPC delete so the user sees
        // the row fade out immediately while the IMAP queue does its work.
        // v1.18.5: exit-flag state lives in emailStore so EVERY delete entry
        // point (this row icon + reading pane top bar + context menu + bulk +
        // keyboard) triggers the same animation uniformly.
        markEmailsExiting([emailId]);
        const [result] = await Promise.all([
            ipcInvoke<{ success: boolean; error?: string }>('emails:delete', emailId),
            new Promise<void>(resolve => setTimeout(resolve, 250)),
        ]);
        if (result?.success) {
            if (useEmailStore.getState().selectedEmailId === emailId) {
                useEmailStore.getState().clearActiveEmail();
            }
            if (selectedFolderId) {
                const refreshed = await ipcInvoke<EmailSummary[]>('emails:list', selectedFolderId);
                if (Array.isArray(refreshed)) setEmails(refreshed);
            }
        }
        unmarkEmailsExiting([emailId]);
    }, [selectedFolderId, setEmails, markEmailsExiting, unmarkEmailsExiting]);

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
                        <Search size={16} className={`${styles['search-icon']} ${isSearching ? styles['search-spinning'] : ''}`} />
                        <input
                            type="text"
                            placeholder={t('threadList.search')}
                            data-search-input
                            className={styles['search-input']}
                            value={searchQuery}
                            onChange={(e) => handleSearch(e.target.value)}
                        />
                        {searchQuery.length > 0 && (
                            <button
                                type="button"
                                className={styles['search-clear-btn']}
                                onClick={() => handleSearch('')}
                                title={t('threadList.clearSearch', 'Clear search')}
                                aria-label={t('threadList.clearSearch', 'Clear search')}
                            >
                                &times;
                            </button>
                        )}
                        {searchQuery.trim().length > 1 && (
                            <button
                                type="button"
                                className={styles['save-search-btn']}
                                onClick={async () => {
                                    if (!selectedAccountId) return;
                                    const name = searchQuery.trim().slice(0, 50);
                                    const result = await ipcInvoke<SavedSearch>('searches:create', selectedAccountId, name, searchQuery.trim());
                                    if (result && !savedSearches.some(s => s.id === result.id)) {
                                        setSavedSearches([...savedSearches, result]);
                                    }
                                }}
                                title={t('threadList.saveSearch')}
                                aria-label={t('threadList.saveSearch')}
                            >
                                <Bookmark size={14} />
                            </button>
                        )}
                    </div>
                )}
            </div>

            <div className={`${styles['thread-items']} animate-fade-in`}>
                {isLoading && emails.length === 0 && (
                    <div className={styles['skeleton-list']}>
                        {Array.from({ length: 7 }).map((_, i) => (
                            <div key={i} className={styles['skeleton-item']} data-testid="skeleton-item">
                                <div className={styles['skeleton-line-short']} />
                                <div className={styles['skeleton-line']} />
                                <div className={styles['skeleton-line-medium']} />
                            </div>
                        ))}
                    </div>
                )}
                {!isLoading && emails.length === 0 && (
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
                        isUnified={selectedFolderId === '__unified'}
                        showPreview={showThreadPreview}
                        isEntering={enteringIds.has(thread.id)}
                        isExiting={exitingEmailIds.has(thread.id)}
                        accounts={accounts}
                        onSelect={handleSelectEmail}
                        onDelete={handleDeleteEmail}
                        onToggleCheck={handleToggleCheck}
                        onContextMenu={handleContextMenu}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
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
