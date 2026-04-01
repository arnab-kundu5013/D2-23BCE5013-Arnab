const API = 'http://localhost:3001/api';

// -- state --
let currentPage = 1;
let totalPages = 1;
let selectedFiles = [];  // for upload
let pollingTimers = {};   // fileId -> intervalId
let imgSearchFile = null; // selected image for search


document.addEventListener('DOMContentLoaded', function () {
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            switchTab(btn.dataset.tab);
        });
    });

    // drag-drop setup for upload zone
    setupDropZone('drop-zone', 'file-input', handleFilesSelected);
    setupDropZone('img-drop-zone', 'img-search-input', handleImageSelected);

    // file input change listeners
    document.getElementById('file-input').addEventListener('change', function (e) {
        handleFilesSelected(e.target.files);
    });
    document.getElementById('img-search-input').addEventListener('change', function (e) {
        handleImageSelected(e.target.files);
    });

    // load dashboard on start
    loadDashboard();
});

function switchTab(tabName) {
    // hide all tabs
    document.querySelectorAll('.tab-page').forEach(function (el) {
        el.classList.remove('active');
    });
    // deactivate all nav btns
    document.querySelectorAll('.nav-btn').forEach(function (el) {
        el.classList.remove('active');
    });

    // show selected tab
    var tabEl = document.getElementById('tab-' + tabName);
    if (tabEl) tabEl.classList.add('active');

    var navEl = document.getElementById('nav-' + tabName);
    if (navEl) navEl.classList.add('active');

    // load data when switching to certain tabs
    if (tabName === 'dashboard') loadDashboard();
    if (tabName === 'files') loadFiles();
    if (tabName === 'links') loadLinks();
}


// ============================
// Toast notifications
// ============================

function showToast(message, type) {
    // type = 'error' | 'success' | 'info'
    type = type || 'info';
    var container = document.getElementById('toast-container');
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);

    // auto remove after 4s
    setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px)';
        toast.style.transition = 'all 0.3s';
        setTimeout(function () { toast.remove(); }, 300);
    }, 4000);
}


// ============================
// API helpers
// ============================

async function apiGet(path) {
    try {
        var resp = await fetch(API + path);
        if (!resp.ok) {
            var errBody = await resp.json().catch(function () { return {}; });
            throw new Error(errBody.message || 'Request failed: ' + resp.status);
        }
        return await resp.json();
    } catch (err) {
        console.error('GET ' + path + ' failed:', err);
        throw err;
    }
}

async function apiPost(path, body) {
    try {
        var resp = await fetch(API + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!resp.ok) {
            var errBody = await resp.json().catch(function () { return {}; });
            throw new Error(errBody.message || 'Request failed: ' + resp.status);
        }
        return await resp.json();
    } catch (err) {
        console.error('POST ' + path + ' failed:', err);
        throw err;
    }
}

async function apiDelete(path) {
    try {
        var resp = await fetch(API + path, { method: 'DELETE' });
        if (!resp.ok) {
            var errBody = await resp.json().catch(function () { return {}; });
            throw new Error(errBody.message || 'Delete failed: ' + resp.status);
        }
        return await resp.json();
    } catch (err) {
        console.error('DELETE ' + path + ' failed:', err);
        throw err;
    }
}

async function apiPostForm(path, formData) {
    try {
        var resp = await fetch(API + path, {
            method: 'POST',
            body: formData
        });
        if (!resp.ok) {
            var errBody = await resp.json().catch(function () { return {}; });
            throw new Error(errBody.message || 'Upload failed: ' + resp.status);
        }
        return await resp.json();
    } catch (err) {
        console.error('POST FORM ' + path + ' failed:', err);
        throw err;
    }
}


// ============================
// Drag & Drop setup
// ============================

function setupDropZone(zoneId, inputId, handler) {
    var zone = document.getElementById(zoneId);
    if (!zone) return;

    zone.addEventListener('dragover', function (e) {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', function (e) {
        e.preventDefault();
        zone.classList.remove('dragover');
    });
    zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handler(e.dataTransfer.files);
        }
    });
}


