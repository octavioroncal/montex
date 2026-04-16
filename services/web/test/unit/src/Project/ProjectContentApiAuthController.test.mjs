import { beforeEach, describe, expect, it, vi } from 'vitest'
import sinon from 'sinon'
import MockResponse from '../helpers/MockResponse.mjs'

const MODULE_PATH =
  '../../../../app/src/Features/Project/ProjectContentApiAuthController.mjs'

describe('ProjectContentApiAuthController', function () {
  beforeEach(async function (ctx) {
    vi.resetModules()

    ctx.EmailHelper = {
      parseEmail: sinon.stub(),
    }

    ctx.AuthenticationManager = {
      promises: {
        authenticate: sinon.stub(),
      },
    }

    ctx.ProjectContentApiTokenManager = {
      createToken: sinon.stub(),
    }

    vi.doMock('../../../../app/src/Features/Helpers/EmailHelper.mjs', () => ({
      default: ctx.EmailHelper,
    }))

    vi.doMock(
      '../../../../app/src/Features/Authentication/AuthenticationManager.mjs',
      () => ({
        default: ctx.AuthenticationManager,
      })
    )

    vi.doMock(
      '../../../../app/src/Features/Project/ProjectContentApiTokenManager.mjs',
      () => ({
        default: ctx.ProjectContentApiTokenManager,
      })
    )

    ctx.controller = (await import(MODULE_PATH)).default
    ctx.res = new MockResponse(vi)
    ctx.next = sinon.stub()
  })

  it('returns 400 when username/email or password is missing', async function (ctx) {
    ctx.req = {
      body: {
        username: 'user@example.com',
      },
    }

    await ctx.controller.issueBearerToken(ctx.req, ctx.res, ctx.next)

    expect(ctx.res.statusCode).to.equal(400)
    expect(JSON.parse(ctx.res.body)).to.deep.equal({
      error: 'username and password are required',
    })
  })

  it('returns 401 when credentials are invalid', async function (ctx) {
    ctx.req = {
      body: {
        username: 'user@example.com',
        password: 'wrong-password',
      },
    }
    ctx.EmailHelper.parseEmail.returns('user@example.com')
    ctx.AuthenticationManager.promises.authenticate.resolves({ user: null })

    await ctx.controller.issueBearerToken(ctx.req, ctx.res, ctx.next)

    expect(ctx.res.statusCode).to.equal(401)
    expect(JSON.parse(ctx.res.body)).to.deep.equal({
      error: 'invalid_credentials',
    })
  })

  it('issues a bearer token when credentials are valid', async function (ctx) {
    const expiresAt = new Date('2027-01-01T00:00:00.000Z')
    ctx.req = {
      body: {
        email: 'user@example.com',
        password: 'correct-password',
      },
    }
    ctx.EmailHelper.parseEmail.returns('user@example.com')
    ctx.AuthenticationManager.promises.authenticate.resolves({
      user: { _id: 'user-id' },
    })
    ctx.ProjectContentApiTokenManager.createToken.resolves({
      accessToken: 'olc_test',
      tokenType: 'Bearer',
      scope: 'project_content_api',
      expiresIn: 31536000,
      expiresAt,
    })

    await ctx.controller.issueBearerToken(ctx.req, ctx.res, ctx.next)

    expect(ctx.res.statusCode).to.equal(200)
    expect(JSON.parse(ctx.res.body)).to.deep.equal({
      access_token: 'olc_test',
      token_type: 'Bearer',
      scope: 'project_content_api',
      expires_in: 31536000,
      expires_at: '2027-01-01T00:00:00.000Z',
    })
    expect(
      ctx.ProjectContentApiTokenManager.createToken.calledWith('user-id')
    ).to.equal(true)
  })
})
