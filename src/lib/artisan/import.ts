import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArtisanRoastData, MilestoneData, ProcessedRoastData } from './types.js';
import { validateArtisanData, validateProcessedData } from './validator.js';
import { normalizeArtisanTemperatures, artisanModeToUnit } from './temperature.js';
import { processAlogFile } from './parser.js';
import { clearRoastData, insertTemperatures, insertEvents } from './db.js';

export interface ArtisanImportResult {
  success: boolean;
  message: string;
  milestones: MilestoneData;
  phases: ProcessedRoastData['phases'];
  total_time: number;
  temperature_unit: 'F' | 'C';
  milestone_events: number;
  control_events: number;
}

// Parse Artisan .alog or .alog.json data
export async function parseArtisanFile(
  fileContent: string,
  fileName: string
): Promise<ArtisanRoastData> {
  try {
    let data: unknown;

    if (fileName.toLowerCase().endsWith('.alog')) {
      // Parse Python literal syntax (.alog file)
      data = processAlogFile(fileContent);
    } else {
      // Parse standard JSON (.alog.json file)
      data = JSON.parse(fileContent);
    }

    // Validate the basic structure
    const validation = validateArtisanData(data);
    if (!validation.valid) {
      throw new Error(`Invalid Artisan file: ${validation.errors.join(', ')}`);
    }

    // Map 'mode' to 'temperature_unit' for consistency
    (data as ArtisanRoastData).temperature_unit = artisanModeToUnit(
      (data as ArtisanRoastData).mode
    );

    return data as ArtisanRoastData;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to parse Artisan file');
  }
}

// Extract milestone events from Artisan timeindex array
function extractMilestones(artisanData: ArtisanRoastData): MilestoneData {
  const milestones: MilestoneData = {};
  const { timex, timeindex } = artisanData;

  // timeindex maps: [CHARGE, DRY_END, FC_START, FC_END, SC_START, SC_END, DROP, COOL]
  if (timeindex[0] > 0 && timeindex[0] < timex.length) {
    milestones.charge = timex[timeindex[0]];
  }
  if (timeindex[1] > 0 && timeindex[1] < timex.length) {
    milestones.dry_end = timex[timeindex[1]];
  }
  if (timeindex[2] > 0 && timeindex[2] < timex.length) {
    milestones.fc_start = timex[timeindex[2]];
  }
  if (timeindex[3] > 0 && timeindex[3] < timex.length) {
    milestones.fc_end = timex[timeindex[3]];
  }
  if (timeindex[4] > 0 && timeindex[4] < timex.length) {
    milestones.sc_start = timex[timeindex[4]];
  }
  if (timeindex[5] > 0 && timeindex[5] < timex.length) {
    milestones.sc_end = timex[timeindex[5]];
  }
  if (timeindex[6] > 0 && timeindex[6] < timex.length) {
    milestones.drop = timex[timeindex[6]];
  }
  if (timeindex[7] > 0 && timeindex[7] < timex.length) {
    milestones.cool = timex[timeindex[7]];
  }

  return milestones;
}

