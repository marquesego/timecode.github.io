// DOM Elements
const video = document.getElementById("video");
const filesInput = document.getElementById("files");
const binContainer = document.getElementById("media-bin");
const sequenceList = document.getElementById("sequence-list");
const timecodeDisplay = document.getElementById("timecode-display");
const durationDisplay = document.getElementById("clip-duration-display");
const totalSeqTime = document.getElementById("total-seq-time");
const speedDisplay = document.getElementById("speed-display");
const editModePanel = document.getElementById("edit-mode-panel");
const editCutNum = document.getElementById("edit-cut-num");
const btnCancelEdit = document.getElementById("btn-cancel-edit");

// Scrubber Elements
const scrubberContainer = document.getElementById("source-scrubber");
const scrubberTrack = document.getElementById("scrubber-track");
const scrubberProgress = document.getElementById("scrubber-progress");
const scrubberPlayhead = document.getElementById("scrubber-playhead");
const markersContainer = document.getElementById("markers");

// Buttons
const btnJ = document.getElementById("btn-j");
const btnK = document.getElementById("btn-play-pause");
const btnL = document.getElementById("btn-l");
const btnStepBack = document.getElementById("btn-step-back");
const btnStepFwd = document.getElementById("btn-step-fwd");
const btnMarkIn = document.getElementById("btn-mark-in");
const btnMarkOut = document.getElementById("btn-mark-out");
const btnPlayTimeline = document.getElementById("btn-play-timeline");
const btnExportXML = document.getElementById("btn-export-xml");

// State
let clips = []; 
let cuts = [];
let currentClipIndex = -1;
let currentIn = null;
let editingCutIndex = null; 
const fps = 25; 
let playSpeed = 1; 
let reverseInterval = null; 

/* --- THUMBNAIL GENERATOR (LAZY LOADING) --- */
const thumbQueue = [];
let isGeneratingThumb = false;
const hiddenVideo = document.createElement('video');
hiddenVideo.muted = true;
hiddenVideo.playsInline = true;

hiddenVideo.onloadedmetadata = () => {
  hiddenVideo.currentTime = Math.min(1, hiddenVideo.duration / 2);
};

hiddenVideo.onseeked = () => {
  const currentTask = thumbQueue[0];
  if (!currentTask) return;
  
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 90;
    canvas.getContext('2d').drawImage(hiddenVideo, 0, 0, 160, 90);
    clips[currentTask.index].thumbnail = canvas.toDataURL('image/jpeg', 0.6);
  } catch(e) {
    console.error("Error generating thumbnail", e);
  }
  
  if (clips[currentTask.index].duration === 0) {
    clips[currentTask.index].duration = hiddenVideo.duration;
  }
  
  renderBin();
  thumbQueue.shift();
  processThumbQueue();
};

hiddenVideo.onerror = () => {
  thumbQueue.shift();
  processThumbQueue();
};

function processThumbQueue() {
  if (thumbQueue.length === 0) {
    isGeneratingThumb = false;
    return;
  }
  isGeneratingThumb = true;
  hiddenVideo.src = thumbQueue[0].url;
}

/* --- INITIALIZATION & FILE HANDLING --- */

filesInput.addEventListener("change", (e) => {
  if (e.target.files.length === 0) return;
  const newFiles = Array.from(e.target.files);
  
  for (let f of newFiles) {
    clips.push({
      name: f.name,
      url: URL.createObjectURL(f),
      duration: 0,
      thumbnail: null
    });
    // Add to thumbnail processing queue
    thumbQueue.push({ index: clips.length - 1, url: clips[clips.length - 1].url });
  }
  
  renderBin();
  if (currentClipIndex === -1 && clips.length > 0) {
    loadClip(0);
  }
  
  if (!isGeneratingThumb) processThumbQueue();
});

function formatTimecode(secs) {
  if (isNaN(secs) || secs < 0) return "00:00:00:00";
  const h = Math.floor(secs / 3600).toString().padStart(2, '0');
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  const f = Math.floor((secs % 1) * fps).toString().padStart(2, '0');
  return `${h}:${m}:${s}:${f}`;
}

function renderBin() {
  binContainer.innerHTML = "";
  if (clips.length === 0) {
    binContainer.innerHTML = '<div class="empty-state">No hay archivos.</div>';
    return;
  }
  
  clips.forEach((clip, i) => {
    const item = document.createElement('div');
    item.className = `bin-item ${i === currentClipIndex ? 'active' : ''}`;
    
    let durationStr = clip.duration > 0 ? formatTimecode(clip.duration).slice(3, 8) : '--:--';
    
    // Si ya tenemos el thumbnail generado, lo mostramos como fondo
    let thumbStyle = clip.thumbnail ? `background-image: url(${clip.thumbnail});` : '';
    let iconHTML = clip.thumbnail ? '' : '<i class="fa-solid fa-film"></i>';
    
    item.innerHTML = `
      <div class="bin-icon" style="${thumbStyle}">
        ${iconHTML}
        <div class="duration">${durationStr}</div>
      </div>
      <div class="bin-label" title="${clip.name}">${clip.name}</div>
    `;
    item.onclick = () => loadClip(i);
    binContainer.appendChild(item);
  });
}

