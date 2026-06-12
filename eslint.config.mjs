/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    ignores: ['**/node_modules', '**/dist', '**/out', 'resources/tts', '**/__tests__/**']
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      'no-restricted-globals': [
        'error',
        {
          name: 'alert',
          message: 'alert() is disabled. Use MessageModal from components/Modal instead.'
        },
        {
          name: 'confirm',
          message: 'confirm() is disabled. Use ConfirmModal from components/Modal instead.'
        },
        {
          name: 'prompt',
          message: 'prompt() is disabled.'
        }
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'alert',
          message: 'window.alert() is disabled. Use MessageModal from components/Modal instead.'
        },
        {
          object: 'window',
          property: 'confirm',
          message: 'window.confirm() is disabled. Use ConfirmModal from components/Modal instead.'
        },
        {
          object: 'window',
          property: 'prompt',
          message: 'window.prompt() is disabled.'
        }
      ]
    }
  },
  eslintConfigPrettier
)
