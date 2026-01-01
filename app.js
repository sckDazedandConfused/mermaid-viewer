(() => {
  const textarea = document.getElementById('mermaidText');
  const renderBtn = document.getElementById('renderBtn');
  const resetBtn = document.getElementById('resetBtn');
  const diagram = document.getElementById('diagram');
  const status = document.getElementById('status');
  const sampleSelect = document.getElementById('sampleSelect');
  const openFileBtn = document.getElementById('openFileBtn');
  const filePicker = document.getElementById('filePicker');

  const samples = {
    flow: `flowchart TD
  A([Start]) --> B{Valid input?}
  B -- Yes --> C[Render diagram]
  B -- No --> D[Show error]
  C --> E[Zoom & Pan enabled]
  D --> E
  E --> F([Done])`,
    sequence: `sequenceDiagram
  participant U as User
  participant V as Viewer
  participant M as Mermaid
  U->>V: Paste definition
  V->>M: mermaid.render(definition)
  M-->>V: Returns SVG
  V-->>U: Pan & zoom hooks applied
  U->>U: Iterate quickly`,
    gantt: `gantt
  dateFormat  YYYY-MM-DD
  title Local build example
  section Build
  Setup :done, 2023-01-02, 2d
  Coding :active, 2023-01-04, 4d
  Tests  : 2023-01-08, 3d
  Deploy : 2023-01-12, 1d`
  };

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'default',
    flowchart: { useMaxWidth: true },
    sequence: { useMaxWidth: true }
  });

  let panZoomInstance = null;

  const escapeHtml = (value) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const cleanMermaidDefinition = (raw) => {
    if (!raw) return '';
    const lines = raw.split(/\r?\n/);

    // Trim leading empties
    while (lines.length && lines[0].trim() === '') {
      lines.shift();
    }
    // Drop leading fences
    while (lines.length && /^```/i.test(lines[0].trim())) {
      lines.shift();
    }

    // Trim trailing empties
    while (lines.length && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    // Drop trailing fences (repeat to catch duplicates)
    while (lines.length && /^```/i.test(lines[lines.length - 1].trim())) {
      lines.pop();
    }
    while (lines.length && /^```/i.test(lines[lines.length - 1].trim())) {
      lines.pop();
    }

    return lines.join('\n').trim();
  };

  const extractMermaidDefinition = (raw) => {
    if (!raw) return null;

    // Prefer explicit fenced mermaid blocks
    const fencedMatch = raw.match(/```mermaid\s*([\s\S]*?)```/i);
    if (fencedMatch) {
      return cleanMermaidDefinition(fencedMatch[1]);
    }

    // Otherwise, try to detect by leading keyword
    const cleaned = cleanMermaidDefinition(raw);
    const firstWord = cleaned.split(/\s+/)[0]?.toLowerCase() || '';
    const mermaidStarters = new Set([
      'graph',
      'flowchart',
      'sequenceDiagram'.toLowerCase(),
      'classDiagram'.toLowerCase(),
      'stateDiagram'.toLowerCase(),
      'erDiagram'.toLowerCase(),
      'journey',
      'gantt',
      'pie',
      'mindmap',
      'timeline'
    ]);

    if (mermaidStarters.has(firstWord)) {
      return cleaned;
    }

    return null;
  };

  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle('error', isError);
  };

  const destroyPanZoom = () => {
    if (panZoomInstance) {
      panZoomInstance.destroy();
      panZoomInstance = null;
    }
  };

  const applyPanZoom = (svgElement) => {
    panZoomInstance = svgPanZoom(svgElement, {
      controlIconsEnabled: true,
      zoomEnabled: true,
      panEnabled: true,
      minZoom: 0.4,
      maxZoom: 12,
      fit: true,
      center: true,
      zoomScaleSensitivity: 0.6
    });
    panZoomInstance.resize();
    panZoomInstance.fit();
    panZoomInstance.center();
  };

  let popupHandle = null;
  let popupReady = false;
  let pendingPopupSvg = null;

  const openViewerWindow = (existingWindow = null) => {
    const width = screen && screen.availWidth ? screen.availWidth : 1600;
    const height = screen && screen.availHeight ? screen.availHeight : 900;
    const features = `width=${width},height=${height},resizable=yes,scrollbars=yes`;
    const targetUrl = new URL('popup.html', window.location.href).toString();
    const popup = existingWindow && !existingWindow.closed
      ? existingWindow
      : window.open(targetUrl, '_blank', features);

    if (!popup) {
      setStatus('Popup blocked. Allow popups to open the full viewer.', true);
      return null;
    }

    popupHandle = popup;
    popupReady = false;
    return popup;
  };

  const sendSvgToPopup = (svgMarkup) => {
    pendingPopupSvg = svgMarkup;
    if (!popupHandle || popupHandle.closed || !popupReady) return;
    popupHandle.postMessage({ type: 'render-svg', svg: svgMarkup }, '*');
  };

  window.addEventListener('message', (event) => {
    if (!popupHandle || event.source !== popupHandle) return;
    if (event.data && event.data.type === 'popup-ready') {
      popupReady = true;
      if (pendingPopupSvg) {
        popupHandle.postMessage({ type: 'render-svg', svg: pendingPopupSvg }, '*');
      }
    }
  });

  const renderDiagram = async ({ openWindow = false } = {}) => {
    const rawInput = textarea.value || '';
    const definition = extractMermaidDefinition(rawInput);
    const isMermaid = Boolean(definition);

    if (!rawInput.trim()) {
      setStatus('Please provide content to render.', true);
      return;
    }

    destroyPanZoom();
    diagram.innerHTML = '';

    if (!isMermaid) {
      // Render as plain text instead of failing.
      const safeText = escapeHtml(rawInput);
      diagram.innerHTML = `<pre class="plain-text">${safeText}</pre>`;
      setStatus('Rendered as plain text (no Mermaid diagram detected).');
      return;
    }

    // Open popup immediately so browsers treat it as user-initiated.
    if (openWindow) {
      const width = screen && screen.availWidth ? screen.availWidth : 1600;
      const height = screen && screen.availHeight ? screen.availHeight : 900;
      const newPopup = openViewerWindow(popupHandle);
      if (!newPopup) {
        setStatus('Popup blocked. Allow popups to open the full viewer.', true);
        openWindow = false;
      }
    }

    setStatus('Rendering...');

    try {
      const { svg } = await mermaid.render('mermaid-diagram-' + Date.now(), definition);
      diagram.innerHTML = svg;
      const svgElement = diagram.querySelector('svg');
      if (!svgElement) {
        throw new Error('No SVG output');
      }
      svgElement.removeAttribute('width');
      svgElement.removeAttribute('height');
      applyPanZoom(svgElement);
      setStatus('Rendered. Scroll to zoom, drag to pan.');
      if (popupHandle && !popupHandle.closed) {
        sendSvgToPopup(svg);
      }
    } catch (err) {
      setStatus('Render failed: ' + err.message, true);
      if (popupHandle && !popupHandle.closed) popupHandle.close();
    }
  };

  const resetView = () => {
    if (panZoomInstance) {
      panZoomInstance.reset();
      panZoomInstance.fit();
      panZoomInstance.center();
    }
  };

  const loadSample = (key) => {
    const sample = samples[key];
    if (sample) {
      textarea.value = sample;
    }
  };

  const promptOpenFile = () => {
    filePicker.click();
  };

  const handleFileSelection = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    setStatus(`Loading ${file.name}...`);
    try {
      const text = await file.text();
      textarea.value = text;
      setStatus(`Loaded ${file.name}. Ready to render.`);
      renderDiagram({ openWindow: false });
    } catch (err) {
      setStatus('Failed to read file: ' + err.message, true);
    } finally {
      event.target.value = '';
    }
  };

  renderBtn.addEventListener('click', () => renderDiagram({ openWindow: true }));
  resetBtn.addEventListener('click', resetView);
  openFileBtn.addEventListener('click', promptOpenFile);
  filePicker.addEventListener('change', handleFileSelection);

  sampleSelect.addEventListener('change', (event) => {
    const value = event.target.value;
    if (value) {
      loadSample(value);
      renderDiagram({ openWindow: false });
    }
  });

  window.addEventListener('resize', () => {
    if (panZoomInstance) {
      panZoomInstance.resize();
      panZoomInstance.fit();
      panZoomInstance.center();
    }
  });

  // Set initial content and render once.
  loadSample('flow');
  renderDiagram({ openWindow: false });
})();
