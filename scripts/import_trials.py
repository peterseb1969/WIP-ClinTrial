#!/usr/bin/env python3
"""Import Roche/Genentech trials from ClinicalTrials.gov into WIP."""

import requests
import json
import sys
import time
import re
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

WIP_BASE = "https://localhost:8443"
WIP_API_KEY = "dev_master_key_for_testing"
CTGOV_BASE = "https://clinicaltrials.gov/api/v2"
NAMESPACE = "clintrial"

# Template IDs
TEMPLATES = {
    "CT_ORGANIZATION": "019d25e4-ebd9-7f74-85fe-17e66762e138",
    "CT_TRIAL": "019d25e5-345d-77a6-83c1-45ae615fe792",
    "CT_TRIAL_OUTCOME": "019d25e6-4095-7531-a15b-3db36a919ddf",
    "CT_TRIAL_SITE": "019d25e6-4097-7b70-8cd7-00e2747fa890",
}

# Known molecules in CT_MOLECULE terminology — canonical values and brand-name aliases
KNOWN_MOLECULES = {
    # Canonical values (lowercase)
    "atezolizumab": "atezolizumab",
    "rituximab": "rituximab",
    "bevacizumab": "bevacizumab",
    "trastuzumab": "trastuzumab",
    "pertuzumab": "pertuzumab",
    "ocrelizumab": "ocrelizumab",
    "tocilizumab": "tocilizumab",
    "emicizumab": "emicizumab",
    "fenebrutinib": "fenebrutinib",
    "tiragolumab": "tiragolumab",
    "cevostamab": "cevostamab",
    "glofitamab": "glofitamab",
    "mosunetuzumab": "mosunetuzumab",
    "polatuzumab vedotin": "polatuzumab_vedotin",
    "polatuzumab_vedotin": "polatuzumab_vedotin",
    "entrectinib": "entrectinib",
    "alectinib": "alectinib",
    "cobimetinib": "cobimetinib",
    "vemurafenib": "vemurafenib",
    "pirfenidone": "pirfenidone",
    "satralizumab": "satralizumab",
    "faricimab": "faricimab",
    "gantenerumab": "gantenerumab",
    "trontinemab": "trontinemab",
    "afimkibart": "afimkibart",
    "pembrolizumab": "pembrolizumab",
    "nivolumab": "nivolumab",
    "durvalumab": "durvalumab",
    "ipilimumab": "ipilimumab",
    "osimertinib": "osimertinib",
    "carboplatin": "carboplatin",
    "cisplatin": "cisplatin",
    "pemetrexed": "pemetrexed",
    "paclitaxel": "paclitaxel",
    "methotrexate": "methotrexate",
    # Brand name aliases
    "tecentriq": "atezolizumab",
    "rituxan": "rituximab",
    "mabthera": "rituximab",
    "avastin": "bevacizumab",
    "herceptin": "trastuzumab",
    "kadcyla": "trastuzumab",
    "perjeta": "pertuzumab",
    "ocrevus": "ocrelizumab",
    "actemra": "tocilizumab",
    "hemlibra": "emicizumab",
    "columvi": "glofitamab",
    "lunsumio": "mosunetuzumab",
    "polivy": "polatuzumab_vedotin",
    "rozlytrek": "entrectinib",
    "alecensa": "alectinib",
    "cotellic": "cobimetinib",
    "zelboraf": "vemurafenib",
    "esbriet": "pirfenidone",
    "enspryng": "satralizumab",
    "vabysmo": "faricimab",
    "keytruda": "pembrolizumab",
    "opdivo": "nivolumab",
    "imfinzi": "durvalumab",
    "yervoy": "ipilimumab",
    "tagrisso": "osimertinib",
    "alimta": "pemetrexed",
    "taxol": "paclitaxel",
    "abraxane": "paclitaxel",
    "nab-paclitaxel": "paclitaxel",
    "trastuzumab emtansine": "trastuzumab",
    "ado-trastuzumab emtansine": "trastuzumab",
}

