import { beforeEach, describe, expect, it, vi } from 'vitest'
import sinon from 'sinon'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import MockResponse from '../helpers/MockResponse.mjs'

const MODULE_PATH =
  '../../../../app/src/Features/Project/ProjectContentApiController.mjs'

describe('ProjectContentApiController', function () {
  beforeEach(async function (ctx) {
    vi.resetModules()

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
        new Errors.NotFoundError()
      )

      await ctx.controller.downloadProjectEntityByPath(ctx.req, ctx.res, ctx.next)

      expect(ctx.res.statusCode).to.equal(404)
    })
  })
})
