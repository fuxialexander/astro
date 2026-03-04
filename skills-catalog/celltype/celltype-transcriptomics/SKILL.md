---
name: celltype-transcriptomics
version: "1.0.0"
description: "Differential expression, pathway enrichment, and transcriptomic analysis tools"
category: tools
tags: [celltype, transcriptomics, expression, pathway-enrichment, l1000, differential-expression]
allowedTools: [Bash, Read, Write]
---

## Transcriptomics & Expression Tools (celltype/cli)

Available tools for expression analysis:

- **expression.pathway_enrichment** — Pathway scoring from L1000 signatures
- **expression.immune_score** — IFN-gamma, antigen presentation, IO scoring
- **expression.l1000_similarity** — Find compounds with similar/opposite transcriptomic signatures
- **expression.deconvolution** — Immune cell type composition from bulk expression
- **expression.tf_activity** — Transcription factor activity inference from regulons
- **expression.diff_expression** — Differential expression between groups

**Omics tools:**
- **omics.deseq2** — Negative binomial differential expression
- **omics.geo_search/fetch** — NCBI GEO dataset search and download
- **omics.tcga_search/fetch** — TCGA/GDC cancer genomics

**Connectivity Map:**
- **clue.compound_signature** — L1000 transcriptomic signature for a compound
- **clue.connectivity_query** — Connectivity map queries by gene set

**Statistics:**
- **statistics.enrichment_test** — Hypergeometric ORA with FDR

**Workflow:** Fetch expression data → differential expression → pathway enrichment → TF activity → connectivity map query → compound signature matching.
