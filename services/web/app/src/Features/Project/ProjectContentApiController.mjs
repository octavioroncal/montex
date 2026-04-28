import { expressify } from '@overleaf/promise-utils'
import pLimit from 'p-limit'
import logger from '@overleaf/logger'
import ProjectGetter from './ProjectGetter.mjs'
import ProjectLocator from './ProjectLocator.mjs'
import Errors from '../Errors/Errors.js'
import FileStoreController from '../FileStore/FileStoreController.mjs'
import DocumentUpdaterController from '../DocumentUpdater/DocumentUpdaterController.mjs'
import CompileManager from '../Compile/CompileManager.mjs'
import CompileController from '../Compile/CompileController.mjs'
import SessionManager from '../Authentication/SessionManager.mjs'
import UserGetter from '../User/UserGetter.mjs'
import HistoryManager from '../History/HistoryManager.mjs'
import ProjectDownloadsController from '../Downloads/ProjectDownloadsController.mjs'
import UpdateMerger from '../ThirdPartyDataStore/UpdateMerger.mjs'
import ProjectEntityUpdateHandler from './ProjectEntityUpdateHandler.mjs'

const SUPPORTED_UPLOAD_CONTENT_TYPES = new Set([
  'text/plain',
  'application/octet-stream',
])

function getRequestUserId(req) {
  return (
    SessionManager.getLoggedInUserId(req.session) ||
    req.oauth_user?._id?.toString() ||
    null
  )
}

function normalizeProjectPath(path) {
  return path.trim().replace(/^\/+/, '')
}

function splitParentPathAndEntityName(projectPath) {
  const separatorIndex = projectPath.lastIndexOf('/')
  if (separatorIndex === -1) {
    return {
      parentPath: '',
      entityName: projectPath,
    }
  }
  return {
    parentPath: projectPath.slice(0, separatorIndex),
    entityName: projectPath.slice(separatorIndex + 1),
  }
}

function getBaseContentType(req) {
  const contentType = req.headers?.['content-type']
  if (typeof contentType !== 'string') {
    return ''
  }
  return contentType.split(';', 1)[0].trim().toLowerCase()
}

function filePathInProject(parentPath, entityName) {
  return parentPath ? `${parentPath}/${entityName}` : entityName
}

function toISOString(value) {
  if (!value) {
    return null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date.toISOString()
}

function getObjectIdTimestampAsISOString(objectId) {
  if (!objectId || typeof objectId.getTimestamp !== 'function') {
    return null
  }
  return toISOString(objectId.getTimestamp())
}

function bytesToKilobytes(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) {
    return null
  }
  return Math.round((bytes / 1024) * 100) / 100
}

function flattenProjectsByAccessLevel(projectsByAccessLevel) {
  const flattened = []
  const seen = new Set()

  for (const [accessLevel, projects] of Object.entries(
    projectsByAccessLevel || {}
  )) {
    for (const project of projects || []) {
      const projectId = project?._id?.toString()
      if (!projectId || seen.has(projectId)) {
        continue
      }
      seen.add(projectId)
      flattened.push({ accessLevel, project })
    }
  }

  return flattened
}

function serializeUserRef(userRef, usersById) {
  if (!userRef) {
    return null
  }
  const userId = userRef.toString()
  const user = usersById.get(userId)

  if (!user) {
    return { id: userId }
  }

  return {
    id: userId,
    email: user.email ?? null,
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null,
  }
}

