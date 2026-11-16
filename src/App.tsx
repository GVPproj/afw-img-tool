import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { centeredCrop, clampCrop, resizeCrop, type Crop } from './lib/crop'
import { loadPhoto, renderThumbnail, type Photo } from './lib/images'

type Result = { url: string; filename: string }
type Drag = { x: number; y: number; crop: Crop; mode: 'move' | 'resize' }

export function App() {
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [crop, setCrop] = useState<Crop>({ left: 0, top: 0, size: 1 })
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState<'decode' | 'render' | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const source = useRef<Photo | null>(null)
  const resultUrl = useRef<string | null>(null)
  const revision = useRef(0)
  const decodeQueue = useRef<Promise<void>>(Promise.resolve())
  const stage = useRef<HTMLDivElement | null>(null)
  const drag = useRef<Drag | null>(null)

  function clearResult() {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
    resultUrl.current = null
    setResult(null)
  }

  useEffect(() => () => {
    revision.current++
    source.current?.dispose()
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
  }, [])

  async function selectPhoto(file: File | undefined) {
    if (!file) return
    const current = ++revision.current
    drag.current = null
    clearResult()
    source.current?.dispose()
    source.current = null
    setPhoto(null)
    setError('')
    setBusy('decode')
    setStatus('Opening your photo locally…')
    // Only one full-resolution decode at a time; skip superseded queued files.
    const preceding = decodeQueue.current
    let release!: () => void
    decodeQueue.current = new Promise<void>(resolve => { release = resolve })
    await preceding
    if (current !== revision.current) { release(); return }
    try {
      const next = await loadPhoto(file)
      if (current !== revision.current) { next.dispose(); return }
      source.current = next
      setPhoto(next)
      setCrop(centeredCrop(next))
      setStatus('Photo ready.')
    } catch (cause) {
      if (current !== revision.current) return
      setError(cause instanceof Error ? cause.message : 'Could not open this photo. Try another JPEG or PNG.')
      setStatus('Photo could not be opened.')
    } finally {
      release()
      if (current === revision.current) setBusy(null)
    }
  }

  function updateCrop(next: Crop) {
    if (!photo || busy) return
    setCrop(clampCrop(next, photo))
    clearResult()
    setStatus('Crop changed. Generate to update the thumbnail.')
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!photo || busy || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      x: event.clientX, y: event.clientY, crop,
      mode: (event.target as HTMLElement).closest('.crop-handle') ? 'resize' : 'move',
    }
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current
    const bounds = stage.current?.getBoundingClientRect()
    if (!active || !bounds || !photo) return
    const dx = (event.clientX - active.x) / bounds.width
    const dy = (event.clientY - active.y) / bounds.height
    if (active.mode === 'move') {
      updateCrop({ ...active.crop, left: active.crop.left + dx, top: active.crop.top + dy })
    } else {
      const delta = (dx + dy * photo.height / photo.width) / 2
      const max = Math.min(1 - active.crop.left, (1 - active.crop.top) * photo.height / photo.width)
      updateCrop({ ...active.crop, size: Math.min(max, active.crop.size + delta) })
    }
  }

  async function generate() {
    if (!photo || busy) return
    const current = ++revision.current
    drag.current = null
    setBusy('render')
    setError('')
    setStatus('Adding grain and artwork…')
    // Let the loading state paint before the synchronous Canvas work begins.
    await new Promise(resolve => setTimeout(resolve, 40))
    try {
      const blob = await renderThumbnail(photo, crop)
      if (current !== revision.current) return
      clearResult()
      const url = URL.createObjectURL(blob)
      resultUrl.current = url
      setResult({ url, filename: `${photo.name.replace(/\.[^.]+$/, '') || 'photo'}_thumb.png` })
      setStatus('Your thumbnail is ready to download.')
    } catch (cause) {
      if (current !== revision.current) return
      setError(cause instanceof Error ? cause.message : 'Could not generate the thumbnail. Please try again.')
      setStatus('Generation failed. You can try again.')
    } finally {
      if (current === revision.current) setBusy(null)
    }
  }

  const maxSize = photo ? Math.min(1, photo.height / photo.width) : 1
  const minSizePercent = photo ? Math.min(100, 2400 / Math.min(photo.width, photo.height)) : 100
  const maxTop = photo ? Math.max(0, 1 - crop.size * photo.width / photo.height) : 0
  const maxLeft = Math.max(0, 1 - crop.size)

  return (
    <main className="app-shell">
      <h1 className="page-title">ISLAND CITY THUMBNAIL</h1>

      <div className="workflow-grid">
        <section className="card workspace-card" aria-labelledby="crop-title">
          <div className="card-body">
            <h2 id="crop-title">PHOTO</h2>
            <fieldset className="fieldset upload-fieldset">
              <legend className="fieldset-legend">Choose a photo</legend>
              <label className="sr-only" htmlFor="photo">Photo file</label>
              <input id="photo" className="file-input file-input-bordered" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" aria-describedby="format-help" disabled={busy === 'render'} onChange={event => { void selectPhoto(event.target.files?.[0]) }} />
              <p id="format-help">JPEG or PNG. HEIC isn’t supported yet.</p>
            </fieldset>

            {photo ? <>
              <div className="crop-stage" ref={stage} style={{ maxWidth: `${36 * photo.width / photo.height}rem`, aspectRatio: `${photo.width} / ${photo.height}` }}>
                <img className="crop-image" src={photo.previewUrl} alt="Your photo with the selected square crop" draggable={false} />
                <div className="crop-selection" aria-hidden="true" style={{ left: `${crop.left * 100}%`, top: `${crop.top * 100}%`, width: `${crop.size * 100}%`, height: `${crop.size * photo.width / photo.height * 100}%`, touchAction: 'none' }} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
                  <span className="crop-grid" /><span className="crop-handle" />
                </div>
              </div>
              <p className="file-meta">{photo.name} · {photo.width} × {photo.height}</p>
              <p id="crop-help" className="panel-description">Drag to move; use the corner or sliders to resize.</p>
              <fieldset className="crop-controls" disabled={!!busy} aria-describedby="crop-help">
                <legend className="sr-only">Adjust crop</legend>
                <label className="control-label" htmlFor="crop-size"><span>Crop size</span><output aria-hidden="true">{Math.round(crop.size / maxSize * 100)}%</output></label>
                <input id="crop-size" className="range range-primary range-sm" type="range" min="0" max="100" step="0.1" disabled={minSizePercent === 100} aria-valuetext={`${(crop.size / maxSize * 100).toFixed(1)}% of the shortest edge`} value={minSizePercent === 100 ? 100 : Math.round((crop.size / maxSize * 100 - minSizePercent) / (100 - minSizePercent) * 1000) / 10} onChange={e => photo && updateCrop(resizeCrop(crop, (minSizePercent + Number(e.target.value) / 100 * (100 - minSizePercent)) / 100 * maxSize, photo))} />
                <label className="control-label" htmlFor="crop-x"><span>Horizontal position</span><output aria-hidden="true">{maxLeft ? Math.round(crop.left / maxLeft * 100) : 50}%</output></label>
                <input id="crop-x" className="range range-primary range-sm" type="range" min="0" max="100" step="0.1" disabled={!maxLeft} value={maxLeft ? crop.left / maxLeft * 100 : 50} onChange={e => updateCrop({ ...crop, left: Number(e.target.value) / 100 * maxLeft })} />
                <label className="control-label" htmlFor="crop-y"><span>Vertical position</span><output aria-hidden="true">{maxTop ? Math.round(crop.top / maxTop * 100) : 50}%</output></label>
                <input id="crop-y" className="range range-primary range-sm" type="range" min="0" max="100" step="0.1" disabled={!maxTop} value={maxTop ? crop.top / maxTop * 100 : 50} onChange={e => updateCrop({ ...crop, top: Number(e.target.value) / 100 * maxTop })} />
              </fieldset>
            </> : <div className="empty-preview"><p>Choose a photo to crop.</p></div>}
            <div className="panel-actions">
              <button className="btn btn-primary" disabled={!photo || !!busy} onClick={() => void generate()}>{busy === 'render' && <span className="loading loading-spinner loading-sm" aria-hidden="true" />}Generate thumbnail</button>
              <button className="btn btn-outline" disabled={!photo || !!busy} onClick={() => photo && updateCrop(centeredCrop(photo))}>Reset crop</button>
            </div>
          </div>
        </section>

        <section className="card workspace-card" aria-labelledby="result-title" aria-busy={busy === 'render'}>
          <div className="card-body">
            <h2 id="result-title">THUMBNAIL</h2>
            {result ? <img className="result-image" src={result.url} alt="Generated Island City thumbnail with yellow Island City and AFW logos" width="1080" height="1080" /> : <div className="empty-preview"><p>Generate a thumbnail to preview it here.</p></div>}
            <p className="file-meta">1080 × 1080 px · PNG</p>
            <div className="panel-actions">{result ? <a className="btn btn-primary" href={result.url} download={result.filename}>Download PNG <span aria-hidden="true">↓</span></a> : <button className="btn btn-primary" disabled>Download PNG <span aria-hidden="true">↓</span></button>}</div>
          </div>
        </section>
      </div>
      <div className="status-line" role="status" aria-live="polite" aria-atomic="true">{busy && <span className="loading loading-spinner loading-sm" aria-hidden="true" />}{status}</div>
      {error && <div className="alert alert-error" role="alert"><span>{error}</span></div>}
    </main>
  )
}
