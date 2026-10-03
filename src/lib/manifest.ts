import { EXIT_CODES } from './errors.js';
import { CLI_NUMERIC_BOUNDS } from './numeric-contracts.js';

export type CliAuthRequirement = 'none' | 'viewer' | 'member';
export type CliOutputMode = 'json' | 'pretty' | 'csv';

export interface CliDocLink {
  label: string;
  url: string;
}

export interface CliRoleContract {
  role: 'viewer' | 'member';
  description: string;
}

export interface CliOutputModeContract {
  mode: CliOutputMode;
  description: string;
}

export interface CliExitCodeContract {
  exitCode: number;
  code: string;
  description: string;
}

export interface CliIdContract {
  name: string;
  source: string;
  usedBy: string[];
  note?: string;
}

export interface CliOptionContract {
  flags: string;
  description?: string;
  defaultValue?: string | number | boolean;
  minimum?: number;
  maximum?: number;
  requiredInFlagMode?: boolean;
  notes?: string[];
}

export interface CliArgumentContract {
  name: string;
  cliToken?: string;
  description: string;
  required: boolean;
  idType?: string;
}

export interface CliStructuredErrorContract {
  channel: 'stderr';
  guaranteedFields: string[];
  optionalFields: string[];
  when: string;
  exception?: string;
}

export interface CliCommandContract {
  name: string;
  summary: string;
  auth: CliAuthRequirement;
  /**
   * Parchment SDK client operations (`namespace.method`, or `me`) whose canonical
   * endpoints this command consumes, including flag-dependent selector reads.
   * Interactive `--form` pickers are not listed. Lets agents map an SDK capability
   * to a command.
   */
  sdkMethods?: string[];
  /**
   * Confirmed-action types (`ConfirmedActionExecuteRequest.actionType`) that the
   * Cherry web agent runs through session-only confirmation, which this command
   * performs equivalently with an API key.
   */
  confirmedActionEquivalents?: string[];
  arguments?: CliArgumentContract[];
  options?: CliOptionContract[];
  notes?: string[];
  examples?: string[];
}

export interface CliCommandGroupContract {
  name: string;
  summary: string;
  auth: CliAuthRequirement | 'mixed';
  command?: CliCommandContract;
  subcommands?: CliCommandContract[];
}

export interface CliWorkflowContract {
  title: string;
  commands: string[];
}

export interface CliErrorPatternContract {
  title: string;
  exitCodes: number[];
  guidance: string[];
}

export interface CliManifest {
  schemaVersion: '1';
  binary: string;
  packageName: string;
  description: string;
  nodeVersion: string;
  importPath: string;
  machineSurfaces: {
    humanReference: string;
    shellManifest: string;
    moduleImport: string;
    notes: string[];
  };
  files: {
    credentials: string;
    config: string;
  };
  docs: CliDocLink[];
  roles: CliRoleContract[];
  globalOptions: CliOptionContract[];
  outputModes: CliOutputModeContract[];
  outputContract: {
    stdout: string;
    stderr: string;
    notes: string[];
    structuredErrors: CliStructuredErrorContract;
  };
  exitCodes: CliExitCodeContract[];
  idTypes: CliIdContract[];
  commandGroups: CliCommandGroupContract[];
  workflows: CliWorkflowContract[];
  errorPatterns: CliErrorPatternContract[];
}

const legacyMachineSurfaces: CliManifest['machineSurfaces'] = {
  humanReference: 'purvey context',
  shellManifest: 'purvey manifest',
  moduleImport: '@purveyors/cli/manifest',
  notes: [],
};

const docs: CliDocLink[] = [
  { label: 'CLI docs', url: 'https://purveyors.io/docs/cli/overview' },
  { label: 'API reference', url: 'https://api.purveyors.io/docs' },
  { label: 'Repository', url: 'https://github.com/reedwhetstone/purveyors-cli' },
  { label: 'npm package', url: 'https://www.npmjs.com/package/@purveyors/cli' },
];

const roles: CliRoleContract[] = [
  {
    role: 'viewer',
    description:
      'any signed-in account, or any API key with catalog:read; enough for every catalog command',
  },
  {
    role: 'member',
    description:
      'a Purveyors membership; required for inventory, roast, sales, tasting, procurement, and reference-profile commands',
  },
];

const globalOptions: CliOptionContract[] = [
  {
    flags: '--json',
    description:
      'Print results as compact JSON, the default for data commands; use it to be explicit',
  },
  { flags: '--pretty', description: 'Print results as indented, colorized JSON for reading' },
  {
    flags: '--csv',
    description: 'Print list results as CSV on commands that support it',
  },
  { flags: '--help', description: 'Show help for purvey or any command' },
  { flags: '--version', description: 'Print the installed CLI version' },
];

const outputModes: CliOutputModeContract[] = [
  { mode: 'json', description: 'compact JSON, suitable for agents and scripts' },
  { mode: 'pretty', description: 'indented JSON with colors for humans' },
  { mode: 'csv', description: 'CSV for array-shaped results on supporting commands' },
];

const exitCodes: CliExitCodeContract[] = [
  { exitCode: EXIT_CODES.OK, code: 'OK', description: 'success' },
  {
    exitCode: EXIT_CODES.GENERAL_ERROR,
    code: 'GENERAL_ERROR',
    description: 'unexpected error',
  },
  {
    exitCode: EXIT_CODES.INVALID_ARGUMENT,
    code: 'INVALID_ARGUMENT',
    description: 'invalid argument or input',
  },
  {
    exitCode: EXIT_CODES.AUTH_ERROR,
    code: 'AUTH_ERROR',
    description:
      'not signed in, the stored key was revoked, or your account or API key lacks access to this command',
  },
  { exitCode: EXIT_CODES.NOT_FOUND, code: 'NOT_FOUND', description: 'resource not found' },
  {
    exitCode: EXIT_CODES.DEPENDENCY_CONFLICT,
    code: 'DEPENDENCY_CONFLICT',
    description:
      'the change conflicts with related records, such as deleting a coffee that still has roasts or sales',
  },
  {
    exitCode: EXIT_CODES.CONFIG_ERROR,
    code: 'CONFIG_ERROR',
    description: 'configuration problem, such as a file path or API address the CLI cannot use',
  },
];

const idTypes: CliIdContract[] = [
  {
    name: 'catalog_id',
    source: 'a coffee listed in the Purveyors catalog',
    usedBy: [
      'catalog get',
      'catalog similar',
      'catalog compare',
      'catalog price-history',
      'inventory add --catalog-id',
      'tasting get <bean-id>',
      'roast list --catalog-id',
    ],
  },
  {
    name: 'inventory_id',
    source: 'a coffee in your green inventory',
    usedBy: [
      'inventory get/update/delete',
      'roast --coffee-id',
      'roast list --coffee-id',
      'tasting rate [bean-id]',
    ],
  },
  {
    name: 'roast_id',
    source: 'one of your roast profiles',
    usedBy: [
      'roast get/chart/delete',
      'roast list --roast-id',
      'sales record --roast-id',
      'reference-profile compare roast:<roast-id>',
    ],
  },
  {
    name: 'sale_id',
    source: 'one of your recorded sales',
    usedBy: ['sales update/delete'],
  },
  {
    name: 'reference_profile_id',
    source: 'one of your Studio reference profiles',
    usedBy: [
      'reference-profile get',
      'reference-profile chart',
      'reference-profile preview/save',
      'reference-profile export',
      'reference-profile compare profile:<uuid>',
    ],
  },
  {
    name: 'reference_revision_id',
    source: 'immutable revision belonging to a reference profile',
    usedBy: [
      'reference-profile chart',
      'reference-profile preview/save',
      'reference-profile export',
      'reference-profile compare revision:<uuid>',
    ],
  },
];

const SIMILAR_ACCESS =
  'Needs a sign-in (`purvey auth login`) or any API key with catalog:read. The free Green API plan includes it within its monthly quota.';

