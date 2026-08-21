import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  BuiltinFunctionLibraryInitializationError,
  initializeBuiltinFunctionLibraries
} from '../builtin-initializer'
import { createFunctionLibraryRelease } from '../id'
import { FileTemplateRepository, type TemplateStore } from '../repository'

describe('内置函数库启动初始化', () => {
  it('预校验安装清单后幂等登记 release 并更新 active 版本', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const manifest = JSON.parse(
      await readFile(
        'resources/builtin/template-editor/.text/builtin-function-libraries.json',
        'utf8'
      )
    ) as unknown

    await initializeBuiltinFunctionLibraries(repository, manifest)
    await initializeBuiltinFunctionLibraries(repository, manifest)

    expect(await repository.listBuiltinFunctionLibraryIds()).toEqual([
      'builtin:basic',
      'builtin:examples',
      'builtin:shanghai-gaokao-basic',
      'builtin:shanghai-gaokao-choice',
      'builtin:shanghai-gaokao-groups',
      'builtin:shanghai-zhongkao-basic',
      'builtin:shanghai-zhongkao-groups'
    ])
    expect(await repository.getActiveBuiltinFunctionLibrary('builtin:basic')).toMatchObject({
      libraryId: 'builtin:basic',
      version: 4,
      content: {
        name: '基础组件库',
        functions: [
          { functionId: 'builtin:frame', content: { name: '框架' } },
          { functionId: 'builtin:page', content: { name: '页面' } },
          { functionId: 'builtin:choice-question', content: { name: '选择题' } },
          { functionId: 'builtin:variable', content: { name: '变量' } }
        ]
      }
    })
    expect(await repository.getActiveBuiltinFunctionLibrary('builtin:examples')).toMatchObject({
      libraryId: 'builtin:examples',
      version: 3,
      content: {
        name: '示例组件库',
        functions: [
          {
            functionId: 'builtin:example-title-page',
            content: {
              name: '标题页组合',
              inputs: [
                { name: 'title', type: 'string' },
                { name: 'subtitle', type: 'string' },
                { name: 'countdownSeconds', type: 'number' }
              ],
              outputs: [
                { name: 'heading', type: 'string' },
                { name: 'countdownSecondsResult', type: 'number' }
              ],
              body: { children: [{ type: 'frame', children: [{ type: 'page' }] }] }
            }
          },
          {
            functionId: 'builtin:example-choice-section',
            content: {
              name: '选择题组合',
              inputs: [
                { name: 'instruction', type: 'string' },
                { name: 'question', type: 'string' },
                { name: 'optionA', type: 'string' },
                { name: 'optionB', type: 'string' }
              ],
              outputs: [
                { name: 'answer', type: 'choice' },
                { name: 'questionText', type: 'string' }
              ],
              body: {
                children: [
                  {
                    type: 'frame',
                    children: [{ type: 'page' }, { type: 'choice-question' }]
                  }
                ]
              }
            }
          }
        ]
      }
    })
    expect(
      await repository.getActiveBuiltinFunctionLibrary('builtin:shanghai-gaokao-basic')
    ).toMatchObject({
      libraryId: 'builtin:shanghai-gaokao-basic',
      version: 3,
      content: {
        name: '高中基础题型',
        functions: [
          {
            functionId: 'builtin:shanghai-gaokao-directions',
            content: {
              name: 'Directions页面',
              body: {
                children: [
                  {
                    content: {
                      blocks: [{ id: 'text' }, { id: 'text-1', x: 10, width: 79.4 }]
                    }
                  }
                ]
              }
            }
          },
          {
            functionId: 'builtin:shanghai-gaokao-reading-sentence',
            content: { name: '朗读句子' }
          },
          {
            functionId: 'builtin:shanghai-gaokao-reading-passage',
            content: {
              name: '朗读短文',
              inputs: [{ name: 'passage', type: 'string' }],
              outputs: [{ name: 'ans', type: 'audio' }]
            }
          },
          {
            functionId: 'builtin:shanghai-gaokao-situation-question',
            content: { name: '情景提问', outputs: [{ name: 'ans', type: 'audio' }] }
          },
          {
            functionId: 'builtin:shanghai-gaokao-picture-speaking',
            content: { name: '看图说话' }
          },
          {
            functionId: 'builtin:shanghai-gaokao-quick-response',
            content: { name: '快速应答' }
          },
          {
            functionId: 'builtin:shanghai-gaokao-passage-response',
            content: { name: '听短文回答' }
          }
        ]
      }
    })

    const zhongkaoBasic = await repository.getActiveBuiltinFunctionLibrary(
      'builtin:shanghai-zhongkao-basic'
    )
    expect(zhongkaoBasic).toMatchObject({
      libraryId: 'builtin:shanghai-zhongkao-basic',
      version: 1,
      contentHash: 'sha256:df6f21acf2b6c34551278fd33b566df24303cc38203c58dc2723f8817e2e45ed',
      content: { name: '初中基础题型' }
    })
    expect(
      zhongkaoBasic?.content.functions.map(({ functionId, content }) => ({
        functionId,
        name: content.name
      }))
    ).toEqual([
      { functionId: 'builtin:shanghai-zhongkao-directions', name: 'Directions页面' },
      { functionId: 'builtin:shanghai-zhongkao-phrase-reading', name: '朗读词组' },
      { functionId: 'builtin:shanghai-zhongkao-sentence-reading', name: '朗读句子' },
      { functionId: 'builtin:shanghai-zhongkao-quick-response', name: '交际应答' },
      { functionId: 'builtin:shanghai-zhongkao-retelling', name: '复述' },
      { functionId: 'builtin:shanghai-zhongkao-topic-speaking', name: '话题表达' }
    ])
    const phrase = zhongkaoBasic?.content.functions.find(
      ({ functionId }) => functionId === 'builtin:shanghai-zhongkao-phrase-reading'
    )
    expect(phrase?.content.body.children.map((child) => child.timeline)).toEqual([
      [{ type: 'countdown', seconds: { type: 'number', source: 'literal', value: 10 } }],
      [
        {
          type: 'record',
          duration: { type: 'number', source: 'literal', value: 15 },
          outputName: 'recording'
        }
      ]
    ])

    const choices = await repository.getActiveBuiltinFunctionLibrary(
      'builtin:shanghai-gaokao-choice'
    )
    expect(choices).toMatchObject({
      libraryId: 'builtin:shanghai-gaokao-choice',
      version: 8,
      contentHash: 'sha256:c33f684a8d26dd6bae49425ba5c3af0dee3f8700d197d98b1cec0f510bd2784f',
      content: { name: '高中选择题' }
    })
    expect(
      choices?.content.functions
        .filter((entry) => entry.exposed !== false)
        .map(({ functionId, content }) => ({ functionId, name: content.name }))
    ).toEqual([
      {
        functionId: 'builtin:shanghai-gaokao-choice-group-1-10',
        name: '选择题1~10'
      },
      {
        functionId: 'builtin:shanghai-gaokao-choice-passage-group-11-16',
        name: '短文题组（11~16）'
      },
      {
        functionId: 'builtin:shanghai-gaokao-choice-long-conversation-group-17-20',
        name: '长对话（17~20）'
      },
      {
        functionId: 'builtin:shanghai-gaokao-choice-question-1-10',
        name: '选择题1~10单题'
      },
      {
        functionId: 'builtin:shanghai-gaokao-choice-question-11-20',
        name: '选择题11~20单题'
      }
    ])
    const choiceGroup = choices?.content.functions.find(
      ({ functionId }) => functionId === 'builtin:shanghai-gaokao-choice-group-1-10'
    )
    expect(choiceGroup?.content.body.children[2]).toMatchObject({
      type: 'page',
      content: {
        blocks: expect.arrayContaining([
          expect.objectContaining({
            text: {
              type: 'string',
              parts: [{ type: 'literal', value: 'I. Listening Comprehension' }]
            }
          })
        ])
      }
    })
    expect(choiceGroup?.content.inputs).toEqual(
      expect.arrayContaining(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((index) => {
          const suffix = String(index)
          return [
            { name: `stem${suffix}`, type: 'string' },
            { name: `optA${suffix}`, type: 'string' },
            { name: `optB${suffix}`, type: 'string' },
            { name: `optC${suffix}`, type: 'string' },
            { name: `optD${suffix}`, type: 'string' },
            { name: index === 1 ? 'tts' : `tts${suffix}`, type: 'string' },
            { name: `std${suffix}`, type: 'string' }
          ]
        })
      )
    )
    expect(choiceGroup?.content.body.choiceCollector).toBeUndefined()
    const choiceCalls = choiceGroup?.content.body.children.filter(
      (child) => child.type === 'function'
    )
    expect(choiceCalls).toHaveLength(10)
    expect(choiceCalls?.map((child) => child.functionRef)).toEqual(
      Array(10).fill('builtin:shanghai-gaokao-choice-question-1-10-internal')
    )
    expect(choiceCalls?.map((child) => child.inputs.idx)).toEqual(
      Array.from({ length: 10 }, (_value, index) => ({
        type: 'string',
        parts: [{ type: 'literal', value: String(index + 1) }]
      }))
    )
    expect(choiceCalls?.map((child) => child.inputs.timer)).toEqual(
      [3, 3, 3, 3, 5, 3, 3, 3, 3, 5].map((value) => ({
        type: 'number',
        source: 'literal',
        value
      }))
    )
    expect(choiceCalls?.map((child) => child.inputs.choice)).toEqual(
      [
        [0, 0],
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
        [1, 0],
        [1, 1],
        [1, 2],
        [1, 3],
        [1, 4]
      ].map(([pageIndex, questionIndex]) => ({
        type: 'choice-group',
        source: 'local',
        name: 'choice',
        selection: { kind: 'question', pageIndex, questionIndex }
      }))
    )
    const passageGroup = choices?.content.functions.find(
      ({ functionId }) => functionId === 'builtin:shanghai-gaokao-choice-passage-group-11-16'
    )
    const conversationGroup = choices?.content.functions.find(
      ({ functionId }) =>
        functionId === 'builtin:shanghai-gaokao-choice-long-conversation-group-17-20'
    )
    if (!passageGroup || !conversationGroup) {
      throw new Error('Builtin listening choice groups are missing')
    }
    expect(passageGroup.content.inputs[0]).toEqual({
      name: 'choice',
      type: 'choice-group',
      shape: { kind: 'range', pageCounts: [3, 3] }
    })
    expect(conversationGroup.content.inputs[0]).toEqual({
      name: 'choice',
      type: 'choice-group',
      shape: { kind: 'range', pageCounts: [4] }
    })
    for (const group of [passageGroup, conversationGroup]) {
      expect(group.content.body.choiceCollector).toBeUndefined()
    }
    const passageQuestionCalls = passageGroup.content.body.children.filter(
      (child) =>
        child.type === 'function' &&
        child.functionRef === 'builtin:shanghai-gaokao-choice-question-11-20'
    )
    const conversationQuestionCalls = conversationGroup.content.body.children.filter(
      (child) =>
        child.type === 'function' &&
        child.functionRef === 'builtin:shanghai-gaokao-choice-question-11-20'
    )
    expect(passageQuestionCalls.map((child) => child.inputs.idx)).toEqual(
      [11, 12, 13, 14, 15, 16].map((index) => ({
        type: 'string',
        parts: [{ type: 'literal', value: String(index) }]
      }))
    )
    expect(conversationQuestionCalls.map((child) => child.inputs.idx)).toEqual(
      [17, 18, 19, 20].map((index) => ({
        type: 'string',
        parts: [{ type: 'literal', value: String(index) }]
      }))
    )
    expect(
      [...passageQuestionCalls, ...conversationQuestionCalls].map((child) => child.inputs.tts)
    ).toEqual(
      Array.from({ length: 10 }, () => ({
        type: 'string',
        parts: [{ type: 'literal', value: '' }]
      }))
    )
    expect(passageQuestionCalls.map((child) => child.inputs.choice)).toEqual(
      [
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 1],
        [1, 2]
      ].map(([pageIndex, questionIndex]) => ({
        type: 'choice-group',
        source: 'local',
        name: 'choice',
        selection: { kind: 'question', pageIndex, questionIndex }
      }))
    )
    expect(conversationQuestionCalls.map((child) => child.inputs.choice)).toEqual(
      [0, 1, 2, 3].map((questionIndex) => ({
        type: 'choice-group',
        source: 'local',
        name: 'choice',
        selection: { kind: 'question', pageIndex: 0, questionIndex }
      }))
    )
    const firstChoice = choices?.content.functions.find(
      ({ functionId }) => functionId === 'builtin:shanghai-gaokao-choice-question-1-10'
    )
    const secondChoice = choices?.content.functions.find(
      ({ functionId }) => functionId === 'builtin:shanghai-gaokao-choice-question-11-20'
    )
    const internalChoice = choices?.content.functions.find(
      ({ functionId }) => functionId === 'builtin:shanghai-gaokao-choice-question-1-10-internal'
    )
    if (!firstChoice || !secondChoice || !internalChoice) {
      throw new Error('Builtin choice functions are missing')
    }
    const expectedSecondContent = structuredClone(firstChoice.content)
    expectedSecondContent.name = '选择题11~20单题'
    expectedSecondContent.schemaUses[0].schemaId = 'c13cd52c-cb16-402b-9a75-b4c993b3eae6'
    expect(secondChoice.content).toEqual(expectedSecondContent)
    for (const choice of [firstChoice, secondChoice, internalChoice]) {
      const pageCall = choice.content.body.children.find((child) => child.type === 'function')
      expect(pageCall?.inputs.tts).toEqual({
        type: 'string',
        parts: [
          { type: 'variable', ref: { scope: 'local', name: 'tts' } },
          { type: 'literal', value: '\nQuestion: ' },
          { type: 'variable', ref: { scope: 'local', name: 'stem' } }
        ]
      })
    }
    for (const choice of [firstChoice, secondChoice, internalChoice]) {
      expect(choice.content.inputs).toContainEqual({ name: 'idx', type: 'string' })
      const pageCall = choice.content.body.children.find((child) => child.type === 'function')
      expect(pageCall?.inputs.stem).toEqual({
        type: 'string',
        parts: [{ type: 'variable', ref: { scope: 'local', name: 'idx' } }]
      })
    }

    const groups = await repository.getActiveBuiltinFunctionLibrary(
      'builtin:shanghai-gaokao-groups'
    )
    expect(groups).toMatchObject({
      libraryId: 'builtin:shanghai-gaokao-groups',
      version: 4,
      contentHash: 'sha256:320de89405b28e39438b8bf79753104b1596a6949ffa7005aa5ef6fd7f5a81db',
      content: { name: '高中大题组' }
    })
    expect(
      groups?.content.functions.find(
        (entry) => entry.functionId === 'builtin:shanghai-gaokao-passage-group'
      )?.content.schemaUses[0]?.inputBindings
    ).toHaveProperty('reference-answer')
    expect(
      groups?.content.functions
        .filter((entry) => entry.exposed !== false)
        .map(({ functionId, content }) => ({ functionId, name: content.name }))
    ).toEqual([
      {
        functionId: 'builtin:shanghai-gaokao-sentence-group',
        name: '朗读句子题组'
      },
      {
        functionId: 'builtin:shanghai-gaokao-passage-group',
        name: '朗读短文题组'
      },
      {
        functionId: 'builtin:shanghai-gaokao-situation-group',
        name: '情景提问题组'
      },
      {
        functionId: 'builtin:shanghai-gaokao-picture-group',
        name: '看图说话题组'
      },
      {
        functionId: 'builtin:shanghai-gaokao-quick-response-group',
        name: '快速应答题组'
      },
      {
        functionId: 'builtin:shanghai-gaokao-passage-response-group',
        name: '听短文回答题组'
      }
    ])
    const passageResponse = groups?.content.functions.find(
      ({ functionId }) => functionId === 'builtin:shanghai-gaokao-passage-response-group'
    )
    expect(passageResponse?.content.inputs).toContainEqual({ name: 'topic', type: 'string' })
    expect(JSON.stringify(passageResponse?.content.body)).not.toContain('{{LS_passage_topic}}')

    const pictureGroup = groups?.content.functions.find(
      ({ functionId }) => functionId === 'builtin:shanghai-gaokao-picture-group'
    )
    expect(pictureGroup?.content.inputs).toEqual(
      expect.arrayContaining(
        [1, 2, 3, 4].map((index) => ({ name: 'img' + index + '-inst', type: 'string' }))
      )
    )
    const questionDescription =
      pictureGroup?.content.schemaUses[0]?.inputBindings['question-description']
    const serializedDescription = questionDescription?.parts
      .map((part) => {
        if (part.type === 'literal') return part.value
        switch (part.ref.scope) {
          case 'schema-use':
            return `[@${part.ref.varName}]`
          case 'local':
            return `[@${part.ref.name}]`
          case 'interface':
            return `[@${part.ref.alias}.${part.ref.varName}]`
        }
      })
      .join('')
    for (const index of [1, 2, 3, 4]) {
      expect(questionDescription?.parts).toContainEqual({
        type: 'variable',
        ref: { scope: 'local', name: 'img' + index + '-inst' }
      })
      expect(serializedDescription).toContain(`![[@img${index}-inst]]([@img${index}])`)
    }

    const zhongkaoGroups = await repository.getActiveBuiltinFunctionLibrary(
      'builtin:shanghai-zhongkao-groups'
    )
    expect(zhongkaoGroups).toMatchObject({
      libraryId: 'builtin:shanghai-zhongkao-groups',
      version: 1,
      contentHash: 'sha256:b0626d0a4ec26c1a1e92cb0fdc03c7b5993ae518018982c1bdfe64dc121af1b7',
      content: { name: '初中大题组' }
    })
    const zhongkaoGroupDetails = zhongkaoGroups?.content.functions.filter(
      (entry) => entry.exposed !== false
    )
    expect(
      zhongkaoGroupDetails?.map(({ functionId, content }) => ({ functionId, name: content.name }))
    ).toEqual([
      { functionId: 'builtin:shanghai-zhongkao-phrase-group', name: '朗读词组题组' },
      { functionId: 'builtin:shanghai-zhongkao-sentence-group', name: '朗读句子题组' },
      { functionId: 'builtin:shanghai-zhongkao-quick-response-group', name: '交际应答题组' },
      { functionId: 'builtin:shanghai-zhongkao-retelling-group', name: '复述题组' },
      { functionId: 'builtin:shanghai-zhongkao-topic-speaking-group', name: '话题表达题组' }
    ])
    expect(
      zhongkaoGroupDetails?.map(
        ({ content }) => content.body.children.filter((child) => child.type === 'function').length
      )
    ).toEqual([4, 3, 6, 2, 2])
    expect(zhongkaoGroupDetails?.map(({ content }) => content.schemaUses[0]?.schemaId)).toEqual([
      'a8c95c76-6f12-4d43-8ae1-5b9e2c7d1041',
      'a8c95c76-6f12-4d43-8ae1-5b9e2c7d1042',
      'a8c95c76-6f12-4d43-8ae1-5b9e2c7d1043',
      'a8c95c76-6f12-4d43-8ae1-5b9e2c7d1044',
      'a8c95c76-6f12-4d43-8ae1-5b9e2c7d1045'
    ])
  })

  it('清单中任一 release 无效时不写入前面的有效 release', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const valid = await createFunctionLibraryRelease('builtin:basic', 1, {
      name: 'Basic',
      functions: []
    })

    await expect(
      initializeBuiltinFunctionLibraries(repository, {
        libraries: [valid, { ...valid, libraryId: 'invalid' }]
      })
    ).rejects.toBeInstanceOf(BuiltinFunctionLibraryInitializationError)
    expect(await repository.listBuiltinFunctionLibraryIds()).toEqual([])
  })

  it('拒绝以相同 libraryId 和版本登记不同内容', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const first = await createFunctionLibraryRelease('builtin:basic', 1, {
      name: 'First',
      functions: []
    })
    const conflicting = await createFunctionLibraryRelease('builtin:basic', 1, {
      name: 'Conflicting',
      functions: []
    })

    await initializeBuiltinFunctionLibraries(repository, { libraries: [first] })
    await expect(
      initializeBuiltinFunctionLibraries(repository, { libraries: [conflicting] })
    ).rejects.toMatchObject({ code: 'RELEASE_CONFLICT' })
    expect(await repository.getActiveBuiltinFunctionLibrary('builtin:basic')).toEqual(first)
  })

  it('升级时停用已从清单移除的内置库并保留历史 release', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const basic = await createFunctionLibraryRelease('builtin:basic', 1, {
      name: 'Basic',
      functions: []
    })
    const legacy = await createFunctionLibraryRelease('builtin:legacy', 1, {
      name: 'Legacy',
      functions: []
    })

    await initializeBuiltinFunctionLibraries(repository, { libraries: [basic, legacy] })
    await initializeBuiltinFunctionLibraries(repository, { libraries: [basic] })

    expect(await repository.listBuiltinFunctionLibraryIds()).toEqual(['builtin:basic'])
    expect(await repository.getActiveBuiltinFunctionLibrary('builtin:legacy')).toBeNull()
    expect(await repository.getBuiltinFunctionLibrary('builtin:legacy', 1)).toEqual(legacy)
  })

  it('内容变化时使用新版本激活并保留旧版本', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const previous = await createFunctionLibraryRelease('builtin:examples', 1, {
      name: '旧示例组件库',
      functions: []
    })
    const manifest = JSON.parse(
      await readFile(
        'resources/builtin/template-editor/.text/builtin-function-libraries.json',
        'utf8'
      )
    ) as { libraries: { libraryId: string; version: number }[] }

    await initializeBuiltinFunctionLibraries(repository, { libraries: [previous] })
    await initializeBuiltinFunctionLibraries(repository, manifest)

    expect(await repository.getActiveBuiltinFunctionLibrary('builtin:examples')).toMatchObject({
      libraryId: 'builtin:examples',
      version: 3,
      content: { name: '示例组件库' }
    })
    expect(await repository.getBuiltinFunctionLibrary('builtin:examples', 1)).toEqual(previous)
  })

  it('选择题库升级到 v8 时保留已安装的 v7 release', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const previous = await createFunctionLibraryRelease('builtin:shanghai-gaokao-choice', 7, {
      name: '旧高中选择题',
      functions: []
    })
    const manifest = JSON.parse(
      await readFile(
        'resources/builtin/template-editor/.text/builtin-function-libraries.json',
        'utf8'
      )
    ) as unknown

    await initializeBuiltinFunctionLibraries(repository, { libraries: [previous] })
    await initializeBuiltinFunctionLibraries(repository, manifest)

    expect(
      await repository.getActiveBuiltinFunctionLibrary('builtin:shanghai-gaokao-choice')
    ).toMatchObject({
      libraryId: 'builtin:shanghai-gaokao-choice',
      version: 8,
      contentHash: 'sha256:c33f684a8d26dd6bae49425ba5c3af0dee3f8700d197d98b1cec0f510bd2784f'
    })
    expect(await repository.getBuiltinFunctionLibrary('builtin:shanghai-gaokao-choice', 7)).toEqual(
      previous
    )
  })

  it('新版本初始化不受已激活的损坏旧版本阻塞', async () => {
    const store = new MemoryStore().scope('template-editor')
    const repository = new FileTemplateRepository(store)
    await store
      .scope('function-libraries')
      .scope('builtin')
      .scope('basic')
      .scope('releases')
      .scope('v3')
      .writeText('library.json', { libraryId: 'builtin:basic', version: 3, content: null })
    await store
      .scope('function-libraries')
      .scope('builtin')
      .writeText('active.json', {
        libraries: [{ libraryId: 'builtin:basic', version: 3 }]
      })
    const current = await createFunctionLibraryRelease('builtin:basic', 4, {
      name: 'Basic v4',
      functions: []
    })

    await initializeBuiltinFunctionLibraries(repository, { libraries: [current] })

    expect(await repository.getActiveBuiltinFunctionLibrary('builtin:basic')).toEqual(current)
  })

  it('在启动期拒绝缺失、非法和递归的内置函数依赖', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const entry = (functionId: string, functionRef?: string) => ({
      functionId,
      content: {
        name: functionId,
        inputs: [],
        body: {
          id: 'root',
          type: 'frame' as const,
          children: functionRef
            ? [{ id: 'call', type: 'function' as const, functionRef, inputs: {}, outputNames: {} }]
            : []
        },
        outputs: [],
        schemaUses: []
      }
    })
    const invalidContents = [
      [entry('builtin:root', 'builtin:missing')],
      [entry('builtin:root', 'not-builtin')],
      [entry('builtin:root', 'builtin:child'), entry('builtin:child', 'builtin:root')]
    ]

    for (const functions of invalidContents) {
      const release = await createFunctionLibraryRelease('builtin:broken', 1, {
        name: 'Broken',
        functions
      })
      await expect(
        initializeBuiltinFunctionLibraries(repository, { libraries: [release] })
      ).rejects.toBeInstanceOf(BuiltinFunctionLibraryInitializationError)
    }
    expect(await repository.listBuiltinFunctionLibraryIds()).toEqual([])
  })
})

