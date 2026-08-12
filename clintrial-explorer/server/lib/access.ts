import type { RequestHandler } from 'express'
import { resolveRole, type AppRole } from '../routes/user.js'

export function requireRole(minRole: AppRole): RequestHandler {
  return (req, res, next) => {
    const gwUser = req.headers['x-wip-user'] as string | undefined
    const groups = ((req.headers['x-wip-groups'] as string) || '')
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)

    const authEnabled = !!process.env.OIDC_ISSUER || !!gwUser
    const role = resolveRole(groups, authEnabled)

    if (minRole === 'admin' && role !== 'admin') {
      res.status(403).json({ error: 'Administrator access required' })
      return
    }
    if (minRole === 'user' && role === 'none') {
      res.status(403).json({ error: 'Access denied — ct-user or ct-admin group required' })
      return
    }
    next()
  }
}