# Country name to ISO code mapping (built from WIP COUNTRY terminology + common CT.gov values)
COUNTRY_MAP = {
    "United States": "US",
    "United Kingdom": "GB",
    "Germany": "DE",
    "France": "FR",
    "Italy": "IT",
    "Spain": "ES",
    "Switzerland": "CH",
    "Australia": "AU",
    "Canada": "CA",
    "Japan": "JP",
    "China": "CN",
    "South Korea": "KR",
    "Korea, Republic of": "KR",
    "Taiwan": "TW",
    "Brazil": "BR",
    "Mexico": "MX",
    "Argentina": "AR",
    "India": "IN",
    "Russia": "RU",
    "Russian Federation": "RU",
    "Poland": "PL",
    "Netherlands": "NL",
    "Belgium": "BE",
    "Austria": "AT",
    "Sweden": "SE",
    "Denmark": "DK",
    "Norway": "NO",
    "Finland": "FI",
    "Czech Republic": "CZ",
    "Czechia": "CZ",
    "Hungary": "HU",
    "Greece": "GR",
    "Portugal": "PT",
    "Israel": "IL",
    "Turkey": "TR",
    "Türkiye": "TR",
    "South Africa": "ZA",
    "New Zealand": "NZ",
    "Singapore": "SG",
    "Hong Kong": "HK",
    "Ireland": "IE",
    "Romania": "RO",
    "Bulgaria": "BG",
    "Croatia": "HR",
    "Slovakia": "SK",
    "Ukraine": "UA",
    "Thailand": "TH",
    "Malaysia": "MY",
    "Philippines": "PH",
    "Colombia": "CO",
    "Chile": "CL",
    "Peru": "PE",
    "Egypt": "EG",
    "Saudi Arabia": "SA",
    # Additional common CT.gov country names
    "Puerto Rico": "US",
    "Guam": "US",
    "Virgin Islands (U.S.)": "US",
    "American Samoa": "US",
}

# Counters for summary
COUNTS = {
    "orgs_created": 0,
    "orgs_updated": 0,
    "trials_created": 0,
    "trials_updated": 0,
    "outcomes_created": 0,
    "outcomes_updated": 0,
    "sites_created": 0,
    "sites_updated": 0,
    "errors": 0,
}


def wip_headers():
    """Return common WIP request headers."""
    return {
        "Content-Type": "application/json",
        "X-API-Key": WIP_API_KEY,
    }


def wip_create_document(template_key, data):
    """Create a document in WIP (bulk-first API: wrap in array, unwrap response).
    Returns response dict for the single item, or None on error.
    """
    url = f"{WIP_BASE}/api/document-store/documents"
    item = {
        "template_id": TEMPLATES[template_key],
        "template_version": 1,
        "namespace": NAMESPACE,
        "data": data,
        "created_by": "clintrial-import",
    }
    # WIP bulk-first: body must be an array
    body = [item]
    try:
        resp = requests.post(url, json=body, headers=wip_headers(), verify=False, timeout=30)
        result = resp.json()
        # Response is always 200 with per-item status
        if resp.status_code == 200:
            # Result is an array; unwrap single item
            if isinstance(result, list):
                if len(result) == 0:
                    print(f"    ERROR [{template_key}]: Empty response array")
                    COUNTS["errors"] += 1
                    return None
                item_result = result[0]
            else:
                item_result = result
            # Check for error status (may be "status" or "result" depending on WIP version)
            status = item_result.get("status") or item_result.get("result", "")
            if status == "error":
                err_msg = item_result.get("error", item_result.get("message", "Unknown error"))
                print(f"    ERROR [{template_key}]: {err_msg}")
                COUNTS["errors"] += 1
                return None
            # Determine created vs updated from response
            # WIP may return document_id for created, or version > 1 for updated
            doc_version = item_result.get("version", 1)
            if doc_version > 1:
                item_result["_import_status"] = "updated"
            else:
                item_result["_import_status"] = "created"
            return item_result
        else:
            print(f"    ERROR [{template_key}] HTTP {resp.status_code}: {resp.text[:300]}")
            COUNTS["errors"] += 1
            return None
    except Exception as e:
        print(f"    ERROR [{template_key}]: {e}")
        COUNTS["errors"] += 1
        return None


