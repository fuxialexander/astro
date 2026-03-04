---
name: celltype-single-cell
version: "1.0.0"
description: "Single-cell RNA-seq, spatial transcriptomics, and cell type analysis tools"
category: tools
tags: [celltype, single-cell, spatial-transcriptomics, clustering, cell-type-annotation, scanpy]
allowedTools: [Bash, Read, Write]
---

## Single-Cell & Spatial Analysis Tools (celltype/cli)

Available tools for single-cell and spatial analysis:

- **singlecell.cluster** — Leiden/Louvain clustering with PCA+UMAP (scanpy)
- **singlecell.trajectory** — Trajectory inference with diffusion maps/PAGA
- **singlecell.cell_type_annotate** — Cell type annotation via marker panels/CellTypist

**CELLxGENE tools:**
- **cellxgene.gene_expression** — Single-cell gene expression across tissues/cell types
- **cellxgene.cell_type_markers** — Marker genes for cell types
- **cellxgene.dataset_search** — Dataset discovery in CELLxGENE Census

**Spatial & multi-modal:**
- **omics.spatial_cluster** — Spatial transcriptomics clustering
- **omics.spatial_autocorrelation** — Spatial autocorrelation analysis
- **omics.cellxgene_search/fetch** — CELLxGENE Discover datasets
- **omics.cytof_cluster** — CyTOF/flow cytometry clustering
- **omics.multiomics_integrate** — MOFA+ multi-omics integration

**Workflow:** Search datasets → cluster cells → annotate cell types → trajectory analysis → marker gene discovery → spatial patterns.
