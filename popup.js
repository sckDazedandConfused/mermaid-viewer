(() => {
  const statusEl = document.getElementById('statusPopup');
  const saveBtn = document.getElementById('saveBtn');
  const closeBtn = document.getElementById('closeBtn');
  const container = document.getElementById('popupDiagram');
  let panZoomInstance = null;
  let latestSvgMarkup = '';
  let panZoomReady = false;

  const setStatus = (msg, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#f87171' : '#9ca3af';
  };

  const waitForPanZoom = () => new Promise((resolve) => {
    if (window.svgPanZoom) {
      panZoomReady = true;
      resolve();
      return;
    }
    const script = document.querySelector('script[src*="svg-pan-zoom"]');
    if (script) {
      script.addEventListener('load', () => {
        panZoomReady = true;
        resolve();
      }, { once: true });
      return;
    }
    const check = setInterval(() => {
      if (window.svgPanZoom) {
        clearInterval(check);
        panZoomReady = true;
        resolve();
      }
    }, 50);
    setTimeout(() => {
      clearInterval(check);
      resolve();
    }, 2000);
  });

  const normalizeSvg = (svgElement) => {
    const widthAttr = svgElement.getAttribute('width');
    const heightAttr = svgElement.getAttribute('height');
    const styleAttr = svgElement.getAttribute('style') || '';
    if (styleAttr) {
      const cleaned = styleAttr.replace(/max-width\s*:\s*[^;]+;?/gi, '');
      svgElement.setAttribute('style', cleaned);
    }
    svgElement.style.maxWidth = 'none';
    if (!svgElement.getAttribute('viewBox')) {
      const width = parseFloat(widthAttr);
      const height = parseFloat(heightAttr);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
      } else {
        try {
          const bbox = svgElement.getBBox();
          if (bbox && bbox.width && bbox.height) {
            svgElement.setAttribute('viewBox', `0 0 ${bbox.width} ${bbox.height}`);
          }
        } catch (err) {
          // Ignore if bbox isn't available yet.
        }
      }
    }
    svgElement.removeAttribute('width');
    svgElement.removeAttribute('height');
    svgElement.style.width = '100%';
    svgElement.style.height = '100%';
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  };

  const applyPanZoom = async (svgElement) => {
    if (!panZoomReady) {
      await waitForPanZoom();
    }
    if (!window.svgPanZoom) return;
    if (panZoomInstance) {
      panZoomInstance.destroy();
    }
    panZoomInstance = window.svgPanZoom(svgElement, {
      controlIconsEnabled: true,
      zoomEnabled: true,
      panEnabled: true,
      mouseWheelZoomEnabled: true,
      preventMouseEventsDefault: true,
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

  const renderSvg = async (markup) => {
    latestSvgMarkup = markup || '';
    container.innerHTML = latestSvgMarkup;
    const svgElement = container.querySelector('svg');
    if (!svgElement) {
      setStatus('No SVG found to render.', true);
      return;
    }
    normalizeSvg(svgElement);
    await applyPanZoom(svgElement);
    setStatus('Scroll to zoom, drag to pan');
  };

  const savePng = async () => {
    try {
      const svgEl = container.querySelector('svg');
      if (!svgEl) {
        setStatus('No SVG to save.', true);
        return;
      }
      setStatus('Preparing PNG...');
      const clone = svgEl.cloneNode(true);
      // Remove any @import rules and external images to avoid taint.
      clone.querySelectorAll('style').forEach((node) => {
        node.textContent = node.textContent.replace(/@import[^;]+;/g, '');
      });
      clone.querySelectorAll('image').forEach((node) => {
        const href = node.getAttribute('href') || node.getAttribute('xlink:href');
        if (href && /^https?:\/\//i.test(href)) {
          node.removeAttribute('href');
          node.removeAttribute('xlink:href');
        }
      });
      const serializer = new XMLSerializer();
      const source = serializer.serializeToString(clone);
      const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
      const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
      const image = new Image();
      image.crossOrigin = 'anonymous';

      const pngBlob = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('PNG render timed out.')), 5000);
        image.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const viewBox = svgEl.viewBox && svgEl.viewBox.baseVal;
            const width = Math.max(1, (viewBox && viewBox.width) || svgEl.getBoundingClientRect().width || 1600);
            const height = Math.max(1, (viewBox && viewBox.height) || svgEl.getBoundingClientRect().height || 900);
            canvas.width = Math.round(width);
            canvas.height = Math.round(height);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#0b1020';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(image, 0, 0, width, height);
            canvas.toBlob((b) => {
              clearTimeout(timeout);
              return b ? resolve(b) : reject(new Error('PNG export failed.'));
            });
          } catch (err) {
            clearTimeout(timeout);
            reject(err);
          }
        };
        image.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('PNG export failed to load SVG.'));
        };
        image.src = svgDataUrl;
      }).catch((err) => {
        setStatus(err.message, true);
        return null;
      });

      if (!pngBlob) {
        // Fallback: offer raw SVG download
        const link = document.createElement('a');
        link.href = URL.createObjectURL(svgBlob);
        link.download = 'mermaid-diagram.svg';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
        return;
      }

      try {
        if (window.showSaveFilePicker) {
          const handle = await window.showSaveFilePicker({
            suggestedName: 'mermaid-diagram.png',
            types: [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(pngBlob);
          await writable.close();
        } else {
          const link = document.createElement('a');
          link.href = URL.createObjectURL(pngBlob);
          link.download = 'mermaid-diagram.png';
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(link.href);
        }
        setStatus('Saved PNG.');
      } catch (err) {
        // Fallback to direct download if picker failed.
        const link = document.createElement('a');
        link.href = URL.createObjectURL(pngBlob);
        link.download = 'mermaid-diagram.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
        setStatus('Saved PNG (fallback).');
      }
    } catch (err) {
      setStatus('Save failed: ' + err.message, true);
    }
  };

  const notifyReady = () => {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'popup-ready' }, '*');
    }
  };

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'render-svg') return;
    renderSvg(event.data.svg);
  });

  saveBtn.addEventListener('click', savePng);
  saveBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      savePng();
    }
  });
  saveBtn.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      savePng();
    }
  });
  closeBtn.addEventListener('click', () => window.close());

  window.addEventListener('resize', () => {
    if (panZoomInstance) {
      panZoomInstance.resize();
      panZoomInstance.fit();
      panZoomInstance.center();
    }
  });

  container.addEventListener('wheel', (event) => {
    if (!panZoomInstance) return;
    event.preventDefault();
  }, { passive: false });

  waitForPanZoom().finally(notifyReady);
})();
