#!/usr/bin/env python3
"""Classify trials by therapeutic area based on their conditions.

Reads all trials from the WIP reporting DB, matches conditions against
CT_THERAPEUTIC_AREA terms (values, labels, aliases), and updates each
trial's therapeutic_areas field via WIP document upsert.

No ClinicalTrials.gov API calls needed — works entirely with existing WIP data.

Usage:
    python classify_therapeutic_areas.py              # Classify all trials
    python classify_therapeutic_areas.py --dry-run    # Show matches without updating
    python classify_therapeutic_areas.py --limit 10   # Process only 10 trials (for testing)
"""

import requests
import json
import sys
import re
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

WIP_BASE = "https://localhost:8443"
WIP_API_KEY = "dev_master_key_for_testing"
CT_TRIAL_TEMPLATE_ID = "019d25e5-345d-77a6-83c1-45ae615fe792"

HEADERS = {
    "Content-Type": "application/json",
    "X-API-Key": WIP_API_KEY,
}


def get_therapeutic_area_terms():
    """Fetch all CT_THERAPEUTIC_AREA terms with their aliases from WIP."""
    # First get the terminology ID
    resp = requests.get(
        f"{WIP_BASE}/api/def-store/terminologies",
        params={"value": "CT_THERAPEUTIC_AREA"},
        headers=HEADERS,
        verify=False,
    )
    resp.raise_for_status()
    items = resp.json().get("items", [])
    if not items:
        print("ERROR: CT_THERAPEUTIC_AREA terminology not found")
        sys.exit(1)

    terminology_id = items[0]["terminology_id"]

    # Fetch all terms
    resp = requests.get(
        f"{WIP_BASE}/api/def-store/terminologies/{terminology_id}/terms",
        params={"page_size": 100},
        headers=HEADERS,
        verify=False,
    )
    resp.raise_for_status()
    terms = resp.json().get("items", [])

    # Build keyword lookup: list of (term_value, keywords_to_match)
    lookup = []
    for term in terms:
        keywords = set()
        # Add the value (e.g., "LUNG_CANCER" → "lung cancer")
        keywords.add(term["value"].replace("_", " ").lower())
        # Add the label (e.g., "Lung Cancer" → "lung cancer")
        if term.get("label"):
            keywords.add(term["label"].lower())
        # Add all aliases
        for alias in term.get("aliases", []):
            keywords.add(alias.lower())

        lookup.append({
            "value": term["value"],
            "label": term.get("label", term["value"]),
            "keywords": keywords,
        })

    return lookup


def classify_conditions(conditions, lookup):
    """Match a list of condition strings against therapeutic area keywords.

    Returns a list of matching therapeutic area term values.
    Uses word-boundary matching for short keywords (<=3 chars) to avoid
    false positives like "ra" matching inside "Moderately".
    Longer keywords use substring matching.
    """
    if not conditions:
        return []

    matched = set()
    conditions_lower = [c.lower() for c in conditions]

    for ta in lookup:
        for keyword in ta["keywords"]:
            # Skip very short ambiguous abbreviations that cause too many false positives
            if len(keyword) <= 2:
                continue

            for condition in conditions_lower:
                if len(keyword) <= 4:
                    # Short keywords: require word boundary match
                    if re.search(r'\b' + re.escape(keyword) + r'\b', condition):
                        matched.add(ta["value"])
                        break
                else:
                    # Longer keywords: substring match in either direction
                    if keyword in condition or condition in keyword:
                        matched.add(ta["value"])
                        break
            if ta["value"] in matched:
                break

    return sorted(matched)


def fetch_all_trials():
    """Fetch all trial nct_id + conditions + full data from reporting SQL."""
    resp = requests.post(
        f"{WIP_BASE}/api/reporting-sync/query",
        headers=HEADERS,
        json={
            "sql": "SELECT nct_id, conditions, data_json FROM doc_ct_trial",
            "max_rows": 10000,
        },
        verify=False,
    )
    resp.raise_for_status()
    result = resp.json()
    return result["rows"]