function loadClip(index) {
  if (!clips[index]) return;
  currentClipIndex = index;
  video.src = clips[index].url;
  video.load();
  currentIn = null;
  stopReverse(); 
  playSpeed = 1; 
  updateSpeedDisplay();
  renderBin(); 
  renderAll();
}

video.addEventListener("loadedmetadata", () => {
  if (currentClipIndex !== -1 && clips[currentClipIndex]) {
    clips[currentClipIndex].duration = video.duration;
    durationDisplay.textContent = `Dur: ${formatTimecode(video.duration).slice(0, 8)}`;
    // Actualizamos el bin por si no se había actualizado la duración aún
    if(!clips[currentClipIndex].thumbnail) {
        renderBin(); 
    }
  }
});

/* --- SWIPE TO CHANGE CLIP --- */
const videoContainer = document.getElementById("video-container");
let touchStartX = 0;
videoContainer.addEventListener("touchstart", e => {
  touchStartX = e.changedTouches[0].screenX;
}, {passive: true});

videoContainer.addEventListener("touchend", e => {
  if (editingCutIndex !== null) return; 
  const touchEndX = e.changedTouches[0].screenX;
  const diff = touchStartX - touchEndX;
  if (Math.abs(diff) > 60) {
    if (diff > 0 && currentClipIndex < clips.length - 1) {
      loadClip(currentClipIndex + 1);
    } else if (diff < 0 && currentClipIndex > 0) {
      loadClip(currentClipIndex - 1);
    }
  }
}, {passive: true});

/* --- TRANSPORT CONTROLS --- */
function playForward() {
  stopReverse();
  if (video.paused) {
    playSpeed = 1; video.playbackRate = playSpeed; video.play();
  } else {
    if (playSpeed < 8) playSpeed *= 2;
    video.playbackRate = playSpeed;
  }
  updateSpeedDisplay();
}

function pausePlayback() {
  stopReverse(); video.pause(); playSpeed = 1; video.playbackRate = 1; updateSpeedDisplay();
}

function playReverse() {
  if (!video.paused) video.pause();
  if (reverseInterval) {
    if (playSpeed < 8) playSpeed *= 2;
  } else {
    playSpeed = 1;
    reverseInterval = setInterval(() => {
      const step = (1 / fps) * playSpeed;
      if (video.currentTime <= 0) stopReverse(); else video.currentTime -= step;
    }, 1000 / fps);
  }
  updateSpeedDisplay(true);
}

function stopReverse() { if (reverseInterval) { clearInterval(reverseInterval); reverseInterval = null; } }
function stepForward() { pausePlayback(); video.currentTime += (1 / fps); }
function stepBackward() { pausePlayback(); video.currentTime -= (1 / fps); }

function updateSpeedDisplay(isReverse = false) {
  if (playSpeed > 1 || isReverse) {
    speedDisplay.classList.add('active');
    speedDisplay.textContent = (isReverse ? '-' : '') + playSpeed + 'x';
  } else speedDisplay.classList.remove('active');
}

btnL.addEventListener("click", playForward);
btnK.addEventListener("click", () => { if (!video.paused || reverseInterval) pausePlayback(); else playForward(); });
btnJ.addEventListener("click", playReverse);
btnStepFwd.addEventListener("click", stepForward);
btnStepBack.addEventListener("click", stepBackward);

video.addEventListener("play", () => btnK.innerHTML = '<i class="fa-solid fa-pause"></i>');
video.addEventListener("pause", () => { if (!reverseInterval) btnK.innerHTML = '<i class="fa-solid fa-play"></i>'; });

video.addEventListener("timeupdate", () => {
  timecodeDisplay.textContent = formatTimecode(video.currentTime);
  updateScrubberUI();
});

document.addEventListener("keydown", (e) => {
  if (e.target.tagName.toLowerCase() === 'input') return;
  const key = e.key.toLowerCase();
  if (key === "j") playReverse();
  if (key === "k") pausePlayback();
  if (key === "l") playForward();
  if (key === "i") btnMarkIn.click();
  if (key === "o") btnMarkOut.click();
  if (e.code === "Space") { e.preventDefault(); if (!video.paused || reverseInterval) pausePlayback(); else playForward(); }
});

