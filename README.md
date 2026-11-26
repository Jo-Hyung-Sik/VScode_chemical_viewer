# Chemical Viewer

A VS Code extension that opens `.csv`, `.sdf` and `.mol2` files as a table with 2D compound structures.

- **CSV / TSV** — comma, semicolon or tab separated. A column named like `SMILES`, or one whose values all parse as SMILES, gets a `Structure of <column>` column next to it.
- **SDF** — one row per record: structure, molecule name and every data field.
- **MOL2** — one row per `@<TRIPOS>MOLECULE` block. 3D coordinates are replaced by a 2D layout and explicit hydrogens are hidden.

Right-click a file in the Explorer (or its editor tab) and choose **Open as Chemical Structure Table**. Clicking a file still opens it in its usual editor, so this extension does not take over files handled by other viewers.

## Using the viewer

The table is on the left; a structure pane on the right shows all structures as a grid. Drag the divider between them to resize. Rows load as you scroll.

**Table**

- Click a column header to sort.
- Drag a header's right edge to resize the column; double-click the edge to reset it.
- Click a row or a structure to highlight it in both panes. Cmd/Ctrl-click adds or removes a row; Shift-click selects the range from the last clicked row.

**Structure pane**

- **Label** — the column shown above each structure. A name or ID column is picked automatically; rows without a value show the row number.
- **Fields** — tick any columns to list them under each structure as `column: value` lines.
- **Structure** — appears when a CSV has several SMILES columns; chooses which one the pane draws. The table always shows a structure column for each.

**Drawing**

- **Align scaffolds** — redraws every structure so that molecules sharing a scaffold (rings plus linkers) show it in the same position and orientation. Untick to see the original drawings again.
- **Scaffold SMILES** — type a scaffold and press Enter to align on it instead. This ticks **Align scaffolds**; molecules that do not contain the scaffold keep the automatic alignment.
- **R/S labels** — stereo centres are labelled R/S; untick to hide the labels (wedge bonds stay).

**Editing**

- Double-click a text cell to change it (Enter commits, Escape cancels). Editing a SMILES cell redraws its structure.
- **Delete rows** removes the selected rows.
- **Save As…** writes the edited table to a new file in the same format. The file you opened is never modified.

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