def normalize_date(date_str):
    """Normalize CT.gov date to YYYY-MM-DD format.
    CT.gov dates may be 'YYYY-MM-DD', 'YYYY-MM', or 'Month YYYY'.
    """
    if not date_str:
        return None
    # Already YYYY-MM-DD
    if re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        return date_str
    # YYYY-MM format
    if re.match(r'^\d{4}-\d{2}$', date_str):
        return f"{date_str}-01"
    # "Month YYYY" format (e.g., "January 2024")
    try:
        from datetime import datetime
        dt = datetime.strptime(date_str, "%B %Y")
        return dt.strftime("%Y-%m-01")
    except ValueError:
        pass
    # "Month DD, YYYY" format
    try:
        from datetime import datetime
        dt = datetime.strptime(date_str, "%B %d, %Y")
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        pass
    return None


def resolve_molecules(interventions):
    """Extract known molecule names from intervention list.
    Returns list of canonical molecule values.
    """
    found = []
    seen = set()
    for intervention in interventions:
        name = intervention.get("name", "")
        # Try exact match (case-insensitive)
        name_lower = name.lower().strip()
        if name_lower in KNOWN_MOLECULES:
            canonical = KNOWN_MOLECULES[name_lower]
            if canonical not in seen:
                found.append(canonical)
                seen.add(canonical)
            continue
        # Try matching individual words/tokens in the intervention name
        for token in re.split(r'[\s,;/+]+', name_lower):
            token = token.strip()
            if token in KNOWN_MOLECULES:
                canonical = KNOWN_MOLECULES[token]
                if canonical not in seen:
                    found.append(canonical)
                    seen.add(canonical)
    return found


def fetch_trials_for_sponsor(sponsor, page_size=10):
    """Search ClinicalTrials.gov for trials by sponsor.
    Returns list of study dicts.
    """
    url = f"{CTGOV_BASE}/studies"
    params = {
        "query.spons": sponsor,
        "pageSize": page_size,
        "filter.overallStatus": "RECRUITING|ACTIVE_NOT_RECRUITING",
        "fields": "protocolSection,hasResults",
    }
    try:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        studies = data.get("studies", [])
        # Filter to only lead-sponsored trials
        result = []
        for study in studies:
            proto = study.get("protocolSection", {})
            sponsor_mod = proto.get("sponsorCollaboratorsModule", {})
            lead = sponsor_mod.get("leadSponsor", {}).get("name", "")
            if lead == sponsor:
                result.append(study)
        return result
    except Exception as e:
        print(f"ERROR fetching trials for {sponsor}: {e}")
        return []


def fetch_trial_detail(nct_id):
    """Fetch full trial detail from ClinicalTrials.gov."""
    url = f"{CTGOV_BASE}/studies/{nct_id}"
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"ERROR fetching detail for {nct_id}: {e}")
        return None