const commandGroups: CliCommandGroupContract[] = [
  {
    name: 'auth',
    summary: 'Sign in to purveyors.io, check your login, and sign out',
    auth: 'none',
    subcommands: [
      {
        name: 'login',
        summary: 'Log in to purveyors.io',
        auth: 'none',
        sdkMethods: ['cliAuth.create', 'cliAuth.exchange'],
        options: [
          {
            flags: '--headless',
            description:
              'Print the approval URL instead of opening a browser; use it for agents, SSH sessions, and remote machines. The CLI finishes on its own once you approve',
          },
        ],
        examples: ['purvey auth login', 'purvey auth login --headless'],
      },
      {
        name: 'status',
        summary: 'Show current login status and role',
        auth: 'none',
        sdkMethods: ['me'],
        options: [
          { flags: '--pretty', description: 'Print the status as indented, colorized JSON' },
          { flags: '--csv', description: 'Print the status as a CSV row' },
        ],
        examples: [
          'purvey auth status',
          'purvey auth status --pretty',
          'purvey auth status --json',
        ],
      },
      {
        name: 'whoami',
        summary: 'Show the identity, plan, scopes, and capabilities of the active credential',
        auth: 'none',
        sdkMethods: ['me'],
        notes: [
          'Prints the account details unchanged: authenticated, userId, appRoles, primaryAppRole, apiPlan, ppiAccess, apiScopes, and capabilities (capabilities.profileStudio shows Studio access).',
          'Uses PARCHMENT_API_KEY or PURVEYORS_API_KEY when set, otherwise the stored login key.',
          'Without a credential it prints a signed-out result (authenticated: false).',
        ],
        examples: [
          'purvey auth whoami --pretty',
          "purvey auth whoami | jq '.capabilities.profileStudio'",
        ],
      },
      {
        name: 'logout',
        summary: 'Clear stored credentials',
        auth: 'none',
        examples: ['purvey auth logout'],
      },
    ],
  },
  {
    name: 'catalog',
    summary: 'Search, rank, and compare catalog coffees and suppliers, and find similar coffees',
    auth: 'viewer',
    subcommands: [
      {
        name: 'search',
        summary: 'Search coffees by origin, process, price, and catalog metadata',
        auth: 'viewer',
        sdkMethods: ['catalog.list'],
        options: [
          {
            flags: '--origin <origin>',
            description:
              'Only coffees from this origin; matches continent, country, or region names, case-insensitive and partial',
          },
          {
            flags: '--process <method>',
            description:
              'Only coffees whose processing label contains this text, such as natural or washed (case-insensitive)',
          },
          {
            flags: '--processing-base-method <method>',
            description:
              'Only coffees whose structured base process exactly matches this value, such as Natural or Washed. List values with `purvey catalog facets processing_base_method`',
          },
          {
            flags: '--fermentation-type <type>',
            description:
              'Only coffees whose structured fermentation type exactly matches this value, such as Anaerobic. List values with `purvey catalog facets fermentation_type`',
          },
          {
            flags: '--process-additive <additive>',
            description: 'Only coffees whose process discloses exactly this additive, such as hops',
          },
          {
            flags: '--processing-disclosure-level <level>',
            description:
              'Only coffees whose supplier disclosed process details at exactly this level',
          },
          {
            flags: '--processing-confidence-min <n>',
            description:
              'Only coffees whose process details were identified with at least this confidence',
            minimum: 0,
            maximum: 1,
          },
          {
            flags: '--price-min <n>',
            description: 'Lowest price per pound to include, in US dollars',
          },
          {
            flags: '--price-max <n>',
            description: 'Highest price per pound to include, in US dollars',
          },
          {
            flags: '--name <text>',
            description: 'Only coffees whose name contains this text (case-insensitive)',
          },
          {
            flags: '--ids <n,n,...>',
            description:
              'Fetch these catalog IDs, comma-separated, instead of searching; --limit and --offset are ignored',
          },
          {
            flags: '--variety <text>',
            description:
              'Only coffees whose variety or cultivar contains this text (case-insensitive)',
          },
          {
            flags: '--stocked-days <n>',
            description: 'Only coffees that came into stock within the last N days',
          },
          {
            flags: '--supplier <name>',
            description:
              'Only coffees from suppliers whose name contains this text (case-insensitive)',
          },
          {
            flags: '--drying-method <method>',
            description:
              'Only coffees whose drying method or processing text contains this value, such as raised bed (case-insensitive)',
          },
          {
            flags: '--flavor <keywords>',
            description:
              'Comma-separated flavor keywords searched in coffee descriptions and tasting notes; a coffee matches if it mentions any of them',
          },
          {
            flags: '--stocked',
            description:
              'Only coffees currently in stock; without it, results also include coffees no longer stocked',
          },
          {
            flags: '--sort <field>',
            description:
              'Sort by price (cheapest first), price-desc, name, or origin (by country); without it, the most recently stocked coffees come first',
          },
          {
            flags: '--offset <n>',
            description: 'Number of results to skip when paging; must be a multiple of --limit',
            defaultValue: 0,
          },
          {
            flags: '--limit <n>',
            description: 'Maximum number of coffees to return',
            defaultValue: 10,
            minimum: CLI_NUMERIC_BOUNDS.catalogSearchLimit.minimum,
            maximum: CLI_NUMERIC_BOUNDS.catalogSearchLimit.maximum,
          },
          {
            flags: '--include-proof',
            description:
              'Add a proof summary to each coffee: how well its process, provenance, freshness, and pricing details are supported (strong, partial, limited, or not available)',
          },
          {
            flags: '--elevation-min <masl>',
            description: `Lowest growing elevation in meters; coffees whose disclosed range overlaps match`,
            minimum: 1,
            maximum: 6000,
          },
          {
            flags: '--elevation-max <masl>',
            description: `Highest growing elevation in meters`,
            minimum: 1,
            maximum: 6000,
          },
          {
            flags: '--screen-min <n>',
            description: `Smallest disclosed screen size (64ths of an inch); an 18+ lot matches any minimum up to its range`,
            minimum: 8,
            maximum: 20,
          },
          {
            flags: '--screen-max <n>',
            description: `Largest disclosed screen size (64ths of an inch)`,
            minimum: 8,
            maximum: 20,
          },
          {
            flags: '--grade <codes>',
            description: `Comma-separated grade codes such as KE:AA,PREP:EP; a coffee matches if it carries any of them. List codes with \`purvey catalog grades\``,
          },
          {
            flags: '--grade-kind <kind>',
            description: `Only coffees with a grade of this kind: size, altitude, defects, cup, or preparation`,
          },
          {
            flags: '--peaberry',
            description: `Only peaberry lots`,
          },
          {
            flags: '--lab-analyzed',
            description: `Only coffees with lab values such as moisture, water activity, density, or defect counts`,
          },
          {
            flags: '--moisture-max <pct>',
            description: `Highest disclosed moisture percentage; coffees without a moisture reading are excluded`,
            minimum: 0,
            maximum: 20,
          },
          {
            flags: '--score-protocol <protocol>',
            description: `Only cup scores from this protocol: sca_2004, cva_affective, q_arabica, coe, or supplier_unspecified`,
          },
        ],
        notes: [
          'All filters are optional. Without flags, returns up to --limit results.',
          'Grading filters add a grading object to each coffee: disclosed screen size, labeled grade codes, lab analysis, and cup score with its protocol.',
          '--ids fetches specific catalog items by ID, ignoring --limit and --offset.',
          '--offset + --limit enables pagination through large result sets.',
          'Without --include-proof, the output shape is unchanged.',
          'PURVEYORS_API_KEY or PARCHMENT_API_KEY overrides the scoped API key stored by `purvey auth login`.',
        ],
        examples: [
          'purvey catalog search --origin "Ethiopia" --process "natural" --pretty',
          'purvey catalog search --processing-base-method "Natural" --fermentation-type "Anaerobic" --pretty',
          'purvey catalog search --process-additive "hops" --processing-confidence-min 0.8 --pretty',
          'purvey catalog search --variety "gesha" --stocked --pretty',
          'purvey catalog search --stocked-days 30 --pretty',
          'purvey catalog search --supplier "Royal" --flavor "blueberry,jasmine" --stocked --pretty',
          'purvey catalog search --origin "Ethiopia" --include-proof --json',
          'purvey catalog search --grade KE:AA,KE:AB --screen-min 17 --stocked --pretty',
          'purvey catalog search --grade-kind altitude --elevation-min 1600 --pretty',
        ],
      },
      {
        name: 'get',
        summary: 'Get details for a specific coffee by ID',
        auth: 'viewer',
        sdkMethods: ['catalog.list'],
        arguments: [
          {
            name: 'catalog_id',
            cliToken: 'id',
            description: 'Catalog ID of the coffee',
            required: true,
            idType: 'catalog_id',
          },
        ],
        options: [
          {
            flags: '--include-proof',
            description:
              "Add the proof summary: how well the coffee's process, provenance, freshness, and pricing details are supported",
          },
        ],
        examples: [
          'purvey catalog get 128 --pretty',
          'purvey catalog get 128 --include-proof --json',
        ],
      },
      {
        name: 'stats',
        summary: 'Aggregate statistics for the catalog',
        auth: 'viewer',
        sdkMethods: ['catalog.stats'],
        examples: ['purvey catalog stats --pretty'],
      },
      {
        name: 'facets',
        summary: 'List counted catalog facet values for filter discovery',
        auth: 'viewer',
        sdkMethods: ['catalog.facets'],
        arguments: [
          {
            name: 'field',
            description:
              'The facet to list: supplier, country, processing_base_method, fermentation_type, drying_method, wholesale, grade_size, grade_altitude, grade_defects, grade_cup, grade_preparation, screen_size_min, or elevation_band. Without it, every facet is listed',
            required: false,
          },
        ],
        options: [
          {
            flags: '--all',
            description:
              'Count every coffee you can see, including ones no longer stocked; without it, only coffees currently in stock are counted',
          },
        ],
        notes: [
          'Without a field, prints every non-grading facet with its counted values and meta (values, facets, meta); name a grading field to get its counts.',
          "With a field, prints { field, facet, data, meta }: that facet's counted values and meta.",
          'Counts for multi-valued dimensions can overlap, so do not sum them.',
          'Defaults to currently stocked coffees; use --all for every coffee you can see.',
        ],
        examples: [
          'purvey catalog facets supplier --pretty',
          'purvey catalog facets country --all --json',
          'purvey catalog facets --pretty',
          'purvey catalog facets grade_altitude --pretty',
        ],
      },
      {
        name: 'rank',
        summary: 'Rank catalog coffees for a goal: premium, value, fresh arrivals, or rare origins',
        auth: 'viewer',
        sdkMethods: ['catalog.rank'],
        options: [
          {
            flags: '--objective <objective>',
            description:
              'What to rank for: premium (highest Purveyor Score), value (score per dollar), fresh_arrival (newest arrivals), or rare_origin (least common origins in the sample)',
            defaultValue: 'premium',
          },
          {
            flags: '--supplier <name>',
            description: 'Only coffees from suppliers whose name contains this text',
          },
          { flags: '--country <country>', description: 'Only coffees from this country' },
          {
            flags: '--process <method>',
            description: 'Only coffees with this processing method, such as washed or natural',
          },
          {
            flags: '--stocked',
            description:
              'Only coffees currently in stock; this is already the default unless you pass --all',
          },
          {
            flags: '--all',
            description:
              'Rank every coffee you can see, including ones no longer stocked, instead of only coffees in stock',
          },
          {
            flags: '--price-max <n>',
            description: 'Highest price per pound to include, in US dollars',
          },
          { flags: '--min-score <n>', description: 'Lowest Purveyor Score to include' },
          {
            flags: '--non-wholesale-only',
            description:
              'Leave out wholesale listings, keeping retail and listings with unknown wholesale status, before sampling',
          },
          {
            flags: '--sample-size <n>',
            description:
              'Number of matching coffees to consider before ranking; a smaller sample is faster but may miss candidates',
            defaultValue: 5000,
            minimum: 1,
            maximum: 5000,
          },
          {
            flags: '--limit <n>',
            description: 'Maximum number of ranked coffees to return',
            defaultValue: 10,
            minimum: 1,
            maximum: 50,
          },
        ],
        notes: [
          'Objectives are premium, value, fresh_arrival, and rare_origin.',
          'Uses the Purveyor Score as the quality signal.',
          'Output metadata reports stocked_only/scope, sample scope, and truncation; rare_origin is rarity within sampled matching candidates.',
        ],
        examples: [
          'purvey catalog rank --objective premium --stocked --pretty',
          'purvey catalog rank --objective value --country Ethiopia --price-max 12 --json',
          'purvey catalog rank --objective premium --supplier "Royal Coffee" --limit 5 --json',
        ],
      },
      {
        name: 'rank-premium',
        summary: 'Rank premium catalog candidates by Purveyor Score',
        auth: 'viewer',
        sdkMethods: ['catalog.rankPremium'],
        options: [
          {
            flags: '--origin <origin>',
            description: 'Only coffees from this continent, country, or region (case-insensitive)',
          },
          {
            flags: '--process <method>',
            description: 'Only coffees with this processing method, such as washed or natural',
          },
          {
            flags: '--stocked',
            description:
              'Only coffees currently in stock; without it, coffees no longer stocked are ranked too',
          },
          {
            flags: '--price-max <n>',
            description: 'Highest price per pound to include, in US dollars',
          },
          { flags: '--min-score <n>', description: 'Lowest Purveyor Score to include' },
          {
            flags: '--include-unscored',
            description: 'Also list coffees without a Purveyor Score, after all scored coffees',
          },
          {
            flags: '--sample-size <n>',
            description: 'Number of matching coffees to consider before ranking',
            defaultValue: 250,
            minimum: 1,
            maximum: 5000,
          },
          {
            flags: '--limit <n>',
            description: 'Maximum number of ranked coffees to return',
            defaultValue: 10,
            minimum: 1,
            maximum: 50,
          },
        ],
        notes: [
          'Shows the Purveyor Score with its confidence, tier, factor breakdown, version, and update metadata.',
          'Output includes rank, catalog context, pricing, stocked status, Purveyor Score qualifiers, and transparent ranking signals for agents.',
          'Output metadata reports sample ordering and whether more rows matched than the requested sample size.',
        ],
        examples: [
          'purvey catalog rank-premium --stocked --limit 10 --pretty',
          'purvey catalog rank-premium --origin Ethiopia --min-score 88 --json',
        ],
      },
      {
        name: 'supplier-list',
        summary: 'Summarize suppliers from the catalog coffees they list',
        auth: 'viewer',
        sdkMethods: ['catalog.suppliers'],
        options: [
          { flags: '--country <country>', description: 'Only count coffees from this country' },
          {
            flags: '--stocked',
            description:
              'Only count coffees currently in stock; without it, coffees no longer stocked count too',
          },
          {
            flags: '--non-wholesale-only',
            description: 'Leave out wholesale listings before suppliers are summarized',
          },
          {
            flags: '--sample-size <n>',
            description: 'Number of catalog coffees to read per page before summarizing suppliers',
            defaultValue: 5000,
            minimum: 1,
            maximum: 5000,
          },
          {
            flags: '--limit <n>',
            description: 'Maximum number of suppliers to return',
            defaultValue: 25,
            minimum: 1,
            maximum: 100,
          },
        ],
        notes: [
          'Summarizes supplier counts, stocked counts, Purveyor Score coverage, average score, average confidence, price range, origin/process coverage, and representative top coffees with score qualifiers.',
          'Country and non-wholesale filters apply to coffees before suppliers are summarized.',
          'Output metadata reports source-ordered pagination, rows examined, and whether the aggregate is sample-limited.',
        ],
        examples: ['purvey catalog supplier-list --country Ethiopia --non-wholesale-only --pretty'],
      },
      {
        name: 'supplier-detail',
        summary: 'Show aggregate detail for a supplier query',
        auth: 'viewer',
        sdkMethods: ['catalog.supplierDetail'],
        arguments: [
          {
            name: 'supplier',
            description: 'Supplier name to look up (case-insensitive, partial match)',
            required: true,
          },
        ],
        options: [
          { flags: '--country <country>', description: 'Only count coffees from this country' },
          {
            flags: '--stocked',
            description:
              'Only count coffees currently in stock; without it, coffees no longer stocked count too',
          },
          {
            flags: '--non-wholesale-only',
            description: 'Leave out wholesale listings before the supplier is summarized',
          },
          {
            flags: '--top-coffees <n>',
            description: 'Number of representative top coffees to include',
            defaultValue: 5,
            minimum: 1,
            maximum: 25,
          },
          {
            flags: '--sample-size <n>',
            description: 'Number of catalog coffees to read per page before summarizing',
            defaultValue: 5000,
            minimum: 1,
            maximum: 5000,
          },
        ],
        notes: [
          'Supplier matching is case-insensitive and partial, mirroring catalog search.',
          'Output metadata reports source-ordered pagination, rows examined, and whether the aggregate is sample-limited.',
        ],
        examples: ['purvey catalog supplier-detail "Royal Coffee" --pretty'],
      },
      {
        name: 'supplier-rank',
        summary: 'Rank suppliers by average Purveyor Score and stocked coverage',
        auth: 'viewer',
        sdkMethods: ['catalog.supplierRank'],
        options: [
          { flags: '--country <country>', description: 'Only count coffees from this country' },
          {
            flags: '--stocked',
            description:
              'Only count coffees currently in stock; without it, coffees no longer stocked count too',
          },
          {
            flags: '--non-wholesale-only',
            description: 'Leave out wholesale listings before suppliers are ranked',
          },
          {
            flags: '--min-coffees <n>',
            description: 'Minimum number of matching coffees a supplier needs to be ranked',
            defaultValue: 1,
            minimum: CLI_NUMERIC_BOUNDS.supplierMinCoffees.minimum,
            maximum: CLI_NUMERIC_BOUNDS.supplierMinCoffees.maximum,
          },
          {
            flags: '--sample-size <n>',
            description: 'Number of catalog coffees to read per page before ranking suppliers',
            defaultValue: 5000,
            minimum: 1,
            maximum: 5000,
          },
          {
            flags: '--limit <n>',
            description: 'Maximum number of suppliers to return',
            defaultValue: 25,
            minimum: 1,
            maximum: 100,
          },
        ],
        notes: [
          'Ranks suppliers by average Purveyor Score, then currently stocked count.',
          'Country and non-wholesale filters apply to coffees before suppliers are ranked.',
          'Output metadata reports source-ordered pagination, rows examined, and whether the aggregate is sample-limited.',
        ],
        examples: [
          'purvey catalog supplier-rank --country Ethiopia --non-wholesale-only --min-coffees 3 --pretty',
        ],
      },
      {
        name: 'similar',
        summary: 'Beta: find likely same-lot candidates and similar coffees for a catalog coffee',
        auth: 'viewer',
        sdkMethods: ['catalog.similar'],
        arguments: [
          {
            name: 'catalog_id',
            cliToken: 'id',
            description: 'Catalog ID of the coffee to match',
            required: true,
            idType: 'catalog_id',
          },
        ],
        options: [
          {
            flags: '--threshold <score>',
            description:
              'Minimum similarity score a match needs; higher values return fewer, closer matches',
            defaultValue: 0.7,
            minimum: 0.5,
            maximum: 0.99,
          },
          {
            flags: '--limit <count>',
            description: 'Maximum number of matches to return',
            defaultValue: 10,
            minimum: 1,
            maximum: 25,
          },
          {
            flags: '--stocked-only',
            description:
              'Only return coffees currently in stock; without it, matches can include coffees no longer stocked',
          },
          {
            flags: '--mode <mode>',
            description:
              'Which matches to return: all, likely_same (probably the same lot listed elsewhere), or similar_profile (substitutes with a similar profile)',
            defaultValue: 'all',
          },
        ],
        notes: [
          SIMILAR_ACCESS,
          'Results are beta candidates to review, not confirmed matches.',
          'Default JSON output groups results under data.target, data.groups.canonical_candidates, data.groups.similar_recommendations, optional data.matches, and meta.',
          'canonical_candidates are likely same-lot candidates; similar_recommendations are profile substitutes and expose blocker reasons when identity details disagree.',
          'Keeps classification_version, query_strategy, proof summaries, pricing metadata, blocker details, and score dimensions as returned.',
        ],
        examples: [
          'purvey catalog similar 1182 --threshold 0.85 --stocked-only --json',
          "purvey catalog similar 1182 --mode likely_same --json | jq '.data.groups.canonical_candidates'",
        ],
      },
      {
        name: 'compare',
        summary: 'Compare 2 to 6 coffees side by side, priced at your quantity',
        auth: 'viewer',
        sdkMethods: ['catalog.compare'],
        arguments: [
          {
            name: 'ids',
            description: '2 to 6 catalog IDs, space- or comma-separated',
            required: true,
            idType: 'catalog_id',
          },
        ],
        options: [
          {
            flags: '--quantity <lb>',
            description:
              'Pounds you plan to buy, any positive number up to 10000; each coffee is priced at the tier that applies to this quantity',
            defaultValue: 1,
          },
        ],
        notes: [
          'Rows are grouped Price, Availability, Origin, Process, Coffee, Grading, Taste, and Listing, each marked same, partial, or different.',
          'Price rows name the cheapest lots in bestLotIds; grading rows never carry best marks.',
          'Viewer accounts compare 2 coffees; member accounts and API keys compare up to 6.',
        ],
        examples: [
          'purvey catalog compare 416 8806 --pretty',
          "purvey catalog compare 416 8806 1182 --quantity 5 --json | jq '.data.bestPriceLotIds'",
        ],
      },
      {
        name: 'price-history',
        summary: 'Daily smallest-tier price history for one coffee',
        auth: 'viewer',
        sdkMethods: ['catalog.priceHistory'],
        arguments: [
          {
            name: 'catalog_id',
            cliToken: 'id',
            description: 'Catalog ID of the coffee',
            required: true,
            idType: 'catalog_id',
          },
        ],
        options: [
          {
            flags: '--days <n>',
            description: 'How many days of history to return',
            defaultValue: 180,
            minimum: 7,
            maximum: 365,
          },
        ],
        notes: [
          'Prices track the smallest order tier.',
          'Parchment decides access: member accounts, Parchment Intelligence, and API keys with catalog:read, including the key `purvey auth login` stores.',
          "Events flag days when the smallest tier's quantity changed, which makes prices before and after not directly comparable.",
        ],
        examples: [
          'purvey catalog price-history 1182 --pretty',
          "purvey catalog price-history 1182 --days 90 --json | jq '.data.summary'",
        ],
      },
      {
        name: 'grades',
        summary: 'Explain green grade codes such as KE:AA, ET:G1, GT:SHB, or PREP:EP',
        auth: 'viewer',
        sdkMethods: ['catalog.grades'],
        arguments: [
          {
            name: 'codes',
            description: 'optional grade codes to explain, space- or comma-separated',
            required: false,
          },
        ],
        options: [
          {
            flags: '--kind <kind>',
            description: 'Only codes of this kind: size, altitude, defects, cup, or preparation',
          },
          {
            flags: '--system <system>',
            description: 'Only codes from this grading system, such as KE, ET, BR, ALT, or PREP',
          },
          {
            flags: '--include-retired',
            description: 'Include retired codes, which stay valid on older listings',
          },
        ],
        notes: [
          'Codes are <system>:<token>; composite grades such as ET:G1 carry more than one kind.',
          'Implied ranges come from the published definition, not from any listing.',
          'Codes not in the vocabulary are listed under unknownCodes.',
        ],
        examples: [
          'purvey catalog grades KE:AA ET:G1 --pretty',
          "purvey catalog grades --kind altitude --json | jq '.data[].code'",
        ],
      },
    ],
  },
  {
    name: 'inventory',
    summary: 'Manage your green coffee inventory',
    auth: 'member',
    subcommands: [
      {
        name: 'list',
        summary: 'List your green coffee inventory with catalog details',
        auth: 'member',
        sdkMethods: ['inventory.list'],
        options: [
          { flags: '--stocked', description: 'Only coffees you have marked as in stock' },
          {
            flags: '--catalog-id <id>',
            description: 'Only inventory items bought from this catalog coffee (a catalog ID)',
          },
          {
            flags: '--purchase-date-start <YYYY-MM-DD>',
            description: 'Only purchases made on or after this date',
          },
          {
            flags: '--purchase-date-end <YYYY-MM-DD>',
            description: 'Only purchases made on or before this date',
          },
          {
            flags: '--origin <country>',
            description: 'Only coffees whose country of origin contains this text',
          },
          {
            flags: '--limit <n>',
            description: 'Maximum number of items to return',
            defaultValue: 20,
          },
          {
            flags: '--offset <n>',
            description: 'Number of items to skip when paging',
            defaultValue: 0,
          },
        ],
        notes: [
          'Returns your inventory items with their catalog details.',
          'The returned id field is the inventory ID, distinct from catalog_id.',
          '--offset + --limit enables pagination through large result sets.',
        ],
        examples: [
          'purvey inventory list --stocked --pretty',
          'purvey inventory list --limit 20 --offset 20',
        ],
      },
      {
        name: 'get',
        summary: 'Get a single inventory item',
        auth: 'member',
        sdkMethods: ['inventory.list'],
        arguments: [
          {
            name: 'inventory_id',
            cliToken: 'id',
            description: 'Inventory ID of the item',
            required: true,
            idType: 'inventory_id',
          },
        ],
        examples: ['purvey inventory get 7 --pretty'],
      },
      {
        name: 'add',
        summary: 'Add a bean to your inventory',
        auth: 'member',
        sdkMethods: ['inventory.create'],
        confirmedActionEquivalents: ['add_bean_to_inventory'],
        options: [
          {
            flags: '--catalog-id <id>',
            description:
              'Catalog ID of the coffee you bought; use exactly one of --catalog-id or --manual-name',
          },
          {
            flags: '--manual-name <name>',
            description:
              'Name for a coffee that is not in the catalog; use exactly one of --catalog-id or --manual-name',
          },
          {
            flags: '--qty <lbs>',
            description: 'Quantity purchased, in pounds',
            requiredInFlagMode: true,
          },
          {
            flags: '--cost <dollars>',
            description: 'Total amount paid for the beans, in US dollars (not the price per pound)',
          },
          {
            flags: '--tax-ship <dollars>',
            description: 'Tax and shipping paid for this purchase, in US dollars',
          },
          { flags: '--notes <text>', description: 'Free-text notes about this purchase' },
          {
            flags: '--purchase-date <YYYY-MM-DD>',
            description: 'Date of purchase; defaults to today',
          },
          {
            flags: '--form',
            description:
              'Prompt for a catalog coffee, quantity, total cost, and notes; the purchase date is set to today',
          },
        ],
        notes: [
          'Flag mode requires --qty and exactly one of --catalog-id or --manual-name.',
          '--manual-name creates a manual coffee record when manual inventory entries are enabled.',
        ],
        examples: [
          'purvey inventory add --catalog-id 128 --qty 10 --cost 85.00 --pretty',
          'purvey inventory add --manual-name "Farm-gate Ethiopia lot 7" --qty 12 --cost 96 --pretty',
        ],
      },
      {
        name: 'update',
        summary: 'Update an inventory item',
        auth: 'member',
        sdkMethods: ['inventory.update'],
        confirmedActionEquivalents: ['update_bean'],
        arguments: [
          {
            name: 'inventory_id',
            cliToken: 'id',
            description: 'Inventory ID of the item',
            required: true,
            idType: 'inventory_id',
          },
        ],
        options: [
          { flags: '--qty <lbs>', description: 'New purchased quantity, in pounds' },
          {
            flags: '--cost <dollars>',
            description: 'New total bean cost, in US dollars (not the price per pound)',
          },
          {
            flags: '--tax-ship <dollars>',
            description: 'New tax and shipping amount, in US dollars',
          },
          { flags: '--notes <text>', description: 'Replace the notes for this item' },
          {
            flags: '--stocked <true|false>',
            description: 'Mark the coffee as in stock (true) or used up (false)',
          },
          {
            flags: '--rank <n>',
            description:
              'Your own whole-number ranking for this coffee, used to order your inventory',
          },
        ],
      },
      {
        name: 'delete',
        summary: 'Delete an inventory item',
        auth: 'member',
        sdkMethods: ['inventory.delete'],
        arguments: [
          {
            name: 'inventory_id',
            cliToken: 'id',
            description: 'Inventory ID of the item',
            required: true,
            idType: 'inventory_id',
          },
        ],
        options: [
          {
            flags: '--yes',
            description: 'Delete without asking for confirmation; needed in scripts and agents',
          },
        ],
      },
    ],
  },
  {
    name: 'roast',
    summary: 'Record roasts, import Artisan .alog files, and watch a folder for new roasts',
    auth: 'member',
    subcommands: [
      {
        name: 'list',
        summary: 'List your roast profiles, sorted by date',
        auth: 'member',
        sdkMethods: ['roasts.list'],
        options: [
          {
            flags: '--coffee-id <id>',
            description: 'Only roasts of this inventory item (an inventory ID, not a catalog ID)',
          },
          { flags: '--roast-id <id>', description: 'Only the roast with this roast ID' },
          {
            flags: '--batch-name <text>',
            description: 'Only roasts whose batch name contains this text (case-insensitive)',
          },
          {
            flags: '--coffee-name <text>',
            description: 'Only roasts of coffees whose name contains this text (case-insensitive)',
          },
          {
            flags: '--date-start <YYYY-MM-DD>',
            description: 'Only roasts on or after this date',
          },
          { flags: '--date-end <YYYY-MM-DD>', description: 'Only roasts on or before this date' },
          {
            flags: '--stocked',
            description: 'Only roasts of coffees still marked as in stock in your inventory',
          },
          {
            flags: '--catalog-id <id>',
            description: 'Only roasts of coffees bought from this catalog coffee (a catalog ID)',
          },
          {
            flags: '--limit <n>',
            description: 'Maximum number of roasts to return',
            defaultValue: 20,
          },
          {
            flags: '--offset <n>',
            description: 'Number of roasts to skip when paging',
            defaultValue: 0,
          },
        ],
        notes: [
          '--coffee-id expects inventory_id, not catalog_id.',
          '--catalog-id filters by catalog ID.',
          '--date-start and --date-end accept YYYY-MM-DD format.',
          '--offset + --limit enables pagination through large result sets.',
        ],
        examples: ['purvey roast list --date-start 2026-03-01 --date-end 2026-03-31'],
      },
      {
        name: 'get',
        summary: 'Get a single roast profile',
        auth: 'member',
        sdkMethods: ['roasts.get'],
        arguments: [
          {
            name: 'roast_id',
            cliToken: 'id',
            description: 'Roast ID',
            required: true,
            idType: 'roast_id',
          },
        ],
        options: [
          {
            flags: '--include-temps',
            description: 'Add the full temperature curve; output can be large',
          },
          {
            flags: '--include-events',
            description: 'Add roast event markers such as first crack and drop',
          },
        ],
      },
      {
        name: 'chart',
        summary:
          'Get sampled chart data for one roast: temperature series, events, and chart revision',
        auth: 'member',
        sdkMethods: ['roasts.chartData'],
        arguments: [
          {
            name: 'roast_id',
            cliToken: 'id',
            description: 'Roast ID',
            required: true,
            idType: 'roast_id',
          },
        ],
        options: [
          {
            flags: '--target-points <n>',
            description: 'Approximate number of samples per temperature series',
            defaultValue: 400,
            minimum: 50,
            maximum: 1000,
          },
        ],
        notes: [
          'Returns the roast chart data unchanged: sampled series, events, and metadata.',
          'data.metadata.revision identifies the immutable chart revision used by reference-profile compare.',
        ],
        examples: [
          'purvey roast chart 123 --pretty',
          "purvey roast chart 123 --target-points 120 | jq '.data.metadata.revision'",
        ],
      },
      {
        name: 'create',
        summary: 'Create a new roast profile',
        auth: 'member',
        sdkMethods: ['roasts.create'],
        confirmedActionEquivalents: ['create_roast_session'],
        options: [
          {
            flags: '--coffee-id <id>',
            description: 'Inventory ID of the coffee you roasted (not a catalog ID)',
            requiredInFlagMode: true,
          },
          {
            flags: '--batch-name <name>',
            description: "Name for this roast batch; defaults to the coffee name plus today's date",
          },
          { flags: '--oz-in <oz>', description: 'Green coffee weight going in, in ounces' },
          { flags: '--oz-out <oz>', description: 'Roasted coffee weight coming out, in ounces' },
          {
            flags: '--roast-date <YYYY-MM-DD>',
            description: 'Date of the roast; defaults to today',
          },
          { flags: '--notes <text>', description: 'Free-text notes about the roast' },
          {
            flags: '--targets <text>',
            description: 'What you were aiming for, such as "FC at 390F, 18% development"',
          },
          {
            flags: '--roaster-type <text>',
            description: 'Roaster model or type, such as Aillio Bullet',
          },
          {
            flags: '--form',
            description:
              'Prompt for an inventory coffee, batch name, weight in, notes, and targets; the roast date is set to today and targets are saved in the notes',
          },
        ],
      },
      {
        name: 'update',
        summary: 'Update a roast profile',
        auth: 'member',
        sdkMethods: ['roasts.update'],
        confirmedActionEquivalents: ['update_roast_notes'],
        arguments: [
          {
            name: 'roast_id',
            cliToken: 'id',
            description: 'Roast ID',
            required: true,
            idType: 'roast_id',
          },
        ],
        options: [
          { flags: '--notes <text>', description: 'Replace the roast notes' },
          {
            flags: '--oz-out <oz>',
            description:
              'New roasted weight, in ounces; weight loss is recalculated when the green weight is known',
          },
          { flags: '--batch-name <name>', description: 'New batch name' },
          { flags: '--targets <text>', description: 'Replace the roast targets' },
        ],
      },
      {
        name: 'delete',
        summary: 'Delete a roast profile',
        auth: 'member',
        sdkMethods: ['roasts.delete'],
        arguments: [
          {
            name: 'roast_id',
            cliToken: 'id',
            description: 'Roast ID',
            required: true,
            idType: 'roast_id',
          },
        ],
        options: [
          {
            flags: '--yes',
            description: 'Delete without asking for confirmation; needed in scripts and agents',
          },
        ],
      },
      {
        name: 'import',
        summary: 'Import an Artisan .alog roast file',
        auth: 'member',
        sdkMethods: ['roasts.import'],
        arguments: [{ name: 'file', description: 'Path to Artisan .alog file', required: false }],
        options: [
          {
            flags: '--coffee-id <id>',
            description: 'Inventory ID of the coffee you roasted (not a catalog ID)',
            requiredInFlagMode: true,
          },
          {
            flags: '--batch-name <name>',
            description:
              'Name for this roast batch; defaults to the coffee name plus the roast date',
          },
          {
            flags: '--oz-in <oz>',
            description:
              'Green coffee weight going in, in ounces; overrides the weight read from the .alog file',
          },
          { flags: '--roast-notes <text>', description: 'Notes to save with the imported roast' },
          {
            flags: '--roast-targets <text>',
            description: 'What you were aiming for, saved with the imported roast',
          },
          {
            flags: '--form',
            description: 'Pick the file and inventory item interactively',
          },
        ],
      },
      {
        name: 'watch',
        summary: 'Watch a directory for new Artisan .alog files',
        auth: 'member',
        sdkMethods: ['roasts.import', 'inventory.list', 'roasts.classify'],
        arguments: [{ name: 'directory', description: 'Directory to watch', required: false }],
        options: [
          {
            flags: '--coffee-id <inventory_id>',
            description:
              'Inventory ID to attach every new roast to; required unless you use --auto-match, --resume, or --form',
          },
          {
            flags: '--batch-prefix <name>',
            description:
              'Batch name for the watch session; defaults to the coffee name. Batch commit mode saves every roast under this name, and individual commit mode numbers them like "<name> #1"',
          },
          {
            flags: '--prompt-each',
            description:
              'Ask which inventory item each new file belongs to instead of attaching every file to --coffee-id',
          },
          {
            flags: '--auto-match',
            description:
              'Match each new roast to a stocked inventory item automatically from details in its .alog file; cannot be combined with --coffee-id',
          },
          {
            flags: '--commit-mode <batch|individual>',
            description:
              'batch queues new roasts and saves them under one shared batch name when you stop watching, so the session shows up as a single batch; individual saves each roast as soon as its file appears, under its own numbered batch name',
            defaultValue: 'batch',
          },
          {
            flags: '--oz-in <oz>',
            description: 'Green coffee weight, in ounces, to record for every watched import',
          },
          { flags: '--roast-notes <text>', description: 'Notes to save with every watched import' },
          {
            flags: '--roast-targets <text>',
            description: 'Roast targets to save with every watched import',
          },
          {
            flags: '--resume',
            description:
              'Continue the last watch session with its saved directory, settings, and import progress',
          },
          {
            flags: '--form',
            description: 'Set up the directory, coffee, and commit mode interactively',
          },
        ],
        notes: [
          '--auto-match is mutually exclusive with --coffee-id.',
          '--auto-match matches each new roast to a stocked inventory item from its metadata.',
          '--commit-mode defaults to batch so new roasts are queued until the session ends.',
          'In batch commit mode every roast from the session shares the --batch-prefix name, so the roasts appear together as one batch for that roast date. --resume keeps the same batch name; roasts with a different roast date appear as a separate batch.',
          'In individual commit mode each roast gets its own batch name: "<name> #1", "<name> #2", and so on.',
        ],
      },
    ],
  },
  {
    name: 'sales',
    summary: 'Record and manage coffee sales',
    auth: 'member',
    subcommands: [
      {
        name: 'list',
        summary: 'List your sales, sorted by sell date',
        auth: 'member',
        sdkMethods: ['sales.list'],
        options: [
          {
            flags: '--coffee-id <id>',
            description: 'Only sales of this inventory item (an inventory ID)',
          },
          { flags: '--date-start <YYYY-MM-DD>', description: 'Only sales on or after this date' },
          { flags: '--date-end <YYYY-MM-DD>', description: 'Only sales on or before this date' },
          {
            flags: '--buyer <name>',
            description: 'Only sales to buyers whose name contains this text (case-insensitive)',
          },
          {
            flags: '--limit <n>',
            description: 'Maximum number of sales to return',
            defaultValue: 20,
          },
          {
            flags: '--offset <n>',
            description: 'Number of sales to skip when paging',
            defaultValue: 0,
          },
        ],
        notes: [
          '--coffee-id filters by inventory ID.',
          '--date-start and --date-end accept YYYY-MM-DD and compose into a range.',
          '--offset + --limit enables pagination through large result sets.',
        ],
      },
      {
        name: 'record',
        summary: 'Record a new sale',
        auth: 'member',
        sdkMethods: ['sales.create', 'roasts.list', 'roasts.get'],
        confirmedActionEquivalents: ['record_sale'],
        options: [
          {
            flags: '--roast-id <id>',
            description:
              'Roast ID the coffee came from; the CLI looks up its inventory item and batch. Use instead of --coffee-id with --batch-name',
          },
          {
            flags: '--coffee-id <id>',
            description:
              'Inventory ID of the coffee sold; use with --batch-name instead of --roast-id',
          },
          {
            flags: '--batch-name <name>',
            description: 'Batch name of the roast sold; use with --coffee-id',
          },
          {
            flags: '--oz <amount>',
            description: 'Roasted coffee sold, in ounces',
            requiredInFlagMode: true,
          },
          {
            flags: '--price <dollars>',
            description: 'Total sale price, in US dollars (not per ounce)',
            requiredInFlagMode: true,
          },
          { flags: '--buyer <name>', description: 'Buyer name or identifier' },
          { flags: '--sell-date <YYYY-MM-DD>', description: 'Date of the sale; defaults to today' },
          {
            flags: '--form',
            description:
              'Prompt for a roast, ounces sold, sale price, and buyer; the sale date is set to today',
          },
        ],
        notes: [
          'Selector modes: --roast-id resolves its inventory + batch, or pass --coffee-id + --batch-name directly.',
          'Use exactly one selector mode.',
          'Sales retain inventory + batch, not roast ID. When several roasts share a batch name on one inventory item, the sale is recorded against that batch as a whole in either selector mode.',
        ],
      },
      {
        name: 'update',
        summary: 'Update a sale record',
        auth: 'member',
        sdkMethods: ['sales.update'],
        arguments: [
          {
            name: 'sale_id',
            cliToken: 'id',
            description: 'Sale ID',
            required: true,
            idType: 'sale_id',
          },
        ],
        options: [
          { flags: '--oz <amount>', description: 'New amount sold, in ounces' },
          { flags: '--price <dollars>', description: 'New total sale price, in US dollars' },
          { flags: '--buyer <name>', description: 'New buyer name or identifier' },
          { flags: '--sell-date <YYYY-MM-DD>', description: 'New sale date' },
        ],
      },
      {
        name: 'delete',
        summary: 'Delete a sale record',
        auth: 'member',
        sdkMethods: ['sales.delete'],
        arguments: [
          {
            name: 'sale_id',
            cliToken: 'id',
            description: 'Sale ID',
            required: true,
            idType: 'sale_id',
          },
        ],
        options: [
          {
            flags: '--yes',
            description: 'Delete without asking for confirmation; needed in scripts and agents',
          },
        ],
      },
    ],
  },
  {
    name: 'tasting',
    summary: 'Read supplier tasting notes and record your own cupping scores',
    auth: 'member',
    subcommands: [
      {
        name: 'get',
        summary: 'Get tasting notes for a coffee',
        auth: 'member',
        sdkMethods: ['tasting.get'],
        arguments: [
          {
            name: 'catalog_id',
            cliToken: 'bean-id',
            description: 'Catalog ID of the coffee, not an inventory ID',
            required: true,
            idType: 'catalog_id',
          },
        ],
        options: [
          {
            flags: '--filter <user|supplier|both>',
            description:
              "Which notes to return: user (your cupping scores), supplier (the supplier's flavor notes), or both",
            defaultValue: 'both',
          },
        ],
      },
      {
        name: 'rate',
        summary: 'Rate a coffee bean with cupping scores',
        auth: 'member',
        sdkMethods: ['tasting.rate'],
        arguments: [
          {
            name: 'inventory_id',
            cliToken: 'bean-id',
            description: 'Inventory ID of the coffee, not a catalog ID',
            required: false,
            idType: 'inventory_id',
          },
        ],
        options: [
          {
            flags: '--aroma <1-5>',
            description: 'Aroma score, a whole number; higher is better',
            minimum: 1,
            maximum: 5,
            requiredInFlagMode: true,
          },
          {
            flags: '--body <1-5>',
            description: 'Body score, a whole number; higher is better',
            minimum: 1,
            maximum: 5,
            requiredInFlagMode: true,
          },
          {
            flags: '--acidity <1-5>',
            description: 'Acidity score, a whole number; higher is better',
            minimum: 1,
            maximum: 5,
            requiredInFlagMode: true,
          },
          {
            flags: '--sweetness <1-5>',
            description: 'Sweetness score, a whole number; higher is better',
            minimum: 1,
            maximum: 5,
            requiredInFlagMode: true,
          },
          {
            flags: '--aftertaste <1-5>',
            description: 'Aftertaste score, a whole number; higher is better',
            minimum: 1,
            maximum: 5,
            requiredInFlagMode: true,
          },
          {
            flags: '--brew-method <method>',
            description: 'How you brewed the coffee, such as pour_over, french_press, or espresso',
          },
          { flags: '--notes <text>', description: 'Free-text tasting notes' },
          {
            flags: '--form',
            description: 'Pick the coffee, then enter the five scores and notes interactively',
          },
        ],
        notes: ['Rating again replaces the earlier scores for that inventory item.'],
      },
    ],
  },
  {
    name: 'config',
    summary: 'Manage local purvey CLI settings',
    auth: 'none',
    subcommands: [
      {
        name: 'list',
        summary: 'Show all config values',
        auth: 'none',
        notes: [
          'Interactive terminals print human-readable key = value lines.',
          'Machine mode emits the full config object as JSON.',
          '--csv is not supported on config commands.',
        ],
        examples: ['purvey config list', 'purvey config list --json'],
      },
      {
        name: 'get',
        summary: 'Get a config value',
        auth: 'none',
        arguments: [{ name: 'key', description: 'Config key', required: true }],
        notes: [
          'Interactive terminals print the raw value with no decorators.',
          'Machine mode emits {"<key>": value|null}.',
          '--csv is not supported on config commands.',
        ],
        examples: ['purvey config get form-mode', 'purvey config get form-mode --json'],
      },
      {
        name: 'set',
        summary: 'Set a config value',
        auth: 'none',
        arguments: [
          { name: 'key', description: 'Config key', required: true },
          { name: 'value', description: 'Config value', required: true },
        ],
        notes: [
          'Interactive terminals print a human-readable success line.',
          'Machine mode emits the updated config value as JSON.',
          '--csv is not supported on config commands.',
        ],
        examples: ['purvey config set form-mode true', 'purvey config set form-mode true --json'],
      },
      {
        name: 'reset',
        summary: 'Reset config to defaults',
        auth: 'none',
        notes: [
          'Interactive terminals print a human-readable success line.',
          'Machine mode emits {}.',
          '--csv is not supported on config commands.',
        ],
        examples: ['purvey config reset', 'purvey config reset --json'],
      },
    ],
  },
  {
    name: 'context',
    summary: 'Print a dense human-readable CLI reference, or the manifest as JSON',
    auth: 'none',
    command: {
      name: 'context',
      summary: 'Print a dense human-readable CLI reference, or the manifest as JSON',
      auth: 'none',
      options: [
        {
          flags: '--json',
          description:
            'Print the machine-readable manifest as compact JSON instead of the text reference',
        },
        {
          flags: '--pretty',
          description:
            'Print the machine-readable manifest as indented JSON instead of the text reference',
        },
      ],
      notes: [
        'Use `purvey context` for dense human-readable operator reference text.',
        'Prefer `purvey manifest` for the stable machine-readable CLI contract.',
        'Use `purvey context --json` only for compatibility with existing context-based callers.',
        'Use `@purveyors/cli/manifest` for the same contract in-process.',
      ],
      examples: ['purvey context', 'purvey context --json', 'purvey context --pretty'],
    },
  },
  {
    name: 'manifest',
    summary: 'Print the stable machine-readable CLI contract as JSON',
    auth: 'none',
    command: {
      name: 'manifest',
      summary: 'Print the stable machine-readable CLI contract as JSON',
      auth: 'none',
      options: [
        { flags: '--json', description: 'Print the manifest as compact JSON, the default' },
        { flags: '--pretty', description: 'Print the manifest as indented JSON' },
      ],
      notes: [
        '`purvey manifest` is the preferred machine-readable entrypoint and emits compact JSON by default.',
        '`purvey context --json` remains available for compatibility with existing context-based callers.',
        'The same contract is available in-process via `@purveyors/cli/manifest`.',
      ],
      examples: ['purvey manifest', 'purvey manifest --pretty'],
    },
  },
  {
    name: 'skill',
    summary: 'Print or install agent instructions generated from this manifest',
    auth: 'none',
    subcommands: [
      {
        name: 'print',
        summary: 'Write the generated SKILL.md, workflows.md, or the AGENTS.md block to stdout',
        auth: 'none',
        options: [
          {
            flags: '--file <file>',
            description:
              'Skill file to print: SKILL.md, workflows.md, or all; all needs --json or --pretty',
            defaultValue: 'SKILL.md',
            notes: [
              'The skill is a folder: SKILL.md, which agents load when the skill triggers, and workflows.md, the step-by-step workflows SKILL.md points to',
            ],
          },
          {
            flags: '--agents-md',
            description: 'Print the compact AGENTS.md block instead of the skill',
          },
        ],
        notes: [
          'Prints one file as Markdown by default; --json or --pretty wraps it as { name, file, cliVersion, bytes, content }, or every file with --file all as { name, cliVersion, files: [{ file, bytes, content }] }.',
          '--csv is not supported, and --agents-md cannot be combined with --file.',
          'Rendered from this manifest, so it changes only when the CLI contract changes.',
        ],
        examples: [
          'purvey skill print',
          'purvey skill print --file workflows.md',
          'purvey skill print --file all --json',
          'purvey skill print --agents-md',
        ],
      },
      {
        name: 'install',
        summary:
          'Install the generated instructions for Claude Code, Agent Skills clients such as Codex and Cursor, or a repository AGENTS.md',
        auth: 'none',
        options: [
          {
            flags: '--target <target>',
            description:
              "Required. Where to install: claude (Claude Code), agents (Codex, Cursor, and other Agent Skills clients), or agents-md (this repository's AGENTS.md)",
            notes: [
              'claude: SKILL.md and workflows.md in ~/.claude/skills/purveyors/ (project scope: .claude/skills/purveyors/); use this for Claude Code, which loads skills only from .claude/skills',
              'agents: SKILL.md and workflows.md in ~/.agents/skills/purveyors/, read by Codex, Cursor, and other Agent Skills clients (project scope: .agents/skills/purveyors/); Claude Code does not read .agents/',
              'agents-md: ./AGENTS.md in the current directory; adds or refreshes one marked block and leaves the rest of the file alone. Claude Code reads AGENTS.md only when no CLAUDE.md, .claude/CLAUDE.md, or CLAUDE.local.md exists in the current directory or above it; see --link-claude-md',
            ],
          },
          {
            flags: '--scope <scope>',
            description:
              'user (your home directory) or project (the current directory); defaults to user, or project for agents-md',
          },
          {
            flags: '--force',
            description: 'Replace skill files or an AGENTS.md block that have local edits',
          },
          { flags: '--dry-run', description: 'Report the path and action without writing' },
          {
            flags: '--link-claude-md',
            description:
              'agents-md only: add an @AGENTS.md import to ./CLAUDE.md so Claude Code loads the block',
            notes: [
              'Appends one @AGENTS.md line to ./CLAUDE.md, or @../AGENTS.md to ./.claude/CLAUDE.md, and creates ./CLAUDE.md when neither exists',
              'Only acts when a CLAUDE.md, .claude/CLAUDE.md, or CLAUDE.local.md on the path hides AGENTS.md and none imports it; idempotent and honors --dry-run',
              'Never edits CLAUDE.local.md or a CLAUDE.md in a parent directory',
            ],
          },
        ],
        notes: [
          'Needs no credentials and makes no network calls.',
          'Emits { target, scope, path, action, written, dryRun, cliVersion, bytes } as JSON on stdout; action is create, update, unchanged, append, or overwrite.',
          'claude and agents also emit files: [{ file, path, action, written, bytes }] for SKILL.md and workflows.md. The top-level path is SKILL.md, action is the most significant file action (overwrite, update, create, then unchanged), written is true when any file was written, and bytes is the total.',
          'agents-md also emits claudeCode: { visible, via, reason, claudeMdFiles, link? }. visible is false when a CLAUDE.md, .claude/CLAUDE.md, or CLAUDE.local.md in the current directory or above it keeps Claude Code from reading AGENTS.md and none of them imports it; a warning then goes to stderr.',
          'Re-running is safe: an identical file is left unchanged, an unedited file from an earlier CLI version is updated in place, and a missing workflows.md (for example after a SKILL.md-only install) is created.',
          'A file with local edits, or one purvey did not write, is refused with exit 6 unless --force is passed. Every skill file is checked before any is written, so a refusal changes nothing.',
        ],
        examples: [
          'purvey skill install --target claude',
          'purvey skill install --target agents --dry-run',
          'purvey skill install --target agents-md',
          'purvey skill install --target agents-md --link-claude-md',
        ],
      },
    ],
  },
  {
    name: 'market',
    summary:
      'Market Index value signals, price movement, metadata trends, market overview, and named-lot evidence',
    auth: 'mixed',
    subcommands: [
      {
        name: 'signals',
        summary: 'Actionable market value signals; unfiltered summary is a public teaser',
        auth: 'none',
        sdkMethods: ['market.signals'],
        options: [
          {
            flags: '--summary',
            description:
              'Return only signal counts; the one view that works without signing in or Parchment Intelligence',
          },
          {
            flags: '--type <type>',
            description:
              'Signal types to include: price_drop, below_market, or value_quality; repeat the flag or separate with commas. Without it, all three',
          },
          { flags: '--origin <origin>', description: 'Only signals for this origin (exact name)' },
          {
            flags: '--process <method>',
            description: 'Only signals for this process group (exact name), such as washed',
          },
          {
            flags: '--market <retail|wholesale|all>',
            description: 'Which listings to read: retail, wholesale, or all',
            defaultValue: 'retail',
          },
          {
            flags: '--min-discount <n>',
            description: 'Only signals at least this large, as a percent price drop or discount',
          },
          {
            flags: '--min-score <n>',
            description: 'Only coffees with at least this supplier-stated cupping score',
          },
          {
            flags: '--window <7d|30d>',
            description:
              'Time window for price-movement signals; value_quality signals are not time-windowed and always appear',
            defaultValue: '30d',
          },
          {
            flags: '--limit <n>',
            description: 'Number of signals per page',
            defaultValue: 20,
            minimum: CLI_NUMERIC_BOUNDS.marketSignalsLimit.minimum,
            maximum: CLI_NUMERIC_BOUNDS.marketSignalsLimit.maximum,
          },
        ],
        notes: [
          '--summary is the only view that works without credentials (counts only); every filter requires Parchment Intelligence access (exit 3 on denial).',
          '--json emits the API response unchanged.',
        ],
        examples: [
          'purvey market signals --summary --pretty',
          'purvey market signals --type price_drop --type below_market --origin "Ethiopia" --json',
        ],
      },
      {
        name: 'stats',
        summary: 'Price movement-significance stats; unfiltered retail slice is public',
        auth: 'none',
        sdkMethods: ['priceIndex.stats'],
        options: [
          { flags: '--origin <origin>', description: 'Only this origin (exact name)' },
          {
            flags: '--process <method>',
            description: 'Only this process group (exact name), such as washed',
          },
          {
            flags: '--market <retail|wholesale|all>',
            description: 'Which listings to measure: retail, wholesale, or all',
            defaultValue: 'retail',
          },
          {
            flags: '--window <7d|30d>',
            description: 'Length of the price move being measured',
            defaultValue: '7d',
          },
          {
            flags: '--baseline-weeks <n>',
            description: 'Weeks of history the move is compared against to judge how unusual it is',
            defaultValue: 12,
            minimum: 8,
            maximum: 52,
          },
        ],
        notes: [
          'The view with no origin or process at market=retail works without credentials; origin, process, and wholesale views require Parchment Intelligence access.',
        ],
        examples: [
          'purvey market stats --pretty',
          'purvey market stats --origin "Colombia" --window 30d --json',
        ],
      },
      {
        name: 'metadata',
        summary: 'Metadata-trend index; process/retail/month slice is public',
        auth: 'none',
        sdkMethods: ['market.metadataIndex'],
        options: [
          {
            flags: '--dimension <process|disclosure|score>',
            description:
              'What to trend: process (process mix), disclosure (how much suppliers disclose), or score (Purveyor Score)',
            defaultValue: 'process',
          },
          { flags: '--origin <origin>', description: 'Only this origin (exact name)' },
          {
            flags: '--market <retail|wholesale|all>',
            description: 'Which listings to read: retail, wholesale, or all',
            defaultValue: 'retail',
          },
          {
            flags: '--grain <week|month>',
            description: 'Size of each period in the trend',
            defaultValue: 'month',
          },
          { flags: '--from <date>', description: 'First period to include, as YYYY-MM-DD' },
          { flags: '--to <date>', description: 'Last period to include, as YYYY-MM-DD' },
        ],
        notes: [
          'Public view: dimension=process, no origin, market=retail, grain=month; anything else requires Parchment Intelligence access.',
          'Cultivar and drying dimensions are not available yet.',
        ],
        examples: [
          'purvey market metadata --pretty',
          'purvey market metadata --dimension score --origin "Ethiopia" --grain month --json',
        ],
      },
      {
        name: 'overview',
        summary: 'Aggregate-only green-coffee market overview over the public catalog',
        auth: 'viewer',
        sdkMethods: ['market.overview'],
        notes: [
          'Anonymous requests are rejected; any signed-in account or API key with catalog read access receives the same public evidence.',
          'Emits the API response unchanged: daily change, coverage, movement, process distribution, and origin price distributions.',
        ],
        examples: ['purvey market overview --pretty'],
      },
      {
        name: 'evidence',
        summary:
          'Named arrivals, delistings, comparable lots, and supplier health and price ranges',
        auth: 'member',
        sdkMethods: ['market.evidence'],
        notes: ['Requires Parchment Intelligence plus catalog read access (exit 3 on denial).'],
        examples: ['purvey market evidence --json'],
      },
    ],
  },
  {
    name: 'price-index',
    summary: 'Parchment Price Index snapshots, matched 30-day price comparisons, and chart history',
    auth: 'mixed',
    command: {
      name: 'price-index',
      summary: 'Fetch Parchment Price Index aggregate snapshots',
      auth: 'member',
      sdkMethods: ['priceIndex.list'],
      options: [
        {
          flags: '--origin <origin>',
          description: 'Only this origin (case-insensitive exact name)',
        },
        {
          flags: '--process <method>',
          description: 'Only this process (case-insensitive exact name), such as washed',
        },
        { flags: '--grade <grade>', description: 'Only this grade (case-insensitive exact name)' },
        {
          flags: '--from <date>',
          description: 'Only snapshots on or after this date, as YYYY-MM-DD',
        },
        {
          flags: '--to <date>',
          description: 'Only snapshots on or before this date, as YYYY-MM-DD',
        },
        {
          flags: '--wholesale <true|false>',
          description: 'true for wholesale prices only, false for retail only; without it, both',
        },
        {
          flags: '--page <n>',
          description: 'Page number, starting at 1',
          defaultValue: 1,
        },
        {
          flags: '--limit <n>',
          description: 'Number of snapshots per page',
          defaultValue: 100,
          minimum: CLI_NUMERIC_BOUNDS.priceIndexLimit.minimum,
          maximum: CLI_NUMERIC_BOUNDS.priceIndexLimit.maximum,
        },
      ],
      notes: [
        'Requires a scoped member API key with Parchment Price Index access.',
        'PARCHMENT_API_KEY or PURVEYORS_API_KEY overrides the scoped API key stored by `purvey auth login`.',
        '--from and --to accept ISO dates (YYYY-MM-DD); --wholesale accepts "true" or "false".',
      ],
      examples: [
        'purvey price-index --pretty',
        'purvey price-index --origin "Ethiopia" --json',
        'purvey price-index --from 2026-01-01 --to 2026-06-30 --pretty',
      ],
    },
    subcommands: [
      {
        name: 'comparisons',
        summary: 'Available exact 30-day matched price comparisons with significance',
        auth: 'member',
        sdkMethods: ['priceIndex.comparisons'],
        options: [
          {
            flags: '--wholesale <true|false|all>',
            description: 'true for wholesale listings, false for retail, or all for both',
            defaultValue: 'false',
          },
        ],
        notes: [
          'Requires Parchment Intelligence access.',
          'Lists every origin with an exact 30-day matched comparison; an empty comparisons list means none qualify.',
          'Each comparison carries significance unchanged; classification (quiet|normal|notable|exceptional) is null until eight baseline windows exist, meaning not enough history, never quiet.',
        ],
        examples: [
          'purvey price-index comparisons --pretty',
          'purvey price-index comparisons --wholesale all --json',
        ],
      },
      {
        name: 'comparison',
        summary: 'Matched-listing price comparison for one origin between two exact dates',
        auth: 'member',
        sdkMethods: ['priceIndex.comparison'],
        options: [
          { flags: '--origin <origin>', description: 'Required. Origin to compare' },
          {
            flags: '--from <date>',
            description: 'Required. Starting date, as YYYY-MM-DD (UTC)',
          },
          {
            flags: '--to <date>',
            description: 'Required. Ending date, as YYYY-MM-DD (UTC), within 365 days of --from',
          },
          {
            flags: '--wholesale <true|false>',
            description: 'true to compare wholesale listings, false for retail',
            defaultValue: 'false',
          },
        ],
        notes: [
          'Requires Parchment Intelligence access.',
          'status insufficient_fresh_coverage returns a null changePercent, never zero.',
        ],
        examples: [
          'purvey price-index comparison --origin "Ethiopia" --from 2026-08-31 --to 2026-09-30 --pretty',
        ],
      },
      {
        name: 'history',
        summary: 'Daily price-index history for charts; windows up to 90 days are public',
        auth: 'none',
        sdkMethods: ['priceIndex.history'],
        options: [
          {
            flags: '--window-days <n>',
            description:
              'Number of past days to include; up to 90 works without signing in, longer windows need Parchment Intelligence',
            defaultValue: 90,
            minimum: CLI_NUMERIC_BOUNDS.priceIndexHistoryWindowDays.minimum,
            maximum: CLI_NUMERIC_BOUNDS.priceIndexHistoryWindowDays.maximum,
          },
          {
            flags: '--page <n>',
            description: 'Page number, starting at 1',
            defaultValue: 1,
          },
          {
            flags: '--limit <n>',
            description: 'Number of data points per page',
            defaultValue: 100,
            minimum: CLI_NUMERIC_BOUNDS.priceIndexHistoryLimit.minimum,
            maximum: CLI_NUMERIC_BOUNDS.priceIndexHistoryLimit.maximum,
          },
          {
            flags: '--order <asc|desc>',
            description: 'Date order: asc (oldest first) or desc (newest first)',
            defaultValue: 'asc',
          },
        ],
        notes: [
          'Windows up to 90 days (the default) run without credentials; 91-365 days require Parchment Intelligence access.',
        ],
        examples: [
          'purvey price-index history --pretty',
          'purvey price-index history --window-days 365 --limit 500 --json',
        ],
      },
    ],
  },
  {
    name: 'procurement',
    summary: 'Read your saved sourcing briefs and the catalog coffees that match them',
    auth: 'member',
    subcommands: [
      {
        name: 'list',
        summary: 'List your saved sourcing briefs',
        auth: 'member',
        sdkMethods: ['procurement.briefs.list'],
        notes: ['The CLI reads saved briefs; it does not create them.'],
        examples: ['purvey procurement list --pretty'],
      },
      {
        name: 'get',
        summary: 'Get a single saved sourcing brief by ID',
        auth: 'member',
        sdkMethods: ['procurement.briefs.get'],
        arguments: [
          {
            name: 'brief_id',
            cliToken: 'id',
            description: 'ID of the saved sourcing brief',
            required: true,
          },
        ],
        examples: ['purvey procurement get <brief-id> --pretty'],
      },
      {
        name: 'matches',
        summary: 'Run a saved brief against the catalog and page through matches',
        auth: 'member',
        sdkMethods: ['procurement.briefs.matches'],
        arguments: [
          {
            name: 'brief_id',
            cliToken: 'id',
            description: 'ID of the saved sourcing brief',
            required: true,
          },
        ],
        options: [
          {
            flags: '--page <n>',
            description: 'Page number, starting at 1',
            defaultValue: 1,
          },
          {
            flags: '--limit <n>',
            description: 'Number of matching coffees per page',
            defaultValue: 25,
            minimum: CLI_NUMERIC_BOUNDS.procurementMatchesLimit.minimum,
            maximum: CLI_NUMERIC_BOUNDS.procurementMatchesLimit.maximum,
          },
        ],
        examples: [
          'purvey procurement matches <brief-id> --pretty',
          'purvey procurement matches <brief-id> --page 2 --limit 50 --json',
        ],
      },
    ],
  },
  {
    name: 'reference-profile',
    summary: 'Import, compare, adjust, save, and export Studio reference roast plans',
    auth: 'member',
    subcommands: [
      {
        name: 'list',
        summary: 'List your Studio reference profiles',
        auth: 'member',
        sdkMethods: ['referenceProfiles.list'],
        options: [
          {
            flags: '--include-archived',
            description: 'Also list reference profiles you have archived',
          },
        ],
        notes: ['Requires a member credential and Studio access on your account.'],
        examples: ['purvey reference-profile list --pretty'],
      },
      {
        name: 'get',
        summary: 'Get one reference profile and its current revision',
        auth: 'member',
        sdkMethods: ['referenceProfiles.get'],
        arguments: [
          {
            name: 'reference_profile_id',
            cliToken: 'profile-id',
            description: 'Reference profile UUID',
            required: true,
            idType: 'reference_profile_id',
          },
        ],
        notes: ['Use data.currentRevision.id for chart, preview, and save.'],
        examples: ['purvey reference-profile get 5ea1af6f-234c-43a9-9bf8-5678dd24f854 --pretty'],
      },
      {
        name: 'chart',
        summary: 'Get the Artisan chart for a reference revision',
        auth: 'member',
        sdkMethods: ['referenceProfiles.chart'],
        arguments: [
          {
            name: 'reference_profile_id',
            cliToken: 'profile-id',
            description: 'Reference profile UUID',
            required: true,
            idType: 'reference_profile_id',
          },
          {
            name: 'reference_revision_id',
            cliToken: 'revision-id',
            description: 'Revision UUID belonging to the profile',
            required: true,
            idType: 'reference_revision_id',
          },
        ],
        examples: [
          'purvey reference-profile chart 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --pretty',
        ],
      },
      {
        name: 'import',
        summary: 'Upload an Artisan file as a private Studio reference profile',
        auth: 'member',
        sdkMethods: ['referenceProfiles.import'],
        arguments: [
          {
            name: 'file',
            description: 'Path to an Artisan .alog or importer-supported JSON file',
            required: true,
          },
        ],
        options: [
          { flags: '--title <text>', description: 'Title for the new reference profile' },
          { flags: '--notes <text>', description: 'Notes about the reference profile' },
          {
            flags: '--idempotency-key <key>',
            description:
              'Key that makes retries safe: repeating the upload with the same key does not create a second profile. A new key is generated when omitted',
          },
        ],
        notes: [
          'The uploaded file is parsed on purveyors.io and kept private to your account.',
          'Reuse an explicit idempotency key to replay the same upload.',
          'Import creates a reference profile, not executed roast history.',
        ],
        examples: [
          'purvey reference-profile import ~/artisan/ethiopia.alog --title "Ethiopia baseline"',
        ],
      },
      {
        name: 'compare',
        summary: 'Compare two immutable roast or reference revisions with measured deltas',
        auth: 'member',
        sdkMethods: ['referenceProfiles.compare', 'referenceProfiles.get', 'roasts.chartData'],
        arguments: [
          {
            name: 'left',
            description:
              'selector: revision:<uuid>, profile:<uuid>, roast:<roast-id>, or roast:<roast-id>@<chart-revision>',
            required: true,
          },
          {
            name: 'right',
            description:
              'selector: revision:<uuid>, profile:<uuid>, roast:<roast-id>, or roast:<roast-id>@<chart-revision>',
            required: true,
          },
        ],
        options: [
          {
            flags: '--unit <F|C>',
            description: 'Temperature unit for the compared series: F (Fahrenheit) or C (Celsius)',
            defaultValue: 'F',
          },
          {
            flags: '--target-points <n>',
            description: 'Number of samples in each aligned temperature series',
            defaultValue: 400,
            minimum: 50,
            maximum: 1000,
          },
        ],
        notes: [
          'Output is the comparison result unchanged.',
          'profile:<uuid> resolves the profile currentRevisionId; roast:<roast-id> resolves data.metadata.revision from roast chart data.',
          'Both sides are aligned at charge; a reference profile is never executed roast history.',
        ],
        examples: [
          'purvey reference-profile compare roast:123 profile:5ea1af6f-234c-43a9-9bf8-5678dd24f854 --pretty',
          'purvey reference-profile compare roast:123 roast:124 --unit C --json',
        ],
      },
      {
        name: 'preview',
        summary: 'Preview bounded temperature adjustments without saving',
        auth: 'member',
        sdkMethods: ['referenceProfiles.preview'],
        arguments: [
          {
            name: 'reference_profile_id',
            cliToken: 'profile-id',
            description: 'Reference profile UUID',
            required: true,
            idType: 'reference_profile_id',
          },
          {
            name: 'reference_revision_id',
            cliToken: 'revision-id',
            description: 'Revision UUID to adjust; it is never changed',
            required: true,
            idType: 'reference_revision_id',
          },
        ],
        options: [
          {
            flags: '--request <file>',
            description:
              'Required. JSON file with a title and up to 12 temperature adjustments; save accepts the same file',
          },
        ],
        notes: [
          'Request JSON contains title, optional notes, optional userGoal (600 chars), modelRecommendation (800), and userEdits (800) provenance, and changes.temperatureAdjustments; each adjustment has kind, startMilliseconds, endMilliseconds, and delta.',
          'At most 12 adjustments are accepted; intervals must be ordered and each nonzero delta is bounded to -20 through 20.',
          'The plan is recalculated from the unchanged parent revision; preview never saves anything.',
        ],
        examples: [
          'purvey reference-profile preview 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --request changes.json --pretty',
        ],
      },
      {
        name: 'save',
        summary: 'Save changes as a new immutable generated reference plan',
        auth: 'member',
        sdkMethods: ['referenceProfiles.generate'],
        confirmedActionEquivalents: ['create_generated_reference'],
        arguments: [
          {
            name: 'reference_profile_id',
            cliToken: 'profile-id',
            description: 'Reference profile UUID',
            required: true,
            idType: 'reference_profile_id',
          },
          {
            name: 'reference_revision_id',
            cliToken: 'revision-id',
            description: 'Revision UUID the new plan is based on; it is never changed',
            required: true,
            idType: 'reference_revision_id',
          },
        ],
        options: [
          {
            flags: '--request <file>',
            description: 'Required. The same JSON request file you previewed',
          },
          {
            flags: '--idempotency-key <key>',
            description:
              'Key that makes retries safe: repeating the save with the same key does not create a second plan. A new key is generated when omitted',
          },
        ],
        notes: [
          'Reuse an explicit idempotency key to replay the same save.',
          'Generated references are plans and never create executed roast history.',
        ],
        examples: [
          'purvey reference-profile save 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --request changes.json --pretty',
        ],
      },
      {
        name: 'export',
        summary: 'Download a saved generated reference as an unsigned Artisan .alog plan',
        auth: 'member',
        sdkMethods: ['referenceProfiles.exportGenerated'],
        arguments: [
          {
            name: 'reference_profile_id',
            cliToken: 'profile-id',
            description: 'UUID of a saved generated reference profile',
            required: true,
            idType: 'reference_profile_id',
          },
          {
            name: 'reference_revision_id',
            cliToken: 'revision-id',
            description: 'UUID of the saved generated revision',
            required: true,
            idType: 'reference_revision_id',
          },
        ],
        options: [
          {
            flags: '--output <file>',
            description: 'Required. Path to write the .alog file to',
          },
          { flags: '--force', description: 'Overwrite the output file if it already exists' },
        ],
        notes: [
          'Only a saved generated revision can be exported; output is a local file plus a JSON receipt.',
          'The CLI does not claim verified Artisan 4.2 playback compatibility.',
        ],
        examples: [
          'purvey reference-profile export 0b7e9f52-3c61-4d8a-9e24-6f1a8c3d5b90 c43a1d7e-95b2-4e06-8f7c-1d2b3a4e5f68 --output ~/artisan/next-batch.alog',
        ],
      },
    ],
  },
];

