#!/usr/bin/env node
// @ts-check
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { parseArgs } from 'node:util'

import { execa } from 'execa'
import {
  intro,
  outro,
  log,

  select,
  confirm,
  spinner,

  cancel,
  isCancel
} from '@clack/prompts'
import pico from 'picocolors'

/**
 * Normalize the prompt answer and deal with cancel operations
 * @template T
 * @param {T | symbol} cancellable - The cancellable value to normalize.
 * @returns {T} - The normalized value.
 */
function normalizeAnswer (cancellable) {
  if (isCancel(cancellable)) {
    cancel('Operation cancelled.')
    process.exit(0)
  } else {
    return cancellable
  }
}

const packageJsonPath = resolve(cwd(), './package.json')
if (!existsSync(packageJsonPath)) {
  throw new Error('Cannot find package.json in the current directory')
}
const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))

const SUPPORTED_PACKAGE_MANAGERS = /** @type {const} */(['npm', 'pnpm', 'yarn', 'cnpm'])
/** @typedef {typeof SUPPORTED_PACKAGE_MANAGERS[number]} PackageManager */
/** @type PackageManager */
let pm = 'npm'

intro('Install Vue Canary')

/** type {PackageManager | string} */
let forcePackageManagerBin

// npx install-vue-canary --with pnpm
const { values } = parseArgs({
  options: {
    with: {
      type: 'string'
    }
  }
})
forcePackageManagerBin = values.with

// look for packageManager field
if (!forcePackageManagerBin && typeof pkg.packageManager === 'string') {
  const [name] = pkg.packageManager.split('@')
  forcePackageManagerBin = name
}

if (forcePackageManagerBin) {
  if (SUPPORTED_PACKAGE_MANAGERS.includes(forcePackageManagerBin)) {
    pm = forcePackageManagerBin
  } else {
    log.warn(`Unknown packageManager: ${pico.red(pkg.packageManager)}`)
    log.warn("Assuming it follows npm CLI's behavior...")

    pm = 'npm'
  }
}

if (!forcePackageManagerBin) {
  // look for pnpm-lock.yaml, yarn.lock, package-lock.json
  /** @type {Record<string, PackageManager>} */
  const LOCKFILE_TO_PACKAGE_MANAGER = {
    'pnpm-lock.yaml': 'pnpm',
    'yarn.lock': 'yarn',
    'package-lock.json': 'npm',
    'npm-shrinkwrap.json': 'npm'
  }
  /** @type {PackageManager[]} */
  const pmCandidates = []
  for (const [lockfile, pmName] of Object.entries(LOCKFILE_TO_PACKAGE_MANAGER)) {
    if (existsSync(resolve(cwd(), lockfile))) {
      pmCandidates.push(pmName)
    }
  }

  if (pmCandidates.length === 1) {
    pm = pmCandidates[0]
  } else if (pmCandidates.length > 1) {
    const choice = await select({
      message: 'More than one lockfile found, please select the package manager you would like to use',
      options: pmCandidates.map(candidate => ({ value: candidate, label: candidate }))
    })
    pm = normalizeAnswer(choice)
  } else {
    const choice = await select({
      message: 'Cannot infer which package manager to use, please select',
      options: SUPPORTED_PACKAGE_MANAGERS.map(candidate => ({ value: candidate, label: candidate }))
    })
    pm = normalizeAnswer(choice)
  }
}

// FIXME:
// Hard-code the overrides until we find a better approach
const CANARY_OVERRIDES = {
  vue: 'npm:@vue/canary',
  '@vue/compiler-core': 'npm:@vue/compiler-core-canary',
  '@vue/compiler-dom': 'npm:@vue/compiler-dom-canary',
  '@vue/compiler-sfc': 'npm:@vue/compiler-sfc-canary',
  '@vue/compiler-ssr': 'npm:@vue/compiler-ssr-canary',
  '@vue/reactivity': 'npm:@vue/reactivity-canary',
  '@vue/reactivity-transform': 'npm:@vue/reactivity-transform-canary',
  '@vue/runtime-core': 'npm:@vue/runtime-core-canary',
  '@vue/runtime-dom': 'npm:@vue/runtime-dom-canary',
  '@vue/server-renderer': 'npm:@vue/server-renderer-canary',
  '@vue/shared': 'npm:@vue/shared-canary',
  '@vue/compat': 'npm:@vue/compat-canary'
}

// TODO: support version numbers

// add `pnpm.overrides` (pnpm), `resolutions` (yarn, cnpm), `overrides` (npm) accordingly
// https://github.com/yarnpkg/rfcs/blob/master/implemented/0000-selective-versions-resolutions.md
// https://pnpm.io/package_json#pnpmoverrides
// https://github.com/npm/rfcs/blob/main/accepted/0036-overrides.md
// pnpm & npm differs slightly on their abilities: https://github.com/npm/rfcs/pull/129/files#r440478558
// so they use different configuration fields
if (pm === 'pnpm') {
  pkg.pnpm ||= {}
  pkg.pnpm.overrides = {
    ...pkg.pnpm.overrides,
    ...CANARY_OVERRIDES
  }
  log.info(`Updated ${pico.cyan('pnpm.overrides')} in ${pico.yellow('package.json')}`)
} else if (pm === 'npm') {
  pkg.overrides = {
    ...pkg.overrides,
    ...CANARY_OVERRIDES
  }
  log.info(`Updated ${pico.cyan('overrides')} in ${pico.yellow('package.json')}`)
} else if (pm === 'yarn' || pm === 'cnpm') {
  pkg.resolutions = {
    ...pkg.resolutions,
    ...CANARY_OVERRIDES
  }
  log.info(`Updated ${pico.cyan('resolutions')} in ${pico.yellow('package.json')}`)
}

// write pkg back
writeFileSync(packageJsonPath, JSON.stringify(pkg, undefined, 2) + '\n', 'utf-8')

// prompt & run install
const bin = forcePackageManagerBin || pm
const shouldInstall = await confirm({
  message: `Run ${pico.magenta(`${bin} install`)} to install the updated dependencies?`,
  initialValue: true
})

if (normalizeAnswer(shouldInstall)) {
  const s = spinner()
  s.start(`Installing via ${bin}`)
  try {
    await execa(bin, ['install'], { stdio: 'pipe' })
    s.stop(`Installed via ${bin}`)
  } catch (e) {
    log.error(e.stderr || e.message)
    s.stop(pico.red('Installation failed'))
    process.exit(1)
  }
}

outro()
