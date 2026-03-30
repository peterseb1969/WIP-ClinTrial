#!/usr/bin/env python3
"""Import Roche/Genentech trials from ClinicalTrials.gov into WIP.

Usage:
    python import_trials.py                    # Incremental: only changed trials since last sync
    python import_trials.py --full             # Full reimport: all trials, ignores sync state
    python import_trials.py --since 2025-01-01 # Only trials updated after this date
    python import_trials.py --limit 100        # Cap at 100 trials per sponsor (for testing)
    python import_trials.py --full --limit 50  # Quick test: 50/sponsor, full reimport
"""

import requests
import json
import sys
import time
import re
import os
import urllib3
from datetime import datetime, timezone
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

WIP_BASE = os.environ.get("WIP_BASE", "https://localhost:8443")
WIP_API_KEY = os.environ.get("WIP_API_KEY", "dev_master_key_for_testing")
CTGOV_BASE = "https://clinicaltrials.gov/api/v2"
NAMESPACE = os.environ.get("WIP_NAMESPACE", "clintrial")
SYNC_STATE_FILE = os.path.join(os.path.dirname(__file__), "..", "data-model", "sync-state.json")

# Template values — IDs are resolved at startup via Registry synonyms
TEMPLATE_VALUES = [
    "CT_ORGANIZATION",
    "CT_TRIAL",
    "CT_TRIAL_OUTCOME",
    "CT_TRIAL_SITE",
    "CT_TRIAL_AE",
    "CT_TRIAL_BASELINE",
]
TEMPLATES = {}  # Populated by resolve_template_ids()

# Organization name -> document_id cache (populated during org creation phase)
ORG_DOC_IDS = {}

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

def check_wip_available():
    """Check if WIP is reachable. Returns True if it is, False otherwise."""
    try:
        resp = requests.get(f"{WIP_BASE}/api/registry/namespaces",
                            headers=wip_headers(), verify=False, timeout=5)
        return resp.status_code == 200
    except Exception:
        return False


def resolve_template_ids():
    """Resolve template IDs from the WIP instance.

    Tries Registry synonym lookup first (preferred — installation-independent).
    Falls back to template-store list API if Registry synonyms aren't registered.
    """
    # Try Registry synonym lookup first
    url = f"{WIP_BASE}/api/registry/entries/lookup/by-key"
    lookups = [
        {"namespace": NAMESPACE, "entity_type": "templates",
         "composite_key": {"ns": NAMESPACE, "type": "template", "value": v}}
        for v in TEMPLATE_VALUES
    ]
    try:
        resp = requests.post(url, json=lookups, headers=wip_headers(), verify=False, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results", data) if isinstance(data, dict) else data
        for r in results:
            if r.get("status") == "found":
                value = r["matched_composite_key"].get("value")
                if value:
                    TEMPLATES[value] = r["entry_id"]
    except Exception:
        pass  # Fall through to template-store fallback

    missing = [v for v in TEMPLATE_VALUES if v not in TEMPLATES]
    if not missing:
        print(f"Resolved {len(TEMPLATES)} template IDs via Registry synonyms")
        return True

    # Fallback: resolve via template-store list API
    try:
        ts_url = f"{WIP_BASE}/api/template-store/templates?namespace={NAMESPACE}&page_size=100"
        resp = requests.get(ts_url, headers=wip_headers(), verify=False, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        items = data.get("items", data) if isinstance(data, dict) else data
        for t in items:
            val = t.get("value")
            if val and val in TEMPLATE_VALUES and val not in TEMPLATES:
                TEMPLATES[val] = t["template_id"]
    except Exception as e:
        print(f"ERROR: Failed to resolve templates: {e}\n")
        return False

    missing = [v for v in TEMPLATE_VALUES if v not in TEMPLATES]
    if missing:
        print(f"ERROR: Could not resolve template IDs for: {missing}")
        print("The data model has not been bootstrapped yet.")
        print("Run /bootstrap in Claude Code to create terminologies and templates.\n")
        return False
    print(f"Resolved {len(TEMPLATES)} template IDs via template-store")
    return True

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
    "aes_created": 0,
    "aes_updated": 0,
    "baselines_created": 0,
    "baselines_updated": 0,
    "files_uploaded": 0,
    "skipped": 0,
    "errors": 0,
}


# ── Therapeutic Area classifier ──────────────────────────────────────
# Built from CT_THERAPEUTIC_AREA seed file: value + label + aliases → keywords
def _build_ta_classifier():
    """Build a condition→therapeutic_areas classifier from the seed file."""
    seed_path = os.path.join(os.path.dirname(__file__), "..", "data-model", "terminologies", "CT_THERAPEUTIC_AREA.json")
    if not os.path.exists(seed_path):
        return {}
    with open(seed_path) as f:
        data = json.load(f)
    # Map: TA value → set of lowercase keywords
    ta_keywords = {}
    for term in data.get("terms", []):
        value = term["value"]
        keywords = set()
        keywords.add(value.replace("_", " ").lower())
        keywords.add(term.get("label", "").lower())
        for alias in term.get("aliases", []):
            keywords.add(alias.lower())
        # Remove very short keywords that cause false positives
        keywords = {k for k in keywords if len(k) > 2}
        ta_keywords[value] = keywords
    return ta_keywords

TA_KEYWORDS = _build_ta_classifier()


def classify_therapeutic_areas(conditions):
    """Classify a list of condition strings into therapeutic area values.
    Returns a deduplicated sorted list of TA values.
    """
    if not conditions or not TA_KEYWORDS:
        return []
    matched = set()
    for condition in conditions:
        cond_lower = condition.lower()
        for ta_value, keywords in TA_KEYWORDS.items():
            for keyword in keywords:
                if len(keyword) <= 4:
                    # Word boundary match for short keywords
                    if re.search(r'\b' + re.escape(keyword) + r'\b', cond_lower):
                        matched.add(ta_value)
                        break
                else:
                    if keyword in cond_lower:
                        matched.add(ta_value)
                        break
    return sorted(matched)


def load_sync_state():
    """Load sync state from file. Returns dict of {nct_id: {last_update, synced_at}}."""
    path = os.path.normpath(SYNC_STATE_FILE)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {"trials": {}, "last_sync": None}


def save_sync_state(state):
    """Save sync state to file."""
    path = os.path.normpath(SYNC_STATE_FILE)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    state["last_sync"] = datetime.now(timezone.utc).isoformat()
    with open(path, "w") as f:
        json.dump(state, f, indent=2)


def get_last_update_date(study):
    """Extract lastUpdatePostDate from a CT.gov study."""
    proto = study.get("protocolSection", {})
    status_mod = proto.get("statusModule", {})
    return status_mod.get("lastUpdatePostDateStruct", {}).get("date", "")


def wip_headers():
    """Return common WIP request headers."""
    return {
        "Content-Type": "application/json",
        "X-API-Key": WIP_API_KEY,
    }


def wip_create_document(template_key, data):
    """Create a single document in WIP. For bulk operations, use wip_create_documents_bulk."""
    results = wip_create_documents_bulk(template_key, [data])
    return results[0] if results else None


def wip_create_documents_bulk(template_key, data_list, batch_size=100):
    """Create multiple documents in WIP via bulk API. Returns list of result dicts.
    Splits into batches of batch_size to avoid oversized requests.
    """
    if not data_list:
        return []

    url = f"{WIP_BASE}/api/document-store/documents"
    all_results = []

    for i in range(0, len(data_list), batch_size):
        chunk = data_list[i:i + batch_size]
        body = [
            {
                "template_id": TEMPLATES[template_key],
                # template_version omitted — WIP resolves to latest active version
                "namespace": NAMESPACE,
                "data": d,
                "created_by": "clintrial-import",
            }
            for d in chunk
        ]
        try:
            resp = requests.post(url, json=body, headers=wip_headers(), verify=False, timeout=120)
            if resp.status_code == 200:
                result = resp.json()
                items = result.get("results", result) if isinstance(result, dict) else result
                if not isinstance(items, list):
                    items = [items]
                for item_result in items:
                    status = item_result.get("status") or item_result.get("result", "")
                    if status == "error":
                        err_msg = item_result.get("error", item_result.get("message", "Unknown error"))
                        print(f"    ERROR [{template_key}]: {err_msg}")
                        COUNTS["errors"] += 1
                        all_results.append(None)
                    else:
                        doc_version = item_result.get("version", 1)
                        item_result["_import_status"] = "updated" if doc_version > 1 else "created"
                        all_results.append(item_result)
            else:
                print(f"    ERROR [{template_key}] HTTP {resp.status_code}: {resp.text[:300]}")
                COUNTS["errors"] += len(chunk)
                all_results.extend([None] * len(chunk))
        except Exception as e:
            print(f"    ERROR [{template_key}]: {e}")
            COUNTS["errors"] += len(chunk)
            all_results.extend([None] * len(chunk))

    return all_results


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


def fetch_trials_for_sponsor(sponsor, max_results=None, since_date=None):
    """Search ClinicalTrials.gov for trials where sponsor appears in any role.
    Paginates through all results. If max_results is set, stops after that many.
    If since_date is set (YYYY-MM-DD), only returns trials updated after that date.
    Returns list of study dicts.
    """
    url = f"{CTGOV_BASE}/studies"
    page_size = min(max_results or 1000, 1000)  # CT.gov max is 1000
    params = {
        "query.spons": sponsor,
        "pageSize": page_size,
        "fields": "protocolSection,hasResults",
    }
    if since_date:
        params["filter.advanced"] = f"AREA[LastUpdatePostDate]RANGE[{since_date},MAX]"

    all_studies = []
    page_token = None

    while True:
        if page_token:
            params["pageToken"] = page_token

        try:
            resp = requests.get(url, params=params, timeout=60)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"  ERROR fetching page for {sponsor}: {e}")
            break

        studies = data.get("studies", [])
        if not studies:
            break

        all_studies.extend(studies)
        print(f"    ... fetched {len(all_studies)} so far")

        if max_results and len(all_studies) >= max_results:
            all_studies = all_studies[:max_results]
            break

        page_token = data.get("nextPageToken")
        if not page_token:
            break

        time.sleep(0.3)  # Be nice to CT.gov API

    return all_studies


