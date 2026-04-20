import SessionManager from '../Authentication/SessionManager.mjs'
import ProjectContentApiTokenManager from './ProjectContentApiTokenManager.mjs'

function getBearerToken(req) {
  const header = req.headers?.authorization
  if (!header) {
    return null
  }
  const [scheme, token] = header.trim().split(/\s+/, 2)
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null
  }
  return token
}

function setOauthUser(req, userId) {
  req.oauth_user = { _id: userId }
}

function sendUnauthorized(res) {
  res.setHeader('WWW-Authenticate', 'Bearer')
  res.status(401).json({
    error: 'invalid_token',
  })
}

const ProjectContentApiAuthMiddleware = {
  async requireBearer(req, res, next) {
    const token = getBearerToken(req)
    if (!token) {
      return sendUnauthorized(res)
    }

    const userId = await ProjectContentApiTokenManager.getUserId(token)
    if (!userId) {
      return sendUnauthorized(res)
    }

    setOauthUser(req, userId)
    return next()
  },

  async attachBearerUser(req, res, next) {
    const sessionUserId = SessionManager.getLoggedInUserId(req.session)
    if (sessionUserId) {
      return next()
    }

    const token = getBearerToken(req)
    if (!token) {
      return next()
    }

    const userId = await ProjectContentApiTokenManager.getUserId(token)
    if (!userId) {
      return sendUnauthorized(res)
    }

    setOauthUser(req, userId)
    return next()
  },

  async requireSessionOrBearer(req, res, next) {
    const sessionUserId = SessionManager.getLoggedInUserId(req.session)
    if (sessionUserId) {
      return next()
    }

    const token = getBearerToken(req)
    if (!token) {
      return sendUnauthorized(res)
    }

    const userId = await ProjectContentApiTokenManager.getUserId(token)
    if (!userId) {
      return sendUnauthorized(res)
    }

    setOauthUser(req, userId)
    return next()
  },
}

export default ProjectContentApiAuthMiddleware
