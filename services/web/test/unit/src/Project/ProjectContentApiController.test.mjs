import { beforeEach, describe, expect, it, vi } from 'vitest'
import sinon from 'sinon'
import MockResponse from '../helpers/MockResponse.mjs'

const MODULE_PATH =
  '../../../../app/src/Features/Project/ProjectContentApiController.mjs'

describe('ProjectContentApiController', function () {
  beforeEach(async function (ctx) {
    vi.resetModules()
    ctx.Errors = (
      await import('../../../../app/src/Features/Errors/Errors.js')
    ).default

    ctx.ProjectGetter = {
      promises: {
        getProject: sinon.stub(),
      },
    }

    ctx.ProjectLocator = {
      promises: {
        findElementByPath: sinon.stub(),
      },
    }

    ctx.FileStoreController = {
      getFile: sinon.stub(),
    }

    ctx.DocumentUpdaterController = {
      getDoc: sinon.stub(),
    }

    ctx.SessionManager = {
      getLoggedInUserId: sinon.stub(),
    }

    ctx.UserGetter = {
      promises: {
        getUsers: sinon.stub(),
      },
    }

    ctx.HistoryManager = {
      promises: {
        requestBlob: sinon.stub(),
      },
    }

    ctx.CompileManager = {
      promises: {
        compile: sinon.stub(),
      },
    }

    ctx.CompileController = {
      _getUserIdForCompile: sinon.stub().returns('user-id'),
      _proxyToClsi: sinon.stub().resolves(),
    }

    vi.doMock('../../../../app/src/Features/Project/ProjectGetter.mjs', () => ({
      default: ctx.ProjectGetter,
    }))

    vi.doMock(
      '../../../../app/src/Features/Project/ProjectLocator.mjs',
      () => ({
        default: ctx.ProjectLocator,
      })
    )

    vi.doMock(
      '../../../../app/src/Features/FileStore/FileStoreController.mjs',
      () => ({
        default: ctx.FileStoreController,
      })
    )

    vi.doMock(
      '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterController.mjs',
      () => ({
        default: ctx.DocumentUpdaterController,
      })
    )

    vi.doMock(
      '../../../../app/src/Features/Authentication/SessionManager.mjs',
      () => ({
        default: ctx.SessionManager,
      })
    )

    vi.doMock('../../../../app/src/Features/User/UserGetter.mjs', () => ({
      default: ctx.UserGetter,
    }))

    vi.doMock('../../../../app/src/Features/History/HistoryManager.mjs', () => ({
      default: ctx.HistoryManager,
    }))

    vi.doMock('../../../../app/src/Features/Compile/CompileManager.mjs', () => ({
      default: ctx.CompileManager,
    }))

    vi.doMock(
      '../../../../app/src/Features/Compile/CompileController.mjs',
      () => ({
        default: ctx.CompileController,
      })
    )

    ctx.controller = (await import(MODULE_PATH)).default
    ctx.projectId = '65f2f57f8d6c0b6d50300001'
    ctx.req = {
      params: {
        Project_id: ctx.projectId,
      },
      query: {},
    }
    ctx.res = new MockResponse(vi)
    ctx.next = sinon.stub()
  })

  describe('projectStructureJson', function () {
    it('returns a nested project structure', async function (ctx) {
      ctx.ProjectGetter.promises.getProject.resolves({
        _id: ctx.projectId,
        name: 'My project',
        rootDoc_id: 'doc-root',
        rootFolder: [
          {
            _id: 'root-folder',
            name: 'rootFolder',
            folders: [
              {
                _id: 'chapter-folder',
                name: 'chapters',
                folders: [],
                docs: [{ _id: 'doc-2', name: 'chapter1.tex' }],
                fileRefs: [{ _id: 'file-2', name: 'figure.png' }],
              },
            ],
            docs: [{ _id: 'doc-1', name: 'main.tex' }],
            fileRefs: [{ _id: 'file-1', name: 'refs.bib' }],
          },
        ],
      })

      await ctx.controller.projectStructureJson(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(200)
      const body = JSON.parse(ctx.res.body)
      expect(body.project_id).to.equal(ctx.projectId)
      expect(body.rootDocId).to.equal('doc-root')
      expect(body.structure.path).to.equal('')
      expect(body.structure.docs).to.deep.equal([
        {
          _id: 'doc-1',
          name: 'main.tex',
          type: 'doc',
          path: 'main.tex',
        },
      ])
      expect(body.structure.folders[0].path).to.equal('chapters')
      expect(body.structure.folders[0].docs[0].path).to.equal(
        'chapters/chapter1.tex'
      )
      expect(body.structure.folders[0].files[0].path).to.equal(
        'chapters/figure.png'
      )
    })
  })

  describe('userProjectsStructureJson', function () {
    it('returns all user project structures with file metadata', async function (ctx) {
      ctx.req.session = {}
      ctx.SessionManager.getLoggedInUserId.returns('user-id')
      ctx.ProjectGetter.promises.findAllUsersProjects = sinon
        .stub()
        .resolves({
          owned: [
            {
              _id: { toString: () => 'project-1' },
              name: 'Project One',
              owner_ref: { toString: () => 'owner-1' },
              lastUpdatedBy: { toString: () => 'editor-1' },
              lastUpdated: new Date('2025-01-12T08:30:00.000Z'),
              overleaf: { history: { id: 'history-1' } },
              rootDoc_id: 'doc-main',
              rootFolder: [
                {
                  _id: 'root',
                  name: 'rootFolder',
                  folders: [],
                  docs: [{ _id: 'doc-1', name: 'main.tex' }],
                  fileRefs: [
                    {
                      _id: 'file-1',
                      name: 'figure.png',
                      hash: 'abc123',
                      created: new Date('2025-01-10T10:00:00.000Z'),
                    },
                  ],
                },
              ],
            },
          ],
          readAndWrite: [],
          readOnly: [],
          tokenReadAndWrite: [],
          tokenReadOnly: [],
          review: [],
        })

      ctx.UserGetter.promises.getUsers.resolves([
        {
          _id: { toString: () => 'owner-1' },
          email: 'owner@example.com',
          first_name: 'Owner',
          last_name: 'User',
        },
        {
          _id: { toString: () => 'editor-1' },
          email: 'editor@example.com',
          first_name: 'Editor',
          last_name: 'User',
        },
      ])

      ctx.HistoryManager.promises.requestBlob.resolves({ contentLength: 2048 })

      await ctx.controller.userProjectsStructureJson(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(200)
      const body = JSON.parse(ctx.res.body)
      expect(body.userId).to.equal('user-id')
      expect(body.projects).to.have.length(1)
      expect(body.projects[0].projectName).to.equal('Project One')
      expect(body.projects[0].owner.email).to.equal('owner@example.com')
      expect(body.projects[0].lastUpdatedBy.email).to.equal(
        'editor@example.com'
      )
      expect(body.projects[0].files).to.deep.equal([
        {
          _id: 'doc-1',
          name: 'main.tex',
          type: 'doc',
          path: 'main.tex',
          owner: {
            id: 'owner-1',
            email: 'owner@example.com',
            firstName: 'Owner',
            lastName: 'User',
          },
          uploadedByOrOwner: {
            id: 'editor-1',
            email: 'editor@example.com',
            firstName: 'Editor',
            lastName: 'User',
          },
          createdAt: null,
          modifiedAt: '2025-01-12T08:30:00.000Z',
          sizeKb: null,
        },
        {
          _id: 'file-1',
          name: 'figure.png',
          type: 'file',
          path: 'figure.png',
          owner: {
            id: 'owner-1',
            email: 'owner@example.com',
            firstName: 'Owner',
            lastName: 'User',
          },
          uploadedByOrOwner: {
            id: 'editor-1',
            email: 'editor@example.com',
            firstName: 'Editor',
            lastName: 'User',
          },
          createdAt: '2025-01-10T10:00:00.000Z',
          modifiedAt: '2025-01-12T08:30:00.000Z',
          sizeKb: 2,
        },
      ])
      expect(ctx.HistoryManager.promises.requestBlob.calledOnce).to.equal(true)
      expect(
        ctx.HistoryManager.promises.requestBlob.calledWith(
          'history-1',
          'abc123',
          'HEAD'
        )
      ).to.equal(true)
    })
  })

  describe('userProjectsSummaryJson', function () {
    it('returns a deduplicated list of project ids and names', async function (ctx) {
      ctx.req.session = {}
      ctx.SessionManager.getLoggedInUserId.returns('user-id')
      ctx.ProjectGetter.promises.findAllUsersProjects = sinon.stub().resolves({
        owned: [
          {
            _id: { toString: () => 'project-1' },
            name: 'Project One',
          },
        ],
        readOnly: [
          {
            _id: { toString: () => 'project-1' },
            name: 'Project One',
          },
          {
            _id: { toString: () => 'project-2' },
            name: 'Project Two',
          },
        ],
      })

      await ctx.controller.userProjectsSummaryJson(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(200)
      const body = JSON.parse(ctx.res.body)
      expect(body).to.deep.equal({
        userId: 'user-id',
        projects: [
          {
            project_id: 'project-1',
            projectName: 'Project One',
          },
          {
            project_id: 'project-2',
            projectName: 'Project Two',
          },
        ],
      })
    })

    it('uses oauth_user when session user is missing', async function (ctx) {
      ctx.req.session = {}
      ctx.req.oauth_user = { _id: { toString: () => 'oauth-user-id' } }
      ctx.SessionManager.getLoggedInUserId.returns(null)
      ctx.ProjectGetter.promises.findAllUsersProjects = sinon.stub().resolves({
        owned: [
          {
            _id: { toString: () => 'project-1' },
            name: 'Project One',
          },
        ],
      })

      await ctx.controller.userProjectsSummaryJson(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(200)
      const body = JSON.parse(ctx.res.body)
      expect(body.userId).to.equal('oauth-user-id')
      expect(body.projects).to.deep.equal([
        {
          project_id: 'project-1',
          projectName: 'Project One',
        },
      ])
    })

    it('returns 401 when there is no authenticated user', async function (ctx) {
      ctx.req.session = {}
      ctx.SessionManager.getLoggedInUserId.returns(null)
      ctx.ProjectGetter.promises.findAllUsersProjects = sinon.stub()

      await ctx.controller.userProjectsSummaryJson(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(401)
      expect(ctx.ProjectGetter.promises.findAllUsersProjects.called).to.equal(
        false
      )
    })
  })

  describe('downloadProjectEntityByPath', function () {
    it('uses DocumentUpdaterController when the path is a doc', async function (ctx) {
      ctx.req.params[0] = 'src/main.tex'
      ctx.ProjectLocator.promises.findElementByPath.resolves({
        type: 'doc',
        element: { _id: 'doc-id' },
      })

      await ctx.controller.downloadProjectEntityByPath(ctx.req, ctx.res, ctx.next)

      expect(ctx.req.params.Doc_id).to.equal('doc-id')
      expect(ctx.DocumentUpdaterController.getDoc.calledOnce).to.equal(true)
      expect(ctx.FileStoreController.getFile.called).to.equal(false)
    })

    it('uses FileStoreController when the path is a binary file', async function (ctx) {
      ctx.req.params[0] = 'images/logo.png'
      ctx.ProjectLocator.promises.findElementByPath.resolves({
        type: 'file',
        element: { _id: 'file-id' },
      })

      await ctx.controller.downloadProjectEntityByPath(ctx.req, ctx.res, ctx.next)

      expect(ctx.req.params.File_id).to.equal('file-id')
      expect(ctx.FileStoreController.getFile.calledOnce).to.equal(true)
      expect(ctx.DocumentUpdaterController.getDoc.called).to.equal(false)
    })

    it('returns 400 if the path points to a folder', async function (ctx) {
      ctx.req.params[0] = 'images'
      ctx.ProjectLocator.promises.findElementByPath.resolves({
        type: 'folder',
        element: { _id: 'folder-id' },
      })

      await ctx.controller.downloadProjectEntityByPath(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(400)
      expect(JSON.parse(ctx.res.body)).to.deep.equal({
        error: 'path points to a folder',
      })
    })

    it('returns 404 when no entity is found for the path', async function (ctx) {
      ctx.req.params[0] = 'missing/file.tex'
      ctx.ProjectLocator.promises.findElementByPath.rejects(
        new ctx.Errors.NotFoundError()
      )

      await ctx.controller.downloadProjectEntityByPath(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(404)
    })
  })

  describe('downloadCompiledPdfByPath', function () {
    it('returns 400 if path is missing', async function (ctx) {
      await ctx.controller.downloadCompiledPdfByPath(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(400)
      expect(JSON.parse(ctx.res.body)).to.deep.equal({
        error: 'path is required',
      })
    })

    it('returns 404 when no entity is found for the path', async function (ctx) {
      ctx.req.params[0] = 'missing/main.tex'
      ctx.ProjectLocator.promises.findElementByPath.rejects(
        new ctx.Errors.NotFoundError()
      )

      await ctx.controller.downloadCompiledPdfByPath(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(404)
    })

    it('returns 400 when path is not a latex doc', async function (ctx) {
      ctx.req.params[0] = 'images/logo.png'
      ctx.ProjectLocator.promises.findElementByPath.resolves({
        type: 'file',
        element: { _id: 'file-id' },
      })

      await ctx.controller.downloadCompiledPdfByPath(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(400)
      expect(JSON.parse(ctx.res.body)).to.deep.equal({
        error: 'path must point to a latex document (.tex)',
      })
    })

    it('returns 400 when doc path does not end in .tex', async function (ctx) {
      ctx.req.params[0] = 'notes/readme.md'
      ctx.ProjectLocator.promises.findElementByPath.resolves({
        type: 'doc',
        element: { _id: 'doc-id' },
      })

      await ctx.controller.downloadCompiledPdfByPath(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(400)
      expect(JSON.parse(ctx.res.body)).to.deep.equal({
        error: 'path must point to a latex document (.tex)',
      })
    })

    it('compiles latex doc and proxies output.pdf', async function (ctx) {
      ctx.req.params[0] = 'src/main.tex'
      ctx.ProjectLocator.promises.findElementByPath.resolves({
        type: 'doc',
        element: { _id: 'doc-id' },
      })
      ctx.CompileManager.promises.compile.resolves({
        outputFiles: [
          {
            path: 'output.pdf',
            url: '/project/65f2f57f8d6c0b6d50300001/user/user-id/build/id/output/output.pdf',
          },
        ],
      })

      await ctx.controller.downloadCompiledPdfByPath(ctx.req, ctx.res, ctx.next)

      expect(
        ctx.CompileController._getUserIdForCompile.calledWith(ctx.req)
      ).to.equal(true)
      expect(
        ctx.CompileManager.promises.compile.calledWith(
          ctx.projectId,
          'user-id',
          {
            rootDoc_id: 'doc-id',
          }
        )
      ).to.equal(true)
      expect(ctx.req.params.file).to.equal('output.pdf')
      expect(
        ctx.CompileController._proxyToClsi.calledWith(
          ctx.projectId,
          'output-file',
          '/project/65f2f57f8d6c0b6d50300001/user/user-id/build/id/output/output.pdf',
          {},
          ctx.req,
          ctx.res
        )
      ).to.equal(true)
    })

    it('returns 500 when compile does not produce output.pdf', async function (ctx) {
      ctx.req.params[0] = 'src/main.tex'
      ctx.ProjectLocator.promises.findElementByPath.resolves({
        type: 'doc',
        element: { _id: 'doc-id' },
      })
      ctx.CompileManager.promises.compile.resolves({
        outputFiles: [{ path: 'other.log', url: '/foo' }],
      })

      await ctx.controller.downloadCompiledPdfByPath(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(500)
    })
  })
})