function collectProjectFileMetadata(
  folder,
  context,
  fileEntries,
  sizeJobs,
  parentPath = '',
  isRoot = true
) {
  const folderPath = isRoot ? '' : filePathInProject(parentPath, folder.name)
  const uploader = context.lastUpdatedBy || context.owner

  for (const doc of folder.docs || []) {
    if (!doc) continue
    fileEntries.push({
      _id: doc._id,
      name: doc.name,
      type: 'doc',
      path: filePathInProject(folderPath, doc.name),
      owner: context.owner,
      uploadedByOrOwner: uploader,
      createdAt: context.projectCreatedAt,
      modifiedAt: context.projectLastUpdatedAt,
      sizeKb: null,
    })
  }

  for (const file of folder.fileRefs || []) {
    if (!file) continue
    const fileCreatedAt = toISOString(file.created) || context.projectCreatedAt
    const fileModifiedAt =
      toISOString(file.modified) ||
      fileCreatedAt ||
      context.projectLastUpdatedAt
    const entry = {
      _id: file._id,
      name: file.name,
      type: 'file',
      path: filePathInProject(folderPath, file.name),
      owner: context.owner,
      uploadedByOrOwner: uploader,
      createdAt: fileCreatedAt,
      modifiedAt: fileModifiedAt,
      sizeKb: null,
    }
    fileEntries.push(entry)

    if (context.historyId && file.hash) {
      sizeJobs.push({
        historyId: context.historyId,
        hash: file.hash,
        entry,
      })
    }
  }

  for (const childFolder of folder.folders || []) {
    if (!childFolder) continue
    collectProjectFileMetadata(
      childFolder,
      context,
      fileEntries,
      sizeJobs,
      folderPath,
      false
    )
  }
}

async function getBlobSizeInBytes(historyId, hash) {
  if (!historyId || !hash) {
    return null
  }

  try {
    const { contentLength } = await HistoryManager.promises.requestBlob(
      historyId,
      hash,
      'HEAD'
    )
    if (typeof contentLength !== 'number' || Number.isNaN(contentLength)) {
      return null
    }
    return contentLength
  } catch {
    return null
  }
}

function serializeFolder(folder, parentPath = '', isRoot = true) {
  const folderPath = isRoot ? '' : filePathInProject(parentPath, folder.name)

  const folders = (folder.folders || [])
    .filter(Boolean)
    .map(childFolder => serializeFolder(childFolder, folderPath, false))

  const docs = (folder.docs || []).filter(Boolean).map(doc => ({
    _id: doc._id,
    name: doc.name,
    type: 'doc',
    path: filePathInProject(folderPath, doc.name),
  }))

  const files = (folder.fileRefs || []).filter(Boolean).map(file => ({
    _id: file._id,
    name: file.name,
    type: 'file',
    path: filePathInProject(folderPath, file.name),
  }))

  return {
    _id: folder._id,
    name: folder.name,
    type: 'folder',
    path: folderPath,
    folders,
    docs,
    files,
  }
}

async function projectStructureJson(req, res) {
  const projectId = req.params.Project_id
  const project = await ProjectGetter.promises.getProject(projectId, {
    name: 1,
    rootDoc_id: 1,
    rootFolder: 1,
  })

  if (!project) {
    return res.sendStatus(404)
  }

  const rootFolder = project.rootFolder?.[0]
  if (!rootFolder) {
    return res.sendStatus(500)
  }

  return res.json({
    project_id: projectId,
    projectName: project.name,
    rootDocId: project.rootDoc_id,
    structure: serializeFolder(rootFolder),
  })
}

