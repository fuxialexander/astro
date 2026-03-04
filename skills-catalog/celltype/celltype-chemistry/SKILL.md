---
name: celltype-chemistry
version: "1.0.0"
description: "Chemical analysis, SAR, and medicinal chemistry optimization tools"
category: tools
tags: [celltype, chemistry, sar, medicinal-chemistry, descriptors, retrosynthesis]
allowedTools: [Bash, Read, Write]
---

## Chemistry & SAR Tools (celltype/cli)

Available tools for chemical analysis and medicinal chemistry:

- **chemistry.descriptors** — MW, LogP, TPSA, Lipinski, fingerprints from SMILES
- **chemistry.pairwise_similarity** — Pairwise Tanimoto similarity matrix
- **chemistry.similarity_search** — Library search by Morgan fingerprint similarity
- **chemistry.sar_analyze** — Structure-activity relationship analysis
- **chemistry.mmp_analysis** — Matched molecular pair analysis
- **chemistry.scaffold_hop** — Scaffold replacements and bioisosteres
- **chemistry.pubchem_lookup** — PubChem compound lookup
- **chemistry.retrosynthesis** — Retrosynthetic route planning
- **chemistry.pharmacophore** — Pharmacophore model from active compounds
- **chemistry.sa_score** — Synthetic accessibility score (1=easy, 10=hard)

**Data APIs:**
- **data_api.chembl_advanced** — ChEMBL compound/target bioactivity
- **data_api.drug_info** — Comprehensive drug pharmacology
- **data_api.mychem_lookup** — MyChem.info compound data

**Workflow:** Look up compound → compute descriptors → SAR analysis → scaffold hopping → assess synthetic accessibility → plan retrosynthesis.
