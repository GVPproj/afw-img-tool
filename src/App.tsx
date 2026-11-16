import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { centeredCrop, clampCrop, outputRatio, type OutputFormat, type Crop } from './lib/crop'
import { loadPhoto, renderThumbnail, OUTPUT_WIDTH, type Photo, type Color } from './lib/images'
import { CropControls } from './CropControls'

type Radio = 'island-city' | 'chir-fm' | 'sunday' | 'cc'
type Result = { url: string; filename: string; photo: Photo; crop: Crop; format: OutputFormat; radio: Radio; host: string; date: string; startTime: string; finishTime: string; color: Color; duotone: boolean; dither: boolean; cornerGradient: boolean }
type Drag = { x: number; y: number; crop: Crop; mode: 'move' | 'resize' }

export function App() {
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [crop, setCrop] = useState<Crop>({ left: 0, top: 0, size: 1 })
  const [radio, setRadio] = useState<Radio>('chir-fm')
  const [color, setColor] = useState<Color>('lime')
  const [photoEffect, setPhotoEffect] = useState<'normal' | 'dither' | 'duotone'>('normal')
  const duotone = photoEffect === 'duotone'
  const dither = photoEffect === 'dither'
  const [cornerGradient, setCornerGradient] = useState(false)
  const [host, setHost] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [finishTime, setFinishTime] = useState('')
  const [format, setFormat] = useState<OutputFormat>('square')
  const selectedFormat = useRef<OutputFormat>('square')
  const ratio = outputRatio(format)
  const [result, setResult] = useState<Result | null>(null)
  const [decoding, setDecoding] = useState(false)
  const [draggingFile, setDraggingFile] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)
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
    // Coalesce rapid crop changes and serialize PNG encoding. Controls
    // stay interactive, and superseded work never replaces the current preview.
    const timer = window.setTimeout(async () => {
      const preceding = renderQueue.current
      let release!: () => void
      renderQueue.current = new Promise<void>(resolve => { release = resolve })
      await preceding
      try {
        if (cancelled || current !== renderRevision.current) return
        const blob = await renderThumbnail(photo, crop, { format, radio, host, date, startTime, finishTime, color, duotone, dither, cornerGradient })
        if (cancelled || current !== renderRevision.current) return
        const url = URL.createObjectURL(blob)
        if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
        resultUrl.current = url
        setResult({ url, filename: `${photo.name.replace(/\.[^.]+$/, '') || 'photo'}_thumb.png`, photo, crop, format, radio, host, date, startTime, finishTime, color, duotone, dither, cornerGradient })
      } catch (cause) {
        if (cancelled || current !== renderRevision.current) return
        setError(cause instanceof Error ? cause.message : 'Could not update the preview. Please try again.')
      } finally {
        release()
      }
    }, 32)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [photo, crop, format, radio, host, date, startTime, finishTime, color, duotone, dither, cornerGradient, retry])

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
      setCrop(centeredCrop(next, outputRatio(selectedFormat.current)))
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
    setCrop(clampCrop(next, photo, ratio))
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
      const delta = (dx + dy * photo.height / photo.width * ratio) / 2
      const max = Math.min(1 - active.crop.left, (1 - active.crop.top) * photo.height / photo.width * ratio)
      updateCrop({ ...active.crop, size: Math.min(max, active.crop.size + delta) })
    }
  }

  const resultReady = result && result.photo === photo && result.crop === crop && result.format === format && result.radio === radio && result.host === host && result.date === date && result.startTime === startTime && result.finishTime === finishTime && result.color === color && result.duotone === duotone && result.dither === dither && result.cornerGradient === cornerGradient && !error
  const updating = !!photo && !resultReady && !error
  const status = decoding ? 'Opening your photo locally…' : error ? (photo ? 'Preview could not be updated.' : 'Photo could not be opened.') : photo ? (updating ? 'Photo ready. Updating preview…' : 'Photo ready. Your thumbnail is ready to download.') : 'Choose a photo to get started. Everything stays on your device.'

  return (
    <main className="app-shell">
      <section className="workspace" aria-label="Thumbnail editor">
        <div className="preview-panel">
          <fieldset className="upload-fieldset">
            <legend>Choose a photo</legend>
            <label className="sr-only" htmlFor="photo">Photo file</label>
            <input ref={fileInput} id="photo" className="file-input" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={event => { void selectPhoto(event.target.files?.[0]) }} />
          </fieldset>
          <div className="preview-area">
            {photo ? <div className="crop-stage" ref={stage} style={{ maxWidth: `min(100%, calc(max(10rem, 100svh - 27rem) * ${photo.width / photo.height}))`, aspectRatio: `${photo.width} / ${photo.height}` }}>
              <img className="crop-image" src={photo.previewUrl} alt={`Your photo with the selected ${format} crop`} draggable={false} />
              <div className="crop-selection" style={{ left: `${crop.left * 100}%`, top: `${crop.top * 100}%`, width: `${crop.size * 100}%`, height: `${crop.size * photo.width / photo.height / ratio * 100}%` }} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
                {resultReady && <img className="result-image" src={result.url} alt={result.radio === 'cc' ? 'Processed thumbnail with Community Curation show details' : result.radio === 'sunday' ? 'Processed thumbnail with Sunday Sessions show details' : `Processed thumbnail${result.radio === 'chir-fm' ? ' with CHIR FM show details' : ' with Island City artwork'} and AFW logo`} width={OUTPUT_WIDTH} height={Math.round(OUTPUT_WIDTH / outputRatio(result.format))} draggable={false} />}
                <span className="crop-grid" aria-hidden="true" /><span className="crop-handle" aria-hidden="true" />
              </div>
            </div> : <button
              type="button"
              className={`empty-preview${draggingFile ? ' is-dragging' : ''}`}
              aria-label="Drop a photo or click to browse"
              aria-busy={decoding}
              onClick={() => fileInput.current?.click()}
              onDragOver={event => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
                setDraggingFile(true)
              }}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFile(false)
              }}
              onDrop={event => {
                event.preventDefault()
                setDraggingFile(false)
                const file = event.dataTransfer.files[0]
                if (file && fileInput.current) fileInput.current.files = event.dataTransfer.files
                void selectPhoto(file)
              }}
            ><span>{decoding ? 'Opening your photo…' : 'Drop a photo here, or click to browse.'}</span><span>Crop, preview, and download in one place.</span></button>}
          </div>
          <CropControls photo={photo} crop={crop} ratio={ratio} onChange={updateCrop} />
          {photo && <p className="file-meta">{photo.name} · {photo.width} × {photo.height}</p>}
        </div>
        <aside className="settings-panel" aria-label="Settings">
          <fieldset className="artwork-controls" aria-label="Radio">
            <div className="radio-options">
              {(['chir-fm', 'sunday', 'cc', 'island-city'] as const).map(next => <label className="toggle-label" key={next}>
                <span>{next === 'island-city' ? 'Island City' : next === 'sunday' ? 'Sunday' : next === 'cc' ? 'CC' : 'CHIR FM'}</span>
                <input className="radio" type="radio" name="radio-station" value={next} checked={radio === next} onChange={() => { renderRevision.current++; setError(''); setRadio(next) }} />
              </label>)}
            </div>
            <div className="show-details-fields">
              <label className="show-field" htmlFor="show-date">Show date
                <input id="show-date" className="input" type="date" value={date} onChange={event => { renderRevision.current++; setError(''); setDate(event.target.value) }} />
              </label>
              {radio !== 'island-city' && <label className="show-field" htmlFor="show-host">Host name
                <input id="show-host" className="input" type="text" maxLength={120} placeholder="Christina Novak & Emily McMartin" value={host} onChange={event => { renderRevision.current++; setError(''); setHost(event.target.value) }} />
              </label>}
            </div>
            {radio === 'cc' && <div className="time-fields">
              <label className="show-field" htmlFor="start-time">Start time
                <input id="start-time" className="input" type="time" value={startTime} onChange={event => { renderRevision.current++; setError(''); setStartTime(event.target.value) }} />
              </label>
              <label className="show-field" htmlFor="finish-time">Finish time
                <input id="finish-time" className="input" type="time" value={finishTime} onChange={event => { renderRevision.current++; setError(''); setFinishTime(event.target.value) }} />
              </label>
            </div>}
          </fieldset>
          <fieldset className="artwork-controls" aria-label="Color">
            <div className="radio-options">
              {(['lime', 'copper', 'berry'] as const).map(next => <label className="toggle-label" key={next}>
                <span>{next[0].toUpperCase() + next.slice(1)}</span>
                <input className="radio" type="radio" name="color" value={next} checked={color === next} onChange={() => { renderRevision.current++; setError(''); setColor(next) }} />
              </label>)}
            </div>
            <fieldset aria-label="Photo effect">
              <div className="radio-options">
                {(['normal', 'dither', 'duotone'] as const).map(next => <label className="toggle-label" key={next}>
                  <span>{next === 'normal' ? 'Normal' : next === 'dither' ? 'Diffusion Dither' : 'Duotone'}</span>
                  <input className="radio" type="radio" name="photo-effect" value={next} checked={photoEffect === next} onChange={() => { renderRevision.current++; setError(''); setPhotoEffect(next) }} />
                </label>)}
              </div>
            </fieldset>
            <label className="toggle-label">
              <span id="corner-gradient-label">Corner gradient</span>
              <span id="corner-gradient-help" className='mr-auto'>(Adds Legibility)</span>
              <input className="toggle" type="checkbox" aria-labelledby="corner-gradient-label" aria-describedby="corner-gradient-help" checked={cornerGradient} onChange={event => { renderRevision.current++; setError(''); setCornerGradient(event.target.checked) }} />
            </label>
          </fieldset>
          <fieldset className="artwork-controls format-controls" aria-label="Output format">
            {(['square', 'portrait'] as const).map(next => <label className="toggle-label" key={next}>
              <span>{next === 'square' ? 'Square' : '4:5'}</span>
              <input className="radio" type="radio" name="output-format" value={next} checked={format === next} onChange={() => {
                renderRevision.current++
                drag.current = null
                selectedFormat.current = next
                setFormat(next)
                setError('')
                if (photo) setCrop(centeredCrop(photo, outputRatio(next)))
              }} />
            </label>)}
          </fieldset>
          <div className="panel-actions">{resultReady && !decoding ? <a className="btn btn-primary" href={result.url} download={result.filename}>Download PNG <span aria-hidden="true">↓</span></a> : <button className="btn btn-primary" disabled aria-busy={decoding || updating}>Download PNG {decoding || updating ? <span className="spinner" aria-hidden="true" /> : <span aria-hidden="true">↓</span>}</button>}</div>
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{status}</div>
          {error && <div className="alert" role="alert"><span>{error}</span>{photo && <button className="btn btn-outline" onClick={() => { setError(''); setRetry(value => value + 1) }}>Retry preview</button>}</div>}
        </aside>
      </section>
    </main>
  )
}
