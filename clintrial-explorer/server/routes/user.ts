import { Router } from 'express'

const ADMIN_GROUPS = (process.env.ADMIN_GROUPS || 'wip-admins')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean)

const router = Router()

router.get('/me', (req, res) => {
  const user = (req.headers['x-wip-user'] as string) || null
  const groups = ((req.headers['x-wip-groups'] as string) || '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)

  const authEnabled = !!process.env.OIDC_ISSUER || !!user
  const isAdmin = !authEnabled || groups.some((g) => ADMIN_GROUPS.includes(g))

  res.json({
    user,
    groups,
    isAdmin,
    authEnabled,
  })
})

export default router
