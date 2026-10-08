// 语音 Provider 类型清单的单一来源：新增 Provider 类型时只需要改这里的常量数组，
// 主进程与渲染层的谓词、默认 Base URL 表都从这里派生（见 TODO 问题 5）。
// 注意这里是运行时常量模块，types.ts 只 re-export 派生类型。

export const ONLINE_SPEECH_PROVIDER_TYPES = [
  'openai-compatible',
  'elevenlabs',
  'minimax',
  'minimax-cn'
] as const

export const LOCAL_SPEECH_PROVIDER_TYPES = ['pocket-tts', 'qwen-tts'] as const

export const MINIMAX_SPEECH_PROVIDER_TYPES = ['minimax', 'minimax-cn'] as const

export type AIRouterOnlineSpeechProviderType = (typeof ONLINE_SPEECH_PROVIDER_TYPES)[number]
export type AIRouterLocalSpeechProviderType = (typeof LOCAL_SPEECH_PROVIDER_TYPES)[number]
export type AIRouterSpeechProviderType =
  | AIRouterOnlineSpeechProviderType
  | AIRouterLocalSpeechProviderType

export type AIRouterMinimaxSpeechProviderType = (typeof MINIMAX_SPEECH_PROVIDER_TYPES)[number]

// 在线 Provider 未填写 Base URL 时的默认值。openai-compatible 按惯例带 /v1，
// ElevenLabs / MiniMax 的 API 路径由各实现自行拼接（见 TODO 问题 18）。
export const DEFAULT_SPEECH_PROVIDER_BASE_URLS: Record<AIRouterOnlineSpeechProviderType, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  elevenlabs: 'https://api.elevenlabs.io',
  minimax: 'https://api.minimax.io',
  'minimax-cn': 'https://api.minimax.cn'
}

const ONLINE_SPEECH_PROVIDER_TYPE_SET: ReadonlySet<string> = new Set(ONLINE_SPEECH_PROVIDER_TYPES)
const LOCAL_SPEECH_PROVIDER_TYPE_SET: ReadonlySet<string> = new Set(LOCAL_SPEECH_PROVIDER_TYPES)
const MINIMAX_SPEECH_PROVIDER_TYPE_SET: ReadonlySet<string> = new Set(MINIMAX_SPEECH_PROVIDER_TYPES)

export function isOnlineSpeechProviderType(
  type: unknown
): type is AIRouterOnlineSpeechProviderType {
  return typeof type === 'string' && ONLINE_SPEECH_PROVIDER_TYPE_SET.has(type)
}

export function isLocalSpeechProviderType(type: unknown): type is AIRouterLocalSpeechProviderType {
  return typeof type === 'string' && LOCAL_SPEECH_PROVIDER_TYPE_SET.has(type)
}

export function isMinimaxSpeechProviderType(
  type: unknown
): type is AIRouterMinimaxSpeechProviderType {
  return typeof type === 'string' && MINIMAX_SPEECH_PROVIDER_TYPE_SET.has(type)
}
