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
}

export interface EmailFull extends EmailSummary {
    account_id: string
    folder_id: string
    body_text: string | null
    body_html: string | null
}

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
}

export interface Folder {
    id: string
    name: string
    path: string
    type: string | null
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
    isLoading: boolean
    searchQuery: string
    drafts: Draft[]

    setAccounts: (accounts: Account[]) => void
    addAccount: (account: Account) => void
    updateAccount: (account: Account) => void
    removeAccount: (accountId: string) => void
    setFolders: (folders: Folder[]) => void
    setEmails: (emails: EmailSummary[]) => void
    setSelectedEmail: (email: EmailFull | null) => void
    selectAccount: (id: string | null) => void
    selectFolder: (id: string | null) => void
    selectEmail: (id: string | null) => void
    setLoading: (loading: boolean) => void
    setSearchQuery: (query: string) => void
    setDrafts: (drafts: Draft[]) => void
    addDraft: (draft: Draft) => void
    removeDraft: (draftId: string) => void
}

export const useEmailStore = create<EmailState>()((set) => ({
    accounts: [],
    folders: [],
    emails: [],
    selectedEmail: null,
    selectedAccountId: null,
    selectedFolderId: null,
    selectedEmailId: null,
    isLoading: false,
    searchQuery: '',
    drafts: [],

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
    setEmails: (emails) => set({ emails }),
    setSelectedEmail: (selectedEmail) => set({ selectedEmail }),
    selectAccount: (selectedAccountId) => set({ selectedAccountId, selectedFolderId: null, selectedEmailId: null, selectedEmail: null }),
    selectFolder: (selectedFolderId) => set({ selectedFolderId, selectedEmailId: null, selectedEmail: null }),
    selectEmail: (selectedEmailId) => set({ selectedEmailId }),
    setLoading: (isLoading) => set({ isLoading }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    setDrafts: (drafts) => set({ drafts }),
    addDraft: (draft) => set((state) => ({ drafts: [draft, ...state.drafts] })),
    removeDraft: (draftId) => set((state) => ({ drafts: state.drafts.filter(d => d.id !== draftId) })),
}))
