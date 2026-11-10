import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ALLOWED_REPOSITORY = 'CyberStrikeus/CyberStrike'
const ALLOWED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const ALLOWED_EVENTS = new Set(['issue_comment', 'pull_request_review_comment'])

/** Pure, network-free authorization decision. Never inspects credentials. */
export function authorizeComment({ repository, eventName, event }) {
  if (repository !== ALLOWED_REPOSITORY) return { allowed: false, reason: 'repository_not_enabled' }
  if (!ALLOWED_EVENTS.has(eventName)) return { allowed: false, reason: 'unsupported_event' }
  if (event?.action !== 'created') return { allowed: false, reason: 'unsupported_action' }
  if (!ALLOWED_ASSOCIATIONS.has(event?.comment?.author_association)) {
    return { allowed: false, reason: 'untrusted_author' }
  }
  if (typeof event?.comment?.body !== 'string') return { allowed: false, reason: 'missing_comment' }
  if (event.comment.body.length > 8192) return { allowed: false, reason: 'comment_too_long' }
  if (!/^\/(?:oc|cyberstrike)(?:[ \t]|$)/.test(event.comment.body)) {
    return { allowed: false, reason: 'command_not_at_start' }
  }
  return { allowed: true, reason: 'trusted_explicit_command' }
}

function main() {
  const path = process.env.GITHUB_EVENT_PATH
  if (!path) throw Error('GITHUB_EVENT_PATH is required')
  const event = JSON.parse(readFileSync(path, 'utf8'))
  const result = authorizeComment({
    repository: process.env.GITHUB_REPOSITORY,
    eventName: process.env.GITHUB_EVENT_NAME,
    event,
  })
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'authorized=' + result.allowed + '\n')
  }
  console.log(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error('Authorization preflight failed closed: ' + (error instanceof Error ? error.message : 'unknown error'))
    process.exitCode = 1
  }
}
