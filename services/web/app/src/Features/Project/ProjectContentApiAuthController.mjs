import { expressify } from '@overleaf/promise-utils'
import EmailHelper from '../Helpers/EmailHelper.mjs'
import AuthenticationManager from '../Authentication/AuthenticationManager.mjs'
import ProjectContentApiTokenManager from './ProjectContentApiTokenManager.mjs'

async function issueBearerToken(req, res) {
  const username = req.body?.username ?? req.body?.email
  const password = req.body?.password

  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    !username.trim() ||
    !password
  ) {
    return res.status(400).json({
      error: 'username and password are required',
    })
  }

  const email = EmailHelper.parseEmail(username)
  if (!email) {
    return res.status(401).json({
      error: 'invalid_credentials',
    })
  }

  const { user } = await AuthenticationManager.promises.authenticate(
    { email },
    password,
    null,
    { enforceHIBPCheck: false }
  )

  if (!user?._id) {
    return res.status(401).json({
      error: 'invalid_credentials',
    })
  }

  const token = await ProjectContentApiTokenManager.createToken(user._id)
  return res.json({
    access_token: token.accessToken,
    token_type: token.tokenType,
    scope: token.scope,
    expires_in: token.expiresIn,
    expires_at: token.expiresAt.toISOString(),
  })
}

export default {
  issueBearerToken: expressify(issueBearerToken),
}
