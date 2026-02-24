import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReadingPane } from './ReadingPane';
import { ThemeProvider } from './ThemeContext';
import { useEmailStore } from '../stores/emailStore';
import { ipcInvoke } from '../lib/ipc';
import type { EmailFull } from '../stores/emailStore';

vi.mock('../lib/ipc', () => ({
    ipcInvoke: vi.fn(),
}));

vi.mock('dompurify', () => ({
    default: {
        sanitize: (html: string) => html,
    },
}));

vi.mock('lucide-react', () => ({
    Reply: () => <div data-testid="icon-Reply">R</div>,
    Forward: () => <div data-testid="icon-Forward">F</div>,
    Trash2: () => <div data-testid="icon-Trash2">T</div>,
    Star: ({ fill }: { fill?: string }) => <div data-testid="icon-Star" data-fill={fill}>S</div>,
    Archive: () => <div data-testid="icon-Archive">A</div>,
    FolderInput: () => <div data-testid="icon-FolderInput">FI</div>,
    Paperclip: () => <div data-testid="icon-Paperclip">P</div>,
    Download: () => <div data-testid="icon-Download">D</div>,
    FileText: () => <div data-testid="icon-FileText">FT</div>,
    ShieldAlert: () => <div data-testid="icon-ShieldAlert">SA</div>,
}));

vi.mock('../lib/formatFileSize', () => ({
    formatFileSize: (bytes: number) => `${bytes} bytes`,
}));

vi.mock('@radix-ui/react-dropdown-menu', () => ({
    Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Trigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => asChild ? <>{children}</> : <button>{children}</button>,
    Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Content: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className} role="menu">{children}</div>,
    Item: ({ children, onSelect, disabled, className }: { children: React.ReactNode; onSelect?: () => void; disabled?: boolean; className?: string }) => (
        <div role="menuitem" className={className} onClick={onSelect} aria-disabled={disabled}>{children}</div>
    ),
}));

const mockIpcInvoke = vi.mocked(ipcInvoke);

const mockEmail: EmailFull = {
    id: 'email-1',
    account_id: 'acc-1',
    folder_id: 'folder-inbox',
    thread_id: null,
    subject: 'Test Subject',
    from_name: 'John Doe',
    from_email: 'john@example.com',
    to_email: 'me@example.com',
    date: '2026-02-24T12:00:00Z',
    snippet: 'Hello world...',
    body_text: 'Hello world',
    body_html: '<p>Hello world</p>',
    is_read: 1,
    is_flagged: 0,
    has_attachments: 0,
    ai_category: null,
    ai_priority: null,
    ai_labels: null,
};

function renderReadingPane(props: Partial<Parameters<typeof ReadingPane>[0]> = {}) {
    return render(
        <ThemeProvider>
            <ReadingPane {...props} />
        </ThemeProvider>
    );
}

