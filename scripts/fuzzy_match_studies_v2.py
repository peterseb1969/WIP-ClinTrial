#!/usr/bin/env python3
"""
Fuzzy matcher v2: link Roche studies (MDMS) to ClinicalTrials.gov NCT IDs.

Tiered matching:
  Tier 1: ID-based (already done, loaded from ta_nct_mappings.json)
  Tier 2: Acronym match (exact, case-insensitive)
  Tier 3: Multi-signal fuzzy (hard filters + scored signals)

Hard filters for Tier 3:
  - CT.gov sponsor must be Roche/Genentech
  - Study type compatibility (PTAP/Scientific cannot match Interventional)
  - Phase compatibility (Phase I cannot match Phase III)

Scored signals:
  - Title similarity (TF-IDF cosine, heavy boilerplate removal)
  - Indication match (normalized keyword comparison)
  - Phase exact match
  - Therapeutic area match
"""

import csv
import json
import re
import sys
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

TA_PORTAL = Path("/Users/sebbelp/Development/TA-Portal")
MDMS_FILE = TA_PORTAL / "get_study_IDs_2026-08-10-1509.csv"
CTGOV_FILE = TA_PORTAL / "2026-08-10 2_45pm_2026-08-10-1445.csv"
ID_MATCHES_FILE = TA_PORTAL / "ta_nct_mappings.json"
STUDY_RO_FILE = TA_PORTAL / "study_ro_numbers.json"
STUDY_PRODUCTS_FILE = TA_PORTAL / "study_products.json"

ROCHE_SPONSORS = {
    "HOFFMANN-LA ROCHE", "GENENTECH, INC.", "GENENTECH, INC",
    "GENENTECH", "HOFFMANN-LA ROCHE AG", "F. HOFFMANN-LA ROCHE",
    "F. HOFFMANN-LA ROCHE AG",
}

# Study types that should never match an interventional CT.gov study
NON_MATCHABLE_TYPES = {
    "PATIENT ACCESS", "SCIENTIFIC PROJECT", "PRE-CLINICAL",
    "SAMPLE ANALYSIS", "ELECTRONIC SURVEY", "ELECTRONIC SURVEY  (ESURVEY)",
    "RESEARCH PROJECT WITHOUT ROCHE PRODUCT",
}

BOILERPLATE = re.compile(
    r"\b("
    r"a |an |the |of |in |to |and |or |for |with |by |on |at |from |"
    r"phase [iv0-9]+[ab]?,? |"
    r"multicenter,? |multicentre,? |multinational,? |"
    r"randomized,? |randomised,? |"
    r"double-blind,? |single-blind,? |triple-blind,? |"
    r"placebo-controlled,? |active-controlled,? |"
    r"open-label,? |open label,? |"
    r"parallel-group,? |parallel group,? |"
    r"two-part,? |three-part,? |two-arm,? |"
    r"adaptive,? |pivotal,? |confirmatory,? |"
    r"global,? |international,? |regional,? |local,? |"
    r"post-trial access program,? |"
    r"compassionate use,? |expanded access,? |"
    r"patients,? |subjects,? |participants,? |"
    r"study |trial |program |"
    r"efficacy,? |safety,? |tolerability,? |"
    r"pharmacokinetics?,? |pharmacodynamics?,? |pk/?pd,? |"
    r"dose[- ]?escalation,? |dose[- ]?finding,? |"
    r"transitioning off |"
    r"evaluate,? |assess,? |investigate,? |determine,? |compare,? |"
    r"non-?interventional,? |interventional,? |observational,? "
    r")",
    re.IGNORECASE,
)


def normalize_title(t):
    if not t:
        return ""
    t = t.upper()
    t = BOILERPLATE.sub(" ", t)
    t = re.sub(r"[^A-Z0-9 ]", " ", t)
    return " ".join(t.split())


def normalize_phase(p):
    """Normalize phase to a set of compatible phase levels.
    E.g. 'Phase I/II' -> {'I', 'II'}, 'Phase 2B' -> {'II'}
    """
    if not p:
        return set()
    p = p.upper().replace(" ", "")
    phases = set()
    if "IV" in p or "4" in p:
        phases.add("IV")
    elif "III" in p or "3" in p:
        phases.add("III")
    if "II" in p or "2" in p:
        phases.add("II")
    if ("I" in p or "1" in p) and "II" not in p and "III" not in p and "IV" not in p:
        phases.add("I")
    # Handle split phases: I/II, II/III
    if "/" in p or "_" in p:
        if "I" in p and ("II" in p or "2" in p):
            phases.update({"I", "II"})
        if ("II" in p or "2" in p) and ("III" in p or "3" in p):
            phases.update({"II", "III"})
    return phases


