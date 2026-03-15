/**
 * Parser for Artisan .alog files which use Python literal syntax
 * Converts Python literals to JSON format for processing
 */

export function parseAlogFile(alogContent: string): unknown {
  // Convert Python literal syntax to JSON
  let jsonContent = alogContent;

  try {
    // Replace Python boolean values with JSON equivalents (case-sensitive, whole words only)
    jsonContent = jsonContent.replace(/\bTrue\b/g, 'true');
    jsonContent = jsonContent.replace(/\bFalse\b/g, 'false');
    jsonContent = jsonContent.replace(/\bNone\b/g, 'null');

    // Handle Python-style comments (# comments) - remove them
    // But be careful not to remove # characters inside strings (like hex colors)
    jsonContent = removeCommentsCarefully(jsonContent);

    // Convert single quotes to double quotes if present
    if (jsonContent.includes("'")) {
      jsonContent = convertSingleQuotesToDouble(jsonContent);
    }

    // Clean up control characters in strings
    jsonContent = cleanControlCharacters(jsonContent);

    // Fix common array/object formatting issues
    jsonContent = fixFormattingIssues(jsonContent);

    // Try to parse as JSON
    const parsed = JSON.parse(jsonContent);

    // Validate core temperature arrays
    validateTemperatureArrays(parsed);

    return parsed;
  } catch (error) {
    // Enhanced error reporting with specific guidance
    if (error instanceof Error) {
      // If this is a validation error from our temperature array validation, re-throw as-is
      if (
        error.message.includes('Missing required temperature array') ||
        error.message.includes('Invalid temperature array') ||
        error.message.includes('No profile data found')
      ) {
        throw error;
      }

      // For JSON parsing errors, provide better context
      if (error instanceof SyntaxError && error.message.includes('position')) {
        const match = error.message.match(/position (\d+)/);
        if (match) {
          const position = parseInt(match[1]);
          const context = getErrorContext(jsonContent, position, 100);

          throw new Error(
            `Failed to parse .alog file: ${error.message}\n\n` +
              `This typically indicates:\n` +
              `- Malformed Python literal syntax that couldn't be converted to JSON\n` +
              `- Unescaped characters in string values\n` +
              `- Incomplete or corrupted file data\n\n` +
              `Error context: ...${context}...`
          );
        }
      }
    }

    throw new Error(
      `Invalid .alog file format: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
        `Please ensure the file is a valid Artisan .alog file with proper Python literal syntax.`
    );
  }
}

/**
 * Validate that critical temperature arrays exist and are consistent
 * Based on Artisan's validation logic in setProfile()
 */
interface AlogData {
  timex: number[];
  temp1: number[];
  temp2: number[];
  [key: string]: unknown;
}

function validateTemperatureArrays(parsed: Record<string, unknown>): void {
  const data = parsed as unknown as AlogData;
  const requiredArrays = ['timex', 'temp1', 'temp2'];

  // Check that all required arrays exist
  for (const arrayName of requiredArrays) {
    if (!parsed[arrayName]) {
      throw new Error(`Missing required temperature array: ${arrayName}`);
    }
    if (!Array.isArray(parsed[arrayName])) {
      throw new Error(`Invalid temperature array: ${arrayName} must be an array`);
    }
  }

  // Check that all arrays have the same length (as enforced by Artisan)
  const timexLength = data.timex.length;
  const temp1Length = data.temp1.length;
  const temp2Length = data.temp2.length;

  if (timexLength === 0) {
    throw new Error('No profile data found: timex array is empty');
  }

  if (timexLength !== temp1Length || timexLength !== temp2Length) {
    console.warn(
      `Temperature array length mismatch: timex=${timexLength}, temp1=${temp1Length}, temp2=${temp2Length}. ` +
        'Arrays will be truncated to minimum length as per Artisan behavior.'
    );

    // Truncate to minimum length (following Artisan's behavior)
    const minLength = Math.min(timexLength, temp1Length, temp2Length);
    parsed.timex = data.timex.slice(0, minLength);
    parsed.temp1 = data.temp1.slice(0, minLength);
    parsed.temp2 = data.temp2.slice(0, minLength);
  }

  // Validate that arrays contain valid numeric data
  const validateNumericArray = (array: unknown[], name: string): void => {
    for (let i = 0; i < array.length; i++) {
      const val = array[i];
      if (typeof val !== 'number' || isNaN(val)) {
        throw new Error(`Invalid data in ${name} array at index ${i}: ${val}`);
      }
    }
  };

  validateNumericArray(data.timex, 'timex');
  validateNumericArray(data.temp1, 'temp1');
  validateNumericArray(data.temp2, 'temp2');
}

/**
 * Remove Python-style comments while preserving # characters inside strings
 */
function removeCommentsCarefully(content: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      result += char;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    // If we find a # outside of a string, it's a comment - remove everything until newline
    if (char === '#' && !inString) {
      // Skip everything until we find a newline
      while (i < content.length && content[i] !== '\n' && content[i] !== '\r') {
        i++;
      }
      // Don't increment i again in the for loop, let it handle the newline
      i--;
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Clean up control characters in JSON strings
 */
function cleanControlCharacters(content: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      result += char;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    // If we're inside a string, handle control characters
    if (inString) {
      const charCode = char.charCodeAt(0);

      // Handle common control characters that need escaping in JSON
      if (charCode < 32) {
        switch (char) {
          case '\n':
            result += '\\n';
            break;
          case '\r':
            result += '\\r';
            break;
          case '\t':
            result += '\\t';
            break;
          case '\b':
            result += '\\b';
            break;
          case '\f':
            result += '\\f';
            break;
          default:
            // For other control characters, use unicode escape
            result += '\\u' + charCode.toString(16).padStart(4, '0');
            break;
        }
      } else {
        result += char;
      }
    } else {
      result += char;
    }
  }

  return result;
}

/**
 * Convert Python-style single quotes to double quotes while preserving string content
 */
function convertSingleQuotesToDouble(content: string): string {
  let result = '';
  let inDoubleQuotes = false;
  let inSingleQuotes = false;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      result += char;
      continue;
    }

    if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
      result += char;
    } else if (char === "'" && !inDoubleQuotes) {
      // Check if this is likely a property name or string value
      // Skip apostrophes that are likely part of contractions
      const nextChar = i + 1 < content.length ? content[i + 1] : '';
      const prevChar = i > 0 ? content[i - 1] : '';

      // Skip apostrophes in contractions like "don't", "can't", etc.
      if (prevChar.match(/[a-zA-Z]/) && nextChar.match(/[a-zA-Z]/)) {
        result += char;
        continue;
      }

      if (inSingleQuotes) {
        // End of single-quoted string - convert to double quote
        result += '"';
        inSingleQuotes = false;
      } else {
        // Start of single-quoted string - convert to double quote
        result += '"';
        inSingleQuotes = true;
      }
    } else {
      result += char;
    }
  }

  // Safety check: if we ended in single quotes, close the string
  if (inSingleQuotes) {
    console.warn('Warning: Unterminated single quote detected, adding closing quote');
    result += '"';
  }

  return result;
}

/**
 * Validate that a file is likely an Artisan .alog file
 */
export function isValidAlogFile(content: string): boolean {
  const trimmed = content.trim();

  // Must be a JSON-like object structure
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return false;
  }

  // Must contain core temperature data arrays (the essential markers)
  const hasTemperatureArrays =
    (content.includes('"timex"') || content.includes("'timex'")) &&
    (content.includes('"temp1"') || content.includes("'temp1'")) &&
    (content.includes('"temp2"') || content.includes("'temp2'"));

  if (!hasTemperatureArrays) {
    return false;
  }

  // Should have typical Artisan profile markers
  const hasArtisanMarkers =
    content.includes('"version"') ||
    content.includes("'version'") ||
    content.includes('"roastdate"') ||
    content.includes("'roastdate'") ||
    content.includes('"beans"') ||
    content.includes("'beans'");

  // Should have Python literal syntax if it's an .alog file
  const hasPythonSyntax =
    content.includes('True') || content.includes('False') || content.includes('None');

  return hasTemperatureArrays && (hasArtisanMarkers || hasPythonSyntax);
}

/**
 * Clean up common .alog file formatting issues
 */
export function preprocessAlogContent(content: string): string {
  // Remove any BOM (Byte Order Mark)
  content = content.replace(/^\uFEFF/, '');

  // Normalize line endings
  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove any trailing whitespace/newlines
  content = content.trim();

  return content;
}

/**
 * Fix common formatting issues that can cause JSON parsing errors
 */
function fixFormattingIssues(content: string): string {
  // Remove trailing commas in arrays and objects
  content = content.replace(/,(\s*[}\]])/g, '$1');

  // Fix double commas
  content = content.replace(/,,+/g, ',');

  // Fix empty elements in arrays (like [,] or [1,,2])
  content = content.replace(/\[\s*,/g, '[');
  content = content.replace(/,\s*,/g, ',');
  content = content.replace(/,\s*\]/g, ']');

  // Handle malformed arrays systematically
  content = fixMalformedArrays(content);

  return content;
}

/**
 * Systematically fix malformed array patterns found in .alog files
 */
function fixMalformedArrays(content: string): string {
  // Robust array cleanup using systematic validation and reconstruction
  // Strategy: Nuclear option - identify and safely convert problematic arrays to empty arrays

  // Step 1: Handle arrays with unmatched quotes (major parsing killer)
  content = content.replace(/:\s*\[[^\]]*"[^"\]]*$/gm, (match) => {
    const propertyMatch = match.match(/^([^:]*:)/);
    return propertyMatch ? propertyMatch[1] + ' []' : ': []';
  });

  // Step 2: Handle arrays with incomplete elements at end of lines
  content = content.replace(/:\s*\[[^\]]*,[^,\]"]*$/gm, (match) => {
    const propertyMatch = match.match(/^([^:]*:)/);
    return propertyMatch ? propertyMatch[1] + ' []' : ': []';
  });

  // Step 3: Fix arrays that contain only empty strings or whitespace
  content = content.replace(/:\s*\[\s*""\s*\]/g, ': []');
  content = content.replace(/:\s*\[\s*\]/g, ': []');

  // Step 4: Nuclear option for color arrays (consistently problematic)
  content = content.replace(/"[^"]*color[^"]*":\s*\[[^\]]*\]/gi, (match) => {
    const propertyMatch = match.match(/"([^"]*)"/);
    const propertyName = propertyMatch ? propertyMatch[1] : 'color_property';
    return `"${propertyName}": []`;
  });

  // Step 5: Fix trailing comma issues in arrays
  content = content.replace(/,(\s*\])/g, '$1');

  // Step 6: Final safety net - any array that doesn't have proper structure gets emptied
  // Look for arrays that start but don't properly close before next property or end
  content = content.replace(/:\s*\[(?![^\]]*\](?:\s*,|\s*}))[^\]]*(?=\s*"[^"]*"\s*:|$)/gm, ': []');

  return content;
}

/**
 * Get context around an error position for better debugging
 */
function getErrorContext(content: string, position: number, contextLength: number = 50): string {
  const start = Math.max(0, position - contextLength);
  const end = Math.min(content.length, position + contextLength);
  return content.substring(start, end);
}

/**
 * Main entry point for .alog file processing (formerly processAlogFile).
 * Preprocesses, validates, and parses Artisan .alog files.
 */
export function processAlogFile(fileContent: string): unknown {
  try {
    // Preprocess the content to normalize format
    const cleanContent = preprocessAlogContent(fileContent);

    // Validate it looks like an .alog file before attempting to parse
    if (!isValidAlogFile(cleanContent)) {
      throw new Error(
        'File does not appear to be a valid Artisan .alog file.\n\n' +
          'Expected: JSON-like object with timex, temp1, and temp2 temperature arrays.\n' +
          'Please ensure this is an Artisan roast profile file (.alog format).'
      );
    }

    // Parse the Python literal syntax to JSON and validate
    return parseAlogFile(cleanContent);
  } catch (error) {
    // Re-throw with context if it's already our enhanced error
    if (error instanceof Error && error.message.includes('This typically indicates')) {
      throw error;
    }

    // Otherwise wrap with general guidance
    throw new Error(
      `Failed to process .alog file: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
        'Please ensure the file is a valid, complete Artisan roast profile (.alog) file.'
    );
  }
}
