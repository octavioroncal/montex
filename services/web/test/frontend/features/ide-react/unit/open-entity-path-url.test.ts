import { expect } from 'chai'
import sinon from 'sinon'
import {
  getOpenEntityPathFromUrl,
  setOpenEntityPathInUrl,
} from '@/features/ide-react/util/open-entity-path-url'

describe('open-entity-path-url', function () {
  beforeEach(function () {
    window.history.replaceState({}, '', '/project/123')
  })

  afterEach(function () {
    sinon.restore()
  })

  describe('getOpenEntityPathFromUrl', function () {
    it('reads and normalizes the path query parameter', function () {
      window.history.replaceState({}, '', '/project/123?path=%2Fchapters%2Fmain.tex')

      expect(getOpenEntityPathFromUrl()).to.equal('chapters/main.tex')
    })

    it('supports the legacy file query parameter', function () {
      window.history.replaceState({}, '', '/project/123?file=images%2Ffrog.png')

      expect(getOpenEntityPathFromUrl()).to.equal('images/frog.png')
    })

    it('returns null when path query parameter is empty', function () {
      window.history.replaceState({}, '', '/project/123?path=%20%20%20')

      expect(getOpenEntityPathFromUrl()).to.equal(null)
    })
  })

  describe('setOpenEntityPathInUrl', function () {
    it('sets path while preserving existing query parameters and hash', function () {
      window.history.replaceState({}, '', '/project/123?foo=bar#preview')

      setOpenEntityPathInUrl('src/main.tex')

      const params = new URLSearchParams(window.location.search)
      expect(params.get('foo')).to.equal('bar')
      expect(params.get('path')).to.equal('src/main.tex')
      expect(window.location.hash).to.equal('#preview')
    })

    it('removes the legacy file parameter when path is set', function () {
      window.history.replaceState({}, '', '/project/123?file=old.tex')

      setOpenEntityPathInUrl('new.tex')

      const params = new URLSearchParams(window.location.search)
      expect(params.get('path')).to.equal('new.tex')
      expect(params.get('file')).to.equal(null)
    })

    it('does not update history when the normalized path did not change', function () {
      window.history.replaceState({}, '', '/project/123?path=main.tex')
      const replaceStateSpy = sinon.spy(window.history, 'replaceState')

      setOpenEntityPathInUrl('/main.tex')

      expect(replaceStateSpy.called).to.equal(false)
    })
  })
})