def update_trial(nct_id, data_with_ta):
    """Submit updated trial document with therapeutic_areas via WIP upsert."""
    resp = requests.post(
        f"{WIP_BASE}/api/document-store/documents",
        headers=HEADERS,
        json=[{
            "template_id": CT_TRIAL_TEMPLATE_ID,
            "template_version": 1,
            "namespace": "clintrial",
            "data": data_with_ta,
        }],
        verify=False,
    )
    resp.raise_for_status()
    results = resp.json().get("results", [])
    if results and results[0].get("status") in ("created", "updated"):
        return True
    else:
        error = results[0].get("error", "unknown") if results else "no results"
        print(f"  WARNING: {nct_id} update failed: {error}")
        return False


def main():
    dry_run = "--dry-run" in sys.argv
    limit = None
    for i, arg in enumerate(sys.argv):
        if arg == "--limit" and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])

    print("=== Therapeutic Area Classification ===\n")

    # Step 1: Get therapeutic area terms
    print("Fetching CT_THERAPEUTIC_AREA terms...")
    lookup = get_therapeutic_area_terms()
    print(f"  {len(lookup)} therapeutic areas with keywords\n")

    # Show the lookup for transparency
    for ta in sorted(lookup, key=lambda t: t["value"]):
        print(f"  {ta['value']:30s} keywords: {', '.join(sorted(ta['keywords']))}")
    print()

    # Step 2: Fetch all trials
    print("Fetching trials from reporting DB...")
    trials = fetch_all_trials()
    print(f"  {len(trials)} trials\n")

    if limit:
        trials = trials[:limit]
        print(f"  (limited to {limit} trials)\n")

    # Step 3: Classify
    print("Classifying...")
    updates = []
    no_match = 0
    already_set = 0

    for row in trials:
        nct_id = row["nct_id"]
        conditions_raw = row.get("conditions") or "[]"
        if isinstance(conditions_raw, str):
            try:
                conditions = json.loads(conditions_raw)
            except json.JSONDecodeError:
                conditions = []
        else:
            conditions = conditions_raw

        # Parse full data
        data_json = row.get("data_json", "{}")
        if isinstance(data_json, str):
            data = json.loads(data_json)
        else:
            data = data_json

        # Check if already classified
        existing_ta = data.get("therapeutic_areas", [])
        if existing_ta:
            already_set += 1
            continue

        # Classify
        matched = classify_conditions(conditions, lookup)
        if not matched:
            no_match += 1
            continue

        data["therapeutic_areas"] = matched
        updates.append((nct_id, data, matched, conditions))

    print(f"\n  Results:")
    print(f"    Already classified: {already_set}")
    print(f"    New classifications: {len(updates)}")
    print(f"    No match: {no_match}")
    print(f"    Total: {len(trials)}\n")

    # Show some examples
    print("  Sample classifications:")
    for nct_id, data, matched, conditions in updates[:10]:
        cond_str = ", ".join(conditions[:3])
        ta_str = ", ".join(matched)
        print(f"    {nct_id}: [{cond_str}] → [{ta_str}]")
    if len(updates) > 10:
        print(f"    ... and {len(updates) - 10} more\n")

    if dry_run:
        print("DRY RUN — no updates applied.")
        return

    if not updates:
        print("Nothing to update.")
        return

    # Step 4: Update trials in WIP
    print(f"\nUpdating {len(updates)} trials in WIP...")
    success = 0
    failed = 0

    # Batch in groups of 50 for progress reporting
    for i in range(0, len(updates), 50):
        batch = updates[i:i+50]
        for nct_id, data, matched, conditions in batch:
            if update_trial(nct_id, data):
                success += 1
            else:
                failed += 1

        pct = min(100, round((i + len(batch)) / len(updates) * 100))
        print(f"  Progress: {i + len(batch)}/{len(updates)} ({pct}%) — {success} ok, {failed} failed")

    print(f"\nDone: {success} updated, {failed} failed")


if __name__ == "__main__":
    main()
