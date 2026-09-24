# 10. Timepoint Normalization Rules

## Overview

SAMI clinical event strings (~10,500 unique values) are normalized to three fields via regex-based rules. The rules were applied as a one-shot pipeline; the output is stored as CT_CLINICAL_EVENT_MAPPING documents and seeded from `server/seed/data/clinical_event_mappings.csv`.

This document captures the regex patterns and seconds-from-anchor formulas so they can be reproduced or extended.

## Output Fields

| Field | Description |
|-------|-------------|
| **phase** | Canonical visit phase (CT_VISIT_PHASE terminology, 10 values) |
| **anchor** | Reference point for time calculation |
| **seconds_from_anchor** | Integer seconds from the anchor point |

## Seconds Calculation Formulas

| Pattern | Formula | Example |
|---------|---------|---------|
| Week N | `N × 7 × 86400` | Week 12 → 7,257,600s |
| Day N | `N × 86400` | Day 15 → 1,296,000s |
| Cycle N Day D | `(D - 1) × 86400` (within-cycle offset) | Cycle 3 Day 15 → 1,209,600s |
| Month N | `N × 30 × 86400` (30-day month) | Month 9 → 23,328,000s |
| Follow-up Year N | `N × 365 × 86400` | Year 2 → 63,072,000s |
| Follow-up Week N | `N × 7 × 86400` (from EOT anchor) | FU Week 48 → 29,030,400s |

## Anchor Rules

| Context | Anchor | Rationale |
|---------|--------|-----------|
| Non-cycle timepoints (Week, Day, Month) | BASELINE | Standard clinical trial timeline from enrollment |
| Cycle-based timepoints (C1D1, Cycle 2 Day 15) | CYCLE_N (e.g., CYCLE_1, CYCLE_2) | Oncology chemo cycles restart the clock |
| Follow-up timepoints | END_OF_TREATMENT | Time measured from treatment completion |
| Screening | SCREENING | Self-anchored |
| Baseline | BASELINE | Self-anchored |

## Regex Patterns

Listed in priority order. First match wins. All matching is case-insensitive unless noted.

### Pattern 1: Cycle N Day D (verbose)

```
^Cycle\s*(\d+)\s*Day\s*(\d+)
```

**Matches:** "Cycle 1 Day 1", "Cycle 3 Day 15", "Cycle 12 Day 1 (Crossover)"
**Phase:** ON_TREATMENT
**Anchor:** CYCLE_{N}
**Seconds:** (D - 1) × 86400
**Events:** 656

### Pattern 2: CnDn (compact)

```
^C(\d+)D(\d+)
```

**Matches:** "C1D1", "C2D15", "C3D1 SM4 MEGF0444A PK", "C8D1COM POST"
**Phase:** ON_TREATMENT
**Anchor:** CYCLE_{N}
**Seconds:** (D - 1) × 86400
**Events:** 718

### Pattern 3: Cycle N (no day)

```
^Cycle[\s_]*(\d+)
```

**Matches:** "Cycle 1 Visit 1", "CYCLE1_DAY1", "Cycle 6 Visit 1 (Day 1 Week 21)"
**Phase:** ON_TREATMENT
**Anchor:** CYCLE_{N}
**Seconds:** 0 (day 1 assumed if not specified; if day is embedded elsewhere in the string, extracted when possible)
**Events:** 299

### Pattern 4: Week N (verbose)

```
^Week\s*(\d+)
```

**Matches:** "Week 24", "Week 4", "Week 52", "Week 105 SC"
**Phase:** ON_TREATMENT
**Anchor:** BASELINE
**Seconds:** N × 7 × 86400
**Events:** 819

### Pattern 5: Wn (compact week)

```
^W(\d+)
```

**Matches:** "W24", "W12", "W4", "W1SC", "W104", "W12PB", "W16SUPP"
**Phase:** ON_TREATMENT
**Anchor:** BASELINE
**Seconds:** N × 7 × 86400
**Events:** 184

### Pattern 6: Day N (verbose)

```
^Day\s*-?(\d+)
```

**Matches:** "Day 1", "Day 15", "Day 85", "Day -8", "Day 28 (33)"
**Phase:** ON_TREATMENT
**Anchor:** BASELINE
**Seconds:** N × 86400 (negative days get negative seconds)
**Events:** 993

### Pattern 7: Dn (compact day)

```
^D(\d+)
```

**Matches:** "D1", "D29", "D85", "D15", "D372"
**Phase:** ON_TREATMENT
**Anchor:** BASELINE
**Seconds:** N × 86400
**Events:** 211

### Pattern 8: Month N (verbose)

