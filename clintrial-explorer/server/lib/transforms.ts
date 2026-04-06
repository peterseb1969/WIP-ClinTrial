/**
 * Data transformation functions for ClinicalTrials.gov data.
 * Ported from scripts/import_trials.py.
 */

import { reportQuery } from './wip-api.js'

/** Load TA keyword map from WIP terminology (term values + labels + aliases) */
export async function loadTAKeywordMap(): Promise<Map<string, Set<string>>> {
  const result = await reportQuery<{ value: string; label: string; aliases: string | null }>(
    `SELECT t.value, t.label, t.aliases
     FROM terms t
     JOIN terminologies tt ON t.terminology_id = tt.terminology_id
     WHERE tt.value = 'CT_THERAPEUTIC_AREA' AND t.status = 'active'`,
  )

  const keywords = new Map<string, Set<string>>()
  for (const row of result.rows) {
    const kw = new Set<string>()
    kw.add(row.value.toLowerCase().replace(/_/g, ' '))
    kw.add(row.label.toLowerCase())
    if (row.aliases) {
      try {
        const aliases = JSON.parse(row.aliases) as string[]
        for (const a of aliases) {
          if (a.length > 2) kw.add(a.toLowerCase())
        }
      } catch {
        // skip invalid JSON
      }
    }
    // Remove very short keywords
    const filtered = new Set([...kw].filter((k) => k.length > 2))
    keywords.set(row.value, filtered)
  }
  return keywords
}

/** Known molecules in CT_MOLECULE terminology — canonical values and brand-name aliases */
export const KNOWN_MOLECULES: Record<string, string> = {
  // Canonical values (lowercase)
  atezolizumab: 'atezolizumab',
  rituximab: 'rituximab',
  bevacizumab: 'bevacizumab',
  trastuzumab: 'trastuzumab',
  pertuzumab: 'pertuzumab',
  ocrelizumab: 'ocrelizumab',
  tocilizumab: 'tocilizumab',
  emicizumab: 'emicizumab',
  fenebrutinib: 'fenebrutinib',
  tiragolumab: 'tiragolumab',
  cevostamab: 'cevostamab',
  glofitamab: 'glofitamab',
  mosunetuzumab: 'mosunetuzumab',
  'polatuzumab vedotin': 'polatuzumab_vedotin',
  polatuzumab_vedotin: 'polatuzumab_vedotin',
  entrectinib: 'entrectinib',
  alectinib: 'alectinib',
  cobimetinib: 'cobimetinib',
  vemurafenib: 'vemurafenib',
  pirfenidone: 'pirfenidone',
  satralizumab: 'satralizumab',
  faricimab: 'faricimab',
  gantenerumab: 'gantenerumab',
  trontinemab: 'trontinemab',
  afimkibart: 'afimkibart',
  pembrolizumab: 'pembrolizumab',
  nivolumab: 'nivolumab',
  durvalumab: 'durvalumab',
  ipilimumab: 'ipilimumab',
  osimertinib: 'osimertinib',
  carboplatin: 'carboplatin',
  cisplatin: 'cisplatin',
  pemetrexed: 'pemetrexed',
  paclitaxel: 'paclitaxel',
  methotrexate: 'methotrexate',
  // Brand name aliases
  tecentriq: 'atezolizumab',
  rituxan: 'rituximab',
  mabthera: 'rituximab',
  avastin: 'bevacizumab',
  herceptin: 'trastuzumab',
  kadcyla: 'trastuzumab',
  perjeta: 'pertuzumab',
  ocrevus: 'ocrelizumab',
  actemra: 'tocilizumab',
  hemlibra: 'emicizumab',
  columvi: 'glofitamab',
  lunsumio: 'mosunetuzumab',
  polivy: 'polatuzumab_vedotin',
  rozlytrek: 'entrectinib',
  alecensa: 'alectinib',
  cotellic: 'cobimetinib',
  zelboraf: 'vemurafenib',
  esbriet: 'pirfenidone',
  enspryng: 'satralizumab',
  vabysmo: 'faricimab',
  keytruda: 'pembrolizumab',
  opdivo: 'nivolumab',
  imfinzi: 'durvalumab',
  yervoy: 'ipilimumab',
  tagrisso: 'osimertinib',
  alimta: 'pemetrexed',
  taxol: 'paclitaxel',
  abraxane: 'paclitaxel',
  'nab-paclitaxel': 'paclitaxel',
  'trastuzumab emtansine': 'trastuzumab',
  'ado-trastuzumab emtansine': 'trastuzumab',
}

