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

## Coverage Summary

| Category | Events | % of 10,500 |
|----------|--------|-------------|
| Fully mapped (phase + anchor + seconds) | 6,146 | 59% |
| Phase only (no seconds) | 2,389 | 23% |
| No phase assigned | 1,965 | 19% |

### Events with no phase (1,965)

These are study-specific labels that don't match any pattern — e.g., "SCN", "SDDV", "TOC4129g", "Surgical Visit", compound-specific PK labels. Most have low sample counts. See `unmapped_clinical_events.csv` for the 214 events not even in the mapping table (236 total available samples).

## How to Extend

When a new SAMI export contains unrecognized event strings:

1. Check the mapping table — new events may already match an existing pattern but not be in the CSV
2. If not, classify the event string against the patterns above
3. Compute seconds using the appropriate formula
4. Add to `clinical_event_mappings.csv` and re-load via bootstrap, or create CT_CLINICAL_EVENT_MAPPING documents directly
5. Changes take effect immediately (query-time JOIN)
