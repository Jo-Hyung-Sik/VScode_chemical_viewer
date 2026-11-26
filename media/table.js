(function () {
  const vscode = acquireVsCodeApi();
  const status = document.getElementById('status');
  const thead = document.querySelector('#table thead');
  const tbody = document.querySelector('#table tbody');
  const sentinel = document.getElementById('sentinel');
  const tablePane = document.getElementById('tablePane');
  const structPane = document.getElementById('structPane');
  const grid = document.getElementById('grid');
  const gridSentinel = document.getElementById('gridSentinel');
  const alignBox = document.getElementById('align');
  function sendAlign() {
    scaffoldBox.classList.remove('invalid');
    pending = true;
    vscode.postMessage({
      type: 'align',
      on: alignBox.checked,
      smiles: scaffoldBox.value.trim(),
      stereo: stereoBox.checked,
    });
  }
  alignBox.addEventListener('change', sendAlign);
  const stereoBox = document.getElementById('stereo');
  stereoBox.addEventListener('change', sendAlign);
  const scaffoldBox = document.getElementById('scaffold');
  scaffoldBox.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (scaffoldBox.value.trim()) alignBox.checked = true; // entering a scaffold turns alignment on
    sendAlign();
  });
  let structCol = -1; // first structure column; feeds the structure pane on the right
  let selected = new Set(); // row numbers (as strings), so the selection survives a re-sort
  let anchor = null; // where a Shift-click range starts
  let note = ''; // edit/save state shown after the row count
  const deleteBtn = document.getElementById('deleteRow');

  // Clicking a table row or a structure card highlights both and scrolls the other one into view.
  // Cmd/Ctrl-click toggles a row, Shift-click selects the range from the last clicked row.
  function select(n, source, e) {
    const list = [...(source === tablePane ? tbody : grid).children].map((el) => el.dataset.n);
    const from = list.indexOf(anchor);
    if (e.shiftKey && from >= 0) {
      const to = list.indexOf(n);
      selected = new Set(list.slice(Math.min(from, to), Math.max(from, to) + 1));
    } else {
      if (!(e.metaKey || e.ctrlKey)) selected = new Set([n]);
      else if (!selected.delete(n)) selected.add(n);
      anchor = n;
    }
    deleteBtn.disabled = !selected.size;
    for (const el of [...tbody.children, ...grid.children]) {
      el.classList.toggle('selected', selected.has(el.dataset.n));
      if (el.dataset.n === n && !source.contains(el)) el.scrollIntoView({ block: 'nearest' });
    }
  }
  tablePane.addEventListener('click', (e) => {
    const tr = e.target.closest('tbody tr');
    if (tr) select(tr.dataset.n, tablePane, e);
  });
  // Shift-click would otherwise select the text between the two rows.
  tablePane.addEventListener('mousedown', (e) => {
    if (e.shiftKey && !e.target.isContentEditable) e.preventDefault();
  });
  // Drag the divider to resize the structure pane; the width is remembered for this editor tab.
  const splitter = document.getElementById('splitter');
  const savedWidth = (vscode.getState() || {}).structWidth;
  if (savedWidth) structPane.style.width = savedWidth;
  splitter.addEventListener('pointerdown', (e) => {
    splitter.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  splitter.addEventListener('pointermove', (e) => {
    if (!splitter.hasPointerCapture(e.pointerId)) return;
    const width = Math.min(Math.max(window.innerWidth - e.clientX, 120), window.innerWidth - 120);
    structPane.style.width = `${width}px`;
  });
  splitter.addEventListener('pointerup', () => vscode.setState({ structWidth: structPane.style.width }));

  // Which column captions the structures on the right; -1 means the row number.
  let labelCol = -1;
  const labelSelect = document.getElementById('labelCol');
  function pickLabelColumn() {
    // Same idea as DataWarrior's SD-file reader: prefer a name column, then an ID-like one.
    // Skip structure columns and the SMILES column each "Structure of X" column was drawn from.
    const names = columns.map((col, c) =>
      col.type === 'structure' || (c > 0 && columns[c - 1].name === `Structure of ${col.name}`) ? '' : col.name.trim(),
    );
    const tests = [/^(molecule[ _]?)?name$/i, /name|compound|compnd|title/i, /^id$|id(number)?$|_id\b|\bid\b|^no\.?$/i];
    for (const test of tests) {
      const c = names.findIndex((name) => test.test(name));
      if (c >= 0) return c;
    }
    return -1;
  }
  // Columns shown under each structure as "name: value" lines.
  let fields = new Set();
  const structSelect = document.getElementById('structCol');
  const fieldsBox = document.getElementById('fieldsBox');
  const fieldList = document.getElementById('fieldList');
  function fillSelectors() {
    labelSelect.textContent = structSelect.textContent = fieldList.textContent = '';
    fields = new Set();
    labelSelect.add(new Option('Row number', -1));
    columns.forEach((col, c) => {
      if (col.type === 'structure') return structSelect.add(new Option(col.name.replace(/^Structure of /, ''), c));
      labelSelect.add(new Option(col.name, c));
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = c;
      const label = document.createElement('label');
      label.append(box, col.name);
      fieldList.appendChild(label);
    });
    labelCol = pickLabelColumn();
    labelSelect.value = labelCol;
    // Only a file with several structure columns (a CSV with several SMILES columns) needs the choice.
    document.getElementById('structLabel').hidden = structSelect.length < 2;
  }
  labelSelect.addEventListener('change', () => {
    labelCol = Number(labelSelect.value);
    rebuildGrid();
  });
  structSelect.addEventListener('change', () => {
    structCol = Number(structSelect.value);
    rebuildGrid();
  });
  fieldList.addEventListener('change', () => {
    fields = new Set([...fieldList.querySelectorAll(':checked')].map((box) => Number(box.value)));
    rebuildGrid();
  });
  document.addEventListener('click', (e) => {
    if (!fieldsBox.contains(e.target)) fieldsBox.open = false;
  });

  // A structure card is built from its table row, so the table stays the single source of values.
  function cardFor(tr) {
    const svg = structCol >= 0 && tr.children[structCol + 1].querySelector('svg'); // +1 for the row-number cell
    if (!svg) return null;
    const n = tr.dataset.n;
    const text = (c) => tr.children[c + 1].textContent;
    const card = document.createElement('div');
    card.className = selected.has(n) ? 'card selected' : 'card';
    card.dataset.n = n;
    card.appendChild(svg.cloneNode(true));
    const label = document.createElement('span');
    label.textContent = label.title = (labelCol >= 0 && text(labelCol)) || n;
    card.appendChild(label);
    columns.forEach((col, c) => {
      if (!fields.has(c) || !text(c)) return;
      const line = document.createElement('div');
      line.textContent = line.title = `${col.name}: ${text(c)}`;
      card.appendChild(line);
    });
    return card;
  }
  function rebuildGrid() {
    grid.replaceChildren(...[...tbody.children].map(cardFor).filter(Boolean));
  }
  function refreshCard(n) {
    const tr = tbody.querySelector(`tr[data-n="${n}"]`);
    const old = grid.querySelector(`.card[data-n="${n}"]`);
    const card = tr && cardFor(tr);
    if (old && card) old.replaceWith(card);
    else if (old || card) rebuildGrid(); // the row gained or lost its structure
  }

  // Double-click a text cell to edit it: Enter or clicking away commits, Escape cancels.
  tbody.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td.editable');
    if (!td || td.isContentEditable) return;
    const before = td.textContent;
    td.contentEditable = 'plaintext-only';
    td.focus();
    const onKey = (ev) => {
      if (ev.key === 'Escape') td.textContent = before;
      if (ev.key === 'Escape' || (ev.key === 'Enter' && !ev.shiftKey)) {
        ev.preventDefault();
        td.blur();
      }
    };
    const finish = () => {
      td.removeEventListener('blur', finish);
      td.removeEventListener('keydown', onKey);
      td.contentEditable = 'false';
      if (td.textContent === before) return;
      vscode.postMessage({
        type: 'edit',
        n: Number(td.parentElement.dataset.n),
        column: Number(td.dataset.c),
        value: td.textContent,
      });
      note = ' • unsaved edits';
      updateStatus();
      refreshCard(td.parentElement.dataset.n);
    };
    td.addEventListener('blur', finish);
    td.addEventListener('keydown', onKey);
  });

  deleteBtn.addEventListener('click', () => {
    for (const n of selected) vscode.postMessage({ type: 'delete', n: Number(n) });
    for (const el of [...tbody.children, ...grid.children]) if (selected.has(el.dataset.n)) el.remove();
    total -= selected.size;
    loaded -= selected.size;
    selected = new Set();
    deleteBtn.disabled = true;
    note = ' • unsaved edits';
    updateStatus();
  });
  document.getElementById('saveAs').addEventListener('click', () => vscode.postMessage({ type: 'save' }));

  // A SMILES cell was edited: redraw that row's structure in the table and in the structure pane.
  function replaceStructure(n, column, svg) {
    const tr = tbody.querySelector(`tr[data-n="${n}"]`);
    if (!tr) return;
    const td = tr.children[column + 1]; // +1 for the row-number cell
    td.title = svg === null ? 'Structure could not be parsed' : '';
    if (svg === null) td.textContent = '?';
    else td.innerHTML = svg; // SVG generated by the extension host
    refreshCard(n);
  }

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) select(card.dataset.n, structPane, e);
  });

  let columns = [];
  let total = 0;
  let loaded = 0;
  let pending = false;
  let fileName = '';
  let sortState = { column: -1, direction: '' };

  function updateStatus() {
    status.textContent = `${fileName} — ${total} rows` + (loaded < total ? ` (showing ${loaded})` : '') + note;
  }

  function requestPage() {
    if (pending || loaded >= total) return;
    pending = true;
    vscode.postMessage({ type: 'page', offset: loaded });
  }

  // Column widths set by dragging a header's right edge, keyed by nth-child index so they also
  // apply to rows loaded later. Double-click the edge to go back to automatic width.
  let colWidths = {};
  const colStyle = document.head.appendChild(document.createElement('style'));
  function applyColWidths() {
    colStyle.textContent = Object.entries(colWidths)
      .map(([k, w]) => `#table th:nth-child(${k}),#table td:nth-child(${k}){box-sizing:border-box;width:${w}px;min-width:${w}px;max-width:${w}px}`)
      .join('');
  }
  function addGrip(th, child) {
    const grip = document.createElement('div');
    grip.className = 'grip';
    let startX = 0;
    let startWidth = 0;
    grip.addEventListener('click', (e) => e.stopPropagation()); // do not sort
    grip.addEventListener('pointerdown', (e) => {
      grip.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startWidth = th.getBoundingClientRect().width;
      e.preventDefault();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!grip.hasPointerCapture(e.pointerId)) return;
      colWidths[child] = Math.max(40, Math.round(startWidth + e.clientX - startX));
      applyColWidths();
    });
    grip.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      delete colWidths[child];
      applyColWidths();
    });
    th.appendChild(grip);
  }

  function renderHeader() {
    thead.textContent = '';
    const tr = document.createElement('tr');
    const corner = document.createElement('th');
    corner.textContent = '#';
    tr.appendChild(corner);
    columns.forEach((col, c) => {
      const th = document.createElement('th');
      th.textContent = col.name;
      if (col.type === 'structure') th.className = 'structure';
      else {
        th.classList.add('sortable');
        addGrip(th, c + 2); // nth-child is 1-based and the row-number column comes first
        if (sortState.column === c) th.dataset.sort = sortState.direction;
        th.addEventListener('click', () => {
          const next = sortState.column !== c ? 'asc' : sortState.direction === 'asc' ? 'desc' : sortState.direction === 'desc' ? '' : 'asc';
          sortState = { column: next ? c : -1, direction: next };
          renderHeader();
          pending = true;
          vscode.postMessage({ type: 'sort', column: c, direction: next });
        });
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
  }

  function appendRows(rows) {
    const fragment = document.createDocumentFragment();
    const cards = document.createDocumentFragment();
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.dataset.n = row.n;
      tr.classList.toggle('selected', selected.has(String(row.n)));
      const num = document.createElement('td');
      num.className = 'rownum';
      num.textContent = row.n;
      tr.appendChild(num);
      row.cells.forEach((cell, c) => {
        const td = document.createElement('td');
        if (columns[c].type === 'structure') {
          td.className = 'structure';
          if (cell.svg === null) {
            td.textContent = '?';
            td.title = 'Structure could not be parsed';
          } else td.innerHTML = cell.svg; // SVG generated by the extension host, not file content
        } else {
          td.textContent = cell;
          td.dataset.c = c;
          if (!columns[c].readOnly) td.className = 'editable';
        }
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
      const card = cardFor(tr);
      if (card) cards.appendChild(card);
    }
    tbody.appendChild(fragment);
    grid.appendChild(cards);
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'init') {
      columns = msg.columns;
      total = msg.total;
      fileName = msg.fileName;
      loaded = 0;
      note = '';
      colWidths = {};
      applyColWidths();
      deleteBtn.disabled = true;
      selected = new Set();
      anchor = null;
      pending = false;
      sortState = { column: -1, direction: '' };
      tbody.textContent = '';
      grid.textContent = '';
      structCol = columns.findIndex((c) => c.type === 'structure');
      fillSelectors();
      structPane.hidden = structCol < 0;
      splitter.hidden = structCol < 0;
      document.getElementById('alignTools').hidden = structCol < 0;
      renderHeader();
      updateStatus();
      requestPage();
    } else if (msg.type === 'rows') {
      if (msg.offset === 0) {
        tbody.textContent = '';
        grid.textContent = '';
      }
      appendRows(msg.rows);
      loaded = msg.offset + msg.rows.length;
      pending = false;
      updateStatus();
      // Keep loading while either pane still has empty space below its content.
      const nearEnd = (el) => el.offsetParent && el.getBoundingClientRect().top < window.innerHeight + 400;
      if (nearEnd(sentinel) || nearEnd(gridSentinel)) requestPage();
    } else if (msg.type === 'svg') {
      replaceStructure(msg.n, msg.column, msg.svg);
    } else if (msg.type === 'saved') {
      note = ` • saved as ${msg.name}`;
      updateStatus();
    } else if (msg.type === 'scaffoldError') {
      pending = false;
      scaffoldBox.classList.add('invalid');
    } else if (msg.type === 'error') {
      pending = false;
      status.textContent = `Error: ${msg.message}`;
    }
  });

  for (const [pane, end] of [[tablePane, sentinel], [structPane, gridSentinel]]) {
    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) requestPage();
    }, { root: pane, rootMargin: '400px' }).observe(end);
  }

  vscode.postMessage({ type: 'ready' });
})();
