import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, isDarkTheme } from './themeStore';

describe('Theme Store Logic', () => {
    beforeEach(() => {
        // Reset the store before each test
        useThemeStore.setState({ themeName: 'light' });
    });

    it('should initialize with the light theme', () => {
        const state = useThemeStore.getState();
        expect(state.themeName).toBe('light');
    });

    it('should correctly update the theme via setTheme', () => {
        useThemeStore.getState().setTheme('midnight');
        expect(useThemeStore.getState().themeName).toBe('midnight');

        useThemeStore.getState().setTheme('forest');
        expect(useThemeStore.getState().themeName).toBe('forest');
    });

    it('should correctly cycle through themes in order', () => {
        // Initial state is light
        useThemeStore.getState().cycleTheme();
        expect(useThemeStore.getState().themeName).toBe('cream');

        useThemeStore.getState().cycleTheme();
        expect(useThemeStore.getState().themeName).toBe('midnight');

        useThemeStore.getState().cycleTheme();
        expect(useThemeStore.getState().themeName).toBe('forest');

        // Loop back to the beginning
        useThemeStore.getState().cycleTheme();
        expect(useThemeStore.getState().themeName).toBe('light');
    });

    it('should correctly identify dark modes', () => {
        expect(isDarkTheme('light')).toBe(false);
        expect(isDarkTheme('cream')).toBe(false);
        expect(isDarkTheme('midnight')).toBe(true);
        expect(isDarkTheme('forest')).toBe(true);
    });

    it('should handle invalid theme lookups securely', () => {
        // @ts-expect-error - testing intentional bad input for JS edge cases
        expect(isDarkTheme('invalid_theme_name')).toBe(false);
    });
});
