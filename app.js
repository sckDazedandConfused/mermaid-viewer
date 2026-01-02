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
    flowchart: { useMaxWidth: true, htmlLabels: true },
    sequence: { useMaxWidth: true, htmlLabels: true }
  });

  let panZoomInstance = null;
  let lastLoadedFileName = '';
  let lastLoadedExtension = '';

  const escapeHtml = (value) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const stripControlChars = (value) =>
    value
      .replace(/\uFEFF/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  const normalizeMermaidLabels = (definition) => {
    if (!definition) return '';
    const escapeBracketsInQuotes = (value) => {
      const escape = (segment) =>
        segment.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');

      let updated = value.replace(/"[^"]*"/g, (match) => {
        const inner = match.slice(1, -1);
        return `"${escape(inner)}"`;
      });
      updated = updated.replace(/'[^']*'/g, (match) => {
        const inner = match.slice(1, -1);
        return `'${escape(inner)}'`;
      });
      return updated;
    };

    let normalized = escapeBracketsInQuotes(definition);

    const quotePipeLabel = (match, content) => {
      const trimmed = content.trim();
      if (!trimmed) return match;
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
          (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return match;
      }
      const escaped = content.replace(/"/g, '\\"');
      return `|"${escaped}"|`;
    };

    const quoteBracketLabel = (match, content) => {
      const trimmed = content.trim();
      if (!trimmed) return match;
      if (content.includes('[') || content.includes(']')) return match;
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
          (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
          trimmed.startsWith('[')) {
        return match;
      }
      const escaped = content.replace(/"/g, '\\"');
      return `["${escaped}"]`;
    };

    normalized = normalized.replace(/\|([^|\n]+)\|/g, quotePipeLabel);
    normalized = normalized.replace(/\[([^\]\n]+)\]/g, quoteBracketLabel);
    return normalized;
  };

  const renderMermaidSvg = async (id, source, { normalizeOnFail = true } = {}) => {
    const cleaned = cleanMermaidDefinition(stripControlChars(source));
    try {
      return await mermaid.render(id, cleaned);
    } catch (err) {
      if (!normalizeOnFail) {
        throw err;
      }
      const normalized = normalizeMermaidLabels(cleaned);
      return await mermaid.render(id, normalized);
    }
  };

  const preserveLineBreakTags = (value) =>
    value.replace(/<br\s*\/?>/gi, '[[BR]]');

  const restoreLineBreakTags = (value) =>
    value.replace(/\[\[BR\]\]/g, '<br/>');

  const formatInlineMarkdown = (value) => {
    let safe = escapeHtml(preserveLineBreakTags(value));
    const codeSpans = [];
    safe = safe.replace(/`([^`]+)`/g, (_match, code) => {
      const token = `%%CODE${codeSpans.length}%%`;
      codeSpans.push(code);
      return token;
    });

    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    safe = restoreLineBreakTags(safe);

    codeSpans.forEach((code, index) => {
      safe = safe.replace(`%%CODE${index}%%`, `<code>${code}</code>`);
    });

    return safe;
  };

  const formatParagraph = (lines) => {
    const parts = lines.map((line) => {
      const hasBreak = /\s{2}$/.test(line);
      const trimmed = line.replace(/\s{2}$/, '');
      const formatted = formatInlineMarkdown(trimmed);
      return hasBreak ? `${formatted}<br/>` : formatted;
    });
    return `<p>${parts.join(' ')}</p>`;
  };

  const renderMarkdownToHtml = (markdown) => {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    let html = '';
    let i = 0;

    const isBlockStart = (line) => {
      if (!line) return false;
      if (/^```/.test(line)) return true;
      if (/^#{1,6}\s+/.test(line)) return true;
      if (/^(\s*)(---+|\*\*\*+|___+)\s*$/.test(line)) return true;
      if (/^\s*>\s?/.test(line)) return true;
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) return true;
      return false;
    };

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim() === '') {
        i += 1;
        continue;
      }

      const fenceMatch = line.match(/^```(\w+)?\s*$/);
      if (fenceMatch) {
        const lang = fenceMatch[1] || '';
        const codeLines = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i])) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        const code = escapeHtml(codeLines.join('\n'));
        html += `<pre><code${lang ? ` class="language-${lang}"` : ''}>${code}</code></pre>`;
        continue;
      }

      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        html += `<h${level}>${formatInlineMarkdown(headingMatch[2].trim())}</h${level}>`;
        i += 1;
        continue;
      }

      if (/^(\s*)(---+|\*\*\*+|___+)\s*$/.test(line)) {
        html += '<hr/>';
        i += 1;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        html += `<blockquote>${formatParagraph(quoteLines)}</blockquote>`;
        continue;
      }

      const listMatch = line.match(/^\s*([-*+]|\d+[.)])\s+(.+)$/);
      if (listMatch) {
        const ordered = /\d+[.)]/.test(listMatch[1]);
        const items = [];
        while (i < lines.length) {
          const current = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.+)$/);
          if (!current) break;
          items.push(current[2]);
          i += 1;
        }
        const tag = ordered ? 'ol' : 'ul';
        html += `<${tag}>${items.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join('')}</${tag}>`;
        continue;
      }

      const paragraphLines = [];
      while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
        paragraphLines.push(lines[i]);
        i += 1;
      }
      html += formatParagraph(paragraphLines);
    }

    return html;
  };

  const splitMarkdownBlocks = (markdown) => {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let buffer = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (/^```\s*mermaid\s*$/i.test(line)) {
        if (buffer.length) {
          blocks.push({ type: 'markdown', content: buffer.join('\n') });
          buffer = [];
        }
        i += 1;
        const mermaidLines = [];
        while (i < lines.length && !/^```/.test(lines[i])) {
          mermaidLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        blocks.push({ type: 'mermaid', content: mermaidLines.join('\n') });
        continue;
      }
      buffer.push(line);
      i += 1;
    }

    if (buffer.length) {
      blocks.push({ type: 'markdown', content: buffer.join('\n') });
    }

    return blocks;
  };

  const resolveRenderMode = (raw, definition) => {
    const ext = (lastLoadedExtension || '').toLowerCase();
    if (ext === 'mmd' || ext === 'mermaid') return 'mermaid';
    if (ext === 'md' || ext === 'markdown') {
      if (definition && isPureMermaidInput(raw, definition)) return 'mermaid';
      return 'markdown';
    }
    if (definition && isPureMermaidInput(raw, definition)) return 'mermaid';
    return 'markdown';
  };

  const isPureMermaidInput = (raw, definition) => {
    if (!definition) return false;
    if (/```\s*mermaid/i.test(raw)) {
      const remainder = raw.replace(/```\s*mermaid[\s\S]*?```/gi, '').trim();
      return remainder.length === 0;
    }
    const sliced = sliceFromMermaidStart(raw);
    if (!sliced) return false;
    const prefix = raw.slice(0, raw.indexOf(sliced));
    return prefix.trim().length === 0;
  };

  const sliceFromMermaidStart = (raw) => {
    const lines = raw.split(/\r?\n/);
    const starterPattern = /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline)\b/i;
    const startIndex = lines.findIndex((line) => starterPattern.test(line));
    if (startIndex === -1) return null;
    return lines.slice(startIndex).join('\n');
  };

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
    const fencedMatch = raw.match(/```\s*mermaid\s*([\s\S]*?)```/i);
    if (fencedMatch) {
      return cleanMermaidDefinition(fencedMatch[1]);
    }

    // Otherwise, try to detect by leading keyword; if not at top, slice from first starter line
    const sliced = sliceFromMermaidStart(raw);
    const cleaned = cleanMermaidDefinition(sliced || raw);
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

  const renderMarkdownWithMermaid = async (markdown) => {
    destroyPanZoom();
    diagram.innerHTML = '';

    const blocks = splitMarkdownBlocks(markdown);
    const mermaidBlocks = [];
    let html = '';
    let index = 0;

    blocks.forEach((block) => {
      if (block.type === 'markdown') {
        html += renderMarkdownToHtml(block.content);
      } else {
        const id = `mermaid-inline-${Date.now()}-${index++}`;
        mermaidBlocks.push({ id, code: block.content });
        html += `<div class="embedded-mermaid" data-mermaid-id="${id}"></div>`;
      }
    });

    if (!html.trim()) {
      html = '<p class="markdown-empty">No content to render.</p>';
    }

    diagram.innerHTML = `<div class="markdown-body">${html}</div>`;

    let errorCount = 0;
    for (const block of mermaidBlocks) {
      const host = diagram.querySelector(`[data-mermaid-id="${block.id}"]`);
      if (!host) continue;
      try {
        const { svg } = await renderMermaidSvg(block.id, block.code, { normalizeOnFail: true });
        host.innerHTML = svg;
      } catch (err) {
        errorCount += 1;
        host.innerHTML = `<div class="render-error">Mermaid error: ${escapeHtml(err.message)}</div>`;
      }
    }

    if (errorCount > 0) {
      setStatus(`Rendered markdown with ${errorCount} Mermaid error(s).`, true);
    } else {
      setStatus('Rendered markdown.');
    }
  };

  const renderDiagram = async ({ openWindow = false } = {}) => {
    const rawInput = textarea.value || '';
    const sanitizedInput = stripControlChars(rawInput);
    const definition = extractMermaidDefinition(sanitizedInput);
    const renderMode = resolveRenderMode(sanitizedInput, definition);

    if (!rawInput.trim()) {
      setStatus('Please provide content to render.', true);
      return;
    }

    if (renderMode === 'markdown') {
      await renderMarkdownWithMermaid(sanitizedInput);
      return;
    }

    const mermaidSource = definition || cleanMermaidDefinition(sanitizedInput);

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

    destroyPanZoom();
    diagram.innerHTML = '';
    setStatus('Rendering diagram...');

    try {
      const { svg } = await renderMermaidSvg('mermaid-diagram-' + Date.now(), mermaidSource, { normalizeOnFail: true });
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
      lastLoadedFileName = `sample:${key}`;
      lastLoadedExtension = 'mmd';
    }
  };

  const promptOpenFile = () => {
    filePicker.click();
  };

  const handleFileSelection = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    lastLoadedFileName = file.name;
    const parts = file.name.split('.');
    lastLoadedExtension = parts.length > 1 ? parts.pop().toLowerCase() : '';
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
