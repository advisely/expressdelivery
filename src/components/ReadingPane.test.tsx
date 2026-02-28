import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReadingPane, _resetAllowedRemoteImages } from './ReadingPane';
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
    Clock: () => <div data-testid="icon-Clock">CL</div>,
    Bell: () => <div data-testid="icon-Bell">B</div>,
    Printer: () => <div data-testid="icon-Printer">PR</div>,
    ZoomIn: () => <div data-testid="icon-ZoomIn">ZI</div>,
    ZoomOut: () => <div data-testid="icon-ZoomOut">ZO</div>,
    Code: () => <div data-testid="icon-Code">CO</div>,
    Mail: () => <div data-testid="icon-Mail">M</div>,
    Copy: () => <div data-testid="icon-Copy">CP</div>,
    Sparkles: () => <div data-testid="icon-Sparkles">SP</div>,
    X: () => <div data-testid="icon-X">X</div>,
    AlertTriangle: () => <div data-testid="icon-AlertTriangle">AT</div>,
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

vi.mock('@radix-ui/react-popover', () => ({
    Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Trigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => asChild ? <>{children}</> : <button>{children}</button>,
    Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Content: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
}));

vi.mock('./DateTimePicker', () => ({
    default: ({ label }: { label?: string }) => <div data-testid="date-time-picker">{label}</div>,
}));

