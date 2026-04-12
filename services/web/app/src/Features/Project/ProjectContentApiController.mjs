import { expressify } from '@overleaf/promise-utils'
import ProjectGetter from './ProjectGetter.mjs'
import ProjectLocator from './ProjectLocator.mjs'
import Errors from '../Errors/Errors.js'
import FileStoreController from '../FileStore/FileStoreController.mjs'
import DocumentUpdaterController from '../DocumentUpdater/DocumentUpdaterController.mjs'

function normalizeProjectPath(path) {
  return path.trim().replace(/^\/+/, '')
}

function filePathInProject(parentPath, entityName) {
  return parentPath ? `${parentPath}/${entityName}` : entityName
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
  downloadProjectEntityByPath: expressify(downloadProjectEntityByPath),
}
