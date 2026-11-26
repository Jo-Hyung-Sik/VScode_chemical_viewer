'use strict';
// File parsing and 2D depiction. No VS Code dependency, so it runs under plain Node for tests.
const OCL = require('openchemlib');

const STRUCTURE = 'structure';
const TEXT = 'text';

/** A table: columns [{name, type}], rows [cells]; a structure cell is {smiles}|{molfile}|{mol2} or null. */

// ---------- CSV / TSV ----------

function detectDelimiter(text) {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  let best = ',';
  let bestCount = 0;
  for (const d of ['\t', ',', ';']) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const SMILES_CHARS = /^[A-Za-z0-9@+\-[\]()\\/%=#$.:~*]+$/;

function looksLikeSmilesColumn(values) {
  const sample = values.filter((v) => v !== '').slice(0, 20);
  if (!sample.length) return false;
  let totalLength = 0;
  for (const v of sample) {
    if (!SMILES_CHARS.test(v) || !/[CcNnOo]/.test(v) || /^[\d.+-]+$/.test(v)) return false;
    try {
      if (OCL.Molecule.fromSmiles(v).getAllAtoms() === 0) return false;
    } catch {
      return false;
    }
    totalLength += v.length;
  }
  return totalLength / sample.length >= 4;
}

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delimiter = detectDelimiter(text);
  const records = parseDelimited(text, delimiter);
  if (!records.length) return { format: 'csv', delimiter, columns: [], rows: [] };
  const header = records[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const body = records.slice(1);

  const smilesCols = [];
  header.forEach((name, c) => {
    const values = body.map((r) => (r[c] || '').trim());
    if (/smiles/i.test(name) ? values.some((v) => v) : looksLikeSmilesColumn(values)) smilesCols.push(c);
  });

  const columns = [];
  header.forEach((name, c) => {
    if (smilesCols.includes(c)) columns.push({ name: `Structure of ${name}`, type: STRUCTURE });
    columns.push({ name, type: TEXT });
  });
  const rows = body.map((r) => {
    const cells = [];
    header.forEach((_, c) => {
      const value = r[c] === undefined ? '' : r[c];
      if (smilesCols.includes(c)) cells.push(value.trim() ? { smiles: value.trim() } : null);
      cells.push(value);
    });
    return cells;
  });
  return { format: 'csv', delimiter, columns, rows };
}

// ---------- SD file ----------

function parseSdf(text) {
  const fieldNames = [];
  const records = [];
  let hasName = false;
  for (const chunk of text.split(/^\$\$\$\$.*$/m)) {
    if (!chunk.trim()) continue;
    const lines = chunk.replace(/^\r?\n/, '').split(/\r?\n/);
    let end = lines.findIndex((l) => l.startsWith('M  END'));
    if (end === -1) end = lines.findIndex((l) => l.startsWith('>')) - 1;
    const molfile = end >= 0 ? lines.slice(0, end + 1).join('\n') + '\n' : '';
    const name = (lines[0] || '').trim();
    if (name) hasName = true;
    const fields = {};
    for (let i = end + 1; i < lines.length; i++) {
      const m = /^>.*<([^>]*)>/.exec(lines[i]);
      if (!m) continue;
      const value = [];
      for (i++; i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('>'); i++) value.push(lines[i]);
      if (i < lines.length && lines[i].startsWith('>')) i--;
      if (!fieldNames.includes(m[1])) fieldNames.push(m[1]);
      fields[m[1]] = value.join('\n');
    }
    records.push({ molfile, name, fields });
  }
  const columns = [{ name: 'Structure', type: STRUCTURE }];
  if (hasName) columns.push({ name: 'Molecule Name', type: TEXT });
  for (const f of fieldNames) columns.push({ name: f, type: TEXT });
  const rows = records.map((r) => {
    const cells = [r.molfile ? { molfile: r.molfile } : null];
    if (hasName) cells.push(r.name);
    for (const f of fieldNames) cells.push(r.fields[f] || '');
    return cells;
  });
  return { format: 'sdf', nameColumn: hasName ? 1 : -1, columns, rows };
}

// ---------- Tripos MOL2 ----------

function parseMol2(text) {
  const rows = [];
  for (const block of text.split(/^(?=@<TRIPOS>MOLECULE)/m)) {
    if (!block.startsWith('@<TRIPOS>MOLECULE')) continue;
    const lines = block.split(/\r?\n/);
    const name = (lines[1] || '').trim();
    const counts = (lines[2] || '').trim().split(/\s+/);
    rows.push([{ mol2: block }, name, counts[0] || '', counts[1] || '']);
  }
  return {
    format: 'mol2',
    columns: [
      { name: 'Structure', type: STRUCTURE },
      { name: 'Molecule Name', type: TEXT },
      { name: 'Atoms', type: TEXT, readOnly: true }, // derived from the block, not stored as data
      { name: 'Bonds', type: TEXT, readOnly: true },
    ],
    rows,
  };
}

function mol2ToMolecule(block) {
  const mol = new OCL.Molecule(256, 256);
  const atomIndex = new Map();
  let section = '';
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('@<TRIPOS>')) {
      section = line.slice(9).trim();
      continue;
    }
    const p = line.trim().split(/\s+/);
    if (section === 'ATOM' && p.length >= 6) {
      const type = p[5];
      let label = type.split('.')[0];
      label = label[0].toUpperCase() + label.slice(1).toLowerCase();
      if (label === 'Lp' || label === 'Du') continue;
      let atomicNo = OCL.Molecule.getAtomicNoFromLabel(label);
      if (!atomicNo) atomicNo = OCL.Molecule.getAtomicNoFromLabel(label[0]) || 6;
      const a = mol.addAtom(atomicNo);
      mol.setAtomX(a, Number(p[2]));
      mol.setAtomY(a, -Number(p[3]));
      mol.setAtomZ(a, -Number(p[4])); // y and z both flipped, as OCL's molfile parser does; flipping only y mirrors the molecule
      if (type === 'N.4') mol.setAtomCharge(a, 1);
      atomIndex.set(p[0], a);
    } else if (section === 'BOND' && p.length >= 4) {
      const a1 = atomIndex.get(p[1]);
      const a2 = atomIndex.get(p[2]);
      if (a1 === undefined || a2 === undefined || p[3] === 'nc') continue;
      const types = {
        2: OCL.Molecule.cBondTypeDouble,
        3: OCL.Molecule.cBondTypeTriple,
        ar: OCL.Molecule.cBondTypeDelocalized,
      };
      mol.setBondType(mol.addBond(a1, a2), types[p[3]] || OCL.Molecule.cBondTypeSingle);
    }
  }
  return mol;
}