def extract_trial_data(study):
    """Extract all relevant fields from a CT.gov study response."""
    proto = study.get("protocolSection", {})
    ident = proto.get("identificationModule", {})
    status_mod = proto.get("statusModule", {})
    design = proto.get("designModule", {})
    desc = proto.get("descriptionModule", {})
    eligibility = proto.get("eligibilityModule", {})
    arms = proto.get("armsInterventionsModule", {})
    outcomes_mod = proto.get("outcomesModule", {})
    contacts = proto.get("contactsLocationsModule", {})
    sponsor_mod = proto.get("sponsorCollaboratorsModule", {})

    nct_id = ident.get("nctId", "")
    title = ident.get("officialTitle") or ident.get("briefTitle", "")

    return {
        "nct_id": nct_id,
        "title": title,
        "brief_title": ident.get("briefTitle"),
        "acronym": ident.get("acronym"),
        "status": status_mod.get("overallStatus"),
        "phases": design.get("phases", []),
        "study_type": design.get("studyType"),
        "brief_summary": desc.get("briefSummary"),
        "enrollment": design.get("enrollmentInfo", {}).get("count"),
        "start_date": normalize_date(status_mod.get("startDateStruct", {}).get("date")),
        "primary_completion_date": normalize_date(
            status_mod.get("primaryCompletionDateStruct", {}).get("date")
        ),
        "completion_date": normalize_date(
            status_mod.get("completionDateStruct", {}).get("date")
        ),
        "sponsor": sponsor_mod.get("leadSponsor", {}).get("name"),
        "collaborators": [
            c.get("name") for c in sponsor_mod.get("collaborators", []) if c.get("name")
        ],
        "interventions_raw": arms.get("interventions", []),
        "conditions": proto.get("conditionsModule", {}).get("conditions", []),
        "eligibility_criteria": eligibility.get("eligibilityCriteria"),
        "minimum_age": eligibility.get("minimumAge"),
        "maximum_age": eligibility.get("maximumAge"),
        "sex": eligibility.get("sex"),
        "healthy_volunteers": eligibility.get("healthyVolunteers"),
        "has_results": study.get("hasResults", False),
        "url": f"https://clinicaltrials.gov/study/{nct_id}",
        "primary_outcomes": outcomes_mod.get("primaryOutcomes", []),
        "secondary_outcomes": outcomes_mod.get("secondaryOutcomes", []),
        "locations": contacts.get("locations", []),
    }


def create_organization(org_name, org_type="Sponsor"):
    """Create or update an organization document in WIP."""
    data = {"org_name": org_name}
    if org_type:
        data["org_type"] = org_type
    print(f"  Creating org: {org_name}")
    result = wip_create_document("CT_ORGANIZATION", data)
    if result:
        status = result.get("_import_status", "created")
        if status == "created":
            COUNTS["orgs_created"] += 1
        else:
            COUNTS["orgs_updated"] += 1
        print(f"    -> {status}")
    return result


def create_trial(trial_data):
    """Create or update a trial document in WIP."""
    data = {}

    # Required fields
    data["nct_id"] = trial_data["nct_id"]
    data["title"] = trial_data["title"]
    data["status"] = trial_data["status"]
    data["study_type"] = trial_data["study_type"]
    data["sponsor"] = trial_data["sponsor"]  # WIP resolves via identity field

    # Optional fields — only include if present
    for field in [
        "brief_title", "acronym", "brief_summary",
        "eligibility_criteria", "minimum_age", "maximum_age", "sex",
    ]:
        val = trial_data.get(field)
        if val is not None:
            data[field] = val

    # healthy_volunteers — CT.gov returns bool, WIP expects string
    hv = trial_data.get("healthy_volunteers")
    if hv is not None:
        data["healthy_volunteers"] = "Yes" if hv else "No"

    # Date fields
    for date_field in ["start_date", "primary_completion_date", "completion_date"]:
        val = trial_data.get(date_field)
        if val:
            data[date_field] = val

    # Integer fields
    if trial_data.get("enrollment") is not None:
        data["enrollment"] = trial_data["enrollment"]

    # Boolean fields
    data["has_results"] = trial_data.get("has_results", False)

    # Array fields
    if trial_data.get("phases"):
        data["phases"] = trial_data["phases"]

    if trial_data.get("conditions"):
        data["conditions"] = trial_data["conditions"]

    if trial_data.get("collaborators"):
        data["collaborators"] = trial_data["collaborators"]

    # Interventions — only known molecules
    molecules = resolve_molecules(trial_data.get("interventions_raw", []))
    if molecules:
        data["interventions"] = molecules

    # URL
    if trial_data.get("url"):
        data["ctgov_url"] = trial_data["url"]

    # Don't auto-populate therapeutic_areas — requires curated mapping, not raw conditions

    print(f"  Creating trial: {trial_data['nct_id']} - {trial_data['title'][:60]}...")
    result = wip_create_document("CT_TRIAL", data)
    if result:
        status = result.get("_import_status", "created")
        if status == "created":
            COUNTS["trials_created"] += 1
        else:
            COUNTS["trials_updated"] += 1
        print(f"    -> {status}")
    return result