// Transform parsed Artisan data into database format
export function transformArtisanData(
  parsedData: ArtisanRoastData,
  roastId: number
): ProcessedRoastData {
  const { timex, temp1, temp2, extratemp1, extratemp2 } = parsedData;

  // Extract milestones
  const milestones = extractMilestones(parsedData);

  // Extract computed data from Artisan
  const computedData = parsedData.computed || {};

  // Normalize temperatures to Fahrenheit for consistency
  const { beanTemps, envTemps } = normalizeArtisanTemperatures(
    temp1,
    temp2,
    parsedData.temperature_unit,
    'F' // Store everything in Fahrenheit
  );

  // Extract control device data from extra devices with proper etypes mapping
  const extraDeviceData: { name: string; data: number[] }[] = [];

  // Map extratemp1 channels to their corresponding etype names
  if (extratemp1 && parsedData.extraname1) {
    extratemp1.forEach((channelData, channelIndex) => {
      if (channelData && channelData.length > 0 && parsedData.extraname1) {
        const deviceName = parsedData.extraname1[channelIndex];
        // Map device names to etypes if available
        let etypeName = deviceName;
        if (parsedData.etypes && parsedData.etypes.length > channelIndex) {
          const etype = parsedData.etypes[channelIndex];
          if (etype && etype !== '--') {
            etypeName = etype.toLowerCase();
          }
        }
        extraDeviceData.push({
          name: etypeName,
          data: channelData,
        });
      }
    });
  }

  // Map extratemp2 channels to their corresponding etype names
  if (extratemp2 && parsedData.extraname2) {
    extratemp2.forEach((channelData, channelIndex) => {
      if (channelData && channelData.length > 0 && parsedData.extraname2) {
        const deviceName = parsedData.extraname2[channelIndex];
        // Map device names to etypes if available, offset by extratemp1 length
        let etypeName = deviceName;
        const etypeIndex = channelIndex + (parsedData.extratemp1?.length || 0);
        if (parsedData.etypes && parsedData.etypes.length > etypeIndex) {
          const etype = parsedData.etypes[etypeIndex];
          if (etype && etype !== '--') {
            etypeName = etype.toLowerCase();
          }
        }
        extraDeviceData.push({
          name: etypeName,
          data: channelData,
        });
      }
    });
  }

  // Process special events if extra temp arrays are empty (fallback for newer Artisan files)
  const specialEvents: { time: number; name: string; value: string }[] = [];
  if (extraDeviceData.length === 0 && parsedData.specialevents && parsedData.specialeventsStrings) {
    parsedData.specialevents.forEach((eventIndex: number, index: number) => {
      const eventType = parsedData.specialeventstype?.[index];
      const valueString = parsedData.specialeventsStrings?.[index];

      // Resolve special event index -> absolute time in seconds
      let timeSeconds: number | undefined;
      if (
        typeof eventIndex === 'number' &&
        Number.isFinite(eventIndex) &&
        eventIndex >= 0 &&
        eventIndex < timex.length &&
        typeof timex[eventIndex] === 'number' &&
        Number.isFinite(timex[eventIndex])
      ) {
        timeSeconds = timex[eventIndex];
      } else {
        console.warn(
          `Skipping special event with invalid index: index=${eventIndex}, timex.length=${timex.length}`
        );
        return;
      }

      // Process ALL events that have non-empty string values (keep "0" as valid)
      if (valueString && valueString !== '' && eventType !== undefined) {
        // Direct device mapping using etypes array
        const deviceName = parsedData.etypes?.[eventType];

        if (deviceName && deviceName !== '--') {
          specialEvents.push({
            time: timeSeconds,
            name: deviceName.toLowerCase(), // "air", "burner", "drum", "damper"
            value: valueString,
          });
        }
      }
    });
  }

  // Create temperature data for roast_temperatures table
  const temperatureData: ProcessedRoastData['temperatureData'] = [];

  // Add temperature data points (sample to avoid overwhelming database)
  const sampleRate = Math.max(1, Math.floor(timex.length / 1000)); // Limit to ~1000 points
  timex.forEach((timeSeconds, index) => {
    // Include every Nth point, or points with significant temperature changes
    if (
      index % sampleRate === 0 ||
      (index > 0 && Math.abs((beanTemps[index] || 0) - (beanTemps[index - 1] || 0)) > 5)
    ) {
      temperatureData.push({
        roast_id: roastId,
        time_seconds: timeSeconds,
        bean_temp: beanTemps[index] || null,
        environmental_temp: envTemps[index] || null,
        ambient_temp: null, // Artisan doesn't typically have ambient temp
        data_source: 'artisan_import',
      });
    }
  });

  // Calculate phase percentages
  const chargeTime = milestones.charge || 0;
  const dropTime = milestones.drop || timex[timex.length - 1];
  const totalTime = dropTime - chargeTime;

  let dryingPercent = 0;
  let maillardPercent = 0;
  let developmentPercent = 0;

  if (totalTime > 0) {
    if (milestones.dry_end && milestones.dry_end > chargeTime) {
      dryingPercent = ((milestones.dry_end - chargeTime) / totalTime) * 100;
    }
    if (milestones.fc_start && milestones.dry_end && milestones.fc_start > milestones.dry_end) {
      maillardPercent = ((milestones.fc_start - milestones.dry_end) / totalTime) * 100;
    }
    if (milestones.fc_start && dropTime > milestones.fc_start) {
      developmentPercent = ((dropTime - milestones.fc_start) / totalTime) * 100;
    }
  }

  // Prepare profile data for roast_profiles table (matching schema columns)
  const profileData = {
    roaster_type: parsedData.roastertype || 'Unknown',
    roaster_size: parsedData.roastersize || 0,
    temperature_unit: 'F' as const, // Always store as Fahrenheit after conversion
    roast_notes:
      `Imported from Artisan\nRoaster: ${parsedData.roastertype || 'Unknown'}\nOriginal temp unit: ${parsedData.mode}\nWeight unit: ${parsedData.weight?.[2] || 'g'}` +
      (parsedData.roastingnotes ? `\n\nNotes: ${parsedData.roastingnotes}` : ''),
    roast_uuid: crypto.randomUUID(), // Generate a unique identifier
    data_source: 'artisan_import' as const,
  };

  // Create milestone events for roast_events table
  const milestoneEvents: ProcessedRoastData['milestoneEvents'] = [];
  Object.entries(milestones).forEach(([eventName, timeSeconds]) => {
    if (timeSeconds && timeSeconds > 0) {
      milestoneEvents.push({
        roast_id: roastId,
        time_seconds: timeSeconds,
        event_type: 10, // Milestone event type
        event_value: null, // Milestone events have NULL values
        event_string: eventName, // 'charge', 'dry_end', 'fc_start', etc.
        category: 'milestone',
        subcategory: 'roast_phase',
        user_generated: false,
        automatic: true,
        notes: `Imported from Artisan: ${eventName.replace('_', ' ')}`,
      });
    }
  });

  // Add turning point milestone if available from computed data
  if (computedData.TP_time && computedData.TP_time > 0) {
    milestoneEvents.push({
      roast_id: roastId,
      time_seconds: computedData.TP_time,
      event_type: 10, // Milestone event type
      event_value: null, // Milestone events have NULL values
      event_string: 'turning_point', // TP milestone
      category: 'milestone',
      subcategory: 'roast_phase',
      user_generated: false,
      automatic: true,
      notes: `Imported from Artisan: turning point at ${computedData.TP_time}s, ${computedData.TP_BT}°F`,
    });
  }

  // Create control events for all extra devices using actual etypes names
  const controlEvents: ProcessedRoastData['controlEvents'] = [];

  // Process extratemp device data if available
  timex.forEach((timeSeconds, index) => {
    // Sample control events to avoid overwhelming database
    if (index % sampleRate === 0) {
      extraDeviceData.forEach((device) => {
        const value = device.data[index];
        if (value !== null && value !== undefined && value !== 0) {
          controlEvents.push({
            roast_id: roastId,
            time_seconds: timeSeconds,
            event_type: 1, // Control event type
            event_value: value.toString(),
            event_string: device.name, // Use actual etype name from Artisan
            category: 'control',
            subcategory: 'machine_setting',
            user_generated: false,
            automatic: true,
          });
        }
      });
    }
  });

  // Add special events as control events if extratemp data was empty
  specialEvents.forEach((event) => {
    controlEvents.push({
      roast_id: roastId,
      time_seconds: event.time,
      event_type: 1, // Control event type
      event_value: event.value,
      event_string: event.name, // Use mapped etype name (air, drum, damper, burner)
      category: 'control',
      subcategory: 'machine_setting',
      user_generated: false,
      automatic: true,
      notes: `Imported from Artisan special events: ${event.name} set to ${event.value}`,
    });
  });

  // Note: roast_phases table no longer exists in normalized schema
  // Phase percentages are now stored directly in roast_profiles table

  return {
    profileData,
    temperatureData: temperatureData.sort((a, b) => a.time_seconds - b.time_seconds),
    milestones,
    phases: {
      drying_percent: dryingPercent,
      maillard_percent: maillardPercent,
      development_percent: developmentPercent,
      total_time_seconds: totalTime,
    },
    computed: {
      // Turning point data
      tp_time: computedData.TP_time || null,
      tp_temp: computedData.TP_BT || null,
      // Rate of rise metrics
      dry_phase_ror: computedData.dry_phase_ror || null,
      mid_phase_ror: computedData.mid_phase_ror || null,
      finish_phase_ror: computedData.finish_phase_ror || null,
      total_ror: computedData.total_ror || null,
      // Advanced metrics
      auc: computedData.AUC || null,
      dry_phase_delta_temp: computedData.dry_phase_delta_temp || null,
      // Temperature mappings to existing columns (use computed when available)
      charge_temp_computed: computedData.CHARGE_BT || null,
      dry_end_temp_computed: computedData.DRY_BT || null,
      drop_temp_computed: computedData.DROP_BT || null,
      cool_temp_computed: computedData.COOL_BT || null,
      // Time mappings to existing columns
      dry_end_time_computed: computedData.DRY_time || null,
      drop_time_computed: computedData.DROP_time || null,
      cool_time_computed: computedData.COOL_time || null,
    },
    milestoneEvents,
    controlEvents,
  };
}