```
^Month\s*(\d+)
```

**Matches:** "Month 9", "Month 12", "Month 3", "Month 33"
**Phase:** ON_TREATMENT
**Anchor:** BASELINE
**Seconds:** N × 30 × 86400
**Events:** 128

### Pattern 9: Mn (compact month)

```
^M(\d+)
```

**Matches:** "M12", "M24", "M6", "M9"
**Note:** Many Mn events were NOT mapped (61 events with no phase) — likely ambiguous (M could mean Month or something else in some contexts)
**Phase:** ON_TREATMENT (when mapped)
**Anchor:** BASELINE
**Seconds:** N × 30 × 86400
**Events:** 61 (partially mapped)

### Pattern 10: Screening

```
^(screen|scrn|scr\b)
```

**Matches:** "Screening", "SCREENING", "SCRN", "Screen", "Screening Tissue Visit"
**Phase:** SCREENING
**Anchor:** SCREENING
**Seconds:** 0
**Events:** 127

### Pattern 11: Baseline

```
^base(line)?
```

**Matches:** "Baseline", "BASELINE", "Baseline Day 1", "Baseline Visit 2"
**Phase:** BASELINE
**Anchor:** BASELINE
**Seconds:** 0
**Events:** 48

### Pattern 12: End of Treatment

```
^(eot|end.of.treat|treatment.disc|early.term|early.disc|disc\b)
```

**Matches:** "Treatment Discontinuation", "Early Termination", "End of Treatment", "EOT", "DISC"
**Phase:** END_OF_TREATMENT
**Anchor:** (none)
**Seconds:** (none)
**Events:** 78

### Pattern 13: Follow-up

```
^(follow|fu\b|f/u|fup|safety.follow)
```

**Matches:** "Follow-Up Year 1", "Follow Up", "FU Week 4", "Safety Follow Up"
**Phase:** FOLLOW_UP
**Anchor:** END_OF_TREATMENT (when time specified)
**Seconds:** Extracted from embedded Week/Month/Year when present (e.g., "Follow-Up Year 2" → 63,072,000s)
**Events:** 436

### Pattern 14: Archival

```
^archiv
```

**Matches:** "Archival Tissue", "Archival", "Archival Tumor", "Archival Pretreatment"
**Phase:** ARCHIVAL
**Anchor:** (none)
**Seconds:** (none)
**Events:** 31

### Pattern 15: Unscheduled

```
^(unsched|unsch|uns\b)
```

**Matches:** "UNSCHEDULED", "Unscheduled", "UNSCH", "Unscheduled Visit", "UNSCH/RETEST"
**Phase:** UNSCHEDULED
**Anchor:** (none)
**Seconds:** (none)
**Events:** 232

### Pattern 16: Visit N

```
^Visit\s*(\d+)
```

**Matches:** "Visit 3", "Visit 1", "Visit 5 Week 24"
**Phase:** ON_TREATMENT (or BASELINE for Visit 1)
**Anchor:** BASELINE (when embedded Week/Day present), otherwise none
**Seconds:** Extracted from embedded time reference when present (e.g., "Visit 5 Week 24" → 14,515,200s)
**Events:** 436

### Pattern 17: Vn (compact visit)

```
^V(\d+)
```

**Matches:** "V1", "V3", "V7"
**Phase:** BASELINE (V1) or ON_TREATMENT (V2+)
**Anchor:** BASELINE (V1 only)
**Seconds:** Only for V1 (= 0)
**Events:** 141

### Pattern 18: Not Specified / NA

```
^(na|not.specified|n/a)
```

**Phase:** NOT_SPECIFIED
**Anchor:** (none)
**Seconds:** (none)

### Pattern 19: Pre-treatment

```
^(pre.?dose|pre.?treat|pre.?study)
```

**Phase:** ON_TREATMENT (or BASELINE for "Pre-Treatment Baseline")
**Events:** 27

## Overall Mapping Statistics

### Coverage

| Metric | Value |
|--------|-------|
| Unique input terms (raw SAMI clinical events) | 10,713 |
| Mapped terms (phase assigned) | 8,361 (78%) |
| Unmapped terms | 2,352 (22%) |
| Unique output terms (distinct phase + anchor + seconds) | 1,046 |
| **Compression ratio** | **10,713 → 1,046 (10:1)** |

### Sample Coverage

| | Samples | % |
|---|---------|---|
| Mapped | 11,132,406 | **97.3%** |
| Unmapped | 314,211 | 2.7% |
| **Total** | **11,446,617** | |

While 22% of unique event strings are unmapped, they cover only 2.7% of samples — the long tail of rare, study-specific labels.

