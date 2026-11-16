import { useRef, type CSSProperties } from 'react'
import { centeredCrop, cropBounds, resizeCrop, type Crop } from './lib/crop'
import type { Photo } from './lib/images'
import './CropControls.css'

type DialProps = {
  label: string
  short: string
  value: number
  min?: number
  disabled: boolean
  onChange: (value: number) => void
}

function CropDial({ label, short, value, min = 0, disabled, onChange }: DialProps) {
  const drag = useRef<{ y: number; value: number } | null>(null)
  const change = (next: number) => onChange(Math.max(min, Math.min(100, next)))
  const angle = -135 + (value - min) / (100 - min || 1) * 270

  return <div className="crop-dial-group">
    <span className="crop-dial-label">{short}</span>
    <div role="slider" aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={100} aria-valuenow={Number(value.toFixed(1))} aria-valuetext={`${value.toFixed(1)}%${min ? ' of the maximum crop' : ''}`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      className="crop-dial" style={{ '--angle': `${angle}deg`, '--sweep': `${angle + 135}deg` } as CSSProperties}
      onPointerDown={event => {
        if (disabled || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { y: event.clientY, value }
      }}
      onPointerMove={event => {
        if (!disabled && drag.current) change(drag.current.value + (drag.current.y - event.clientY) * (event.shiftKey ? 0.1 : 0.5))
      }}
      onPointerUp={() => { drag.current = null }}
      onPointerCancel={() => { drag.current = null }}
      onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={event => {
        if (disabled) return
        const step = event.shiftKey ? 0.1 : 1
        let next: number
        switch (event.key) {
          case 'ArrowUp': case 'ArrowRight': next = value + step; break
          case 'ArrowDown': case 'ArrowLeft': next = value - step; break
          case 'Home': next = min; break
          case 'End': next = 100; break
          case 'PageUp': next = value + 10; break
          case 'PageDown': next = value - 10; break
          default: return
        }
        event.preventDefault()
        change(next)
      }}>
      <span className="crop-dial-face" aria-hidden="true"><i /></span>
    </div>
    <output aria-hidden="true">{Math.round(value)}%</output>
  </div>
}

type Props = { photo: Photo | null; crop: Crop; ratio: number; onChange: (crop: Crop) => void }
export function CropControls({ photo, crop, ratio, onChange }: Props) {
  const bounds = photo ? cropBounds(photo, ratio) : { min: 1, max: 1 }
  const maxSize = bounds.max
  const min = bounds.min / bounds.max * 100
  const maxLeft = Math.max(0, 1 - crop.size)
  const maxTop = photo ? Math.max(0, 1 - crop.size * photo.width / photo.height / ratio) : 0

  return <div className="crop-controls" role="group" aria-label="Crop">
    <div className="crop-knob-row">
      <CropDial label="Crop size" short="Size" value={crop.size / maxSize * 100} min={min} disabled={!photo || min === 100} onChange={value => photo && onChange(resizeCrop(crop, value / 100 * maxSize, photo, ratio))} />
      <CropDial label="Horizontal position" short="X" value={maxLeft ? crop.left / maxLeft * 100 : 50} disabled={!photo || !maxLeft} onChange={value => onChange({ ...crop, left: value / 100 * maxLeft })} />
      <CropDial label="Vertical position" short="Y" value={maxTop ? crop.top / maxTop * 100 : 50} disabled={!photo || !maxTop} onChange={value => onChange({ ...crop, top: value / 100 * maxTop })} />
      <button type="button" className="crop-reset" disabled={!photo} onClick={() => photo && onChange(centeredCrop(photo, ratio))} aria-label="Reset crop">
        <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.6 9.6A26 26 0 1 1 2.6 33.4" />
          <path d="M9.6 1.6v8h8" />
        </svg>
        <span>Reset</span>
      </button>
    </div>
  </div>
}
