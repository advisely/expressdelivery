import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEmailStore } from '../stores/emailStore';
import type { EmailSummary, Account } from '../stores/emailStore';
import { getProviderIcon } from '../lib/providerIcons';
import { ipcInvoke } from '../lib/ipc';
import styles from './GlobalSearch.module.css';

interface GlobalSearchProps {
    onClose: () => void;
    onNavigate: (emailId: string, accountId: string, folderId: string) => void;
}

interface GroupedResults {
    account: Account;
    emails: (EmailSummary & { folder_id?: string })[];
}

export const GlobalSearch: React.FC<GlobalSearchProps> = ({ onClose, onNavigate }) => {
    const { t } = useTranslation();
    const accounts = useEmailStore(s => s.accounts);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<(EmailSummary & { folder_id?: string })[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedIdx, setSelectedIdx] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const resultsRef = useRef<HTMLDivElement>(null);

    // Auto-focus input on mount
    useEffect(() => {
        requestAnimationFrame(() => inputRef.current?.focus());
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, []);

    // Close on Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
        };
        document.addEventListener('keydown', handleKey, true);
        return () => document.removeEventListener('keydown', handleKey, true);
    }, [onClose]);

    const handleSearch = useCallback((value: string) => {
        setQuery(value);
        setSelectedIdx(0);
        if (timerRef.current) clearTimeout(timerRef.current);
        if (value.trim().length === 0) {
            setResults([]);
            setIsSearching(false);
            return;
        }
        setIsSearching(true);
        timerRef.current = setTimeout(async () => {
            const response = await ipcInvoke<{ results: EmailSummary[]; error?: string }>(
                'emails:search-global', value
            );
            if (response && Array.isArray(response.results)) {
                setResults(response.results);
            }
            setIsSearching(false);
        }, 200);
    }, []);

    const handleSelect = useCallback((email: EmailSummary & { folder_id?: string }) => {
        if (email.account_id && email.folder_id) {
            onNavigate(email.id, email.account_id, email.folder_id);
        }
        onClose();
    }, [onNavigate, onClose]);

    // Keyboard navigation within results
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIdx(i => Math.min(i + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIdx(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' && results[selectedIdx]) {
            e.preventDefault();
            handleSelect(results[selectedIdx]);
        }
    }, [results, selectedIdx, handleSelect]);

    // Scroll selected item into view
    useEffect(() => {
        const container = resultsRef.current;
        if (!container) return;
        const item = container.children[selectedIdx] as HTMLElement | undefined;
        item?.scrollIntoView({ block: 'nearest' });
    }, [selectedIdx]);

    // Group results by account
    const grouped: GroupedResults[] = accounts
        .map(account => ({
            account,
            emails: results.filter(r => r.account_id === account.id),
        }))
        .filter(g => g.emails.length > 0);

    // Flat index mapping for keyboard nav
    let flatIdx = 0;

    return (
        <div className={styles['overlay']} onClick={onClose}>
            <div className={styles['container']} onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
                <div className={styles['search-header']}>
                    <Search size={20} className={`${styles['search-icon']} ${isSearching ? styles['spinning'] : ''}`} />
                    <input
                        ref={inputRef}
                        type="text"
                        className={styles['search-input']}
                        placeholder={t('globalSearch.placeholder', 'Search all accounts and folders...')}
                        value={query}
                        onChange={e => handleSearch(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {query.length > 0 && (
                        <button
                            type="button"
                            className={styles['clear-btn']}
                            onClick={() => handleSearch('')}
                            aria-label={t('threadList.clearSearch', 'Clear')}
                        >
                            <X size={16} />
                        </button>
                    )}
                    <kbd className={styles['kbd']}>Esc</kbd>
                </div>

                <div className={styles['results']} ref={resultsRef}>
                    {query.length > 0 && !isSearching && results.length === 0 && (
                        <div className={styles['empty']}>
                            {t('globalSearch.noResults', 'No results found')}
                        </div>
                    )}
                    {query.length === 0 && (
                        <div className={styles['empty']}>
                            {t('globalSearch.hint', 'Type to search across all your email accounts')}
                        </div>
                    )}
                    {grouped.map(group => {
                        const ProviderIcon = getProviderIcon(group.account.provider);
                        return (
                            <div key={group.account.id} className={styles['group']}>
                                <div className={styles['group-header']}>
                                    <ProviderIcon size={14} />
                                    <span>{group.account.display_name ?? group.account.email}</span>
                                    <span className={styles['group-count']}>{group.emails.length}</span>
                                </div>
                                {group.emails.map(email => {
                                    const thisIdx = flatIdx++;
                                    const isActive = thisIdx === selectedIdx;
                                    return (
                                        <button
                                            key={email.id}
                                            className={`${styles['result-item']} ${isActive ? styles['result-active'] : ''}`}
                                            onClick={() => handleSelect(email)}
                                            type="button"
                                        >
                                            <div className={styles['result-main']}>
                                                <span className={`${styles['result-subject']} ${!email.is_read ? styles['result-unread'] : ''}`}>
                                                    {email.subject ?? t('threadList.noSubject', '(No subject)')}
                                                </span>
                                                <span className={styles['result-sender']}>
                                                    {email.from_name ?? email.from_email}
                                                </span>
                                            </div>
                                            <div className={styles['result-meta']}>
                                                {email.snippet && (
                                                    <span className={styles['result-snippet']}>{email.snippet}</span>
                                                )}
                                                <span className={styles['result-date']}>
                                                    {email.date ? new Date(email.date).toLocaleDateString() : ''}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>

                <div className={styles['footer']}>
                    <span>{t('globalSearch.navigate', 'Navigate')}: <kbd>&uarr;</kbd><kbd>&darr;</kbd></span>
                    <span>{t('globalSearch.open', 'Open')}: <kbd>Enter</kbd></span>
                    <span>{t('globalSearch.close', 'Close')}: <kbd>Esc</kbd></span>
                </div>
            </div>
        </div>
    );
};