async function userProjectsStructureJson(req, res) {
  const userId = getRequestUserId(req)
  if (!userId) {
    return res.sendStatus(401)
  }
  const projectsByAccessLevel = await ProjectGetter.promises.findAllUsersProjects(
    userId,
    {
      name: 1,
      owner_ref: 1,
      lastUpdated: 1,
      lastUpdatedBy: 1,
      rootDoc_id: 1,
      rootFolder: 1,
      'overleaf.history.id': 1,
    }
  )
  const projects = flattenProjectsByAccessLevel(projectsByAccessLevel)

  const userIds = new Set()
  for (const { project } of projects) {
    if (project.owner_ref) {
      userIds.add(project.owner_ref.toString())
    }
    if (project.lastUpdatedBy) {
      userIds.add(project.lastUpdatedBy.toString())
    }
  }

  const users = await UserGetter.promises.getUsers(Array.from(userIds), {
    email: 1,
    first_name: 1,
    last_name: 1,
  })
  const usersById = new Map(users.map(user => [user._id.toString(), user]))

  const responseProjects = []
  const sizeJobs = []

  for (const { accessLevel, project } of projects) {
    const rootFolder = project.rootFolder?.[0]
    if (!rootFolder) {
      continue
    }

    const owner = serializeUserRef(project.owner_ref, usersById)
    const lastUpdatedBy = serializeUserRef(project.lastUpdatedBy, usersById)
    const projectCreatedAt = getObjectIdTimestampAsISOString(project._id)
    const projectLastUpdatedAt = toISOString(project.lastUpdated)

    const files = []
    collectProjectFileMetadata(
      rootFolder,
      {
        owner,
        lastUpdatedBy,
        historyId: project.overleaf?.history?.id,
        projectCreatedAt,
        projectLastUpdatedAt,
      },
      files,
      sizeJobs
    )

    responseProjects.push({
      project_id: project._id,
      projectName: project.name,
      accessLevel,
      rootDocId: project.rootDoc_id,
      owner,
      lastUpdatedBy,
      createdAt: projectCreatedAt,
      modifiedAt: projectLastUpdatedAt,
      structure: serializeFolder(rootFolder),
      files,
    })
  }

  const limit = pLimit(10)
  const sizeCache = new Map()
  await Promise.all(
    sizeJobs.map(job =>
      limit(async () => {
        const cacheKey = `${job.historyId}:${job.hash}`
        if (!sizeCache.has(cacheKey)) {
          sizeCache.set(
            cacheKey,
            await getBlobSizeInBytes(job.historyId, job.hash)
          )
        }
        const sizeInBytes = sizeCache.get(cacheKey)
        job.entry.sizeKb = bytesToKilobytes(sizeInBytes)
      })
    )
  )

  return res.json({
    userId: userId.toString(),
    projects: responseProjects,
  })
}

async function userProjectsSummaryJson(req, res) {
  const userId = getRequestUserId(req)
  if (!userId) {
    return res.sendStatus(401)
  }
  const projectsByAccessLevel = await ProjectGetter.promises.findAllUsersProjects(
    userId,
    {
      name: 1,
    }
  )
  const projects = flattenProjectsByAccessLevel(projectsByAccessLevel).map(
    ({ project }) => ({
      project_id: project._id?.toString(),
      projectName: project.name,
    })
  )

  return res.json({
    userId: userId.toString(),
    projects,
  })
}

async function downloadProjectEntityByPath(req, res, next) {
  const projectId = req.params.Project_id
  const rawPath = req.params[0] ?? req.query?.path
  const projectPath = rawPath ? normalizeProjectPath(String(rawPath)) : ''

  if (!projectPath) {
    return res.status(400).json({
      error: 'path is required',
    })
  }

  let located
  try {
    located = await ProjectLocator.promises.findElementByPath({
      project_id: projectId,
      path: projectPath,
      exactCaseMatch: true,
    })
  } catch (err) {
    if (err instanceof Errors.NotFoundError) {
      return res.sendStatus(404)
    }
    throw err
  }

  if (located.type === 'folder') {
    return res.status(400).json({
      error: 'path points to a folder',
    })
  }

  if (located.type === 'doc') {
    req.params.Doc_id = located.element._id.toString()
    return DocumentUpdaterController.getDoc(req, res, next)
  }

  req.params.File_id = located.element._id.toString()
  return FileStoreController.getFile(req, res, next)
}

function isLatexDocumentPath(projectPath) {
  return projectPath.toLowerCase().endsWith('.tex')
}

function getCompileErrorDiagnostics(err) {
  const compileStatusCode = Number.isInteger(err?.info?.statusCode)
    ? err.info.statusCode
    : null
  const rawClsiResponse = err?.info?.clsiResponse

  let compileStatus = null
  if (typeof rawClsiResponse === 'string') {
    try {
      compileStatus = JSON.parse(rawClsiResponse)?.compile?.status || null
    } catch {
      compileStatus = null
    }
  } else if (rawClsiResponse && typeof rawClsiResponse === 'object') {
    compileStatus = rawClsiResponse?.compile?.status || null
  }

  return { compileStatusCode, compileStatus }
}