/* --- SOURCE SCRUBBER --- */
function updateScrubberUI() {
  if (!video.duration) return;
  const percent = (video.currentTime / video.duration) * 100;
  scrubberProgress.style.width = percent + "%";
  scrubberPlayhead.style.left = percent + "%";
}

function scrubTo(e) {
  if (!video.duration) return;
  const rect = scrubberTrack.getBoundingClientRect();
  const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
  let x = Math.max(0, Math.min(clientX - rect.left, rect.width));
  video.currentTime = (x / rect.width) * video.duration;
}

let isScrubbing = false;
const startScrub = (e) => { isScrubbing = true; pausePlayback(); scrubTo(e); };
const moveScrub = (e) => { if (!isScrubbing) return; if(e.type.includes('touch')) e.preventDefault(); scrubTo(e); };
const endScrub = () => { isScrubbing = false; };

scrubberContainer.addEventListener('mousedown', startScrub); scrubberContainer.addEventListener('touchstart', startScrub, {passive: false});
document.addEventListener('mousemove', moveScrub); document.addEventListener('touchmove', moveScrub, {passive: false});
document.addEventListener('mouseup', endScrub); document.addEventListener('touchend', endScrub);

/* --- MARK IN/OUT & EDITING --- */
btnMarkIn.addEventListener("click", () => {
  if (currentClipIndex === -1) return;
  currentIn = video.currentTime;
  btnMarkIn.style.background = "var(--primary)"; setTimeout(() => btnMarkIn.style.background = "", 200);
  renderMarkers();
});

btnMarkOut.addEventListener("click", () => {
  if (currentClipIndex === -1 || currentIn === null) return;
  const outTime = video.currentTime;
  if (outTime <= currentIn) { alert("El OUT debe ser posterior al IN"); return; }
  
  if (editingCutIndex !== null) {
    cuts[editingCutIndex].in = currentIn;
    cuts[editingCutIndex].out = outTime;
    exitEditMode();
  } else {
    cuts.push({ clip: currentClipIndex, in: currentIn, out: outTime, track: 0 }); // Todo va al track 0 (V1)
    currentIn = null;
  }
  
  btnMarkOut.style.background = "var(--primary)"; setTimeout(() => btnMarkOut.style.background = "", 200);
  renderAll();
});

function exitEditMode() {
  editingCutIndex = null;
  currentIn = null;
  editModePanel.style.display = "none";
  renderAll();
}

btnCancelEdit.addEventListener("click", exitEditMode);

window.editCut = function(index) {
  editingCutIndex = index;
  const cut = cuts[index];
  loadClip(cut.clip);
  currentIn = cut.in;
  video.currentTime = cut.in;
  
  editModePanel.style.display = "flex";
  editCutNum.textContent = index + 1;
  renderAll();
};

window.deleteCut = function(index) {
  cuts.splice(index, 1);
  if(editingCutIndex === index) exitEditMode();
  renderAll();
}

window.playExtract = function(index) {
  const c = cuts[index];
  if (currentClipIndex !== c.clip) loadClip(c.clip);
  
  video.currentTime = c.in;
  playForward();
  
  const check = () => {
    if (video.currentTime >= c.out) {
      video.removeEventListener('timeupdate', check);
      pausePlayback();
    }
  };
  video.addEventListener('timeupdate', check);
}

/* --- RENDER FUNCTIONS --- */
function renderAll() {
  renderSequence();
  renderMarkers();
}

Sortable.create(sequenceList, {
  animation: 150,
  handle: '.drag-handle',
  onEnd: function (evt) {
    if (evt.oldIndex === evt.newIndex) return;
    const item = cuts.splice(evt.oldIndex, 1)[0];
    cuts.splice(evt.newIndex, 0, item);
    
    if (editingCutIndex === evt.oldIndex) editingCutIndex = evt.newIndex;
    else if (editingCutIndex !== null) {
      if (evt.oldIndex < editingCutIndex && evt.newIndex >= editingCutIndex) editingCutIndex--;
      else if (evt.oldIndex > editingCutIndex && evt.newIndex <= editingCutIndex) editingCutIndex++;
    }
    
    if (editingCutIndex !== null) editCutNum.textContent = editingCutIndex + 1;
    renderAll();
  }
});

