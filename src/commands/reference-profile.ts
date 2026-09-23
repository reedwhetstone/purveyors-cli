import { basename } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { Command } from 'commander';
import { PrvrsError, withErrorHandling } from '../lib/errors.js';
import {
  exportGeneratedReferenceProfile,
  getReferenceProfile,
  getReferenceProfileChart,
  importReferenceProfile,
  listReferenceProfiles,
  parseReferenceProfileImportRequest,
  previewReferenceProfile,
  readReferenceProfileGenerationRequest,
  REFERENCE_PROFILE_SOURCE_MAX_BYTES,
  saveGeneratedReferenceProfile,
  writeGeneratedReferenceFile,
} from '../lib/reference-profiles.js';
import { normalizePathInput } from '../lib/path-input.js';
import { outputData } from '../lib/output.js';
import type { OutputOptions } from '../types/index.js';

function idempotencyKeyOption(command: Command, description: string): Command {
  return command.option(
    '--idempotency-key <key>',
    `${description}; a new UUID is generated when omitted`
  );
}

/** `purvey reference-profile` — owner-scoped Studio plans through Parchment's SDK. */
export function buildReferenceProfileCommand(): Command {
  const referenceProfile = new Command('reference-profile').description(
    'Preview, save, and export Studio Artisan reference plans through Parchment'
  );

  referenceProfile
    .command('list')
    .description('List your Studio reference profiles')
    .option('--include-archived', 'Include archived reference profiles')
    .addHelpText(
      'after',
      `
Examples:
  purvey reference-profile list --pretty
  purvey reference-profile list --include-archived --json

Notes:
  Requires a member credential and Studio access; entitlement is enforced by Parchment.`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const data = await listReferenceProfiles(Boolean(opts.includeArchived));
        outputData(data, globalOpts);
      })
    );

  referenceProfile
    .command('get <profile-id>')
    .description('Get one reference profile and its current revision')
    .addHelpText(
      'after',
      `
Example:
  purvey reference-profile get 5ea1af6f-234c-43a9-9bf8-5678dd24f854 --pretty

Use data.currentRevision.id as the revision id for chart, preview, and save.`
    )
    .action(
      withErrorHandling(async (profileId: string, _opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const data = await getReferenceProfile(profileId);
        outputData(data, globalOpts);
      })
    );

  referenceProfile
    .command('chart <profile-id> <revision-id>')
    .description('Get the typed Artisan chart for a reference revision')
    .addHelpText(
      'after',
      `
Example:
  purvey reference-profile chart <profile-id> <revision-id> --pretty`
    )
    .action(
      withErrorHandling(
        async (
          profileId: string,
          revisionId: string,
          _opts: Record<string, unknown>,
          cmd: Command
        ) => {
          const globalOpts = cmd.optsWithGlobals() as OutputOptions;
          const data = await getReferenceProfileChart(profileId, revisionId);
          outputData(data, globalOpts);
        }
      )
    );

  const importCommand = referenceProfile
    .command('import <file>')
    .description('Upload an Artisan reference file as a private Studio profile')
    .option('--title <text>', 'Title for the reference profile')
    .option('--notes <text>', 'Notes about the reference profile')
    .addHelpText(
      'after',
      `
Examples:
  purvey reference-profile import ~/artisan/ethiopia.alog --title "Ethiopia baseline" --pretty
  purvey reference-profile import ~/artisan/ethiopia.alog --idempotency-key <stable-uuid> --json

Notes:
  Parchment parses and retains the private source (up to 10,000,000 bytes); this command does not create roast history.
  Reuse an explicit idempotency key to safely retry the same upload.`
    );
  idempotencyKeyOption(importCommand, 'Stable key for safe retries');
  importCommand.action(
    withErrorHandling(async (inputPath: string, opts: Record<string, unknown>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as OutputOptions;
      const filePath = normalizePathInput(inputPath);
      if (!filePath) {
        throw new PrvrsError(
          'INVALID_ARGUMENT',
          'The Artisan reference file path cannot be blank.'
        );
      }

      const fileInfo = await stat(filePath);
      if (!fileInfo.isFile()) {
        throw new PrvrsError('INVALID_ARGUMENT', 'The Artisan reference path must be a file.');
      }
      if (fileInfo.size === 0 || fileInfo.size > REFERENCE_PROFILE_SOURCE_MAX_BYTES) {
        throw new PrvrsError(
          'INVALID_ARGUMENT',
          `The Artisan reference must be between 1 and ${REFERENCE_PROFILE_SOURCE_MAX_BYTES} bytes.`
        );
      }

      const fileContent = await readFile(filePath, 'utf8');
      const body = parseReferenceProfileImportRequest({
        ...(opts.title !== undefined ? { title: String(opts.title) } : {}),
        ...(opts.notes !== undefined ? { notes: String(opts.notes) } : {}),
        fileName: basename(filePath),
        fileContent,
        fileSize: Buffer.byteLength(fileContent, 'utf8'),
      });
      const data = await importReferenceProfile(
        body,
        opts.idempotencyKey ? String(opts.idempotencyKey) : undefined
      );
      outputData(data, globalOpts);
    })
  );

  const previewCommand = referenceProfile
    .command('preview <profile-id> <revision-id>')
    .description('Preview a bounded set of temperature adjustments without saving')
    .requiredOption(
      '--request <file>',
      'JSON file with a title and bounded temperature adjustments'
    )
    .addHelpText(
      'after',
      `
Example:
  purvey reference-profile preview <profile-id> <revision-id> --request changes.json --pretty

The request file is also the exact body accepted by save. Parchment recalculates from the
immutable parent; preview never changes or stores the source.`
    );
  previewCommand.action(
    withErrorHandling(
      async (
        profileId: string,
        revisionId: string,
        opts: Record<string, unknown>,
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const request = await readReferenceProfileGenerationRequest(String(opts.request));
        const data = await previewReferenceProfile(profileId, revisionId, request);
        outputData(data, globalOpts);
      }
    )
  );

  const saveCommand = referenceProfile
    .command('save <profile-id> <revision-id>')
    .description('Save the previewed changes as a new immutable generated reference')
    .requiredOption(
      '--request <file>',
      'JSON file with a title and bounded temperature adjustments'
    );
  idempotencyKeyOption(saveCommand, 'Stable key for safe retries');
  saveCommand.addHelpText(
    'after',
    `
Example:
  purvey reference-profile save <profile-id> <revision-id> --request changes.json --pretty

Notes:
  Omit --idempotency-key to generate a new key for this call. Reuse an explicit key to replay a retry.
  A generated reference is a plan, not executed roast history.`
  );
  saveCommand.action(
    withErrorHandling(
      async (
        profileId: string,
        revisionId: string,
        opts: Record<string, unknown>,
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const request = await readReferenceProfileGenerationRequest(String(opts.request));
        const data = await saveGeneratedReferenceProfile(
          profileId,
          revisionId,
          request,
          opts.idempotencyKey ? String(opts.idempotencyKey) : undefined
        );
        outputData(data, globalOpts);
      }
    )
  );

  const exportCommand = referenceProfile
    .command('export <profile-id> <revision-id>')
    .description('Download a saved generated reference as an unsigned Artisan .alog plan')
    .requiredOption('--output <file>', 'Destination for the generated .alog file')
    .option('--force', 'Overwrite the destination file if it already exists')
    .addHelpText(
      'after',
      `
Example:
  purvey reference-profile export <generated-profile-id> <generated-revision-id> --output ~/artisan/next-batch.alog

Only a saved generated revision can be exported. Export writes the .alog file locally and
prints a JSON receipt; it does not claim verified Artisan 4.2 playback compatibility.`
    );
  exportCommand.action(
    withErrorHandling(
      async (
        profileId: string,
        revisionId: string,
        opts: Record<string, unknown>,
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const destination = normalizePathInput(String(opts.output ?? ''));
        if (!destination) {
          throw new PrvrsError('INVALID_ARGUMENT', 'The export destination path cannot be blank.');
        }
        const result = await exportGeneratedReferenceProfile(profileId, revisionId);
        const outputFile = await writeGeneratedReferenceFile(
          result.data.fileContent,
          destination,
          Boolean(opts.force)
        );

        outputData(
          {
            data: {
              profileId,
              revisionId,
              fileName: result.data.fileName,
              fileSize: result.data.fileSize,
              outputPath: outputFile,
            },
          },
          globalOpts
        );
      }
    )
  );

  return referenceProfile;
}
