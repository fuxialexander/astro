---
name: celltype-safety-admet
version: "1.0.0"
description: "Drug safety assessment, ADMET prediction, and adverse event analysis tools"
category: tools
tags: [celltype, safety, admet, adverse-events, toxicology, drug-interactions]
allowedTools: [Bash, Read, Write]
---

## Safety & ADMET Tools (celltype/cli)

Available tools for safety assessment:

- **safety.antitarget_profile** — Screen for anti-target degradation (tumor suppressors, heme TFs)
- **safety.classify** — Multi-modal SAFE/CAUTION/DANGEROUS classification
- **safety.sall4_risk** — SALL4 teratogenicity risk assessment
- **safety.faers_signal_scan** — FDA FAERS adverse event disproportionality signals
- **safety.label_risk_extract** — Extract boxed warnings from openFDA labels
- **safety.admet_predict** — ADMET property prediction from RDKit descriptors
- **safety.ddi_predict** — Drug-drug interaction potential

**PK tools:**
- **pk.nca_basic** — Noncompartmental PK analysis (Cmax/AUC/t1/2)

**Workflow:** ADMET prediction → anti-target screening → safety classification → FAERS signal scan → DDI check → PK analysis.