const workflows: CliWorkflowContract[] = [
  {
    title: 'Catalog to inventory',
    commands: [
      'purvey catalog search --origin "Ethiopia" --stocked --pretty',
      'purvey inventory add --catalog-id 128 --qty 10 --cost 85.00',
    ],
  },
  {
    title: 'Catalog proof and similarity research',
    commands: [
      'purvey catalog search --origin "Ethiopia" --include-proof --json',
      'purvey catalog get 128 --include-proof --json',
      "purvey catalog similar 1182 --threshold 0.85 --stocked-only --json | jq '.data.groups'",
    ],
  },
  {
    title: 'Check prices and market moves',
    commands: [
      'purvey market signals --summary --pretty',
      'purvey market stats --origin "Colombia" --window 30d --json',
      'purvey price-index history --window-days 90 --json',
    ],
  },
  {
    title: 'Import a roast from Artisan',
    commands: [
      'purvey inventory list --stocked --pretty',
      'purvey roast import ~/artisan/ethiopia.alog --coffee-id 7 --pretty',
    ],
  },
  {
    title: 'Plan and export an Artisan reference',
    commands: [
      'purvey reference-profile import ~/artisan/ethiopia.alog --title "Ethiopia baseline"',
      'purvey reference-profile get 5ea1af6f-234c-43a9-9bf8-5678dd24f854 --pretty',
      'purvey reference-profile preview 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --request changes.json --pretty',
      'purvey reference-profile save 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --request changes.json --idempotency-key 3f6c2a1b-8e4d-4b7a-9c05-7e1f2d3a4b5c',
      'purvey reference-profile export 0b7e9f52-3c61-4d8a-9e24-6f1a8c3d5b90 c43a1d7e-95b2-4e06-8f7c-1d2b3a4e5f68 --output ~/artisan/next-batch.alog',
    ],
  },
  {
    title: 'Watch a folder for new roasts',
    commands: [
      'purvey roast watch ~/artisan/ --coffee-id 7',
      'purvey roast watch ~/artisan/ --auto-match',
      'purvey roast watch --resume',
    ],
  },
  {
    title: 'Rate coffee and record a sale',
    commands: [
      'purvey tasting rate 7 --aroma 4 --body 3 --acidity 5 --sweetness 4 --aftertaste 4',
      'purvey sales record --coffee-id 7 --batch-name "Ethiopia Guji Light" --oz 12 --price 22.00 --buyer "Jane Smith"',
    ],
  },
];

