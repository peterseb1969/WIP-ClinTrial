import type { RequestHandler } from 'express'

/**
 * Gateway-aware admin gate for secret-writing endpoints (mirrors WIP-KB's
 * requireAdmin). When the app runs behind wip-router with gateway auth, the
 * router injects `X-WIP-Groups`; we require one of ADMIN_GROUPS. In open /
 * apps-only / local dev mode (no gateway user header and no OIDC issuer) it
 * passes through — same posture as the rest of ClinTrial's ungated routes.
 */
const ADMIN_GROUPS = (process.env.ADMIN_GROUPS || 'wip-admins')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean)

export function requireAdmin(): RequestHandler {
  return (req, res, next) => {
    const gwUser = req.headers['x-wip-user'] as string | undefined
    const groups = ((req.headers['x-wip-groups'] as string) || '')
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)

    const authEnabled = !!process.env.OIDC_ISSUER || !!gwUser
    if (!authEnabled) {
      next()
      return
    }

    if (groups.some((g) => ADMIN_GROUPS.includes(g))) {
      next()
      return
    }
    res.status(403).json({ error: 'Administrator access required' })
  }
}
