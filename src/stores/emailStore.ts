import { create } from 'zustand'

export interface Attachment {
    id: string
    email_id: string
    filename: string
    mime_type: string
    size: number
    part_number: string | null
    content_id: string | null
}

export interface EmailSummary {
    id: string
    thread_id: string | null
    message_id?: string | null
    subject: string | null
    from_name: string | null
    from_email: string | null
    to_email: string | null
    date: string | null
    snippet: string | null
    is_read: number
    is_flagged: number
    has_attachments: number
    ai_category: string | null
    ai_priority: number | null
    ai_labels: string | null
    thread_count?: number
    account_id?: string
}

export interface EmailFull extends EmailSummary {
    account_id: string
    folder_id: string
    body_text: string | null
    body_html: string | null
    bodyFetchStatus?: 'ok' | 'fetched' | 'imap_disconnected' | 'no_parts' | 'timeout'
    auth_spf?: string | null
    auth_dkim?: string | null
    auth_dmarc?: string | null
    sender_verified?: string | null
    spam_score?: number | null
}

export type AuthType = 'password' | 'oauth'
export type AuthState = 'ok' | 'recommended_reauth' | 'reauth_required'

export interface Account {
    id: string
    email: string
    provider: string
    display_name: string | null
    imap_host: string | null
    imap_port: number | null
    smtp_host: string | null
    smtp_port: number | null
    signature_html: string | null
    created_at?: string
    auth_type?: AuthType
    auth_state?: AuthState
}

export interface Folder {
    id: string
    name: string
    path: string
    type: string | null
    color?: string | null
    sort_order?: number
}

export interface Tag {
    id: string
    account_id: string
    name: string
    color: string
}

export interface SavedSearch {
    id: string
    account_id: string
    name: string
    query: string
    icon: string
}

export interface Draft {
    id: string
    account_id: string
    to_email: string
    subject: string | null
    body_html: string | null
    cc: string | null
    bcc: string | null
    created_at: string
    updated_at: string
}

interface EmailState {
    accounts: Account[]
    folders: Folder[]
    emails: EmailSummary[]
    selectedEmail: EmailFull | null
    selectedAccountId: string | null
    selectedFolderId: string | null
    selectedEmailId: string | null
    selectedEmailIds: Set<string>
    isLoading: boolean
    searchQuery: string
    drafts: Draft[]
    appVersion: string
    tags: Tag[]
    savedSearches: SavedSearch[]
    draggedEmailIds: string[]
    contextAccountId: string | null
    excludedAccountIds: Set<string>

    setAccounts: (accounts: Account[]) => void
    addAccount: (account: Account) => void
    updateAccount: (account: Account) => void
    removeAccount: (accountId: string) => void
    setFolders: (folders: Folder[]) => void
    setEmails: (emails: EmailSummary[]) => void
    setSelectedEmail: (email: EmailFull | null) => void
    /**
     * Clear BOTH `selectedEmail` and `selectedEmailId` atomically. Use this
     * after delete/archive/move-out-of-folder operations so the store does
     * not end up in a split state (`selectedEmailId` pointing at a deleted
     * row while `selectedEmail` is null), which broke subsequent reads on
     * the next click. Pinned by emailStore.test.ts regression suite.
     */
    clearActiveEmail: () => void
    /**
     * Set of email IDs currently animating their exit (delete/archive). The
     * ThreadList renders these rows with the `.thread-item-exiting` class.
     * v1.18.5: lifted from local ThreadList state into the store so EVERY
     * delete entry point (row icon, context menu, bulk action, reading-pane
     * top bar, keyboard shortcut) can flag exits and the animation fires
     * uniformly. Use `markEmailsExiting`/`unmarkEmailsExiting` to mutate.
     */
    exitingEmailIds: Set<string>
    markEmailsExiting: (ids: readonly string[]) => void
    unmarkEmailsExiting: (ids: readonly string[]) => void
    selectAccount: (id: string | null) => void
    selectFolder: (id: string | null) => void
    selectEmail: (id: string | null) => void
    toggleSelectEmail: (id: string) => void
    selectEmailRange: (id: string) => void
    selectAllEmails: () => void
    clearSelection: () => void
    setLoading: (loading: boolean) => void
    setSearchQuery: (query: string) => void
    setDrafts: (drafts: Draft[]) => void
    addDraft: (draft: Draft) => void
    removeDraft: (draftId: string) => void
    setAppVersion: (version: string) => void
    setTags: (tags: Tag[]) => void
    setSavedSearches: (searches: SavedSearch[]) => void
    setDraggedEmailIds: (ids: string[]) => void
    setContextAccountId: (id: string | null) => void
    toggleExcludedAccount: (accountId: string) => void
}

