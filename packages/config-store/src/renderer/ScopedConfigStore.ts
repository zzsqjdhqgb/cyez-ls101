import { CONFIG_STORE_CHANNELS } from '../shared/constants'
import { validateConfigKey, validateConfigScopeSegment } from '../shared/pathUtils'
import type { ConfigLocation, ConfigScope, JsonValue, ScopedConfigStore } from '../shared/types'
import { getConfigStoreBridge } from './bridge'

export class ScopedConfigStoreImpl implements ScopedConfigStore {
  constructor(private readonly scopePath: ConfigScope) {}

  scope(name: string): ScopedConfigStore {
    validateConfigScopeSegment(name)
    return new ScopedConfigStoreImpl([...this.scopePath, name])
  }

  async read<T extends JsonValue>(key: string): Promise<T | null> {
    return (await this.invoke(CONFIG_STORE_CHANNELS.read, this.location(key))) as T | null
  }

  async write<T extends JsonValue>(key: string, value: T): Promise<void> {
    await this.invoke(CONFIG_STORE_CHANNELS.write, this.location(key), value)
  }

  async delete(key: string): Promise<void> {
    await this.invoke(CONFIG_STORE_CHANNELS.delete, this.location(key))
  }

  async clear(): Promise<void> {
    await this.invoke(CONFIG_STORE_CHANNELS.clear, this.scopePath)
  }

  private location(key: string): ConfigLocation {
    validateConfigKey(key)
    return { scope: this.scopePath, key }
  }

  private invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    return getConfigStoreBridge().invoke(channel, ...args)
  }
}
