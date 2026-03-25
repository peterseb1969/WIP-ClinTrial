#!/usr/bin/env python3
"""Import Roche/Genentech trials from ClinicalTrials.gov into WIP.

Usage:
    python import_trials.py              # Incremental: only trials changed since last sync
    python import_trials.py --full       # Full: reimport everything (slow)
    python import_trials.py --since 2025-01-01  # Only trials updated after this date
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

WIP_BASE = "https://localhost:8443"
WIP_API_KEY = "dev_master_key_for_testing"
CTGOV_BASE = "https://clinicaltrials.gov/api/v2"
NAMESPACE = "clintrial"
SYNC_STATE_FILE = os.path.join(os.path.dirname(__file__), "..", "data-model", "sync-state.json")

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

# Additional template IDs for results data
TEMPLATES_EXTRA = {
    "CT_TRIAL_AE": "019d25e6-4097-7087-a661-5a1bd4827da8",
    "CT_TRIAL_BASELINE": "019d25e6-4098-70bd-b345-76bb6e6b8640",
}
# Merge into TEMPLATES
TEMPLATES.update(TEMPLATES_EXTRA)

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


def fetch_trials_for_sponsor(sponsor, page_size=10, since_date=None):
    """Search ClinicalTrials.gov for trials by sponsor.
    If since_date is set (YYYY-MM-DD), only returns trials updated after that date.
    Returns list of study dicts.
    """
    url = f"{CTGOV_BASE}/studies"
    params = {
        "query.spons": sponsor,
        "pageSize": page_size,
        "fields": "protocolSection,hasResults",
    }
    if since_date:
        # Only fetch trials updated after this date
        params["filter.advanced"] = f"AREA[LastUpdatePostDate]RANGE[{since_date},MAX]"
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


def create_adverse_events(nct_id, ae_module):
    """Create CT_TRIAL_AE documents from the adverseEventsModule."""
    if not ae_module:
        return 0

    created = 0
    event_groups = ae_module.get("eventGroups", [])
    # Build group lookup for titles
    group_titles = {g.get("id"): g.get("title", "") for g in event_groups}

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
                "trial": nct_id,
                "ae_category": category,
                "term": term,
                "stats": stats,
            }
            if event.get("organSystem"):
                data["organ_system"] = event["organSystem"]
            if event.get("sourceVocabulary"):
                data["source_vocabulary"] = event["sourceVocabulary"]

            result = wip_create_document("CT_TRIAL_AE", data)
            if result:
                s = result.get("_import_status", "created")
                COUNTS["aes_created" if s == "created" else "aes_updated"] += 1
                created += 1

    return created


def create_baselines(nct_id, baseline_module):
    """Create CT_TRIAL_BASELINE documents from baselineCharacteristicsModule."""
    if not baseline_module:
        return 0

    created = 0
    groups = baseline_module.get("groups", [])
    group_titles = {g.get("id"): g.get("title", "") for g in groups}

    for measure in baseline_module.get("measures", []):
        title = measure.get("title", "")
        if not title:
            continue

        data = {
            "nct_id": nct_id,
            "trial": nct_id,
            "measure_title": title,
        }
        if measure.get("paramType"):
            data["param_type"] = measure["paramType"]
        if measure.get("dispersionType"):
            data["dispersion_type"] = measure["dispersionType"]
        if measure.get("unitOfMeasure"):
            data["unit_of_measure"] = measure["unitOfMeasure"]

        # Build categories with measurements
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

        result = wip_create_document("CT_TRIAL_BASELINE", data)
        if result:
            s = result.get("_import_status", "created")
            COUNTS["baselines_created" if s == "created" else "baselines_updated"] += 1
            created += 1

    return created


def update_outcome_with_results(nct_id, results_outcomes):
    """Update existing CT_TRIAL_OUTCOME documents with numeric result data."""
    if not results_outcomes:
        return 0

    updated = 0
    for om in results_outcomes:
        otype = om.get("type", "").upper()
        if otype not in ("PRIMARY", "SECONDARY"):
            otype = "OTHER"

        # Build result groups from the classes/categories/measurements
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

        # Build analyses
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

        # We need to find the matching outcome by measure text (approximate)
        # For now, create/update outcomes with result data using the same identity
        # This relies on WIP's identity dedup: same nct_id+type+sequence = update
        measure = om.get("title", "")
        if not measure:
            continue

        # Determine sequence among same-type outcomes
        same_type = [o for o in results_outcomes if (o.get("type", "").upper() or "OTHER") == otype]
        seq = next((i + 1 for i, o in enumerate(same_type) if o is om), 1)

        data = {
            "nct_id": nct_id,
            "trial": nct_id,
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

        result = wip_create_document("CT_TRIAL_OUTCOME", data)
        if result:
            COUNTS["outcomes_updated"] += 1
            updated += 1

    return updated


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

    # Step 1: Create the trial (may need to update with file IDs later)
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
    # Fetch results and document sections (separate API call with specific fields)
    has_results = trial_data.get("has_results", False)
    if has_results:
        print(f"  Fetching results and documents for {nct_id}...")
        extra = fetch_trial_results_and_docs(nct_id)
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

        # 4d: Download protocol/SAP PDFs
        doc_section = extra.get("documentSection", {})
        n_docs = len(doc_section.get("largeDocumentModule", {}).get("largeDocs", []))
        if n_docs:
            print(f"  Downloading {n_docs} document(s)...")
            file_ids = download_and_upload_documents(nct_id, doc_section)
            # TODO: update trial document with file IDs once file linking is tested
    else:
        # Even trials without results might have documents
        extra = fetch_trial_results_and_docs(nct_id)
        doc_section = extra.get("documentSection", {})
        n_docs = len(doc_section.get("largeDocumentModule", {}).get("largeDocs", []))
        if n_docs:
            print(f"  Downloading {n_docs} document(s)...")
            file_ids = download_and_upload_documents(nct_id, doc_section)


def main():
    # Parse arguments
    full_mode = "--full" in sys.argv
    since_override = None
    for i, arg in enumerate(sys.argv):
        if arg == "--since" and i + 1 < len(sys.argv):
            since_override = sys.argv[i + 1]

    # Load sync state
    sync_state = load_sync_state()
    last_sync = sync_state.get("last_sync")
    known_trials = sync_state.get("trials", {})

    # Determine the "since" date for incremental mode
    if full_mode:
        since_date = None
        mode_label = "FULL (reimporting everything)"
    elif since_override:
        since_date = since_override
        mode_label = f"INCREMENTAL (since {since_date}, user-specified)"
    elif last_sync:
        # Use last sync date, back off by 1 day for safety
        from datetime import timedelta
        last_dt = datetime.fromisoformat(last_sync.replace("Z", "+00:00"))
        safe_date = (last_dt - timedelta(days=1)).strftime("%Y-%m-%d")
        since_date = safe_date
        mode_label = f"INCREMENTAL (since {since_date}, based on last sync {last_sync[:10]})"
    else:
        since_date = None
        mode_label = "FULL (first run, no sync state)"

    print("=" * 70)
    print("Clinical Trials Import: Roche/Genentech -> WIP")
    print(f"Mode: {mode_label}")
    print(f"Known trials in sync state: {len(known_trials)}")
    print("=" * 70)

    # Step 1: Fetch trials from both sponsors
    target_per_sponsor = 50

    print(f"\nFetching Hoffmann-La Roche trials (target: {target_per_sponsor})...")
    roche_trials = fetch_trials_for_sponsor("Hoffmann-La Roche", page_size=200, since_date=since_date)
    print(f"  Found {len(roche_trials)} lead-sponsored Roche trials")

    print(f"\nFetching Genentech, Inc. trials (target: {target_per_sponsor})...")
    genentech_trials = fetch_trials_for_sponsor("Genentech, Inc.", page_size=200, since_date=since_date)
    print(f"  Found {len(genentech_trials)} lead-sponsored Genentech trials")

    # Step 2: Deduplicate and filter unchanged trials
    seen_ncts = set()
    selected = []

    for study in roche_trials[:target_per_sponsor]:
        nct = study.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
        if nct and nct not in seen_ncts:
            seen_ncts.add(nct)
            # Check if already synced with same lastUpdatePostDate
            ct_update = get_last_update_date(study)
            prev = known_trials.get(nct, {})
            if not full_mode and prev.get("last_update") == ct_update and ct_update:
                COUNTS["skipped"] += 1
                continue
            selected.append((study, "Roche", ct_update))

    for study in genentech_trials[:target_per_sponsor]:
        nct = study.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
        if nct and nct not in seen_ncts:
            seen_ncts.add(nct)
            ct_update = get_last_update_date(study)
            prev = known_trials.get(nct, {})
            if not full_mode and prev.get("last_update") == ct_update and ct_update:
                COUNTS["skipped"] += 1
                continue
            selected.append((study, "Genentech", ct_update))

    print(f"\nSelected {len(selected)} trials to import ({COUNTS['skipped']} skipped, unchanged):")
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

    for org_name in sorted(orgs_to_create):
        create_organization(org_name)
        time.sleep(0.1)

    # Step 4: Fetch full details and import trials
    print("\n" + "=" * 70)
    print("Phase 2: Importing Trials (with outcomes, sites, results, AEs, PDFs)")
    print("=" * 70)

    for study, source, ct_update in selected:
        nct_id = study.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
        # Fetch full detail (search results may have limited fields)
        full_study = fetch_trial_detail(nct_id)
        if full_study:
            import_trial(full_study)
        else:
            import_trial(study)

        # Record in sync state
        sync_state["trials"][nct_id] = {
            "last_update": ct_update or get_last_update_date(full_study or study),
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "source": source,
        }
        time.sleep(0.2)

    # Step 5: Save sync state and print summary
    save_sync_state(sync_state)

    print("\n" + "=" * 70)
    print("IMPORT SUMMARY")
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
    print(f"  Sync state: {len(sync_state['trials'])} trials tracked")


if __name__ == "__main__":
    main()
