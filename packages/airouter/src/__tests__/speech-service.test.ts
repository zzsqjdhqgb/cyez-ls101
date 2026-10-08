import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JsonConfigStorage } from '@ls101/config-store/main'
import { EncryptedSecretStorage } from '@ls101/secret-store/main'
import { AIRouterSpeechModelStore } from '../main/speech-model-store'
import { AIRouterSpeechService } from '../main/speech-service'

describe('AIRouterSpeechService', () => {
  let baseDir: string
  let service: AIRouterSpeechService

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'airouter-speech-'))
    const secrets = new EncryptedSecretStorage(baseDir, {
      encrypt: (value) => new TextEncoder().encode(value),
      decrypt: (value) => new TextDecoder().decode(value)
    })
    service = new AIRouterSpeechService({ baseDir, secretStorage: secrets })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    await rm(baseDir, { recursive: true, force: true })
  })

  async function saveMinimaxSynthesisProvider(): Promise<void> {
    await service.saveProviderConfig({
      id: 'minimax-rpm',
      name: 'MiniMax RPM',
      kind: 'online',
      type: 'minimax',
      models: [{ id: 'speech-2.8-hd', enabled: true }],
      voices: [{ id: 'English_Graceful_Lady', enabled: true }],
      apiKey: 'minimax-secret'
    })
  }

  // 只伪造 setTimeout 与 Date：限流等待用 setTimeout、重试窗口用 Date.now，而配置
  // 读取等真实 I/O 依赖 setImmediate 之后的宏任务阶段，保持真实才能让链路推进。
  function useMinimaxRateLimitFakeTimers(): void {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  }

  // 反复让出宏任务直到谓词满足，用于把真实 I/O 链路推进到断言点，不触碰伪造的定时器。
  // 实测从发起合成到首次 fetch 需要 40-75 个 setImmediate 轮次，高负载下偶发更多
  // （见过 133），预算给足 1000 轮以避免偶发超时（每轮开销极小）。
  async function flushUntil(predicate: () => boolean, maxTurns = 1000): Promise<void> {
    for (let turn = 0; turn < maxTurns && !predicate(); turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }

  function synthesizeWithMinimaxRouting(options: { signal?: AbortSignal } = {}) {
    return service.synthesizeSpeech(
      {
        text: 'Hello',
        routing: {
          default: {
            providerConfigId: 'minimax-rpm',
            modelId: 'speech-2.8-hd',
            voiceId: 'English_Graceful_Lady'
          }
        }
      },
      options
    )
  }

  function rateLimitedResponse(statusCode: number, statusMsg: string): Response {
    return new Response(JSON.stringify({ base_resp: { status_code: statusCode, status_msg: statusMsg } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }

  it('normalizes every new Qwen provider to CPU', async () => {
    const cuda = await service.saveProviderConfig({
      id: 'qwen-cuda',
      name: 'Qwen CUDA',
      kind: 'local',
      type: 'qwen-tts',
      backend: 'cuda',
      models: [],
      voices: []
    })
    const cpu = await service.saveProviderConfig({
      id: 'qwen-cpu',
      name: 'Qwen CPU',
      kind: 'local',
      type: 'qwen-tts',
      models: [],
      voices: []
    })

    expect(cuda.backend).toBe('cpu')
    expect(cpu.backend).toBe('cpu')
  })

  it('normalizes a stored CUDA provider to CPU before returning it', async () => {
    const configStorage = new JsonConfigStorage(baseDir)
    await configStorage.write(
      { scope: ['airouter'], key: 'speech-providers' },
      {
        version: 1,
        providers: [
          {
            id: 'legacy-qwen',
            name: 'Legacy Qwen',
            kind: 'local',
            type: 'qwen-tts',
            baseUrl: '',
            modelPackageId: '',
            modelPackageVersion: '',
            models: [],
            voices: [],
            backend: 'cuda'
          }
        ]
      }
    )

    await expect(service.listProviderConfigs()).resolves.toEqual([
      expect.objectContaining({ id: 'legacy-qwen', backend: 'cpu' })
    ])
  })

  it('stores online speech providers separately and maps OpenAI speech requests', async () => {
    const audio = createWav([0, 0, 0, 0])
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(audio), {
        status: 200,
        headers: { 'content-type': 'audio/wav' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const saved = await service.saveProviderConfig({
      id: 'openai-speech',
      name: 'OpenAI Speech',
      kind: 'online',
      type: 'openai-compatible',
      baseUrl: 'https://speech.example.com/v1/',
      models: [{ id: 'tts-1', enabled: true }],
      voices: [{ id: 'alloy', enabled: true }],
      apiKey: 'speech-secret'
    })

    expect(saved).toEqual(
      expect.objectContaining({
        baseUrl: 'https://speech.example.com/v1',
        modelPackageId: '',
        hasApiKey: true
      })
    )
    await expect(
      service.synthesizeSpeech({
        text: 'Hello',
        routing: {
          default: {
            providerConfigId: 'openai-speech',
            modelId: 'tts-1',
            voiceId: 'alloy'
          }
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({ data: audio, mediaType: 'audio/wav', format: 'wav' })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://speech.example.com/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer speech-secret' }),
        body: JSON.stringify({
          model: 'tts-1',
          input: 'Hello',
          voice: 'alloy',
          response_format: 'wav'
        })
      })
    )
  })

  it('maps ElevenLabs speech requests and wraps PCM output into WAV', async () => {
    const pcm = createPcm(480)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(pcm), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const saved = await service.saveProviderConfig({
      id: 'eleven-speech',
      name: 'ElevenLabs Speech',
      kind: 'online',
      type: 'elevenlabs',
      baseUrl: 'https://eleven.example.com/',
      models: [{ id: 'eleven_multilingual_v2', enabled: true }],
      voices: [{ id: '21m00Tcm4TlvDq8ikWAM', enabled: true }],
      apiKey: 'eleven-secret'
    })

    expect(saved).toEqual(
      expect.objectContaining({
        type: 'elevenlabs',
        baseUrl: 'https://eleven.example.com',
        modelPackageId: '',
        hasApiKey: true
      })
    )

    const result = await service.synthesizeSpeech({
      text: 'Hello',
      routing: {
        default: {
          providerConfigId: 'eleven-speech',
          modelId: 'eleven_multilingual_v2',
          voiceId: '21m00Tcm4TlvDq8ikWAM'
        }
      }
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://eleven.example.com/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=pcm_24000',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'xi-api-key': 'eleven-secret' }),
        body: JSON.stringify({ text: 'Hello', model_id: 'eleven_multilingual_v2' })
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        format: 'wav',
        mediaType: 'audio/wav',
        sampleRate: 24000,
        channels: 1,
        durationMs: 20
      })
    )
    expect(readWavFormat(result.data)).toEqual({ sampleRate: 24000, channels: 1, bits: 16 })
    expect(result.data.byteLength).toBe(pcm.byteLength + 44)
  })

  it('defaults an ElevenLabs provider to the official API base URL', async () => {
    const saved = await service.saveProviderConfig({
      id: 'eleven-default',
      name: 'ElevenLabs Default',
      kind: 'online',
      type: 'elevenlabs',
      models: [],
      voices: []
    })

    expect(saved.baseUrl).toBe('https://api.elevenlabs.io')
  })

  it('rejects ElevenLabs as a local provider runtime', async () => {
    await expect(
      service.saveProviderConfig({
        id: 'eleven-local',
        name: 'ElevenLabs Local',
        kind: 'local',
        type: 'elevenlabs',
        models: [],
        voices: []
      })
    ).rejects.toThrow('离线语音 Provider 类型无效')
  })

  it('discovers ElevenLabs models and voices from the native endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              model_id: 'eleven_multilingual_v2',
              name: 'Eleven Multilingual v2',
              can_do_text_to_speech: true
            },
            {
              model_id: 'eleven_english_sts_v2',
              name: 'Eleven English STS v2',
              can_do_text_to_speech: false
            }
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            voices: [
              { voice_id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam' },
              { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const config = {
      id: 'eleven-speech',
      name: 'ElevenLabs Speech',
      kind: 'online' as const,
      type: 'elevenlabs' as const,
      baseUrl: 'https://api.elevenlabs.io',
      models: [],
      voices: [],
      apiKey: 'eleven-secret'
    }

    await expect(service.listModels(config)).resolves.toEqual([
      { id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2' }
    ])
    await expect(
      service.listVoices({ config, modelId: 'eleven_multilingual_v2' })
    ).resolves.toEqual([
      { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam' },
      { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' }
    ])
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.elevenlabs.io/v1/models',
      expect.objectContaining({ headers: expect.objectContaining({ 'xi-api-key': 'eleven-secret' }) })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.elevenlabs.io/v1/voices',
      expect.objectContaining({ headers: expect.objectContaining({ 'xi-api-key': 'eleven-secret' }) })
    )
  })

  it('concatenates routed ElevenLabs PCM segments as WAV', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array(createPcm(240)), {
          headers: { 'content-type': 'application/octet-stream' }
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(createPcm(120)), {
          headers: { 'content-type': 'application/octet-stream' }
        })
      )
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: 'eleven-routed',
      name: 'ElevenLabs Routed',
      kind: 'online',
      type: 'elevenlabs',
      models: [{ id: 'eleven_multilingual_v2', enabled: true }],
      voices: [
        { id: 'default', enabled: true },
        { id: 'man', enabled: true }
      ],
      apiKey: 'eleven-secret'
    })

    const result = await service.synthesizeSpeech({
      text: '[Man]: first\nDefault line',
      routing: {
        default: { providerConfigId: 'eleven-routed', modelId: 'eleven_multilingual_v2', voiceId: 'default' },
        man: { providerConfigId: 'eleven-routed', modelId: 'eleven_multilingual_v2', voiceId: 'man' }
      }
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.durationMs).toBe(15)
    expect(readWavFormat(result.data)).toEqual({ sampleRate: 24000, channels: 1, bits: 16 })
  })

  it('reports the ElevenLabs error detail message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: {
              type: 'authentication_error',
              code: 'unauthorized',
              message: 'Invalid API key',
              status: 'invalid_api_key'
            }
          }),
          { status: 401, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    await service.saveProviderConfig({
      id: 'eleven-broken',
      name: 'ElevenLabs Broken',
      kind: 'online',
      type: 'elevenlabs',
      models: [{ id: 'eleven_multilingual_v2', enabled: true }],
      voices: [{ id: 'voice', enabled: true }],
      apiKey: 'wrong'
    })

    await expect(
      service.synthesizeSpeech({
        text: 'Hello',
        routing: {
          default: { providerConfigId: 'eleven-broken', modelId: 'eleven_multilingual_v2', voiceId: 'voice' }
        }
      })
    ).rejects.toThrow('Invalid API key')
  })

  it('rejects an empty ElevenLabs response body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(0), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: 'eleven-empty',
      name: 'ElevenLabs Empty',
      kind: 'online',
      type: 'elevenlabs',
      models: [{ id: 'eleven_multilingual_v2', enabled: true }],
      voices: [{ id: 'voice', enabled: true }],
      apiKey: 'eleven-secret'
    })

    await expect(
      service.synthesizeSpeech({
        text: 'Hello',
        routing: {
          default: { providerConfigId: 'eleven-empty', modelId: 'eleven_multilingual_v2', voiceId: 'voice' }
        }
      })
    ).rejects.toThrow('语音合成结果为空')
  })

  it('keeps the path prefix of a custom ElevenLabs base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(createPcm(240)), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: 'eleven-gateway',
      name: 'ElevenLabs Gateway',
      kind: 'online',
      type: 'elevenlabs',
      baseUrl: 'https://gw.example.com/eleven',
      models: [{ id: 'eleven_multilingual_v2', enabled: true }],
      voices: [{ id: '21m00Tcm4TlvDq8ikWAM', enabled: true }],
      apiKey: 'eleven-secret'
    })

    await service.synthesizeSpeech({
      text: 'Hello',
      routing: {
        default: {
          providerConfigId: 'eleven-gateway',
          modelId: 'eleven_multilingual_v2',
          voiceId: '21m00Tcm4TlvDq8ikWAM'
        }
      }
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gw.example.com/eleven/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=pcm_24000',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('rejects an ElevenLabs response that is not PCM audio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(createPcm(240)), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: 'eleven-mp3',
      name: 'ElevenLabs MP3',
      kind: 'online',
      type: 'elevenlabs',
      models: [{ id: 'eleven_multilingual_v2', enabled: true }],
      voices: [{ id: 'voice', enabled: true }],
      apiKey: 'eleven-secret'
    })

    await expect(
      service.synthesizeSpeech({
        text: 'Hello',
        routing: {
          default: { providerConfigId: 'eleven-mp3', modelId: 'eleven_multilingual_v2', voiceId: 'voice' }
        }
      })
    ).rejects.toThrow('语音合成结果不是 PCM 音频')
  })

  it('accepts an ElevenLabs PCM response without an audio content type', async () => {
    const pcm = createPcm(240)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(pcm), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: 'eleven-octets',
      name: 'ElevenLabs Octets',
      kind: 'online',
      type: 'elevenlabs',
      models: [{ id: 'eleven_multilingual_v2', enabled: true }],
      voices: [{ id: 'voice', enabled: true }],
      apiKey: 'eleven-secret'
    })

    const result = await service.synthesizeSpeech({
      text: 'Hello',
      routing: {
        default: { providerConfigId: 'eleven-octets', modelId: 'eleven_multilingual_v2', voiceId: 'voice' }
      }
    })

    expect(result).toEqual(
      expect.objectContaining({ format: 'wav', mediaType: 'audio/wav', sampleRate: 24000 })
    )
  })

  it.each(['team/voice', 'bad#voice'])(
    'encodes the ElevenLabs voice ID %s before it enters the URL path',
    async (voiceId) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(new Uint8Array(createPcm(240)), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' }
        })
      )
      vi.stubGlobal('fetch', fetchMock)
      await service.saveProviderConfig({
        id: 'eleven-voice-id',
        name: 'ElevenLabs Voice ID',
        kind: 'online',
        type: 'elevenlabs',
        models: [{ id: 'eleven_multilingual_v2', enabled: true }],
        voices: [{ id: voiceId, enabled: true }],
        apiKey: 'eleven-secret'
      })

      await service.synthesizeSpeech({
        text: 'Hello',
        routing: {
          default: {
            providerConfigId: 'eleven-voice-id',
            modelId: 'eleven_multilingual_v2',
            voiceId
          }
        }
      })

      // '#' 会让 query 落进 fragment 被丢弃，'/' 会改写路径语义，两者都必须先编码。
      const url = new URL(String(fetchMock.mock.calls[0][0]))
      expect(url.searchParams.get('output_format')).toBe('pcm_24000')
      expect(url.pathname).toBe(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`)
    }
  )

  it('keeps an empty API key usable for unauthenticated compatible services', async () => {
    const audio = createWav([0, 0, 0, 0])
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(audio), {
        status: 200,
        headers: { 'content-type': 'audio/wav' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: 'local-compatible',
      name: 'Local Compatible',
      kind: 'online',
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:8080/v1',
      models: [{ id: 'tts-1', enabled: true }],
      voices: [{ id: 'alloy', enabled: true }]
    })

    await service.synthesizeSpeech({
      text: 'Hello',
      routing: {
        default: { providerConfigId: 'local-compatible', modelId: 'tts-1', voiceId: 'alloy' }
      }
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/audio/speech',
      expect.objectContaining({
        // SDK 会把请求头过一遍 Headers，键名小写、值去掉首尾空格。
        headers: expect.objectContaining({ authorization: 'Bearer' })
      })
    )
  })

  it('does not retry a failed online synthesis call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'provider exploded' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: 'failing-openai',
      name: 'Failing OpenAI',
      kind: 'online',
      type: 'openai-compatible',
      models: [{ id: 'tts-1', enabled: true }],
      voices: [{ id: 'alloy', enabled: true }],
      apiKey: 'secret'
    })

    await expect(
      service.synthesizeSpeech({
        text: 'Hello',
        routing: {
          default: { providerConfigId: 'failing-openai', modelId: 'tts-1', voiceId: 'alloy' }
        }
      })
    ).rejects.toThrow('provider exploded')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['minimax', 'https://api.minimax.io'],
    ['minimax-cn', 'https://api.minimax.cn']
  ] as const)('maps %s speech requests and wraps hex PCM output into WAV', async (type, host) => {
    const pcm = createPcm(480)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { audio: Buffer.from(pcm).toString('hex'), status: 2 },
          extra_info: { audio_sample_rate: 24000, audio_channel: 1, audio_format: 'pcm' },
          base_resp: { status_code: 0, status_msg: 'success' }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const saved = await service.saveProviderConfig({
      id: 'minimax-speech',
      name: 'MiniMax Speech',
      kind: 'online',
      type,
      baseUrl: `${host}/`,
      models: [{ id: 'speech-2.8-hd', enabled: true }],
      voices: [{ id: 'English_Graceful_Lady', enabled: true }],
      apiKey: 'minimax-secret'
    })

    expect(saved).toEqual(
      expect.objectContaining({
        type,
        baseUrl: host,
        modelPackageId: '',
        hasApiKey: true
      })
    )

    const result = await service.synthesizeSpeech({
      text: 'Hello',
      routing: {
        default: {
          providerConfigId: 'minimax-speech',
          modelId: 'speech-2.8-hd',
          voiceId: 'English_Graceful_Lady'
        }
      }
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `${host}/v1/t2a_v2`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer minimax-secret' }),
        body: JSON.stringify({
          model: 'speech-2.8-hd',
          text: 'Hello',
          stream: false,
          output_format: 'hex',
          voice_setting: { voice_id: 'English_Graceful_Lady' },
          audio_setting: { format: 'pcm', sample_rate: 24000, channel: 1 }
        })
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        format: 'wav',
        mediaType: 'audio/wav',
        sampleRate: 24000,
        channels: 1,
        durationMs: 20
      })
    )
    expect(readWavFormat(result.data)).toEqual({ sampleRate: 24000, channels: 1, bits: 16 })
    expect(result.data.byteLength).toBe(pcm.byteLength + 44)
  })

  it.each([
    ['minimax', 'https://api.minimax.io'],
    ['minimax-cn', 'https://api.minimax.cn']
  ] as const)('defaults a %s provider to its regional base URL', async (type, host) => {
    const saved = await service.saveProviderConfig({
      id: 'minimax-default',
      name: 'MiniMax Default',
      kind: 'online',
      type,
      models: [],
      voices: []
    })

    expect(saved.baseUrl).toBe(host)
  })

  it.each(['minimax', 'minimax-cn'] as const)(
    'rejects %s as a local provider runtime',
    async (type) => {
      await expect(
        service.saveProviderConfig({
          id: 'minimax-local',
          name: 'MiniMax Local',
          kind: 'local',
          type,
          models: [],
          voices: []
        })
      ).rejects.toThrow('离线语音 Provider 类型无效')
    }
  )

  it('reports MiniMax errors that arrive with an HTTP 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            base_resp: {
              status_code: 1004,
              status_msg: "login fail: Please carry the API secret key in the 'Authorization' field"
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    await service.saveProviderConfig({
      id: 'minimax-broken',
      name: 'MiniMax Broken',
      kind: 'online',
      type: 'minimax',
      models: [{ id: 'speech-2.8-hd', enabled: true }],
      voices: [{ id: 'voice', enabled: true }],
      apiKey: 'wrong'
    })

    await expect(
      service.synthesizeSpeech({
        text: 'Hello',
        routing: {
          default: { providerConfigId: 'minimax-broken', modelId: 'speech-2.8-hd', voiceId: 'voice' }
        }
      })
    ).rejects.toThrow(/login fail.*1004/)
  })

  it('rejects a MiniMax response without hex audio', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: null, base_resp: { status_code: 0 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )
    await service.saveProviderConfig({
      id: 'minimax-empty',
      name: 'MiniMax Empty',
      kind: 'online',
      type: 'minimax',
      models: [{ id: 'speech-2.8-hd', enabled: true }],
      voices: [{ id: 'voice', enabled: true }],
      apiKey: 'secret'
    })

    await expect(
      service.synthesizeSpeech({
        text: 'Hello',
        routing: {
          default: { providerConfigId: 'minimax-empty', modelId: 'speech-2.8-hd', voiceId: 'voice' }
        }
      })
    ).rejects.toThrow('语音合成结果缺少有效音频数据')
  })

  it('rejects a MiniMax response that is not PCM audio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { audio: Buffer.from(createPcm(240)).toString('hex'), status: 2 },
          extra_info: { audio_format: 'mp3' },
          base_resp: { status_code: 0, status_msg: 'success' }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: 'minimax-mp3',
      name: 'MiniMax MP3',
      kind: 'online',
      type: 'minimax',
      models: [{ id: 'speech-2.8-hd', enabled: true }],
      voices: [{ id: 'voice', enabled: true }],
      apiKey: 'secret'
    })

    await expect(
      service.synthesizeSpeech({
        text: 'Hello',
        routing: {
          default: { providerConfigId: 'minimax-mp3', modelId: 'speech-2.8-hd', voiceId: 'voice' }
        }
      })
    ).rejects.toThrow('语音合成结果不是 PCM 音频')
  })

  it('rejects a MiniMax response with non-hex audio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { audio: 'not-hex-audio', status: 2 },
          extra_info: { audio_format: 'pcm' },
          base_resp: { status_code: 0, status_msg: 'success' }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: 'minimax-nonhex',
      name: 'MiniMax NonHex',
      kind: 'online',
      type: 'minimax',
      models: [{ id: 'speech-2.8-hd', enabled: true }],
      voices: [{ id: 'voice', enabled: true }],
      apiKey: 'secret'
    })

    await expect(
      service.synthesizeSpeech({
        text: 'Hello',
        routing: {
          default: { providerConfigId: 'minimax-nonhex', modelId: 'speech-2.8-hd', voiceId: 'voice' }
        }
      })
    ).rejects.toThrow('语音合成结果缺少有效音频数据')
  })

  it('rejects a MiniMax text longer than the single-request limit before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: 'minimax-long',
      name: 'MiniMax Long',
      kind: 'online',
      type: 'minimax',
      models: [{ id: 'speech-2.8-hd', enabled: true }],
      voices: [{ id: 'voice', enabled: true }],
      apiKey: 'secret'
    })

    await expect(
      service.synthesizeSpeech({
        text: 'a'.repeat(10_001),
        routing: {
          default: { providerConfigId: 'minimax-long', modelId: 'speech-2.8-hd', voiceId: 'voice' }
        }
      })
    ).rejects.toThrow('语音合成文本超过 MiniMax 单次请求的 10000 字符上限（当前 10001 字符）')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists MiniMax text-to-speech models without a network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      service.listModels({
        name: 'MiniMax',
        kind: 'online',
        type: 'minimax',
        models: [],
        voices: []
      })
    ).resolves.toEqual([
      { id: 'speech-2.8-hd' },
      { id: 'speech-2.8-turbo' },
      { id: 'speech-2.6-hd' },
      { id: 'speech-2.6-turbo' },
      { id: 'speech-02-hd' },
      { id: 'speech-02-turbo' },
      { id: 'speech-01-hd' },
      { id: 'speech-01-turbo' }
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists MiniMax voices from the voice management endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          system_voice: [
            { voice_id: 'English_Graceful_Lady', voice_name: 'Graceful Lady' },
            { voice_id: 'Chinese (Mandarin)_News_Anchor', voice_name: 'News Anchor' }
          ],
          voice_cloning: [{ voice_id: 'my-clone' }],
          voice_generation: [{ voice_id: 'English_Graceful_Lady' }],
          base_resp: { status_code: 0, status_msg: 'success' }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      service.listVoices({
        config: {
          name: 'MiniMax',
          kind: 'online',
          type: 'minimax',
          models: [],
          voices: [],
          apiKey: 'minimax-secret'
        },
        modelId: 'speech-2.8-hd'
      })
    ).resolves.toEqual([
      { id: 'English_Graceful_Lady', name: 'Graceful Lady' },
      { id: 'my-clone', name: undefined },
      { id: 'Chinese (Mandarin)_News_Anchor', name: 'News Anchor' }
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.minimax.io/v1/get_voice',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer minimax-secret' }),
        body: JSON.stringify({ voice_type: 'all' })
      })
    )
  })

  it('hides a MiniMax rate limit and retries after waiting ten seconds', async () => {
    useMinimaxRateLimitFakeTimers()
    const pcm = createPcm(480)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ base_resp: { status_code: 1002, status_msg: 'rate limit exceeded' } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { audio: Buffer.from(pcm).toString('hex'), status: 2 },
            extra_info: { audio_sample_rate: 24000, audio_channel: 1 },
            base_resp: { status_code: 0, status_msg: 'success' }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)
    await saveMinimaxSynthesisProvider()

    const pending = synthesizeWithMinimaxRouting()
    await flushUntil(() => fetchMock.mock.calls.length >= 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 未满 10 秒不发起第二次请求，错误也没有向外传递。
    await vi.advanceTimersByTimeAsync(9_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    const result = await pending
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual(
      expect.objectContaining({ format: 'wav', mediaType: 'audio/wav', sampleRate: 24000 })
    )
  })

  it('retries a MiniMax HTTP 429 response until it clears', async () => {
    useMinimaxRateLimitFakeTimers()
    const pcm = createPcm(480)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('too many requests', {
          status: 429,
          headers: { 'content-type': 'text/plain' }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { audio: Buffer.from(pcm).toString('hex'), status: 2 },
            extra_info: { audio_sample_rate: 24000, audio_channel: 1 },
            base_resp: { status_code: 0, status_msg: 'success' }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)
    await saveMinimaxSynthesisProvider()

    const pending = synthesizeWithMinimaxRouting()
    await flushUntil(() => fetchMock.mock.calls.length >= 1)
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await pending
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.format).toBe('wav')
  })

  it('propagates a MiniMax rate limit after the retry window is exhausted', async () => {
    useMinimaxRateLimitFakeTimers()
    // 每次重试都返回全新的 Response：同一个 Response 的 body 只能被读取一次。
    const fetchMock = vi.fn(async () => rateLimitedResponse(1039, 'TPM rate limit exceeded'))
    vi.stubGlobal('fetch', fetchMock)
    await saveMinimaxSynthesisProvider()

    const pending = synthesizeWithMinimaxRouting()
    await flushUntil(() => fetchMock.mock.calls.length >= 1)
    // 先挂上拒绝断言再推进时间：拒绝发生在推进期间，晚挂会被判定为 unhandled rejection。
    const rejection = expect(pending).rejects.toThrow(/TPM rate limit exceeded（1039）/)
    await vi.advanceTimersByTimeAsync(90_000)
    await rejection
    // 首次请求 + 9 次等待重试，累计等待正好 90 秒。
    expect(fetchMock).toHaveBeenCalledTimes(10)
  })

  it('stops waiting when a MiniMax rate-limit retry is aborted', async () => {
    useMinimaxRateLimitFakeTimers()
    const fetchMock = vi.fn(async () => rateLimitedResponse(1002, 'rate limit exceeded'))
    vi.stubGlobal('fetch', fetchMock)
    await saveMinimaxSynthesisProvider()

    const controller = new AbortController()
    const pending = synthesizeWithMinimaxRouting({ signal: controller.signal })
    await flushUntil(() => fetchMock.mock.calls.length >= 1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('routes marked lines and concatenates WAV segments in order', async () => {
    const outputs = [createWav([100, 200]), createWav([300, 400])]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array(outputs[0]), { headers: { 'content-type': 'audio/wav' } })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(outputs[1]), { headers: { 'content-type': 'audio/wav' } })
      )
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: 'provider',
      name: 'Provider',
      kind: 'online',
      type: 'openai-compatible',
      models: [{ id: 'model', enabled: true }],
      voices: [
        { id: 'default', enabled: true },
        { id: 'man', enabled: true }
      ],
      apiKey: 'secret'
    })

    const result = await service.synthesizeSpeech({
      text: '[Man]: first\n[Man]: second\nDefault line',
      routing: {
        default: { providerConfigId: 'provider', modelId: 'model', voiceId: 'default' },
        man: { providerConfigId: 'provider', modelId: 'model', voiceId: 'man' }
      }
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual(
      expect.objectContaining({ input: 'first\nsecond', voice: 'man' })
    )
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual(
      expect.objectContaining({ input: 'Default line', voice: 'default' })
    )
    expect(result.mediaType).toBe('audio/wav')
    expect(result.data.byteLength).toBeGreaterThan(outputs[0].byteLength)
  })

  it.each([
    ['mp3', 'audio/mpeg'],
    ['opus', 'audio/opus'],
    ['pcm-s16le', 'audio/pcm']
  ] as const)('transcodes multi-segment WAV output to %s', async (format, mediaType) => {
    const wav = createWav(new Array(2400).fill(0))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array(wav), { headers: { 'content-type': 'audio/wav' } })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(wav), { headers: { 'content-type': 'audio/wav' } })
      )
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: `provider-${format}`,
      name: `Provider ${format}`,
      kind: 'online',
      type: 'openai-compatible',
      models: [{ id: 'model', enabled: true }],
      voices: [
        { id: 'default', enabled: true },
        { id: 'man', enabled: true }
      ],
      apiKey: 'secret'
    })

    const result = await service.synthesizeSpeech({
      text: '[Man]: first\nDefault line',
      format,
      routing: {
        default: {
          providerConfigId: `provider-${format}`,
          modelId: 'model',
          voiceId: 'default'
        },
        man: {
          providerConfigId: `provider-${format}`,
          modelId: 'model',
          voiceId: 'man'
        }
      }
    })

    expect(result).toEqual(expect.objectContaining({ format, mediaType }))
    expect(result.data.byteLength).toBeGreaterThan(0)
    expect(
      fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)).response_format)
    ).toEqual(['wav', 'wav'])
  })

  it('rejects an invalid provider kind without corrupting stored configuration', async () => {
    await expect(
      service.saveProviderConfig({
        id: 'invalid-provider',
        name: 'Invalid Provider',
        kind: 'invalid' as never,
        type: 'pocket-tts',
        models: [],
        voices: []
      })
    ).rejects.toThrow('kind 无效')

    await expect(service.listProviderConfigs()).resolves.toEqual([])
  })

  it('uses an installed local model package and local synthesizer', async () => {
    const modelBytes = new Uint8Array([1, 2, 3])
    const modelStore = new AIRouterSpeechModelStore({ baseDir })
    const packagePath = path.join(baseDir, 'local-package.zip')
    await writeFile(packagePath, createLocalPackage(modelBytes))
    await modelStore.importPackage(packagePath)
    const synthesize = vi.fn().mockResolvedValue({
      data: createWav([1, 2]),
      mediaType: 'audio/wav',
      format: 'wav',
      sampleRate: 24000,
      channels: 1
    })
    service = new AIRouterSpeechService({
      baseDir,
      secretStorage: new EncryptedSecretStorage(baseDir, {
        encrypt: (value) => new TextEncoder().encode(value),
        decrypt: (value) => new TextDecoder().decode(value)
      }),
      modelStore,
      localSynthesizers: { 'pocket-tts': { synthesize } }
    })
    await service.saveProviderConfig({
      id: 'local',
      name: 'Pocket TTS',
      kind: 'local',
      type: 'pocket-tts',
      modelPackageId: 'local-package',
      modelPackageVersion: '1.0.0',
      models: [{ id: 'local-model', enabled: true }],
      voices: [{ id: 'voice', enabled: true }]
    })

    await expect(
      service.listModels({
        id: 'local',
        name: 'Pocket TTS',
        kind: 'local',
        type: 'pocket-tts',
        modelPackageId: 'local-package',
        modelPackageVersion: '1.0.0',
        models: [],
        voices: []
      })
    ).resolves.toEqual([expect.objectContaining({ id: 'local-model' })])
    await service.synthesizeSpeech({
      text: 'Hello',
      routing: {
        default: { providerConfigId: 'local', modelId: 'local-model', voiceId: 'voice' }
      }
    })
    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'local-model', voiceId: 'voice', text: 'Hello' })
    )
  })
})

function createLocalPackage(bytes: Uint8Array): Uint8Array {
  const hash = createHash('sha256').update(bytes).digest('hex')
  const manifest = {
    format: 'ls101.tts-model-package',
    formatVersion: 1,
    package: { id: 'local-package', version: '1.0.0', name: 'Local Package' },
    runtime: { engine: 'pocket-tts', engineApiVersion: 1 },
    assets: [
      { path: 'model.bin', kind: 'model-weights', size: bytes.byteLength, sha256: hash },
      { path: 'voice.bin', kind: 'voice', size: bytes.byteLength, sha256: hash }
    ],
    models: [
      {
        id: 'local-model',
        name: 'Local Model',
        artifacts: { weights: ['model.bin'] },
        parameters: {}
      }
    ],
    voices: [{ id: 'voice', name: 'Voice', files: ['voice.bin'] }]
  }
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'model.bin': bytes,
    'voice.bin': bytes
  })
}

function createPcm(sampleCount: number): Uint8Array {
  return new Uint8Array(sampleCount * 2)
}

function readWavFormat(data: Uint8Array): {
  sampleRate: number
  channels: number
  bits: number
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return {
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bits: view.getUint16(34, true)
  }
}

function createWav(samples: number[]): Uint8Array {
  const data = new Uint8Array(samples.length * 2)
  const dataView = new DataView(data.buffer)
  samples.forEach((sample, index) => dataView.setInt16(index * 2, sample, true))
  const buffer = new ArrayBuffer(44 + data.byteLength)
  const view = new DataView(buffer)
  const write = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index++)
      view.setUint8(offset + index, value.charCodeAt(index))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + data.byteLength, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 24000, true)
  view.setUint32(28, 48000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, data.byteLength, true)
  new Uint8Array(buffer, 44).set(data)
  return new Uint8Array(buffer)
}