### Sample Temporal Precision

Three levels of temporal information are available, depending on how well the event string could be parsed:

| Level | Description | Total samples | Available | % of total |
|-------|-------------|--------------|-----------|------------|
| Full (seconds from anchor) | Chronologically sortable within a study | 7,705,943 | 6,211,231 | **67%** |
| Phase only (no seconds) | Sequenceable by phase order (SCREENING → BASELINE → ON_TREATMENT → EOT → FOLLOW_UP) but no within-phase ordering | 3,426,463 | 2,207,509 | **30%** |
| No phase | No temporal information at all | 314,211 | 231,647 | **3%** |
| | **Total** | **11,446,617** | **8,650,387** | |

97% of samples have at least phase-level sequence information, enabling coarse chronological ordering even when exact timing is unknown.

### Term-Level Coverage

| Category | Events | % of 10,713 |
|----------|--------|-------------|
| Fully mapped (phase + anchor + seconds) | 6,146 | 57% |
| Phase only (no seconds) | 2,215 | 21% |
| No phase assigned | 2,352 | 22% |

### Top 50 Canonical Timepoints (by total samples)

The top 4 timepoints (Not specified, Screening, Cycle 1 Day 1, Baseline) account for 4.3M of 11.4M samples (37%). Samples cluster heavily at trial entry points and early treatment cycles.