// ============================
// UPLOAD
// ============================

function handleFilesSelected(files) {
    if (!files || files.length === 0) return;
    selectedFiles = Array.from(files);
    var countEl = document.getElementById('selected-count');
    countEl.textContent = selectedFiles.length + ' file(s) selected';
    document.getElementById('btn-upload').disabled = false;
}

async function startUpload() {
    if (selectedFiles.length === 0) return;

    var btn = document.getElementById('btn-upload');
    btn.disabled = true;
    btn.textContent = 'Uploading...';

    var desc = document.getElementById('upload-desc').value.trim();
    var tags = document.getElementById('upload-tags').value.trim();

    var formData = new FormData();
    for (var i = 0; i < selectedFiles.length; i++) {
        formData.append('files', selectedFiles[i]);
    }
    if (desc) formData.append('description', desc);
    if (tags) formData.append('tags', tags);

    try {
        var result = await apiPostForm('/ingest', formData);
        showToast(result.message, 'success');

        // show progress cards and start polling
        var progressArea = document.getElementById('upload-progress');
        result.files.forEach(function (f) {
            var card = document.createElement('div');
            card.className = 'progress-card';
            card.id = 'progress-' + f.fileId;
            card.innerHTML = '<span class="pc-name">' + escapeHtml(f.originalName) + '</span>' +
                '<span class="pc-status queued">' + f.status + '</span>';
            progressArea.prepend(card);

            // start polling this file's status
            startPolling(f.fileId);
        });

        // reset form
        selectedFiles = [];
        document.getElementById('file-input').value = '';
        document.getElementById('selected-count').textContent = '';
        document.getElementById('upload-desc').value = '';
        document.getElementById('upload-tags').value = '';
    } catch (err) {
        showToast('Upload error: ' + err.message, 'error');
    }

    btn.disabled = false;
    btn.textContent = 'Upload Selected Files';
}

function startPolling(fileId) {
    // poll every 2 seconds
    pollingTimers[fileId] = setInterval(async function () {
        try {
            var data = await apiGet('/ingest/' + fileId + '/status');
            updateProgressCard(fileId, data);

            // stop polling when done
            if (data.status === 'completed' || data.status === 'failed') {
                clearInterval(pollingTimers[fileId]);
                delete pollingTimers[fileId];
            }
        } catch (e) {
            // stop polling on error
            clearInterval(pollingTimers[fileId]);
            delete pollingTimers[fileId];
        }
    }, 2000);
}

function updateProgressCard(fileId, data) {
    var card = document.getElementById('progress-' + fileId);
    if (!card) return;

    var statusEl = card.querySelector('.pc-status');
    statusEl.textContent = data.status;
    statusEl.className = 'pc-status ' + data.status;

    if (data.status === 'completed') {
        statusEl.textContent = 'completed (' + data.chunksIndexed + ' chunks)';
    }
    if (data.status === 'failed' && data.errorMessage) {
        statusEl.textContent = 'failed';
        statusEl.title = data.errorMessage;
    }
}


// ============================
// QUERY (with SSE streaming)
// ============================