async function downloadCompiledPdfByPath(req, res) {
  const projectId = req.params.Project_id
  const rawPath = req.params[0] ?? req.query?.path
  const projectPath = rawPath ? normalizeProjectPath(String(rawPath)) : ''

  if (!projectPath) {
    return res.status(400).json({
      error: 'path is required',
    })
  }

  let located
  try {
    located = await ProjectLocator.promises.findElementByPath({
      project_id: projectId,
      path: projectPath,
      exactCaseMatch: true,
    })
  } catch (err) {
    if (err instanceof Errors.NotFoundError) {
      return res.sendStatus(404)
    }
    throw err
  }

  if (located.type !== 'doc' || !isLatexDocumentPath(projectPath)) {
    return res.status(400).json({
      error: 'path must point to a latex document (.tex)',
    })
  }

  const userId =
    CompileController._getUserIdForCompile(req) || req.oauth_user?._id || null
  let compileResult
  try {
    compileResult = await CompileManager.promises.compile(projectId, userId, {
      rootDoc_id: located.element._id.toString(),
    })
  } catch (err) {
    const { compileStatusCode, compileStatus } = getCompileErrorDiagnostics(err)
    logger.error(
      {
        err,
        projectId,
        projectPath,
        rootDocId: located.element._id.toString(),
        userId,
        compileStatusCode,
        compileStatus,
      },
      'failed to compile latex document for API compiled-pdf download by path'
    )
    if (compileStatusCode) {
      return res.status(502).json({
        error: 'compile backend error',
        compileStatusCode,
        compileStatus,
      })
    }
    return res.sendStatus(500)
  }

  const outputFiles = compileResult?.outputFiles || []
  const pdf = outputFiles?.find(file => file.path === 'output.pdf')
  if (!pdf?.url) {
    return res.status(422).json({
      error: 'compile did not produce output.pdf',
      compileStatus: compileResult?.status || null,
      outputFiles: outputFiles.map(({ path, type }) => ({ path, type })),
    })
  }

  req.params.file = 'output.pdf'
  await CompileController._proxyToClsi(
    projectId,
    'output-file',
    pdf.url,
    {},
    req,
    res
  )
}

async function downloadProjectAsZip(req, res, next) {
  ProjectDownloadsController.downloadProject(req, res, next)
}

async function upsertProjectEntityByPath(req, res) {
  const projectId = req.params.Project_id
  const rawPath = req.params[0] ?? req.query?.path
  const projectPath = rawPath ? normalizeProjectPath(String(rawPath)) : ''
  const userId = getRequestUserId(req)

  if (!projectPath) {
    return res.status(400).json({
      error: 'path is required',
    })
  }

  if (!userId) {
    return res.sendStatus(401)
  }

  const contentType = getBaseContentType(req)
  if (
    contentType.length > 0 &&
    !SUPPORTED_UPLOAD_CONTENT_TYPES.has(contentType)
  ) {
    return res.sendStatus(415)
  }

  let pathAlreadyExists = false
  try {
    const located = await ProjectLocator.promises.findElementByPath({
      project_id: projectId,
      path: projectPath,
      exactCaseMatch: true,
    })

    if (located.type === 'folder') {
      return res.status(400).json({
        error: 'path points to a folder',
      })
    }
    pathAlreadyExists = true
  } catch (err) {
    if (!(err instanceof Errors.NotFoundError)) {
      throw err
    }
  }

  try {
    const metadata = await UpdateMerger.promises.mergeUpdate(
      userId,
      projectId,
      `/${projectPath}`,
      req,
      'project_content_api'
    )

    const created = !pathAlreadyExists

    return res.status(created ? 201 : 200).json({
      entity_id: metadata.entityId.toString(),
      entity_type: metadata.entityType,
      path: projectPath,
      created,
    })
  } catch (err) {
    if (
      err instanceof Errors.InvalidNameError ||
      err instanceof Errors.DuplicateNameError
    ) {
      return res.status(400).json({
        error: 'invalid_path',
      })
    }
    if (err instanceof Errors.NotFoundError) {
      return res.sendStatus(404)
    }
    throw err
  }
}

