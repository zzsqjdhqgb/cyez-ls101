// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIModelSelect } from '../components/ai/AIModelSelect'

afterEach(cleanup)

describe('AIModelSelect', () => {
  it('groups models by provider and returns the selected model identity', () => {
    const onChange = vi.fn()

    render(
      <AIModelSelect
        label="生成模型"
        options={[
          { providerId: 'provider-a', providerName: 'Provider A', modelId: 'model-a' },
          { providerId: 'provider-b', providerName: 'Provider B', modelId: 'model-b' }
        ]}
        value={{ providerId: 'provider-a', modelId: 'model-a' }}
        onChange={onChange}
      />
    )

    expect(screen.getByRole('group', { name: 'Provider A' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Provider B' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('生成模型'), { target: { value: '1' } })
    expect(onChange).toHaveBeenCalledWith({ providerId: 'provider-b', modelId: 'model-b' })
  })

  it('shows a consistent empty state', () => {
    render(<AIModelSelect label="生成模型" options={[]} value={null} onChange={vi.fn()} />)

    expect(screen.getByLabelText('生成模型')).toBeDisabled()
    expect(screen.getByRole('option', { name: '没有已启用模型' })).toBeInTheDocument()
  })
})
