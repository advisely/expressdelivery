import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { ThemeProvider, useLayout } from './ThemeContext';
import { useThemeStore } from '../stores/themeStore';
import type { ReactNode } from 'react';

describe('ThemeContext', () => {
    beforeEach(() => {
        // Reset theme store to defaults
        useThemeStore.setState({ themeName: 'light', layout: 'vertical' });
        // Clear classes on documentElement
        document.documentElement.className = '';
    });

    it('renders children', () => {
        render(
            <ThemeProvider>
                <div data-testid="child">Hello</div>
            </ThemeProvider>
        );
        expect(screen.getByTestId('child')).toHaveTextContent('Hello');
    });

    it('applies theme class to documentElement for non-light themes', () => {
        useThemeStore.setState({ themeName: 'midnight' });
        render(<ThemeProvider><div /></ThemeProvider>);
        expect(document.documentElement.classList.contains('theme-midnight')).toBe(true);
    });

    it('does not add theme class for light theme', () => {
        useThemeStore.setState({ themeName: 'light' });
        render(<ThemeProvider><div /></ThemeProvider>);
        expect(document.documentElement.classList.contains('theme-light')).toBe(false);
    });

    it('applies layout class to documentElement', () => {
        useThemeStore.setState({ layout: 'horizontal' });
        render(<ThemeProvider><div /></ThemeProvider>);
        expect(document.documentElement.classList.contains('layout-horizontal')).toBe(true);
    });

    it('useLayout() throws when used outside ThemeProvider', () => {
        // Suppress React error boundary console output
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => renderHook(() => useLayout())).toThrow('useLayout must be used within ThemeProvider');
        spy.mockRestore();
    });

    it('useLayout() returns layout and setLayout inside ThemeProvider', () => {
        const wrapper = ({ children }: { children: ReactNode }) => (
            <ThemeProvider>{children}</ThemeProvider>
        );
        const { result } = renderHook(() => useLayout(), { wrapper });
        expect(result.current.layout).toBe('vertical');
        expect(typeof result.current.setLayout).toBe('function');
    });
});
