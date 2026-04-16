import crypto from 'node:crypto'
import logger from '@overleaf/logger'
import { db, ObjectId } from '../../infrastructure/mongodb.mjs'

const TOKEN_PREFIX = 'olc_'
const TOKEN_LENGTH = 40
const TOKEN_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const TOKEN_SCOPE = 'project_content_api'
const TOKEN_TYPE = 'personal_access_token'
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365 // 1 year

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function generateToken(length) {
  const max = TOKEN_CHARS.length
  let token = ''
  for (let i = 0; i < length; i++) {
    token += TOKEN_CHARS[crypto.randomInt(max)]
  }
  return token
}

function toObjectId(value) {
  if (!value) {
    return null
  }
  if (value instanceof ObjectId) {
    return value
  }
  if (typeof value === 'string' && ObjectId.isValid(value)) {
    return new ObjectId(value)
  }
  return value
}

const ProjectContentApiTokenManager = {
  TOKEN_SCOPE,
  TOKEN_TTL_SECONDS,

  async createToken(userId) {
    const normalizedUserId = toObjectId(userId)
    const token = TOKEN_PREFIX + generateToken(TOKEN_LENGTH)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_SECONDS * 1000)
    const accessTokenPartial = token.slice(0, 8)

    await db.oauthAccessTokens.insertOne({
      accessToken: hashToken(token),
      accessTokenPartial,
      user_id: normalizedUserId,
      type: TOKEN_TYPE,
      scope: TOKEN_SCOPE,
      createdAt: now,
      expiresAt,
    })

    return {
      accessToken: token,
      tokenType: 'Bearer',
      scope: TOKEN_SCOPE,
      expiresAt,
      expiresIn: TOKEN_TTL_SECONDS,
    }
  },

  async getUserId(token) {
    if (!token?.startsWith(TOKEN_PREFIX)) {
      return null
    }

    const now = new Date()
    const tokenDoc = await db.oauthAccessTokens.findOne(
      {
        accessToken: hashToken(token),
        type: TOKEN_TYPE,
        scope: new RegExp(`\\b${TOKEN_SCOPE}\\b`),
        expiresAt: { $gt: now },
      },
      { projection: { _id: 1, user_id: 1 } }
    )

    const userId = tokenDoc?.user_id
    if (!userId) {
      return null
    }

    const normalizedUserId = toObjectId(userId)
    const user = await db.users.findOne(
      { _id: normalizedUserId },
      { projection: { _id: 1 } }
    )

    if (!user?._id) {
      return null
    }

    db.oauthAccessTokens
      .updateOne({ _id: tokenDoc._id }, { $set: { lastUsedAt: now } })
      .catch(err => logger.error({ err }, 'error updating API token lastUsedAt'))

    return user._id.toString()
  },
}

export default ProjectContentApiTokenManager