async function submitQuery() {
    var input = document.getElementById('query-input');
    var query = input.value.trim();
    if (!query) {
        showToast('Please type a question', 'error');
        return;
    }

    // gather modalities
    var mods = [];
    if (document.getElementById('mod-text').checked) mods.push('text');
    if (document.getElementById('mod-image').checked) mods.push('image');
    if (document.getElementById('mod-audio').checked) mods.push('audio');

    if (mods.length === 0) {
        showToast('Select at least one modality', 'error');
        return;
    }

    // show answer area, clear previous
    var answerArea = document.getElementById('answer-area');
    answerArea.style.display = 'block';
    document.getElementById('answer-text').textContent = '';
    document.getElementById('citations-block').style.display = 'none';
    document.getElementById('citations-list').innerHTML = '';
    document.getElementById('context-block').style.display = 'none';
    document.getElementById('context-chunks').innerHTML = '';
    document.getElementById('context-chunks').style.display = 'none';
    document.getElementById('usage-info').style.display = 'none';

    var statusBadge = document.getElementById('query-status');
    statusBadge.textContent = 'streaming...';
    statusBadge.className = 'status-badge';

    var btn = document.getElementById('btn-query');
    btn.disabled = true;
    btn.textContent = 'Thinking...';

    try {
        // use fetch with streaming for SSE
        var resp = await fetch(API + '/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: query,
                modalities: mods,
                stream: true
            })
        });

        if (!resp.ok) {
            var errData = await resp.json().catch(function () { return {}; });
            throw new Error(errData.message || 'Query failed');
        }

        // read the SSE stream manually
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var answerTextEl = document.getElementById('answer-text');

        while (true) {
            var result = await reader.read();
            if (result.done) break;

            buffer += decoder.decode(result.value, { stream: true });

            // parse SSE events from buffer
            var lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete last line in buffer

            var eventName = '';
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (line.startsWith('event: ')) {
                    eventName = line.substring(7).trim();
                } else if (line.startsWith('data: ')) {
                    var dataStr = line.substring(6);
                    try {
                        var eventData = JSON.parse(dataStr);
                        handleSSEEvent(eventName, eventData);
                    } catch (parseErr) {
                        // ignore parse errors for partial data
                    }
                }
            }
        }

        statusBadge.textContent = 'done';
        statusBadge.className = 'status-badge done';

    } catch (err) {
        showToast('Query error: ' + err.message, 'error');
        statusBadge.textContent = 'error';
        statusBadge.className = 'status-badge';
        statusBadge.style.color = 'var(--red-ish)';
    }

    btn.disabled = false;
    btn.textContent = 'Search & Answer';
}

function handleSSEEvent(event, data) {
    switch (event) {
        case 'token':
            // append token to answer
            var answerEl = document.getElementById('answer-text');
            answerEl.textContent += data.text || '';
            // auto scroll
            answerEl.scrollTop = answerEl.scrollHeight;
            break;

        case 'context':
            // store context for later display
            if (data.results && data.results.length > 0) {
                var ctxBlock = document.getElementById('context-block');
                ctxBlock.style.display = 'block';
                var ctxChunks = document.getElementById('context-chunks');
                ctxChunks.innerHTML = '';

                data.results.forEach(function (r) {
                    var div = document.createElement('div');
                    div.className = 'ctx-chunk';
                    div.innerHTML = '<div class="ctx-meta">[' + (r.modality || '?') + '] score: ' + (r.score ? r.score.toFixed(4) : '—') + '</div>' +
                        '<div>' + escapeHtml(r.excerpt || '') + '</div>';
                    ctxChunks.appendChild(div);
                });
            }
            break;

        case 'citations':
            if (data.citations && data.citations.length > 0) {
                var citBlock = document.getElementById('citations-block');
                citBlock.style.display = 'block';
                var citList = document.getElementById('citations-list');
                citList.innerHTML = '';

                data.citations.forEach(function (c, idx) {
                    var li = document.createElement('li');
                    var fileName = c.fileName || c.file || c.metadata?.fileName || 'unknown';
                    var excerpt = c.excerpt || c.text || '';
                    li.innerHTML = '<span class="cite-idx">[' + (idx + 1) + ']</span>' +
                        '<span class="cite-file">' + escapeHtml(fileName) + '</span>' +
                        (excerpt ? '<span class="cite-excerpt">' + escapeHtml(excerpt.substring(0, 150)) + '…</span>' : '');
                    citList.appendChild(li);
                });
            }
            break;

        case 'done':
            if (data.usage) {
                var usageEl = document.getElementById('usage-info');
                usageEl.style.display = 'block';
                usageEl.textContent = 'Chunks used: ' + (data.usage.contextChunks || 0) +
                    (data.usage.droppedChunks ? ' | Dropped: ' + data.usage.droppedChunks : '') +
                    (data.usage.responseLength ? ' | Response length: ' + data.usage.responseLength : '');
            }
            break;

        case 'error':
            showToast('Stream error: ' + (data.message || 'Unknown'), 'error');
            break;
    }
}