export const useEmailStore = create<EmailState>()((set) => ({
    accounts: [],
    folders: [],
    emails: [],
    selectedEmail: null,
    selectedAccountId: null,
    selectedFolderId: null,
    selectedEmailId: null,
    selectedEmailIds: new Set<string>(),
    exitingEmailIds: new Set<string>(),
    isLoading: false,
    searchQuery: '',
    drafts: [],
    appVersion: '',
    tags: [],
    savedSearches: [],
    draggedEmailIds: [],
    contextAccountId: null,
    excludedAccountIds: new Set<string>(
        (() => { try { return JSON.parse(localStorage.getItem('excludedAccountIds') || '[]'); } catch { return []; } })()
    ),

    setAccounts: (accounts) => set({ accounts }),
    addAccount: (account) => set((state) => ({ accounts: [...state.accounts, account] })),
    updateAccount: (account) => set((state) => ({
        accounts: state.accounts.map(a => a.id === account.id ? account : a),
    })),
    removeAccount: (accountId) => set((state) => {
        const remaining = state.accounts.filter(a => a.id !== accountId);
        const wasSelected = state.selectedAccountId === accountId;
        return {
            accounts: remaining,
            ...(wasSelected ? {
                selectedAccountId: remaining[0]?.id ?? null,
                selectedFolderId: null,
                selectedEmailId: null,
                selectedEmail: null,
                folders: [],
                emails: [],
            } : {}),
        };
    }),
    setFolders: (folders) => set({ folders }),
    setEmails: (emails) => set({ emails: Array.isArray(emails) ? emails : [] }),
    // Hardened to keep selectedEmail and selectedEmailId in lockstep. When
    // the email object is set, sync the id; when cleared, clear the id too.
    // Prevents the v1.18.1 split-state regression where `setSelectedEmail(null)`
    // left `selectedEmailId` pointing at a deleted email, breaking subsequent
    // reads. See emailStore.test.ts "selection state stays in lockstep".
    setSelectedEmail: (selectedEmail) =>
        set({ selectedEmail, selectedEmailId: selectedEmail ? selectedEmail.id : null }),
    clearActiveEmail: () => set({ selectedEmail: null, selectedEmailId: null }),
    markEmailsExiting: (ids) => set((state) => {
        if (ids.length === 0) return {};
        const next = new Set(state.exitingEmailIds);
        for (const id of ids) next.add(id);
        return { exitingEmailIds: next };
    }),
    unmarkEmailsExiting: (ids) => set((state) => {
        if (ids.length === 0) return {};
        const next = new Set(state.exitingEmailIds);
        for (const id of ids) next.delete(id);
        return { exitingEmailIds: next };
    }),
    selectAccount: (selectedAccountId) => set({ selectedAccountId, selectedFolderId: null, selectedEmailId: null, selectedEmail: null, selectedEmailIds: new Set<string>(), contextAccountId: null }),
    selectFolder: (selectedFolderId) => set({ selectedFolderId, selectedEmailId: null, selectedEmail: null, selectedEmailIds: new Set<string>() }),
    selectEmail: (selectedEmailId) => set({ selectedEmailId }),
    toggleSelectEmail: (id) => set((state) => {
        const next = new Set(state.selectedEmailIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        return { selectedEmailIds: next };
    }),
    selectEmailRange: (id) => set((state) => {
        const { emails, selectedEmailId, selectedEmailIds } = state;
        // Find anchor (last single-selected email or last in set)
        const anchor = selectedEmailId ?? (selectedEmailIds.size > 0 ? [...selectedEmailIds].pop()! : null);
        if (!anchor) return { selectedEmailIds: new Set([id]) };
        const anchorIdx = emails.findIndex(e => e.id === anchor);
        const targetIdx = emails.findIndex(e => e.id === id);
        if (anchorIdx === -1 || targetIdx === -1) return { selectedEmailIds: new Set([id]) };
        const start = Math.min(anchorIdx, targetIdx);
        const end = Math.max(anchorIdx, targetIdx);
        const next = new Set(selectedEmailIds);
        for (let i = start; i <= end; i++) next.add(emails[i].id);
        return { selectedEmailIds: next };
    }),
    selectAllEmails: () => set((state) => ({
        selectedEmailIds: new Set(state.emails.map(e => e.id)),
    })),
    clearSelection: () => set({ selectedEmailIds: new Set<string>() }),
    setLoading: (isLoading) => set({ isLoading }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    setDrafts: (drafts) => set({ drafts }),
    addDraft: (draft) => set((state) => ({ drafts: [draft, ...state.drafts] })),
    removeDraft: (draftId) => set((state) => ({ drafts: state.drafts.filter(d => d.id !== draftId) })),
    setAppVersion: (appVersion) => set({ appVersion }),
    setTags: (tags) => set({ tags }),
    setSavedSearches: (savedSearches) => set({ savedSearches }),
    setDraggedEmailIds: (draggedEmailIds) => set({ draggedEmailIds }),
    setContextAccountId: (contextAccountId) => set({ contextAccountId }),
    toggleExcludedAccount: (accountId) => set((state) => {
        const next = new Set(state.excludedAccountIds);
        if (next.has(accountId)) next.delete(accountId);
        else next.add(accountId);
        localStorage.setItem('excludedAccountIds', JSON.stringify([...next]));
        return { excludedAccountIds: next };
    }),
}))
