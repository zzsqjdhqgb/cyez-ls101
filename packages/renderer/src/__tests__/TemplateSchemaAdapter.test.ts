import { describe, expect, it, vi } from 'vitest'
import { createTemplateSchemaDependencies } from '../features/templates/TemplateSchemaAdapter'

describe('Template Schema adapter', () => {
  it('把非法或未完成的 schemaId 视为不存在且不访问仓储', async () => {
    const getSchema = vi.fn().mockResolvedValue(null)
    const adapter = createTemplateSchemaDependencies({ getSchema })

    await expect(adapter.getSchema('')).resolves.toBeNull()
    await expect(adapter.getSchema('not-a-schema-id')).resolves.toBeNull()
    expect(getSchema).not.toHaveBeenCalled()
  })

  it('把合法 schemaId 交给正式 Schema 仓储查询', async () => {
    const getSchema = vi.fn().mockResolvedValue(null)
    const adapter = createTemplateSchemaDependencies({ getSchema })
    const schemaId = '10000000-0000-4000-8000-000000000001'

    await expect(adapter.getSchema(schemaId)).resolves.toBeNull()
    expect(getSchema).toHaveBeenCalledWith(schemaId)
  })
})