describe('ReadingPane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIpcInvoke.mockResolvedValue(null);
        useEmailStore.setState({
            selectedEmail: null,
            folders: [
                { id: 'folder-inbox', name: 'Inbox', path: 'INBOX', type: 'inbox' },
                { id: 'folder-archive', name: 'Archive', path: 'Archive', type: 'archive' },
                { id: 'folder-sent', name: 'Sent', path: 'Sent', type: 'sent' },
            ],
            selectedFolderId: 'folder-inbox',
        });
    });

    it('renders placeholder when no email is selected', () => {
        renderReadingPane();
        expect(screen.getByText('Select an email to read')).toBeInTheDocument();
    });

    it('renders email content when email is selected', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        expect(screen.getByText('Test Subject')).toBeInTheDocument();
        expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('renders all action buttons including archive and move', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        expect(screen.getByTitle('Reply')).toBeInTheDocument();
        expect(screen.getByTitle('Forward')).toBeInTheDocument();
        expect(screen.getByTitle('Delete')).toBeInTheDocument();
        expect(screen.getByTitle('Archive (E)')).toBeInTheDocument();
        expect(screen.getByTitle('Move to folder')).toBeInTheDocument();
    });

    it('calls onReply callback when reply button is clicked', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        const onReply = vi.fn();
        renderReadingPane({ onReply });
        fireEvent.click(screen.getByTitle('Reply'));
        expect(onReply).toHaveBeenCalledWith(mockEmail);
    });

    it('calls onForward callback when forward button is clicked', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        const onForward = vi.fn();
        renderReadingPane({ onForward });
        fireEvent.click(screen.getByTitle('Forward'));
        expect(onForward).toHaveBeenCalledWith(mockEmail);
    });

    it('calls emails:delete IPC on delete button click', async () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        fireEvent.click(screen.getByTitle('Delete'));
        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('emails:delete', 'email-1');
        });
    });

    it('calls emails:archive IPC on archive button click', async () => {
        mockIpcInvoke.mockResolvedValueOnce({ success: true });
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        fireEvent.click(screen.getByTitle('Archive (E)'));
        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('emails:archive', 'email-1');
        });
    });

    it('calls emails:toggle-flag IPC on star button click', async () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        fireEvent.click(screen.getByTitle('Flag'));
        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('emails:toggle-flag', 'email-1', true);
        });
    });

    it('renders move dropdown with other folders (excludes current folder)', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        expect(screen.getByText('Archive')).toBeInTheDocument();
        expect(screen.getByText('Sent')).toBeInTheDocument();
        const menuItems = screen.getAllByRole('menuitem');
        const inboxItem = menuItems.find(item => item.textContent === 'Inbox');
        expect(inboxItem).toBeUndefined();
    });

    it('renders HTML email content', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        const bodyHtml = document.querySelector('.email-body-html');
        expect(bodyHtml).toBeTruthy();
        expect(bodyHtml?.innerHTML).toContain('Hello world');
    });

    it('renders plain text when no body_html', () => {
        useEmailStore.setState({
            selectedEmail: { ...mockEmail, body_html: null },
        });
        renderReadingPane();
        expect(screen.getByText('Hello world')).toBeInTheDocument();
    });

    it('renders attachment chips when email has attachments', async () => {
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'attachments:list') {
                return [
                    { id: 'att1', email_id: 'email-1', filename: 'report.pdf', mime_type: 'application/pdf', size: 102400, part_number: '2', content_id: null },
                    { id: 'att2', email_id: 'email-1', filename: 'photo.jpg', mime_type: 'image/jpeg', size: 2048000, part_number: '3', content_id: null },
                ];
            }
            return null;
        });
        useEmailStore.setState({ selectedEmail: { ...mockEmail, has_attachments: 1 } });
        renderReadingPane();
        await waitFor(() => {
            expect(screen.getByText('report.pdf')).toBeInTheDocument();
            expect(screen.getByText('photo.jpg')).toBeInTheDocument();
            expect(screen.getByText('2 attachments')).toBeInTheDocument();
        });
    });

    it('does not fetch attachments when email has none', () => {
        useEmailStore.setState({ selectedEmail: { ...mockEmail, has_attachments: 0 } });
        renderReadingPane();
        expect(mockIpcInvoke).not.toHaveBeenCalledWith('attachments:list', expect.anything());
    });

    // --- CID Inline Image Tests ---

    it('fetches CID images when body_html contains cid: references', async () => {
        const emailWithCid: EmailFull = {
            ...mockEmail,
            body_html: '<p>Hello</p><img src="cid:image001@example.com" />',
        };
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'attachments:by-cid') {
                return { 'image001@example.com': 'data:image/png;base64,abc123' };
            }
            return null;
        });
        useEmailStore.setState({ selectedEmail: emailWithCid });
        renderReadingPane();
        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('attachments:by-cid', {
                emailId: 'email-1',
                contentIds: ['image001@example.com'],
            });
        });
    });

    it('does not call attachments:by-cid when no CID references exist', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        expect(mockIpcInvoke).not.toHaveBeenCalledWith('attachments:by-cid', expect.anything());
    });

    it('hides CID attachments from the download list', async () => {
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'attachments:list') {
                return [
                    { id: 'att1', email_id: 'email-1', filename: 'report.pdf', mime_type: 'application/pdf', size: 102400, part_number: '2', content_id: null },
                    { id: 'att-inline', email_id: 'email-1', filename: 'inline-image.png', mime_type: 'image/png', size: 5000, part_number: '3', content_id: 'cid123' },
                ];
            }
            return null;
        });
        useEmailStore.setState({ selectedEmail: { ...mockEmail, has_attachments: 1 } });
        renderReadingPane();
        await waitFor(() => {
            expect(screen.getByText('report.pdf')).toBeInTheDocument();
            expect(screen.getByText('1 attachment')).toBeInTheDocument();
            expect(screen.queryByText('inline-image.png')).not.toBeInTheDocument();
        });
    });

    // --- Remote Image Blocking Tests ---

    it('shows remote image blocking banner for emails with remote images', async () => {
        const emailWithRemoteImg: EmailFull = {
            ...mockEmail,
            body_html: '<p>Hello</p><img src="https://example.com/tracker.png" />',
        };
        useEmailStore.setState({ selectedEmail: emailWithRemoteImg });
        renderReadingPane();
        await waitFor(() => {
            expect(screen.getByText('Remote images blocked for privacy.')).toBeInTheDocument();
            expect(screen.getByText('Load images')).toBeInTheDocument();
        });
    });

    it('does not show remote image banner for data: and cid: images', () => {
        const emailWithSafeImgs: EmailFull = {
            ...mockEmail,
            body_html: '<p>Hello</p><img src="data:image/png;base64,abc" />',
        };
        useEmailStore.setState({ selectedEmail: emailWithSafeImgs });
        renderReadingPane();
        expect(screen.queryByText('Remote images blocked for privacy.')).not.toBeInTheDocument();
    });

    it('clicking Load images removes the banner and restores images', async () => {
        const emailWithRemoteImg: EmailFull = {
            ...mockEmail,
            body_html: '<p>Hello</p><img src="https://example.com/logo.png" />',
        };
        useEmailStore.setState({ selectedEmail: emailWithRemoteImg });
        renderReadingPane();
        await waitFor(() => {
            expect(screen.getByText('Load images')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('Load images'));
        await waitFor(() => {
            expect(screen.queryByText('Remote images blocked for privacy.')).not.toBeInTheDocument();
        });
    });
});