function renderSequence() {
  sequenceList.innerHTML = "";
  let totalDur = 0;
  
  if (cuts.length === 0) {
    sequenceList.innerHTML = '<div class="empty-state">No hay cortes en la secuencia.</div>';
    totalSeqTime.textContent = "00:00:00:00";
    return;
  }
  
  cuts.forEach((c, i) => {
    const dur = c.out - c.in;
    totalDur += dur;
    const item = document.createElement("div");
    item.className = "seq-item";
    if (i === editingCutIndex) item.style.border = "1px solid var(--accent)";
    
    // seq-item-info es ahora clickable para reproducir el extracto
    item.innerHTML = `
      <div class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></div>
      <div class="seq-item-info" onclick="playExtract(${i})" title="Reproducir extracto">
        <div class="seq-item-title">${clips[c.clip].name}</div>
        <div class="seq-item-times">
          <span>IN: ${formatTimecode(c.in).slice(3, 11)}</span>
          <span>OUT: ${formatTimecode(c.out).slice(3, 11)}</span>
          <strong style="color:var(--primary)">Dur: ${formatTimecode(dur).slice(3, 11)}</strong>
        </div>
      </div>
      <div class="seq-item-actions">
        <button class="edit-btn" onclick="editCut(${i})" title="Re-editar"><i class="fa-solid fa-pen"></i></button>
        <button class="delete-btn" onclick="deleteCut(${i})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
    sequenceList.appendChild(item);
  });
  
  totalSeqTime.textContent = formatTimecode(totalDur);
}

function renderMarkers() {
  markersContainer.innerHTML = "";
  if (!video.duration || currentClipIndex === -1) return;
  const dur = video.duration;
  
  cuts.forEach((c, i) => {
    if (c.clip !== currentClipIndex) return;
    const region = document.createElement("div");
    region.className = "marker-region";
    region.style.left = (c.in / dur * 100) + "%";
    region.style.width = ((c.out - c.in) / dur * 100) + "%";
    
    if (i === editingCutIndex) {
      region.style.background = "rgba(255, 157, 0, 0.4)";
      region.style.borderLeftColor = "var(--accent)";
      region.style.borderRightColor = "var(--accent)";
    }
    
    markersContainer.appendChild(region);
  });
  
  if (currentIn !== null) {
     const tmpM = document.createElement("div");
     tmpM.className = "marker-region";
     tmpM.style.left = (currentIn / dur * 100) + "%";
     tmpM.style.width = "2px";
     tmpM.style.background = "var(--primary)";
     markersContainer.appendChild(tmpM);
  }
}

/* --- TABS --- */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.target).classList.add('active');
  });
});

/* --- PLAY SEQUENCE --- */
btnPlayTimeline.addEventListener("click", () => {
  if (cuts.length === 0) return;
  pausePlayback();
  exitEditMode();
  
  let i = 0;
  function next() {
    if (i >= cuts.length) return;
    const c = cuts[i];
    if (currentClipIndex !== c.clip) loadClip(c.clip);
    
    const playSeq = () => {
      video.currentTime = c.in;
      playForward(); 
      const check = () => {
        if (video.currentTime >= c.out) {
          video.removeEventListener('timeupdate', check);
          pausePlayback();
          i++;
          next();
        }
      };
      video.addEventListener('timeupdate', check);
    };
    if (video.readyState >= 2) playSeq();
    else video.addEventListener('loadeddata', playSeq, { once: true });
  }
  next();
});

/* --- EXPORT XML --- */
btnExportXML.addEventListener("click", () => {
  if (cuts.length === 0) { alert("¡No hay cortes para exportar!"); return; }
  
  let timelinePos = 0;
  let id = 1;
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence><name>Secuencia Redacción</name>
<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
<media><video><format><samplecharacteristics>
<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
<width>1920</width><height>1080</height>
<anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio>
<fielddominance>none</fielddominance>
</samplecharacteristics></format><track>
`;
  let audioTrack = "";

  cuts.forEach((c) => {
    let inF = Math.floor(c.in * fps);
    let outF = Math.floor(c.out * fps);
    let dur = outF - inF;
    let totalDur = dur + 200; 
    const cName = clips[c.clip].name;

    xml += `
<clipitem id="clipitem-${id}">
<masterclipid>masterclip-${id}</masterclipid>
<name>${cName}</name><enabled>TRUE</enabled>
<duration>${totalDur}</duration>
<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
<start>${timelinePos}</start><end>${timelinePos + dur}</end>
<in>${inF}</in><out>${outF}</out>
<file id="file-${id}"><name>${cName}</name>
<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
<duration>${totalDur}</duration>
<media><video><samplecharacteristics><width>1920</width><height>1080</height></samplecharacteristics></video>
<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio></media>
</file></clipitem>`;

    audioTrack += `<clipitem id="clipitem-a${id}"><masterclipid>masterclip-${id}</masterclipid><name>${cName}</name><enabled>TRUE</enabled><duration>${totalDur}</duration><start>${timelinePos}</start><end>${timelinePos + dur}</end><in>${inF}</in><out>${outF}</out><file id="file-${id}"/></clipitem>`;
    timelinePos += dur;
    id++;
  });

  xml += `</track></video><audio><track>${audioTrack}</track></audio></media>
<timecode><rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
</sequence></xmeml>`;

  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Secuencia_Redaccion.xml";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