def normalize_phase_simple(p):
    """Return single canonical phase string for display."""
    phases = normalize_phase(p)
    if not phases:
        return ""
    order = ["I", "II", "III", "IV"]
    for ph in order:
        if ph in phases:
            return ph
    return ""


def phases_compatible(roche_phase_set, ctgov_phase_set):
    """Phases are compatible only if they share at least one level."""
    if not roche_phase_set or not ctgov_phase_set:
        return True  # can't disqualify without data
    return bool(roche_phase_set & ctgov_phase_set)


def extract_compound_ids(title):
    """Extract RO/GDC/MPDL/RG compound numbers from a title."""
    if not title:
        return set()
    return set(re.findall(r'\b(RO\d{5,}|GDC-?\d{4,}|MPDL\d{4,}|RG\d{4,})\b', title.upper()))


def normalize_indication(ind):
    if not ind:
        return set()
    words = set(re.findall(r"[A-Z]{3,}", ind.upper()))
    stopwords = {
        "THE", "AND", "FOR", "WITH", "OTHER", "NOT", "ALL",
        "TYPE", "STAGE", "GRADE", "ADULT", "PEDIATRIC",
        "ACUTE", "CHRONIC", "PRIMARY", "SECONDARY",
        "ADVANCED", "METASTATIC", "LOCALLY", "UNRESECTABLE",
        "PATIENTS", "SUBJECTS", "DISEASE", "DISORDER", "SYNDROME",
    }
    return words - stopwords


def map_ta_to_conditions(ta_code):
    """Map Roche TA code to likely CT.gov condition keywords."""
    mapping = {
        "ONC": {"CANCER", "TUMOR", "CARCINOMA", "LYMPHOMA", "LEUKEMIA", "MELANOMA", "SARCOMA", "MYELOMA", "NEOPLASM"},
        "NS": {"SCLEROSIS", "ALZHEIMER", "PARKINSON", "HUNTINGTON", "EPILEPSY", "NEUROPATHY", "NEURODEGENERAT"},
        "IMM": {"ARTHRITIS", "LUPUS", "ASTHMA", "CROHN", "COLITIS", "DERMATITIS", "PSORIASIS"},
        "OPH": {"MACULAR", "RETINAL", "GLAUCOMA", "OPTIC", "DIABETIC EYE"},
        "ID": {"HIV", "HEPATITIS", "INFLUENZA", "COVID", "INFECTION", "VIRAL", "BACTERIAL"},
        "HAN": {"HEMOPHILIA", "ANEMIA", "THROMBOCYTOPENIA", "NEPHRITIS", "KIDNEY"},
        "CVM": {"CARDIOVASCULAR", "HEART", "OBESITY", "DIABETES", "METABOLIC"},
    }
    return mapping.get(ta_code.split(" ")[0].split("-")[0].strip(), set())


# --- Load data ---

def fetch_product_data_from_wip():
    """Fetch RO numbers and product names from WIP reporting and save to disk."""
    import urllib.request
    import ssl
    import os

    key_path = os.path.expanduser("~/.wip-deploy/wip-local/secrets/api-key")
    with open(key_path) as f:
        api_key = f.read().strip()

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    sql = """
        SELECT s.study_number, p.ro_number, p.product_name
        FROM doc_ct_ta_study_product e
        JOIN doc_ct_ta_study s ON e.source_ref_id = s.document_id
        JOIN doc_ct_ta_product p ON e.target_ref_id = p.document_id
        WHERE p.ro_number IS NOT NULL AND p.ro_number != ''
    """
    body = json.dumps({"sql": sql, "namespace": "clintrial", "max_rows": 10000}).encode()
    req = urllib.request.Request(
        "https://localhost:8443/api/reporting-sync/query",
        data=body,
        headers={"Content-Type": "application/json", "X-API-Key": api_key},
        method="POST",
    )
    resp = urllib.request.urlopen(req, context=ctx, timeout=60)
    result = json.loads(resp.read())

    study_ro = {}
    study_products = {}
    for row in result["rows"]:
        sn = row["study_number"]
        study_ro.setdefault(sn, set()).add(row["ro_number"])
        study_products.setdefault(sn, set()).add(row["product_name"])

    with open(STUDY_RO_FILE, "w") as f:
        json.dump({sn: sorted(ros) for sn, ros in study_ro.items()}, f)
    with open(STUDY_PRODUCTS_FILE, "w") as f:
        json.dump({sn: sorted(prods) for sn, prods in study_products.items()}, f)

    print(f"  Fetched product data from WIP: {len(study_ro)} studies with RO numbers")
    return study_ro, study_products


