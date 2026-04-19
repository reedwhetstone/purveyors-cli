import { EXIT_CODES } from './errors.js';

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
  { label: 'API docs', url: 'https://purveyors.io/docs/api/overview' },
  { label: 'Repository', url: 'https://github.com/reedwhetstone/purveyors-cli' },
  { label: 'npm package', url: 'https://www.npmjs.com/package/@purveyors/cli' },
];

const roles: CliRoleContract[] = [
  { role: 'viewer', description: 'valid authenticated session; required for all catalog commands' },
  { role: 'member', description: 'required for inventory, roast, sales, and tasting commands' },
];

const globalOptions: CliOptionContract[] = [
  { flags: '--json', description: 'Output compact JSON explicitly' },
  { flags: '--pretty', description: 'Pretty-print JSON output with colors' },
  { flags: '--csv', description: 'Output array results as CSV where supported' },
  { flags: '--help', description: 'Show help for any command' },
  { flags: '--version', description: 'Show version number' },
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
    description: 'unexpected or unclassified error',
  },
  {
    exitCode: EXIT_CODES.INVALID_ARGUMENT,
    code: 'INVALID_ARGUMENT',
    description: 'invalid argument or bad input',
  },
  {
    exitCode: EXIT_CODES.AUTH_ERROR,
    code: 'AUTH_ERROR',
    description: 'auth error, not logged in, expired session, or wrong role',
  },
  { exitCode: EXIT_CODES.NOT_FOUND, code: 'NOT_FOUND', description: 'resource not found' },
  {
    exitCode: EXIT_CODES.DEPENDENCY_CONFLICT,
    code: 'DEPENDENCY_CONFLICT',
    description: 'dependency conflict, for example delete without --force',
  },
  { exitCode: EXIT_CODES.CONFIG_ERROR, code: 'CONFIG_ERROR', description: 'local config error' },
];

const idTypes: CliIdContract[] = [
  {
    name: 'catalog_id',
    source: 'coffee_catalog row',
    usedBy: [
      'catalog get',
      'inventory add --catalog-id',
      'tasting get <catalog_id>',
      'roast list --catalog-id',
    ],
  },
  {
    name: 'inventory_id',
    source: 'green_coffee_inv row',
    usedBy: [
      'inventory get/update/delete',
      'roast --coffee-id',
      'roast list --coffee-id',
      'tasting rate [inventory_id]',
    ],
  },
  {
    name: 'roast_id',
    source: 'roast_data row',
    usedBy: ['roast get/delete', 'roast list --roast-id', 'sales --roast-id'],
  },
  {
    name: 'sale_id',
    source: 'coffee_sales row',
    usedBy: ['sales update/delete'],
  },
];

