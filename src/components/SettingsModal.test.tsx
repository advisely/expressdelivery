import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import { ThemeProvider } from './ThemeContext';
import { useThemeStore } from '../stores/themeStore';

// Mock lucide icons to avoid SVGs cluttering snapshots and dom queries
vi.mock('lucide-react', () => ({
    X: () => <div data-testid="icon-X">X</div>,
    Layout: () => <div data-testid="icon-Layout">L</div>,
    Monitor: () => <div data-testid="icon-Monitor">M</div>,
    Moon: () => <div data-testid="icon-Moon">N</div>,
    Sun: () => <div data-testid="icon-Sun">S</div>,
    MonitorPlay: () => <div data-testid="icon-MonitorPlay">MP</div>,
    Droplets: () => <div data-testid="icon-Droplets">D</div>,
}));

describe('SettingsModal Integration Tests', () => {
    it('renders all customized themes and pane layouts correctly', () => {
        render(
            <ThemeProvider>
                <SettingsModal onClose={() => { }} />
            </ThemeProvider>
        );

        // Verify themes from Zustand store are mapped
        expect(screen.getByText('Light')).toBeInTheDocument();
        expect(screen.getByText('Cream')).toBeInTheDocument();
        expect(screen.getByText('Midnight')).toBeInTheDocument();
        expect(screen.getByText('Forest')).toBeInTheDocument();

        // Verify Application Layout Options
        expect(screen.getByText('Vertical Split (3-Pane)')).toBeInTheDocument();
        expect(screen.getByText('Horizontal Split')).toBeInTheDocument();
    });

    it('updates global Zustand store when new themes are clicked', () => {
        // Reset state
        useThemeStore.setState({ themeName: 'light' });

        render(
            <ThemeProvider>
                <SettingsModal onClose={() => { }} />
            </ThemeProvider>
        );

        const midnightBtn = screen.getByText('Midnight');
        fireEvent.click(midnightBtn);

        // Verify Zustand state updated via the button press
        expect(useThemeStore.getState().themeName).toBe('midnight');

        const forestBtn = screen.getByText('Forest');
        fireEvent.click(forestBtn);
        expect(useThemeStore.getState().themeName).toBe('forest');
    });

    it('triggers onClose when close icon is hit', () => {
        const mockClose = vi.fn();
        const { container } = render(
            <ThemeProvider>
                <SettingsModal onClose={mockClose} />
            </ThemeProvider>
        );

        const closeBtn = container.querySelector('.close-btn');
        expect(closeBtn).not.toBeNull();

        fireEvent.click(closeBtn!);
        expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('applies the active class only to the selected options', () => {
        // Light theme by default
        useThemeStore.setState({ themeName: 'light' });

        render(
            <ThemeProvider>
                <SettingsModal onClose={() => { }} />
            </ThemeProvider>
        );

        const lightBtn = screen.getByText('Light').closest('button');
        const midnightBtn = screen.getByText('Midnight').closest('button');

        expect(lightBtn).toHaveClass('active');
        expect(midnightBtn).not.toHaveClass('active');

        // Layouts
        const verticalBtn = screen.getByText('Vertical Split (3-Pane)').closest('button');
        const horizontalBtn = screen.getByText('Horizontal Split').closest('button');

        // Vertical split is standard default in ThemeProvider logic
        expect(verticalBtn).toHaveClass('active');
        expect(horizontalBtn).not.toHaveClass('active');

        // Switch layout
        fireEvent.click(horizontalBtn!);
        expect(verticalBtn).not.toHaveClass('active');
        expect(horizontalBtn).toHaveClass('active');
    });
});