async function deleteProjectEntityByPath(req, res) {
  const projectId = req.params.Project_id
  const rawPath = req.params[0] ?? req.query?.path
  const projectPath = rawPath ? normalizeProjectPath(String(rawPath)) : ''
  const userId = getRequestUserId(req)

  if (!projectPath) {
    return res.status(400).json({
      error: 'path is required',
    })
  }

  if (!userId) {
    return res.sendStatus(401)
  }

  try {
    await ProjectEntityUpdateHandler.promises.deleteEntityWithPath(
      projectId,
      projectPath,
      userId,
      'project_content_api'
    )
    return res.sendStatus(204)
  } catch (err) {
    if (err instanceof Errors.InvalidNameError) {
      return res.status(400).json({
        error: 'invalid_path',
      })
    }
    if (err instanceof Errors.NotFoundError) {
      return res.sendStatus(404)
    }
    throw err
  }
}

async function moveProjectEntityByPath(req, res) {
  const projectId = req.params.Project_id
  const userId = getRequestUserId(req)
  const rawFromPath = req.body?.from_path
  const rawToPath = req.body?.to_path
  const fromPath =
    typeof rawFromPath === 'string' ? normalizeProjectPath(rawFromPath) : ''
  const toPath =
    typeof rawToPath === 'string' ? normalizeProjectPath(rawToPath) : ''

  if (!fromPath || !toPath) {
    return res.status(400).json({
      error: 'from_path and to_path are required',
    })
  }

  if (!userId) {
    return res.sendStatus(401)
  }

  let source
  try {
    source = await ProjectLocator.promises.findElementByPath({
      project_id: projectId,
      path: fromPath,
      exactCaseMatch: true,
    })
  } catch (err) {
    if (err instanceof Errors.NotFoundError) {
      return res.sendStatus(404)
    }
    throw err
  }

  const { parentPath: sourceParentPath, entityName: sourceEntityName } =
    splitParentPathAndEntityName(fromPath)
  const { parentPath: destinationParentPath, entityName: destinationEntityName } =
    splitParentPathAndEntityName(toPath)
  const entityId = source.element._id.toString()

  if (!destinationEntityName) {
    return res.status(400).json({
      error: 'invalid_path',
    })
  }

  if (fromPath === toPath) {
    return res.status(200).json({
      entity_id: entityId,
      entity_type: source.type,
      path: toPath,
      moved: false,
      renamed: false,
    })
  }

  try {
    let moved = false
    let renamed = false

    if (sourceParentPath !== destinationParentPath) {
      const destinationParent = await ProjectLocator.promises.findElementByPath({
        project_id: projectId,
        path: destinationParentPath,
        exactCaseMatch: true,
      })

      if (destinationParent.type !== 'folder') {
        return res.status(400).json({
          error: 'invalid_path',
        })
      }

      await ProjectEntityUpdateHandler.promises.moveEntity(
        projectId,
        source.element._id,
        destinationParent.element._id,
        source.type,
        userId,
        'project_content_api'
      )
      moved = true
    }

    if (sourceEntityName !== destinationEntityName) {
      await ProjectEntityUpdateHandler.promises.renameEntity(
        projectId,
        source.element._id,
        source.type,
        destinationEntityName,
        userId,
        'project_content_api'
      )
      renamed = true
    }

    return res.status(200).json({
      entity_id: entityId,
      entity_type: source.type,
      path: toPath,
      moved,
      renamed,
    })
  } catch (err) {
    if (
      err instanceof Errors.InvalidNameError ||
      err instanceof Errors.DuplicateNameError
    ) {
      return res.status(400).json({
        error: 'invalid_path',
      })
    }
    if (err instanceof Errors.NotFoundError) {
      return res.sendStatus(404)
    }
    throw err
  }
}

export default {
  projectStructureJson: expressify(projectStructureJson),
  userProjectsStructureJson: expressify(userProjectsStructureJson),
  userProjectsSummaryJson: expressify(userProjectsSummaryJson),
  downloadProjectEntityByPath: expressify(downloadProjectEntityByPath),
  downloadCompiledPdfByPath: expressify(downloadCompiledPdfByPath),
  downloadProjectAsZip: expressify(downloadProjectAsZip),
  upsertProjectEntityByPath: expressify(upsertProjectEntityByPath),
  deleteProjectEntityByPath: expressify(deleteProjectEntityByPath),
  moveProjectEntityByPath: expressify(moveProjectEntityByPath),
}
