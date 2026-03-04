---
name: celltype-literature
version: "1.0.0"
description: "Scientific literature search, ChEMBL queries, and patent analysis tools"
category: tools
tags: [celltype, literature, pubmed, chembl, patents, preprints]
allowedTools: [Bash, Read, Write]
---

## Literature & Data API Tools (celltype/cli)

Available tools for literature and data access:

**Literature search:**
- **literature.pubmed_search** — PubMed via NCBI E-utilities
- **literature.chembl_query** — ChEMBL compound/SAR/target query
- **literature.openalex_search** — OpenAlex academic publications
- **literature.patent_search** — Patent search (Lens.org/EPO)
- **literature.preprint_search** — bioRxiv/medRxiv/arXiv preprints

**Broad data APIs:**
- **data_api.mygene_lookup** — MyGene.info gene data
- **data_api.mydisease_lookup** — MyDisease.info disease data
- **data_api.myvariant_lookup** — MyVariant.info variant data
- **data_api.mychem_lookup** — MyChem.info compound data
- **data_api.mytaxon_lookup** — MyTaxon.info taxonomy data
- **data_api.reactome_pathway_search** — Reactome pathway search

**Workflow:** Literature review → ChEMBL bioactivity data → patent landscape → preprint discovery.
