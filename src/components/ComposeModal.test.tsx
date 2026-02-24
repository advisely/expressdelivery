import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComposeModal } from './ComposeModal';
import { ThemeProvider } from './ThemeContext';
import { useEmailStore } from '../stores/emailStore';
import { ipcInvoke } from '../lib/ipc';

vi.mock('../lib/ipc', () => ({
    ipcInvoke: vi.fn(),
}));

vi.mock('../lib/formatFileSize', () => ({
    formatFileSize: (bytes: number) => `${bytes} bytes`,
}));

// Mock TipTap
let mockEditorContent = '';
const mockEditor = {
    getHTML: () => mockEditorContent,
    chain: () => ({ focus: () => ({ toggleBold: () => ({ run: vi.fn() }), toggleItalic: () => ({ run: vi.fn() }), toggleUnderline: () => ({ run: vi.fn() }), toggleBulletList: () => ({ run: vi.fn() }), toggleOrderedList: () => ({ run: vi.fn() }), setLink: () => ({ run: vi.fn() }) }) }),
    isActive: () => false,
    on: vi.fn(),
    off: vi.fn(),
};

vi.mock('@tiptap/react', () => ({
    useEditor: () => mockEditor,
    EditorContent: ({ className }: { className?: string; editor: unknown }) => (
        <div className={className} data-testid="compose-editor" contentEditable>
            <div className="tiptap">{mockEditorContent}</div>
        </div>
    ),
}));