vi.mock('./MessageSourceDialog', () => ({
    MessageSourceDialog: ({ open, source }: { open: boolean; source: string; subject: string; onOpenChange: (v: boolean) => void }) =>
        open ? <div data-testid="message-source-dialog">{source}</div> : null,
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
        _resetAllowedRemoteImages();
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
        expect(screen.getByText('readingPane.noSelection')).toBeInTheDocument();
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
        expect(screen.getByTitle('readingPane.reply')).toBeInTheDocument();
        expect(screen.getByTitle('readingPane.forward')).toBeInTheDocument();
        expect(screen.getByTitle('readingPane.delete')).toBeInTheDocument();
        expect(screen.getByTitle('readingPane.archive')).toBeInTheDocument();
        expect(screen.getByTitle('readingPane.moveTo')).toBeInTheDocument();
    });

    it('calls onReply callback when reply button is clicked', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        const onReply = vi.fn();
        renderReadingPane({ onReply });
        fireEvent.click(screen.getByTitle('readingPane.reply'));
        expect(onReply).toHaveBeenCalledWith(mockEmail);
    });

    it('calls onForward callback when forward button is clicked', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        const onForward = vi.fn();
        renderReadingPane({ onForward });
        fireEvent.click(screen.getByTitle('readingPane.forward'));
        expect(onForward).toHaveBeenCalledWith(mockEmail);
    });

    it('calls emails:delete IPC on delete button click', async () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        fireEvent.click(screen.getByTitle('readingPane.delete'));
        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('emails:delete', 'email-1');
        });
    });

    it('calls emails:archive IPC on archive button click', async () => {
        mockIpcInvoke.mockResolvedValueOnce({ success: true });
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        fireEvent.click(screen.getByTitle('readingPane.archive'));
        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('emails:archive', 'email-1');
        });
    });

    it('calls emails:toggle-flag IPC on star button click', async () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        fireEvent.click(screen.getByTitle('readingPane.star'));
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

    it('renders HTML email content in sandboxed iframe', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        const iframe = screen.getByTitle('Email content') as HTMLIFrameElement;
        expect(iframe).toBeInTheDocument();
        expect(iframe.tagName).toBe('IFRAME');
        expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
        const srcdoc = iframe.getAttribute('srcdoc') ?? '';
        expect(srcdoc).toContain('Hello world');
        expect(srcdoc).toContain('Content-Security-Policy');
        expect(srcdoc).toContain('img-src data:');
        expect(srcdoc).toContain("frame-ancestors 'none'");
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
            expect(screen.getByText('readingPane.remoteImagesBlocked')).toBeInTheDocument();
            expect(screen.getByText('readingPane.loadImages')).toBeInTheDocument();
        });
    });

    it('does not show remote image banner for data: and cid: images', () => {
        const emailWithSafeImgs: EmailFull = {
            ...mockEmail,
            body_html: '<p>Hello</p><img src="data:image/png;base64,abc" />',
        };
        useEmailStore.setState({ selectedEmail: emailWithSafeImgs });
        renderReadingPane();
        expect(screen.queryByText('readingPane.remoteImagesBlocked')).not.toBeInTheDocument();
    });

    it('clicking readingPane.loadImages removes the banner and restores images', async () => {
        const emailWithRemoteImg: EmailFull = {
            ...mockEmail,
            body_html: '<p>Hello</p><img src="https://example.com/logo.png" />',
        };
        useEmailStore.setState({ selectedEmail: emailWithRemoteImg });
        renderReadingPane();
        await waitFor(() => {
            expect(screen.getByText('readingPane.loadImages')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('readingPane.loadImages'));
        await waitFor(() => {
            expect(screen.queryByText('readingPane.remoteImagesBlocked')).not.toBeInTheDocument();
        });
    });

    it('blocks remote images in srcset attribute and shows banner', async () => {
        const emailWithSrcset: EmailFull = {
            ...mockEmail,
            body_html: '<p>Hello</p><img srcset="https://example.com/photo-2x.png 2x, https://example.com/photo-1x.png 1x" src="https://example.com/photo.png" />',
        };
        useEmailStore.setState({ selectedEmail: emailWithSrcset });
        renderReadingPane();
        await waitFor(() => {
            expect(screen.getByText('readingPane.remoteImagesBlocked')).toBeInTheDocument();
        });
        const iframe = screen.getByTitle('Email content') as HTMLIFrameElement;
        const srcdoc = iframe.getAttribute('srcdoc') ?? '';
        // The original srcset= attribute should be replaced with data-blocked-srcset=
        expect(srcdoc).toContain('data-blocked-srcset=');
        expect(srcdoc).toContain('data-blocked-src=');
        // Ensure no bare srcset= remains (only data-blocked-srcset= should exist)
        const withoutBlocked = srcdoc.replace(/data-blocked-srcset=/g, '');
        expect(withoutBlocked).not.toContain('srcset=');
    });

    // --- Thread Conversation Tests ---

    describe('Thread conversation collapse/expand', () => {
        it('renders collapsed older messages and expanded latest in thread view', async () => {
            const threadEmails = [
                { ...mockEmail, id: 'msg-1', from_name: 'Alice', snippet: 'First message', body_html: '<p>First</p>' },
                { ...mockEmail, id: 'msg-2', from_name: 'Bob', snippet: 'Second message', body_html: '<p>Second</p>' },
                { ...mockEmail, id: 'msg-3', from_name: 'Carol', snippet: 'Third message', body_html: '<p>Third</p>' },
            ];
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'emails:thread') return threadEmails;
                return null;
            });
            useEmailStore.setState({ selectedEmail: { ...mockEmail, thread_id: 'thread-abc' } });
            renderReadingPane();

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:thread', 'thread-abc');
            });

            // Older messages (not the last) should be collapsed — button aria-label "Expand message"
            await waitFor(() => {
                const expandBtns = screen.getAllByLabelText('readingPane.expandMessage');
                expect(expandBtns.length).toBeGreaterThanOrEqual(1);
            });

            // The last message is always expanded — its toggle button has aria-label "Collapse message"
            // but is disabled. We check that the last header has aria-expanded true via the
            // "Collapse message" label (the component renders it as the collapseMessage key).
            const collapseBtns = screen.getAllByLabelText('readingPane.collapseMessage');
            expect(collapseBtns.length).toBeGreaterThanOrEqual(1);
        });

        it('expands a collapsed thread message on click', async () => {
            const threadEmails = [
                { ...mockEmail, id: 'msg-1', from_name: 'Alice', snippet: 'First message', body_html: '<p>First</p>' },
                { ...mockEmail, id: 'msg-2', from_name: 'Bob', snippet: 'Second message', body_html: '<p>Second</p>' },
            ];
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'emails:thread') return threadEmails;
                return null;
            });
            useEmailStore.setState({ selectedEmail: { ...mockEmail, thread_id: 'thread-xyz' } });
            renderReadingPane();

            await waitFor(() => {
                expect(screen.getAllByLabelText('readingPane.expandMessage').length).toBeGreaterThanOrEqual(1);
            });

            // Click the "Expand message" button on the first (collapsed) message
            const expandBtn = screen.getAllByLabelText('readingPane.expandMessage')[0];
            fireEvent.click(expandBtn);

            // After expanding, that button should now show "Collapse message"
            await waitFor(() => {
                const collapseBtns = screen.getAllByLabelText('readingPane.collapseMessage');
                // The first message is now expanded, so there are at least 2 collapse buttons
                // (the newly expanded one + the last message which was already expanded)
                expect(collapseBtns.length).toBeGreaterThanOrEqual(2);
            });
        });

        // -------------------------------------------------------------------
        // Edge cases
        // -------------------------------------------------------------------

        it('does not render thread conversation view when thread returns empty array', async () => {
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'emails:thread') return [];
                return null;
            });
            useEmailStore.setState({ selectedEmail: { ...mockEmail, thread_id: 'thread-empty' } });
            renderReadingPane();

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:thread', 'thread-empty');
            });

            // threadEmails.length is 0 (< 2), so thread-conversation div must not appear;
            // the single-email body view (iframe) should be rendered instead.
            await waitFor(() => {
                expect(screen.queryByLabelText('readingPane.expandMessage')).not.toBeInTheDocument();
                expect(screen.queryByLabelText('readingPane.collapseMessage')).not.toBeInTheDocument();
            });

            // The standard single-email iframe should still render
            expect(screen.getByTitle('Email content')).toBeInTheDocument();
        });

        it('does not render thread conversation view when thread returns only one message', async () => {
            // The component only shows thread view when result.length > 1
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'emails:thread') return [mockEmail];
                return null;
            });
            useEmailStore.setState({ selectedEmail: { ...mockEmail, thread_id: 'thread-single' } });
            renderReadingPane();

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:thread', 'thread-single');
            });

            // A single-message thread must never show expand/collapse controls
            await waitFor(() => {
                expect(screen.queryByLabelText('readingPane.expandMessage')).not.toBeInTheDocument();
            });
        });

        it('does not fetch thread when thread_id is null', () => {
            useEmailStore.setState({ selectedEmail: { ...mockEmail, thread_id: null } });
            renderReadingPane();

            // emails:thread must not be called when there is no thread_id
            expect(mockIpcInvoke).not.toHaveBeenCalledWith('emails:thread', expect.anything());
        });

        it('resets expanded state when switching to a different threaded email', async () => {
            const threadEmailsA = [
                { ...mockEmail, id: 'a-1', from_name: 'Alice', snippet: 'A1', body_html: '<p>A1</p>' },
                { ...mockEmail, id: 'a-2', from_name: 'Alice', snippet: 'A2', body_html: '<p>A2</p>' },
            ];
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'emails:thread') return threadEmailsA;
                return null;
            });
            const emailA = { ...mockEmail, id: 'a-1', thread_id: 'thread-A' };
            useEmailStore.setState({ selectedEmail: emailA });
            renderReadingPane();

            await waitFor(() => {
                expect(screen.getAllByLabelText('readingPane.expandMessage').length).toBeGreaterThanOrEqual(1);
            });

            // Expand the first (collapsed) message in thread A
            const expandBtn = screen.getAllByLabelText('readingPane.expandMessage')[0];
            fireEvent.click(expandBtn);

            await waitFor(() => {
                expect(screen.getAllByLabelText('readingPane.collapseMessage').length).toBeGreaterThanOrEqual(2);
            });

            // Now switch to a different email with a different thread — expansion state must reset
            const emailB: EmailFull = { ...mockEmail, id: 'b-1', thread_id: 'thread-B', body_html: '<p>B</p>' };
            useEmailStore.setState({ selectedEmail: emailB });

            await waitFor(() => {
                // After switching, no expand buttons (thread-B returns only 2 messages so only 1 collapse btn)
                // and the first message in B is collapsed again
                const expandBtns = screen.queryAllByLabelText('readingPane.expandMessage');
                // expandBtns count may vary; main assertion is no stale collapse buttons beyond 1
                const collapseBtns = screen.queryAllByLabelText('readingPane.collapseMessage');
                // Either 0 (no thread loaded yet) or only the last-message collapse button
                expect(collapseBtns.length).toBeLessThanOrEqual(1);
                expect(expandBtns.length).toBeLessThanOrEqual(1);
            });
        });

        it('renders thread message sender as from_email when from_name is null', async () => {
            const threadEmails = [
                { ...mockEmail, id: 'msg-noname-1', from_name: null, from_email: 'anon@example.com', snippet: 'Anon msg', body_html: '<p>Hi</p>' },
                { ...mockEmail, id: 'msg-noname-2', from_name: null, from_email: 'other@example.com', snippet: 'Other msg', body_html: '<p>There</p>' },
            ];
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'emails:thread') return threadEmails;
                return null;
            });
            useEmailStore.setState({ selectedEmail: { ...mockEmail, thread_id: 'thread-noname', from_name: null, from_email: 'anon@example.com' } });
            renderReadingPane();

            await waitFor(() => {
                // The thread message header renders <strong>{from_name || from_email}</strong>
                expect(screen.getByText('anon@example.com')).toBeInTheDocument();
            });
        });

        it('uses from_email initial for avatar when from_name is null in thread message', async () => {
            const threadEmails = [
                { ...mockEmail, id: 'msg-init-1', from_name: null, from_email: 'zebra@example.com', snippet: 'Z msg', body_html: '<p>Z</p>' },
                { ...mockEmail, id: 'msg-init-2', from_name: null, from_email: 'zebra@example.com', snippet: 'Z2 msg', body_html: '<p>Z2</p>' },
            ];
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'emails:thread') return threadEmails;
                return null;
            });
            useEmailStore.setState({ selectedEmail: { ...mockEmail, thread_id: 'thread-init', from_name: null, from_email: 'zebra@example.com' } });
            renderReadingPane();

            await waitFor(() => {
                // Avatar uses charAt(0).toUpperCase() — for from_email 'zebra@...' the initial is 'Z'
                const avatars = screen.getAllByText('Z');
                expect(avatars.length).toBeGreaterThanOrEqual(1);
            });
        });

        it('rapidly toggling expand/collapse does not corrupt expand state', async () => {
            const threadEmails = [
                { ...mockEmail, id: 'rapid-1', from_name: 'Alice', snippet: 'First', body_html: '<p>First</p>' },
                { ...mockEmail, id: 'rapid-2', from_name: 'Bob', snippet: 'Last', body_html: '<p>Last</p>' },
            ];
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'emails:thread') return threadEmails;
                return null;
            });
            useEmailStore.setState({ selectedEmail: { ...mockEmail, thread_id: 'thread-rapid' } });
            renderReadingPane();

            await waitFor(() => {
                expect(screen.getAllByLabelText('readingPane.expandMessage').length).toBeGreaterThanOrEqual(1);
            });

            const expandBtn = screen.getAllByLabelText('readingPane.expandMessage')[0];

            // Rapid toggle: click 3 times (expand → collapse → expand)
            fireEvent.click(expandBtn);
            await waitFor(() => {
                expect(screen.getAllByLabelText('readingPane.collapseMessage').length).toBeGreaterThanOrEqual(2);
            });

            const collapseBtn = screen.getAllByLabelText('readingPane.collapseMessage').find(
                btn => !(btn as HTMLButtonElement).disabled
            );
            if (collapseBtn) {
                fireEvent.click(collapseBtn);
                await waitFor(() => {
                    expect(screen.getAllByLabelText('readingPane.expandMessage').length).toBeGreaterThanOrEqual(1);
                });

                // Expand again — should be stable
                const expandBtnAgain = screen.getAllByLabelText('readingPane.expandMessage')[0];
                fireEvent.click(expandBtnAgain);
                await waitFor(() => {
                    expect(screen.getAllByLabelText('readingPane.collapseMessage').length).toBeGreaterThanOrEqual(2);
                });
            }
        });

        it('renders "(no content)" placeholder for thread message with no body_html and no body_text', async () => {
            const threadEmails: EmailFull[] = [
                { ...mockEmail, id: 'no-body-1', from_name: 'Alice', snippet: 'Empty', body_html: null, body_text: null },
                { ...mockEmail, id: 'no-body-2', from_name: 'Bob', snippet: 'Empty2', body_html: null, body_text: null },
            ];
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'emails:thread') return threadEmails;
                return null;
            });
            useEmailStore.setState({ selectedEmail: { ...mockEmail, thread_id: 'thread-nobody', body_html: null, body_text: null } });
            renderReadingPane();

            await waitFor(() => {
                // The last thread message is always expanded; it has no body, so "(no content)" must appear
                expect(screen.getByText('readingPane.noContent')).toBeInTheDocument();
            });
        });
    });

    // --- AI Reply Tests ---

    describe('AI Reply', () => {
        it('renders AI Reply button (Sparkles icon)', () => {
            useEmailStore.setState({ selectedEmail: mockEmail });
            renderReadingPane();
            expect(screen.getByTestId('icon-Sparkles')).toBeInTheDocument();
        });

        it('calls ai:suggest-reply IPC and triggers onReply on success', async () => {
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'settings:get') return null;
                if (channel === 'settings:set') return null;
                if (channel === 'ai:suggest-reply') return { html: '<p>AI reply</p>' };
                return null;
            });
            useEmailStore.setState({ selectedEmail: mockEmail });
            const onReply = vi.fn();
            renderReadingPane({ onReply });

            // Click the AI Reply dropdown trigger (button with title readingPane.aiReply)
            const aiReplyBtn = screen.getByTitle('readingPane.aiReply');
            fireEvent.click(aiReplyBtn);

            // Wait for tone menu items to appear and click the first one
            await waitFor(() => {
                expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
            });
            const toneItems = screen.getAllByRole('menuitem');
            fireEvent.click(toneItems[0]);

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('ai:suggest-reply', expect.objectContaining({
                    emailId: 'email-1',
                    accountId: 'acc-1',
                }));
                expect(onReply).toHaveBeenCalledWith(mockEmail, '<p>AI reply</p>');
            });
        });

        it('shows error when AI reply fails', async () => {
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'settings:get') return null;
                if (channel === 'settings:set') return null;
                if (channel === 'ai:suggest-reply') return { error: 'No API key' };
                return null;
            });
            useEmailStore.setState({ selectedEmail: mockEmail });
            const onReply = vi.fn();
            const onToast = vi.fn();
            renderReadingPane({ onReply, onToast });

            const aiReplyBtn = screen.getByTitle('readingPane.aiReply');
            fireEvent.click(aiReplyBtn);

            await waitFor(() => {
                expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
            });
            const toneItems = screen.getAllByRole('menuitem');
            fireEvent.click(toneItems[0]);

            await waitFor(() => {
                expect(onToast).toHaveBeenCalledWith('No API key');
            });
            expect(onReply).not.toHaveBeenCalled();
        });

        // -------------------------------------------------------------------
        // Edge cases
        // -------------------------------------------------------------------

        it('does not call ai:suggest-reply when onReply prop is undefined', async () => {
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'settings:get') return null;
                if (channel === 'settings:set') return null;
                if (channel === 'ai:suggest-reply') return { html: '<p>AI reply</p>' };
                return null;
            });
            useEmailStore.setState({ selectedEmail: mockEmail });
            // Render WITHOUT onReply prop — handleAiReply must short-circuit
            renderReadingPane();

            const aiReplyBtn = screen.getByTitle('readingPane.aiReply');
            fireEvent.click(aiReplyBtn);

            await waitFor(() => {
                expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
            });
            const toneItems = screen.getAllByRole('menuitem');
            fireEvent.click(toneItems[0]);

            // ai:suggest-reply must NOT have been called because !onReply guard fires first
            await new Promise(r => setTimeout(r, 50));
            expect(mockIpcInvoke).not.toHaveBeenCalledWith('ai:suggest-reply', expect.anything());
        });

        it('routes AI reply error through onToast and succeeds on second call', async () => {
            let callCount = 0;
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'settings:get') return null;
                if (channel === 'settings:set') return null;
                if (channel === 'ai:suggest-reply') {
                    callCount++;
                    if (callCount === 1) return { error: 'API error on first call' };
                    return { html: '<p>Success on second call</p>' };
                }
                return null;
            });
            useEmailStore.setState({ selectedEmail: mockEmail });
            const onReply = vi.fn();
            const onToast = vi.fn();
            renderReadingPane({ onReply, onToast });

            // First call: trigger error — onToast should be called, no inline alert
            const aiReplyBtn = screen.getByTitle('readingPane.aiReply');
            fireEvent.click(aiReplyBtn);
            await waitFor(() => expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0));
            fireEvent.click(screen.getAllByRole('menuitem')[0]);

            await waitFor(() => {
                expect(onToast).toHaveBeenCalledWith('API error on first call');
            });

            // Second call: trigger success
            fireEvent.click(aiReplyBtn);
            await waitFor(() => expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0));
            fireEvent.click(screen.getAllByRole('menuitem')[0]);

            await waitFor(() => {
                expect(onReply).toHaveBeenCalledWith(mockEmail, '<p>Success on second call</p>');
            });
        });

        it('shows network-level error when ai:suggest-reply IPC throws', async () => {
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'settings:get') return null;
                if (channel === 'settings:set') return null;
                if (channel === 'ai:suggest-reply') throw new Error('Network failure');
                return null;
            });
            useEmailStore.setState({ selectedEmail: mockEmail });
            const onReply = vi.fn();
            const onToast = vi.fn();
            renderReadingPane({ onReply, onToast });

            const aiReplyBtn = screen.getByTitle('readingPane.aiReply');
            fireEvent.click(aiReplyBtn);

            await waitFor(() => expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0));
            fireEvent.click(screen.getAllByRole('menuitem')[0]);

            // Component calls onToast with the fallback i18n key when the IPC throws
            await waitFor(() => {
                expect(onToast).toHaveBeenCalledWith(expect.stringContaining('readingPane.aiReplyFailed'));
            });
            expect(onReply).not.toHaveBeenCalled();
        });

        it('disables AI Reply button while a request is in flight', async () => {
            let resolveRequest!: (v: unknown) => void;
            const pendingPromise = new Promise(resolve => { resolveRequest = resolve; });

            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'settings:get') return null;
                if (channel === 'settings:set') return null;
                if (channel === 'ai:suggest-reply') return pendingPromise;
                return null;
            });
            useEmailStore.setState({ selectedEmail: mockEmail });
            renderReadingPane({ onReply: vi.fn() });

            const aiReplyBtn = screen.getByTitle('readingPane.aiReply');
            fireEvent.click(aiReplyBtn);
            await waitFor(() => expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0));
            fireEvent.click(screen.getAllByRole('menuitem')[0]);

            // While the request is still pending the button must be disabled
            await waitFor(() => {
                expect(screen.getByTitle('readingPane.aiReply')).toBeDisabled();
            });

            // Clean up the pending promise
            resolveRequest({ html: '<p>Done</p>' });
        });

        it('saves selected tone to settings:set when a tone is picked', async () => {
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'settings:get') return null;
                if (channel === 'settings:set') return null;
                if (channel === 'ai:suggest-reply') return { html: '<p>OK</p>' };
                return null;
            });
            useEmailStore.setState({ selectedEmail: mockEmail });
            renderReadingPane({ onReply: vi.fn() });

            const aiReplyBtn = screen.getByTitle('readingPane.aiReply');
            fireEvent.click(aiReplyBtn);

            await waitFor(() => expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0));
            // The first tone is 'professional'
            fireEvent.click(screen.getAllByRole('menuitem')[0]);

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('settings:set', 'ai_compose_tone', 'professional');
            });
        });

        it('passes the selected account_id from the email to ai:suggest-reply', async () => {
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'settings:get') return null;
                if (channel === 'settings:set') return null;
                if (channel === 'ai:suggest-reply') return { html: '<p>OK</p>' };
                return null;
            });
            const emailWithAccount = { ...mockEmail, account_id: 'acc-specific-99' };
            useEmailStore.setState({ selectedEmail: emailWithAccount });
            renderReadingPane({ onReply: vi.fn() });

            const aiReplyBtn = screen.getByTitle('readingPane.aiReply');
            fireEvent.click(aiReplyBtn);
            await waitFor(() => expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0));
            fireEvent.click(screen.getAllByRole('menuitem')[0]);

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('ai:suggest-reply', expect.objectContaining({
                    accountId: 'acc-specific-99',
                }));
            });
        });
    });
});
