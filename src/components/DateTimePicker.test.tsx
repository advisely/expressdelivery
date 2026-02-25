import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DateTimePicker from './DateTimePicker';

describe('DateTimePicker', () => {
    it('renders 3 preset buttons', () => {
        render(<DateTimePicker onSelect={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByText('datetime.laterToday')).toBeInTheDocument();
        expect(screen.getByText('datetime.tomorrow9am')).toBeInTheDocument();
        expect(screen.getByText('datetime.nextMonday')).toBeInTheDocument();
    });

    it('calls onSelect with ISO string when preset is clicked', () => {
        const onSelect = vi.fn();
        render(<DateTimePicker onSelect={onSelect} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByText('datetime.laterToday'));
        expect(onSelect).toHaveBeenCalledTimes(1);
        // Verify the argument is a valid ISO string
        const arg = onSelect.mock.calls[0][0] as string;
        expect(new Date(arg).toISOString()).toBe(arg);
    });

    it('renders custom datetime input with min attribute', () => {
        render(<DateTimePicker onSelect={vi.fn()} onCancel={vi.fn()} />);
        const input = screen.getByLabelText('datetime.pickCustom');
        expect(input).toHaveAttribute('type', 'datetime-local');
        expect(input).toHaveAttribute('min');
    });

    it('calls onCancel when Cancel button is clicked', () => {
        const onCancel = vi.fn();
        render(<DateTimePicker onSelect={vi.fn()} onCancel={onCancel} />);
        fireEvent.click(screen.getByText('datetime.cancel'));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('renders label when provided', () => {
        render(<DateTimePicker onSelect={vi.fn()} onCancel={vi.fn()} label="Schedule for" />);
        expect(screen.getByText('Schedule for')).toBeInTheDocument();
    });

    it('does not render label when not provided', () => {
        render(<DateTimePicker onSelect={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.queryByText('Schedule for')).not.toBeInTheDocument();
    });
});