def create_outcomes(nct_id, primary_outcomes, secondary_outcomes):
    """Create outcome documents for a trial."""
    all_outcomes = []
    for i, outcome in enumerate(primary_outcomes):
        all_outcomes.append(("PRIMARY", i + 1, outcome))
    for i, outcome in enumerate(secondary_outcomes):
        all_outcomes.append(("SECONDARY", i + 1, outcome))

    created = 0
    for outcome_type, seq, outcome in all_outcomes:
        data = {
            "nct_id": nct_id,
            "trial": nct_id,  # WIP resolves via identity field on CT_TRIAL
            "outcome_type": outcome_type,
            "sequence": seq,
            "measure": outcome.get("measure", ""),
        }
        if not data["measure"]:
            continue

        if outcome.get("timeFrame"):
            data["time_frame"] = outcome["timeFrame"]
        if outcome.get("description"):
            data["description"] = outcome["description"]

        result = wip_create_document("CT_TRIAL_OUTCOME", data)
        if result:
            status = result.get("_import_status", "created")
            if status == "created":
                COUNTS["outcomes_created"] += 1
            else:
                COUNTS["outcomes_updated"] += 1
            created += 1

    return created


def create_sites(nct_id, locations, max_sites=20):
    """Create site documents for a trial. Limit to max_sites to avoid flooding."""
    created = 0
    for loc in locations[:max_sites]:
        facility = loc.get("facility")
        if not facility:
            continue

        country_name = loc.get("country", "")
        country_code = COUNTRY_MAP.get(country_name)

        data = {
            "nct_id": nct_id,
            "trial": nct_id,  # WIP resolves via identity field on CT_TRIAL
            "facility": facility,
        }

        if loc.get("city"):
            data["city"] = loc["city"]
        if loc.get("state"):
            data["state"] = loc["state"]
        if country_code:
            data["country"] = country_code
        if loc.get("zip"):
            data["zip"] = loc["zip"]
        if loc.get("status"):
            data["site_status"] = loc["status"]

        result = wip_create_document("CT_TRIAL_SITE", data)
        if result:
            status = result.get("_import_status", "created")
            if status == "created":
                COUNTS["sites_created"] += 1
            else:
                COUNTS["sites_updated"] += 1
            created += 1

    return created


def import_trial(study):
    """Import a single trial with all child documents.
    Assumes organization already exists.
    """
    trial_data = extract_trial_data(study)
    nct_id = trial_data["nct_id"]

    if not nct_id:
        print("  SKIP: No NCT ID found")
        return

    print(f"\n{'='*70}")
    print(f"Importing {nct_id}: {trial_data['title'][:70]}")
    print(f"{'='*70}")

    # Step 1: Create the trial
    trial_result = create_trial(trial_data)
    if not trial_result:
        print(f"  FAILED to create trial {nct_id}, skipping outcomes/sites")
        return

    # Brief pause to let WIP index
    time.sleep(0.3)

    # Step 2: Create outcomes
    n_primary = len(trial_data.get("primary_outcomes", []))
    n_secondary = len(trial_data.get("secondary_outcomes", []))
    print(f"  Creating outcomes: {n_primary} primary, {n_secondary} secondary")
    create_outcomes(nct_id, trial_data["primary_outcomes"], trial_data["secondary_outcomes"])

    # Step 3: Create sites (limit to 20 per trial)
    n_locations = len(trial_data.get("locations", []))
    print(f"  Creating sites: {min(n_locations, 20)} of {n_locations} locations")
    create_sites(nct_id, trial_data["locations"], max_sites=20)