function toggleContext() {
    var chunks = document.getElementById('context-chunks');
    var btn = document.querySelector('#context-block .toggle-btn');
    if (chunks.style.display === 'none') {
        chunks.style.display = 'flex';
        btn.textContent = '▾ Hide retrieved chunks';
    } else {
        chunks.style.display = 'none';
        btn.textContent = '▸ Show retrieved chunks';
    }
}


// ============================
// IMAGE SEARCH
// ============================

function handleImageSelected(files) {
    if (!files || files.length === 0) return;
    imgSearchFile = files[0];

    // show preview
    var previewBox = document.getElementById('img-preview-box');
    var previewImg = document.getElementById('img-preview');
    previewBox.style.display = 'flex';

    var reader = new FileReader();
    reader.onload = function (e) {
        previewImg.src = e.target.result;
    };
    reader.readAsDataURL(imgSearchFile);

    document.getElementById('btn-img-search').disabled = false;
    // hide the drop zone
    document.getElementById('img-drop-zone').style.display = 'none';
}

function clearImageSearch() {
    imgSearchFile = null;
    document.getElementById('img-preview-box').style.display = 'none';
    document.getElementById('img-preview').src = '';
    document.getElementById('btn-img-search').disabled = true;
    document.getElementById('img-drop-zone').style.display = '';
    document.getElementById('img-search-input').value = '';
    document.getElementById('img-search-results').style.display = 'none';
}

async function submitImageSearch() {
    if (!imgSearchFile) return;

    var btn = document.getElementById('btn-img-search');
    btn.disabled = true;
    btn.textContent = 'Searching...';

    var formData = new FormData();
    formData.append('file', imgSearchFile);

    try {
        var data = await apiPostForm('/query/image', formData);

        // show results
        var resultsArea = document.getElementById('img-search-results');
        resultsArea.style.display = 'block';

        // caption
        var captionEl = document.getElementById('img-caption-display');
        if (data.caption) {
            captionEl.innerHTML = '<strong>AI Caption:</strong> ' + escapeHtml(data.caption);
            captionEl.style.display = 'block';
        } else {
            captionEl.style.display = 'none';
        }

        // text results
        renderImageResults('img-res-text', data.results?.text || [], 'excerpt');
        renderImageResults('img-res-image', data.results?.image || [], 'caption');
        renderImageResults('img-res-audio', data.results?.audio || [], 'transcript');

    } catch (err) {
        showToast('Image search error: ' + err.message, 'error');
    }

    btn.disabled = false;
    btn.textContent = 'Search';
}

function renderImageResults(containerId, items, textKey) {
    var container = document.getElementById(containerId);
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = '<p class="no-results-msg">No matches found</p>';
        return;
    }

    items.forEach(function (item) {
        var div = document.createElement('div');
        div.className = 'result-item';
        div.innerHTML = '<div class="ri-score">Score: ' + (item.score != null ? item.score.toFixed(4) : '—') + '</div>' +
            '<div class="ri-text">' + escapeHtml(item[textKey] || item.excerpt || item.caption || item.transcript || '') + '</div>' +
            '<div class="ri-meta">' + (item.metadata?.fileName || item.metadata?.originalName || '') + '</div>';
        container.appendChild(div);
    });
}


// ============================
// FILES
// ============================

