#!/usr/bin/env python3
"""Download and link trial documents (Protocol/SAP PDFs) from ClinicalTrials.gov.

Can process a single trial or all trials that have documents.

Usage:
    python download_trial_docs.py NCT04091217          # Single trial
    python download_trial_docs.py --all --limit 10     # All trials with docs (limit 10)
    python download_trial_docs.py --dry-run NCT04091217  # Show what would be downloaded
"""

import requests
import json
import sys
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

WIP_BASE = "https://localhost:8443"
WIP_API_KEY = "dev_master_key_for_testing"
CTGOV_BASE = "https://clinicaltrials.gov/api/v2"
NAMESPACE = "clintrial"
CT_TRIAL_TEMPLATE_ID = "019d25e5-345d-77a6-83c1-45ae615fe792"

HEADERS = {
    "Content-Type": "application/json",
    "X-API-Key": WIP_API_KEY,
}


def fetch_doc_section(nct_id):
    """Get the document section from ClinicalTrials.gov."""
    resp = requests.get(
        f"{CTGOV_BASE}/studies/{nct_id}",
        params={"fields": "documentSection"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("documentSection", {}).get("largeDocumentModule", {}).get("largeDocs", [])


def download_and_upload(nct_id, docs):
    """Download PDFs from CT.gov CDN and upload to WIP file store. Returns list of file_ids."""
    file_ids = []
    nct_num = nct_id.replace("NCT", "")
    last2 = nct_num[-2:]

    for doc in docs:
        filename = doc.get("filename", "")
        if not filename:
            continue

        type_abbrev = doc.get("typeAbbrev", "")
        if not any(t in type_abbrev for t in ["Prot", "SAP", "ICF"]):
            print(f"    Skipping {filename} (type: {type_abbrev})")
            continue

        download_url = f"https://cdn.clinicaltrials.gov/large-docs/{last2}/{nct_id}/{filename}"
        print(f"    Downloading {filename} from {download_url}...")

        try:
            resp = requests.get(download_url, timeout=60)
            if resp.status_code != 200:
                print(f"    WARN: Download failed (HTTP {resp.status_code})")
                continue

            size_kb = len(resp.content) // 1024
            print(f"    Downloaded {size_kb} KB, uploading to WIP...")

            # Upload to WIP file store
            upload_resp = requests.post(
                f"{WIP_BASE}/api/document-store/files",
                files={"file": (filename, resp.content, "application/pdf")},
                data={
                    "namespace": NAMESPACE,
                    "description": f"{type_abbrev} for {nct_id}",
                    "tags": json.dumps([type_abbrev.lower(), nct_id]),
                },
                headers={"X-API-Key": WIP_API_KEY},
                verify=False,
                timeout=60,
            )

            print(f"    Upload response: HTTP {upload_resp.status_code}")

            if upload_resp.status_code in (200, 201):
                result = upload_resp.json()
                print(f"    Response body: {json.dumps(result)[:300]}")

                # Extract file_id — response format may vary
                fid = None
                if isinstance(result, dict):
                    fid = result.get("file_id") or result.get("id")
                elif isinstance(result, list) and result:
                    fid = result[0].get("file_id") or result[0].get("id")

                if fid:
                    file_ids.append(fid)
                    print(f"    OK: {filename} -> {fid}")
                else:
                    print(f"    WARN: No file_id in response")
            else:
                print(f"    WARN: Upload failed: {upload_resp.text[:300]}")
        except Exception as e:
            print(f"    ERROR: {e}")

    return file_ids


def link_files_to_trial(nct_id, file_ids):
    """Update the trial document to include file references.

    Fetches the existing trial data from reporting DB, adds file_ids
    to the documents field, and re-submits (WIP upsert creates new version).
    """
    # Get current trial data
    resp = requests.post(
        f"{WIP_BASE}/api/reporting-sync/query",
        headers=HEADERS,
        json={"sql": "SELECT data_json FROM doc_ct_trial WHERE nct_id = $1", "params": [nct_id]},
        verify=False,
    )
    resp.raise_for_status()
    rows = resp.json().get("rows", [])
    if not rows:
        print(f"  WARN: Trial {nct_id} not found in reporting DB")
        return False

    data = json.loads(rows[0]["data_json"]) if isinstance(rows[0]["data_json"], str) else rows[0]["data_json"]

    # WIP file field expects file references as file IDs
    # The template field "documents" has type "file" with multiple=true
    # We need to submit the file IDs in the documents field
    data["documents"] = file_ids

    # Re-submit trial document (upsert via nct_id identity)
    resp = requests.post(
        f"{WIP_BASE}/api/document-store/documents",
        json=[{
            "template_id": CT_TRIAL_TEMPLATE_ID,
            "template_version": 1,
            "namespace": NAMESPACE,
            "data": data,
        }],
        headers={**HEADERS},
        verify=False,
    )
    resp.raise_for_status()
    results = resp.json()
    if isinstance(results, list) and results:
        status = results[0].get("status", "unknown")
        version = results[0].get("version", "?")
        print(f"  Trial updated: status={status}, version={version}")
        return status in ("created", "updated")
    return False


def process_trial(nct_id, dry_run=False):
    """Process a single trial: download docs, upload, link."""
    print(f"\n{'='*60}")
    print(f"Processing {nct_id}")
    print(f"{'='*60}")

    docs = fetch_doc_section(nct_id)
    relevant = [d for d in docs if any(t in d.get("typeAbbrev", "") for t in ["Prot", "SAP", "ICF"])]

    if not relevant:
        print(f"  No protocol/SAP/ICF documents found")
        return

    print(f"  Found {len(relevant)} document(s):")
    for d in relevant:
        print(f"    - {d.get('typeAbbrev')}: {d.get('filename')} ({d.get('size', '?')} bytes)")

    if dry_run:
        print("  DRY RUN — skipping download/upload")
        return

    file_ids = download_and_upload(nct_id, relevant)

    if file_ids:
        print(f"  Uploaded {len(file_ids)} file(s), linking to trial...")
        link_files_to_trial(nct_id, file_ids)
    else:
        print(f"  No files uploaded successfully")


def main():
    dry_run = "--dry-run" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    if args:
        # Single trial
        process_trial(args[0], dry_run=dry_run)
    else:
        print("Usage: python download_trial_docs.py NCT04091217")
        print("       python download_trial_docs.py --dry-run NCT04091217")


if __name__ == "__main__":
    main()
