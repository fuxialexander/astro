---
name: celltype-target-discovery
version: "1.0.0"
description: "Target discovery, validation, and druggability assessment tools"
category: tools
tags: [celltype, target-discovery, druggability, validation, depmap, opentargets]
allowedTools: [Bash, Read, Write]
---

## Target Discovery & Validation Tools (celltype/cli)

Available tools for target identification and validation:

- **target.neosubstrate_score** — Score proteins as degradation targets from proteomics data
- **target.degron_predict** — Predict degron motifs (zinc fingers, disorder) via UniProt features
- **target.coessentiality** — Find co-essential/synthetic lethal partners from DepMap CRISPR screens
- **target.druggability** — Assess druggability via UniProt domains, ligands, and structural coverage
- **target.expression_profile** — Query tissue expression from GTEx + Human Protein Atlas
- **target.disease_association** — Retrieve disease associations from Open Targets

**Data APIs for target research:**
- **data_api.opentargets_search** — Open Targets target/disease/drug profiles
- **data_api.depmap_search** — DepMap gene dependency, expression, mutation data
- **data_api.uniprot_lookup** — UniProt protein information
- **data_api.ensembl_lookup** — Ensembl gene/transcript info
- **data_api.ncbi_gene** — NCBI Gene, ClinVar, dbSNP

**Workflow:** Start with disease associations → validate with expression and essentiality data → assess druggability → characterize protein features.