class MemoryStore implements TemplateStore {
  constructor(
    private readonly state = new Map<string, unknown>(),
    private readonly path: string[] = []
  ) {}

  scope(name: string): TemplateStore {
    return new MemoryStore(this.state, [...this.path, name])
  }

  async readText<T>(filename: string): Promise<T | null> {
    return (this.state.get(this.key(filename)) as T | undefined) ?? null
  }

  async writeText<T>(filename: string, data: T): Promise<void> {
    this.state.set(this.key(filename), structuredClone(data))
  }

  async compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean> {
    const key = this.key(filename)
    const current = this.state.has(key) ? this.state.get(key) : null
    if (JSON.stringify(current) !== JSON.stringify(expected)) return false
    this.state.set(key, structuredClone(data))
    return true
  }

  async listScopes(): Promise<string[]> {
    const prefix = `${this.path.join('/')}/`
    const scopes = new Set<string>()
    this.state.forEach((_value, key) => {
      if (!key.startsWith(prefix)) return
      const remainder = key.slice(prefix.length)
      const segment = remainder.split('/')[0]
      if (segment && remainder.includes('/')) scopes.add(segment)
    })
    return [...scopes].sort()
  }

  async clear(): Promise<void> {
    const prefix = `${this.path.join('/')}/`
    for (const key of this.state.keys()) {
      if (key.startsWith(prefix)) this.state.delete(key)
    }
  }

  private key(filename: string): string {
    return `${this.path.join('/')}/${filename}`
  }
}