// ---------- depiction ----------

const scaffoldTemplates = new Map(); // scaffold idcode -> scaffold fragment with a canonical 2D layout

/**
 * Redraws the molecule so that its Murcko scaffold (rings plus the linkers between them) gets the
 * same 2D layout as in every other molecule with that scaffold. Molecules without rings are untouched.
 */
function alignToScaffold(mol) {
  mol.ensureHelperArrays(OCL.Molecule.cHelperParities);
  const atoms = mol.getAtoms();
  const keep = new Array(mol.getAllAtoms()).fill(false).map((_, a) => a < atoms);
  for (let changed = true; changed; ) {
    changed = false;
    for (let a = 0; a < atoms; a++) {
      if (!keep[a] || mol.isRingAtom(a)) continue;
      let neighbours = 0;
      for (let i = 0; i < mol.getConnAtoms(a); i++) if (keep[mol.getConnAtom(a, i)]) neighbours++;
      if (neighbours <= 1) {
        keep[a] = false; // side-chain end: not part of the scaffold
        changed = true;
      }
    }
  }
  if (!keep.includes(true)) return;

  const scaffold = new OCL.Molecule(0, 0);
  mol.copyMoleculeByAtoms(scaffold, keep, true, null);
  scaffold.setFragment(true);
  const key = scaffold.getIDCode();
  let template = scaffoldTemplates.get(key);
  if (!template) scaffoldTemplates.set(key, (template = OCL.Molecule.fromIDCode(key)));

  applyTemplate(mol, template);
}

/** Builds a substructure template from a user-supplied scaffold SMILES. Throws if it cannot be parsed. */
function makeScaffoldTemplate(smiles) {
  const template = OCL.Molecule.fromSmiles(smiles);
  if (template.getAllAtoms() === 0) throw new Error('empty scaffold');
  template.setFragment(true);
  return template;
}