const commandGroups: CliCommandGroupContract[] = [
  {
    name: 'auth',
    summary: 'Manage authentication with purveyors.io',
    auth: 'none',
    subcommands: [
      {
        name: 'login',
        summary: 'Log in to purveyors.io',
        auth: 'none',
        options: [
          { flags: '--headless', description: 'Print OAuth URL and accept pasted callback URL' },
        ],
        examples: ['purvey auth login', 'purvey auth login --headless'],
      },
      {
        name: 'status',
        summary: 'Show current login status and role',
        auth: 'none',
        options: [{ flags: '--pretty' }, { flags: '--csv' }],
        examples: [
          'purvey auth status',
          'purvey auth status --pretty',
          'purvey auth status --json',
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
    summary: 'Browse the coffee catalog',
    auth: 'viewer',
    subcommands: [
      {
        name: 'search',
        summary: 'Search coffees by origin, process, price, flavor, and catalog metadata',
        auth: 'viewer',
        options: [
          { flags: '--origin <origin>' },
          { flags: '--process <method>' },
          { flags: '--price-min <n>' },
          { flags: '--price-max <n>' },
          { flags: '--flavor <keywords>' },
          { flags: '--name <text>' },
          { flags: '--supplier <name>' },
          { flags: '--ids <n,n,...>' },
          { flags: '--variety <text>' },
          { flags: '--drying-method <text>' },
          { flags: '--stocked-days <n>' },
          { flags: '--stocked' },
          { flags: '--sort <field>' },
          { flags: '--offset <n>', defaultValue: 0 },
          { flags: '--limit <n>', defaultValue: 10 },
        ],
        notes: [
          'All filters are optional. Without flags, returns up to --limit results.',
          '--ids fetches specific catalog items by ID, ignoring --limit and --offset.',
          '--offset + --limit enables pagination through large result sets.',
        ],
        examples: [
          'purvey catalog search --origin "Ethiopia" --process "natural" --pretty',
          'purvey catalog search --variety "gesha" --stocked --pretty',
          'purvey catalog search --drying-method "sun" --origin "Ethiopia" --pretty',
          'purvey catalog search --stocked-days 30 --pretty',
        ],
      },
      {
        name: 'get',
        summary: 'Get details for a specific coffee by ID',
        auth: 'viewer',
        arguments: [
          {
            name: 'catalog_id',
            cliToken: 'id',
            description: 'coffee_catalog.catalog_id',
            required: true,
            idType: 'catalog_id',
          },
        ],
        examples: ['purvey catalog get 128 --pretty'],
      },
      {
        name: 'stats',
        summary: 'Aggregate statistics for the catalog',
        auth: 'viewer',
        examples: ['purvey catalog stats --pretty'],
      },
      {
        name: 'similar',
        summary: 'Find similar coffees by catalog ID',
        auth: 'viewer',
        arguments: [
          {
            name: 'catalog_id',
            cliToken: 'id',
            description: 'coffee_catalog.catalog_id',
            required: true,
            idType: 'catalog_id',
          },
        ],
        options: [
          { flags: '--threshold <0-1>', defaultValue: 0.7 },
          { flags: '--limit <n>', defaultValue: 10 },
          { flags: '--stocked-only' },
        ],
        examples: ['purvey catalog similar 1182 --threshold 0.85 --stocked-only --json'],
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
        options: [
          { flags: '--stocked' },
          { flags: '--catalog-id <id>' },
          { flags: '--purchase-date-start <YYYY-MM-DD>' },
          { flags: '--purchase-date-end <YYYY-MM-DD>' },
          { flags: '--origin <country>' },
          { flags: '--limit <n>', defaultValue: 20 },
          { flags: '--offset <n>', defaultValue: 0 },
        ],
        notes: [
          'Returns green_coffee_inv rows joined with catalog details.',
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
        arguments: [
          {
            name: 'inventory_id',
            cliToken: 'id',
            description: 'green_coffee_inv.id',
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
        options: [
          { flags: '--catalog-id <id>', requiredInFlagMode: true },
          { flags: '--qty <lbs>', requiredInFlagMode: true },
          { flags: '--cost <dollars>' },
          { flags: '--tax-ship <dollars>' },
          { flags: '--notes <text>' },
          { flags: '--purchase-date <YYYY-MM-DD>' },
          { flags: '--form' },
        ],
        examples: ['purvey inventory add --catalog-id 128 --qty 10 --cost 8.50 --pretty'],
      },
      {
        name: 'update',
        summary: 'Update an inventory item',
        auth: 'member',
        arguments: [
          {
            name: 'inventory_id',
            cliToken: 'id',
            description: 'green_coffee_inv.id',
            required: true,
            idType: 'inventory_id',
          },
        ],
        options: [
          { flags: '--qty <lbs>' },
          { flags: '--cost <dollars>' },
          { flags: '--tax-ship <dollars>' },
          { flags: '--notes <text>' },
          { flags: '--stocked <true|false>' },
        ],
      },
      {
        name: 'delete',
        summary: 'Delete an inventory item',
        auth: 'member',
        arguments: [
          {
            name: 'inventory_id',
            cliToken: 'id',
            description: 'green_coffee_inv.id',
            required: true,
            idType: 'inventory_id',
          },
        ],
        options: [
          { flags: '--yes' },
          {
            flags: '--force',
            notes: [
              'Cascade delete dependent roast profiles and sales records before deleting the item.',
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'roast',
    summary: 'Browse and manage your roast profiles',
    auth: 'member',
    subcommands: [
      {
        name: 'list',
        summary: 'List your roast profiles, sorted by date',
        auth: 'member',
        options: [
          { flags: '--coffee-id <id>' },
          { flags: '--roast-id <id>' },
          { flags: '--batch-name <text>' },
          { flags: '--coffee-name <text>' },
          { flags: '--date-start <YYYY-MM-DD>' },
          { flags: '--date-end <YYYY-MM-DD>' },
          { flags: '--stocked' },
          { flags: '--catalog-id <id>' },
          { flags: '--limit <n>', defaultValue: 20 },
          { flags: '--offset <n>', defaultValue: 0 },
        ],
        notes: [
          '--coffee-id expects inventory_id, not catalog_id.',
          '--catalog-id filters by coffee_catalog.catalog_id.',
          '--date-start and --date-end accept YYYY-MM-DD format.',
          '--offset + --limit enables pagination through large result sets.',
        ],
        examples: ['purvey roast list --date-start 2026-03-01 --date-end 2026-03-31'],
      },
      {
        name: 'get',
        summary: 'Get a single roast profile',
        auth: 'member',
        arguments: [
          {
            name: 'roast_id',
            cliToken: 'id',
            description: 'roast_data.roast_id',
            required: true,
            idType: 'roast_id',
          },
        ],
        options: [{ flags: '--include-temps' }, { flags: '--include-events' }],
      },
      {
        name: 'create',
        summary: 'Create a new roast profile',
        auth: 'member',
        options: [
          { flags: '--coffee-id <id>', requiredInFlagMode: true },
          { flags: '--batch-name <name>' },
          { flags: '--oz-in <oz>' },
          { flags: '--oz-out <oz>' },
          { flags: '--roast-date <YYYY-MM-DD>' },
          { flags: '--notes <text>' },
          { flags: '--form' },
        ],
      },
      {
        name: 'update',
        summary: 'Update a roast profile',
        auth: 'member',
        arguments: [
          {
            name: 'roast_id',
            cliToken: 'id',
            description: 'roast_data.roast_id',
            required: true,
            idType: 'roast_id',
          },
        ],
        options: [
          { flags: '--notes <text>' },
          { flags: '--oz-out <oz>' },
          { flags: '--batch-name <name>' },
          { flags: '--targets <text>' },
        ],
      },
      {
        name: 'delete',
        summary: 'Delete a roast profile',
        auth: 'member',
        arguments: [
          {
            name: 'roast_id',
            cliToken: 'id',
            description: 'roast_data.roast_id',
            required: true,
            idType: 'roast_id',
          },
        ],
        options: [{ flags: '--yes' }],
      },
      {
        name: 'import',
        summary: 'Import an Artisan .alog roast file',
        auth: 'member',
        arguments: [{ name: 'file', description: 'Path to Artisan .alog file', required: false }],
        options: [
          { flags: '--coffee-id <id>', requiredInFlagMode: true },
          { flags: '--batch-name <name>' },
          { flags: '--oz-in <oz>' },
          { flags: '--roast-notes <text>' },
          { flags: '--roast-targets <text>' },
          { flags: '--form' },
        ],
      },
      {
        name: 'watch',
        summary: 'Watch a directory for new Artisan .alog files',
        auth: 'member',
        arguments: [{ name: 'directory', description: 'Directory to watch', required: false }],
        options: [
          { flags: '--coffee-id <inventory_id>' },
          { flags: '--batch-prefix <name>' },
          { flags: '--prompt-each' },
          { flags: '--auto-match' },
          { flags: '--commit-mode <batch|individual>', defaultValue: 'batch' },
          { flags: '--oz-in <oz>' },
          { flags: '--roast-notes <text>' },
          { flags: '--roast-targets <text>' },
          { flags: '--resume' },
          { flags: '--form' },
        ],
        notes: [
          '--auto-match is mutually exclusive with --coffee-id.',
          '--commit-mode defaults to batch so new roasts are queued until the session ends.',
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
        options: [
          { flags: '--roast-id <id>' },
          { flags: '--date-start <YYYY-MM-DD>' },
          { flags: '--date-end <YYYY-MM-DD>' },
          { flags: '--buyer <name>' },
          { flags: '--limit <n>', defaultValue: 20 },
          { flags: '--offset <n>', defaultValue: 0 },
        ],
        notes: [
          '--date-start and --date-end accept YYYY-MM-DD and compose into a range.',
          '--offset + --limit enables pagination through large result sets.',
        ],
      },
      {
        name: 'record',
        summary: 'Record a new sale',
        auth: 'member',
        options: [
          { flags: '--roast-id <id>', requiredInFlagMode: true },
          { flags: '--oz <amount>', requiredInFlagMode: true },
          { flags: '--price <dollars>', requiredInFlagMode: true },
          { flags: '--buyer <name>' },
          { flags: '--sell-date <YYYY-MM-DD>' },
          { flags: '--form' },
        ],
      },
      {
        name: 'update',
        summary: 'Update a sale record',
        auth: 'member',
        arguments: [
          {
            name: 'sale_id',
            cliToken: 'id',
            description: 'coffee_sales row id',
            required: true,
            idType: 'sale_id',
          },
        ],
        options: [
          { flags: '--oz <amount>' },
          { flags: '--price <dollars>' },
          { flags: '--buyer <name>' },
          { flags: '--sell-date <YYYY-MM-DD>' },
        ],
      },
      {
        name: 'delete',
        summary: 'Delete a sale record',
        auth: 'member',
        arguments: [
          {
            name: 'sale_id',
            cliToken: 'id',
            description: 'coffee_sales row id',
            required: true,
            idType: 'sale_id',
          },
        ],
        options: [{ flags: '--yes' }],
      },
    ],
  },
  {
    name: 'tasting',
    summary: 'View and record tasting notes for a coffee bean',
    auth: 'member',
    subcommands: [
      {
        name: 'get',
        summary: 'Get tasting notes for a coffee',
        auth: 'member',
        arguments: [
          {
            name: 'catalog_id',
            cliToken: 'bean-id',
            description: 'coffee_catalog.catalog_id, not inventory id',
            required: true,
            idType: 'catalog_id',
          },
        ],
        options: [{ flags: '--filter <user|supplier|both>', defaultValue: 'both' }],
      },
      {
        name: 'rate',
        summary: 'Rate a coffee bean with cupping scores',
        auth: 'member',
        arguments: [
          {
            name: 'inventory_id',
            cliToken: 'bean-id',
            description: 'green_coffee_inv.id, not catalog_id',
            required: false,
            idType: 'inventory_id',
          },
        ],
        options: [
          { flags: '--aroma <1-5>', requiredInFlagMode: true },
          { flags: '--body <1-5>', requiredInFlagMode: true },
          { flags: '--acidity <1-5>', requiredInFlagMode: true },
          { flags: '--sweetness <1-5>', requiredInFlagMode: true },
          { flags: '--aftertaste <1-5>', requiredInFlagMode: true },
          { flags: '--brew-method <method>' },
          { flags: '--notes <text>' },
          { flags: '--form' },
        ],
      },
    ],
  },
  {
    name: 'config',
    summary: 'Manage purvey CLI settings',
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
    summary: 'Emit dense human-readable operator reference or manifest-parity JSON',
    auth: 'none',
    command: {
      name: 'context',
      summary: 'Emit dense human-readable operator reference or manifest-parity JSON',
      auth: 'none',
      options: [{ flags: '--json' }, { flags: '--pretty' }],
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
    summary: 'Emit the preferred stable machine-readable CLI manifest contract',
    auth: 'none',
    command: {
      name: 'manifest',
      summary: 'Emit the preferred stable machine-readable CLI manifest contract',
      auth: 'none',
      options: [{ flags: '--json' }, { flags: '--pretty' }],
      notes: [
        '`purvey manifest` is the preferred machine-readable entrypoint and emits compact JSON by default.',
        '`purvey context --json` remains available for compatibility with existing context-based callers.',
        'The same contract is available in-process via `@purveyors/cli/manifest`.',
      ],
      examples: ['purvey manifest', 'purvey manifest --pretty'],
    },
  },
];

const workflows: CliWorkflowContract[] = [
  {
    title: 'Catalog to inventory',
    commands: [
      'purvey catalog search --origin "Ethiopia" --stocked --pretty',
      'purvey inventory add --catalog-id 128 --qty 10 --cost 8.50',
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
      'purvey sales record --roast-id 123 --oz 12 --price 22.00 --buyer "Jane Smith"',
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
      'Verify whether the command wants catalog_id, inventory_id, roast_id, or sale_id.',
      'See the ID MAP section.',
    ],
  },
  {
    title: 'Missing required args in write commands',
    exitCodes: [EXIT_CODES.INVALID_ARGUMENT],
    guidance: ['Pass the required flags or use --form.'],
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
    guidance: ['Add `--force` to cascade delete dependent roast profiles and sales records.'],
  },
  {
    title: 'Mutually exclusive watch flags',
    exitCodes: [EXIT_CODES.INVALID_ARGUMENT],
    guidance: ['`roast watch` forbids using --auto-match together with --coffee-id.'],
  },
  {
    title: 'Pagination only returning the first 20 results',
    exitCodes: [],
    guidance: [
      'All list commands default to --limit 20.',
      'Use --offset to page, for example `--limit 20 --offset 40` returns items 41-60.',
    ],
  },
];

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

  return [
    'ROLES',
    '-----',
    `No pre-existing session required for: ${unauthenticatedCommands.join(', ')}.`,
    `Local-only commands: ${localOnlyCommands.join(', ')}.`,
    'Commands that talk to purveyors.io require authentication, except for the auth commands that establish or inspect a session.',
    ...roleContracts.map((role) => `${role.role.padEnd(7, ' ')} ${role.description}`),
    '',
    'Both roles are granted on sign-in through purveyors.io.',
  ];
}

function renderAuthSection(): string[] {
  return [
    'AUTH',
    '----',
    'Interactive login:',
    '  purvey auth login',
    '',
    'Headless login:',
    '  purvey auth login --headless',
    '  1. CLI prints a Google OAuth URL',
    '  2. User opens it in any browser and signs in',
    '  3. User pastes the full callback URL back into the terminal',
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
    'Common ID mistake: tasting get takes catalog_id; tasting rate takes inventory_id.'
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
      lines.push('');
      continue;
    }

    lines.push(group.name);
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