async function loadFiles() {
    var typeFilter = document.getElementById('filter-type').value;
    var statusFilter = document.getElementById('filter-status').value;

    var params = '?page=' + currentPage + '&limit=15';
    if (typeFilter) params += '&type=' + typeFilter;
    if (statusFilter) params += '&status=' + statusFilter;

    var tbody = document.getElementById('files-tbody');

    try {
        var data = await apiGet('/files' + params);
        totalPages = data.pagination.totalPages || 1;
        currentPage = data.pagination.page;

        tbody.innerHTML = '';

        if (data.files.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="muted-text">No files found</td></tr>';
            document.getElementById('pagination-bar').innerHTML = '';
            return;
        }

        data.files.forEach(function (f) {
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td class="file-name-cell" onclick="openFileDetail(\'' + f.id + '\')" title="' + escapeHtml(f.originalName) + '">' + escapeHtml(f.originalName) + '</td>' +
                '<td><span class="file-type-badge ' + f.fileType + '">' + f.fileType + '</span></td>' +
                '<td>' + formatBytes(f.sizeBytes) + '</td>' +
                '<td><span class="pc-status ' + f.status + '">' + f.status + '</span></td>' +
                '<td>' + (f.chunksIndexed || 0) + '</td>' +
                '<td>' + formatDate(f.createdAt) + '</td>' +
                '<td class="action-btns">' +
                '<button onclick="downloadFile(\'' + f.id + '\', \'' + escapeHtml(f.originalName) + '\')" title="Download">⬇</button>' +
                '<button class="del-btn" onclick="deleteFile(\'' + f.id + '\', \'' + escapeHtml(f.originalName) + '\')" title="Delete">🗑</button>' +
                '</td>';
            tbody.appendChild(tr);
        });

        renderPagination();

    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" class="muted-text">Error loading files: ' + escapeHtml(err.message) + '</td></tr>';
    }
}

function renderPagination() {
    var bar = document.getElementById('pagination-bar');
    bar.innerHTML = '';

    if (totalPages <= 1) return;

    // prev
    if (currentPage > 1) {
        var prevBtn = document.createElement('button');
        prevBtn.textContent = '← Prev';
        prevBtn.onclick = function () { currentPage--; loadFiles(); };
        bar.appendChild(prevBtn);
    }

    // page numbers (show up to 5 pages around current)
    var startP = Math.max(1, currentPage - 2);
    var endP = Math.min(totalPages, currentPage + 2);

    for (var p = startP; p <= endP; p++) {
        var pageBtn = document.createElement('button');
        pageBtn.textContent = p;
        if (p === currentPage) pageBtn.className = 'active-page';
        pageBtn.dataset.page = p;
        pageBtn.onclick = function () { currentPage = parseInt(this.dataset.page); loadFiles(); };
        bar.appendChild(pageBtn);
    }

    // next
    if (currentPage < totalPages) {
        var nextBtn = document.createElement('button');
        nextBtn.textContent = 'Next →';
        nextBtn.onclick = function () { currentPage++; loadFiles(); };
        bar.appendChild(nextBtn);
    }

    // info
    var info = document.createElement('span');
    info.className = 'page-info';
    info.textContent = ' Page ' + currentPage + ' of ' + totalPages;
    bar.appendChild(info);
}