/** Country name to ISO code mapping */
export const COUNTRY_MAP: Record<string, string> = {
  'United States': 'US',
  'United Kingdom': 'GB',
  Germany: 'DE',
  France: 'FR',
  Italy: 'IT',
  Spain: 'ES',
  Switzerland: 'CH',
  Australia: 'AU',
  Canada: 'CA',
  Japan: 'JP',
  China: 'CN',
  'South Korea': 'KR',
  'Korea, Republic of': 'KR',
  Taiwan: 'TW',
  Brazil: 'BR',
  Mexico: 'MX',
  Argentina: 'AR',
  India: 'IN',
  Russia: 'RU',
  'Russian Federation': 'RU',
  Poland: 'PL',
  Netherlands: 'NL',
  Belgium: 'BE',
  Austria: 'AT',
  Sweden: 'SE',
  Denmark: 'DK',
  Norway: 'NO',
  Finland: 'FI',
  'Czech Republic': 'CZ',
  Czechia: 'CZ',
  Hungary: 'HU',
  Greece: 'GR',
  Portugal: 'PT',
  Israel: 'IL',
  Turkey: 'TR',
  Türkiye: 'TR',
  'South Africa': 'ZA',
  'New Zealand': 'NZ',
  Singapore: 'SG',
  'Hong Kong': 'HK',
  Ireland: 'IE',
  Romania: 'RO',
  Bulgaria: 'BG',
  Croatia: 'HR',
  Slovakia: 'SK',
  Ukraine: 'UA',
  Thailand: 'TH',
  Malaysia: 'MY',
  Philippines: 'PH',
  Colombia: 'CO',
  Chile: 'CL',
  Peru: 'PE',
  Egypt: 'EG',
  'Saudi Arabia': 'SA',
  'Puerto Rico': 'US',
  Guam: 'US',
  'Virgin Islands (U.S.)': 'US',
  'American Samoa': 'US',
  Georgia: 'GE',
  Moldova: 'MD',
  'Moldova, Republic of': 'MD',
  Morocco: 'MA',
  Serbia: 'RS',
  Indonesia: 'ID',
  Vietnam: 'VN',
  'Viet Nam': 'VN',
  Pakistan: 'PK',
  'United Arab Emirates': 'AE',
  Latvia: 'LV',
  Lithuania: 'LT',
  Estonia: 'EE',
  Slovenia: 'SI',
  'Bosnia and Herzegovina': 'BA',
  'North Macedonia': 'MK',
  Montenegro: 'ME',
  Albania: 'AL',
  Tunisia: 'TN',
  Lebanon: 'LB',
  Jordan: 'JO',
  Kenya: 'KE',
  Nigeria: 'NG',
  Ghana: 'GH',
  Uganda: 'UG',
  Ethiopia: 'ET',
  Tanzania: 'TZ',
  Bangladesh: 'BD',
  'Sri Lanka': 'LK',
  Nepal: 'NP',
  Cambodia: 'KH',
  Myanmar: 'MM',
  'Costa Rica': 'CR',
  Panama: 'PA',
  Guatemala: 'GT',
  Ecuador: 'EC',
  Uruguay: 'UY',
  'Dominican Republic': 'DO',
  Jamaica: 'JM',
  'Trinidad and Tobago': 'TT',
  Cuba: 'CU',
  Iceland: 'IS',
  Luxembourg: 'LU',
  Malta: 'MT',
  Cyprus: 'CY',
  Qatar: 'QA',
  Kuwait: 'KW',
  Bahrain: 'BH',
  Oman: 'OM',
  Iraq: 'IQ',
  Iran: 'IR',
  'Iran, Islamic Republic of': 'IR',
}

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
}

/** Normalize CT.gov date to YYYY-MM-DD format */
export function normalizeDate(dateStr: string | undefined | null): string | undefined {
  if (!dateStr) return undefined
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
  // YYYY-MM format
  if (/^\d{4}-\d{2}$/.test(dateStr)) return `${dateStr}-01`
  // "Month YYYY" format
  const monthYear = dateStr.match(/^(\w+)\s+(\d{4})$/)
  if (monthYear) {
    const mm = MONTHS[monthYear[1].toLowerCase()]
    if (mm) return `${monthYear[2]}-${mm}-01`
  }
  // "Month DD, YYYY" format
  const monthDayYear = dateStr.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/)
  if (monthDayYear) {
    const mm = MONTHS[monthDayYear[1].toLowerCase()]
    if (mm) return `${monthDayYear[3]}-${mm}-${monthDayYear[2].padStart(2, '0')}`
  }
  return undefined
}

