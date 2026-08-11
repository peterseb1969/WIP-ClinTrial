#!/usr/bin/env python3
"""
Fuzzy matcher: link TA-Portal Roche studies to ClinicalTrials.gov NCT IDs.

Multi-signal scoring:
  1. TF-IDF cosine similarity on scientific titles (boilerplate stripped)
  2. Molecule/drug name match
  3. Indication match
  4. Phase match

Outputs a JSON file with match candidates scored and classified:
  - id_match:    already mapped via ID (from ta_nct_mappings.json)
  - high:        3+ signals agree, title similarity >= 0.5
  - medium:      2 signals agree, title similarity >= 0.3
  - low:         title-only match >= 0.4
  - candidates:  weaker matches for manual review
"""

import csv
import json
import re
import sys
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

TA_PORTAL = Path(__file__).resolve().parent.parent.parent / "TA-Portal"

# --- Title normalization ---

BOILERPLATE = re.compile(
    r"\b(a |an |the |phase [iv]+[ab]?,? |multicenter,? |multicentre,? |"
    r"randomized,? |randomised,? |double-blind,? |single-blind,? |"
    r"placebo-controlled,? |open-label,? |parallel-group,? |"
    r"two-part,? |three-part,? |adaptive,? |pivotal,? |"
    r"global,? |international,? |study |trial |to )",
    re.IGNORECASE,
)

def normalize_title(t):
    if not t:
        return ""
    t = t.upper()
    t = BOILERPLATE.sub(" ", t)
    t = re.sub(r"[^A-Z0-9 ]", " ", t)
    return " ".join(t.split())


# --- Load data ---

def load_id_matches():
    p = TA_PORTAL / "ta_nct_mappings.json"
    if p.exists():
        with open(p) as f:
            return {m["study_number"]: m["nct_ids"] for m in json.load(f)}
    return {}


def load_roche_studies():
    """Load Roche studies from MDMS 1509 file (has SCIENTIFIC_TITLE)."""
    studies = {}
    p = TA_PORTAL / "get_study_IDs_2026-08-10-1509.csv"
    with open(p) as f:
        for row in csv.DictReader(f):
            sn = row.get("STUDY_NUMBER", "").strip()
            if not sn:
                continue
            studies[sn] = {
                "study_number": sn,
                "title": row.get("SCIENTIFIC_TITLE", "").strip(),
                "short_title": row.get("SHORT_TITLE", "").strip()
                if "SHORT_TITLE" in row
                else "",
                "indication": row.get("STUDY_INDICATION", "").strip()
                if "STUDY_INDICATION" in row
                else row.get("GENERAL_INDICATION", "").strip(),
                "molecule": row.get("THEME_MOLECULE", "").strip()
                if "THEME_MOLECULE" in row
                else "",
                "phase": row.get("STUDY_PHASE_TYPE_NAME", "").strip()
                if "STUDY_PHASE_TYPE_NAME" in row
                else "",
            }
    return studies


def load_ctgov_studies():
    """Load ClinicalTrials.gov studies from the big CSV."""
    studies = {}
    p = TA_PORTAL / "2026-08-10 2_45pm_2026-08-10-1445.csv"
    with open(p) as f:
        for row in csv.DictReader(f):
            nct = row.get("NCT_ID", "").strip()
            if not nct:
                continue
            sponsor = row.get("SOURCE", "").strip().upper()
            # Only keep Roche/Genentech-adjacent studies to narrow the search
            studies[nct] = {
                "nct_id": nct,
                "title": row.get("OFFICIAL_TITLE", "").strip(),
                "brief_title": row.get("BRIEF_TITLE", "").strip(),
                "phase": row.get("PHASE", "").strip(),
                "sponsor": sponsor,
                "conditions": row.get("CONDITIONS", "").strip()
                if "CONDITIONS" in row
                else "",
            }
    return studies


def extract_molecules(title):
    """Extract capitalized drug-like names from a title."""
    words = set()
    for w in re.findall(r"[A-Z][A-Z0-9-]{2,}", title.upper()):
        if len(w) >= 4 and w not in (
            "PHASE", "STUDY", "TRIAL", "WITH", "PATIENTS", "TREATMENT",
            "EFFICACY", "SAFETY", "DOSE", "DOUBLE", "BLIND", "OPEN",
            "LABEL", "PLACEBO", "CONTROLLED", "RANDOMIZED", "MULTICENTER",
            "SINGLE", "GROUP", "PARALLEL", "WEEKS", "MONTHS", "YEARS",
        ):
            words.add(w)
    return words


def normalize_phase(p):
    p = p.upper().replace(" ", "")
    if "III" in p or "3" in p:
        return "III"
    if "II" in p or "2" in p:
        return "II"
    if "IV" in p or "4" in p:
        return "IV"
    if "I" in p or "1" in p:
        return "I"
    return p


# --- Main matching ---

