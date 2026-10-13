import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export function buildMacClipboardListener(rootDir, distDir) {
  if (process.platform !== 'darwin') return
  const directory = path.join(distDir, 'native')
  mkdirSync(directory, { recursive: true })
  const target = path.join(directory, 'clipboard-event-handler-mac')
  execFileSync('/usr/bin/clang', [
    '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0',
    '-O2', '-fobjc-arc', path.join(rootDir, 'native/clipboard-event-handler-mac.m'),
    '-framework', 'AppKit', '-o', target
  ], { stdio: 'pipe' })
  chmodSync(target, 0o755)
}