def fetch_trial_detail(nct_id):
    """Fetch full trial detail from ClinicalTrials.gov including results and documents."""
    url = f"{CTGOV_BASE}/studies/{nct_id}"
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"ERROR fetching detail for {nct_id}: {e}")
        return None


def fetch_trial_results_and_docs(nct_id):
    """Fetch results section and document section separately (not in search results)."""
    url = f"{CTGOV_BASE}/studies/{nct_id}"
    params = {"fields": "resultsSection,documentSection"}
    try:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"  WARN: Could not fetch results/docs for {nct_id}: {e}")
        return {}


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
    """Create or update a single organization document in WIP."""
    results = create_organizations_bulk([org_name], org_type)
    return results[0] if results else None


def create_organizations_bulk(org_names, org_type="Sponsor"):
    """Create or update organization documents in WIP (bulk)."""
    if not org_names:
        return []

    data_list = []
    for name in org_names:
        data = {"org_name": name}
        if org_type:
            data["org_type"] = org_type
        data_list.append(data)

    print(f"  Creating {len(data_list)} organizations (bulk)...")
    results = wip_create_documents_bulk("CT_ORGANIZATION", data_list)
    for idx, r in enumerate(results):
        if r:
            # Cache document_id for sponsor reference fields
            doc_id = r.get("document_id") or r.get("id")
            if doc_id and idx < len(org_names):
                ORG_DOC_IDS[org_names[idx]] = doc_id
            if r.get("_import_status") == "created":
                COUNTS["orgs_created"] += 1
            else:
                COUNTS["orgs_updated"] += 1
    created = sum(1 for r in results if r and r.get("_import_status") == "created")
    updated = sum(1 for r in results if r and r.get("_import_status") == "updated")
    print(f"    -> {created} created, {updated} updated")
    return results


def create_trial(trial_data):
    """Create or update a trial document in WIP."""
    data = {}

    # Required fields
    data["nct_id"] = trial_data["nct_id"]
    data["title"] = trial_data["title"]
    data["status"] = trial_data["status"]
    data["study_type"] = trial_data["study_type"]
    # sponsor is a reference field — needs document_id of the CT_ORGANIZATION doc
    sponsor_name = trial_data["sponsor"]
    sponsor_doc_id = ORG_DOC_IDS.get(sponsor_name)
    if not sponsor_doc_id:
        print(f"    WARN: No document_id for sponsor '{sponsor_name}', skipping trial {trial_data['nct_id']}")
        COUNTS["errors"] += 1
        return None
    data["sponsor"] = sponsor_doc_id

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

    # Auto-classify therapeutic areas from conditions
    therapeutic_areas = classify_therapeutic_areas(trial_data.get("conditions", []))
    if therapeutic_areas:
        data["therapeutic_areas"] = therapeutic_areas

    # Include file references: use passed-in IDs, or preserve existing ones
    file_ids = trial_data.get("_file_ids")
    if not file_ids:
        file_ids = _get_trial_file_ids(trial_data["nct_id"])
    if file_ids:
        data["documents"] = file_ids

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
    """Create outcome documents for a trial (bulk)."""
    all_outcomes = []
    for i, outcome in enumerate(primary_outcomes):
        all_outcomes.append(("PRIMARY", i + 1, outcome))
    for i, outcome in enumerate(secondary_outcomes):
        all_outcomes.append(("SECONDARY", i + 1, outcome))

    data_list = []
    for outcome_type, seq, outcome in all_outcomes:
        measure = outcome.get("measure", "")
        if not measure:
            continue
        data = {
            "nct_id": nct_id,
            # "trial" reference omitted — needs document_id UUID, nct_id links data instead
            "outcome_type": outcome_type,
            "sequence": seq,
            "measure": measure,
        }
        if outcome.get("timeFrame"):
            data["time_frame"] = outcome["timeFrame"]
        if outcome.get("description"):
            data["description"] = outcome["description"]
        data_list.append(data)

    if not data_list:
        return 0

    created = 0
    results = wip_create_documents_bulk("CT_TRIAL_OUTCOME", data_list)
    for r in results:
        if r:
            if r.get("_import_status") == "created":
                COUNTS["outcomes_created"] += 1
            else:
                COUNTS["outcomes_updated"] += 1
            created += 1

    return created


