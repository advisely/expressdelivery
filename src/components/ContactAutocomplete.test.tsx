import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ContactAutocomplete } from './ContactAutocomplete';
import { ipcInvoke } from '../lib/ipc';

vi.mock('../lib/ipc', () => ({
    ipcInvoke: vi.fn(),
}));

const mockIpcInvoke = vi.mocked(ipcInvoke);

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const CONTACTS = [
    { id: '1', email: 'alice@example.com', name: 'Alice Smith' },
    { id: '2', email: 'bob@example.com', name: null },
    { id: '3', email: 'charlie@example.com', name: 'Charlie Brown' },
];

// ---------------------------------------------------------------------------
// Helper: render with controlled value/onChange pair
// ---------------------------------------------------------------------------

function renderAutocomplete(initialValue = '', id = 'to-field') {
    let currentValue = initialValue;
    const onChange = vi.fn((newVal: string) => {
        currentValue = newVal;
    });

    const utils = render(
        <ContactAutocomplete
            id={id}
            value={currentValue}
            onChange={onChange}
            placeholder="Recipient..."
        />
    );

    return { ...utils, onChange, getCurrentValue: () => currentValue };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContactAutocomplete', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIpcInvoke.mockResolvedValue([]);
    });

    // -------------------------------------------------------------------------
    // ARIA / accessibility
    // -------------------------------------------------------------------------

    it('renders an input with role="combobox"', () => {
        renderAutocomplete();
        expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('sets aria-expanded="false" when suggestions are hidden', () => {
        renderAutocomplete();
        expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
    });

    it('sets aria-autocomplete="list" on the combobox input', () => {
        renderAutocomplete();
        expect(screen.getByRole('combobox')).toHaveAttribute('aria-autocomplete', 'list');
    });

    it('sets aria-haspopup="listbox" on the combobox input', () => {
        renderAutocomplete();
        expect(screen.getByRole('combobox')).toHaveAttribute('aria-haspopup', 'listbox');
    });

    it('sets aria-controls matching the listbox id', () => {
        renderAutocomplete('', 'my-input');
        expect(screen.getByRole('combobox')).toHaveAttribute('aria-controls', 'my-input-listbox');
    });

    it('does not render a listbox when no suggestions are available', () => {
        renderAutocomplete();
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    // -------------------------------------------------------------------------
    // Search debounce: short query (<2 chars) does NOT invoke IPC
    // -------------------------------------------------------------------------

    it('does not call IPC when the search term is less than 2 characters', async () => {
        const { rerender } = render(
            <ContactAutocomplete id="to" value="" onChange={vi.fn()} />
        );
        rerender(<ContactAutocomplete id="to" value="a" onChange={vi.fn()} />);
        // Wait past the 200ms debounce to confirm no call happened
        await new Promise(resolve => setTimeout(resolve, 250));
        expect(mockIpcInvoke).not.toHaveBeenCalled();
    });

    it('does not call IPC for an empty value', async () => {
        render(<ContactAutocomplete id="to" value="" onChange={vi.fn()} />);
        await new Promise(resolve => setTimeout(resolve, 250));
        expect(mockIpcInvoke).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Search debounce: term ≥2 chars fires IPC after 200ms
    // -------------------------------------------------------------------------

    it('calls contacts:search IPC after debounce when term has 2+ chars', async () => {
        mockIpcInvoke.mockResolvedValue(CONTACTS);
        render(<ContactAutocomplete id="to" value="al" onChange={vi.fn()} />);

        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('contacts:search', 'al');
        }, { timeout: 500 });
    });

    it('passes the last comma-delimited segment as the search term', async () => {
        mockIpcInvoke.mockResolvedValue(CONTACTS);
        // "Bob <bob@test.com>, ali" — term is "ali"
        render(<ContactAutocomplete id="to" value="Bob <bob@test.com>, ali" onChange={vi.fn()} />);

        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('contacts:search', 'ali');
        }, { timeout: 500 });
    });

    // -------------------------------------------------------------------------
    // Suggestion list rendering
    // -------------------------------------------------------------------------

    it('renders a listbox when contacts are returned', async () => {
        mockIpcInvoke.mockResolvedValue(CONTACTS);
        render(<ContactAutocomplete id="to" value="ali" onChange={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByRole('listbox')).toBeInTheDocument();
        }, { timeout: 500 });
    });

    it('renders one option per returned contact', async () => {
        mockIpcInvoke.mockResolvedValue(CONTACTS);
        render(<ContactAutocomplete id="to" value="ali" onChange={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getAllByRole('option')).toHaveLength(3);
        }, { timeout: 500 });
    });

    it('shows contact name as primary text when name is set', async () => {
        mockIpcInvoke.mockResolvedValue([CONTACTS[0]]); // Alice Smith
        render(<ContactAutocomplete id="to" value="ali" onChange={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText('Alice Smith')).toBeInTheDocument();
            expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        }, { timeout: 500 });
    });

    it('shows email as primary text when name is null', async () => {
        mockIpcInvoke.mockResolvedValue([CONTACTS[1]]); // bob, no name
        render(<ContactAutocomplete id="to" value="bo" onChange={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText('bob@example.com')).toBeInTheDocument();
        }, { timeout: 500 });
    });

    it('does not render listbox when IPC returns empty array', async () => {
        mockIpcInvoke.mockResolvedValue([]);
        render(<ContactAutocomplete id="to" value="zzz" onChange={vi.fn()} />);
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('sets aria-expanded="true" when suggestions are shown', async () => {
        mockIpcInvoke.mockResolvedValue(CONTACTS);
        render(<ContactAutocomplete id="to" value="ali" onChange={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
        }, { timeout: 500 });
    });

    // -------------------------------------------------------------------------
    // Mouse selection
    // -------------------------------------------------------------------------

    it('calls onChange with formatted value when a named contact is clicked', async () => {
        mockIpcInvoke.mockResolvedValue([CONTACTS[0]]);
        const onChange = vi.fn();
        render(<ContactAutocomplete id="to" value="ali" onChange={onChange} />);

        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });
        fireEvent.mouseDown(screen.getByText('Alice Smith').closest('[role="option"]')!);
        expect(onChange).toHaveBeenCalledWith('Alice Smith <alice@example.com>, ');
    });

    it('calls onChange with email only when contact has no name', async () => {
        mockIpcInvoke.mockResolvedValue([CONTACTS[1]]);
        const onChange = vi.fn();
        render(<ContactAutocomplete id="to" value="bo" onChange={onChange} />);

        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });
        fireEvent.mouseDown(screen.getAllByRole('option')[0]);
        expect(onChange).toHaveBeenCalledWith('bob@example.com, ');
    });

    it('replaces the last incomplete token when a prior recipient exists', async () => {
        mockIpcInvoke.mockResolvedValue([CONTACTS[0]]);
        const onChange = vi.fn();
        render(<ContactAutocomplete id="to" value="first@test.com, ali" onChange={onChange} />);

        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });
        fireEvent.mouseDown(screen.getByText('Alice Smith').closest('[role="option"]')!);
        expect(onChange).toHaveBeenCalledWith('first@test.com, Alice Smith <alice@example.com>, ');
    });

    it('hides the listbox after selection', async () => {
        mockIpcInvoke.mockResolvedValue([CONTACTS[0]]);
        const onChange = vi.fn();
        render(<ContactAutocomplete id="to" value="ali" onChange={onChange} />);

        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });
        fireEvent.mouseDown(screen.getAllByRole('option')[0]);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    // -------------------------------------------------------------------------
    // Keyboard navigation
    // -------------------------------------------------------------------------

    it('ArrowDown moves highlight to the first option', async () => {
        mockIpcInvoke.mockResolvedValue(CONTACTS);
        render(<ContactAutocomplete id="to" value="ali" onChange={vi.fn()} />);

        const input = screen.getByRole('combobox');
        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });

        fireEvent.keyDown(input, { key: 'ArrowDown' });
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveAttribute('data-highlighted', 'true');
        expect(options[1]).not.toHaveAttribute('data-highlighted');
    });

    it('ArrowDown stops at the last option (no wrap-around)', async () => {
        mockIpcInvoke.mockResolvedValue(CONTACTS); // 3 contacts
        render(<ContactAutocomplete id="to" value="ali" onChange={vi.fn()} />);

        const input = screen.getByRole('combobox');
        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });

        // Press ArrowDown 10 times — should clamp at index 2 (last)
        for (let i = 0; i < 10; i++) {
            fireEvent.keyDown(input, { key: 'ArrowDown' });
        }
        const options = screen.getAllByRole('option');
        expect(options[2]).toHaveAttribute('data-highlighted', 'true');
    });

    it('ArrowUp does not go below index 0', async () => {
        mockIpcInvoke.mockResolvedValue(CONTACTS);
        render(<ContactAutocomplete id="to" value="ali" onChange={vi.fn()} />);

        const input = screen.getByRole('combobox');
        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });

        // Move down then up past 0
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveAttribute('data-highlighted', 'true');
    });

    it('Enter selects the highlighted option', async () => {
        mockIpcInvoke.mockResolvedValue([CONTACTS[0]]);
        const onChange = vi.fn();
        render(<ContactAutocomplete id="to" value="ali" onChange={onChange} />);

        const input = screen.getByRole('combobox');
        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });

        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onChange).toHaveBeenCalledWith('Alice Smith <alice@example.com>, ');
    });

    it('Enter does nothing when no option is highlighted', async () => {
        mockIpcInvoke.mockResolvedValue([CONTACTS[0]]);
        const onChange = vi.fn();
        render(<ContactAutocomplete id="to" value="ali" onChange={onChange} />);

        const input = screen.getByRole('combobox');
        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });

        // No ArrowDown — highlight index is -1
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('Escape closes the suggestion list', async () => {
        mockIpcInvoke.mockResolvedValue(CONTACTS);
        render(<ContactAutocomplete id="to" value="ali" onChange={vi.fn()} />);

        const input = screen.getByRole('combobox');
        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });

        fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('keyboard nav does nothing when suggestions are not shown', () => {
        renderAutocomplete('');
        const input = screen.getByRole('combobox');
        // Should not throw
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    // -------------------------------------------------------------------------
    // Outside click
    // -------------------------------------------------------------------------

    it('closes the suggestion list on outside click', async () => {
        mockIpcInvoke.mockResolvedValue(CONTACTS);
        render(
            <div>
                <ContactAutocomplete id="to" value="ali" onChange={vi.fn()} />
                <button>Outside</button>
            </div>
        );

        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });

        await act(async () => {
            fireEvent.mouseDown(screen.getByText('Outside'));
        });

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    // -------------------------------------------------------------------------
    // Focus re-shows cached suggestions
    // -------------------------------------------------------------------------

    it('re-shows suggestion list on focus when suggestions are cached', async () => {
        mockIpcInvoke.mockResolvedValue(CONTACTS);
        render(<ContactAutocomplete id="to" value="ali" onChange={vi.fn()} />);

        const input = screen.getByRole('combobox');
        // Wait for suggestions to appear
        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });

        // Escape to hide
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

        // Focus re-shows
        fireEvent.focus(input);
        expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    // -------------------------------------------------------------------------
    // ARIA: active-descendant tracks keyboard highlight
    // -------------------------------------------------------------------------

    it('sets aria-activedescendant to the highlighted option id', async () => {
        mockIpcInvoke.mockResolvedValue(CONTACTS);
        render(<ContactAutocomplete id="to-field" value="ali" onChange={vi.fn()} />);

        const input = screen.getByRole('combobox');
        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });

        fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight index = 0
        expect(input).toHaveAttribute('aria-activedescendant', 'to-field-option-0');
    });

    it('clears aria-activedescendant when no option is highlighted', async () => {
        mockIpcInvoke.mockResolvedValue(CONTACTS);
        render(<ContactAutocomplete id="to-field" value="ali" onChange={vi.fn()} />);

        const input = screen.getByRole('combobox');
        await waitFor(() => screen.getByRole('listbox'), { timeout: 500 });

        // No ArrowDown: highlightIndex is -1 so activedescendant should be absent
        expect(input).not.toHaveAttribute('aria-activedescendant');
    });

    // -------------------------------------------------------------------------
    // Autocomplete attribute
    // -------------------------------------------------------------------------

    it('sets autocomplete="off" to suppress browser native autocomplete', () => {
        renderAutocomplete();
        expect(screen.getByRole('combobox')).toHaveAttribute('autocomplete', 'off');
    });
});