def main():
    print("=" * 70)
    print("Clinical Trials Import: Roche/Genentech -> WIP")
    print("=" * 70)

    # Step 1: Fetch trials from both sponsors
    print("\nFetching Hoffmann-La Roche trials...")
    roche_trials = fetch_trials_for_sponsor("Hoffmann-La Roche", page_size=10)
    print(f"  Found {len(roche_trials)} lead-sponsored Roche trials")

    print("\nFetching Genentech, Inc. trials...")
    genentech_trials = fetch_trials_for_sponsor("Genentech, Inc.", page_size=10)
    print(f"  Found {len(genentech_trials)} lead-sponsored Genentech trials")

    # Step 2: Deduplicate by NCT ID and take 5 from each
    seen_ncts = set()
    selected = []

    for study in roche_trials:
        nct = study.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
        if nct and nct not in seen_ncts and len([s for s in selected if s[1] == "Roche"]) < 5:
            seen_ncts.add(nct)
            selected.append((study, "Roche"))

    for study in genentech_trials:
        nct = study.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
        if nct and nct not in seen_ncts and len([s for s in selected if s[1] == "Genentech"]) < 5:
            seen_ncts.add(nct)
            selected.append((study, "Genentech"))

    print(f"\nSelected {len(selected)} trials for import:")
    for study, source in selected:
        nct = study.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
        title = study.get("protocolSection", {}).get("identificationModule", {}).get("briefTitle", "")
        print(f"  [{source}] {nct}: {title[:65]}")

    # Step 3: Create organizations FIRST
    print("\n" + "=" * 70)
    print("Phase 1: Creating Organizations")
    print("=" * 70)
    orgs_to_create = set()
    for study, _ in selected:
        proto = study.get("protocolSection", {})
        sponsor_mod = proto.get("sponsorCollaboratorsModule", {})
        lead = sponsor_mod.get("leadSponsor", {}).get("name")
        if lead:
            orgs_to_create.add(lead)
        for collab in sponsor_mod.get("collaborators", []):
            name = collab.get("name")
            if name:
                orgs_to_create.add(name)

    for org_name in sorted(orgs_to_create):
        create_organization(org_name)
        time.sleep(0.2)

    # Step 4: Fetch full details and import trials
    print("\n" + "=" * 70)
    print("Phase 2: Importing Trials (with outcomes and sites)")
    print("=" * 70)

    for study, source in selected:
        nct_id = study.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
        # Fetch full detail (search results may have limited fields)
        full_study = fetch_trial_detail(nct_id)
        if full_study:
            import_trial(full_study)
        else:
            # Fall back to search result data
            import_trial(study)
        time.sleep(0.5)  # Be nice to both APIs

    # Step 5: Print summary
    print("\n" + "=" * 70)
    print("IMPORT SUMMARY")
    print("=" * 70)
    print(f"  Organizations:  {COUNTS['orgs_created']} created, {COUNTS['orgs_updated']} updated")
    print(f"  Trials:         {COUNTS['trials_created']} created, {COUNTS['trials_updated']} updated")
    print(f"  Outcomes:       {COUNTS['outcomes_created']} created, {COUNTS['outcomes_updated']} updated")
    print(f"  Sites:          {COUNTS['sites_created']} created, {COUNTS['sites_updated']} updated")
    print(f"  Errors:         {COUNTS['errors']}")
    print()
    total = (
        COUNTS["orgs_created"] + COUNTS["orgs_updated"]
        + COUNTS["trials_created"] + COUNTS["trials_updated"]
        + COUNTS["outcomes_created"] + COUNTS["outcomes_updated"]
        + COUNTS["sites_created"] + COUNTS["sites_updated"]
    )
    print(f"  Total documents: {total}")


if __name__ == "__main__":
    main()