vi.mock('@tiptap/starter-kit', () => ({ default: {} }));
vi.mock('@tiptap/extension-link', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-underline', () => ({ default: {} }));

vi.mock('dompurify', () => ({
    default: { sanitize: (html: string) => html },
}));

vi.mock('lucide-react', () => ({
    X: () => <div data-testid="icon-X">X</div>,
    Send: () => <div data-testid="icon-Send">S</div>,
    Paperclip: () => <div data-testid="icon-Paperclip">P</div>,
    Bold: () => <div data-testid="icon-Bold">B</div>,
    Italic: () => <div data-testid="icon-Italic">I</div>,
    Underline: () => <div data-testid="icon-Underline">U</div>,
    List: () => <div data-testid="icon-List">L</div>,
    ListOrdered: () => <div data-testid="icon-ListOrdered">LO</div>,
    Link: () => <div data-testid="icon-Link">Lk</div>,
    ChevronDown: () => <div data-testid="icon-ChevronDown">CD</div>,
    ChevronUp: () => <div data-testid="icon-ChevronUp">CU</div>,
}));

// Mock ContactAutocomplete to a simple input for testing
vi.mock('./ContactAutocomplete', () => ({
    ContactAutocomplete: ({ id, value, onChange, placeholder, className }: {
        id: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
    }) => (
        <input
            id={id}
            className={className}
            placeholder={placeholder}
            value={value}
            onChange={e => onChange(e.target.value)}
            data-testid={`autocomplete-${id}`}
        />
    ),
}));

const mockIpcInvoke = vi.mocked(ipcInvoke);

function renderCompose(props: Partial<Parameters<typeof ComposeModal>[0]> = {}) {
    const defaultProps = { onClose: vi.fn() };
    return render(
        <ThemeProvider>
            <ComposeModal {...defaultProps} {...props} />
        </ThemeProvider>
    );
}

describe('ComposeModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIpcInvoke.mockResolvedValue(null);
        mockEditorContent = '';
        // Set up a test account in the store
        useEmailStore.setState({
            accounts: [{ id: 'acc-1', email: 'test@example.com', provider: 'gmail', display_name: 'Test', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null, signature_html: null }],
        });
    });

    it('renders compose form with title and all fields', () => {
        renderCompose();
        expect(screen.getByText('New Message')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Recipient...')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Subject...')).toBeInTheDocument();
        expect(screen.getByTestId('compose-editor')).toBeInTheDocument();
    });

    it('does not have glass class on modal element', () => {
        renderCompose();
        const modal = document.querySelector('.compose-modal');
        expect(modal).toBeTruthy();
        expect(modal?.classList.contains('glass')).toBe(false);
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        renderCompose({ onClose });
        fireEvent.click(screen.getByLabelText('Close compose'));
        expect(onClose).toHaveBeenCalled();
    });

    it('shows CC/BCC fields when toggle is clicked', () => {
        renderCompose();
        expect(screen.queryByPlaceholderText('CC recipients...')).not.toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Toggle CC and BCC fields'));
        expect(screen.getByPlaceholderText('CC recipients...')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('BCC recipients...')).toBeInTheDocument();
    });

    it('shows validation error when To is empty on send', async () => {
        renderCompose();
        fireEvent.click(screen.getByText('Send'));
        expect(screen.getByRole('alert')).toHaveTextContent('Recipient is required');
    });

    it('shows validation error when Subject is empty on send', async () => {
        renderCompose();
        fireEvent.change(screen.getByPlaceholderText('Recipient...'), { target: { value: 'user@test.com' } });
        fireEvent.click(screen.getByText('Send'));
        expect(screen.getByRole('alert')).toHaveTextContent('Subject is required');
    });

    it('calls email:send IPC with correct params on successful send', async () => {
        mockIpcInvoke.mockResolvedValueOnce({ success: true });
        const onClose = vi.fn();
        mockEditorContent = '<p>Hello world</p>';
        renderCompose({ onClose });

        fireEvent.change(screen.getByPlaceholderText('Recipient...'), { target: { value: 'user@test.com' } });
        fireEvent.change(screen.getByPlaceholderText('Subject...'), { target: { value: 'Test Subject' } });
        fireEvent.click(screen.getByText('Send'));

        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('email:send', expect.objectContaining({
                accountId: 'acc-1',
                to: ['user@test.com'],
                subject: 'Test Subject',
            }));
        });

        await waitFor(() => {
            expect(onClose).toHaveBeenCalled();
        });
    });

    it('pre-fills fields from initialTo and initialSubject', () => {
        renderCompose({
            initialTo: 'reply@test.com',
            initialSubject: 'Re: Hello',
            initialBody: 'Original message',
        });
        expect(screen.getByPlaceholderText('Recipient...')).toHaveValue('reply@test.com');
        expect(screen.getByPlaceholderText('Subject...')).toHaveValue('Re: Hello');
    });

    it('shows error when no account is configured', async () => {
        useEmailStore.setState({ accounts: [] });
        renderCompose();
        fireEvent.change(screen.getByPlaceholderText('Recipient...'), { target: { value: 'user@test.com' } });
        fireEvent.change(screen.getByPlaceholderText('Subject...'), { target: { value: 'Sub' } });
        fireEvent.click(screen.getByText('Send'));
        expect(screen.getByRole('alert')).toHaveTextContent('No account configured');
    });

    it('renders toolbar with formatting buttons', () => {
        renderCompose();
        expect(screen.getByTitle('Bold')).toBeInTheDocument();
        expect(screen.getByTitle('Italic')).toBeInTheDocument();
        expect(screen.getByTitle('Underline')).toBeInTheDocument();
        expect(screen.getByTitle('Bullet List')).toBeInTheDocument();
        expect(screen.getByTitle('Ordered List')).toBeInTheDocument();
        expect(screen.getByTitle('Insert Link')).toBeInTheDocument();
        expect(screen.getByTitle('Attach Files')).toBeInTheDocument();
    });

    it('adds attachments when file picker returns files', async () => {
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'dialog:open-file') {
                return [{ filename: 'doc.pdf', content: 'base64data', contentType: 'application/pdf', size: 5000 }];
            }
            return null;
        });
        renderCompose();
        fireEvent.click(screen.getByTitle('Attach Files'));
        await waitFor(() => {
            expect(screen.getByText('doc.pdf')).toBeInTheDocument();
            expect(screen.getByText('5000 bytes')).toBeInTheDocument();
        });
    });

    it('allows removing an attachment', async () => {
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'dialog:open-file') {
                return [{ filename: 'doc.pdf', content: 'base64data', contentType: 'application/pdf', size: 5000 }];
            }
            return null;
        });
        renderCompose();
        fireEvent.click(screen.getByTitle('Attach Files'));
        await waitFor(() => {
            expect(screen.getByText('doc.pdf')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByLabelText('Remove doc.pdf'));
        expect(screen.queryByText('doc.pdf')).not.toBeInTheDocument();
    });

    it('includes attachments in send payload', async () => {
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'dialog:open-file') {
                return [{ filename: 'doc.pdf', content: 'base64data', contentType: 'application/pdf', size: 5000 }];
            }
            if (channel === 'email:send') return { success: true };
            return null;
        });
        const onClose = vi.fn();
        renderCompose({ onClose });

        fireEvent.click(screen.getByTitle('Attach Files'));
        await waitFor(() => expect(screen.getByText('doc.pdf')).toBeInTheDocument());

        fireEvent.change(screen.getByPlaceholderText('Recipient...'), { target: { value: 'user@test.com' } });
        fireEvent.change(screen.getByPlaceholderText('Subject...'), { target: { value: 'With attachment' } });
        fireEvent.click(screen.getByText('Send'));

        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('email:send', expect.objectContaining({
                attachments: [{ filename: 'doc.pdf', content: 'base64data', contentType: 'application/pdf' }],
            }));
        });
    });

    it('shows signature preview when account has signature', () => {
        useEmailStore.setState({
            accounts: [{ id: 'acc-1', email: 'test@example.com', provider: 'gmail', display_name: 'Test', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null, signature_html: 'Best regards,<br />Test' }],
        });
        renderCompose();
        expect(screen.getByText(/Best regards/)).toBeInTheDocument();
    });

    it('does not show signature preview when account has no signature', () => {
        renderCompose();
        expect(screen.queryByText(/Best regards/)).not.toBeInTheDocument();
    });

    it('appends signature to HTML in send payload', async () => {
        useEmailStore.setState({
            accounts: [{ id: 'acc-1', email: 'test@example.com', provider: 'gmail', display_name: 'Test', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null, signature_html: 'Best regards' }],
        });
        mockEditorContent = '<p>Hello</p>';
        mockIpcInvoke.mockResolvedValueOnce({ success: true });
        const onClose = vi.fn();
        renderCompose({ onClose });

        fireEvent.change(screen.getByPlaceholderText('Recipient...'), { target: { value: 'user@test.com' } });
        fireEvent.change(screen.getByPlaceholderText('Subject...'), { target: { value: 'Sub' } });
        fireEvent.click(screen.getByText('Send'));

        await waitFor(() => {
            const call = mockIpcInvoke.mock.calls.find(c => c[0] === 'email:send');
            expect(call).toBeTruthy();
            const payload = call![1] as { html: string };
            expect(payload.html).toContain('Best regards');
            expect(payload.html).toContain('<hr />');
        });
    });
});