def load_id_matches():
    if ID_MATCHES_FILE.exists():
        with open(ID_MATCHES_FILE) as f:
            return {m["study_number"] for m in json.load(f)}
    return set()


def load_study_ro_numbers():
    """Load study_number -> set of RO numbers. Auto-fetches from WIP if missing."""
    if not STUDY_RO_FILE.exists():
        print("  Product data files missing — fetching from WIP...")
        fetch_product_data_from_wip()
    with open(STUDY_RO_FILE) as f:
        data = json.load(f)
    return {sn: set(ros) for sn, ros in data.items()}


def load_study_products():
    """Load study_number -> set of product names. Auto-fetches from WIP if missing."""
    if not STUDY_PRODUCTS_FILE.exists():
        print("  Product data files missing — fetching from WIP...")
        fetch_product_data_from_wip()
    with open(STUDY_PRODUCTS_FILE) as f:
        data = json.load(f)
    return {sn: set(prods) for sn, prods in data.items()}


def load_roche_studies():
    studies = {}
    with open(MDMS_FILE) as f:
        for row in csv.DictReader(f):
            sn = row.get("STUDY_NUMBER", "").strip()
            if not sn:
                continue
            studies[sn] = {
                "study_number": sn,
                "acronym": row.get("ACRONYM", "").strip(),
                "scientific_title": row.get("SCIENTIFIC_TITLE", "").strip(),
                "public_title": row.get("PUBLIC_TITLE", "").strip(),
                "phase": row.get("STUDY_PHASE_TYPE_NAME", "").strip(),
                "study_type": row.get("STUDY_TYPE_NAME", "").strip(),
                "indication": row.get("GENERAL_INDICATION", "").strip(),
                "ta": row.get("THERAPEUTIC_AREA_SHORT_NAME", "").strip(),
            }
    return studies


def load_ctgov_roche():
    studies = {}
    with open(CTGOV_FILE) as f:
        for row in csv.DictReader(f):
            nct = row.get("NCT_ID", "").strip()
            sponsor = row.get("SOURCE", "").strip().upper()
            if not nct:
                continue
            if not any(rs in sponsor for rs in ROCHE_SPONSORS):
                continue
            studies[nct] = {
                "nct_id": nct,
                "acronym": row.get("ACRONYM", "").strip(),
                "official_title": row.get("OFFICIAL_TITLE", "").strip(),
                "brief_title": row.get("BRIEF_TITLE", "").strip(),
                "phase": row.get("PHASE", "").strip(),
                "study_type": row.get("STUDY_TYPE", "").strip(),
                "status": row.get("OVERALL_STATUS", "").strip(),
                "sponsor": row.get("SOURCE", "").strip(),
            }
    return studies


# --- Tier 2: Acronym matching ---

def acronym_match(roche, ctgov, already_matched):
    results = []
    ctgov_by_acronym = {}
    for nct, s in ctgov.items():
        acr = s["acronym"].upper()
        if acr:
            ctgov_by_acronym.setdefault(acr, []).append(s)

    for sn, r in roche.items():
        if sn in already_matched:
            continue
        acr = r["acronym"].upper()
        if not acr:
            continue
        candidates = ctgov_by_acronym.get(acr, [])
        if len(candidates) == 1:
            ct = candidates[0]
            r_phases = normalize_phase(r["phase"])
            c_phases = normalize_phase(ct["phase"])
            phase_match = bool(r_phases and c_phases and r_phases & c_phases)
            results.append({
                "study_number": sn,
                "nct_id": ct["nct_id"],
                "confidence": "high",
                "match_tier": "acronym",
                "signals": {
                    "acronym_match": True,
                    "phase_match": normalize_phase_simple(r["phase"]) if phase_match else None,
                },
                "signal_count": 2 if phase_match else 1,
                "roche_title": r["scientific_title"] or r["public_title"],
                "ctgov_title": ct["official_title"] or ct["brief_title"],
                "roche_phase": r["phase"],
                "roche_type": r["study_type"],
                "roche_indication": r["indication"],
            })
    return results


