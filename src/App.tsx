import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { centeredCrop, clampCrop, resizeCrop, type Crop } from './lib/crop'
import { loadPhoto, renderThumbnail, type Photo } from './lib/images'

type Result = { url: string; filename: string; photo: Photo; crop: Crop; islandCity: boolean }
type Drag = { x: number; y: number; crop: Crop; mode: 'move' | 'resize' }

export function App() {
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [crop, setCrop] = useState<Crop>({ left: 0, top: 0, size: 1 })
  const [islandCity, setIslandCity] = useState(true)
  const [result, setResult] = useState<Result | null>(null)
  const [decoding, setDecoding] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const source = useRef<Photo | null>(null)
  const resultUrl = useRef<string | null>(null)
  const revision = useRef(0)
  const renderRevision = useRef(0)
  const decodeQueue = useRef<Promise<void>>(Promise.resolve())
  const renderQueue = useRef<Promise<void>>(Promise.resolve())
  const stage = useRef<HTMLDivElement | null>(null)
  const drag = useRef<Drag | null>(null)

  function clearResult() {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
    resultUrl.current = null
    setResult(null)
  }

  useEffect(() => () => {
    revision.current++
    renderRevision.current++
    source.current?.dispose()
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
  }, [])

  useEffect(() => {
    if (!photo) return
    const current = ++renderRevision.current
    let cancelled = false
    // Coalesce rapid pointer/slider changes and serialize PNG encoding. Controls
    // stay interactive, and superseded work never replaces the current preview.
    const timer = window.setTimeout(async () => {
      const preceding = renderQueue.current
      let release!: () => void
      renderQueue.current = new Promise<void>(resolve => { release = resolve })
      await preceding
      try {
        if (cancelled || current !== renderRevision.current) return
        const blob = await renderThumbnail(photo, crop, { islandCity })
        if (cancelled || current !== renderRevision.current) return
        const url = URL.createObjectURL(blob)
        if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
        resultUrl.current = url
        setResult({ url, filename: `${photo.name.replace(/\.[^.]+$/, '') || 'photo'}_thumb.png`, photo, crop, islandCity })
      } catch (cause) {
        if (cancelled || current !== renderRevision.current) return
        setError(cause instanceof Error ? cause.message : 'Could not update the preview. Please try again.')
      } finally {
        release()
      }
    }, 32)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [photo, crop, islandCity, retry])

  async function selectPhoto(file: File | undefined) {
    if (!file) return
    const current = ++revision.current
    renderRevision.current++
    drag.current = null
    clearResult()
    source.current?.dispose()
    source.current = null
    setPhoto(null)
    setError('')
    setDecoding(true)
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
    } catch (cause) {
      if (current !== revision.current) return
      setError(cause instanceof Error ? cause.message : 'Could not open this photo. Try another JPEG or PNG.')
    } finally {
      release()
      if (current === revision.current) setDecoding(false)
    }
  }

  function updateCrop(next: Crop) {
    if (!photo) return
    renderRevision.current++
    setError('')
    setCrop(clampCrop(next, photo))
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!photo || event.button !== 0) return
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

  const maxSize = photo ? Math.min(1, photo.height / photo.width) : 1
  const minSizePercent = photo ? Math.min(100, 2400 / Math.min(photo.width, photo.height)) : 100
  const maxTop = photo ? Math.max(0, 1 - crop.size * photo.width / photo.height) : 0
  const maxLeft = Math.max(0, 1 - crop.size)
  const resultReady = result && result.photo === photo && result.crop === crop && result.islandCity === islandCity && !error
  const updating = !!photo && !resultReady && !error
  const status = decoding ? 'Opening your photo locally…' : error ? (photo ? 'Preview could not be updated.' : 'Photo could not be opened.') : photo ? (updating ? 'Photo ready. Updating preview…' : 'Photo ready. Your thumbnail is ready to download.') : 'Choose a photo to get started. Everything stays on your device.'

  return (
    <main className="app-shell">
      <h1 className="page-title">ISLAND CITY THUMBNAIL</h1>
      <section className="workspace" aria-label="Thumbnail editor">
        <div className="preview-panel">
          <fieldset className="fieldset upload-fieldset">
            <legend className="fieldset-legend">Choose a photo</legend>
            <label className="sr-only" htmlFor="photo">Photo file</label>
            <input id="photo" className="file-input file-input-bordered" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" aria-describedby="format-help" onChange={event => { void selectPhoto(event.target.files?.[0]) }} />
            <p id="format-help">JPEG or PNG. HEIC isn’t supported yet.</p>
          </fieldset>
          <div className="preview-area">
            {photo ? <div className="crop-stage" ref={stage} style={{ maxWidth: `min(100%, calc(max(10rem, 100svh - 27rem) * ${photo.width / photo.height}))`, aspectRatio: `${photo.width} / ${photo.height}` }}>
              <img className="crop-image" src={photo.previewUrl} alt="Your photo with the selected square crop" draggable={false} />
              <div className="crop-selection" style={{ left: `${crop.left * 100}%`, top: `${crop.top * 100}%`, width: `${crop.size * 100}%`, height: `${crop.size * photo.width / photo.height * 100}%` }} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
                {result && <img className="result-image" src={result.url} alt={`Processed thumbnail${result.islandCity ? ' with Island City artwork' : ''} and AFW logo`} width="1080" height="1080" draggable={false} />}
                <span className="crop-grid" aria-hidden="true" /><span className="crop-handle" aria-hidden="true" />
              </div>
            </div> : <div className="empty-preview"><p>{decoding ? 'Opening your photo…' : 'Choose a photo to start your thumbnail.'}</p><p>Crop, preview, and download in one place.</p></div>}
          </div>
          {photo && <p className="file-meta">{photo.name} · {photo.width} × {photo.height}</p>}
        </div>
        <aside className="settings-panel" aria-label="Settings">
          <fieldset className="crop-controls" disabled={!photo}>
            <legend className="settings-legend">Crop</legend>
            <label className="control-label" htmlFor="crop-size"><span>Crop size</span><output aria-hidden="true">{Math.round(crop.size / maxSize * 100)}%</output></label>
            <input id="crop-size" className="range range-primary range-sm" type="range" min="0" max="100" step="0.1" disabled={minSizePercent === 100} aria-valuetext={`${(crop.size / maxSize * 100).toFixed(1)}% of the shortest edge`} value={minSizePercent === 100 ? 100 : Math.round((crop.size / maxSize * 100 - minSizePercent) / (100 - minSizePercent) * 1000) / 10} onChange={e => photo && updateCrop(resizeCrop(crop, (minSizePercent + Number(e.target.value) / 100 * (100 - minSizePercent)) / 100 * maxSize, photo))} />
            <label className="control-label" htmlFor="crop-x"><span>Horizontal position</span><output aria-hidden="true">{maxLeft ? Math.round(crop.left / maxLeft * 100) : 50}%</output></label>
            <input id="crop-x" className="range range-primary range-sm" type="range" min="0" max="100" step="0.1" disabled={!maxLeft} value={maxLeft ? crop.left / maxLeft * 100 : 50} onChange={e => updateCrop({ ...crop, left: Number(e.target.value) / 100 * maxLeft })} />
            <label className="control-label" htmlFor="crop-y"><span>Vertical position</span><output aria-hidden="true">{maxTop ? Math.round(crop.top / maxTop * 100) : 50}%</output></label>
            <input id="crop-y" className="range range-primary range-sm" type="range" min="0" max="100" step="0.1" disabled={!maxTop} value={maxTop ? crop.top / maxTop * 100 : 50} onChange={e => updateCrop({ ...crop, top: Number(e.target.value) / 100 * maxTop })} />
            <button className="btn btn-outline" onClick={() => photo && updateCrop(centeredCrop(photo))}>Reset crop</button>
          </fieldset>
          <fieldset className="artwork-controls">
            <legend className="settings-legend">Artwork</legend>
            <label className="toggle-label" htmlFor="island-city"><span>Island City overlay</span><input id="island-city" className="toggle toggle-primary" type="checkbox" checked={islandCity} onChange={event => { renderRevision.current++; setError(''); setIslandCity(event.target.checked) }} /></label>
            <p className="panel-description">AFW logo and film grain are always included.</p>
          </fieldset>
          <div className="panel-actions">{resultReady ? <a className="btn btn-primary" href={result.url} download={result.filename}>Download PNG <span aria-hidden="true">↓</span></a> : <button className="btn btn-primary" disabled>Download PNG <span aria-hidden="true">↓</span></button>}</div>
          <div className={decoding || updating ? 'status-line' : 'sr-only'} role="status" aria-live="polite" aria-atomic="true">{(decoding || updating) && <span className="loading loading-spinner loading-sm" aria-hidden="true" />}<span className="sr-only">{status}</span></div>
          {error && <div className="alert alert-error" role="alert"><span>{error}</span>{photo && <button className="btn btn-outline" onClick={() => { setError(''); setRetry(value => value + 1) }}>Retry preview</button>}</div>}
        </aside>
      </section>
    </main>
  )
}