/** Extract known molecule names from intervention list */
export function resolveMolecules(interventions: Array<{ name?: string }>): string[] {
  const found: string[] = []
  const seen = new Set<string>()

  for (const intervention of interventions) {
    const name = intervention.name || ''
    const nameLower = name.toLowerCase().trim()

    // Try exact match
    if (KNOWN_MOLECULES[nameLower]) {
      const canonical = KNOWN_MOLECULES[nameLower]
      if (!seen.has(canonical)) {
        found.push(canonical)
        seen.add(canonical)
      }
      continue
    }

    // Try matching individual tokens
    for (const token of nameLower.split(/[\s,;/+]+/)) {
      const t = token.trim()
      if (t && KNOWN_MOLECULES[t]) {
        const canonical = KNOWN_MOLECULES[t]
        if (!seen.has(canonical)) {
          found.push(canonical)
          seen.add(canonical)
        }
      }
    }
  }

  return found
}

/** Classify conditions into therapeutic area values using keyword matching.
 * taKeywords: Map of TA value -> Set of lowercase keywords
 */
export function classifyTherapeuticAreas(
  conditions: string[],
  taKeywords: Map<string, Set<string>>,
): string[] {
  if (!conditions.length || taKeywords.size === 0) return []

  const matched = new Set<string>()

  for (const condition of conditions) {
    const condLower = condition.toLowerCase()
    for (const [taValue, keywords] of taKeywords) {
      for (const keyword of keywords) {
        if (keyword.length <= 4) {
          // Word boundary match for short keywords
          try {
            if (new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(condLower)) {
              matched.add(taValue)
              break
            }
          } catch {
            // skip invalid regex
          }
        } else {
          if (condLower.includes(keyword)) {
            matched.add(taValue)
            break
          }
        }
      }
    }
  }

  return [...matched].sort()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

/** Extract and flatten CT.gov study data into WIP trial fields */
export function extractTrialData(study: AnyObj) {
  const proto = study.protocolSection || {}
  const ident = proto.identificationModule || {}
  const statusMod = proto.statusModule || {}
  const design = proto.designModule || {}
  const desc = proto.descriptionModule || {}
  const eligibility = proto.eligibilityModule || {}
  const arms = proto.armsInterventionsModule || {}
  const outcomesMod = proto.outcomesModule || {}
  const contacts = proto.contactsLocationsModule || {}
  const sponsorMod = proto.sponsorCollaboratorsModule || {}

  const nctId = ident.nctId || ''
  const title = ident.officialTitle || ident.briefTitle || ''

  return {
    nct_id: nctId,
    title,
    brief_title: ident.briefTitle,
    acronym: ident.acronym,
    status: statusMod.overallStatus,
    phases: design.phases || [],
    study_type: design.studyType,
    brief_summary: desc.briefSummary,
    enrollment: design.enrollmentInfo?.count,
    start_date: normalizeDate(statusMod.startDateStruct?.date),
    primary_completion_date: normalizeDate(statusMod.primaryCompletionDateStruct?.date),
    completion_date: normalizeDate(statusMod.completionDateStruct?.date),
    sponsor: sponsorMod.leadSponsor?.name,
    collaborators: (sponsorMod.collaborators || [])
      .map((c: AnyObj) => c.name)
      .filter(Boolean),
    interventions_raw: arms.interventions || [],
    conditions: (proto.conditionsModule || {}).conditions || [],
    eligibility_criteria: eligibility.eligibilityCriteria,
    minimum_age: eligibility.minimumAge,
    maximum_age: eligibility.maximumAge,
    sex: eligibility.sex,
    healthy_volunteers: eligibility.healthyVolunteers,
    has_results: study.hasResults || false,
    url: `https://clinicaltrials.gov/study/${nctId}`,
    primary_outcomes: outcomesMod.primaryOutcomes || [],
    secondary_outcomes: outcomesMod.secondaryOutcomes || [],
    locations: contacts.locations || [],
    last_update: statusMod.lastUpdatePostDateStruct?.date || '',
  }
}

/** Extract the lastUpdatePostDate from a CT.gov study */
export function getLastUpdateDate(study: AnyObj): string {
  return study?.protocolSection?.statusModule?.lastUpdatePostDateStruct?.date || ''
}
