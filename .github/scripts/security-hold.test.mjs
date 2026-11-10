import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const workflow = (name) => readFileSync(fileURLToPath(new URL('../workflows/' + name, import.meta.url)), 'utf8')
const requiredIdentity = "github.repository == 'CyberStrikeus/CyberStrike'"
const protectedJobs = {
  'cyberstrike.yml': ['preflight', 'cyberstrike'],
  'review.yml': ['check-guidelines'],
  'pr-management.yml': ['check-duplicates', 'add-contributor-label'],
  'duplicate-issues.yml': ['check-duplicates'],
  'beta.yml': ['sync'],
  'deploy.yml': ['deploy'],
  'generate.yml': ['generate'],
  'nix-hashes.yml': ['compute-hash', 'update-hashes'],
  'publish.yml': ['build-cli', 'build-app', 'publish'],
  'stats.yml': ['stats'],
  'sign-cli.yml': ['sign-cli'],
}

function blockOfJob(source, job) {
  const marker = '  ' + job + ':'
  const start = source.indexOf('\n' + marker + '\n')
  if (start < 0) return ''
  const remainder = source.slice(start + marker.length + 2)
  const end = remainder.search(/\n  [a-zA-Z][a-zA-Z0-9_-]*:\s*\n/)
  return end < 0 ? remainder : remainder.slice(0, end)
}

test('external action is immutable at Git commit level', () => {
  const s = workflow('cyberstrike.yml')
  assert.match(s, /uses: CyberStrikeus\/CyberStrike\/github@[0-9a-f]{40}/)
  assert.doesNotMatch(s, /CyberStrikeus\/CyberStrike\/github@latest/)
})

for (const [file, jobs] of Object.entries(protectedJobs)) {
  for (const job of jobs) {
    test(file + ' / ' + job + ': fork-repository deny gate', () => {
      const block = blockOfJob(workflow(file), job)
      assert.ok(block, 'expected job exists: ' + job)
      assert.ok(block.includes(requiredIdentity), 'required identity gate missing: ' + job)
    })
  }
}

test('original upstream install pipe remains a blocker rather than an assurance claim', () => {
  const s = workflow('cyberstrike.yml')
  assert.match(s, /CyberStrikeus\/CyberStrike\/github@[0-9a-f]{40}/)
  assert.match(s, /github\.repository == 'CyberStrikeus\/CyberStrike'/)
})

test('mutation: unpinning action violates invariant', () => {
  const s = workflow('cyberstrike.yml').replace(/CyberStrikeus\/CyberStrike\/github@[0-9a-f]{40}/, 'CyberStrikeus/CyberStrike/github@latest')
  assert.doesNotMatch(s, /uses: CyberStrikeus\/CyberStrike\/github@[0-9a-f]{40}/)
})

test('mutation: removing review job gate violates invariant', () => {
  const s = workflow('review.yml').replace(requiredIdentity + ' &&', 'true &&')
  assert.ok(!blockOfJob(s, 'check-guidelines').includes(requiredIdentity))
})