const errorPatterns: CliErrorPatternContract[] = [
  {
    title: 'Not logged in',
    exitCodes: [EXIT_CODES.AUTH_ERROR],
    guidance: [
      'Run `purvey auth login` or `purvey auth login --headless`.',
      'Run `purvey auth status` to confirm role after login.',
    ],
  },
  {
    title: 'Wrong ID type',
    exitCodes: [EXIT_CODES.INVALID_ARGUMENT, EXIT_CODES.NOT_FOUND],
    guidance: [
      'Verify whether the command wants catalog_id, inventory_id, roast_id, sale_id, reference_profile_id, or reference_revision_id.',
      'See the ID map.',
    ],
  },
  {
    title: 'Missing required args in write commands',
    exitCodes: [EXIT_CODES.INVALID_ARGUMENT],
    guidance: [
      'Pass the required positional arguments and flags shown by `--help`; `--form` is an interactive terminal alternative.',
    ],
  },
  {
    title: 'Parser mistakes like unknown options or commands',
    exitCodes: [EXIT_CODES.INVALID_ARGUMENT],
    guidance: [
      'Unknown options, unknown commands, and missing required arguments use the same JSON error envelope contract in machine mode.',
      'In an interactive terminal with no explicit output flag, those parser failures stay human-readable.',
    ],
  },
  {
    title: 'Dependency conflict on delete',
    exitCodes: [EXIT_CODES.DEPENDENCY_CONFLICT],
    guidance: ['Delete dependent roast profiles and sales records explicitly, then retry.'],
  },
  {
    title: 'Mutually exclusive watch flags',
    exitCodes: [EXIT_CODES.INVALID_ARGUMENT],
    guidance: ['`roast watch` forbids using --auto-match together with --coffee-id.'],
  },
  {
    title: 'Pagination only returning the first page',
    exitCodes: [],
    guidance: [
      `Only these commands page with --offset (default --limit): ${paginatedCommands(commandGroups).join(', ')}.`,
      'For example `--limit 20 --offset 40` returns items 41-60.',
    ],
  },
];

