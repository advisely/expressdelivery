import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeName = 'light' | 'cream' | 'midnight' | 'forest'
export type LayoutMode = 'vertical' | 'horizontal'

export interface ThemeConfig {
    name: ThemeName
    label: string
    description: string
    isDark: boolean
}

export const THEMES: ThemeConfig[] = [
    { name: 'light', label: 'Light', description: 'Clean and bright', isDark: false },
    { name: 'cream', label: 'Cream', description: 'Warm and easy on eyes', isDark: false },
    { name: 'midnight', label: 'Midnight', description: 'Dark navy theme', isDark: true },
    { name: 'forest', label: 'Forest', description: 'Dark green theme', isDark: true },
]

export function isDarkTheme(themeName: ThemeName): boolean {
    return THEMES.find((t) => t.name === themeName)?.isDark ?? false
}

interface ThemeState {
    themeName: ThemeName
    layout: LayoutMode
    sidebarCollapsed: boolean
    setTheme: (name: ThemeName) => void
    setLayout: (layout: LayoutMode) => void
    setSidebarCollapsed: (collapsed: boolean) => void
    toggleSidebar: () => void
    cycleTheme: () => void
}

export const useThemeStore = create<ThemeState>()(
    persist(
        (set) => ({
            themeName: 'light',
            layout: 'vertical',
            sidebarCollapsed: false,

            setTheme: (themeName) => set({ themeName }),
            setLayout: (layout) => set({ layout }),
            setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
            toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

            cycleTheme: () =>
                set((state) => {
                    const idx = THEMES.findIndex((t) => t.name === state.themeName)
                    return { themeName: THEMES[(idx + 1) % THEMES.length].name }
                }),
        }),
        { name: 'app-theme' }
    )
)