/** Lays the molecule out around the template's coordinates. Returns false if the template is not in it. */
function applyTemplate(mol, template) {
  mol.ensureHelperArrays(OCL.Molecule.cHelperParities);
  const searcher = new OCL.SSSearcher();
  searcher.setMol(template, mol);
  if (!searcher.findFragmentInMolecule({ countMode: 'firstMatch' })) return false;
  // ponytail: first match only, so a symmetric scaffold may show substituents mirrored between rows;
  // pick the match by substituent position if that matters.
  searcher.getMatchList()[0].forEach((atom, i) => {
    mol.setAtomX(atom, template.getAtomX(i));
    mol.setAtomY(atom, template.getAtomY(i));
    mol.setAtomMarker(atom, true);
  });
  mol.inventCoordinates({ keepMarkedAtomCoordinates: true });
  mol.removeAtomMarkers();
  return true;
}

/** A user template wins where it matches; `align` falls back to the automatic scaffold for the rest. */
function toMolecule(spec, align, template) {
  const mol = parseMolecule(spec);
  if (!(template && applyTemplate(mol, template)) && align) alignToScaffold(mol);
  return mol;
}

function parseMolecule(spec) {
  if (spec.smiles) return OCL.Molecule.fromSmiles(spec.smiles);
  const mol = spec.mol2 ? mol2ToMolecule(spec.mol2) : OCL.Molecule.fromMolfile(spec.molfile);
  let is3D = Boolean(spec.mol2);
  for (let a = 0; !is3D && a < mol.getAllAtoms(); a++) if (mol.getAtomZ(a) !== 0) is3D = true;
  if (is3D) {
    // 3D input: drop explicit hydrogens and lay the molecule out flat, as a 2D table view needs.
    mol.removeExplicitHydrogens();
    mol.inventCoordinates();
  }
  return mol;
}

let svgCounter = 0;

/** Returns SVG markup, '' for an empty structure, or null when the structure cannot be parsed. */
function renderSvg(spec, width, height, { align = false, template = null, stereo = true } = {}) {
  try {
    const mol = toMolecule(spec, align, template);
    if (mol.getAllAtoms() === 0) return '';
    return mol
      .toSVG(width, height, `ocl${++svgCounter}`, {
        suppressChiralText: true,
        noStereoProblem: true,
        // R/S labels and their abs/and/or group marks; wedge bonds are drawn either way
        suppressCIPParity: !stereo,
        suppressESR: !stereo,
      })
      .replace(/rgb\(0,0,0\)/g, 'currentColor');
  } catch {
    return null;
  }
}

function parseFile(fileName, text) {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'sdf' || ext === 'sd') return parseSdf(text);
  if (ext === 'mol2') return parseMol2(text);
  return parseCsv(text);
}

// ---------- writing ----------

const EMPTY_MOLFILE = '\n\n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n';

/** Turns a parsed (and possibly edited) table back into file text in its original format. */
function serialize(table, rows = table.rows) {
  const { columns } = table;
  if (table.format === 'sdf') {
    return rows
      .map((r) => {
        let out = r[0] ? r[0].molfile : EMPTY_MOLFILE;
        if (table.nameColumn >= 0) out = out.replace(/^[^\n]*/, () => r[table.nameColumn].replace(/\s*[\r\n]+\s*/g, ' '));
        for (let c = table.nameColumn >= 0 ? 2 : 1; c < columns.length; c++) {
          // a blank line ends an SD data item, so none may survive inside a value
          const value = r[c].replace(/\r/g, '').replace(/\n\s*\n/g, '\n').trim();
          if (value) out += `>  <${columns[c].name}>\n${value}\n\n`;
        }
        return out + '$$$$\n';
      })
      .join('');
  }
  if (table.format === 'mol2') {
    return rows
      .map((r) => r[0].mol2.replace(/^(@<TRIPOS>MOLECULE\r?\n)[^\r\n]*/, (_, head) => head + r[1].replace(/[\r\n]+/g, ' ')))
      .join('');
  }
  const keep = columns.map((_, c) => c).filter((c) => columns[c].type !== STRUCTURE);
  const quote = (v) => (/["\r\n]/.test(v) || v.includes(table.delimiter) ? `"${v.replace(/"/g, '""')}"` : v);
  return [keep.map((c) => columns[c].name), ...rows.map((r) => keep.map((c) => r[c]))]
    .map((line) => line.map(quote).join(table.delimiter) + '\n')
    .join('');
}

module.exports = { serialize, parseFile, parseCsv, parseSdf, parseMol2, renderSvg, toMolecule, makeScaffoldTemplate, STRUCTURE };
