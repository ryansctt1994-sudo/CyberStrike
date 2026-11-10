import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { authorizeComment } from './agent-gate.mjs'

const upstream = 'CyberStrikeus/CyberStrike'
const fork = 'ryansctt1994-sudo/CyberStrike'
const valid = { repository: upstream, eventName: 'issue_comment', event: {
  action: 'created', comment: { author_association: 'OWNER', body: '/cyberstrike review' }
} }

const cases = [
  ['upstream owner exact command', valid, true],
  ['upstream member short command', { ...valid, event: { ...valid.event, comment: { author_association: 'MEMBER', body: '/oc' } } }, true],
  ['upstream collaborator, review comment', { ...valid, eventName: 'pull_request_review_comment', event: { ...valid.event, comment: { author_association: 'COLLABORATOR', body: '/oc check' } } }, true],
  ['fork owner denied', { ...valid, repository: fork }, false],
  ['fork collaborator denied', { ...valid, repository: fork, event: { ...valid.event, comment: { author_association: 'COLLABORATOR', body: '/oc' } } }, false],
  ['outsider denied', { ...valid, event: { ...valid.event, comment: { author_association: 'NONE', body: '/cyberstrike' } } }, false],
  ['contributor denied', { ...valid, event: { ...valid.event, comment: { author_association: 'CONTRIBUTOR', body: '/oc' } } }, false],
  ['first-time contributor denied', { ...valid, event: { ...valid.event, comment: { author_association: 'FIRST_TIME_CONTRIBUTOR', body: '/oc' } } }, false],
  ['no association denied', { ...valid, event: { ...valid.event, comment: { body: '/oc' } } }, false],
  ['invalid event denied', { ...valid, eventName: 'workflow_dispatch' }, false],
  ['edited comment denied', { ...valid, event: { ...valid.event, action: 'edited' } }, false],
  ['quoted command denied', { ...valid, event: { ...valid.event, comment: { author_association: 'OWNER', body: '> /cyberstrike now' } } }, false],
  ['embedded command denied', { ...valid, event: { ...valid.event, comment: { author_association: 'OWNER', body: 'hello /oc' } } }, false],
  ['extra command prefix denied', { ...valid, event: { ...valid.event, comment: { author_association: 'OWNER', body: '/cyberstrikeevil' } } }, false],
  ['prefixed newline denied', { ...valid, event: { ...valid.event, comment: { author_association: 'OWNER', body: '\n/oc' } } }, false],
  ['missing body denied', { ...valid, event: { ...valid.event, comment: { author_association: 'OWNER' } } }, false],
  ['oversized input denied', { ...valid, event: { ...valid.event, comment: { author_association: 'OWNER', body: '/oc' + 'x'.repeat(8200) } } }, false],
]

for (const [name, args, expected] of cases) {
  test(name, () => assert.equal(authorizeComment(args).allowed, expected))
}

test('real CLI preflight writes deny decision to GITHUB_OUTPUT without credentials', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cyberstrike-gate-'))
  try {
    const eventPath = path.join(dir, 'event.json')
    const outputPath = path.join(dir, 'output.txt')
    writeFileSync(eventPath, JSON.stringify(valid.event))
    writeFileSync(outputPath, '')
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./agent-gate.mjs', import.meta.url))], {
      env: {
        PATH: process.env.PATH,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_REPOSITORY: fork,
        GITHUB_EVENT_NAME: 'issue_comment',
      }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(outputPath, 'utf8'), 'authorized=false\n')
    assert.deepEqual(JSON.parse(result.stdout), { allowed: false, reason: 'repository_not_enabled' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invalid JSON fails closed without granting permission', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cyberstrike-gate-'))
  try {
    const eventPath = path.join(dir, 'event.json')
    const outputPath = path.join(dir, 'output.txt')
    writeFileSync(eventPath, '{broken')
    writeFileSync(outputPath, '')
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./agent-gate.mjs', import.meta.url))], {
      env: { PATH: process.env.PATH, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath, GITHUB_REPOSITORY: upstream, GITHUB_EVENT_NAME: 'issue_comment' },
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0)
    assert.equal(readFileSync(outputPath, 'utf8'), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function workflowText() {
  return readFileSync(fileURLToPath(new URL('../workflows/cyberstrike.yml', import.meta.url)), 'utf8')
}
function isSafelyWired(source) {
  const preflight = source.split(/^  preflight:\s*$/m)[1]?.split(/^  cyberstrike:\s*$/m)[0] ?? ''
  const agent = source.split(/^  cyberstrike:\s*$/m)[1] ?? ''
  return (
    /^    if: github\.repository == 'CyberStrikeus\/CyberStrike'$/m.test(preflight) &&
    preflight.includes('run: node .github/scripts/agent-gate.mjs') &&
    preflight.includes('authorized: ${{ steps.guard.outputs.authorized }}') &&
    !preflight.includes('CYBERSTRIKE_API_KEY') &&
    !preflight.includes('id-token: write') &&
    agent.includes('needs: preflight') &&
    agent.includes("if: github.repository == 'CyberStrikeus/CyberStrike' && needs.preflight.outputs.authorized == 'true'")
  )
}

test('agent workflow requires separate safe preflight and wired output', () => {
  assert.equal(isSafelyWired(workflowText()), true)
})
test('mutation: bypassing preflight output is detected', () => {
  const changed = workflowText().replace("needs.preflight.outputs.authorized == 'true'", 'true')
  assert.equal(isSafelyWired(changed), false)
})
test('mutation: removing repository lock is detected', () => {
  const changed = workflowText().replace("if: github.repository == 'CyberStrikeus/CyberStrike'", 'if: true')
  assert.equal(isSafelyWired(changed), false)
})
test('mutation: moving model secret to preflight is detected', () => {
  const changed = workflowText().replace('      - name: Authorize comment without model secrets', '      - name: Authorize comment without model secrets\n        env:\n          CYBERSTRIKE_API_KEY: test')
  assert.equal(isSafelyWired(changed), false)
})
