import { memo, useEffect, useCallback, useRef } from 'react';
import { Search, Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEmailStore } from '../stores/emailStore';
import type { EmailSummary, EmailFull } from '../stores/emailStore';
import { ipcInvoke, ipcOn } from '../lib/ipc';
import styles from './ThreadList.module.css';

interface ThreadItemProps {
    thread: EmailSummary;
    isSelected: boolean;
    onSelect: (id: string) => void;
}

const ThreadItem = memo<ThreadItemProps>(({ thread, isSelected, onSelect }) => (
    <div
        role="button"
        tabIndex={0}
        className={`${styles['thread-item']} ${!thread.is_read ? styles['unread'] : ''} ${isSelected ? styles['selected'] : ''}`}
        onClick={() => onSelect(thread.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(thread.id); } }}
    >
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
                <span className={styles['date']}>{thread.date ? new Date(thread.date).toLocaleDateString() : ''}</span>
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
        <div className={styles['snippet']}>{thread.snippet}</div>
        {!thread.is_read && <div className={styles['unread-dot']} />}
    </div>
));

export const ThreadList: React.FC = () => {
    const { t } = useTranslation();
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
        <div className={`${styles['thread-list']} scrollable`}>
            <div className={`${styles['thread-list-header']} glass`}>
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
            </div>

            <div className={`${styles['thread-items']} animate-fade-in`}>
                {emails.length === 0 && (
                    <div className={styles['empty-state']}>
                        {selectedFolderId ? t('threadList.noEmails') : t('threadList.noResults')}
                    </div>
                )}
                {emails.map((thread) => (
                    <ThreadItem
                        key={thread.id}
                        thread={thread}
                        isSelected={selectedEmailId === thread.id}
                        onSelect={handleSelectEmail}
                    />
                ))}
            </div>
        </div>
    );
};
