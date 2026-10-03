import { readFileSync, writeFileSync } from 'node:fs'

const inputPath = '/workspace/.gop-research/exam/current-pronunciation.json'
const outputJsonPath = '/workspace/.gop-research/exam/filtered-pronunciation.json'
const outputMarkdownPath = '/workspace/.gop-research/exam/pronunciation-feedback.md'

const raw = JSON.parse(readFileSync(inputPath, 'utf8'))

function time(ms) {
  const seconds = ms / 1000
  const minutes = Math.floor(seconds / 60)
  const remainder = (seconds - minutes * 60).toFixed(2).padStart(5, '0')
  return `${String(minutes).padStart(2, '0')}:${remainder}`
}

function collect(predicate) {
  const rows = []
  for (const word of raw.words) {
    for (const phone of word.phones) {
      if (!predicate(word, phone)) continue
      rows.push({
        word: word.text,
        expected: phone.expected,
        observed: phone.observed,
        score: phone.score,
        confidence: phone.confidence,
        startMs: phone.startMs,
        endMs: phone.endMs,
        time: `${time(phone.startMs)}-${time(phone.endMs)}`
      })
    }
  }
  return rows
}

const diagnoses = [
  {
    id: 'voiced-dental-fricative',
    title: '齿间浊擦音 /ð/',
    strength: '中等证据，建议复听',
    summary:
      '模型在多个词段把目标 /ð/ 的声学峰值判得更接近 /t/。这可能表示齿间摩擦或声带振动不足，但功能词弱读和模型偏置也会造成相同现象。',
    practice:
      '复听时看舌尖是否轻触上下齿之间；保持声带振动并拉出连续摩擦，再与短促无摩擦的 /t/ 对比。',
    evidence: collect(
      (word, phone) =>
        phone.expected === 'ð' && phone.observed === 't' && phone.confidence >= 0.35
    )
  },
  {
    id: 'voiceless-dental-fricative',
    title: '齿间清擦音 /θ/',
    strength: '较强证据，但只有 2 处，建议复听',
    summary:
      '在 three 和 both 中，模型分别更接近 /ts/ 与 /s/，呈现齿间清擦音不充分或塞擦化的可能。',
    practice:
      '舌尖从齿间略露出，持续送气且不振动；不要让气流先变成 /s/，也不要先形成 /t/ 的闭塞。',
    evidence: collect(
      (word, phone) =>
        phone.expected === 'θ' &&
        (phone.observed === 's' || phone.observed === 'ts') &&
        phone.confidence >= 0.7
    )
  },
  {
    id: 'final-z-devoicing',
    title: '词尾浊音 /z/',
    strength: '较强的重复模式，建议复听',
    summary:
      'terms、preferences、papers、journals、sellers、advantages、is 的词尾 /z/ 多次被判得更接近 /s/；这符合词尾浊音清化的疑点。',
    practice:
      '在词尾保留声带振动，先延长 /z/ 再收尾；可交替练习 /s/-/z/，用手摸喉部确认是否有振动。',
    evidence: collect(
      (word, phone) =>
        phone.expected === 'z' && phone.observed === 's' && phone.confidence >= 0.8
    )
  },
  {
    id: 'initial-b-devoicing',
    title: '词首浊塞音 /b/',
    strength: '较弱证据，仅作待确认复听项',
    summary:
      'believe、books、both、been、But、by 的部分实例被判得更接近 /p/。同一模型对 /b/ 有系统性混淆，且同词并非每次都一致，因此不能直接断言为错误。',
    practice:
      '若复听确有问题，双唇先闭合、随后带声释放；避免像 /p/ 那样出现明显送气。',
    evidence: collect(
      (word, phone) =>
        phone.expected === 'b' && phone.observed === 'p' && phone.confidence >= 0.8
    )
  }
]

const excluded = [
  '未纳入停顿、流利度、语法、措辞、内容或总分。',
  '元音、自然弱读（如 the、and、to、of、because）以及 CMUdict 合法变体不直接判错。',
  'i5、ɑ5、ei5、ts. 等多语声学模型内部 token 不作为英语音素错误。',
  'ASR 将 overweigh 识别成不稳定词形；该词段不用于发音结论。'
]

function evidenceLine(row) {
  return `- \`${row.word}\` ${row.time}：/${row.expected}/ → /${row.observed}/（模型置信度 ${row.confidence}）`
}

const markdown = [
  '# 发音纠错（仅音素）',
  '',
  `音频：[recording-11.webm](${raw.audioPath})  ·  [WAV](${raw.audioPath.replace(/\.webm$/, '.wav')})`,
  '',
  '> 这份结果只讨论发音。时间是 CTC 强制对齐的近似位置，所有“错误”都应结合原音频复听；模型证据本身不是人工判定。',
  '',
  '## 保留的发音疑点',
  ''
]

for (const diagnosis of diagnoses) {
  markdown.push(`### ${diagnosis.title} · ${diagnosis.strength}`, '', diagnosis.summary, '')
  markdown.push('证据：')
  for (const row of diagnosis.evidence) markdown.push(evidenceLine(row))
  markdown.push('', `练习方向：${diagnosis.practice}`, '')
}

markdown.push('## 本次明确不判定的内容', '')
for (const item of excluded) markdown.push(`- ${item}`)
markdown.push(
  '',
  '## 判断方法',
  '',
  '只保留目标音素与常规英语音素之间的替代，要求有重复实例或较高声学置信度；单个低置信度片段、合法读音变体和内部 token 均被过滤。'
)

const filtered = {
  audioPath: raw.audioPath,
  referenceText: raw.referenceText,
  source: {
    asr: 'local Qwen3 ASR（仅用于定位词段）',
    pronunciationReference: 'CMUdict',
    acousticModel: raw.audioPath.includes('recording-11')
      ? '/workspace/externals/ai/pronunciation/model/facebook-wav2vec2-lv-60-espeak-cv-ft-int8/'
      : 'current pronunciation model'
  },
  diagnoses,
  exclusions: excluded,
  feedbackMarkdown: markdown.join('\n') + '\n'
}

writeFileSync(outputJsonPath, JSON.stringify(filtered, null, 2) + '\n')
writeFileSync(outputMarkdownPath, filtered.feedbackMarkdown)
console.log(`wrote ${outputMarkdownPath}`)
console.log(`wrote ${outputJsonPath}`)
for (const diagnosis of diagnoses) {
  console.log(`${diagnosis.id}: ${diagnosis.evidence.length} evidence rows`)
}
