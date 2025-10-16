import React, { useRef, useState, useEffect } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument } from 'pdf-lib'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.entry'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

function uid(){ return Math.random().toString(36).slice(2,9) }

export default function App(){
  const fileInputRef = useRef()
  const canvasRef = useRef()
  const overlayRef = useRef()
  const [pdfDoc, setPdfDoc] = useState(null)
  const [origPdfBytes, setOrigPdfBytes] = useState(null)
  const [currentPageNum, setCurrentPageNum] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.25)

  const [mode, setMode] = useState('select') // 'select'|'text'|'draw'
  const [color, setColor] = useState('#ff0000')
  const [fontSize, setFontSize] = useState(20)

  const [annotations, setAnnotations] = useState({})
  const undoStack = useRef([])
  const redoStack = useRef([])

  const drawing = useRef(false)
  const drawPath = useRef([])

  // keep track of selected annotation for move/resize
  const [selected, setSelected] = useState(null)
  const dragOffset = useRef({x:0,y:0})

  useEffect(()=>{
    if(!pdfDoc) return
    let cancelled = false
    ;(async ()=>{
      const page = await pdfDoc.getPage(currentPageNum)
      if(cancelled) return
      const viewport = page.getViewport({scale})
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      canvas.style.width = canvas.width + 'px'
      canvas.style.height = canvas.height + 'px'

      await page.render({canvasContext: ctx, viewport}).promise

      const overlay = overlayRef.current
      overlay.width = canvas.width
      overlay.height = canvas.height
      overlay.style.width = canvas.style.width
      overlay.style.height = canvas.style.height

      drawAnnotationsForPage(currentPageNum)
    })()
    return ()=>{ cancelled = true }
  }, [pdfDoc, currentPageNum, scale, annotations])

  function pushUndo(state){ undoStack.current.push(JSON.stringify(state)); redoStack.current = [] }
  function doUndo(){
    if(undoStack.current.length===0) return
    const cur = JSON.stringify(annotations)
    redoStack.current.push(cur)
    const prev = undoStack.current.pop()
    setAnnotations(JSON.parse(prev))
  }
  function doRedo(){
    if(redoStack.current.length===0) return
    const cur = JSON.stringify(annotations)
    undoStack.current.push(cur)
    const next = redoStack.current.pop()
    setAnnotations(JSON.parse(next))
  }
