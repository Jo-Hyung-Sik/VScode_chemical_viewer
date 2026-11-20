# Chemical Viewer

A VS Code extension that opens `.csv`, `.sdf` and `.mol2` files as a table with 2D compound structures.

- **CSV / TSV** — comma, semicolon or tab separated. A column named like `SMILES`, or one whose values all parse as SMILES, gets a `Structure of <column>` column next to it.
- **SDF** — one row per record: structure, molecule name and every data field.
- **MOL2** — one row per `@<TRIPOS>MOLECULE` block. 3D coordinates are replaced by a 2D layout and explicit hydrogens are hidden.

Right-click a file in the Explorer (or its editor tab) and choose **Open as Chemical Structure Table**. Clicking a file still opens it in its usual editor, so this extension does not take over files handled by other viewers.

The table is on the left; a structure pane on the right shows all structures as a grid. Click a row or a structure to highlight it in both. Tick **Align scaffolds** to redraw every structure so that molecules sharing a scaffold (rings plus linkers) show it in the same position and orientation. To choose the scaffold yourself, type its SMILES into the box next to the checkbox and press Enter: this ticks the checkbox and aligns every molecule containing it on that scaffold, while the rest keep the automatic alignment. Untick the checkbox to see the original drawings again. Stereo centres are labelled R/S; untick **R/S labels** to hide them (wedge bonds stay). Click a column header to sort. Rows load as you scroll.

Structures are parsed and drawn with [OpenChemLib](https://github.com/cheminfo/openchemlib-js) (BSD-3-Clause), the open-source chemistry library that DataWarrior is built on.

## Development

```bash
npm install
npm test          # parser tests against samples/
npm run build     # bundles to dist/extension.js
npm run package   # builds a .vsix
```

Press F5 in VS Code to launch an Extension Development Host, then open a file from `samples/`.

## Limitations

- The whole file is read into memory; very large SD files (hundreds of MB) will be slow.
- MOL2 has no formal charges, so only `N.4` is given a positive charge; other charged groups may show extra hydrogens.
