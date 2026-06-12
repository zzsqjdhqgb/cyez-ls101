/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  MessageModal,
  ConfirmModal,
  ResultModal,
  ProgressModal
} from '@renderer/components/Modal'

describe('Modal components', () => {
  describe('MessageModal', () => {
    it('renders message and title', () => {
      render(
        <MemoryRouter>
          <MessageModal isOpen={true} title="Test Title" message="Test message" onClose={() => {}} />
        </MemoryRouter>
      )
      expect(screen.getByText('Test Title')).toBeInTheDocument()
      expect(screen.getByText('Test message')).toBeInTheDocument()
    })

    it('calls onClose when button clicked', async () => {
      const onClose = vi.fn()
      render(
        <MemoryRouter>
          <MessageModal isOpen={true} title="Test" message="Test" onClose={onClose} />
        </MemoryRouter>
      )
      await userEvent.click(screen.getByText('关闭'))
      expect(onClose).toHaveBeenCalled()
    })

    it('renders nothing when isOpen is false', () => {
      const { container } = render(
        <MemoryRouter>
          <MessageModal isOpen={false} title="Test" message="Test" onClose={() => {}} />
        </MemoryRouter>
      )
      expect(container.innerHTML).toBe('')
    })
  })

  describe('ConfirmModal', () => {
    it('renders title and message', () => {
      render(
        <MemoryRouter>
          <ConfirmModal
            isOpen={true}
            title="Confirm Title"
            message="Are you sure?"
            onCancel={() => {}}
            onConfirm={() => {}}
          />
        </MemoryRouter>
      )
      expect(screen.getByText('Confirm Title')).toBeInTheDocument()
      expect(screen.getByText('Are you sure?')).toBeInTheDocument()
    })

    it('calls onConfirm when confirm button clicked', async () => {
      const onConfirm = vi.fn()
      render(
        <MemoryRouter>
          <ConfirmModal
            isOpen={true}
            title="Confirm"
            message="Sure?"
            onCancel={() => {}}
            onConfirm={onConfirm}
            confirmLabel="Yes"
          />
        </MemoryRouter>
      )
      await userEvent.click(screen.getByText('Yes'))
      expect(onConfirm).toHaveBeenCalled()
    })

    it('calls onCancel when cancel button clicked', async () => {
      const onCancel = vi.fn()
      render(
        <MemoryRouter>
          <ConfirmModal
            isOpen={true}
            title="Confirm"
            message="Sure?"
            onCancel={onCancel}
            onConfirm={() => {}}
          />
        </MemoryRouter>
      )
      await userEvent.click(screen.getByText('取消'))
      expect(onCancel).toHaveBeenCalled()
    })

    it('renders nothing when isOpen is false', () => {
      const { container } = render(
        <MemoryRouter>
          <ConfirmModal isOpen={false} title="Test" message="Test" onCancel={() => {}} onConfirm={() => {}} />
        </MemoryRouter>
      )
      expect(container.innerHTML).toBe('')
    })
  })

  describe('ResultModal', () => {
    it('renders success result', () => {
      render(
        <MemoryRouter>
          <ResultModal
            isOpen={true}
            success={true}
            title="Success Title"
            message="Operation completed"
            onClose={() => {}}
          />
        </MemoryRouter>
      )
      expect(screen.getByText('Success Title')).toBeInTheDocument()
      expect(screen.getByText('Operation completed')).toBeInTheDocument()
    })

    it('renders failure result', () => {
      render(
        <MemoryRouter>
          <ResultModal
            isOpen={true}
            success={false}
            title="Failure Title"
            message="Operation failed"
            onClose={() => {}}
          />
        </MemoryRouter>
      )
      expect(screen.getByText('Failure Title')).toBeInTheDocument()
      expect(screen.getByText('Operation failed')).toBeInTheDocument()
    })

    it('renders details', () => {
      render(
        <MemoryRouter>
          <ResultModal
            isOpen={true}
            success={true}
            title="Done"
            message="Done"
            details={[{ label: 'Imported', value: '3' }]}
            onClose={() => {}}
          />
        </MemoryRouter>
      )
      expect(screen.getByText('Imported: 3')).toBeInTheDocument()
    })

    it('calls onClose when button clicked', async () => {
      const onClose = vi.fn()
      render(
        <MemoryRouter>
          <ResultModal isOpen={true} success={true} title="Done" message="Done" onClose={onClose} />
        </MemoryRouter>
      )
      await userEvent.click(screen.getByText('关闭'))
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('ProgressModal', () => {
    it('renders progress information', () => {
      render(
        <MemoryRouter>
          <ProgressModal
            isOpen={true}
            title="Processing"
            progress={{ current: 50, total: 100, step: 'Processing...' }}
            errors={[]}
          />
        </MemoryRouter>
      )
      expect(screen.getByText('Processing')).toBeInTheDocument()
      expect(screen.getByText('50 / 100')).toBeInTheDocument()
      expect(screen.getByText('Processing...')).toBeInTheDocument()
    })

    it('displays errors when present', () => {
      render(
        <MemoryRouter>
          <ProgressModal
            isOpen={true}
            title="Export"
            progress={{ current: 100, total: 100, step: 'Done' }}
            errors={[
              { name: 'Error 1', detail: 'Failed to process' },
              { name: 'Error 2', detail: 'Network error' }
            ]}
          />
        </MemoryRouter>
      )
      expect(screen.getByText('Error 1')).toBeInTheDocument()
      expect(screen.getByText('Error 2')).toBeInTheDocument()
    })

    it('does not display errors section when empty', () => {
      render(
        <MemoryRouter>
          <ProgressModal
            isOpen={true}
            title="Working"
            progress={{ current: 50, total: 100, step: 'Working...' }}
            errors={[]}
          />
        </MemoryRouter>
      )
      expect(screen.queryByText(/生成失败/)).not.toBeInTheDocument()
    })

    it('renders nothing when isOpen is false', () => {
      const { container } = render(
        <MemoryRouter>
          <ProgressModal
            isOpen={false}
            title="Test"
            progress={{ current: 0, total: 0 }}
            errors={[]}
          />
        </MemoryRouter>
      )
      expect(container.innerHTML).toBe('')
    })
  })
})