gs
  function handleFile(e){
    const file = e.target.files[0]
    if(!file) return
    const reader = new FileReader()
    reader.onload = async function(){
      const typed = new Uint8Array(reader.result)
      setOrigPdfBytes(typed)
      const loadingTask = pdfjsLib.getDocument({data: typed})
      const doc = await loadingTask.promise
      setPdfDoc(doc)
      setNumPages(doc.numPages)
      setCurrentPageNum(1)
      setAnnotations({})
      undoStack.current = []
      redoStack.current = []
      pushUndo({})
    }
    reader.readAsArrayBuffer(file)
  }

  function drawAnnotationsForPage(pageNum){
    const overlay = overlayRef.current
    const ctx = overlay.getContext('2d')
    ctx.clearRect(0,0,overlay.width, overlay.height)
    const pageAnnos = annotations[pageNum] || []
    for(const a of pageAnnos){
      if(a.type === 'draw'){
        ctx.beginPath(); ctx.lineWidth = a.width * (overlay.width / (a.canvasWidth||overlay.width)); ctx.lineCap='round'; ctx.strokeStyle = a.color||'#000'
        for(let i=0;i<a.path.length;i++){
          const p = a.path[i]
          const x = p.x * (overlay.width / (a.canvasWidth||overlay.width))
          const y = p.y * (overlay.height / (a.canvasHeight||overlay.height))
          if(i===0) ctx.moveTo(x,y)
          else ctx.lineTo(x,y)
        }
        ctx.stroke()
      } else if(a.type === 'text'){
        ctx.font = `${a.fontSize}px sans-serif`
        ctx.fillStyle = a.color || '#000'
        const x = a.x * (overlay.width / (a.canvasWidth||overlay.width))
        const y = a.y * (overlay.height / (a.canvasHeight||overlay.height))
        ctx.fillText(a.text, x, y)
      }
    }
    // draw selection box
    if(selected && selected.page === pageNum){
      const s = selected.annotation
      const sx = s.x * (overlay.width / (s.canvasWidth||overlay.width))
      const sy = s.y * (overlay.height / (s.canvasHeight||overlay.height))
      const sw = (s.width||100) * (overlay.width / (s.canvasWidth||overlay.width))
      const sh = (s.height||30) * (overlay.height / (s.canvasHeight||overlay.height))
      ctx.strokeStyle = '#0b69ff'
      ctx.lineWidth = 1
      ctx.strokeRect(sx-4, sy-18, sw+8, sh+24)
    }
  }

  function handleCanvasPointerDown(e){
    const rect = overlayRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (overlayRef.current.width / rect.width)
    const y = (e.clientY - rect.top) * (overlayRef.current.height / rect.height)
    if(mode === 'draw'){
      drawing.current = true
      drawPath.current = []
      drawPath.current.push({x,y})
    } else if(mode === 'text'){
      const text = prompt('Enter text')
      if(!text) return
      const anno = { id: uid(), type:'text', x, y, text, fontSize, color, canvasWidth: overlayRef.current.width, canvasHeight: overlayRef.current.height }
      pushUndo(annotations)
      setAnnotations(prev=>{ const p = prev[currentPageNum] ? [...prev[currentPageNum], anno] : [anno]; return {...prev, [currentPageNum]: p} })
    } else if(mode === 'select'){
      // check if clicking on any text annotation
      const pageAnnos = annotations[currentPageNum] || []
      let found = null
      for(let i=pageAnnos.length-1;i>=0;i--){
        const a = pageAnnos[i]
        if(a.type==='text'){
          const ax = a.x * (overlayRef.current.width / (a.canvasWidth||overlayRef.current.width))
          const ay = a.y * (overlayRef.current.height / (a.canvasHeight||overlayRef.current.height))
          // simple hitbox
          const w = (a.width||100) * (overlayRef.current.width / (a.canvasWidth||overlayRef.current.width))
          const h = (a.height||30) * (overlayRef.current.height / (a.canvasHeight||overlayRef.current.height))
          if(x>=ax && x<=ax+w && y>=ay- (h*0.2) && y<=ay+h){ found = a; break }
        }
      }
      if(found){
        setSelected({page:currentPageNum, annotation:found})
        dragOffset.current = {x: x - (found.x * (overlayRef.current.width / (found.canvasWidth||overlayRef.current.width))), y: y - (found.y * (overlayRef.current.height / (found.canvasHeight||overlayRef.current.height)))}
      } else {
        setSelected(null)
      }
    }
  }

  function handleCanvasPointerMove(e){
    const rect = overlayRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (overlayRef.current.width / rect.width)
    const y = (e.clientY - rect.top) * (overlayRef.current.height / rect.height)
    if(drawing.current){
      drawPath.current.push({x,y})
      drawAnnotationsForPage(currentPageNum)
      const ctx = overlayRef.current.getContext('2d')
      ctx.beginPath(); ctx.lineWidth = 3; ctx.lineCap='round'; ctx.strokeStyle = color
      for(let i=0;i<drawPath.current.length;i++){
        const p = drawPath.current[i]
        if(i===0) ctx.moveTo(p.x,p.y)
        else ctx.lineTo(p.x,p.y)
      }
      ctx.stroke()
    } else if(selected && e.buttons===1){
      // dragging selected text
      const s = selected.annotation
      const newX = (x - dragOffset.current.x) * (s.canvasWidth / overlayRef.current.width)
      const newY = (y - dragOffset.current.y) * (s.canvasHeight / overlayRef.current.height)
      setAnnotations(prev=>{
        const pageAnnos = prev[currentPageNum].map(a=> a.id===s.id ? {...a, x:newX, y:newY} : a)
        return {...prev, [currentPageNum]: pageAnnos}
      })
      setSelected(prev=>({...prev, annotation:{...s, x:newX, y:newY}}))
    }
  }

  function handleCanvasPointerUp(e){
    if(drawing.current){
      drawing.current = false
      const anno = { id: uid(), type:'draw', path: drawPath.current.map(p=>({x:p.x,y:p.y})), width:3, color, canvasWidth: overlayRef.current.width, canvasHeight: overlayRef.current.height }
      pushUndo(annotations)
      setAnnotations(prev=>{ const p = prev[currentPageNum] ? [...prev[currentPageNum], anno] : [anno]; return {...prev, [currentPageNum]: p} })
      drawPath.current = []
    } else if(selected){
      pushUndo(annotations)
    }
  }

  function deleteSelected(){
    if(!selected) return
    const s = selected.annotation
    pushUndo(annotations)
    setAnnotations(prev=>{ const pageAnnos = prev[currentPageNum].filter(a=>a.id!==s.id); return {...prev, [currentPageNum]: pageAnnos} })
    setSelected(null)
  }

  function exportPDF(){
    if(!pdfDoc) return alert('No PDF')
    // Rasterize pages like before
    (async ()=>{
      const outPdf = await PDFDocument.create()
      for(let p=1;p<=pdfDoc.numPages;p++){
        const page = await pdfDoc.getPage(p)
        const viewport = page.getViewport({scale:1})
        const tmpCanvas = document.createElement('canvas')
        tmpCanvas.width = Math.round(viewport.width)
        tmpCanvas.height = Math.round(viewport.height)
        const tmpCtx = tmpCanvas.getContext('2d')
        await page.render({canvasContext: tmpCtx, viewport}).promise

        // draw annotations scaled
        const pageAnnos = annotations[p] || []
        for(const a of pageAnnos){
          if(a.type==='draw'){
            tmpCtx.beginPath(); tmpCtx.lineCap='round'; tmpCtx.lineWidth = a.width * (tmpCanvas.width / (a.canvasWidth||tmpCanvas.width)); tmpCtx.strokeStyle = a.color||'#000'
            for(let i=0;i<a.path.length;i++){
              const pt = a.path[i]
              const sx = pt.x * (tmpCanvas.width / (a.canvasWidth||tmpCanvas.width))
              const sy = pt.y * (tmpCanvas.height / (a.canvasHeight||tmpCanvas.height))
              if(i===0) tmpCtx.moveTo(sx,sy)
              else tmpCtx.lineTo(sx,sy)
            }
            tmpCtx.stroke()
          } else if(a.type==='text'){
            tmpCtx.font = `${a.fontSize * (tmpCanvas.width / (a.canvasWidth||tmpCanvas.width))}px sans-serif`
            tmpCtx.fillStyle = a.color||'#000'
            const sx = a.x * (tmpCanvas.width / (a.canvasWidth||tmpCanvas.width))
            const sy = a.y * (tmpCanvas.height / (a.canvasHeight||tmpCanvas.height))
            tmpCtx.fillText(a.text, sx, sy)
          }
        }

        const imgBytes = tmpCanvas.toDataURL('image/png')
        const png = await (await fetch(imgBytes)).arrayBuffer()
        const img = await outPdf.embedPng(png)
        const {width, height} = img.scale(1)
        const pdfPage = outPdf.addPage([width, height])
        pdfPage.drawImage(img, {x:0,y:0,width,height})
      }
      const pdfBytes = await outPdf.save()
      const blob = new Blob([pdfBytes], {type:'application/pdf'})
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'edited.pdf'
      link.click()
    })()
  }

  function saveAnnotations(){
    const data = JSON.stringify(annotations)
    const blob = new Blob([data], {type:'application/json'})
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'annotations.json'
    a.click()
  }

  function loadAnnotationsFile(e){
    const f = e.target.files[0]
    if(!f) return
    const r = new FileReader()
    r.onload = ()=>{
      try{
        const obj = JSON.parse(r.result)
        pushUndo(annotations)
        setAnnotations(obj)
      }catch(err){ alert('Invalid JSON') }
    }
    r.readAsText(f)
  }

  return (
    <div className="app">
      <div className="header"><h2>PDF Editor — Enhanced</h2><div className="muted small">Undo/Redo, color picker, move/resize text, save/load annotations</div></div>
      <div style={{display:'flex',gap:16,marginTop:12}}>
        <div style={{width:340}} className="card">
          <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFile} />
          <div className="toolbar" style={{marginTop:8}}>
            <button className="button" onClick={()=>setMode('select')}>Select</button>
            <button className="button" onClick={()=>setMode('text')}>Add Text</button>
            <button className="button" onClick={()=>setMode('draw')}>Draw</button>
          </div>
          <div style={{marginTop:8}} className="small">Color: <input type="color" value={color} onChange={e=>setColor(e.target.value)} /></div>
          <div style={{marginTop:8}} className="small">Font size: <input type="number" min={8} max={72} value={fontSize} onChange={e=>setFontSize(Number(e.target.value))} /></div>

          <div className="pageNav small muted" style={{marginTop:12}}>
            <button onClick={()=>setCurrentPageNum(p=>Math.max(1,p-1))} className="button">Prev</button>
            <div>Page <strong>{currentPageNum}</strong> / {numPages}</div>
            <button onClick={()=>setCurrentPageNum(p=>Math.min(numPages,p+1))} className="button">Next</button>
          </div>

          <div style={{marginTop:8}}>
            <label className="small">Zoom</label>
            <input type="range" min={0.5} max={2.0} step={0.1} value={scale} onChange={e=>setScale(Number(e.target.value))} />
          </div>

          <div style={{marginTop:12,display:'flex',gap:8,flexWrap:'wrap'}}>
            <button className="button" onClick={doUndo}>Undo</button>
            <button className="button" onClick={doRedo}>Redo</button>
            <button className="button" onClick={deleteSelected}>Delete</button>
            <button className="button" onClick={exportPDF}>Export PDF</button>
          </div>

          <div style={{marginTop:12,display:'flex',gap:8}}>
            <button className="button" onClick={saveAnnotations}>Save Annotations</button>
            <input type="file" accept="application/json" onChange={loadAnnotationsFile} />
          </div>

          <div style={{marginTop:8}} className="small muted">Tip: In Select mode click text to move it. Add Text then click on page to insert.</div>
        </div>

        <div style={{flex:1}} className="card">
          <div className="small muted">Mode: <strong>{mode}</strong></div>
          <div className="canvasWrap" style={{marginTop:8}}>
            <canvas ref={canvasRef} className="pdfCanvas" />
            <canvas ref={overlayRef} className="overlayCanvas" style={{pointerEvents: 'auto'}}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
