/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Root of the scratch directories created by {@link createTemporaryDirectory}.
 *
 * On Windows `os.tmpdir()` is `%LOCALAPPDATA%\Temp` on the system drive, and importing the Qwen3-TTS
 * model package alone needs `1.57 GiB + 512 MiB` of free space there. The Playwright suites therefore
 * failed on machines whose system drive was nearly full while the project drive had room, so on
 * Windows the scratch data now lives next to the project, on the same volume as `dist/`. `.cache/` is
 * already ignored by git and by ESLint, and the whole root is disposable.
 *
 * Every other platform keeps `os.tmpdir()`. Electron refuses to start when its user data directory
 * sits on a filesystem that cannot create symlinks, because Chromium's process singleton writes a
 * `SingletonLock` symlink there. Shared and network mounts — including the Windows drive share used
 * inside this repository's dev container — reject symlink creation with `EPERM`, so a project-local
 * root would break the packaged integration suites on those machines.
 *
 * Set `LS101_TEST_TEMP_ROOT` to an absolute path to override the default on any platform.
 */
export const TEMPORARY_DIRECTORY_ROOT =
  process.env['LS101_TEST_TEMP_ROOT'] ??
  (process.platform === 'win32' ? path.resolve('.cache', 'test-tmp') : tmpdir())

/**
 * Creates a uniquely named directory under {@link TEMPORARY_DIRECTORY_ROOT} and returns its real path.
 * Callers stay responsible for removing the directory, exactly as they were with `mkdtemp`.
 */
export async function createTemporaryDirectory(prefix: string): Promise<string> {
  await mkdir(TEMPORARY_DIRECTORY_ROOT, { recursive: true })
  return realpath(await mkdtemp(path.join(TEMPORARY_DIRECTORY_ROOT, prefix)))
}