# --- Tier 3: Multi-signal fuzzy ---

def fuzzy_match(roche, ctgov, already_matched, study_ro=None, study_products=None):
    study_ro = study_ro or {}
    study_products = study_products or {}
    unmapped = {
        sn: s for sn, s in roche.items()
        if sn not in already_matched
        and (s["scientific_title"] or s["public_title"])
    }

    if not unmapped:
        return []

    print(f"  Tier 3: {len(unmapped)} unmapped studies to match against {len(ctgov)} CT.gov studies")

    # Build TF-IDF index on CT.gov titles
    ctgov_list = list(ctgov.items())
    ctgov_ncts = [nct for nct, _ in ctgov_list]
    ctgov_titles_norm = [
        normalize_title(s["official_title"] or s["brief_title"])
        for _, s in ctgov_list
    ]

    vectorizer = TfidfVectorizer(
        analyzer="word",
        ngram_range=(1, 2),
        max_features=20000,
        min_df=1,
    )
    ctgov_matrix = vectorizer.fit_transform(ctgov_titles_norm)

    results = []
    unmapped_list = list(unmapped.items())
    batch_size = 500

    for i in range(0, len(unmapped_list), batch_size):
        batch = unmapped_list[i:i + batch_size]
        batch_titles = [
            normalize_title(s["scientific_title"] or s["public_title"])
            for _, s in batch
        ]
        batch_matrix = vectorizer.transform(batch_titles)
        sims = cosine_similarity(batch_matrix, ctgov_matrix)

        for j, (sn, roche_study) in enumerate(batch):
            r_phases = normalize_phase(roche_study["phase"])
            r_type = roche_study["study_type"].upper()
            r_indication = normalize_indication(roche_study["indication"])
            r_ta = roche_study["ta"]
            r_ta_keywords = map_ta_to_conditions(r_ta) if r_ta else set()
            r_title = roche_study["scientific_title"] or roche_study["public_title"]
            r_compounds = extract_compound_ids(r_title)
            # Enrich with RO numbers from Products export
            if sn in study_ro:
                r_compounds |= study_ro[sn]
            r_product_names = study_products.get(sn, set())

            top_idx = np.argpartition(sims[j], -5)[-5:]
            top_idx = top_idx[np.argsort(sims[j][top_idx])[::-1]]

            for idx in top_idx:
                score = float(sims[j][idx])
                if score < 0.2:
                    break

                nct = ctgov_ncts[idx]
                ct = ctgov[nct]
                c_phases = normalize_phase(ct["phase"])
                c_type = ct["study_type"].upper()
                c_title = ct["official_title"] or ct["brief_title"]
                c_compounds = extract_compound_ids(c_title)

                # --- Hard filters ---

                # Filter: study type compatibility
                if r_type in NON_MATCHABLE_TYPES and c_type == "INTERVENTIONAL":
                    continue

                # Filter: phase compatibility
                if not phases_compatible(r_phases, c_phases):
                    continue

                # Filter: compound ID mismatch — if both have RO numbers and they differ, reject
                if r_compounds and c_compounds and not (r_compounds & c_compounds):
                    continue

                # --- Score signals ---
                signals = {"title_sim": round(score, 3)}
                signal_count = 0

                # Compound ID match (RO numbers from Products export + title extraction)
                if r_compounds and c_compounds and (r_compounds & c_compounds):
                    signals["compound_match"] = sorted(r_compounds & c_compounds)
                    signal_count += 1
                elif r_product_names:
                    # Fall back: check if product names appear in CT.gov title
                    ct_title_upper = c_title.upper()
                    matched_products = {p for p in r_product_names if p.upper() in ct_title_upper and len(p) >= 4}
                    if matched_products:
                        signals["product_name_match"] = sorted(matched_products)
                        signal_count += 1

                # Phase match
                if r_phases and c_phases and (r_phases & c_phases):
                    signals["phase_match"] = normalize_phase_simple(roche_study["phase"])
                    signal_count += 1

                # Indication match
                ct_title_words = set(re.findall(
                    r"[A-Z]{3,}",
                    (ct["official_title"] + " " + ct["brief_title"]).upper(),
                ))
                ind_overlap = r_indication & ct_title_words
                if len(ind_overlap) >= 2:
                    signals["indication_match"] = ", ".join(sorted(ind_overlap)[:4])
                    signal_count += 1

                # TA match
                if r_ta_keywords:
                    ta_overlap = r_ta_keywords & ct_title_words
                    if ta_overlap:
                        signals["ta_match"] = r_ta
                        signal_count += 1

                # --- Classify ---
                if score >= 0.6 and signal_count >= 2:
                    confidence = "high"
                elif score >= 0.4 and signal_count >= 1:
                    confidence = "medium"
                elif score >= 0.5:
                    confidence = "low"
                else:
                    continue

                results.append({
                    "study_number": sn,
                    "nct_id": nct,
                    "confidence": confidence,
                    "match_tier": "fuzzy",
                    "signals": signals,
                    "signal_count": signal_count + (1 if score >= 0.4 else 0),
                    "roche_title": roche_study["scientific_title"] or roche_study["public_title"],
                    "ctgov_title": ct["official_title"] or ct["brief_title"],
                    "roche_phase": roche_study["phase"],
                    "roche_type": roche_study["study_type"],
                    "roche_indication": roche_study["indication"],
                })
                break  # best match only

        done = min(i + batch_size, len(unmapped_list))
        if done % 2000 == 0 or done >= len(unmapped_list):
            print(f"    Processed {done}/{len(unmapped_list)}")

    return results