/** Commands that take both --limit and --offset, so pagination guidance cannot name one that lacks them. */
function paginatedCommands(groups: CliCommandGroupContract[]): string[] {
  const paged: string[] = [];
  for (const group of groups) {
    const commands = [...(group.command ? [group.command] : []), ...(group.subcommands ?? [])];
    for (const command of commands) {
      const options = command.options ?? [];
      const limit = options.find((option) => option.flags.startsWith('--limit '));
      if (limit && options.some((option) => option.flags.startsWith('--offset '))) {
        const name = command === group.command ? group.name : `${group.name} ${command.name}`;
        paged.push(limit.defaultValue === undefined ? name : `${name} ${limit.defaultValue}`);
      }
    }
  }
  return paged;
}

export function getCliManifest(): CliManifest {
  return {
    schemaVersion: '1',
    binary: 'purvey',
    packageName: '@purveyors/cli',
    description: 'The official CLI for purveyors.io. Coffee intelligence from your terminal.',
    nodeVersion: 'Node.js 20+',
    importPath: '@purveyors/cli/manifest',
    machineSurfaces: {
      humanReference: 'purvey context',
      shellManifest: 'purvey manifest',
      moduleImport: '@purveyors/cli/manifest',
      notes: [
        '`purvey --help` is the quick-discovery surface for commands and global flags.',
        '`purvey context` is the dense human-readable operator reference surface.',
        '`purvey manifest` is the preferred stable machine-readable contract for shells and automation.',
        '`purvey context --json` emits the same manifest contract for compatibility when callers already use the context entrypoint.',
        '`@purveyors/cli/manifest` exposes the same manifest contract in-process for Node.js and agent consumers.',
        '`@purveyors/cli/cherry` is the primary in-process Cherry roast-classification helper; `@purveyors/cli/ai` is its deprecated compatibility re-export.',
      ],
    },
    files: {
      credentials: '~/.config/purvey/credentials.json',
      config: '~/.config/purvey/config.json',
    },
    docs,
    roles,
    globalOptions,
    outputModes,
    outputContract: {
      stdout:
        'Structured JSON by default for most commands, CSV when explicitly requested on supporting commands, and human-readable reference text for `purvey context` unless JSON is requested.',
      stderr:
        'interactive progress and prompts, plus human-readable or structured fatal errors depending on mode',
      notes: [
        'Most commands emit compact JSON to stdout by default.',
        'Use --json to request compact JSON explicitly.',
        'Use --pretty for indented JSON.',
        'Use --csv for array-shaped results that support CSV output.',
        'PURVEYORS_API_KEY or PARCHMENT_API_KEY, when set, is used instead of the key stored by `purvey auth login`.',
        '`purvey context` prints dense human-readable operator reference text unless --json or --pretty is passed.',
        '`purvey manifest` is the preferred machine-readable contract and always emits it on stdout.',
        '`purvey context --json` stays available for compatibility parity with existing context-based callers.',
        '`@purveyors/cli/manifest` exposes the same machine-readable contract for in-process consumers.',
        '`purvey config list/get/set/reset` stay human-readable in an interactive TTY, but emit JSON on stdout in machine mode and reject --csv.',
        'In interactive use, stderr may also carry prompts, spinners, and human-readable status lines.',
        'Parser mistakes like unknown options, unknown commands, and missing required arguments follow the same fatal-error contract as runtime command failures.',
        'Important exception: auth status prints human-readable output in an interactive TTY unless --json, --pretty, or --csv is passed; when piped or redirected it emits structured JSON automatically.',
      ],
      structuredErrors: {
        channel: 'stderr',
        guaranteedFields: ['error', 'code', 'exitCode', 'message'],
        optionalFields: ['details'],
        when: 'Emitted for parser and runtime command failures when the invocation is non-interactive or when --json, --pretty, or --csv selects a machine-readable output mode.',
        exception:
          '`purvey auth status` keeps its status payload on stdout even when unauthenticated; this envelope documents command failures.',
      },
    },
    exitCodes,
    idTypes,
    commandGroups,
    workflows,
    errorPatterns,
  };
}

