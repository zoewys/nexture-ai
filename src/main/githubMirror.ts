import { net, session, type Session } from 'electron'

// Hosts electron-updater hits for a GitHub release: the API for the version
// check, and github.com / objects.githubusercontent.com for asset download.
// ghproxy-class mirrors match by host suffix (*.github.com, *.githubusercontent.com),
// so probing github.com also validates that api.github.com is proxied.
const GITHUB_HOSTS = [
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com'
]

// Candidate proxies, ordered by likelihood of availability. These change often;
// selection is resolved at runtime so a dead host simply falls through.
const MIRROR_CANDIDATES = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://ghproxy.cxkpro.top/',
  'https://gh.zwy.one/',
  'https://ghproxy.net/'
]

// Owner/repo published via electron-builder (publish → github).
const REPO = 'zoewys/nexture-ai'

let activeMirror: string | null = null
let installed = false

export function getActiveMirror(): string | null {
  return activeMirror
}

/**
 * Probe candidate mirrors in parallel and pick the first that responds,
 * racing against a deadline. Resolves null (→ direct connection) if none
 * answers in time, so a broken mirror fleet never leaves the user worse off.
 */
export async function selectMirror(targetSession: Session = session.defaultSession): Promise<string | null> {
  const probeUrl = `https://github.com/${REPO}/releases/latest`
  const deadline = 4000

  return await new Promise<string | null>((resolve) => {
    let done = false
    const finish = (value: string | null): void => {
      if (done) return
      done = true
      activeMirror = value
      resolve(value)
    }

    for (const mirror of MIRROR_CANDIDATES) {
      probe(mirror + probeUrl, deadline, targetSession)
        .then((ok) => {
          if (ok) finish(mirror)
        })
        .catch(() => {})
    }

    setTimeout(() => finish(null), deadline + 200)
  })
}

function probe(url: string, timeoutMs: number, targetSession: Session): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve(value)
    }

    let req: Electron.ClientRequest
    try {
      req = net.request({ method: 'GET', url, session: targetSession, redirect: 'manual' })
    } catch {
      done(false)
      return
    }

    const timer = setTimeout(() => {
      try { req.abort() } catch {}
      done(false)
    }, timeoutMs)

    req.on('response', (res) => {
      clearTimeout(timer)
      const code = res.statusCode ?? 0
      // Any reachable HTTP response (including redirects/404 from a followable
      // proxy) means the mirror is up — 5xx or connection errors mean it isn't.
      done(code > 0 && code < 500)
    })
    req.on('error', () => {
      clearTimeout(timer)
      done(false)
    })
    req.end()
  })
}

/**
 * Rewrite every GitHub-bound request in the session to go through the active
 * mirror. Only GitHub hosts match, so git subprocesses (separate network stack)
 * and all non-GitHub traffic are untouched. No-op when no mirror is active.
 */
export function installMirrorRedirector(targetSession: Session = session.defaultSession): void {
  if (installed) return
  installed = true

  targetSession.webRequest.onBeforeRequest(
    { urls: GITHUB_HOSTS.map((h) => `https://${h}/*`) },
    (details, callback) => {
      if (!activeMirror) return callback({})
      callback({ redirectURL: activeMirror + details.url })
    }
  )
}