def run():
    print("Loading data...")
    id_matches = load_id_matches()
    roche = load_roche_studies()
    ctgov = load_ctgov_studies()

    print(f"  Roche studies (MDMS): {len(roche)}")
    print(f"  CT.gov studies: {len(ctgov)}")
    print(f"  Existing ID matches: {len(id_matches)}")

    # Filter to unmapped Roche studies with titles
    unmapped = {
        sn: s for sn, s in roche.items()
        if sn not in id_matches and s["title"]
    }
    print(f"  Unmapped with titles: {len(unmapped)}")

    # Filter CT.gov to Roche/Genentech sponsored (narrow the haystack)
    roche_sponsors = {"HOFFMANN-LA ROCHE", "GENENTECH, INC.", "GENENTECH, INC",
                      "GENENTECH", "HOFFMANN-LA ROCHE AG", "F. HOFFMANN-LA ROCHE"}
    ctgov_roche = {
        nct: s for nct, s in ctgov.items()
        if any(rs in s["sponsor"].upper() for rs in roche_sponsors)
        and s["title"]
    }
    print(f"  CT.gov Roche-sponsored with titles: {len(ctgov_roche)}")

    if not unmapped or not ctgov_roche:
        print("Nothing to match.")
        return

    # Build TF-IDF matrix for CT.gov titles
    print("Building TF-IDF index...")
    ctgov_list = list(ctgov_roche.items())
    ctgov_ncts = [nct for nct, _ in ctgov_list]
    ctgov_titles_norm = [normalize_title(s["title"]) for _, s in ctgov_list]

    vectorizer = TfidfVectorizer(
        analyzer="word",
        ngram_range=(1, 2),
        max_features=20000,
        min_df=1,
    )
    ctgov_matrix = vectorizer.fit_transform(ctgov_titles_norm)

    # Score each unmapped Roche study
    print("Matching...")
    results = []
    unmapped_list = list(unmapped.items())
    batch_size = 500

    for i in range(0, len(unmapped_list), batch_size):
        batch = unmapped_list[i : i + batch_size]
        batch_titles = [normalize_title(s["title"]) for _, s in batch]
        batch_matrix = vectorizer.transform(batch_titles)
        sims = cosine_similarity(batch_matrix, ctgov_matrix)

        for j, (sn, roche_study) in enumerate(batch):
            top_idx = np.argpartition(sims[j], -5)[-5:]
            top_idx = top_idx[np.argsort(sims[j][top_idx])[::-1]]

            for idx in top_idx:
                score = float(sims[j][idx])
                if score < 0.2:
                    break

                nct = ctgov_ncts[idx]
                ct_study = ctgov_roche[nct]

                # Multi-signal scoring
                signals = {"title_sim": round(score, 3)}
                signal_count = 1 if score >= 0.4 else 0

                # Molecule match
                roche_mols = extract_molecules(roche_study["title"])
                if roche_study["molecule"]:
                    roche_mols.add(roche_study["molecule"].upper())
                ct_mols = extract_molecules(ct_study["title"])
                mol_overlap = roche_mols & ct_mols
                if mol_overlap:
                    signals["molecule_match"] = sorted(mol_overlap)
                    signal_count += 1

                # Phase match
                r_phase = normalize_phase(roche_study.get("phase", ""))
                c_phase = normalize_phase(ct_study.get("phase", ""))
                if r_phase and c_phase and r_phase == c_phase:
                    signals["phase_match"] = r_phase
                    signal_count += 1

                # Indication match (keyword overlap)
                r_ind = set(roche_study.get("indication", "").upper().split())
                c_ind = set(ct_study.get("brief_title", "").upper().split())
                ind_overlap = r_ind & c_ind - {
                    "A", "AN", "THE", "IN", "OF", "AND", "OR", "FOR", "WITH",
                    "TO", "PATIENTS", "STUDY",
                }
                if len(ind_overlap) >= 2:
                    signals["indication_overlap"] = sorted(ind_overlap)[:5]
                    signal_count += 1

                # Classify
                if signal_count >= 3 and score >= 0.5:
                    confidence = "high"
                elif signal_count >= 2 and score >= 0.3:
                    confidence = "medium"
                elif score >= 0.4:
                    confidence = "low"
                else:
                    confidence = "candidate"

                results.append({
                    "study_number": sn,
                    "nct_id": nct,
                    "confidence": confidence,
                    "signals": signals,
                    "signal_count": signal_count,
                    "roche_title": roche_study["title"][:120],
                    "ctgov_title": ct_study["title"][:120],
                })

        if (i + batch_size) % 2000 == 0 or i + batch_size >= len(unmapped_list):
            print(f"  Processed {min(i + batch_size, len(unmapped_list))}/{len(unmapped_list)}")

    # Deduplicate: keep best match per study_number
    best = {}
    for r in results:
        sn = r["study_number"]
        if sn not in best or r["signals"]["title_sim"] > best[sn]["signals"]["title_sim"]:
            best[sn] = r

    results = sorted(best.values(), key=lambda x: -x["signals"]["title_sim"])

    # Summary
    by_conf = {}
    for r in results:
        by_conf.setdefault(r["confidence"], 0)
        by_conf[r["confidence"]] += 1

    print(f"\nResults: {len(results)} matches")
    for c in ["high", "medium", "low", "candidate"]:
        print(f"  {c}: {by_conf.get(c, 0)}")

    # Save
    out = TA_PORTAL / "ta_fuzzy_matches.json"
    with open(out, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to {out}")

    # Show top 10
    print("\nTop 10 high-confidence matches:")
    for r in [x for x in results if x["confidence"] == "high"][:10]:
        print(f"  {r['study_number']} -> {r['nct_id']} "
              f"(sim={r['signals']['title_sim']}, signals={r['signal_count']})")
        print(f"    Roche: {r['roche_title'][:80]}")
        print(f"    CTgov: {r['ctgov_title'][:80]}")


if __name__ == "__main__":
    run()