function renderDocs(docsLinks: CliDocLink[]): string[] {
  return ['DOCS', '----', ...docsLinks.map((link) => `${link.label.padEnd(18, ' ')} ${link.url}`)];
}

function renderRoles(
  roleContracts: CliRoleContract[],
  groups: CliCommandGroupContract[]
): string[] {
  const unauthenticatedCommands = groups
    .filter((group) => group.auth === 'none')
    .map((group) => group.name)
    .sort();
  const localOnlyCommands = groups
    .filter((group) => group.auth === 'none' && group.name !== 'auth')
    .map((group) => group.name)
    .sort();
  const mixedAccessCommands = groups
    .filter((group) => group.auth === 'mixed')
    .map((group) => group.name)
    .sort();

  return [
    'ROLES',
    '-----',
    `No pre-existing credentials required for: ${unauthenticatedCommands.join(', ')}.`,
    `Local-only commands: ${localOnlyCommands.join(', ')}.`,
    `Mixed public and entitled access: ${mixedAccessCommands.join(', ')}.`,
    'Mixed-access public teaser slices can run without credentials; filtered or non-public slices require a valid scoped key and server-side entitlements.',
    'Commands that talk to purveyors.io generally require authentication unless listed above as public, local-only, or mixed-access teaser slices.',
    ...roleContracts.map((role) => `${role.role.padEnd(7, ' ')} ${role.description}`),
    '',
    'viewer comes with any purveyors.io sign-in; member requires a membership (https://purveyors.io/account).',
  ];
}

