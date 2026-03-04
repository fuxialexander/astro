---
name: celltype-structure-design
version: "1.0.0"
description: "Protein structure prediction, molecular docking, and drug design tools"
category: tools
tags: [celltype, structure, molecular-design, docking, alphafold, drug-design]
allowedTools: [Bash, Read, Write]
---

## Structure & Molecular Design Tools (celltype/cli)

Available tools for structural biology and molecular design:

- **structure.alphafold_fetch** — Download AlphaFold predicted structures
- **structure.compound_3d** — Generate 3D conformers from SMILES
- **structure.dock** — Molecular docking (ligand into protein)
- **structure.binding_site** — Detect binding pockets (geometric analysis/fpocket)
- **structure.ternary_predict** — Predict E3-compound-target ternary complex
- **structure.batch_screen** — Batch virtual screening for ternary compatibility
- **structure.md_simulate** — Molecular dynamics simulation (OpenMM/GROMACS)
- **structure.fep** — Free energy perturbation calculations

**Data APIs:**
- **data_api.pdb_search** — RCSB PDB structure search
- **data_api.pdbe_search** — PDBe search

**Workflow:** Fetch structure → identify binding sites → dock compounds → evaluate binding energy → optimize via FEP.
