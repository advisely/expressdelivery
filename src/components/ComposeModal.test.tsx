import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComposeModal } from './ComposeModal';
import { ThemeProvider } from './ThemeContext';
import { useEmailStore } from '../stores/emailStore';
import { ipcInvoke } from '../lib/ipc';

vi.mock('../lib/ipc', () => ({
    ipcInvoke: vi.fn(),
}));

vi.mock('lucide-react', () => ({
    X: () => <div data-testid="icon-X">X</div>,
    Send: () => <div data-testid="icon-Send">S</div>,
    Paperclip: () => <div data-testid="icon-Paperclip">P</div>,
    Image: () => <div data-testid="icon-Image">I</div>,
    Type: () => <div data-testid="icon-Type">T</div>,
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
        // Set up a test account in the store
        useEmailStore.setState({
            accounts: [{ id: 'acc-1', email: 'test@example.com', provider: 'gmail', display_name: 'Test', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null }],
        });
    });

    it('renders compose form with title and all fields', () => {
        renderCompose();
        expect(screen.getByText('New Message')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Recipient...')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Subject...')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Write your beautiful email here...')).toBeInTheDocument();
    });

    it('does not have glass class on modal element', () => {
        renderCompose();
        // The dialog content should have compose-modal but NOT glass
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
        renderCompose({ onClose });

        fireEvent.change(screen.getByPlaceholderText('Recipient...'), { target: { value: 'user@test.com' } });
        fireEvent.change(screen.getByPlaceholderText('Subject...'), { target: { value: 'Test Subject' } });
        fireEvent.change(screen.getByPlaceholderText('Write your beautiful email here...'), { target: { value: 'Hello world' } });
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

    it('pre-fills fields from initialTo, initialSubject, initialBody', () => {
        renderCompose({
            initialTo: 'reply@test.com',
            initialSubject: 'Re: Hello',
            initialBody: 'Original message',
        });
        expect(screen.getByPlaceholderText('Recipient...')).toHaveValue('reply@test.com');
        expect(screen.getByPlaceholderText('Subject...')).toHaveValue('Re: Hello');
        expect(screen.getByPlaceholderText('Write your beautiful email here...')).toHaveValue('Original message');
    });

    it('shows error when no account is configured', async () => {
        useEmailStore.setState({ accounts: [] });
        renderCompose();
        fireEvent.change(screen.getByPlaceholderText('Recipient...'), { target: { value: 'user@test.com' } });
        fireEvent.change(screen.getByPlaceholderText('Subject...'), { target: { value: 'Sub' } });
        fireEvent.click(screen.getByText('Send'));
        expect(screen.getByRole('alert')).toHaveTextContent('No account configured');
    });
});