// Full import: parse, transform, persist to DB, update profile
export async function importArtisanData(
  supabase: SupabaseClient,
  roastId: number,
  userId: string,
  fileContent: string,
  fileName: string,
  fileSize?: number // original file.size in bytes; falls back to content length if not provided
): Promise<ArtisanImportResult> {
  // Verify ownership and get existing roast profile data
  const { data: profile } = (await supabase
    .from('roast_profiles')
    .select('user, coffee_name, batch_name')
    .eq('roast_id', roastId)
    .single()) as {
    data: { user: string; coffee_name: string; batch_name: string } | null;
    error: unknown;
  };

  if (!profile || profile.user !== userId) {
    throw new Error('Unauthorized');
  }

  // Parse file content
  const artisanData = await parseArtisanFile(fileContent, fileName);

  // Transform to database format
  const processedData = transformArtisanData(artisanData, roastId);

  // Validate processed data
  const validation = validateProcessedData(processedData);
  if (!validation.valid) {
    throw new Error(`Data processing failed: ${validation.errors.join(', ')}`);
  }

  // Update roast profile metadata (preserve original coffee_name + add chart ranges)
  const { error: updateError } = await supabase
    .from('roast_profiles')
    .update({
      // Keep original coffee_name and batch_name
      coffee_name: profile.coffee_name, // Preserve original coffee
      batch_name: profile.batch_name, // Preserve original batch name without modification
      roaster_type: artisanData.roastertype || 'Unknown',
      roaster_size: artisanData.roastersize || 0,
      temperature_unit: 'F', // Always store as Fahrenheit
      // Chart display settings from Artisan
      chart_x_min: artisanData.xmin || null,
      chart_x_max: artisanData.xmax || null,
      chart_y_min: artisanData.ymin || null,
      chart_y_max: artisanData.ymax || null,
      chart_z_min: artisanData.zmin || null,
      chart_z_max: artisanData.zmax || null,
      // Milestone data for quick access (use computed when available)
      charge_time: processedData.milestones.charge || null,
      dry_end_time:
        processedData.computed.dry_end_time_computed || processedData.milestones.dry_end || null,
      fc_start_time: processedData.milestones.fc_start || null,
      fc_end_time: processedData.milestones.fc_end || null,
      sc_start_time: processedData.milestones.sc_start || null,
      drop_time: processedData.computed.drop_time_computed || processedData.milestones.drop || null,
      cool_time: processedData.computed.cool_time_computed || processedData.milestones.cool || null,
      // Milestone temperatures (use computed when available)
      charge_temp: processedData.computed.charge_temp_computed || null,
      dry_end_temp: processedData.computed.dry_end_temp_computed || null,
      drop_temp: processedData.computed.drop_temp_computed || null,
      cool_temp: processedData.computed.cool_temp_computed || null,
      // Phase calculations
      dry_percent: processedData.phases.drying_percent || null,
      maillard_percent: processedData.phases.maillard_percent || null,
      development_percent: processedData.phases.development_percent || null,
      total_roast_time: processedData.phases.total_time_seconds || null,
      // New computed data fields
      tp_time: processedData.computed.tp_time || null,
      tp_temp: processedData.computed.tp_temp || null,
      dry_phase_ror: processedData.computed.dry_phase_ror || null,
      mid_phase_ror: processedData.computed.mid_phase_ror || null,
      finish_phase_ror: processedData.computed.finish_phase_ror || null,
      total_ror: processedData.computed.total_ror || null,
      auc: processedData.computed.auc || null,
      dry_phase_delta_temp: processedData.computed.dry_phase_delta_temp || null,
      roast_uuid: processedData.profileData.roast_uuid,
      data_source: 'artisan_import',
    })
    .eq('roast_id', roastId);

  if (updateError) {
    console.error('Error updating roast profile:', updateError);
    throw updateError;
  }

  // 1. Clear existing imported data for this roast
  await clearRoastData(supabase, roastId, 'artisan_import');

  // 2. Insert temperature data
  await insertTemperatures(supabase, processedData.temperatureData);

  // 3. Insert milestone + control events
  const allEvents = [...processedData.milestoneEvents, ...processedData.controlEvents];
  if (allEvents.length > 0) {
    await insertEvents(supabase, allEvents);
  }

  // Create import log entry
  const { error: logError } = await supabase.from('artisan_import_log').insert({
    user_id: userId,
    roast_id: roastId,
    filename: fileName,
    file_size: fileSize ?? fileContent.length,
    artisan_version: artisanData.version || 'Unknown',
    total_data_points: processedData.temperatureData.length,
    processing_status: 'success',
    processing_messages: [
      `Imported ${processedData.temperatureData.length} temperature points`,
      `Created ${processedData.milestoneEvents.length} milestone events`,
      `Generated ${processedData.controlEvents.length} control events`,
    ],
    original_data: JSON.stringify({
      title: artisanData.title,
      roaster: artisanData.roastertype,
      weight: artisanData.weight,
      temperature_unit: artisanData.mode,
      timeindex: artisanData.timeindex,
    }),
  });
  if (logError) {
    console.error('Error creating import log:', logError);
    // Non-critical, continue
  }

  return {
    success: true,
    message: `Successfully imported ${processedData.temperatureData.length} data points from ${fileName}`,
    milestones: processedData.milestones,
    phases: processedData.phases,
    total_time: processedData.phases.total_time_seconds,
    temperature_unit: 'F',
    milestone_events: processedData.milestoneEvents.length,
    control_events: processedData.controlEvents.length,
  };
}
