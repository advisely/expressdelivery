import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

// Mock lucide-react icons to keep DOM simple and avoid SVG noise
vi.mock('lucide-react', () => ({
    AlertTriangle: () => <div data-testid="icon-AlertTriangle">AT</div>,
    X: () => <div data-testid="icon-X">X</div>,
}));

// react-i18next is globally mocked in vitest setup — it returns key strings as-is
// (e.g. t('confirm.cancel') returns "confirm.cancel")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RenderOptions {
    open?: boolean;
    title?: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'default' | 'danger';
    inputLabel?: string;
    inputPlaceholder?: string;
    inputDefaultValue?: string;
    inputValidator?: (value: string) => boolean;
    onConfirm?: (inputValue?: string) => void;
    onOpenChange?: (open: boolean) => void;
}

function renderDialog(overrides: RenderOptions = {}) {
    const props = {
        open: true as boolean,
        title: 'Test Dialog',
        onConfirm: vi.fn() as (inputValue?: string) => void,
        onOpenChange: vi.fn() as unknown as (open: boolean) => void,
        ...overrides,
    };

    const result = render(<ConfirmDialog {...props} />);
    return { ...result, onConfirm: props.onConfirm as ReturnType<typeof vi.fn>, onOpenChange: props.onOpenChange as unknown as ReturnType<typeof vi.fn> };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ConfirmDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // 1. Renders title and description when open
    it('renders title and description when open=true', () => {
        renderDialog({ title: 'Delete Email', description: 'This action cannot be undone.' });

        expect(screen.getByText('Delete Email')).toBeInTheDocument();
        expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
    });

    // 2. Does not render when open=false
    it('does not render dialog content when open=false', () => {
        renderDialog({ open: false, title: 'Hidden Dialog', description: 'Should not appear' });

        expect(screen.queryByText('Hidden Dialog')).not.toBeInTheDocument();
        expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
    });

    // 3. Calls onConfirm when confirm button is clicked
    it('calls onConfirm when the confirm button is clicked', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.click(screen.getByRole('button', { name: 'confirm.confirm' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    // 4. Calls onOpenChange(false) when cancel button clicked
    it('calls onOpenChange(false) when the cancel button is clicked', async () => {
        const user = userEvent.setup();
        const onOpenChange = vi.fn();
        renderDialog({ onOpenChange });

        // The footer cancel button has the i18n key as its visible text content.
        // We locate it by text to avoid the ambiguity with the header X close button
        // which also has aria-label="confirm.cancel".
        const cancelBtn = screen.getByText('confirm.cancel', { selector: 'button' });
        await user.click(cancelBtn);

        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    // 5. Shows danger variant with AlertTriangle icon
    it('renders AlertTriangle icon when variant=danger', () => {
        renderDialog({ variant: 'danger', title: 'Danger!' });

        expect(screen.getByTestId('icon-AlertTriangle')).toBeInTheDocument();
    });

    it('does not render AlertTriangle icon for default variant', () => {
        renderDialog({ variant: 'default', title: 'Normal dialog' });

        expect(screen.queryByTestId('icon-AlertTriangle')).not.toBeInTheDocument();
    });

    // 6. Prompt mode: shows input field with label and placeholder
    it('renders a text input with label and placeholder in prompt mode', () => {
        renderDialog({
            inputLabel: 'Enter folder name',
            inputPlaceholder: 'My Folder',
        });

        expect(screen.getByLabelText('Enter folder name')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('My Folder')).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('does not render an input field when inputLabel is not provided', () => {
        renderDialog({ title: 'Simple confirm' });

        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    // 7. Prompt mode: passes input value to onConfirm
    it('passes the typed input value to onConfirm in prompt mode', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        renderDialog({
            onConfirm,
            inputLabel: 'Rename to',
            inputPlaceholder: 'New name',
        });

        const input = screen.getByRole('textbox');
        await user.clear(input);
        await user.type(input, 'My Custom Value');

        fireEvent.click(screen.getByRole('button', { name: 'confirm.confirm' }));

        expect(onConfirm).toHaveBeenCalledWith('My Custom Value');
    });

    // 8. Prompt mode: disables confirm when validator returns false
    it('disables confirm button when inputValidator returns false', async () => {
        const user = userEvent.setup();
        const validator = vi.fn(() => false);
        renderDialog({
            inputLabel: 'Tag name',
            inputValidator: validator,
        });

        const input = screen.getByRole('textbox');
        await user.type(input, 'invalid');

        const confirmBtn = screen.getByRole('button', { name: 'confirm.confirm' });
        expect(confirmBtn).toBeDisabled();
    });

    // 9. Prompt mode: enables confirm when validator returns true
    it('enables confirm button when inputValidator returns true', async () => {
        const user = userEvent.setup();
        const validator = (value: string) => value.length >= 3;
        renderDialog({
            inputLabel: 'Tag name',
            inputValidator: validator,
        });

        const input = screen.getByRole('textbox');
        await user.type(input, 'abc');

        const confirmBtn = screen.getByRole('button', { name: 'confirm.confirm' });
        expect(confirmBtn).not.toBeDisabled();
    });

    it('disables confirm when typed value is too short (validator returns false) but enables after more input', async () => {
        const user = userEvent.setup();
        const validator = (value: string) => value.trim().length > 0;
        renderDialog({
            inputLabel: 'Search name',
            inputDefaultValue: '',
            inputValidator: validator,
        });

        const confirmBtn = screen.getByRole('button', { name: 'confirm.confirm' });

        // Initially empty — should be disabled
        expect(confirmBtn).toBeDisabled();

        // Type a value — should be enabled
        await user.type(screen.getByRole('textbox'), 'x');
        expect(confirmBtn).not.toBeDisabled();
    });

    // 10. Enter key triggers confirm
    it('triggers confirm when Enter key is pressed and isValid=true', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        renderDialog({
            onConfirm,
            inputLabel: 'Folder name',
            inputDefaultValue: 'Inbox',
        });

        const input = screen.getByRole('textbox');
        await user.click(input);
        await user.keyboard('{Enter}');

        expect(onConfirm).toHaveBeenCalledWith('Inbox');
    });

    // 11. Enter key does NOT trigger confirm when validator returns false
    it('does not trigger confirm when Enter key is pressed and validator returns false', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        const validator = vi.fn(() => false);
        renderDialog({
            onConfirm,
            inputLabel: 'Folder name',
            inputValidator: validator,
        });

        const input = screen.getByRole('textbox');
        await user.click(input);
        await user.keyboard('{Enter}');

        expect(onConfirm).not.toHaveBeenCalled();
    });

    // 12. Uses i18n keys for default button labels
    it('uses i18n key confirm.cancel for cancel button by default', () => {
        renderDialog();

        // The cancel button inside confirm-actions uses the i18n key
        // There are two Dialog.Close elements (header X and footer cancel)
        // The one accessible as button with name "confirm.cancel" is the header close
        // The footer cancel button text is the i18n key string returned by the mock
        expect(screen.getAllByText('confirm.cancel').length).toBeGreaterThanOrEqual(1);
    });

    it('uses i18n key confirm.confirm for confirm button by default', () => {
        renderDialog();

        expect(screen.getByRole('button', { name: 'confirm.confirm' })).toBeInTheDocument();
    });

    // 13. Custom confirmLabel and cancelLabel override defaults
    it('renders custom confirmLabel when provided', () => {
        renderDialog({ confirmLabel: 'Yes, Delete It' });

        expect(screen.getByRole('button', { name: 'Yes, Delete It' })).toBeInTheDocument();
        expect(screen.queryByText('confirm.confirm')).not.toBeInTheDocument();
    });

    it('renders custom cancelLabel when provided', () => {
        renderDialog({ cancelLabel: 'No, Go Back' });

        expect(screen.getByText('No, Go Back')).toBeInTheDocument();
        expect(screen.queryByText('confirm.cancel')).not.toBeInTheDocument();
    });

    it('renders both custom confirmLabel and cancelLabel simultaneously', () => {
        renderDialog({ confirmLabel: 'Proceed', cancelLabel: 'Abort' });

        expect(screen.getByRole('button', { name: 'Proceed' })).toBeInTheDocument();
        expect(screen.getByText('Abort')).toBeInTheDocument();
    });

    // ---------------------------------------------------------------------------
    // Additional edge cases
    // ---------------------------------------------------------------------------

    it('calls onOpenChange(false) after confirm button is clicked', () => {
        const onOpenChange = vi.fn();
        renderDialog({ onOpenChange });

        fireEvent.click(screen.getByRole('button', { name: 'confirm.confirm' }));

        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('does not call onConfirm when confirm button is disabled (invalid)', () => {
        const onConfirm = vi.fn();
        const validator = vi.fn(() => false);
        renderDialog({
            onConfirm,
            inputLabel: 'Required field',
            inputValidator: validator,
        });

        fireEvent.click(screen.getByRole('button', { name: 'confirm.confirm' }));

        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('passes undefined to onConfirm when not in prompt mode', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.click(screen.getByRole('button', { name: 'confirm.confirm' }));

        expect(onConfirm).toHaveBeenCalledWith(undefined);
    });

    it('renders description only when provided', () => {
        const { rerender } = renderDialog({ title: 'No Desc', description: undefined });

        // When no description, Dialog.Description element should not be in the DOM
        expect(screen.queryByText('Some desc')).not.toBeInTheDocument();

        rerender(
            <ConfirmDialog
                open={true}
                title="With Desc"
                description="Some desc"
                onConfirm={vi.fn()}
                onOpenChange={vi.fn()}
            />
        );

        expect(screen.getByText('Some desc')).toBeInTheDocument();
    });

    it('renders inputDefaultValue as the initial input value', () => {
        renderDialog({
            inputLabel: 'Rename',
            inputDefaultValue: 'Original Name',
        });

        expect(screen.getByDisplayValue('Original Name')).toBeInTheDocument();
    });

    it('resets input value to inputDefaultValue when dialog reopens', async () => {
        const onOpenChange = vi.fn();
        const { rerender } = renderDialog({
            open: true,
            inputLabel: 'Name',
            inputDefaultValue: 'Default',
            onOpenChange,
            onConfirm: vi.fn(),
        });

        // Type something new
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'Changed' } });
        expect(screen.getByDisplayValue('Changed')).toBeInTheDocument();

        // Close and reopen the dialog
        rerender(
            <ConfirmDialog
                open={false}
                title="Test"
                inputLabel="Name"
                inputDefaultValue="Default"
                onConfirm={vi.fn()}
                onOpenChange={onOpenChange}
            />
        );

        rerender(
            <ConfirmDialog
                open={true}
                title="Test"
                inputLabel="Name"
                inputDefaultValue="Default"
                onConfirm={vi.fn()}
                onOpenChange={onOpenChange}
            />
        );

        // After reopening, the input value should be reset to the default
        await waitFor(() => {
            expect(screen.getByDisplayValue('Default')).toBeInTheDocument();
        });
    });

    it('confirm is enabled by default (no validator) in prompt mode', () => {
        renderDialog({
            inputLabel: 'Enter value',
            inputDefaultValue: 'something',
        });

        const confirmBtn = screen.getByRole('button', { name: 'confirm.confirm' });
        expect(confirmBtn).not.toBeDisabled();
    });

    it('confirm is enabled in non-prompt mode regardless', () => {
        renderDialog({ title: 'Are you sure?' });

        const confirmBtn = screen.getByRole('button', { name: 'confirm.confirm' });
        expect(confirmBtn).not.toBeDisabled();
    });

    it('renders X close button in dialog header', () => {
        renderDialog();

        expect(screen.getByTestId('icon-X')).toBeInTheDocument();
    });

    it('Enter key on non-prompt dialog without inputLabel confirms directly', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        // Focus the dialog content area and press Enter
        const confirmBtn = screen.getByRole('button', { name: 'confirm.confirm' });
        confirmBtn.focus();
        await user.keyboard('{Enter}');

        expect(onConfirm).toHaveBeenCalledWith(undefined);
    });
});
