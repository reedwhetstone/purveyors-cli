export interface ArtisanRoastData {
  // Metadata
  recording_version?: string;
  recording_revision?: string;
  recording_build?: string;
  version?: string;
  revision?: string;
  build?: string;
  artisan_os?: string;
  artisan_os_version?: string;
  artisan_os_arch?: string;

  // Core data
  title: string;
  roastertype: string;
  roastersize?: number;
  temperature_unit: 'F' | 'C'; // This will be mapped from 'mode' field
  mode: 'F' | 'C'; // Original field name in Artisan
  roastdate?: string;
  roasttime?: string;
  roast_uuid?: string;
  xmin?: number;
  xmax?: number;
  ymin?: number;
  ymax?: number;
  zmin?: number;
  zmax?: number;

  // Computed data from Artisan
  computed?: {
    TP_time?: number;
    TP_BT?: number;
    dry_phase_ror?: number;
    mid_phase_ror?: number;
    finish_phase_ror?: number;
    total_ror?: number;
    AUC?: number;
    dry_phase_delta_temp?: number;
    CHARGE_BT?: number;
    DRY_BT?: number;
    DROP_BT?: number;
    COOL_BT?: number;
    DRY_time?: number;
    DROP_time?: number;
    COOL_time?: number;
  };

  // Time series data (required arrays)
  timex: number[]; // Time in seconds from start
  temp1: number[]; // Environmental temperature (ET) — Artisan channel 1
  temp2: number[]; // Bean temperature (BT) — Artisan channel 2

  // Milestone events - indices into timex array
  // [CHARGE, DRY_END, FC_START, FC_END, SC_START, SC_END, DROP, COOL]
  timeindex: number[];

  // Roast metadata
  weight: [number, number, string]; // [input_weight, output_weight, unit]
  defects_weight?: number;
  volume?: [number, number, string];
  density?: [number, string, number, string];
  density_roasted?: [number, string, number, string];

  // Roaster settings
  roasterheating?: number;
  machinesetup?: string;
  drumspeed?: string;

  // People and organization
  operator?: string;
  organization?: string;

  // Flavor and cupping
  flavors?: number[];
  flavors_total_correction?: number;
  flavorlabels?: string[];
  beans?: string;
  roastingnotes?: string;
  cuppingnotes?: string;

  // Additional characteristics
  heavyFC?: boolean;
  lowFC?: boolean;
  lightCut?: boolean;
  darkCut?: boolean;
  drops?: boolean;
  oily?: boolean;
  uneven?: boolean;
  tipping?: boolean;
  scorching?: boolean;
  underdeveloped?: boolean;

  // Extra devices (fan, heat, damper data)
  extradevices?: number[];
  extraname1?: string[];
  extraname2?: string[];
  extratimex?: number[][];
  extratemp1?: number[][];
  extratemp2?: number[][];

  // Environment types
  etypes?: string[];

  // Special events (control device changes)
  specialevents?: number[]; // Timestamps of control events
  specialeventstype?: number[]; // Event type codes (0=button, 3=slider)
  specialeventsvalue?: number[]; // Control values
  specialeventsStrings?: string[]; // Control device identifiers

  // Locale
  locale?: string;
  viewerMode?: boolean;
}

export interface MilestoneData {
  charge?: number; // timeindex[0]
  dry_end?: number; // timeindex[1]
  fc_start?: number; // timeindex[2]
  fc_end?: number; // timeindex[3]
  sc_start?: number; // timeindex[4]
  sc_end?: number; // timeindex[5]
  drop?: number; // timeindex[6]
  cool?: number; // timeindex[7]
}

export interface ProcessedTemperaturePoint {
  time_seconds: number;
  bean_temp: number | null;
  environmental_temp: number | null;
  fan_setting?: number | null;
  heat_setting?: number | null;
}

export interface ProcessedRoastData {
  // For roast_profiles table
  profileData: {
    roaster_type: string;
    roaster_size: number;
    temperature_unit: 'F' | 'C';
    roast_notes?: string;
    roast_uuid?: string;
    data_source: 'artisan_import';
  };

  // For roast_temperatures table
  temperatureData: Array<{
    roast_id: number;
    time_seconds: number;
    bean_temp: number | null;
    environmental_temp: number | null;
    ambient_temp: number | null;
    data_source: 'artisan_import';
  }>;

  // Extracted milestones
  milestones: MilestoneData;

  // Phase calculations
  phases: {
    drying_percent: number;
    maillard_percent: number;
    development_percent: number;
    total_time_seconds: number;
  };

  // Milestone events for roast_events table
  milestoneEvents: Array<{
    roast_id: number;
    time_seconds: number;
    event_type: number;
    event_value: string | null;
    event_string: string;
    category: string;
    subcategory: string;
    user_generated: boolean;
    automatic: boolean;
    notes?: string;
  }>;

  // Control events for roast_events table
  controlEvents: Array<{
    roast_id: number;
    time_seconds: number;
    event_type: number;
    event_value: string;
    event_string: string;
    category: string;
    subcategory: string;
    user_generated: boolean;
    automatic: boolean;
    notes?: string;
  }>;

  // Computed data from Artisan
  computed: {
    // Turning point data
    tp_time: number | null;
    tp_temp: number | null;
    // Rate of rise metrics
    dry_phase_ror: number | null;
    mid_phase_ror: number | null;
    finish_phase_ror: number | null;
    total_ror: number | null;
    // Advanced metrics
    auc: number | null;
    dry_phase_delta_temp: number | null;
    // Temperature mappings to existing columns
    charge_temp_computed: number | null;
    dry_end_temp_computed: number | null;
    drop_temp_computed: number | null;
    cool_temp_computed: number | null;
    // Time mappings to existing columns
    dry_end_time_computed: number | null;
    drop_time_computed: number | null;
    cool_time_computed: number | null;
  };

  // Note: roast_phases table no longer exists in normalized schema
  // Phase data is now stored directly in roast_profiles table
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

// Type guard for Artisan data
export function isArtisanRoastData(data: unknown): data is ArtisanRoastData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const d = data as Record<string, unknown>;
  return (
    Array.isArray(d.timex) &&
    Array.isArray(d.temp1) &&
    Array.isArray(d.temp2) &&
    Array.isArray(d.timeindex) &&
    typeof d.title === 'string' &&
    (d.mode === 'F' || d.mode === 'C')
  );
}

// Milestone names mapping
export const MILESTONE_NAMES = {
  0: 'CHARGE',
  1: 'DRY_END',
  2: 'FC_START',
  3: 'FC_END',
  4: 'SC_START',
  5: 'SC_END',
  6: 'DROP',
  7: 'COOL',
} as const;

export const MILESTONE_LABELS = {
  charge: 'Charge',
  dry_end: 'Dry End',
  fc_start: 'First Crack Start',
  fc_end: 'First Crack End',
  sc_start: 'Second Crack Start',
  sc_end: 'Second Crack End',
  drop: 'Drop',
  cool: 'Cool',
} as const;
