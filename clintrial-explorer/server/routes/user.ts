import { Router } from 'express'

const CT_ADMIN_GROUPS = (process.env.CT_ADMIN_GROUPS || 'ct-admin')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean)

const CT_USER_GROUPS = (process.env.CT_USER_GROUPS || 'ct-user')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean)

const ALL_ALLOWED = [...CT_ADMIN_GROUPS, ...CT_USER_GROUPS]

export type AppRole = 'admin' | 'user' | 'none'

export function resolveRole(groups: string[], authEnabled: boolean): AppRole {
  if (!authEnabled) return 'admin'
  if (groups.some((g) => CT_ADMIN_GROUPS.includes(g))) return 'admin'
  if (groups.some((g) => CT_USER_GROUPS.includes(g))) return 'user'
  return 'none'
}

const router = Router()

router.get('/me', (req, res) => {
  const user = (req.headers['x-wip-user'] as string) || null
  const groups = ((req.headers['x-wip-groups'] as string) || '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)

  const authEnabled = !!process.env.OIDC_ISSUER || !!user
  const role = resolveRole(groups, authEnabled)

  res.json({
    user,
    groups,
    role,
    isAdmin: role === 'admin',
    authEnabled,
  })
})

export default router
