import tsPlugin from '@typescript-eslint/eslint-plugin'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default [
  // Global ignores (replaces ignorePatterns)
  {
    ignores: [
      'dist/',
      'dist-electron/',
      'release/',
      'node_modules/',
      'build/',
    ],
  },

  // @typescript-eslint/recommended flat config (includes parser + plugin)
  ...tsPlugin.configs['flat/recommended'],

  // Project-wide settings for all TS/TSX files
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // react-hooks/recommended rules (flat config object form)
      ...reactHooks.configs.flat.recommended.rules,

      // react-refresh
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
]
