import { expressify } from '@overleaf/promise-utils'
import pLimit from 'p-limit'
import ProjectGetter from './ProjectGetter.mjs'
import ProjectLocator from './ProjectLocator.mjs'
import Errors from '../Errors/Errors.js'
import FileStoreController from '../FileStore/FileStoreController.mjs'
import DocumentUpdaterController from '../DocumentUpdater/DocumentUpdaterController.mjs'
import SessionManager from '../Authentication/SessionManager.mjs'
import UserGetter from '../User/UserGetter.mjs'
import HistoryManager from '../History/HistoryManager.mjs'

function normalizeProjectPath(path) {
  return path.trim().replace(/^\/+/, '')
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
  parentPath = ''
) {
  const folderPath = parentPath ? `${parentPath}/${folder.name}` : ''
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
    const entry = {
      _id: file._id,
      name: file.name,
      type: 'file',
      path: filePathInProject(folderPath, file.name),
      owner: context.owner,
      uploadedByOrOwner: uploader,
      createdAt: toISOString(file.created) || context.projectCreatedAt,
      modifiedAt: context.projectLastUpdatedAt,
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
      folderPath
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

function serializeFolder(folder, parentPath = '') {
  const folderPath = parentPath ? `${parentPath}/${folder.name}` : ''

  const folders = (folder.folders || [])
    .filter(Boolean)
    .map(childFolder => serializeFolder(childFolder, folderPath))

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
  const userId = SessionManager.getLoggedInUserId(req.session)
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

export default {
  projectStructureJson: expressify(projectStructureJson),
  userProjectsStructureJson: expressify(userProjectsStructureJson),
  downloadProjectEntityByPath: expressify(downloadProjectEntityByPath),
}