| # | Phase | Anchor | Seconds | Human-readable | Input terms | Studies | Total samples | Available |
|---|-------|--------|---------|---------------|-------------|---------|--------------|-----------|
| 1 | NOT_SPECIFIED | — | — | Not specified | 11 | 1,847 | 1,961,926 | 1,099,422 |
| 2 | SCREENING | SCREENING | 0 | Screening | 201 | 591 | 1,029,996 | 824,250 |
| 3 | ON_TREATMENT | CYCLE_1 | 0 | Cycle 1 Day 1 | 184 | 407 | 679,817 | 541,906 |
| 4 | BASELINE | BASELINE | 0 | Baseline | 118 | 339 | 610,388 | 453,253 |
| 5 | ON_TREATMENT | BASELINE | 86,400 | Day 1 | 249 | 388 | 445,631 | 329,576 |
| 6 | ON_TREATMENT | — | — | On-treatment (no time) | 831 | 286 | 374,722 | 259,572 |
| 7 | END_OF_TREATMENT | — | — | End of treatment | 243 | 547 | 373,618 | 319,374 |
| 8 | UNSCHEDULED | — | — | Unscheduled | 400 | 864 | 324,470 | 208,766 |
| 9 | ON_TREATMENT | CYCLE_2 | 0 | Cycle 2 Day 1 | 113 | 339 | 310,506 | 269,278 |
| 10 | ON_TREATMENT | BASELINE | 14,515,200 | Week 24 | 93 | 173 | 248,150 | 197,004 |
| 11 | ON_TREATMENT | CYCLE_3 | 0 | Cycle 3 Day 1 | 97 | 318 | 228,629 | 191,326 |
| 12 | ON_TREATMENT | BASELINE | 7,257,600 | Week 12 | 133 | 178 | 222,958 | 177,422 |
| 13 | ON_TREATMENT | BASELINE | 2,419,200 | Week 4 | 79 | 205 | 222,828 | 180,512 |
| 14 | ARCHIVAL | — | — | Archival | 39 | 79 | 175,170 | 139,555 |
| 15 | ON_TREATMENT | BASELINE | 604,800 | Week 1 | 191 | 217 | 168,069 | 121,933 |
| 16 | ON_TREATMENT | CYCLE_4 | 0 | Cycle 4 Day 1 | 81 | 262 | 163,277 | 140,344 |
| 17 | FOLLOW_UP | — | — | Follow-up (no time) | 430 | 220 | 116,571 | 98,854 |
| 18 | ON_TREATMENT | BASELINE | 29,030,400 | Week 48 | 55 | 97 | 112,864 | 90,088 |
| 19 | ON_TREATMENT | BASELINE | 31,449,600 | Week 52 | 29 | 62 | 103,266 | 86,290 |
| 20 | ON_TREATMENT | BASELINE | 1,209,600 | Week 2 | 89 | 155 | 80,563 | 67,437 |
| 21 | ON_TREATMENT | BASELINE | 4,838,400 | Week 8 | 73 | 127 | 78,068 | 61,813 |
| 22 | ON_TREATMENT | CYCLE_1 | 1,209,600 | Cycle 1 Day 15 | 71 | 178 | 73,542 | 62,987 |
| 23 | ON_TREATMENT | BASELINE | 21,772,800 | Week 36 | 39 | 83 | 72,136 | 60,383 |
| 24 | ON_TREATMENT | BASELINE | 0 | Treatment start | 34 | 47 | 70,952 | 56,532 |
| 25 | ON_TREATMENT | CYCLE_8 | 0 | Cycle 8 Day 1 | 53 | 185 | 70,166 | 62,891 |
| 26 | PROCEDURE | — | — | Procedure | 213 | 98 | 68,711 | 53,681 |
| 27 | ON_TREATMENT | CYCLE_1 | 604,800 | Cycle 1 Day 8 | 59 | 169 | 67,068 | 59,838 |
| 28 | ON_TREATMENT | BASELINE | 172,800 | Day 2 | 40 | 179 | 62,060 | 47,545 |
| 29 | ON_TREATMENT | BASELINE | 9,676,800 | Week 16 | 49 | 105 | 61,521 | 47,327 |
| 30 | ON_TREATMENT | BASELINE | 43,545,600 | Week 72 | 40 | 60 | 60,663 | 50,833 |
| 31 | ON_TREATMENT | BASELINE | 58,060,800 | Week 96 | 32 | 52 | 53,928 | 44,377 |
| 32 | ON_TREATMENT | BASELINE | 7,862,400 | Week 13 | 25 | 35 | 51,764 | 47,554 |
| 33 | ON_TREATMENT | BASELINE | 8,467,200 | Week 14 | 18 | 28 | 51,704 | 42,093 |
| 34 | ON_TREATMENT | BASELINE | 259,200 | Day 3 | 34 | 132 | 47,587 | 35,842 |
| 35 | ON_TREATMENT | BASELINE | 432,000 | Day 5 | 46 | 99 | 46,855 | 39,688 |
| 36 | ON_TREATMENT | BASELINE | 3,024,000 | Week 5 | 37 | 57 | 46,407 | 42,076 |
| 37 | ON_TREATMENT | BASELINE | 2,505,600 | Day 29 | 14 | 84 | 45,457 | 34,295 |
| 38 | ON_TREATMENT | BASELINE | 1,296,000 | Day 15 | 38 | 126 | 44,695 | 31,821 |
| 39 | ON_TREATMENT | CYCLE_5 | 0 | Cycle 5 Day 1 | 48 | 169 | 44,035 | 38,154 |
| 40 | ON_TREATMENT | BASELINE | 16,934,400 | Week 28 | 25 | 59 | 41,693 | 35,581 |
| 41 | ON_TREATMENT | BASELINE | 691,200 | Day 8 | 40 | 155 | 41,299 | 33,493 |
| 42 | ON_TREATMENT | BASELINE | 6,048,000 | Week 10 | 18 | 32 | 39,368 | 31,238 |
| 43 | ON_TREATMENT | BASELINE | 62,899,200 | Week 104 | 29 | 33 | 36,325 | 28,991 |
| 44 | ON_TREATMENT | CYCLE_1 | 86,400 | Cycle 1 Day 2 | 52 | 150 | 36,287 | 28,243 |
| 45 | ON_TREATMENT | CYCLE_6 | 0 | Cycle 6 Day 1 | 56 | 153 | 35,723 | 28,012 |
| 46 | ON_TREATMENT | BASELINE | 12,096,000 | Week 20 | 34 | 74 | 33,102 | 28,761 |
| 47 | ON_TREATMENT | BASELINE | 7,344,000 | Day 85 | 12 | 53 | 32,846 | 25,717 |
| 48 | ON_TREATMENT | BASELINE | 4,924,800 | Day 57 | 9 | 59 | 32,782 | 24,716 |
| 49 | ON_TREATMENT | BASELINE | 45,964,800 | Week 76 | 10 | 23 | 32,371 | 29,219 |
| 50 | ON_TREATMENT | BASELINE | 32,054,400 | Week 53 | 5 | 11 | 31,697 | 30,228 |

### Unmapped Events

The 2,352 unmapped terms are study-specific labels that don't match any pattern — e.g., "SDDV", "TOC4129g", "RCR", "AB", bare numbers ("1", "2"), compound-specific PK labels. Most have low sample counts. See `unmapped_clinical_events.csv` for the 214 events not even in the mapping table (236 total available samples).

## How to Extend

When a new SAMI export contains unrecognized event strings:

1. Check the mapping table — new events may already match an existing pattern but not be in the CSV
2. If not, classify the event string against the patterns above
3. Compute seconds using the appropriate formula
4. Add to `clinical_event_mappings.csv` and re-load via bootstrap, or create CT_CLINICAL_EVENT_MAPPING documents directly
5. Changes take effect immediately (query-time JOIN)
