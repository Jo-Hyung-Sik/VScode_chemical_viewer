'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseFile, renderSvg } = require('../src/parsers');

const load = (name) => parseFile(name, fs.readFileSync(path.join(__dirname, '..', 'samples', name), 'utf8'));
const svgOf = (cell) => renderSvg(cell, 160, 110);

test('csv: SMILES column gets a structure column, quoted commas survive', () => {
  const t = load('compounds.csv');
  assert.deepStrictEqual(t.columns.map((c) => c.name), ['Name', 'Structure of SMILES', 'SMILES', 'MW', 'Note']);
  assert.strictEqual(t.rows.length, 5);
  assert.strictEqual(t.rows[0][4], 'analgesic, antipyretic');
  assert.match(svgOf(t.rows[0][1]), /^<svg/);
  assert.strictEqual(svgOf(t.rows[3][1]), null); // unparsable SMILES
  assert.strictEqual(t.rows[4][1], null); // empty cell
});

test('csv: semicolon delimiter and SMILES detected without a "smiles" header', () => {
  const t = load('semicolon_no_smiles_header.csv');
  assert.deepStrictEqual(t.columns.map((c) => c.name), ['id', 'Structure of compound', 'compound', 'activity']);
  assert.match(svgOf(t.rows[0][1]), /^<svg/);
});

test('csv without structures stays a plain table', () => {
  const t = parseFile('x.csv', 'a,b\n1,hello\n2,world\n');
  assert.ok(t.columns.every((c) => c.type === 'text'));
});

test('sdf: structure, molecule name and data fields', () => {
  const t = load('compounds.sdf');
  assert.deepStrictEqual(t.columns.map((c) => c.name), ['Structure', 'Molecule Name', 'MW', 'SMILES']);
  assert.strictEqual(t.rows.length, 3);
  assert.deepStrictEqual(t.rows[1].slice(1), ['Caffeine', '194.19', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C']);
  assert.match(svgOf(t.rows[1][0]), /^<svg/);
});

test('mol2: one row per molecule, 3D input drawn without explicit hydrogens', () => {
  const t = load('benzene_ethanol.mol2');
  assert.deepStrictEqual(t.rows.map((r) => r.slice(1)), [['benzene', '12', '12'], ['ethanol', '9', '8']]);
  const benzene = svgOf(t.rows[0][0]);
  assert.match(benzene, /^<svg/);
  assert.ok(!/>H</.test(benzene));
  assert.match(svgOf(t.rows[1][0]), />O</);
});

test('align: molecules sharing a scaffold draw it with identical coordinates', () => {
  const { toMolecule } = require('../src/parsers');
  const ringCoords = (smiles, align) => {
    const mol = toMolecule({ smiles }, align);
    mol.ensureHelperArrays(31);
    const out = [];
    for (let a = 0; a < mol.getAtoms(); a++)
      if (mol.isRingAtom(a)) out.push(`${mol.getAtomX(a).toFixed(2)},${mol.getAtomY(a).toFixed(2)}`);
    return out.sort().join(' ');
  };
  // biphenyl ether scaffold with different substituents, written from different starting atoms
  const a = 'CC(=O)Nc1ccc(Oc2ccccc2)cc1';
  const b = 'OC(=O)CCc1ccccc1Oc1ccc(Cl)cc1';
  assert.notStrictEqual(ringCoords(a, false), ringCoords(b, false));
  assert.strictEqual(ringCoords(a, true), ringCoords(b, true));
  assert.match(renderSvg({ smiles: 'CCO' }, 160, 110, { align: true }), /^<svg/); // no rings: untouched
});

test('align: a user-supplied scaffold aligns molecules whose automatic scaffolds differ', () => {
  const { toMolecule, makeScaffoldTemplate } = require('../src/parsers');
  const template = makeScaffoldTemplate('c1ccncc1');
  const pyridine = (smiles) => {
    const mol = toMolecule({ smiles }, false, template);
    mol.ensureHelperArrays(31);
    const ring = [];
    for (let a = 0; a < mol.getAtoms(); a++) {
      if (mol.getAtomicNo(a) !== 7) continue;
      ring.push(a);
      for (let i = 0; i < mol.getConnAtoms(a); i++) ring.push(mol.getConnAtom(a, i));
    }
    return ring.map((a) => `${mol.getAtomX(a).toFixed(2)},${mol.getAtomY(a).toFixed(2)}`).sort().join(' ');
  };
  assert.strictEqual(pyridine('c1ccncc1CCc1ccccc1'), pyridine('Clc1ccncc1'));
  assert.match(renderSvg({ smiles: 'CCO' }, 160, 110, { template }), /^<svg/); // no match: untouched
  assert.throws(() => makeScaffoldTemplate('not a smiles('));
});

test('stereo: R/S labels are drawn by default and can be hidden', () => {
  const alanine = { smiles: 'C[C@H](N)C(=O)O' };
  assert.match(renderSvg(alanine, 160, 110), />S</);
  const hidden = renderSvg(alanine, 160, 110, { stereo: false });
  assert.ok(!/>S</.test(hidden) && !/>abs</.test(hidden));
});