function downloadFile(fileId, fileName) {
    // trigger download via a hidden link
    var a = document.createElement('a');
    a.href = API + '/files/' + fileId + '/download';
    a.download = fileName || 'file';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function deleteFile(fileId, fileName) {
    if (!confirm('Delete "' + fileName + '"? This cannot be undone.')) return;

    try {
        var data = await apiDelete('/files/' + fileId);
        showToast(data.message || 'File deleted', 'success');
        closeDetail();
        loadFiles(); // refresh list
    } catch (err) {
        showToast('Delete error: ' + err.message, 'error');
    }
}

async function openFileDetail(fileId) {
    var panel = document.getElementById('file-detail-panel');
    panel.style.display = 'block';

    document.getElementById('detail-filename').textContent = 'Loading...';
    document.getElementById('detail-body').innerHTML = '';
    document.getElementById('detail-chunks-list').innerHTML = '<p class="muted-text">Loading chunks...</p>';

    try {
        var file = await apiGet('/files/' + fileId);

        document.getElementById('detail-filename').textContent = file.originalName;

        var bodyHtml = '';
        bodyHtml += detailRow('File ID', file.id);
        bodyHtml += detailRow('Type', file.fileType);
        bodyHtml += detailRow('MIME', file.mimeType);
        bodyHtml += detailRow('Size', formatBytes(file.sizeBytes));
        bodyHtml += detailRow('Status', file.status);
        bodyHtml += detailRow('Chunks', file.chunksIndexed);
        if (file.description) bodyHtml += detailRow('Description', file.description);
        if (file.tags && file.tags.length > 0) bodyHtml += detailRow('Tags', file.tags.join(', '));
        if (file.errorMessage) bodyHtml += detailRow('Error', file.errorMessage);
        bodyHtml += detailRow('Uploaded', formatDate(file.createdAt));
        bodyHtml += detailRow('Updated', formatDate(file.updatedAt));

        // action buttons
        bodyHtml += '<div class="detail-actions">' +
            '<button class="small-btn" onclick="downloadFile(\'' + file.id + '\', \'' + escapeHtml(file.originalName) + '\')">⬇ Download</button>' +
            '<button class="small-btn" onclick="deleteFile(\'' + file.id + '\', \'' + escapeHtml(file.originalName) + '\')">🗑 Delete</button>' +
            '</div>';

        document.getElementById('detail-body').innerHTML = bodyHtml;

        // now load chunks
        loadFileChunks(fileId);

    } catch (err) {
        document.getElementById('detail-filename').textContent = 'Error';
        document.getElementById('detail-body').innerHTML = '<p class="muted-text">' + escapeHtml(err.message) + '</p>';
    }
}

async function loadFileChunks(fileId) {
    var chunksList = document.getElementById('detail-chunks-list');
    try {
        var data = await apiGet('/files/' + fileId + '/chunks');

        chunksList.innerHTML = '';
        if (data.chunks.length === 0) {
            chunksList.innerHTML = '<p class="muted-text">No chunks indexed yet</p>';
            return;
        }

        data.chunks.forEach(function (chunk, idx) {
            var div = document.createElement('div');
            div.className = 'chunk-item';
            div.innerHTML = '<div class="chunk-id">Chunk ' + (idx + 1) + ' — ' + (chunk.id || '') + '</div>' +
                '<div>' + escapeHtml((chunk.text || '').substring(0, 400)) + (chunk.text && chunk.text.length > 400 ? '…' : '') + '</div>';
            chunksList.appendChild(div);
        });
    } catch (err) {
        chunksList.innerHTML = '<p class="muted-text">Could not load chunks: ' + escapeHtml(err.message) + '</p>';
    }
}

function closeDetail() {
    document.getElementById('file-detail-panel').style.display = 'none';
}

function detailRow(label, value) {
    return '<div class="detail-row"><span class="dr-label">' + label + '</span><span class="dr-value">' + escapeHtml(String(value != null ? value : '—')) + '</span></div>';
}


// ============================
// DASHBOARD — stats & health
// ============================

async function loadDashboard() {
    // load stats
    try {
        var stats = await apiGet('/files/stats');

        document.getElementById('stat-total-files').textContent = stats.totalFiles || 0;
        document.getElementById('stat-disk-usage').textContent = (stats.totalSizeMB || 0) + ' MB';
        document.getElementById('stat-chunks').textContent = stats.totalChunksIndexed || 0;
        document.getElementById('stat-links').textContent = stats.crossModalLinks || 0;

        // file type breakdown
        var breakdownEl = document.getElementById('file-type-breakdown');
        breakdownEl.innerHTML = '';
        var types = stats.byFileType || {};
        var typeKeys = Object.keys(types);

        if (typeKeys.length === 0) {
            breakdownEl.innerHTML = '<p class="muted-text">No files ingested yet</p>';
        } else {
            typeKeys.forEach(function (t) {
                var info = types[t];
                var chip = document.createElement('div');
                chip.className = 'type-chip';
                chip.innerHTML = '<div class="chip-label">' + t.toUpperCase() + '</div>' +
                    '<div class="chip-val">' + info.count + ' files</div>' +
                    '<div class="chip-extra">' + formatBytes(info.totalSize) + ' · ' + info.totalChunks + ' chunks</div>';
                breakdownEl.appendChild(chip);
            });
        }

        // vector collection counts
        var vecEl = document.getElementById('vector-counts');
        vecEl.innerHTML = '';
        var vecs = stats.vectorCollections || {};

        var vecCard1 = createVecCard('Text Chunks', vecs.text_chunks || 0, '');
        var vecCard2 = createVecCard('Image Metadata', vecs.image_metadata || 0, 'img-vec');
        var vecCard3 = createVecCard('Audio Segments', vecs.audio_segments || 0, 'aud-vec');
        vecEl.appendChild(vecCard1);
        vecEl.appendChild(vecCard2);
        vecEl.appendChild(vecCard3);

    } catch (err) {
        document.getElementById('stat-total-files').textContent = '!';
        document.getElementById('stat-disk-usage').textContent = '!';
        document.getElementById('stat-chunks').textContent = '!';
        document.getElementById('stat-links').textContent = '!';
        document.getElementById('file-type-breakdown').innerHTML = '<p class="muted-text">Could not load stats: ' + escapeHtml(err.message) + '</p>';
    }

    // load health
    loadHealth();
}

function createVecCard(name, count, extraClass) {
    var div = document.createElement('div');
    div.className = 'vec-card ' + (extraClass || '');
    div.innerHTML = '<div class="vec-name">' + name + '</div><div class="vec-count">' + count + '</div>';
    return div;
}

async function loadHealth() {
    var panel = document.getElementById('health-panel');
    var dot = document.getElementById('health-dot');

    try {
        var data = await apiGet('/health');

        dot.className = 'health-indicator ' + (data.status === 'ok' ? 'ok' : 'degraded');
        dot.title = 'System: ' + data.status;

        panel.innerHTML = '';
        var services = data.services || {};
        var svcNames = Object.keys(services);

        svcNames.forEach(function (name) {
            var svc = services[name];
            var card = document.createElement('div');
            card.className = 'health-card';

            var dotClass = svc.status === 'ok' ? 'ok' : 'degraded';
            var latencyStr = svc.latencyMs != null ? svc.latencyMs + 'ms' : '';
            var errStr = svc.error ? svc.error : '';

            card.innerHTML = '<span class="h-dot ' + dotClass + '"></span>' +
                '<div class="h-info">' +
                '<span class="h-name">' + capitalize(name) + '</span>' +
                (latencyStr ? '<span class="h-latency">' + latencyStr + '</span>' : '') +
                (errStr ? '<span class="h-err">' + escapeHtml(errStr) + '</span>' : '') +
                '</div>';
            panel.appendChild(card);
        });

    } catch (err) {
        dot.className = 'health-indicator error';
        dot.title = 'Cannot reach backend';
        panel.innerHTML = '<p class="muted-text">Backend unreachable: ' + escapeHtml(err.message) + '</p>';
    }
}


// ============================
// LINKS
// ============================

async function loadLinks() {
    var tbody = document.getElementById('links-tbody');

    try {
        var data = await apiGet('/files/links');

        tbody.innerHTML = '';

        if (!data.links || data.links.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="muted-text">No cross-modal links discovered yet</td></tr>';
            return;
        }

        data.links.forEach(function (link) {
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td class="file-name-cell" onclick="openFileDetail(\'' + link.sourceFileId + '\')">' + (link.sourceFileId || '—') + '</td>' +
                '<td class="file-name-cell" onclick="openFileDetail(\'' + link.targetFileId + '\')">' + (link.targetFileId || '—') + '</td>' +
                '<td>' + escapeHtml(link.linkType || '—') + '</td>' +
                '<td>' + (link.confidence != null ? (link.confidence * 100).toFixed(1) + '%' : '—') + '</td>' +
                '<td>' + formatDate(link.createdAt) + '</td>';
            tbody.appendChild(tr);
        });

    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted-text">Error: ' + escapeHtml(err.message) + '</td></tr>';
    }
}


// ============================
// Utility functions
// ============================

function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatBytes(bytes) {
    if (bytes == null || bytes === 0) return '0 B';
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    if (i >= sizes.length) i = sizes.length - 1;
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
        var d = new Date(dateStr);
        // simple format: "Mar 15, 2:30 PM"
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
            ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
        return dateStr;
    }
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}