/** Device-approval steps for `purvey auth login --headless`, shared by context text and the agent skill. */
export const HEADLESS_LOGIN_STEPS = [
  'CLI prints a purveyors.io approval URL',
  'User opens it in any browser, signs in, and approves access',
  'CLI completes automatically; nothing is pasted back',
] as const;

function renderAuthSection(): string[] {
  return [
    'AUTH',
    '----',
    'Interactive login:',
    '  purvey auth login',
    '  Opens the purveyors.io approval page and completes automatically after approval',
    '',
    'Headless login:',
    '  purvey auth login --headless',
    ...HEADLESS_LOGIN_STEPS.map((step, index) => `  ${index + 1}. ${step}`),
    '',
    'Status:',
    '  purvey auth status',
    '  purvey auth status --pretty',
    '  purvey auth status --json',
    '',
    'Logout:',
    '  purvey auth logout',
  ];
}

function renderOutputContract(manifest: CliManifest): string[] {
  const { structuredErrors } = manifest.outputContract;

  return [
    'OUTPUT CONTRACT',
    '---------------',
    `stdout: ${manifest.outputContract.stdout}`,
    `stderr: ${manifest.outputContract.stderr}`,
    '',
    ...manifest.outputContract.notes,
    '',
    `Machine-mode error envelope: ${structuredErrors.channel}`,
    `  guaranteed fields: ${structuredErrors.guaranteedFields.join(', ')}`,
    `  optional fields: ${structuredErrors.optionalFields.join(', ')}`,
    `  when: ${structuredErrors.when}`,
    ...(structuredErrors.exception ? [`  exception: ${structuredErrors.exception}`] : []),
  ];
}

