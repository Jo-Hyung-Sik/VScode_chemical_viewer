'use strict';
const vscode = require('vscode');
const path = require('path');
const { parseFile, serialize, renderSvg, makeScaffoldTemplate, STRUCTURE } = require('./parsers');

const PAGE_SIZE = 100;
const SVG_WIDTH = 160;
const SVG_HEIGHT = 110;

class ChemTableProvider {
  constructor(context) {
    this.context = context;
  }

  openCustomDocument(uri) {
    return { uri, dispose() {} };
  }

  async resolveCustomEditor(document, panel) {
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    panel.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
    panel.webview.html = this.html(panel.webview, mediaRoot);

    let table = { columns: [], rows: [] };
    let order = [];
    let align = false;
    let stereo = true; // show R/S labels
    let template = null; // user-supplied scaffold, used only while align is on
    let deleted = new Set(); // row indices removed in this editor
    let dirty = false; // edits exist that the file on disk does not have

    const svgOf = (cell) =>
      cell ? renderSvg(cell, SVG_WIDTH, SVG_HEIGHT, { align, template: align && template, stereo }) : '';

    const load = async () => {
      const bytes = await vscode.workspace.fs.readFile(document.uri);
      table = parseFile(document.uri.path, new TextDecoder('utf-8').decode(bytes));
      order = table.rows.map((_, i) => i);
      deleted = new Set();
      dirty = false;
      panel.webview.postMessage({
        type: 'init',
        fileName: path.basename(document.uri.path),
        columns: table.columns,
        total: table.rows.length,
      });
    };

    const sendPage = (offset) => {
      const rows = order.slice(offset, offset + PAGE_SIZE).map((rowIndex) => ({
        n: rowIndex + 1,
        cells: table.rows[rowIndex].map((cell, c) =>
          table.columns[c].type === STRUCTURE ? { svg: svgOf(cell) } : cell,
        ),
      }));
      panel.webview.postMessage({ type: 'rows', offset, rows });
    };

    const sort = (column, direction) => {
      order = table.rows.map((_, i) => i).filter((i) => !deleted.has(i));
      if (direction) {
        const numeric = table.rows.every((r) => r[column] === '' || !isNaN(Number(r[column])));
        order.sort((a, b) => {
          const x = table.rows[a][column];
          const y = table.rows[b][column];
          if (x === '' || y === '') return (x === '') - (y === ''); // empty cells last
          const cmp = numeric ? Number(x) - Number(y) : x.localeCompare(y);
          return direction === 'asc' ? cmp : -cmp;
        });
      }
    };

    panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.type === 'ready') await load();
        else if (msg.type === 'page') sendPage(msg.offset);
        else if (msg.type === 'align') {
          // The checkbox switches alignment on or off; the scaffold only chooses what to align on.
          try {
            template = msg.smiles ? makeScaffoldTemplate(msg.smiles) : null;
          } catch {
            panel.webview.postMessage({ type: 'scaffoldError' });
            return;
          }
          align = msg.on;
          stereo = msg.stereo;
          sendPage(0);
        } else if (msg.type === 'sort') {
          sort(msg.column, msg.direction);
          sendPage(0);
        } else if (msg.type === 'edit') {
          const row = table.rows[msg.n - 1];
          const column = table.columns[msg.column];
          if (!row || !column || column.type === STRUCTURE || column.readOnly) return;
          row[msg.column] = String(msg.value);
          dirty = true;
          // In a CSV the structure column is drawn from the SMILES column right after it.
          const s = msg.column - 1;
          if (table.format === 'csv' && s >= 0 && table.columns[s].type === STRUCTURE) {
            const smiles = row[msg.column].trim();
            row[s] = smiles ? { smiles } : null;
            panel.webview.postMessage({ type: 'svg', n: msg.n, column: s, svg: svgOf(row[s]) });
          }
        } else if (msg.type === 'delete') {
          if (!table.rows[msg.n - 1]) return;
          deleted.add(msg.n - 1);
          order = order.filter((i) => i !== msg.n - 1);
          dirty = true;
        } else if (msg.type === 'save') {
          const ext = path.extname(document.uri.path);
          const base = path.basename(document.uri.path, ext);
          const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.joinPath(document.uri, '..', `${base}_edited${ext}`),
          });
          if (!target) return;
          const text = serialize(table, table.rows.filter((_, i) => !deleted.has(i)));
          await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
          panel.webview.postMessage({ type: 'saved', name: path.basename(target.path) });
        }
      } catch (err) {
        panel.webview.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
      }
    });

    // Reload when the file changes on disk, unless that would throw away edits made here.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'), path.basename(document.uri.path)),
    );
    watcher.onDidChange(() => {
      if (!dirty) load().catch(() => {});
    });
    panel.onDidDispose(() => watcher.dispose());
  }

  html(webview, mediaRoot) {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'table.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'table.js'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}">
</head>
<body>
<div id="bar"><span id="status">Loading…</span><span id="tools"><span id="alignTools"><label id="structLabel">Structure <select id="structCol"></select></label><label>Label <select id="labelCol"></select></label><details id="fieldsBox"><summary>Fields</summary><div id="fieldList"></div></details><input type="text" id="scaffold" placeholder="Scaffold SMILES, Enter to align" spellcheck="false"><label><input type="checkbox" id="stereo" checked> R/S labels</label><label id="alignLabel"><input type="checkbox" id="align"> Align scaffolds</label></span><button id="deleteRow" disabled>Delete rows</button><button id="saveAs">Save As…</button></span></div>
<div id="main">
<div id="tablePane"><table id="table"><thead></thead><tbody></tbody></table><div id="sentinel"></div></div>
<div id="splitter"></div>
<div id="structPane"><div id="grid"></div><div id="gridSentinel"></div></div>
</div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('chemicalViewer.table', new ChemTableProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    // The editor is registered with priority "option", so this menu command is how users open it.
    vscode.commands.registerCommand('chemicalViewer.openTable', (uri) => {
      const target = uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
      if (target) return vscode.commands.executeCommand('vscode.openWith', target, 'chemicalViewer.table');
    }),
  );
}

module.exports = { activate, deactivate() {} };