def create_sites(nct_id, locations, max_sites=20):
    """Create site documents for a trial (bulk). Limit to max_sites to avoid flooding."""
    data_list = []
    for loc in locations[:max_sites]:
        facility = loc.get("facility")
        if not facility:
            continue

        country_name = loc.get("country", "")
        country_code = COUNTRY_MAP.get(country_name)

        data = {
            "nct_id": nct_id,
            # "trial" reference omitted — needs document_id UUID, nct_id links data instead
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
        data_list.append(data)

    if not data_list:
        return 0

    created = 0
    results = wip_create_documents_bulk("CT_TRIAL_SITE", data_list)
    for r in results:
        if r:
            if r.get("_import_status") == "created":
                COUNTS["sites_created"] += 1
            else:
                COUNTS["sites_updated"] += 1
            created += 1

    return created


def create_adverse_events(nct_id, ae_module):
    """Create CT_TRIAL_AE documents from the adverseEventsModule (bulk)."""
    if not ae_module:
        return 0

    event_groups = ae_module.get("eventGroups", [])
    group_titles = {g.get("id"): g.get("title", "") for g in event_groups}

    data_list = []
    for category, events_key in [("SERIOUS", "seriousEvents"), ("OTHER", "otherEvents")]:
        events = ae_module.get(events_key, [])
        for event in events:
            term = event.get("term", "")
            if not term:
                continue

            stats = []
            for s in event.get("stats", []):
                stat = {"group_id": s.get("groupId", "")}
                stat["group_title"] = group_titles.get(stat["group_id"], "")
                if s.get("numEvents") is not None:
                    stat["num_events"] = s["numEvents"]
                if s.get("numAffected") is not None:
                    stat["num_affected"] = s["numAffected"]
                if s.get("numAtRisk") is not None:
                    stat["num_at_risk"] = s["numAtRisk"]
                stats.append(stat)

            data = {
                "nct_id": nct_id,
                # "trial" reference omitted — needs document_id UUID, nct_id links data instead
                "ae_category": category,
                "term": term,
                "stats": stats,
            }
            if event.get("organSystem"):
                data["organ_system"] = event["organSystem"]
            if event.get("sourceVocabulary"):
                data["source_vocabulary"] = event["sourceVocabulary"]
            data_list.append(data)

    if not data_list:
        return 0

    created = 0
    results = wip_create_documents_bulk("CT_TRIAL_AE", data_list)
    for r in results:
        if r:
            s = r.get("_import_status", "created")
            COUNTS["aes_created" if s == "created" else "aes_updated"] += 1
            created += 1

    return created


def create_baselines(nct_id, baseline_module):
    """Create CT_TRIAL_BASELINE documents from baselineCharacteristicsModule (bulk)."""
    if not baseline_module:
        return 0

    groups = baseline_module.get("groups", [])
    group_titles = {g.get("id"): g.get("title", "") for g in groups}

    data_list = []
    for measure in baseline_module.get("measures", []):
        title = measure.get("title", "")
        if not title:
            continue

        data = {
            "nct_id": nct_id,
            # "trial" reference omitted — needs document_id UUID, nct_id links data instead
            "measure_title": title,
        }
        if measure.get("paramType"):
            data["param_type"] = measure["paramType"]
        if measure.get("dispersionType"):
            data["dispersion_type"] = measure["dispersionType"]
        if measure.get("unitOfMeasure"):
            data["unit_of_measure"] = measure["unitOfMeasure"]

        categories = []
        for cls in measure.get("classes", []):
            for cat in cls.get("categories", []):
                cat_data = {}
                if cat.get("title"):
                    cat_data["title"] = cat["title"]
                measurements = []
                for m in cat.get("measurements", []):
                    meas = {"group_id": m.get("groupId", "")}
                    meas["group_title"] = group_titles.get(meas["group_id"], "")
                    if m.get("value") is not None:
                        meas["value"] = str(m["value"])
                    if m.get("spread") is not None:
                        meas["spread"] = str(m["spread"])
                    if m.get("lowerLimit") is not None:
                        meas["lower_limit"] = str(m["lowerLimit"])
                    if m.get("upperLimit") is not None:
                        meas["upper_limit"] = str(m["upperLimit"])
                    measurements.append(meas)
                cat_data["measurements"] = measurements
                categories.append(cat_data)

        if categories:
            data["categories"] = categories
        data_list.append(data)

    if not data_list:
        return 0

    created = 0
    results = wip_create_documents_bulk("CT_TRIAL_BASELINE", data_list)
    for r in results:
        if r:
            s = r.get("_import_status", "created")
            COUNTS["baselines_created" if s == "created" else "baselines_updated"] += 1
            created += 1

    return created


def update_outcome_with_results(nct_id, results_outcomes):
    """Update existing CT_TRIAL_OUTCOME documents with numeric result data (bulk)."""
    if not results_outcomes:
        return 0

    data_list = []
    for om in results_outcomes:
        otype = om.get("type", "").upper()
        if otype not in ("PRIMARY", "SECONDARY"):
            otype = "OTHER"

        result_groups = []
        groups = om.get("groups", [])
        group_titles = {g.get("id"): g.get("title", "") for g in groups}

        for cls in om.get("classes", []):
            for cat in cls.get("categories", []):
                for m in cat.get("measurements", []):
                    rg = {"group_id": m.get("groupId", "")}
                    rg["group_title"] = group_titles.get(rg["group_id"], "")
                    if m.get("value") is not None:
                        rg["value"] = str(m["value"])
                    if m.get("spread") is not None:
                        rg["spread"] = str(m["spread"])
                    if m.get("lowerLimit") is not None:
                        rg["lower_limit"] = str(m["lowerLimit"])
                    if m.get("upperLimit") is not None:
                        rg["upper_limit"] = str(m["upperLimit"])
                    if m.get("numSubjects"):
                        rg["num_subjects"] = str(m["numSubjects"])
                    result_groups.append(rg)

        analyses = []
        for a in om.get("analyses", []):
            analysis = {}
            if a.get("groupIds"):
                analysis["group_ids"] = a["groupIds"]
            if a.get("pValue"):
                analysis["p_value"] = a["pValue"]
            if a.get("statisticalMethod"):
                analysis["statistical_method"] = a["statisticalMethod"]
            if a.get("nonInferiorityType"):
                analysis["non_inferiority_type"] = a["nonInferiorityType"]
            if analysis:
                analyses.append(analysis)

        measure = om.get("title", "")
        if not measure:
            continue

        same_type = [o for o in results_outcomes if (o.get("type", "").upper() or "OTHER") == otype]
        seq = next((i + 1 for i, o in enumerate(same_type) if o is om), 1)

        data = {
            "nct_id": nct_id,
            # "trial" reference omitted — needs document_id UUID, nct_id links data instead
            "outcome_type": otype,
            "sequence": seq,
            "measure": measure,
        }
        if om.get("timeFrame"):
            data["time_frame"] = om["timeFrame"]
        if om.get("description"):
            data["description"] = om["description"]
        if om.get("paramType"):
            data["param_type"] = om["paramType"]
        if om.get("dispersionType"):
            data["dispersion_type"] = om["dispersionType"]
        if om.get("unitOfMeasure"):
            data["unit_of_measure"] = om["unitOfMeasure"]
        if result_groups:
            data["result_groups"] = result_groups
        if analyses:
            data["analyses"] = analyses
        data_list.append(data)

    if not data_list:
        return 0

    updated = 0
    results = wip_create_documents_bulk("CT_TRIAL_OUTCOME", data_list)
    for r in results:
        if r:
            COUNTS["outcomes_updated"] += 1
            updated += 1

    return updated


def download_pdfs_to_disk(nct_id, doc_section, raw_dir):
    """Download protocol/SAP PDFs from CT.gov to local disk. Skips existing files."""
    if not doc_section or not raw_dir:
        return 0

    large_docs = doc_section.get("largeDocumentModule", {}).get("largeDocs", [])
    if not large_docs:
        return 0

    nct_num = nct_id.replace("NCT", "")
    last2 = nct_num[-2:]
    pdf_dir = os.path.join(raw_dir, nct_id)
    downloaded = 0

    for doc in large_docs:
        filename = doc.get("filename", "")
        if not filename:
            continue
        type_abbrev = doc.get("typeAbbrev", "")
        if not any(t in type_abbrev for t in ["Prot", "SAP", "ICF"]):
            continue

        local_path = os.path.join(pdf_dir, filename)
        if os.path.exists(local_path):
            continue  # Already downloaded

        download_url = f"https://cdn.clinicaltrials.gov/large-docs/{last2}/{nct_id}/{filename}"
        try:
            resp = requests.get(download_url, timeout=60)
            if resp.status_code != 200:
                print(f"    WARN: Failed to download {filename} (HTTP {resp.status_code})")
                continue
            os.makedirs(pdf_dir, exist_ok=True)
            with open(local_path, "wb") as f:
                f.write(resp.content)
            size_kb = len(resp.content) // 1024
            print(f"    PDF: {filename} ({size_kb}KB)")
            downloaded += 1
        except Exception as e:
            print(f"    WARN: Error downloading {filename}: {e}")

    return downloaded


def classify_pdf(filename):
    """Classify a PDF filename into category and human-readable type."""
    fn = filename.lower()
    if fn.startswith("prot_sap") or fn.startswith("protsap"):
        return "protocol_sap", "Protocol & SAP"
    elif fn.startswith("prot"):
        return "protocol", "Protocol"
    elif fn.startswith("sap"):
        return "sap", "Statistical Analysis Plan"
    elif fn.startswith("icf"):
        return "icf", "Informed Consent Form"
    else:
        return "other", "Document"


def upload_pdfs_from_disk(nct_id, raw_dir):
    """Upload PDFs from local disk to WIP file storage with proper metadata.
    Returns list of file_ids. Skips entirely if trial already has files linked.
    """
    pdf_dir = os.path.join(raw_dir, nct_id)
    if not os.path.isdir(pdf_dir):
        return []

    pdf_files = sorted(f for f in os.listdir(pdf_dir) if f.lower().endswith(".pdf"))
    if not pdf_files:
        return []

    # Check if trial already has files linked (idempotency)
    existing_file_ids = _get_trial_file_ids(nct_id)
    if existing_file_ids and len(existing_file_ids) >= len(pdf_files):
        print(f"    Trial {nct_id} already has {len(existing_file_ids)} file(s) linked, skipping upload")
        return existing_file_ids

    file_ids = list(existing_file_ids) if existing_file_ids else []
    for filename in pdf_files:
        local_path = os.path.join(pdf_dir, filename)
        category, doc_type = classify_pdf(filename)

        # Build a tagged filename: NCT00130533_Prot_000.pdf
        tagged_filename = f"{nct_id}_{filename}" if not filename.startswith(nct_id) else filename

        try:
            with open(local_path, "rb") as f:
                content = f.read()
            size_kb = len(content) // 1024

            upload_url = f"{WIP_BASE}/api/document-store/files"
            files_payload = {"file": (tagged_filename, content, "application/pdf")}
            form_data = {
                "namespace": NAMESPACE,
                "description": f"{doc_type} for {nct_id}",
                "tags": f"{category},{nct_id}",
                "category": category,
                "allowed_templates": "CT_TRIAL",
            }
            upload_resp = requests.post(
                upload_url,
                files=files_payload,
                data=form_data,
                headers={"X-API-Key": WIP_API_KEY},
                verify=False,
                timeout=60,
            )
            if upload_resp.status_code == 200:
                upload_result = upload_resp.json()
                fid = None
                if isinstance(upload_result, list) and upload_result:
                    fid = upload_result[0].get("file_id") or upload_result[0].get("id")
                elif isinstance(upload_result, dict):
                    fid = upload_result.get("file_id") or upload_result.get("id")
                if fid:
                    file_ids.append(fid)
                    COUNTS["files_uploaded"] += 1
                    print(f"    Uploaded {tagged_filename} ({size_kb}KB) -> {fid}")
            else:
                print(f"    WARN: Upload failed for {filename} (HTTP {upload_resp.status_code})")
        except Exception as e:
            print(f"    WARN: Error uploading {filename}: {e}")

    return file_ids


def _get_trial_file_ids(nct_id):
    """Get file IDs already linked to a trial's documents field. Returns list or None."""
    try:
        resp = requests.post(
            f"{WIP_BASE}/api/reporting-sync/query",
            json={
                "sql": "SELECT documents FROM doc_ct_trial WHERE nct_id = $1",
                "params": [nct_id],
                "max_rows": 1,
            },
            headers=wip_headers(),
            verify=False,
            timeout=10,
        )
        if resp.status_code == 200:
            rows = resp.json().get("rows", [])
            if rows and rows[0].get("documents"):
                docs = rows[0]["documents"]
                if isinstance(docs, str):
                    docs = json.loads(docs)
                if isinstance(docs, list) and docs:
                    ids = []
                    for ref in docs:
                        if isinstance(ref, str):
                            ids.append(ref)
                        elif isinstance(ref, dict):
                            fid = ref.get("file_id", ref.get("id"))
                            if fid:
                                ids.append(fid)
                    return ids if ids else None
    except Exception:
        pass
    return None


def link_files_to_trial(nct_id, file_ids):
    """Update a trial document to reference the given file IDs in its documents field.
    Fetches the existing document data and re-submits with files added.
    """
    if not file_ids:
        return

    # Fetch existing trial data (mandatory fields needed for upsert)
    try:
        resp = requests.post(
            f"{WIP_BASE}/api/reporting-sync/query",
            json={
                "sql": "SELECT title, data_status, study_type, sponsor, documents FROM doc_ct_trial WHERE nct_id = $1",
                "params": [nct_id],
                "max_rows": 1,
            },
            headers=wip_headers(),
            verify=False,
            timeout=10,
        )
        if resp.status_code != 200 or not resp.json().get("rows"):
            print(f"    WARN: Cannot fetch trial {nct_id} for file linking")
            return
        row = resp.json()["rows"][0]
    except Exception as e:
        print(f"    WARN: Error fetching trial {nct_id}: {e}")
        return

    # Check if files already linked
    existing_docs = row.get("documents")
    if existing_docs:
        if isinstance(existing_docs, str):
            existing_docs = json.loads(existing_docs)
        existing_ids = set()
        if isinstance(existing_docs, list):
            for ref in existing_docs:
                if isinstance(ref, str):
                    existing_ids.add(ref)
                elif isinstance(ref, dict):
                    existing_ids.add(ref.get("file_id", ref.get("id", "")))
        if set(file_ids).issubset(existing_ids):
            print(f"    Files already linked to {nct_id}, skipping")
            return
        # Merge: add new file_ids to existing ones
        file_ids = list(existing_ids | set(file_ids))

    # Re-submit with mandatory fields + documents
    data = {
        "nct_id": nct_id,
        "title": row["title"],
        "status": row["data_status"],
        "study_type": row["study_type"],
        "documents": file_ids,
    }
    # sponsor is a reference field — needs document_id
    sponsor_doc_id = ORG_DOC_IDS.get(row["sponsor"])
    if sponsor_doc_id:
        data["sponsor"] = sponsor_doc_id
    else:
        data["sponsor"] = row["sponsor"]  # fallback, may fail validation

    body = [{
        "template_id": TEMPLATES["CT_TRIAL"],
        "namespace": NAMESPACE,
        "data": data,
        "created_by": "clintrial-import",
    }]
    try:
        resp = requests.post(
            f"{WIP_BASE}/api/document-store/documents",
            json=body,
            headers=wip_headers(),
            verify=False,
            timeout=30,
        )
        if resp.status_code == 200:
            result = resp.json()
            items = result.get("results", result) if isinstance(result, dict) else result
            if isinstance(items, list) and items:
                item = items[0]
                if item.get("status") == "error":
                    print(f"    WARN: Failed to link files to {nct_id}: {item.get('error', 'unknown')}")
                else:
                    print(f"    Linked {len(file_ids)} file(s) to {nct_id}")
        else:
            print(f"    WARN: Failed to link files to {nct_id} (HTTP {resp.status_code})")
    except Exception as e:
        print(f"    WARN: Error linking files to {nct_id}: {e}")


def download_and_upload_documents(nct_id, doc_section):
    """Download protocol/SAP PDFs from CT.gov and upload to WIP."""
    if not doc_section:
        return []

    large_docs = doc_section.get("largeDocumentModule", {}).get("largeDocs", [])
    if not large_docs:
        return []

    file_ids = []
    nct_num = nct_id.replace("NCT", "")
    last2 = nct_num[-2:]

    for doc in large_docs:
        filename = doc.get("filename", "")
        if not filename:
            continue
        # Only download protocols and SAPs
        type_abbrev = doc.get("typeAbbrev", "")
        if not any(t in type_abbrev for t in ["Prot", "SAP", "ICF"]):
            continue

        download_url = f"https://cdn.clinicaltrials.gov/large-docs/{last2}/{nct_id}/{filename}"
        try:
            resp = requests.get(download_url, timeout=60)
            if resp.status_code != 200:
                print(f"    WARN: Failed to download {filename} (HTTP {resp.status_code})")
                continue

            # Upload to WIP file storage
            upload_url = f"{WIP_BASE}/api/document-store/files"
            files_payload = {"file": (filename, resp.content, "application/pdf")}
            form_data = {"namespace": NAMESPACE}
            upload_resp = requests.post(
                upload_url,
                files=files_payload,
                data=form_data,
                headers={"X-API-Key": WIP_API_KEY},
                verify=False,
                timeout=60,
            )
            if upload_resp.status_code == 200:
                upload_result = upload_resp.json()
                # Extract file_id from response
                fid = None
                if isinstance(upload_result, list) and upload_result:
                    fid = upload_result[0].get("file_id") or upload_result[0].get("id")
                elif isinstance(upload_result, dict):
                    fid = upload_result.get("file_id") or upload_result.get("id")
                if fid:
                    file_ids.append(fid)
                    COUNTS["files_uploaded"] += 1
                    size_kb = len(resp.content) // 1024
                    print(f"    Uploaded {filename} ({size_kb}KB) -> {fid}")
                else:
                    print(f"    WARN: Upload succeeded but no file_id in response: {json.dumps(upload_result)[:200]}")
            else:
                print(f"    WARN: Upload failed for {filename} (HTTP {upload_resp.status_code}): {upload_resp.text[:200]}")
        except Exception as e:
            print(f"    WARN: Error downloading/uploading {filename}: {e}")

    return file_ids


def import_trial(study, save_raw_dir=None, extra_data=None, file_ids=None):
    """Import a single trial with all child documents.
    Assumes organization already exists.

    Args:
        study: The CT.gov study dict (protocolSection etc.)
        save_raw_dir: If set, save raw results/docs JSON to this directory
        extra_data: Pre-loaded results/documents data (from disk). If provided,
                    skip fetching from CT.gov.
        file_ids: Pre-uploaded file IDs to attach to the trial document.
    """
    trial_data = extract_trial_data(study)
    if file_ids:
        trial_data["_file_ids"] = file_ids
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
        print(f"  FAILED to create trial {nct_id}, skipping child documents")
        return

    # Brief pause to let WIP index
    time.sleep(0.3)

    # Step 2: Create outcomes (basic endpoint descriptions)
    n_primary = len(trial_data.get("primary_outcomes", []))
    n_secondary = len(trial_data.get("secondary_outcomes", []))
    print(f"  Creating outcomes: {n_primary} primary, {n_secondary} secondary")
    create_outcomes(nct_id, trial_data["primary_outcomes"], trial_data["secondary_outcomes"])

    # Step 3: Create sites (limit to 50 per trial)
    n_locations = len(trial_data.get("locations", []))
    max_s = 50
    print(f"  Creating sites: {min(n_locations, max_s)} of {n_locations} locations")
    create_sites(nct_id, trial_data["locations"], max_sites=max_s)

    # Step 4: Wave 2 — Results, AEs, Baselines, PDFs
    # Use pre-loaded data if available, otherwise fetch from CT.gov
    has_results = trial_data.get("has_results", False)
    extra = extra_data  # May be None or pre-loaded from disk

    if extra is None and (has_results or save_raw_dir):
        # Only fetch from CT.gov when NOT using pre-loaded data
        print(f"  Fetching results and documents for {nct_id} from CT.gov...")
        extra = fetch_trial_results_and_docs(nct_id)
        if save_raw_dir and extra:
            results_path = os.path.join(save_raw_dir, f"{nct_id}_results.json")
            with open(results_path, "w") as f:
                json.dump(extra, f, indent=2)

    if extra:
        results_section = extra.get("resultsSection", {})

        # 4a: Adverse events
        ae_module = results_section.get("adverseEventsModule", {})
        n_serious = len(ae_module.get("seriousEvents", []))
        n_other = len(ae_module.get("otherEvents", []))
        if n_serious or n_other:
            print(f"  Creating AEs: {n_serious} serious, {n_other} other")
            create_adverse_events(nct_id, ae_module)

        # 4b: Baseline characteristics
        baseline_module = results_section.get("baselineCharacteristicsModule", {})
        n_baselines = len(baseline_module.get("measures", []))
        if n_baselines:
            print(f"  Creating baselines: {n_baselines} measures")
            create_baselines(nct_id, baseline_module)

        # 4c: Update outcomes with numeric result data
        outcome_measures = results_section.get("outcomeMeasuresModule", {}).get("outcomeMeasures", [])
        if outcome_measures:
            print(f"  Updating outcomes with results: {len(outcome_measures)} measures")
            update_outcome_with_results(nct_id, outcome_measures)

        # 4d: Download protocol/SAP PDFs (only when fetching from CT.gov, not from disk)
        if extra_data is None:
            doc_section = extra.get("documentSection", {})
            n_docs = len(doc_section.get("largeDocumentModule", {}).get("largeDocs", []))
            if n_docs:
                print(f"  Downloading {n_docs} document(s) from CT.gov...")
                file_ids = download_and_upload_documents(nct_id, doc_section)
                if file_ids:
                    link_files_to_trial(nct_id, file_ids)


def parse_args():
    """Parse command-line arguments."""
    import argparse
    parser = argparse.ArgumentParser(
        description="Import Roche/Genentech clinical trials from ClinicalTrials.gov into WIP.",
        epilog="Examples:\n"
               "  %(prog)s                        Incremental: only changed trials since last sync\n"
               "  %(prog)s --full                  Full reimport: all trials, ignores sync state\n"
               "  %(prog)s --since 2025-01-01      Only trials updated after this date\n"
               "  %(prog)s --limit 100             Cap at 100 trials per sponsor (for testing)\n"
               "  %(prog)s --full --limit 50       Quick test: 50/sponsor, full reimport\n"
               "  %(prog)s --download-only --full       Download JSON + PDFs from CT.gov (no WIP)\n"
               "  %(prog)s --download-pdfs-only        Download missing PDFs for existing dump\n"
               "  %(prog)s --from-raw data/raw         Import from saved JSON + PDFs into WIP\n"
               "  %(prog)s --nct NCT01702571           Fetch a specific trial by NCT ID\n"
               "  %(prog)s --download-only --nct NCT01702571 NCT00308516\n",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--full", action="store_true",
                        help="Full reimport: fetch all trials, ignore sync state")
    parser.add_argument("--since", metavar="DATE",
                        help="Only import trials updated after DATE (YYYY-MM-DD)")
    parser.add_argument("--limit", type=int, metavar="N",
                        help="Cap at N trials per sponsor (useful for testing)")
    parser.add_argument("--save-raw", metavar="DIR", nargs="?", const="data/raw",
                        help="Save raw CT.gov JSON responses to DIR (default: data/raw)")
    parser.add_argument("--download-only", action="store_true",
                        help="Download from CT.gov and save raw JSON + PDFs — do not load into WIP. Implies --save-raw")
    parser.add_argument("--download-pdfs-only", metavar="DIR", nargs="?", const="data/raw",
                        help="Download only missing PDFs for existing raw dump in DIR (default: data/raw)")
    parser.add_argument("--from-raw", metavar="DIR",
                        help="Import from previously saved raw JSON files + PDFs instead of fetching from CT.gov")
    parser.add_argument("--nct", nargs="+", metavar="NCT_ID",
                        help="Fetch specific trial(s) by NCT ID instead of searching by sponsor")
    return parser.parse_args()


def _print_summary(elapsed_total):
    """Print the import summary with document counts."""
    mins = int(elapsed_total // 60)
    secs = int(elapsed_total % 60)
    print("\n" + "=" * 70)
    print(f"IMPORT SUMMARY  ({mins}m{secs:02d}s elapsed)")
    print("=" * 70)
    print(f"  Organizations:  {COUNTS['orgs_created']} created, {COUNTS['orgs_updated']} updated")
    print(f"  Trials:         {COUNTS['trials_created']} created, {COUNTS['trials_updated']} updated")
    print(f"  Outcomes:       {COUNTS['outcomes_created']} created, {COUNTS['outcomes_updated']} updated")
    print(f"  Sites:          {COUNTS['sites_created']} created, {COUNTS['sites_updated']} updated")
    print(f"  Adverse Events: {COUNTS['aes_created']} created, {COUNTS['aes_updated']} updated")
    print(f"  Baselines:      {COUNTS['baselines_created']} created, {COUNTS['baselines_updated']} updated")
    print(f"  Files uploaded: {COUNTS['files_uploaded']}")
    print(f"  Skipped:        {COUNTS['skipped']} (unchanged)")
    print(f"  Errors:         {COUNTS['errors']}")
    print()
    total = sum(v for k, v in COUNTS.items() if k not in ("errors", "skipped"))
    print(f"  Total documents: {total}")


def get_wip_nct_ids():
    """Query WIP for all NCT IDs currently in the database. Returns a set."""
    url = f"{WIP_BASE}/api/reporting-sync/query"
    try:
        resp = requests.post(url, json={
            "sql": "SELECT DISTINCT nct_id FROM doc_ct_trial",
            "params": [],
            "max_rows": 50000,
        }, headers=wip_headers(), verify=False, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            return set(row["nct_id"] for row in data.get("rows", []))
    except Exception:
        pass
    return set()


def resolve_raw_dir(raw_dir):
    """Resolve a raw directory path relative to the project root."""
    return os.path.normpath(os.path.join(os.path.dirname(__file__), "..", raw_dir))


def load_from_raw_dir(raw_dir, nct_filter=None):
    """Load trial studies from previously saved raw JSON files.
    If nct_filter is set, only load those specific NCT IDs.
    Returns list of (study, source, ct_update, nct_id) tuples.
    """
    raw_dir = resolve_raw_dir(raw_dir)
    if not os.path.isdir(raw_dir):
        print(f"FATAL: Raw directory does not exist: {raw_dir}")
        sys.exit(1)

    if nct_filter:
        # Only load specific NCT IDs
        filter_set = set(nct_filter)
        files = sorted(f"{nct}.json" for nct in filter_set
                        if os.path.exists(os.path.join(raw_dir, f"{nct}.json")))
        missing = filter_set - {f.replace(".json", "") for f in files}
        if missing:
            print(f"  WARN: {len(missing)} NCT ID(s) not found in {raw_dir}: {', '.join(sorted(missing)[:5])}")
    else:
        files = sorted(f for f in os.listdir(raw_dir)
                        if f.startswith("NCT") and not f.endswith("_results.json") and f.endswith(".json"))

    print(f"Found {len(files)} raw study files in {raw_dir}")

    selected = []
    for fname in files:
        with open(os.path.join(raw_dir, fname)) as f:
            study = json.load(f)
        nct_id = fname.replace(".json", "")
        ct_update = get_last_update_date(study)
        selected.append((study, "raw", ct_update, nct_id))

    return selected


def main():
    args = parse_args()

    # ── Validate flag combinations ───────────────────────────────────────
    if args.download_pdfs_only:
        ignored = []
        if args.full: ignored.append("--full")
        if args.since: ignored.append("--since")
        if args.limit: ignored.append("--limit")
        if args.save_raw: ignored.append("--save-raw")
        if args.download_only: ignored.append("--download-only")
        if args.from_raw: ignored.append("--from-raw")
        if args.nct: ignored.append("--nct")
        if ignored:
            print(f"ERROR: --download-pdfs-only cannot be combined with: {', '.join(ignored)}")
            print(f"\nUsage: python scripts/import_trials.py --download-pdfs-only [DIR]")
            print(f"  DIR defaults to data/raw if not specified.")
            sys.exit(1)

    if args.download_only and args.from_raw:
        print("ERROR: --download-only and --from-raw cannot be combined.")
        print("  --download-only fetches from CT.gov and saves to disk.")
        print("  --from-raw loads from disk into WIP.")
        sys.exit(1)

    # ── Mode: Download only missing PDFs ─────────────────────────────────
    if args.download_pdfs_only:
        raw_dir = resolve_raw_dir(args.download_pdfs_only)
        if not os.path.isdir(raw_dir):
            print(f"FATAL: Directory does not exist: {raw_dir}")
            sys.exit(1)

        results_files = sorted(f for f in os.listdir(raw_dir) if f.endswith("_results.json"))
        print("=" * 70)
        print(f"Downloading missing PDFs for {len(results_files)} trials")
        print(f"Source: {raw_dir}")
        print("=" * 70)

        total_pdfs = 0
        for idx, fname in enumerate(results_files, 1):
            nct_id = fname.replace("_results.json", "")
            with open(os.path.join(raw_dir, fname)) as f:
                extra = json.load(f)
            doc_section = extra.get("documentSection", {})
            n_docs = len(doc_section.get("largeDocumentModule", {}).get("largeDocs", []))
            if n_docs == 0:
                continue
            print(f"  [{idx}/{len(results_files)}] {nct_id}: {n_docs} document(s)")
            total_pdfs += download_pdfs_to_disk(nct_id, doc_section, raw_dir)
            time.sleep(0.2)

        print(f"\nDone. Downloaded {total_pdfs} PDF(s).")
        return

    # ── Normal / download-only / from-raw modes ─────────────────────────
    download_only = args.download_only
    from_raw = args.from_raw

    # --download-only implies --save-raw
    save_raw_dir = args.save_raw
    if download_only and not save_raw_dir:
        save_raw_dir = "data/raw"
    if save_raw_dir:
        save_raw_dir = resolve_raw_dir(save_raw_dir)
        os.makedirs(save_raw_dir, exist_ok=True)
        print(f"Saving raw CT.gov responses to: {save_raw_dir}")

    # Determine if WIP is needed and available
    needs_wip = not download_only
    wip_ready = False

    if needs_wip:
        wip_available = check_wip_available()
        if not wip_available:
            print("=" * 70)
            print("WIP is not reachable.")
            print("=" * 70)
            print()
            print("You can still use this script without WIP:")
            print()
            print("  Download trials from ClinicalTrials.gov (no WIP needed):")
            print("    python scripts/import_trials.py --download-only --full --limit 100")
            print()
            print("To import into WIP, ensure WIP is running and bootstrapped:")
            print("  1. Start WIP services")
            print("  2. Run /bootstrap in Claude Code to create the data model")
            print("  3. Then run this script (or use --from-raw to import saved data)")
            print()
            sys.exit(1)

        wip_ready = resolve_template_ids()
        if not wip_ready:
            print("=" * 70)
            print("WIP is running but the data model is not bootstrapped.")
            print("=" * 70)
            print()
            print("Options:")
            print()
            print("  1. Bootstrap the data model first, then import:")
            print("     Run /bootstrap in Claude Code, then re-run this script")
            print()
            print("  2. Download trials offline (no WIP needed):")
            print("     python scripts/import_trials.py --download-only --full --limit 100")
            print()
            print("  3. Import from a previous download after bootstrapping:")
            print("     python scripts/import_trials.py --from-raw data/raw")
            print()
            sys.exit(1)

    full_mode = args.full
    since_override = args.since
    target_per_sponsor = args.limit

    # ── Mode: Import from raw files ──────────────────────────────────────
    if from_raw:
        raw_entries = load_from_raw_dir(from_raw, nct_filter=args.nct)

        # Filter unchanged trials (unless --full)
        sync_state = load_sync_state()
        known_trials = sync_state.get("trials", {})
        if not full_mode:
            # Primary check: what's actually in WIP
            wip_ncts = get_wip_nct_ids()
            if wip_ncts:
                print(f"WIP has {len(wip_ncts)} existing trials")
            # Fast path: sync state for lastUpdatePostDate comparison
            filtered = []
            for entry in raw_entries:
                study, source, ct_update, nct_id = entry
                # If in WIP AND sync state says unchanged → skip
                if nct_id in wip_ncts:
                    prev = known_trials.get(nct_id, {})
                    if prev.get("last_update") == ct_update and ct_update:
                        COUNTS["skipped"] += 1
                        continue
                    # In WIP but sync state differs or missing → re-import (update)
                filtered.append(entry)
            raw_entries = filtered
            if COUNTS["skipped"]:
                print(f"Skipped {COUNTS['skipped']} unchanged trials (use --full to reimport all)")

        if target_per_sponsor:
            raw_entries = raw_entries[:target_per_sponsor]

        print("=" * 70)
        print(f"Clinical Trials Import: from raw files ({from_raw})")
        print(f"Trials to import: {len(raw_entries)}" +
              (f" ({COUNTS['skipped']} skipped, unchanged)" if COUNTS['skipped'] else ""))
        print("=" * 70)

        # Create organizations
        print("\n" + "=" * 70)
        print("Phase 1: Creating Organizations")
        print("=" * 70)
        orgs_to_create = set()
        for study, _, _, _ in raw_entries:
            proto = study.get("protocolSection", {})
            sponsor_mod = proto.get("sponsorCollaboratorsModule", {})
            lead = sponsor_mod.get("leadSponsor", {}).get("name")
            if lead:
                orgs_to_create.add(lead)
            for collab in sponsor_mod.get("collaborators", []):
                name = collab.get("name")
                if name:
                    orgs_to_create.add(name)
        create_organizations_bulk(sorted(orgs_to_create))

        # Import trials
        print("\n" + "=" * 70)
        print("Phase 2: Importing Trials")
        print("=" * 70)
        raw_dir_resolved = resolve_raw_dir(from_raw)
        total = len(raw_entries)
        import_start = time.time()

        for idx, (study, source, ct_update, nct_id) in enumerate(raw_entries, 1):
            elapsed = time.time() - import_start
            eta = ""
            if idx > 1:
                rate = (idx - 1) / elapsed
                remaining = (total - idx + 1) / rate
                eta = f"  ETA {int(remaining // 60)}m{int(remaining % 60):02d}s"
            print(f"\n[{idx}/{total}]{eta}")

            # Load pre-saved results/documents from disk (no network needed)
            results_path = os.path.join(raw_dir_resolved, f"{nct_id}_results.json")
            extra_data = None
            if os.path.exists(results_path):
                with open(results_path) as f:
                    extra_data = json.load(f)
                # Also merge into study for extract_trial_data compatibility
                if extra_data.get("resultsSection"):
                    study["resultsSection"] = extra_data["resultsSection"]

            # Upload PDFs first so import_trial can include them in the document
            pdf_file_ids = upload_pdfs_from_disk(nct_id, raw_dir_resolved)

            import_trial(study, extra_data=extra_data, file_ids=pdf_file_ids)

            # Record in sync state
            sync_state["trials"][nct_id] = {
                "last_update": ct_update,
                "synced_at": datetime.now(timezone.utc).isoformat(),
                "source": source,
            }
            if idx % 50 == 0:
                save_sync_state(sync_state)
                print(f"  [checkpoint: sync state saved at {idx}/{total}]")

            time.sleep(0.1)

        save_sync_state(sync_state)
        _print_summary(time.time() - import_start)
        return

    # ── Mode: Fetch from CT.gov ──────────────────────────────────────────
    sync_state = load_sync_state()
    last_sync = sync_state.get("last_sync")
    known_trials = sync_state.get("trials", {})
    nct_ids = args.nct

    if nct_ids:
        mode_label = f"SPECIFIC ({len(nct_ids)} trial(s))"
        since_date = None
    elif full_mode:
        since_date = None
        mode_label = "FULL (reimporting everything)"
    elif since_override:
        since_date = since_override
        mode_label = f"INCREMENTAL (since {since_date}, user-specified)"
    elif last_sync:
        from datetime import timedelta
        last_dt = datetime.fromisoformat(last_sync.replace("Z", "+00:00"))
        safe_date = (last_dt - timedelta(days=1)).strftime("%Y-%m-%d")
        since_date = safe_date
        mode_label = f"INCREMENTAL (since {since_date}, based on last sync {last_sync[:10]})"
    else:
        since_date = None
        mode_label = "FULL (first run, no sync state)"

    if download_only:
        mode_label += " [DOWNLOAD ONLY — no WIP loading]"

    print("=" * 70)
    print("Clinical Trials Import: Roche/Genentech -> WIP")
    print(f"Mode: {mode_label}")
    print(f"Known trials in sync state: {len(known_trials)}")
    print("=" * 70)

    selected = []

    if nct_ids:
        # Fetch specific trials by NCT ID
        print(f"\nFetching {len(nct_ids)} specific trial(s)...")
        for nct_id in nct_ids:
            study = fetch_trial_detail(nct_id)
            if study:
                ct_update = get_last_update_date(study)
                selected.append((study, "specific", ct_update))
                print(f"  {nct_id}: OK")
            else:
                print(f"  {nct_id}: NOT FOUND")
    else:
        # Fetch trials from both sponsors
        limit_label = str(target_per_sponsor) if target_per_sponsor else "all"
        print(f"\nFetching Hoffmann-La Roche trials (limit: {limit_label})...")
        roche_trials = fetch_trials_for_sponsor("Hoffmann-La Roche", max_results=target_per_sponsor, since_date=since_date)
        print(f"  Found {len(roche_trials)} Roche trials")

        print(f"\nFetching Genentech, Inc. trials (limit: {limit_label})...")
        genentech_trials = fetch_trials_for_sponsor("Genentech, Inc.", max_results=target_per_sponsor, since_date=since_date)
        print(f"  Found {len(genentech_trials)} Genentech trials")

        # Deduplicate and filter unchanged trials
        # Primary check: what's actually in WIP
        wip_ncts = set()
        if not full_mode and not download_only:
            wip_ncts = get_wip_nct_ids()
            if wip_ncts:
                print(f"WIP has {len(wip_ncts)} existing trials")

        seen_ncts = set()

        for study in roche_trials:
            nct = study.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
            if nct and nct not in seen_ncts:
                seen_ncts.add(nct)
                ct_update = get_last_update_date(study)
                if not full_mode and nct in wip_ncts:
                    prev = known_trials.get(nct, {})
                    if prev.get("last_update") == ct_update and ct_update:
                        COUNTS["skipped"] += 1
                        continue
                selected.append((study, "Roche", ct_update))

        for study in genentech_trials:
            nct = study.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
            if nct and nct not in seen_ncts:
                seen_ncts.add(nct)
                ct_update = get_last_update_date(study)
                if not full_mode and nct in wip_ncts:
                    prev = known_trials.get(nct, {})
                    if prev.get("last_update") == ct_update and ct_update:
                        COUNTS["skipped"] += 1
                        continue
                selected.append((study, "Genentech", ct_update))

    print(f"\nSelected {len(selected)} trials to {'download' if download_only else 'import'} ({COUNTS['skipped']} skipped, unchanged):")
    for study, source, _ in selected[:20]:
        nct = study.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
        title = study.get("protocolSection", {}).get("identificationModule", {}).get("briefTitle", "")
        print(f"  [{source}] {nct}: {title[:65]}")
    if len(selected) > 20:
        print(f"  ... and {len(selected) - 20} more")

    if not selected:
        print("\nNothing to import — all trials are up to date.")
        save_sync_state(sync_state)
        return

    if not download_only:
        # Step 3: Create organizations FIRST
        print("\n" + "=" * 70)
        print("Phase 1: Creating Organizations")
        print("=" * 70)
        orgs_to_create = set()
        for study, _, _ in selected:
            proto = study.get("protocolSection", {})
            sponsor_mod = proto.get("sponsorCollaboratorsModule", {})
            lead = sponsor_mod.get("leadSponsor", {}).get("name")
            if lead:
                orgs_to_create.add(lead)
            for collab in sponsor_mod.get("collaborators", []):
                name = collab.get("name")
                if name:
                    orgs_to_create.add(name)

        create_organizations_bulk(sorted(orgs_to_create))

    # Step 4: Fetch full details and import/save trials
    print("\n" + "=" * 70)
    if download_only:
        print("Downloading trial details...")
    else:
        print("Phase 2: Importing Trials (with outcomes, sites, results, AEs, PDFs)")
    print("=" * 70)

    total_selected = len(selected)
    import_start = time.time()

    for idx, (study, source, ct_update) in enumerate(selected, 1):
        nct_id = study.get("protocolSection", {}).get("identificationModule", {}).get("nctId")

        # Progress indicator with ETA
        elapsed = time.time() - import_start
        if idx > 1:
            rate = (idx - 1) / elapsed
            remaining = (total_selected - idx + 1) / rate
            mins_left = int(remaining // 60)
            secs_left = int(remaining % 60)
            eta = f"  ETA {mins_left}m{secs_left:02d}s"
        else:
            eta = ""

        print(f"\n[{idx}/{total_selected}]{eta}")

        # Fetch full detail
        full_study = fetch_trial_detail(nct_id)
        if save_raw_dir and full_study:
            raw_path = os.path.join(save_raw_dir, f"{nct_id}.json")
            with open(raw_path, "w") as f:
                json.dump(full_study, f, indent=2)

        if download_only:
            # Also fetch and save results/docs
            extra = fetch_trial_results_and_docs(nct_id)
            if save_raw_dir and extra:
                results_path = os.path.join(save_raw_dir, f"{nct_id}_results.json")
                with open(results_path, "w") as f:
                    json.dump(extra, f, indent=2)
            # Download PDFs to disk
            n_pdfs = 0
            if extra:
                doc_section = extra.get("documentSection", {})
                n_pdfs = download_pdfs_to_disk(nct_id, doc_section, save_raw_dir)
            print(f"  Saved {nct_id}" + (f" + {n_pdfs} PDF(s)" if n_pdfs else ""))
        else:
            if full_study:
                import_trial(full_study, save_raw_dir=save_raw_dir)
            else:
                import_trial(study, save_raw_dir=save_raw_dir)

        # Record in sync state
        sync_state["trials"][nct_id] = {
            "last_update": ct_update or get_last_update_date(full_study or study),
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "source": source,
        }
        if idx % 50 == 0:
            save_sync_state(sync_state)
            print(f"  [checkpoint: sync state saved at {idx}/{total_selected}]")

        time.sleep(0.2)

    # Step 5: Save sync state and print summary
    save_sync_state(sync_state)

    if download_only:
        elapsed_total = time.time() - import_start
        mins = int(elapsed_total // 60)
        secs = int(elapsed_total % 60)
        print("\n" + "=" * 70)
        print(f"DOWNLOAD COMPLETE  ({mins}m{secs:02d}s elapsed)")
        print("=" * 70)
        print(f"  Trials downloaded: {total_selected}")
        print(f"  Raw files saved to: {save_raw_dir}")
        print(f"  Sync state: {len(sync_state['trials'])} trials tracked")
    else:
        _print_summary(time.time() - import_start)
        print(f"  Sync state: {len(sync_state['trials'])} trials tracked")


if __name__ == "__main__":
    main()