function renderExitCodes(codes: CliExitCodeContract[]): string[] {
  return [
    'EXIT CODES',
    '----------',
    'Check $? after a command finishes.',
    ...codes.map((code) => `${String(code.exitCode).padEnd(2, ' ')} ${code.description}`),
  ];
}

function renderIdMap(ids: CliIdContract[]): string[] {
  const lines = ['ID MAP', '------'];
  for (const id of ids) {
    lines.push(`${id.name.padEnd(14, ' ')} ${id.source}; used by: ${id.usedBy.join(', ')}`);
  }
  lines.push(
    '',
    'Common ID mistakes: tasting get takes catalog_id; tasting rate takes inventory_id; reference-profile commands use profile and revision UUIDs, not roast IDs.'
  );
  return lines;
}

function renderOptions(options: CliOptionContract[] = [], indent = '    '): string[] {
  return options.map((option) => `${indent}${option.flags}`);
}

function renderArgumentUsage(argument: CliArgumentContract): string {
  const token = argument.cliToken ?? argument.name;
  return argument.required ? `<${token}>` : `[${token}]`;
}

function renderCommandEntry(
  command: CliCommandContract,
  indent = '  ',
  displayName = command.name
): string[] {
  const args = command.arguments?.map((argument) => renderArgumentUsage(argument)).join(' ') ?? '';
  const suffix = args ? ` ${args}` : '';
  const optionHint = command.options && command.options.length > 0 ? ' [options]' : '';
  const lines = [`${indent}${displayName}${suffix}${optionHint}`];

  lines.push(...renderOptions(command.options, `${indent}  `));
  if (command.notes) {
    lines.push(...command.notes.map((note) => `${indent}  ${note}`));
  }

  return lines;
}

function renderCommandGroups(groups: CliCommandGroupContract[]): string[] {
  const lines = ['COMMANDS', '--------'];

  for (const group of groups) {
    if (group.command) {
      lines.push(...renderCommandEntry(group.command, '', group.name));
    } else {
      lines.push(group.name);
    }
    for (const subcommand of group.subcommands ?? []) {
      lines.push(...renderCommandEntry(subcommand));
    }
    lines.push('');
  }

  return lines;
}

function renderConfigKeys(): string[] {
  return ['Current config keys:', '  form-mode  true|false'];
}

function renderWorkflows(workflowsList: CliWorkflowContract[]): string[] {
  const lines = ['WORKFLOWS', '---------'];
  for (const workflow of workflowsList) {
    lines.push(`${workflow.title}:`);
    for (const command of workflow.commands) {
      lines.push(`  ${command}`);
    }
    lines.push('');
  }
  lines.pop();
  return lines;
}

function renderErrorPatterns(patterns: CliErrorPatternContract[]): string[] {
  const lines = ['ERROR PATTERNS', '--------------'];
  for (const pattern of patterns) {
    lines.push(
      `${pattern.title}${pattern.exitCodes.length > 0 ? ` (exit ${pattern.exitCodes.join('/')})` : ''}:`
    );
    for (const item of pattern.guidance) {
      lines.push(`  ${item}`);
    }
    lines.push('');
  }
  lines.pop();
  return lines;
}

function resolveMachineSurfaces(manifest: CliManifest): CliManifest['machineSurfaces'] {
  const machineSurfaces = (
    manifest as CliManifest & {
      machineSurfaces?: Partial<CliManifest['machineSurfaces']>;
    }
  ).machineSurfaces;

  return {
    humanReference: machineSurfaces?.humanReference ?? legacyMachineSurfaces.humanReference,
    shellManifest: machineSurfaces?.shellManifest ?? legacyMachineSurfaces.shellManifest,
    moduleImport: machineSurfaces?.moduleImport ?? legacyMachineSurfaces.moduleImport,
    notes: machineSurfaces?.notes ?? legacyMachineSurfaces.notes,
  };
}

export function renderContextText(manifest: CliManifest = getCliManifest()): string {
  const machineSurfaces = resolveMachineSurfaces(manifest);

  return [
    'PURVEY CLI - Agent Reference',
    '============================',
    `${manifest.description} ${manifest.nodeVersion}.`,
    `Credentials file: ${manifest.files.credentials}`,
    `Config file: ${manifest.files.config}`,
    `Quick discovery:  purvey --help`,
    `Human reference:  ${machineSurfaces.humanReference}`,
    `JSON manifest:    ${machineSurfaces.shellManifest}`,
    `Module import:    ${machineSurfaces.moduleImport}`,
    '',
    ...renderDocs(manifest.docs),
    '',
    ...renderRoles(manifest.roles, manifest.commandGroups),
    '',
    ...renderAuthSection(),
    '',
    ...renderOutputContract(manifest),
    '',
    ...renderExitCodes(manifest.exitCodes),
    '',
    ...renderIdMap(manifest.idTypes),
    '',
    ...renderCommandGroups(manifest.commandGroups),
    ...renderConfigKeys(),
    '',
    ...renderWorkflows(manifest.workflows),
    '',
    ...renderErrorPatterns(manifest.errorPatterns),
  ]
    .join('\n')
    .trim();
}