def run():
    print("Loading data...")
    id_matched = load_id_matches()
    roche = load_roche_studies()
    ctgov = load_ctgov_roche()
    study_ro = load_study_ro_numbers()
    study_products = load_study_products()
    print(f"  Roche studies (MDMS): {len(roche)}")
    print(f"  CT.gov Roche-sponsored: {len(ctgov)}")
    print(f"  Already ID-matched: {len(id_matched)}")
    print(f"  Studies with RO numbers (from Products): {len(study_ro)}")
    print(f"  Studies with product names: {len(study_products)}")

    # Tier 2: Acronym
    print("\nTier 2: Acronym matching...")
    acronym_results = acronym_match(roche, ctgov, id_matched)
    acronym_matched = {r["study_number"] for r in acronym_results}
    print(f"  Acronym matches: {len(acronym_results)}")

    # Tier 3: Fuzzy
    print("\nTier 3: Multi-signal fuzzy matching...")
    all_matched = id_matched | acronym_matched
    fuzzy_results = fuzzy_match(roche, ctgov, all_matched, study_ro, study_products)

    # Combine
    all_results = acronym_results + fuzzy_results

    # Deduplicate: best per study_number
    best = {}
    for r in all_results:
        sn = r["study_number"]
        if sn not in best:
            best[sn] = r
        else:
            existing = best[sn]
            # Prefer acronym over fuzzy, then higher title_sim
            if r["match_tier"] == "acronym" and existing["match_tier"] != "acronym":
                best[sn] = r
            elif r["signals"].get("title_sim", 0) > existing["signals"].get("title_sim", 0):
                best[sn] = r

    results = sorted(best.values(), key=lambda x: -x["signals"].get("title_sim", 0))

    # Summary
    by_conf = {}
    by_tier = {}
    for r in results:
        by_conf[r["confidence"]] = by_conf.get(r["confidence"], 0) + 1
        by_tier[r["match_tier"]] = by_tier.get(r["match_tier"], 0) + 1

    print(f"\nResults: {len(results)} matches")
    for c in ["high", "medium", "low"]:
        print(f"  {c}: {by_conf.get(c, 0)}")
    for t in ["acronym", "fuzzy"]:
        print(f"  tier {t}: {by_tier.get(t, 0)}")

    # Validate: check AG40375 is NOT matched to NCT02558140
    ag40375 = best.get("AG40375")
    if ag40375:
        print(f"\n  AG40375 matched to: {ag40375['nct_id']} ({ag40375['confidence']}) — ", end="")
        if ag40375["nct_id"] == "NCT02558140":
            print("BAD — same false match as v1!")
        else:
            print("different match")
    else:
        print("\n  AG40375: not matched (correct — it's a PTAP)")

    # Save
    out = TA_PORTAL / "ta_fuzzy_matches_v2.json"
    with open(out, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to {out}")

    # Top 10
    print("\nTop 10 high-confidence matches:")
    for r in [x for x in results if x["confidence"] == "high"][:10]:
        print(f"  {r['study_number']} -> {r['nct_id']} "
              f"(tier={r['match_tier']}, sim={r['signals'].get('title_sim', '-')}, "
              f"signals={r['signal_count']})")
        print(f"    Roche: {r['roche_title'][:90]}")
        print(f"    CTgov: {r['ctgov_title'][:90]}")


if __name__ == "__main__":
    run()
