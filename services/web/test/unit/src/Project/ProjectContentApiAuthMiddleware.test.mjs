import { beforeEach, describe, expect, it, vi } from 'vitest'
import sinon from 'sinon'
import MockResponse from '../helpers/MockResponse.mjs'

const MODULE_PATH =
  '../../../../app/src/Features/Project/ProjectContentApiAuthMiddleware.mjs'

describe('ProjectContentApiAuthMiddleware', function () {
  beforeEach(async function (ctx) {
    vi.resetModules()

    ctx.SessionManager = {
      getLoggedInUserId: sinon.stub(),
    }

    ctx.ProjectContentApiTokenManager = {
      getUserId: sinon.stub(),
    }

    vi.doMock(
      '../../../../app/src/Features/Authentication/SessionManager.mjs',
      () => ({
        default: ctx.SessionManager,
      })
    )

    vi.doMock(
      '../../../../app/src/Features/Project/ProjectContentApiTokenManager.mjs',
      () => ({
        default: ctx.ProjectContentApiTokenManager,
      })
    )

    ctx.middleware = (await import(MODULE_PATH)).default
    ctx.res = new MockResponse(vi)
    ctx.next = sinon.stub()
    ctx.req = {
      headers: {},
      session: {},
    }
  })

  describe('attachBearerUser', function () {
    it('continues when user is logged in by session', async function (ctx) {
      ctx.SessionManager.getLoggedInUserId.returns('session-user')

      await ctx.middleware.attachBearerUser(ctx.req, ctx.res, ctx.next)

      expect(ctx.next.calledOnce).to.equal(true)
      expect(ctx.ProjectContentApiTokenManager.getUserId.called).to.equal(false)
    })

    it('continues when no bearer token is present', async function (ctx) {
      ctx.SessionManager.getLoggedInUserId.returns(null)

      await ctx.middleware.attachBearerUser(ctx.req, ctx.res, ctx.next)

      expect(ctx.next.calledOnce).to.equal(true)
    })

    it('returns 401 when bearer token is invalid', async function (ctx) {
      ctx.SessionManager.getLoggedInUserId.returns(null)
      ctx.req.headers.authorization = 'Bearer invalid-token'
      ctx.ProjectContentApiTokenManager.getUserId.resolves(null)

      await ctx.middleware.attachBearerUser(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(401)
      expect(ctx.res.headers['WWW-Authenticate']).to.equal('Bearer')
      expect(JSON.parse(ctx.res.body)).to.deep.equal({
        error: 'invalid_token',
      })
      expect(ctx.next.called).to.equal(false)
    })

    it('adds oauth_user when bearer token is valid', async function (ctx) {
      ctx.SessionManager.getLoggedInUserId.returns(null)
      ctx.req.headers.authorization = 'Bearer valid-token'
      ctx.ProjectContentApiTokenManager.getUserId.resolves('oauth-user-id')

      await ctx.middleware.attachBearerUser(ctx.req, ctx.res, ctx.next)

      expect(ctx.req.oauth_user).to.deep.equal({ _id: 'oauth-user-id' })
      expect(ctx.next.calledOnce).to.equal(true)
    })
  })

  describe('requireBearer', function () {
    it('returns 401 when bearer token is missing', async function (ctx) {
      await ctx.middleware.requireBearer(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(401)
      expect(ctx.res.headers['WWW-Authenticate']).to.equal('Bearer')
      expect(ctx.next.called).to.equal(false)
    })

    it('returns 401 when bearer token is invalid', async function (ctx) {
      ctx.req.headers.authorization = 'Bearer invalid-token'
      ctx.ProjectContentApiTokenManager.getUserId.resolves(null)

      await ctx.middleware.requireBearer(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(401)
      expect(ctx.next.called).to.equal(false)
    })

    it('continues when bearer token is valid', async function (ctx) {
      ctx.req.headers.authorization = 'Bearer valid-token'
      ctx.ProjectContentApiTokenManager.getUserId.resolves('oauth-user-id')

      await ctx.middleware.requireBearer(ctx.req, ctx.res, ctx.next)

      expect(ctx.req.oauth_user).to.deep.equal({ _id: 'oauth-user-id' })
      expect(ctx.next.calledOnce).to.equal(true)
    })
  })

  describe('requireSessionOrBearer', function () {
    it('continues when user is logged in by session', async function (ctx) {
      ctx.SessionManager.getLoggedInUserId.returns('session-user')

      await ctx.middleware.requireSessionOrBearer(ctx.req, ctx.res, ctx.next)

      expect(ctx.next.calledOnce).to.equal(true)
    })

    it('returns 401 when bearer token is missing', async function (ctx) {
      ctx.SessionManager.getLoggedInUserId.returns(null)

      await ctx.middleware.requireSessionOrBearer(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(401)
      expect(ctx.res.headers['WWW-Authenticate']).to.equal('Bearer')
      expect(ctx.next.called).to.equal(false)
    })

    it('returns 401 when bearer token is invalid', async function (ctx) {
      ctx.SessionManager.getLoggedInUserId.returns(null)
      ctx.req.headers.authorization = 'Bearer invalid-token'
      ctx.ProjectContentApiTokenManager.getUserId.resolves(null)

      await ctx.middleware.requireSessionOrBearer(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(401)
      expect(ctx.next.called).to.equal(false)
    })

    it('continues when bearer token is valid', async function (ctx) {
      ctx.SessionManager.getLoggedInUserId.returns(null)
      ctx.req.headers.authorization = 'Bearer valid-token'
      ctx.ProjectContentApiTokenManager.getUserId.resolves('oauth-user-id')

      await ctx.middleware.requireSessionOrBearer(ctx.req, ctx.res, ctx.next)

      expect(ctx.req.oauth_user).to.deep.equal({ _id: 'oauth-user-id' })
      expect(ctx.next.calledOnce).to.equal(true)
    })
  })
})
