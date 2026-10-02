import { basename } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { Command } from 'commander';
import { PrvrsError, withErrorHandling } from '../lib/errors.js';
import {
  compareProfiles,
  exportGeneratedReferenceProfile,
  getReferenceProfile,
  getReferenceProfileChart,
  importReferenceProfile,
  listReferenceProfiles,
  parseProfileComparisonSelector,
  parseReferenceProfileImportRequest,
  previewReferenceProfile,
  PROFILE_COMPARISON_TARGET_POINTS,
  profileComparisonUnits,
  type ProfileComparisonUnit,
  readReferenceProfileGenerationRequest,
  REFERENCE_PROFILE_SOURCE_MAX_BYTES,
  saveGeneratedReferenceProfile,
  writeGeneratedReferenceFile,
} from '../lib/reference-profiles.js';
import { normalizePathInput } from '../lib/path-input.js';
import { outputData } from '../lib/output.js';
import { parseStrictPositiveCount } from '../lib/strict-number.js';
import type { OutputOptions } from '../types/index.js';

function idempotencyKeyOption(command: Command): Command {
  return command.option('--idempotency-key <key>');
}

/** `purvey reference-profile` — owner-scoped Studio plans through Parchment's SDK. */
export function buildReferenceProfileCommand(): Command {
  const referenceProfile = new Command('reference-profile').description(
    'Compare, preview, save, and export Studio Artisan reference plans through Parchment'
  );

  referenceProfile
    .command('list')
    .description('List your Studio reference profiles')
    .option('--include-archived')
    .addHelpText(
      'after',
      `
Examples:
  purvey reference-profile list --pretty
  purvey reference-profile list --include-archived --json

Notes:
  Requires a member credential and Studio access on your account.`
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
  purvey reference-profile chart 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --pretty`
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

  referenceProfile
    .command('compare <left> <right>')
    .description('Compare two immutable roast or reference revisions with measured deltas')
    .option('--unit <F|C>', '', 'F')
    .option('--target-points <n>', '', String(PROFILE_COMPARISON_TARGET_POINTS.default))
    .addHelpText(
      'after',
      `
Examples:
  purvey reference-profile compare roast:123 profile:5ea1af6f-234c-43a9-9bf8-5678dd24f854 --pretty
  purvey reference-profile compare roast:123 roast:124 --unit C --json
  purvey reference-profile compare revision:8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 roast:123@2026-09-30T14:22:05.123456+00:00 --pretty

Selectors:
  revision:<uuid>          exact reference-profile revision
  profile:<uuid>           the reference profile's current revision
  roast:<roast-id>         the executed roast's current chart revision
  roast:<roast-id>@<rev>   an exact executed-roast chart revision (data.metadata.revision from 'purvey roast chart')

Notes:
  Parchment aligns both sides at charge and returns measured deltas and milestones unchanged.
  A reference profile is a plan or comparison reference, never executed roast history.
  Requires a member credential and Studio access on your account.`
    )
    .action(
      withErrorHandling(
        async (left: string, right: string, opts: Record<string, unknown>, cmd: Command) => {
          const globalOpts = cmd.optsWithGlobals() as OutputOptions;
          const unit = String(opts.unit).trim().toUpperCase();
          if (!profileComparisonUnits.includes(unit as ProfileComparisonUnit)) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              `Invalid --unit: "${String(opts.unit)}". Must be one of: ${profileComparisonUnits.join(', ')}.`
            );
          }
          const targetPoints = parseStrictPositiveCount(String(opts.targetPoints));
          if (
            !Number.isFinite(targetPoints) ||
            targetPoints < PROFILE_COMPARISON_TARGET_POINTS.minimum ||
            targetPoints > PROFILE_COMPARISON_TARGET_POINTS.maximum
          ) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              `Invalid --target-points: "${String(opts.targetPoints)}". Must be an integer between ${PROFILE_COMPARISON_TARGET_POINTS.minimum} and ${PROFILE_COMPARISON_TARGET_POINTS.maximum}.`
            );
          }

          const data = await compareProfiles({
            left: parseProfileComparisonSelector(left, 'left'),
            right: parseProfileComparisonSelector(right, 'right'),
            targetUnit: unit as ProfileComparisonUnit,
            targetPoints,
          });
          outputData(data, globalOpts);
        }
      )
    );

  const importCommand = referenceProfile
    .command('import <file>')
    .description('Upload an Artisan reference file as a private Studio profile')
    .option('--title <text>')
    .option('--notes <text>')
    .addHelpText(
      'after',
      `
Examples:
  purvey reference-profile import ~/artisan/ethiopia.alog --title "Ethiopia baseline" --pretty
  purvey reference-profile import ~/artisan/ethiopia.alog --idempotency-key 3f6c2a1b-8e4d-4b7a-9c05-7e1f2d3a4b5c --json

Notes:
  Parchment parses and retains the private source (up to 10,000,000 bytes); this command does not create roast history.
  Reuse an explicit idempotency key to safely retry the same upload.`
    );
  idempotencyKeyOption(importCommand);
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
    .requiredOption('--request <file>')
    .addHelpText(
      'after',
      `
Example:
  purvey reference-profile preview 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --request changes.json --pretty

The request file is also the exact body accepted by save: title, optional notes, optional
userGoal/modelRecommendation/userEdits provenance, and changes.temperatureAdjustments.
Parchment recalculates from the immutable parent; preview never changes or stores the source.`
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
    .requiredOption('--request <file>');
  idempotencyKeyOption(saveCommand);
  saveCommand.addHelpText(
    'after',
    `
Example:
  purvey reference-profile save 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --request changes.json --pretty

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
    .requiredOption('--output <file>')
    .option('--force')
    .addHelpText(
      'after',
      `
Example:
  purvey reference-profile export 0b7e9f52-3c61-4d8a-9e24-6f1a8c3d5b90 c43a1d7e-95b2-4e06-8f7c-1d2b3a4e5f68 --output ~/artisan/next-batch.alog

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
